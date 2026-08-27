import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createClientCatalogService } from "../../packages/application/src/client-catalog-service.js";
import { PostgresClientCatalogRepository } from "../../packages/db/src/repositories/client-catalog-repository.js";
import {
  closeDb,
  createDb,
  migrateDb,
  type DrizzleDb,
} from "../../packages/db/src/client.js";
import {
  startExternalPostgresDatabase,
  type ExternalPostgresDatabase,
} from "../../packages/db/src/testkit/external-postgres.js";
import {
  createClientCatalogOutboxRegistry,
  createClientCatalogSourceReader,
} from "../../apps/worker/src/client-catalog-outbox.js";

const userId = "00000000-0000-4000-8000-000000000101";
const catalogRequestId = "00000000-0000-4000-8000-000000000201";
const slotId = "00000000-0000-4000-8000-000000000301";
const choiceHandle = `ch1.${"A".repeat(43)}` as const;
const choiceDigest = `sha256:${createHash("sha256")
  .update(choiceHandle)
  .digest("hex")}` as const;

describe("booking-aware catalog compatibility", () => {
  it("uses the isolated v2 digest domain without changing caller authority", async () => {
    const createOrReplay = vi.fn(async () => ({
      catalogRequestId,
      state: "pending" as const,
    }));
    const service = createClientCatalogService({
      repository: { createOrReplay, getOwned: async () => null },
      bookingAware: true,
      newCorrelationId: () => "booking-aware-correlation",
    });

    await service.request(
      { authenticated: true, active: true, userId },
      { serviceCode: "career", language: "ru" },
    );

    expect(createOrReplay).toHaveBeenCalledWith({
      userId,
      requestDigest: createHash("sha256")
        .update(`client-catalog-booking-v1\0${userId}\0career\0ru`)
        .digest("hex"),
      serviceCode: "career",
      language: "ru",
      correlationId: "booking-aware-correlation",
      version: 2,
    });
  });

  it("materializes only startsAt plus ch1 while retaining the local slot privately", async () => {
    const reader = createClientCatalogSourceReader(
      {
        listPublicServices: async () => [
          {
            sourceKey: "00000000-0000-4000-8000-000000000401",
            displayName: "Expert",
            serviceCode: "career",
            language: "ru",
          },
        ],
      },
      {
        read: async () => ({
          kind: "complete" as const,
          slots: [
            {
              localSlotId: slotId,
              sourceOrder: "one",
              startsAt: new Date("2026-08-16T12:00:00.000Z"),
              observedAt: new Date("2026-08-14T09:50:00.000Z"),
              remainingCapacity: 1,
            },
          ],
        }),
      },
      {
        generateChoiceHandle: () => choiceHandle,
        digestChoiceHandle: () => choiceDigest,
      },
    );

    await expect(
      reader.listBookingAware?.({
        databaseNow: new Date("2026-08-14T10:00:00.000Z"),
        requestExpiresAt: new Date("2026-08-15T10:00:00.000Z"),
      }),
    ).resolves.toEqual({
      cards: [
        {
          displayName: "Expert",
          serviceCode: "career",
          language: "ru",
          availability: "fresh_slots",
          slots: [
            {
              startsAt: "2026-08-16T12:00:00.000Z",
              choiceHandle,
            },
          ],
        },
      ],
      choices: [
        {
          choiceDigest,
          localSlotId: slotId,
          expiresAt: new Date("2026-08-14T10:05:00.000Z"),
        },
      ],
    });
  });

  it("accepts strict v2 as a disjoint worker payload", async () => {
    const materializeBookingAware = vi.fn(async () => "ready" as const);
    const listBookingAware = vi.fn(async () => ({ cards: [], choices: [] }));
    const registry = createClientCatalogOutboxRegistry({
      local: {
        topics: [
          "safety.operator_escalation",
          "admin.negative_feedback",
        ] as const,
        dispatch: async () => ({ kind: "applied" as const }),
        reconcile: async () => ({ kind: "applied" as const }),
      },
      requests: {
        loadPending: async () => ({
          catalogRequestId,
          databaseNow: new Date("2026-08-14T10:00:00.000Z"),
          expiresAt: new Date("2026-08-15T10:00:00.000Z"),
        }),
        materialize: async () => "ready" as const,
        materializeBookingAware,
      },
      source: { list: async () => [], listBookingAware },
    });

    await expect(
      registry.dispatch({
        id: "00000000-0000-4000-8000-000000000501",
        topic: "catalog.show",
        payload: { v: 2, catalogRequestId },
      }),
    ).resolves.toEqual({ kind: "applied" });
    expect(listBookingAware).toHaveBeenCalledOnce();
    expect(materializeBookingAware).toHaveBeenCalledWith({
      catalogRequestId,
      cards: [],
      choices: [],
    });
  });
});

