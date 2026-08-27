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

const digestFor = (userId: string) =>
  createHash("sha256")
    .update(`client-catalog-v1\0${userId}\0career\0ru`)
    .digest("hex");

const createRequest = async (userId: string) => {
  const repository = new PostgresClientCatalogRepository(testDb.db);
  const receipt = await repository.createOrReplay({
    userId,
    requestDigest: digestFor(userId),
    serviceCode: "career",
    language: "ru",
    correlationId: randomUUID(),
  });
  return { repository, receipt };
};

const forceDue = (catalogRequestId: string) =>
  testDb.db.execute(sql`
    update client_catalog_requests
    set created_at=clock_timestamp()-interval '2 days',
      updated_at=clock_timestamp(),expires_at=clock_timestamp()-interval '1 second'
    where id=${catalogRequestId}::uuid
  `);

const card = {
  displayName: "Public Expert",
  serviceCode: "career",
  language: "ru",
  availability: "catalog_only" as const,
  slots: [],
};

describe("PostgreSQL client catalog privacy lifecycle", () => {
  it("exports only public snapshots, then strips and removes an expired request/outbox pair", async () => {
    const userId = await testDb.createUser();
    const { repository, receipt } = await createRequest(userId);
    await repository.materialize({
      catalogRequestId: receipt.catalogRequestId,
      cards: [card],
    });

    const privacy = new PostgresPrivacyRepository(testDb.db);
    const exported = await privacy.exportOwnedSubject(userId);
    expect(exported.catalogSnapshots).toEqual([
      expect.objectContaining({
        catalogRequestId: receipt.catalogRequestId,
        cards: [card],
      }),
    ]);
    expect(JSON.stringify(exported.catalogSnapshots)).not.toMatch(
      /requestDigest|outbox|correlation|sourceKey|provider|contact/iu,
    );

    await forceDue(receipt.catalogRequestId);
    const future = new Date(Date.now() + 25 * 60 * 60 * 1_000);
    await expect(
      repository.expireDue({ now: future, limit: 10 }),
    ).resolves.toEqual({ examined: 1, expired: 1, removed: 0 });
    const tombstone = await testDb.db.execute<{
      state: string;
      expiresAt: Date | string;
      requestCount: number;
      snapshotCount: number;
    }>(sql`
      select t.state,t.expires_at as "expiresAt",
        (select count(*)::integer from client_catalog_requests r
          where r.id=t.request_id) as "requestCount",
        (select count(*)::integer from client_catalog_snapshots s
          where s.request_id=t.request_id) as "snapshotCount"
      from client_catalog_tombstones t
      where t.request_id=${receipt.catalogRequestId}::uuid
    `);
    expect(tombstone.rows[0]).toEqual(expect.objectContaining({
      state: "expired",
      requestCount: 0,
      snapshotCount: 0,
    }));

    await testDb.db.execute(sql`
      update integration_outbox set status='succeeded'
      where idempotency_key=${`client-catalog:${receipt.catalogRequestId}`}
    `);
    await expect(
      repository.expireDue({ now: future, limit: 10 }),
    ).resolves.toEqual({ examined: 1, expired: 0, removed: 1 });
    const removed = await testDb.db.execute<{
      requestCount: number;
      outboxCount: number;
    }>(sql`
      select
        (select count(*)::integer from client_catalog_requests
          where id=${receipt.catalogRequestId}::uuid) as "requestCount",
        (select count(*)::integer from integration_outbox
          where idempotency_key=${`client-catalog:${receipt.catalogRequestId}`}) as "outboxCount"
    `);
    expect(removed.rows[0]).toEqual({ requestCount: 0, outboxCount: 0 });
  });

  it("makes a claimed worker harmless when retention wins before materialization", async () => {
    const userId = await testDb.createUser();
    const { repository, receipt } = await createRequest(userId);
    const pending = await repository.loadPending(receipt.catalogRequestId);
    expect(pending).not.toBeNull();
    await testDb.db.execute(sql`
      update integration_outbox set status='processing',dispatch_owner_id='worker',
        dispatch_claim_token='claim',lease_until=now()+interval '5 minutes'
      where idempotency_key=${`client-catalog:${receipt.catalogRequestId}`}
    `);
    await forceDue(receipt.catalogRequestId);

    await repository.expireDue({
      now: new Date(Date.now() + 25 * 60 * 60 * 1_000),
      limit: 10,
    });
    await expect(
      repository.materialize({
        catalogRequestId: receipt.catalogRequestId,
        cards: [card],
      }),
    ).resolves.toBe("missing");
    const snapshots = await testDb.db.execute<{ count: number }>(sql`
      select count(*)::integer as count from client_catalog_snapshots
      where request_id=${receipt.catalogRequestId}::uuid
    `);
    expect(snapshots.rows[0]?.count).toBe(0);
  });

  it("erases catalog rows under the privacy transaction and later removes the orphaned terminal outbox", async () => {
    const userId = await testDb.createUser();
    const { repository, receipt } = await createRequest(userId);
    expect(await repository.loadPending(receipt.catalogRequestId)).not.toBeNull();
    await testDb.db.execute(sql`
      insert into message_packages (id,user_id,granted_messages,grant_idempotency_key)
      values ('00000000-0000-4000-8000-000000000901'::uuid,${userId}::uuid,1,${`catalog-privacy-package:${userId}`})
    `);
    await testDb.db.execute(sql`
      insert into message_ledger_entries (package_id,entry_kind,delta,idempotency_key)
      values ('00000000-0000-4000-8000-000000000901'::uuid,'grant',1,${`catalog-privacy-ledger:${userId}`})
    `);
    const processors = [
      "object_store",
      "selarti",
      "planerka",
      "make_projection",
    ] as const;
    const privacy = new PostgresPrivacyRepository(testDb.db, {
      privacyMutationCapability: {
        enabled: true,
        captureManifests: async () =>
          processors.map((processor) => ({
            processor,
            ciphertext: `ciphertext:${processor}`,
            keyReference: `test-key:${processor}`,
            algorithm: "test-envelope-v1",
            version: "1",
            subjectDeletionKeyHash: `sha256:${processor}`,
          })),
        verifyEnvelope: () => true,
      },
    });
    await privacy.startErasureAtomically({
      targetUserId: userId,
      correlationId: `erase:${userId}`,
      idempotencyKey: `erase:${userId}`,
      pseudonym: "hmac:catalog-erased",
    });

    await expect(
      repository.materialize({
        catalogRequestId: receipt.catalogRequestId,
        cards: [card],
      }),
    ).resolves.toBe("missing");
    const afterErasure = await testDb.db.execute<{
      requestCount: number;
      snapshotCount: number;
      ledgerCount: number;
    }>(sql`
      select
        (select count(*)::integer from client_catalog_requests
          where id=${receipt.catalogRequestId}::uuid) as "requestCount",
        (select count(*)::integer from client_catalog_snapshots
          where request_id=${receipt.catalogRequestId}::uuid) as "snapshotCount",
        (select count(*)::integer from message_ledger_entries
          where idempotency_key=${`catalog-privacy-ledger:${userId}`}) as "ledgerCount"
    `);
    expect(afterErasure.rows[0]).toEqual({
      requestCount: 0,
      snapshotCount: 0,
      ledgerCount: 1,
    });
    expect((await privacy.exportOwnedSubject(userId)).catalogSnapshots).toEqual([]);

    await testDb.db.execute(sql`
      update integration_outbox set status='succeeded'
      where idempotency_key=${`client-catalog:${receipt.catalogRequestId}`}
    `);
    await expect(
      repository.expireDue({ now: new Date(), limit: 10 }),
    ).resolves.toEqual({ examined: 1, expired: 0, removed: 1 });
  });
});
