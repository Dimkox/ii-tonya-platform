import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import { seedLifecycleFixture } from "./lifecycle-scheduler.fixture.js";
let database: TestDatabase;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
beforeAll(async () => {
  database = await startTestPostgres();
  await database.migrate();
}, 120000);
afterAll(async () => database.stop());
async function fixture() {
  const f = await seedLifecycleFixture(database);
  const target = (
    await database.db.execute<{
      id: string;
    }>(sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity)
 select expert_service_id,'local',${randomUUID()},starts_at+interval '1 day',ends_at+interval '1 day',clock_timestamp(),1 from slots where id=${f.slotId}::uuid returning id`)
  ).rows[0]!.id;
  const digest = `sha256:${hash(randomUUID())}` as const;
  const request = (
    await database.db.execute<{ id: string }>(
      sql`insert into client_catalog_requests(user_id,request_digest,state,expires_at) values(${f.userId}::uuid,${hash(randomUUID())},'ready',clock_timestamp()+interval '1 hour') returning id`,
    )
  ).rows[0]!.id;
  await database.db.execute(
    sql`insert into client_catalog_choices(request_id,choice_digest,slot_id,expires_at) values(${request}::uuid,${digest},${target}::uuid,clock_timestamp()+interval '1 hour')`,
  );
  const bookingHandle = `bk1.${hash(randomUUID()).slice(0, 43)}` as const;
  await database.db.execute(
    sql`insert into client_booking_receipts(user_id,choice_digest,booking_handle,reservation_id) values(${f.userId}::uuid,${`sha256:${hash(randomUUID())}`},${bookingHandle},${f.reservationId}::uuid)`,
  );
  const repository = new PostgresBookingRepository(database.db, {
    retryDelayMs: () => 0,
  });
  const command = {
    userId: f.userId,
    bookingHandle,
    choiceDigest: digest,
    idempotencyKey: hash(randomUUID()),
    correlationId: randomUUID(),
    confirmationBufferMs: 3600000,
  };
  return { ...f, target, repository, command };
}
it("reschedule waits on consent authority before locking a reservation row", async () => {
  const f = await fixture();
  const blocker = await database.db.$client.connect(),
    observer = await database.db.$client.connect();
  let operation:
    ReturnType<typeof f.repository.rescheduleOwnedByHandle> | undefined;
  try {
    await blocker.query("begin");
    await blocker.query(
      "select pg_advisory_xact_lock(hashtextextended($1,0))",
      [f.userId],
    );
    let done = false;
    operation = f.repository.rescheduleOwnedByHandle(f.command).finally(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(done).toBe(false);
    await observer.query("begin");
    await expect(
      observer.query(
        "select id from reservations where id=$1 for update nowait",
        [f.reservationId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await observer.query("rollback");
    await blocker.query("commit");
    expect(await operation).toMatchObject({ kind: "rescheduled" });
  } finally {
    await observer.query("rollback");
    await blocker.query("rollback");
    await operation?.catch(() => {});
    observer.release();
    blocker.release();
  }
});
it("reschedule and ordinary reservation serialize without a deadlock and admit one occupant", async () => {
  const f = await fixture(),
    userId = await database.createUser();
  const result = await Promise.all([
    f.repository.rescheduleOwnedByHandle(f.command),
    f.repository.reserve({
      userId,
      slotId: f.target,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      now: new Date(),
      minimumLeadMs: 86400000,
      confirmationBufferMs: 3600000,
    }),
  ]);
  expect(
    result.filter((r) => r.kind === "rescheduled" || r.kind === "reserved"),
  ).toHaveLength(1);
  expect(
    (
      await database.db.execute(
        sql`select id from reservations where slot_id=${f.target}::uuid and status in ('booked','reserved')`,
      )
    ).rows,
  ).toHaveLength(1);
});
