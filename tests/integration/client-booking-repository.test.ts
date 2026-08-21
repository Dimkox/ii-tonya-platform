import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
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

const choiceHandle = `ch1.${"A".repeat(43)}` as const;
const choiceDigest = `sha256:${createHash("sha256")
  .update(choiceHandle)
  .digest("hex")}` as const;
const bookingHandle = `bk1.${"B".repeat(43)}` as const;

let db: DrizzleDb;
let external: ExternalPostgresDatabase;
let ownerId: string;
let foreignId: string;

describe("protected client booking PostgreSQL authority", () => {
  beforeAll(async () => {
    const adminUrl = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    if (adminUrl === undefined)
      throw new Error("external PostgreSQL is required");
    external = await startExternalPostgresDatabase(adminUrl);
    db = createDb(external.getConnectionUri());
    await migrateDb(db, "packages/db/migrations");
    ownerId = (
      await db.execute<{ id: string }>(
        sql`insert into users default values returning id`,
      )
    ).rows[0]!.id;
    foreignId = (
      await db.execute<{ id: string }>(
        sql`insert into users default values returning id`,
      )
    ).rows[0]!.id;
    const expertUserId = (
      await db.execute<{ id: string }>(
        sql`insert into users default values returning id`,
      )
    ).rows[0]!.id;
    await db.execute(sql`
      insert into experts (id,user_id,public_display_name,active,verified)
      values ('00000000-0000-4000-8000-000000000601'::uuid,${expertUserId}::uuid,'Expert',true,true)
    `);
    await db.execute(sql`
      insert into expert_services (id,expert_id,name,code,language,active,duration_minutes)
      values ('00000000-0000-4000-8000-000000000602'::uuid,'00000000-0000-4000-8000-000000000601'::uuid,'Career','career','ru',true,60)
    `);
    await db.execute(sql`
      insert into slots (id,expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity)
      values ('00000000-0000-4000-8000-000000000603'::uuid,'00000000-0000-4000-8000-000000000602'::uuid,'local','protected-slot',clock_timestamp()+interval '48 hours',clock_timestamp()+interval '49 hours',clock_timestamp(),1)
    `);
    const requestId = (
      await db.execute<{ id: string }>(sql`
        insert into client_catalog_requests (user_id,request_digest,state)
        values (${ownerId}::uuid,${"a".repeat(64)},'ready') returning id
      `)
    ).rows[0]!.id;
    await db.execute(sql`
      insert into client_catalog_choices (request_id,choice_digest,slot_id,expires_at)
      values (${requestId}::uuid,${choiceDigest},'00000000-0000-4000-8000-000000000603'::uuid,clock_timestamp()+interval '10 minutes')
    `);
  }, 120_000);

  afterAll(async () => {
    if (db !== undefined) await closeDb(db);
    if (external !== undefined) await external.stop();
  }, 120_000);

  it("reserves once under concurrency and atomically retains one public receipt", async () => {
    const repository = new PostgresBookingRepository(db, {
      retryDelayMs: () => 0,
    });
    const command = {
      userId: ownerId,
      choiceDigest,
      idempotencyKey: createHash("sha256")
        .update(`client-booking-reserve-v1\0${ownerId}\0${choiceDigest}`)
        .digest("hex"),
      bookingHandle,
      correlationId: "protected-reserve",
      minimumLeadMs: 86_400_000,
      slotFreshnessMs: 900_000,
      confirmationBufferMs: 3_600_000,
    } as const;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        repository.reserveProtectedChoice(command),
      ),
    );

    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.kind === "replayed")).toHaveLength(
      4,
    );
    expect(
      new Set(
        results.flatMap((result) =>
          result.kind === "reserved" || result.kind === "replayed"
            ? [result.bookingHandle]
            : [],
        ),
      ),
    ).toEqual(new Set([bookingHandle]));
    const counts = await db.execute<{
      reservations: string;
      receipts: string;
      audits: string;
      outbox: string;
    }>(sql`
      select
        (select count(*)::text from reservations) reservations,
        (select count(*)::text from client_booking_receipts) receipts,
        (select count(*)::text from audit_events where correlation_id='protected-reserve') audits,
        (select count(*)::text from integration_outbox where correlation_id='protected-reserve') outbox
    `);
    expect(counts.rows[0]).toEqual({
      reservations: "1",
      receipts: "1",
      audits: "1",
      outbox: "2",
    });
  });

  it("makes absent and foreign protected choices indistinguishable", async () => {
    const repository = new PostgresBookingRepository(db);
    const base = {
      choiceDigest: `sha256:${"c".repeat(64)}` as const,
      idempotencyKey: "d".repeat(64),
      bookingHandle: `bk1.${"D".repeat(43)}` as const,
      correlationId: "not-found",
      minimumLeadMs: 86_400_000,
      slotFreshnessMs: 900_000,
      confirmationBufferMs: 3_600_000,
    };
    await expect(
      repository.reserveProtectedChoice({ ...base, userId: ownerId }),
    ).resolves.toEqual({ kind: "not_found" });
    await expect(
      repository.reserveProtectedChoice({
        ...base,
        userId: foreignId,
        choiceDigest,
      }),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("owner-cancels through the existing transition and replays both cancellation terminals", async () => {
    const repository = new PostgresBookingRepository(db);
    await expect(
      repository.cancelOwnedByHandle({
        userId: ownerId,
        bookingHandle,
        correlationId: "protected-cancel",
      }),
    ).resolves.toEqual({ kind: "cancelled" });
    await expect(
      repository.cancelOwnedByHandle({
        userId: ownerId,
        bookingHandle,
        correlationId: "protected-cancel-replay",
      }),
    ).resolves.toEqual({ kind: "replayed" });
    await expect(
      repository.cancelOwnedByHandle({
        userId: foreignId,
        bookingHandle,
        correlationId: "foreign-cancel",
      }),
    ).resolves.toEqual({ kind: "not_found" });
    const counts = await db.execute<{ audits: string; outbox: string }>(sql`
      select
        (select count(*)::text from audit_events where action='reservation.client_cancel') audits,
        (select count(*)::text from integration_outbox where correlation_id='protected-cancel') outbox
    `);
    expect(counts.rows[0]).toEqual({ audits: "1", outbox: "2" });
  });
});
