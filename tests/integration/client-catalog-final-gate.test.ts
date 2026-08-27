import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createClientCatalogService } from "../../packages/application/src/index.js";
import {
  PostgresCatalogRepository,
  PostgresClientCatalogRepository,
  PostgresPrivacyRepository,
} from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  createClientCatalogOutboxRegistry,
  createClientCatalogSourceReader,
} from "../../apps/worker/src/client-catalog-outbox.js";
import {
  selectClientCatalogRetention,
  selectWorkerOutboxRegistry,
} from "../../apps/worker/src/main.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

const seedPublicService = async () => {
  const expertUserId = await testDb.createUser();
  const expert = await testDb.db.execute<{ id: string }>(sql`
    insert into experts (user_id,public_display_name,active,verified)
    values (${expertUserId}::uuid,'Final Gate Expert',true,true)
    returning id
  `);
  await testDb.db.execute(sql`
    insert into expert_services (expert_id,name,code,language,active,duration_minutes)
    values (${expert.rows[0]!.id}::uuid,'Career','career','ru',true,60)
  `);
};

const localRegistry = {
  topics: ["safety.operator_escalation", "admin.negative_feedback"] as const,
  dispatch: async () => ({ kind: "applied" as const }),
  reconcile: async () => ({ kind: "applied" as const }),
};

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

describe("MVP-CLIENT-CATALOG-001 final focused gate", () => {
  it("composes both flags and materializes only a public owner-scoped zero-ledger snapshot", async () => {
    await seedPublicService();
    const userId = await testDb.createUser();
    const foreignUserId = await testDb.createUser();
    const requests = new PostgresClientCatalogRepository(testDb.db);
    const service = createClientCatalogService({
      repository: requests,
      newCorrelationId: randomUUID,
    });
    const receipt = await service.request(
      { authenticated: true, active: true, userId },
      { serviceCode: "career", language: "ru" },
    );
    const composite = createClientCatalogOutboxRegistry({
      local: localRegistry,
      requests,
      source: createClientCatalogSourceReader(
        new PostgresCatalogRepository(testDb.db),
      ),
    });
    const enabledConfig = {
      features: { workerOutboxDelivery: true, clientCatalog: true },
    } as never;
    expect(selectWorkerOutboxRegistry(enabledConfig, () => composite)?.topics).toEqual([
      "safety.operator_escalation",
      "admin.negative_feedback",
      "catalog.show",
    ]);
    expect(
      selectClientCatalogRetention(enabledConfig, () => async () => ({})),
    ).toBeTypeOf("function");
    expect(
      selectClientCatalogRetention(
        {
          features: { workerOutboxDelivery: false, clientCatalog: true },
        } as never,
        () => async () => ({}),
      ),
    ).toBeUndefined();

    const outbox = (await testDb.db.execute<{
      id: string;
      payload: unknown;
      correlationId: string;
      reconciliationKey: string;
    }>(sql`
      select id,payload,correlation_id as "correlationId",
        reconciliation_key as "reconciliationKey"
      from integration_outbox
      where idempotency_key=${`client-catalog:${receipt.catalogRequestId}`}
    `)).rows[0]!;
    await expect(
      composite.dispatch({
        id: outbox.id,
        topic: "catalog.show",
        payload: outbox.payload,
      }),
    ).resolves.toEqual({ kind: "applied" });

    const snapshot = await service.get(
      { authenticated: true, active: true, userId },
      receipt.catalogRequestId,
    );
    expect(snapshot).toEqual({
      catalogRequestId: receipt.catalogRequestId,
      state: "ready",
      cards: [
        {
          displayName: "Final Gate Expert",
          serviceCode: "career",
          language: "ru",
          availability: "catalog_only",
          slots: [],
        },
      ],
    });
    await expect(
      service.get(
        { authenticated: true, active: true, userId: foreignUserId },
        receipt.catalogRequestId,
      ),
    ).resolves.toBeNull();
    const exported = await privacyRepository().exportOwnedSubject(userId);
    expect(exported.catalogSnapshots).toEqual([
      expect.objectContaining({
        catalogRequestId: receipt.catalogRequestId,
        cards: (snapshot as { cards: unknown }).cards,
      }),
    ]);
    expect(JSON.stringify({ snapshot, exported: exported.catalogSnapshots })).not.toMatch(
      /expertId|serviceId|slotId|requestDigest|outbox|correlation|providerId|contact/iu,
    );
    const ledger = await testDb.db.execute<{ count: number }>(sql`
      select count(*)::integer as count
      from message_ledger_entries l
      join message_packages p on p.id=l.package_id
      where p.user_id=${userId}::uuid
    `);
    expect(ledger.rows[0]?.count).toBe(0);
  });

  it("uses database expiry, purges terminal facts, and erases retention-first tombstones", async () => {
    const userId = await testDb.createUser();
    const requests = new PostgresClientCatalogRepository(testDb.db);
    const service = createClientCatalogService({ repository: requests });
    const receipt = await service.request(
      { authenticated: true, active: true, userId },
      {},
    );
    await testDb.db.execute(sql`
      update client_catalog_requests
      set created_at=clock_timestamp()-interval '2 days',
        updated_at=clock_timestamp(),expires_at=clock_timestamp()-interval '1 second'
      where id=${receipt.catalogRequestId}::uuid
    `);
    await expect(
      requests.materialize({ catalogRequestId: receipt.catalogRequestId, cards: [] }),
    ).resolves.toBe("missing");
    await testDb.db.execute(sql`
      update integration_outbox set status='succeeded'
      where idempotency_key=${`client-catalog:${receipt.catalogRequestId}`}
    `);
    await expect(
      requests.expireDue({ now: new Date(), limit: 1 }),
    ).resolves.toEqual({ examined: 1, expired: 0, removed: 1 });

    const retentionFirst = await service.request(
      { authenticated: true, active: true, userId },
      { serviceCode: "other" },
    );
    await testDb.db.execute(sql`
      update client_catalog_requests
      set created_at=clock_timestamp()-interval '2 days',
        updated_at=clock_timestamp(),expires_at=clock_timestamp()-interval '1 second'
      where id=${retentionFirst.catalogRequestId}::uuid
    `);
    await requests.expireDue({ now: new Date(), limit: 1 });
    await privacyRepository().startErasureAtomically({
      targetUserId: userId,
      correlationId: `erase:${userId}`,
      idempotencyKey: `erase:${userId}`,
      pseudonym: "hmac:final-gate",
    });
    const remaining = await testDb.db.execute<{
      requests: number;
      snapshots: number;
      tombstones: number;
      associations: number;
    }>(sql`
      select
        (select count(*)::integer from client_catalog_requests
          where user_id=${userId}::uuid) as requests,
        (select count(*)::integer from client_catalog_snapshots s
          join client_catalog_erasure_index e on e.request_id=s.request_id
          where e.subject_key is not null) as snapshots,
        (select count(*)::integer from client_catalog_tombstones
          where request_id=${retentionFirst.catalogRequestId}::uuid) as tombstones,
        (select count(*)::integer from client_catalog_erasure_index
          where request_id=${retentionFirst.catalogRequestId}::uuid) as associations
    `);
    expect(remaining.rows[0]).toEqual({
      requests: 0,
      snapshots: 0,
      tombstones: 0,
      associations: 0,
    });
  });
});
