import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeDb,
  createDb,
  migrateDb,
  PostgresBookingRepository,
  PostgresPrivacyRepository,
  type DrizzleDb,
} from "../../packages/db/src/index.js";
import {
  startExternalPostgresDatabase,
  type ExternalPostgresDatabase,
} from "../../packages/db/src/testkit/external-postgres.js";
import { runClientBookingErasureBatch } from "../../packages/worker/src/client-booking-erasure.js";

let db: DrizzleDb;
let external: ExternalPostgresDatabase;

describe("client booking privacy lifecycle", () => {
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

  it("cancels active reservations before fenced public-handle cleanup", async () => {
    const ownerId = (
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
      values ('00000000-0000-4000-8000-000000000701'::uuid,${expertUserId}::uuid,'Expert',true,true)
    `);
    await db.execute(sql`
      insert into expert_services (id,expert_id,name,code,language,active,duration_minutes)
      values ('00000000-0000-4000-8000-000000000702'::uuid,'00000000-0000-4000-8000-000000000701'::uuid,'Career','career','ru',true,60)
    `);
    await db.execute(sql`
      insert into slots (id,expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity)
      values ('00000000-0000-4000-8000-000000000703'::uuid,'00000000-0000-4000-8000-000000000702'::uuid,'local','privacy-slot',clock_timestamp()+interval '48 hours',clock_timestamp()+interval '49 hours',clock_timestamp(),1)
    `);
    const requestId = (
      await db.execute<{ id: string }>(sql`
        insert into client_catalog_requests (user_id,request_digest,state)
        values (${ownerId}::uuid,${"a".repeat(64)},'ready') returning id
      `)
    ).rows[0]!.id;
    const choiceDigest = `sha256:${"b".repeat(64)}` as const;
    await db.execute(sql`
      insert into client_catalog_choices (request_id,choice_digest,slot_id,expires_at)
      values (${requestId}::uuid,${choiceDigest},'00000000-0000-4000-8000-000000000703'::uuid,clock_timestamp()+interval '10 minutes')
    `);
    const bookings = new PostgresBookingRepository(db);
    await bookings.reserveProtectedChoice({
      userId: ownerId,
      choiceDigest,
      idempotencyKey: createHash("sha256").update(ownerId).digest("hex"),
      bookingHandle: `bk1.${"C".repeat(43)}`,
      correlationId: "privacy-reserve",
      minimumLeadMs: 86_400_000,
      slotFreshnessMs: 900_000,
      confirmationBufferMs: 3_600_000,
    });
    const processors = [
      "object_store",
      "selarti",
      "planerka",
      "make_projection",
    ] as const;
    const privacy = new PostgresPrivacyRepository(db, {
      privacyMutationCapability: {
        enabled: true,
        captureManifests: async () =>
          processors.map((processor) => ({
            processor,
            ciphertext: `ciphertext-${processor}`,
            keyReference: "kms://privacy-test",
            algorithm: "test-envelope",
            version: "v1",
            subjectDeletionKeyHash: createHash("sha256")
              .update(`${ownerId}:${processor}`)
              .digest("hex"),
          })),
        verifyEnvelope: async () => true,
      },
    });
    const job = await privacy.startErasureAtomically({
      targetUserId: ownerId,
      correlationId: "privacy-start",
      idempotencyKey: "privacy-start",
      pseudonym: `hmac:${"d".repeat(64)}`,
    });

    await expect(
      db.execute(sql`
        update privacy_deletion_jobs set status='processor_complete'
        where id=${job.jobId}::uuid
      `),
    ).rejects.toThrow();
    await expect(
      runClientBookingErasureBatch({ db, bookings, limit: 2 }),
    ).resolves.toEqual({ examined: 2, completed: 1, failed: 0 });
    const result = await db.execute<{
      status: string;
      receipts: string;
      phase: string;
    }>(sql`
      select r.status,
        (select count(*)::text from client_booking_receipts) receipts,
        (select phase from client_booking_erasure_work where deletion_job_id=${job.jobId}::uuid) phase
      from reservations r where r.user_id=${ownerId}::uuid
    `);
    expect(result.rows[0]).toEqual({
      status: "cancelled_by_client",
      receipts: "0",
      phase: "complete",
    });
    await expect(
      db.execute(sql`
        update privacy_deletion_jobs set status='processor_complete'
        where id=${job.jobId}::uuid
      `),
    ).resolves.toBeDefined();
  });
});
