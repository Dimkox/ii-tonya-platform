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
  const requestDigest = createHash("sha256")
    .update(`review:${userId}:${suffix}`)
    .digest("hex");
  const receipt = await repository.createOrReplay({
    userId,
    requestDigest,
    serviceCode: "career",
    language: "ru",
    correlationId: randomUUID(),
  });
  return { userId, repository, receipt };
};

const forceDue = (catalogRequestId: string) =>
  testDb.db.execute(sql`
    update client_catalog_requests
    set created_at=clock_timestamp()-interval '2 days',
      updated_at=clock_timestamp(),expires_at=clock_timestamp()-interval '1 second'
    where id=${catalogRequestId}::uuid
  `);

const privacyRepository = () => {
  const processors = ["object_store", "selarti", "planerka", "make_projection"] as const;
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

describe("client catalog adversarial review remediations", () => {
  it("uses database time to terminalize a due request before materialization", async () => {
    const { repository, receipt } = await createRequest("due-materialize");
    await forceDue(receipt.catalogRequestId);
    await expect(
      repository.materialize({ catalogRequestId: receipt.catalogRequestId, cards: [] }),
    ).resolves.toBe("missing");
    const rows = await testDb.db.execute<{ count: number }>(sql`
      select count(*)::integer as count from client_catalog_tombstones
      where request_id=${receipt.catalogRequestId}::uuid and state='expired'
    `);
    expect(rows.rows[0]?.count).toBe(1);
  });

  it("keeps tombstones exactly minimal and does not let a nonterminal tombstone starve newer expiry", async () => {
    const first = await createRequest("first");
    await forceDue(first.receipt.catalogRequestId);
    await first.repository.expireDue({ now: new Date(), limit: 1 });

    const second = await createRequest("second");
    await forceDue(second.receipt.catalogRequestId);
    await expect(
      second.repository.expireDue({ now: new Date(), limit: 1 }),
    ).resolves.toEqual({ examined: 1, expired: 1, removed: 0 });
    const columns = await testDb.db.execute<{ columnName: string }>(sql`
      select column_name as "columnName" from information_schema.columns
      where table_schema='public' and table_name='client_catalog_tombstones'
      order by column_name
    `);
    expect(columns.rows.map((row) => row.columnName)).toEqual([
      "expires_at",
      "request_id",
      "state",
    ]);
    const secondTombstone = await testDb.db.execute<{ count: number }>(sql`
      select count(*)::integer as count from client_catalog_tombstones
      where request_id=${second.receipt.catalogRequestId}::uuid
    `);
    expect(secondTombstone.rows[0]?.count).toBe(1);
  });

  it("fails closed instead of exporting corrupt snapshot keys", async () => {
    const { userId, repository, receipt } = await createRequest("corrupt-export");
    await repository.materialize({ catalogRequestId: receipt.catalogRequestId, cards: [] });
    await testDb.db.execute(sql`
      update client_catalog_snapshots
      set cards='[{"providerId":"private"}]'::jsonb
      where request_id=${receipt.catalogRequestId}::uuid
    `);
    await expect(
      new PostgresPrivacyRepository(testDb.db).exportOwnedSubject(userId),
    ).rejects.toThrow("client_catalog_snapshot_invalid");
  });

  it("erases every subject request even when its catalog outbox is missing", async () => {
    const { userId, receipt } = await createRequest("missing-outbox");
    await testDb.db.execute(sql`
      delete from integration_outbox
      where idempotency_key=${`client-catalog:${receipt.catalogRequestId}`}
    `);
    await privacyRepository().startErasureAtomically({
      targetUserId: userId,
      correlationId: `erase:${userId}`,
      idempotencyKey: `erase:${userId}`,
      pseudonym: "hmac:review",
    });
    const rows = await testDb.db.execute<{ count: number }>(sql`
      select count(*)::integer as count from client_catalog_requests
      where user_id=${userId}::uuid
    `);
    expect(rows.rows[0]?.count).toBe(0);
  });

  it("keeps migration and Drizzle constraint names aligned", async () => {
    const constraints = await testDb.db.execute<{ name: string }>(sql`
      select conname as name from pg_constraint
      where conname in (
        'client_catalog_requests_filters_check',
        'client_catalog_requests_time_check',
        'client_catalog_snapshots_expiry_check',
        'client_catalog_tombstones_state_check'
      ) order by conname
    `);
    expect(constraints.rows.map((row) => row.name)).toEqual([
      "client_catalog_requests_filters_check",
      "client_catalog_requests_time_check",
      "client_catalog_snapshots_expiry_check",
      "client_catalog_tombstones_state_check",
    ]);
  });
});