let db: DrizzleDb;
let external: ExternalPostgresDatabase;

describe("PostgreSQL protected choice materialization", () => {
  beforeAll(async () => {
    const adminUrl = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    if (adminUrl === undefined)
      throw new Error("external PostgreSQL is required");
    external = await startExternalPostgresDatabase(adminUrl);
    db = createDb(external.getConnectionUri());
    await migrateDb(db, "packages/db/migrations");
  }, 120_000);
  afterAll(async () => {
    if (db !== undefined) await closeDb(db);
    if (external !== undefined) await external.stop();
  }, 120_000);

  it("commits snapshot and protected mapping once and deletes both on retention", async () => {
    const owner = (
      await db.execute<{ id: string }>(sql`
        insert into users default values returning id
      `)
    ).rows[0]!.id;
    await db.execute(sql`
      insert into experts (id,user_id,public_display_name,active,verified)
      values ('00000000-0000-4000-8000-000000000601'::uuid,${owner}::uuid,'Expert',true,true)
    `);
    await db.execute(sql`
      insert into expert_services (id,expert_id,name,code,language,active,duration_minutes)
      values ('00000000-0000-4000-8000-000000000602'::uuid,'00000000-0000-4000-8000-000000000601'::uuid,'Career','career','ru',true,60)
    `);
    await db.execute(sql`
      insert into slots (id,expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity)
      values (${slotId}::uuid,'00000000-0000-4000-8000-000000000602'::uuid,'local','choice-slot',clock_timestamp()+interval '48 hours',clock_timestamp()+interval '49 hours',clock_timestamp(),1)
    `);
    const repository = new PostgresClientCatalogRepository(db);
    const receipt = await repository.createOrReplay({
      userId: owner,
      requestDigest: createHash("sha256")
        .update(`client-catalog-booking-v1\0${owner}\0career\0ru`)
        .digest("hex"),
      serviceCode: "career",
      language: "ru",
      correlationId: "booking-aware-pg",
      version: 2,
    });
    const cards = [
      {
        displayName: "Expert",
        serviceCode: "career",
        language: "ru",
        availability: "fresh_slots" as const,
        slots: [
          {
            startsAt: "2026-08-16T12:00:00.000Z",
            choiceHandle,
          },
        ],
      },
    ];
    const expiresAt = new Date(Date.now() + 60_000);

    await expect(
      repository.materializeBookingAware({
        catalogRequestId: receipt.catalogRequestId,
        cards,
        choices: [{ choiceDigest, localSlotId: slotId, expiresAt }],
      }),
    ).resolves.toBe("ready");
    await expect(
      repository.materializeBookingAware({
        catalogRequestId: receipt.catalogRequestId,
        cards: [],
        choices: [],
      }),
    ).resolves.toBe("replayed");
    await expect(
      repository.getOwned({
        userId: owner,
        catalogRequestId: receipt.catalogRequestId,
      }),
    ).resolves.toEqual({
      catalogRequestId: receipt.catalogRequestId,
      state: "ready",
      cards,
    });
    const protectedRows = await db.execute<{
      choiceDigest: string;
      slotId: string;
    }>(sql`
      select choice_digest as "choiceDigest",slot_id as "slotId"
      from client_catalog_choices
    `);
    expect(protectedRows.rows).toEqual([{ choiceDigest, slotId }]);

    await db.execute(sql`
      update client_catalog_requests set
        created_at=clock_timestamp()-interval '2 days',
        expires_at=clock_timestamp()-interval '1 second'
    `);
    await db.execute(sql`
      update client_catalog_snapshots set
        created_at=clock_timestamp()-interval '2 days',
        expires_at=clock_timestamp()-interval '1 second'
    `);
    await db.execute(sql`
      update integration_outbox set status='succeeded' where topic='catalog.show'
    `);
    await repository.expireDue({ now: new Date(), limit: 10 });
    const counts = await db.execute<{ choices: string; snapshots: string }>(sql`
      select
        (select count(*)::text from client_catalog_choices) choices,
        (select count(*)::text from client_catalog_snapshots) snapshots
    `);
    expect(counts.rows[0]).toEqual({ choices: "0", snapshots: "0" });
  });
});
