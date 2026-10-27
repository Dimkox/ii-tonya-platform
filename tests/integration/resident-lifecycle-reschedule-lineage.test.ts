import { afterAll, beforeAll, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import { PostgresResidentLifecycleCompletionRepository } from "../../packages/db/src/repositories/resident-lifecycle-completion-repository.js";
import { seedWaitlistFixture } from "./booking-waitlist.fixture.js";
let database: ExpertReferralTestDatabase;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);
async function target() {
  const userId = await database.createUser();
  const expertId = (
    await database.db.execute<{ id: string }>(
      sql`insert into experts(user_id,public_display_name,active,verified) values(${userId}::uuid,'Lineage expert',true,true) returning id`,
    )
  ).rows[0]!.id;
  const serviceId = (
    await database.db.execute<{ id: string }>(
      sql`insert into expert_services(expert_id,name,code,language,active,duration_minutes) values(${expertId}::uuid,'Lineage service','lineage','ru',true,60) returning id`,
    )
  ).rows[0]!.id;
  const slots: string[] = [];
  for (let day = 4; day <= 5; day++)
    slots.push(
      (
        await database.db.execute<{ id: string }>(
          sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity) values(${serviceId}::uuid,'local',${randomUUID()},clock_timestamp()+${day}*interval '1 day',clock_timestamp()+${day}*interval '1 day'+interval '1 hour',clock_timestamp(),1) returning id`,
        )
      ).rows[0]!.id,
    );
  await database.db.execute(
    sql`insert into resident_lifecycle_subjects(user_id,expert_id) values(${userId}::uuid,${expertId}::uuid)`,
  );
  return { userId, expertId, serviceId, slots };
}
async function promoted() {
  const fixture = await seedWaitlistFixture(database),
    candidate = await fixture.candidate(randomUUID());
  expect(await fixture.repository.join(candidate)).toMatchObject({
    kind: "joined",
  });
  await database.db.execute(
    sql`update reservations set status='cancelled_by_client' where id=${fixture.occupied.reservationId}::uuid`,
  );
  const result = await fixture.repository.promoteNext({
    slotId: fixture.occupied.slotId,
    now: fixture.occupied.databaseNow,
    holdDurationMs: 259200000,
  });
  if (result.kind !== "promoted") throw Error("promotion_missing");
  const receipt = (
    await database.db.execute<{ handle: `bk1.${string}` }>(
      sql`select booking_handle handle from client_booking_receipts where reservation_id=${result.reservationId}::uuid`,
    )
  ).rows[0]!;
  return {
    ...result,
    userId: candidate.userId,
    originalSlotId: fixture.occupied.slotId,
    bookingHandle: receipt.handle,
  };
}
async function move(p: Awaited<ReturnType<typeof promoted>>, slotId: string) {
  const choiceDigest: `sha256:${string}` = `sha256:${hash(randomUUID())}`;
  const request = (
    await database.db.execute<{ id: string }>(
      sql`insert into client_catalog_requests(user_id,request_digest,state,expires_at) values(${p.userId}::uuid,${hash(randomUUID())},'ready',clock_timestamp()+interval '1 hour') returning id`,
    )
  ).rows[0]!.id;
  await database.db.execute(
    sql`insert into client_catalog_choices(request_id,choice_digest,slot_id,expires_at) values(${request}::uuid,${choiceDigest},${slotId}::uuid,clock_timestamp()+interval '1 hour')`,
  );
  const command = {
    userId: p.userId,
    bookingHandle: p.bookingHandle,
    choiceDigest,
    idempotencyKey: hash(randomUUID()),
    correlationId: randomUUID(),
    confirmationBufferMs: 3600000,
  };
  const repo = new PostgresBookingRepository(database.db);
  const result = await repo.rescheduleOwnedByHandle(command);
  expect(result.kind).toBe("rescheduled");
  expect(await repo.rescheduleOwnedByHandle(command)).toMatchObject({
    kind: "replayed",
  });
}
async function decline(
  p: Awaited<ReturnType<typeof promoted>>,
  t: Awaited<ReturnType<typeof target>>,
) {
  const version = (
    await database.db.execute<{ version: number }>(
      sql`select version from reservations where id=${p.reservationId}::uuid`,
    )
  ).rows[0]!.version;
  await new PostgresBookingRepository(database.db).transition({
    reservationId: p.reservationId,
    expectedVersion: version,
    action: "expert_cancel",
    actor: { type: "expert", id: t.expertId },
    now: new Date(),
    correlationId: randomUUID(),
  });
}
async function scan(t: Awaited<ReturnType<typeof target>>) {
  const worker = new PostgresResidentLifecycleCompletionRepository(
    database.db,
    {
      workBotId: "818181",
      workBotKey: "core-work",
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
  );
  await worker.processBatch(50);
  return (
    await database.db.execute(
      sql`select numerator,denominator,missing_provenance,status from resident_lifecycle_cases where user_id=${t.userId}::uuid and kind='quality_window'`,
    )
  ).rows;
}
it("counts one actual promoted request after two owner reschedules across experts and final human decline", async () => {
  const t = await target(),
    p = await promoted();
  await move(p, t.slots[0]!);
  await move(p, t.slots[1]!);
  await decline(p, t);
  expect(
    (
      await database.db.execute(
        sql`select old_version,new_version from booking_reschedule_facts where reservation_id=${p.reservationId}::uuid order by old_version`,
      )
    ).rows,
  ).toEqual([
    { old_version: 1, new_version: 2 },
    { old_version: 2, new_version: 3 },
  ]);
  expect(await scan(t)).toEqual([
    { numerator: 1, denominator: 1, missing_provenance: 0, status: "open" },
  ]);
  await database.db.execute(
    sql`update resident_lifecycle_subjects set last_scanned_at='-infinity' where user_id=${t.userId}::uuid`,
  );
  expect(await scan(t)).toHaveLength(1);
}, 60000);
it("rejects absent, wrong-owner and forked reschedule lineage instead of dropping the source-slot check", async () => {
  const t = await target();
  for (const kind of ["absent", "wrong_owner", "forked"]) {
    const p = await promoted();
    if (kind === "forked") {
      await move(p, t.slots[0]!);
      await database.db.execute(
        sql`insert into booking_reschedule_facts(reservation_id,user_id,old_slot_id,new_slot_id,old_version,new_version,idempotency_key,correlation_id,created_at) select reservation_id,user_id,old_slot_id,${t.slots[1]!}::uuid,old_version,new_version,${hash(randomUUID())},correlation_id,created_at from booking_reschedule_facts where reservation_id=${p.reservationId}::uuid`,
      );
    } else {
      // Adversarial row mutation does not establish a client-authorized reschedule.
      await database.db.execute(
        sql`update reservations set slot_id=${t.slots[0]!}::uuid,expert_id=${t.expertId}::uuid,expert_service_id=${t.serviceId}::uuid,version=2 where id=${p.reservationId}::uuid`,
      );
      if (kind === "wrong_owner")
        await database.db.execute(
          sql`insert into booking_reschedule_facts(reservation_id,user_id,old_slot_id,new_slot_id,old_version,new_version,idempotency_key,correlation_id) values(${p.reservationId}::uuid,${await database.createUser()}::uuid,${p.originalSlotId}::uuid,${t.slots[0]!}::uuid,1,2,${hash(randomUUID())},${randomUUID()})`,
        );
    }
    await decline(p, t);
  }
  expect(await scan(t)).toEqual([
    {
      numerator: 0,
      denominator: 0,
      missing_provenance: 3,
      status: "no_action",
    },
  ]);
}, 60000);
