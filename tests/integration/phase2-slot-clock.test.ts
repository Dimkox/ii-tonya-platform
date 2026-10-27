import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach as vitestBeforeEach,
  describe,
  expect,
  it as vitestIt,
} from "vitest";
import { createAsyncCaseDrainFence } from "../support/async-case-drain.js";
const caseDrain = createAsyncCaseDrainFence({ drainTimeoutMs: 2000 });
const beforeEach = (body: () => Promise<void>, timeout?: number) =>
  vitestBeforeEach(() => {
    caseDrain.assertReady();
    return caseDrain.run(body);
  }, timeout);
const it = (name: string, body: () => Promise<void>, timeout?: number) =>
  vitestIt(name, () => caseDrain.run(body), timeout);
afterEach(async () => {
  await caseDrain.drain();
});
import {
  closeDb,
  createDb,
  migrateDb,
  type DrizzleDb,
} from "../../packages/db/src/client.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import {
  startExternalPostgresDatabase,
  type ExternalPostgresDatabase,
} from "../../packages/db/src/testkit/external-postgres.js";

let db: DrizzleDb;
let external: ExternalPostgresDatabase;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
async function effectCounts() {
  return (
    await db.execute<Record<string, string>>(sql`select
 (select count(*)::text from reservations) as reservations,
 (select count(*)::text from client_booking_receipts) as receipts,
 (select count(*)::text from audit_events) as audits,
 (select count(*)::text from integration_outbox) as outbox,
 (select count(*)::text from message_ledger_entries) as "messageLedger",
 (select count(*)::text from expert_referral_ledger_entries) as "referralLedger"`)
  ).rows[0]!;
}

beforeAll(async () => {
  const url = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  if (url === undefined) throw new Error("external PostgreSQL is required");
  external = await startExternalPostgresDatabase(url);
  db = createDb(external.getConnectionUri());
  await migrateDb(db, "packages/db/migrations");
}, 120_000);
afterAll(async () => {
  await caseDrain.drain();
  if (db !== undefined) await closeDb(db);
  if (external !== undefined) await external.stop();
}, 120_000);

describe.each(["choice", "request"] as const)(
  "protected booking after a later %s row lock",
  (target) => {
    let userId: string;
    let requestId: string;
    let choiceDigest: `sha256:${string}`;
    let baseline: Record<string, string>;
    beforeEach(async () => {
      userId = (
        await db.execute<{ id: string }>(
          sql`insert into users default values returning id`,
        )
      ).rows[0]!.id;
      const expertUserId = (
        await db.execute<{ id: string }>(
          sql`insert into users default values returning id`,
        )
      ).rows[0]!.id;
      const expertId = randomUUID(),
        serviceId = randomUUID(),
        slotId = randomUUID();
      await db.execute(
        sql`insert into experts(id,user_id,public_display_name,active,verified) values(${expertId}::uuid,${expertUserId}::uuid,'Synthetic slot expert',true,true)`,
      );
      await db.execute(
        sql`insert into expert_services(id,expert_id,name,code,language,active,duration_minutes) values(${serviceId}::uuid,${expertId}::uuid,'Synthetic service','phase2-slot','ru',true,60)`,
      );
      await db.execute(
        sql`insert into slots(id,expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity) values(${slotId}::uuid,${serviceId}::uuid,'local',${"phase2-" + slotId},clock_timestamp()+interval '48 hours',clock_timestamp()+interval '49 hours',clock_timestamp(),1)`,
      );
      // Each case owns a fresh legal TTL. No clock override or historical mutation.
      requestId = (
        await db.execute<{ id: string }>(
          sql`insert into client_catalog_requests(user_id,request_digest,state,expires_at) values(${userId}::uuid,${sha(userId + target)},'ready',clock_timestamp()+${target === "request" ? 3 : 86400}*interval '1 second') returning id`,
        )
      ).rows[0]!.id;
      choiceDigest = `sha256:${sha(randomUUID())}`;
      await db.execute(
        sql`insert into client_catalog_choices(request_id,choice_digest,slot_id,expires_at) values(${requestId}::uuid,${choiceDigest},${slotId}::uuid,clock_timestamp()+${target === "choice" ? 3 : 86400}*interval '1 second')`,
      );
      baseline = await effectCounts();
    }, 30_000);
    it("rejects a selection whose real TTL expired while waiting, without any booking or financial effects", async () => {
      const locker = await db.$client.connect();
      let pending:
        Promise<{ result: unknown } | { error: unknown }> | undefined;
      try {
        await locker.query("begin");
        const pid = (
          await locker.query<{ pid: number }>("select pg_backend_pid() as pid")
        ).rows[0]!.pid;
        if (target === "choice")
          await locker.query(
            "select id from client_catalog_choices where choice_digest=$1 for update",
            [choiceDigest],
          );
        else
          await locker.query(
            "select id from client_catalog_requests where id=$1::uuid for update",
            [requestId],
          );
        pending = new PostgresBookingRepository(db, { retryDelayMs: () => 0 })
          .reserveProtectedChoice({
            userId,
            choiceDigest,
            idempotencyKey: sha(userId + choiceDigest),
            bookingHandle: `bk1.${randomBytes(32).toString("base64url")}`,
            correlationId: "phase2-later-" + target,
            minimumLeadMs: 86_400_000,
            slotFreshnessMs: 900_000,
            confirmationBufferMs: 3_600_000,
          })
          .then(
            (result) => ({ result }),
            (error) => ({ error }),
          );
        let waiting = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          waiting =
            (
              await db.execute<{ waiting: boolean }>(
                sql`select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and ${pid} = any(pg_blocking_pids(pid)) and query like '%from client_catalog_choices c%') as waiting`,
              )
            ).rows[0]?.waiting === true;
          if (waiting) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(
          waiting,
          "reservation must reach the later row lock before expiry",
        ).toBe(true);
        const valid = (
          await db.execute<{ valid: boolean }>(
            sql`select c.expires_at>clock_timestamp() and r.expires_at>clock_timestamp() as valid from client_catalog_choices c join client_catalog_requests r on r.id=c.request_id where c.choice_digest=${choiceDigest}`,
          )
        ).rows[0]?.valid;
        expect(
          valid,
          "the TTL must still be valid when the later wait is observed",
        ).toBe(true);
        await db.execute(
          sql`select pg_sleep(greatest(0,extract(epoch from (least(c.expires_at,r.expires_at)-clock_timestamp())))+0.05) from client_catalog_choices c join client_catalog_requests r on r.id=c.request_id where c.choice_digest=${choiceDigest}`,
        );
        await locker.query("commit");
        const outcome = await pending;
        expect.soft(outcome).toEqual({ result: { kind: "not_found" } });
        expect.soft(await effectCounts()).toEqual(baseline);
      } finally {
        await locker.query("rollback").catch(() => undefined);
        locker.release();
        await pending;
      }
    }, 15_000);
  },
);
