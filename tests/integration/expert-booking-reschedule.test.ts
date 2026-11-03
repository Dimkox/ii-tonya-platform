import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import { PostgresWorkerJobsRepository } from "../../packages/db/src/repositories/worker-jobs-repository.js";
import { seedLifecycleFixture } from "./lifecycle-scheduler.fixture.js";

// SCRUM-64 🔄: перенос брони экспертом и идемпотентное истечение 72 ч.
describe("expert booking reschedule (SCRUM-64)", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
  }, 120_000);
  afterAll(async () => {
    if (database !== undefined) await database.stop();
  }, 120_000);

  const seed = async () => {
    const fixture = await seedLifecycleFixture(database);
    const owner = (
      await database.db.execute<{ expertId: string; serviceId: string }>(sql`
        select expert_id as "expertId", expert_service_id as "serviceId"
        from reservations where id=${fixture.reservationId}::uuid
      `)
    ).rows[0]!;
    const targetStarts = new Date(
      fixture.databaseNow.getTime() + 120 * 60 * 60 * 1_000,
    );
    const targetSlotId = (
      await database.db.execute<{ id: string }>(sql`
        insert into slots(
          expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity
        ) values(
          ${owner.serviceId}::uuid,'local',${`resched-${randomUUID()}`},${targetStarts},
          ${new Date(targetStarts.getTime() + 60 * 60 * 1_000)},
          ${fixture.databaseNow},1
        ) returning id
      `)
    ).rows[0]!.id;
    const repository = new PostgresBookingRepository(database.db, {
      retryDelayMs: () => 0,
    });
    return { ...fixture, ...owner, targetSlotId, repository };
  };

  const snapshot = async (reservationId: string) =>
    (
      await database.db.execute<{ status: string; version: number }>(sql`
        select status, version from reservations where id=${reservationId}::uuid
      `)
    ).rows[0];

  it("rejects a foreign expert before any change", async () => {
    const s = await seed();
    const otherUser = await database.createUser();
    const foreignExpertId = (
      await database.db.execute<{ id: string }>(sql`
        insert into experts(user_id,public_display_name,active,verified)
        values(${otherUser}::uuid,'Foreign',true,true) returning id
      `)
    ).rows[0]!.id;
    const before = await snapshot(s.reservationId);
    await expect(
      s.repository.listExpertRescheduleSlots({
        expertId: foreignExpertId,
        reservationId: s.reservationId,
        limit: 5,
      }),
    ).resolves.toEqual([]);
    await expect(
      s.repository.rescheduleByExpert({
        expertId: foreignExpertId,
        reservationId: s.reservationId,
        targetSlotId: s.targetSlotId,
        idempotencyKey: "telegram:1:reschedule",
        correlationId: "foreign",
      }),
    ).resolves.toEqual({ kind: "forbidden" });
    expect(await snapshot(s.reservationId)).toEqual(before);
    const created = await database.db.execute(sql`
      select 1 from reservations where slot_id=${s.targetSlotId}::uuid
    `);
    expect(created.rows).toHaveLength(0);
  });

  it("cancels the old booking and creates a new 72h Reserved, idempotently", async () => {
    const s = await seed();
    const choices = await s.repository.listExpertRescheduleSlots({
      expertId: s.expertId,
      reservationId: s.reservationId,
      limit: 5,
    });
    expect(choices.map((choice) => choice.slotId)).toContain(s.targetSlotId);
    const command = {
      expertId: s.expertId,
      reservationId: s.reservationId,
      targetSlotId: s.targetSlotId,
      idempotencyKey: "telegram:2:reschedule",
      correlationId: "expert-reschedule-ok",
    };
    const first = await s.repository.rescheduleByExpert(command);
    expect(first).toMatchObject({ kind: "rescheduled" });
    if (!("reservedUntil" in first)) throw new Error("unreachable");
    expect((await snapshot(s.reservationId))?.status).toBe(
      "cancelled_by_expert",
    );
    const fresh = (
      await database.db.execute<{
        status: string;
        userId: string;
        holdMs: string;
      }>(sql`
        select status, user_id as "userId",
          (extract(epoch from reserved_until - created_at) * 1000)::bigint::text as "holdMs"
        from reservations where id=${first.reservationId}::uuid
      `)
    ).rows[0]!;
    expect(fresh.status).toBe("reserved");
    expect(fresh.userId).toBe(s.userId);
    expect(Math.abs(Number(fresh.holdMs) - 72 * 60 * 60 * 1_000)).toBeLessThan(
      5_000,
    );
    await expect(
      s.repository.rescheduleByExpert({
        ...command,
        idempotencyKey: "telegram:3:reschedule",
      }),
    ).resolves.toEqual({
      kind: "replayed",
      reservationId: first.reservationId,
      reservedUntil: first.reservedUntil,
    });
    const active = await database.db.execute(sql`
      select 1 from reservations where user_id=${s.userId}::uuid
        and status in ('reserved','booked')
    `);
    expect(active.rows).toHaveLength(1);
  });

  it("rolls back the cancel when the target slot is taken", async () => {
    const s = await seed();
    const otherClient = await database.createUser();
    await database.db.execute(sql`
      insert into reservations(
        user_id,slot_id,expert_id,expert_service_id,status,idempotency_key,reserved_until
      ) values(
        ${otherClient}::uuid,${s.targetSlotId}::uuid,${s.expertId}::uuid,
        ${s.serviceId}::uuid,'reserved',${`taken-${randomUUID()}`},
        clock_timestamp() + interval '1 hour'
      )
    `);
    const before = await snapshot(s.reservationId);
    await expect(
      s.repository.rescheduleByExpert({
        expertId: s.expertId,
        reservationId: s.reservationId,
        targetSlotId: s.targetSlotId,
        idempotencyKey: "telegram:4:reschedule",
        correlationId: "expert-reschedule-taken",
      }),
    ).resolves.toEqual({ kind: "conflict" });
    expect(await snapshot(s.reservationId)).toEqual(before);
  });

  it("repeated 72h expiry leaves no active Reserved and no duplicate notices", async () => {
    const s = await seed();
    await database.db.execute(sql`
      update reservations
      set status='reserved',created_at=clock_timestamp() - interval '72 hours 1 second',
        reserved_until=clock_timestamp() - interval '1 second'
      where id=${s.reservationId}::uuid
    `);
    const jobs = new PostgresWorkerJobsRepository(database.db);
    await jobs.expireDueBatch({ now: new Date(0), batchSize: 100 });
    await jobs.expireDueBatch({ now: new Date(0), batchSize: 100 });
    expect((await snapshot(s.reservationId))?.status).toBe("expired");
    const notices = await database.db.execute<{ topic: string; n: string }>(sql`
      select topic, count(*)::text as n from integration_outbox
      where payload->>'reservationId'=${s.reservationId}
      group by topic
    `);
    expect(notices.rows.length).toBeGreaterThan(0);
    for (const row of notices.rows) expect(row.n).toBe("1");
  });
});
