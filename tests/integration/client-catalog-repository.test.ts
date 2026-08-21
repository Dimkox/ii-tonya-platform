import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresClientCatalogRepository } from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

const digestFor = (userId: string, serviceCode = "career", language = "ru") =>
  createHash("sha256")
    .update(`client-catalog-v1\0${userId}\0${serviceCode}\0${language}`)
    .digest("hex");

describe("PostgreSQL client catalog request repository", () => {
  it("atomically replays one same-user request and one exact catalog.show fact", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresClientCatalogRepository(testDb.db);
    const requestDigest = digestFor(userId);

    const receipts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repository.createOrReplay({
          userId,
          requestDigest,
          serviceCode: "career",
          language: "ru",
          correlationId: `catalog-concurrent-${index}`,
        }),
      ),
    );

    expect(new Set(receipts.map(({ catalogRequestId }) => catalogRequestId))).toEqual(
      new Set([receipts[0]?.catalogRequestId]),
    );
    expect(receipts.every(({ state }) => state === "pending")).toBe(true);

    const facts = await testDb.db.execute<{
      requestCount: string;
      outboxCount: string;
      idempotencyKey: string;
      reconciliationKey: string;
      correlationId: string;
      payload: unknown;
      payloadHash: string;
    }>(sql`
      select
        (select count(*)::text from client_catalog_requests) as "requestCount",
        (select count(*)::text from integration_outbox where topic='catalog.show') as "outboxCount",
        o.idempotency_key as "idempotencyKey",
        o.reconciliation_key as "reconciliationKey",
        o.correlation_id as "correlationId",
        o.payload,
        o.payload_hash as "payloadHash"
      from integration_outbox o
      where o.topic='catalog.show'
    `);
    const fact = facts.rows[0];
    const catalogRequestId = receipts[0]?.catalogRequestId;
    expect(fact).toMatchObject({
      requestCount: "1",
      outboxCount: "1",
      idempotencyKey: `client-catalog:${catalogRequestId}`,
      reconciliationKey: `client-catalog:${catalogRequestId}:v1`,
      correlationId: "catalog-concurrent-0",
      payload: { v: 1, catalogRequestId },
    });
    expect(fact?.payloadHash).toBe(
      createHash("sha256")
        .update(JSON.stringify({ v: 1, catalogRequestId }))
        .digest("hex"),
    );
  });

  it("keeps equal normalized filters isolated by authenticated user", async () => {
    const [firstUserId, secondUserId] = await Promise.all([
      testDb.createUser(),
      testDb.createUser(),
    ]);
    const repository = new PostgresClientCatalogRepository(testDb.db);

    const [first, second] = await Promise.all([
      repository.createOrReplay({
        userId: firstUserId,
        requestDigest: digestFor(firstUserId),
        serviceCode: "career",
        language: "ru",
        correlationId: randomUUID(),
      }),
      repository.createOrReplay({
        userId: secondUserId,
        requestDigest: digestFor(secondUserId),
        serviceCode: "career",
        language: "ru",
        correlationId: randomUUID(),
      }),
    ]);

    expect(first.catalogRequestId).not.toBe(second.catalogRequestId);
    await expect(
      repository.getOwned({
        userId: secondUserId,
        catalogRequestId: first.catalogRequestId,
      }),
    ).resolves.toBeNull();
  });

  it("uses first-write-wins snapshot CAS and hides expired owner rows", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresClientCatalogRepository(testDb.db);
    const receipt = await repository.createOrReplay({
      userId,
      requestDigest: digestFor(userId),
      serviceCode: "career",
      language: "ru",
      correlationId: randomUUID(),
    });
    const firstCards = [
      {
        displayName: "Expert",
        serviceCode: "career",
        language: "ru",
        availability: "catalog_only" as const,
        slots: [],
      },
    ];

    await expect(
      repository.materialize({
        catalogRequestId: receipt.catalogRequestId,
        cards: firstCards,
      }),
    ).resolves.toBe("ready");
    await expect(
      repository.materialize({
        catalogRequestId: receipt.catalogRequestId,
        cards: [],
      }),
    ).resolves.toBe("replayed");
    await expect(
      repository.getOwned({
        userId,
        catalogRequestId: receipt.catalogRequestId,
      }),
    ).resolves.toEqual({
      catalogRequestId: receipt.catalogRequestId,
      state: "ready",
      cards: firstCards,
    });

    await testDb.db.execute(sql`
      update client_catalog_requests
      set created_at=clock_timestamp()-interval '2 days',
        updated_at=clock_timestamp(),
        expires_at=clock_timestamp()-interval '1 second'
      where id=${receipt.catalogRequestId}::uuid
    `);
    await testDb.db.execute(sql`
      delete from client_catalog_snapshots
      where request_id=${receipt.catalogRequestId}::uuid
    `);

    await expect(
      repository.getOwned({
        userId,
        catalogRequestId: receipt.catalogRequestId,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.materialize({
        catalogRequestId: receipt.catalogRequestId,
        cards: firstCards,
      }),
    ).resolves.toBe("missing");
  });
});
