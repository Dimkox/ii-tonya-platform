import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { seedWaitlistFixture } from "./booking-waitlist.fixture.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await startTestPostgres();
  await database.migrate();
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);

async function hide(slotId: string, state: "archived" | "paused") {
  const expert = (
    await database.db.execute<{ id: string; userId: string }>(
      sql`select e.id,e.user_id as "userId" from experts e join expert_services es on es.expert_id=e.id join slots s on s.expert_service_id=es.id where s.id=${slotId}::uuid`,
    )
  ).rows[0]!;
  if (state === "archived")
    await database.db.execute(
      sql`insert into expert_onboarding_applications(user_id,archived_at,archive_until_date) values(${expert.userId}::uuid,clock_timestamp(),clock_timestamp()+interval '1 month')`,
    );
  else
    await database.db.execute(
      sql`insert into expert_residency_lifecycle(user_id,expert_id,status,paused_until) values(${expert.userId}::uuid,${expert.id}::uuid,'paused',current_date+1)`,
    );
}

describe("current resident availability on waitlist and reschedule mutations", () => {
  for (const state of ["archived", "paused"] as const) {
    it(`blocks waitlist admission and promotion after the expert is ${state}`, async () => {
      const f = await seedWaitlistFixture(database);
      const candidate = await f.candidate(randomUUID());
      expect(await f.repository.join(candidate)).toMatchObject({
        kind: "joined",
      });
      const later = await f.candidate(randomUUID());
      await hide(f.occupied.slotId, state);
      expect(await f.repository.join(later)).toEqual({ kind: "not_found" });
      await database.db.execute(
        sql`update reservations set status='cancelled_by_client' where id=${f.occupied.reservationId}::uuid`,
      );
      expect(
        await f.repository.promoteNext({
          slotId: f.occupied.slotId,
          now: f.occupied.databaseNow,
          holdDurationMs: 259200000,
        }),
      ).toEqual({ kind: "stale_slot" });
      expect(
        (
          await database.db.execute(
            sql`select status from booking_waitlist_entries where waitlist_handle=${candidate.waitlistHandle}`,
          )
        ).rows[0],
      ).toEqual({ status: "waiting" });
    });
    it(`blocks local reschedule after the target expert is ${state}`, async () => {
      const f = await seedWaitlistFixture(database);
      const handle = `bk1.${randomUUID().replaceAll("-", "").padEnd(43, "R")}`;
      const digest = `sha256:${randomUUID().replaceAll("-", "").padEnd(64, "0")}`;
      await database.db.execute(
        sql`insert into client_booking_receipts(user_id,choice_digest,booking_handle,reservation_id) values(${f.occupied.userId}::uuid,${digest},${handle},${f.occupied.reservationId}::uuid)`,
      );
      const target = (
        await database.db.execute<{ id: string }>(
          sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity) select expert_service_id,'local',${randomUUID()},starts_at+interval '1 day',ends_at+interval '1 day',observed_at,1 from slots where id=${f.occupied.slotId}::uuid returning id`,
        )
      ).rows[0]!.id;
      const request = (
        await database.db.execute<{ id: string }>(
          sql`insert into client_catalog_requests(user_id,request_digest,state,expires_at) values(${f.occupied.userId}::uuid,${randomUUID().replaceAll("-", "").padEnd(64, "0")},'ready',clock_timestamp()+interval '1 hour') returning id`,
        )
      ).rows[0]!.id;
      await database.db.execute(
        sql`insert into client_catalog_choices(request_id,choice_digest,slot_id,expires_at) values(${request}::uuid,${digest},${target}::uuid,clock_timestamp()+interval '1 hour')`,
      );
      await hide(target, state);
      expect(
        await new PostgresBookingRepository(
          database.db,
        ).rescheduleOwnedByHandle({
          userId: f.occupied.userId,
          bookingHandle: handle as `bk1.${string}`,
          choiceDigest: digest as `sha256:${string}`,
          idempotencyKey: randomUUID().replaceAll("-", "").padEnd(64, "0"),
          correlationId: randomUUID(),
          confirmationBufferMs: 3600000,
        }),
      ).toEqual({ kind: "conflict" });
      expect(
        (
          await database.db.execute(
            sql`select slot_id as "slotId",status from reservations where id=${f.occupied.reservationId}::uuid`,
          )
        ).rows[0],
      ).toEqual({ slotId: f.occupied.slotId, status: "booked" });
    });
  }
});
