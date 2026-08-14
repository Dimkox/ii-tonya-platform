import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PostgresClientCatalogRepository,
  PostgresPrivacyRepository,
} from "../../packages/db/src/index.js";
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

const createRequest = async (suffix: string) => {
  const userId = await testDb.createUser();
  const repository = new PostgresClientCatalogRepository(testDb.db);
  const receipt = await repository.createOrReplay({
    userId,
    requestDigest: createHash("sha256")
      .update(`closure:${userId}:${suffix}`)
      .digest("hex"),
    correlationId: randomUUID(),
  });
  return { userId, repository, receipt };
};

const forceDue = (catalogRequestId: string, secondsAgo = 1) =>
  testDb.db.execute(sql`
    update client_catalog_requests
    set created_at=clock_timestamp()-interval '2 days',
      updated_at=clock_timestamp(),
      expires_at=clock_timestamp()-(${secondsAgo} * interval '1 second')
    where id=${catalogRequestId}::uuid
  `);

const privacyRepository = () => {
  const processors = [
    "object_store",
    "selarti",
    "planerka",
    "make_projection",
  ] as const;
  return new PostgresPrivacyRepository(testDb.db, {
    privacyMutationCapability: {
      enabled: true,
      captureManifests: async () =>
        processors.map((processor) => ({
          processor,
          ciphertext: `cipher:${processor}`,
          keyReference: `test:${processor}`,
          algorithm: "test-v1",
          version: "1",
          subjectDeletionKeyHash: `hash:${processor}`,
        })),
      verifyEnvelope: () => true,
    },
  });
};

describe("client catalog adversarial closure", () => {
  it("erases a tombstone when retention wins before subject erasure", async () => {
    const { userId, repository, receipt } = await createRequest("retention-first");
    await forceDue(receipt.catalogRequestId);
    await repository.expireDue({ now: new Date(), limit: 1 });

    await privacyRepository().startErasureAtomically({
      targetUserId: userId,
      correlationId: `erase:${userId}`,
      idempotencyKey: `erase:${userId}`,
      pseudonym: "hmac:closure",
    });

    const facts = await testDb.db.execute<{
      tombstones: number;
      associations: number;
    }>(sql`
      select
        (select count(*)::integer from client_catalog_tombstones
          where request_id=${receipt.catalogRequestId}::uuid) as tombstones,
        (select count(*)::integer from client_catalog_erasure_index
          where request_id=${receipt.catalogRequestId}::uuid) as associations
    `);
    expect(facts.rows[0]).toEqual({ tombstones: 0, associations: 0 });
  });

  it("cleans a terminal tombstone despite a full newer-expiry batch", async () => {
    const terminal = await createRequest("terminal");
    await forceDue(terminal.receipt.catalogRequestId, 10);
    await terminal.repository.expireDue({ now: new Date(), limit: 1 });
    await testDb.db.execute(sql`
      update integration_outbox set status='succeeded'
      where idempotency_key=${`client-catalog:${terminal.receipt.catalogRequestId}`}
    `);

    const due = await createRequest("due-backlog");
    await forceDue(due.receipt.catalogRequestId, 1);
    const report = await due.repository.expireDue({ now: new Date(), limit: 1 });

    expect(report).toEqual({ examined: 2, expired: 1, removed: 1 });
    const terminalFacts = await testDb.db.execute<{
      tombstones: number;
      outboxes: number;
    }>(sql`
      select
        (select count(*)::integer from client_catalog_tombstones
          where request_id=${terminal.receipt.catalogRequestId}::uuid) as tombstones,
        (select count(*)::integer from integration_outbox
          where idempotency_key=${`client-catalog:${terminal.receipt.catalogRequestId}`}) as outboxes
    `);
    expect(terminalFacts.rows[0]).toEqual({ tombstones: 0, outboxes: 0 });
  });
});
