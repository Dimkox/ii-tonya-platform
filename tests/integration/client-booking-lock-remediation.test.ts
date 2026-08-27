import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeDb,
  createDb,
  migrateDb,
  PostgresBookingRepository,
  type DrizzleDb,
} from "../../packages/db/src/index.js";
import {
  startExternalPostgresDatabase,
  type ExternalPostgresDatabase,
} from "../../packages/db/src/testkit/external-postgres.js";

let db: DrizzleDb;
let external: ExternalPostgresDatabase;

describe("client booking lock remediation", () => {
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

  it("rechecks choice expiry with database time acquired after lock wait", async () => {
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
    const expertId = "00000000-0000-4000-8000-000000000811";
    const serviceId = "00000000-0000-4000-8000-000000000812";
    const slotId = "00000000-0000-4000-8000-000000000813";
    await db.execute(sql`
      insert into experts (id,user_id,public_display_name,active,verified)
      values (${expertId}::uuid,${expertUserId}::uuid,'Expert',true,true)
    `);
    await db.execute(sql`
      insert into expert_services (id,expert_id,name,code,language,active,duration_minutes)
      values (${serviceId}::uuid,${expertId}::uuid,'Career','career','ru',true,60)
    `);
    await db.execute(sql`
      insert into slots (id,expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity)
      values (${slotId}::uuid,${serviceId}::uuid,'local','review-lock-slot',clock_timestamp()+interval '48 hours',clock_timestamp()+interval '49 hours',clock_timestamp(),1)
    `);
    const requestId = (
      await db.execute<{ id: string }>(sql`
        insert into client_catalog_requests (user_id,request_digest,state)
        values (${ownerId}::uuid,${"1".repeat(64)},'ready') returning id
      `)
    ).rows[0]!.id;
    const choiceDigest = `sha256:${"2".repeat(64)}` as const;
    await db.execute(sql`
      insert into client_catalog_choices (request_id,choice_digest,slot_id,expires_at)
      values (${requestId}::uuid,${choiceDigest},${slotId}::uuid,clock_timestamp()+interval '2 seconds')
    `);

    const locker = await db.$client.connect();
    try {
      await locker.query("begin");
      await locker.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [`choice:${choiceDigest}`],
      );
      const outcome = new PostgresBookingRepository(db).reserveProtectedChoice({
        userId: ownerId,
        choiceDigest,
        idempotencyKey: createHash("sha256").update(ownerId).digest("hex"),
        bookingHandle: `bk1.${"D".repeat(43)}`,
        correlationId: "review-stale-clock",
        minimumLeadMs: 86_400_000,
        slotFreshnessMs: 900_000,
        confirmationBufferMs: 3_600_000,
      });
      await new Promise((resolve) => setTimeout(resolve, 2_200));
      await locker.query("commit");
      await expect(outcome).resolves.toEqual({ kind: "not_found" });
    } finally {
      await locker.query("rollback").catch(() => undefined);
      locker.release();
    }
  }, 30_000);
});
