import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import { PostgresWorkerJobsRepository } from "../../packages/db/src/repositories/worker-jobs-repository.js";
import { seedWaitlistFixture } from "./booking-waitlist.fixture.js";

describe("booking waitlist lifecycle D1", () => {
  let database: TestDatabase;
  let fixture: Awaited<ReturnType<typeof seedWaitlistFixture>>;

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    fixture = await seedWaitlistFixture(database);
  }, 120_000);
  afterAll(async () => {
    if (database !== undefined) await database.stop();
  }, 120_000);

  it("joins idempotently, reports FIFO position, and leaves without deleting audit", async () => {
    const first = await fixture.candidate("first");
    await expect(fixture.repository.join(first)).resolves.toMatchObject({
      kind: "joined",
      position: 1,
    });
    await expect(fixture.repository.join(first)).resolves.toMatchObject({
      kind: "replayed",
      position: 1,
    });
    const second = await fixture.candidate("second");
    await expect(fixture.repository.join(second)).resolves.toMatchObject({
      kind: "joined",
      position: 2,
    });
    await expect(
      fixture.repository.leave({
        userId: second.userId,
        waitlistHandle: second.waitlistHandle,
        idempotencyKey: "f".repeat(64),
        correlationId: "leave-second",
      }),
    ).resolves.toEqual({ kind: "left" });
    await expect(
      fixture.repository.leave({
        userId: second.userId,
        waitlistHandle: second.waitlistHandle,
        idempotencyKey: "f".repeat(64),
        correlationId: "leave-second",
      }),
    ).resolves.toEqual({ kind: "replayed" });
    await expect(fixture.repository.join(second)).resolves.toMatchObject({
      kind: "replayed",
      waitlistHandle: second.waitlistHandle,
      position: 2,
    });
    const rows = await database.db.execute<{ status: string }>(sql`
      select status from booking_waitlist_entries
      where waitlist_handle=${second.waitlistHandle}
    `);
    expect(rows.rows[0]?.status).toBe("cancelled");
  });

  it("reschedules only the owner, cancels old lifecycle jobs, and replays one fact", async () => {
    await fixture.occupied.repository.scheduleReservationLifecycle(
      fixture.occupied.reservationId,
    );
    const bookingHandle = `bk1.${"R".repeat(43)}` as const;
    await database.db.execute(sql`
      insert into client_booking_receipts(
        user_id,choice_digest,booking_handle,reservation_id
      ) values(
        ${fixture.occupied.userId}::uuid,
        ${`sha256:${"1".repeat(64)}`},${bookingHandle},
        ${fixture.occupied.reservationId}::uuid
      )
    `);
    const source = (
      await database.db.execute<{ serviceId: string }>(sql`
        select expert_service_id as "serviceId" from slots
        where id=${fixture.occupied.slotId}::uuid
      `)
    ).rows[0]!;
    const targetStarts = new Date(
      fixture.occupied.databaseNow.getTime() + 120 * 60 * 60 * 1_000,
    );
    const targetSlotId = (
      await database.db.execute<{ id: string }>(sql`
        insert into slots(
          expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity
        ) values(
          ${source.serviceId}::uuid,'local','reschedule-target',${targetStarts},
          ${new Date(targetStarts.getTime() + 60 * 60 * 1_000)},
          ${fixture.occupied.databaseNow},1
        ) returning id
      `)
    ).rows[0]!.id;
    const choiceHandle = `ch1.${"T".repeat(43)}`;
    const choiceDigest = `sha256:${createHash("sha256")
      .update(choiceHandle)
      .digest("hex")}` as const;
    const requestId = (
      await database.db.execute<{ id: string }>(sql`
        insert into client_catalog_requests(user_id,request_digest,state,expires_at)
        values(
          ${fixture.occupied.userId}::uuid,${"2".repeat(64)},'ready',
          ${new Date(fixture.occupied.databaseNow.getTime() + 60 * 60 * 1_000)}
        ) returning id
      `)
    ).rows[0]!.id;
    await database.db.execute(sql`
      insert into client_catalog_choices(request_id,choice_digest,slot_id,expires_at)
      values(
        ${requestId}::uuid,${choiceDigest},${targetSlotId}::uuid,
        ${new Date(fixture.occupied.databaseNow.getTime() + 60 * 60 * 1_000)}
      )
    `);
    const repository = new PostgresBookingRepository(database.db, {
      retryDelayMs: () => 0,
    });
    const command = {
      userId: fixture.occupied.userId,
      bookingHandle,
      choiceDigest,
      idempotencyKey: "3".repeat(64),
      correlationId: "reschedule-d1",
      confirmationBufferMs: 259_200_000,
    };
    const firstResult = await repository.rescheduleOwnedByHandle(command);
    expect(firstResult).toMatchObject({
      kind: "rescheduled",
      reservationStatus: "reserved",
    });
    await database.db.execute(sql`
      update reservations set status='booked'
      where id=${fixture.occupied.reservationId}::uuid
    `);
    await expect(repository.rescheduleOwnedByHandle(command)).resolves.toEqual({
      kind: "replayed",
      reservationStatus: firstResult.reservationStatus,
      reservedUntil: firstResult.reservedUntil,
    });
    const facts = await database.db.execute<{
      slotId: string;
      status: string;
      version: number;
      cancelledJobs: string;
      facts: string;
      effects: string;
    }>(sql`
      select r.slot_id as "slotId",r.status,r.version,
        (select count(*)::text from lifecycle_jobs where
          subject_id=r.id and status='cancelled') as "cancelledJobs",
        (select count(*)::text from booking_reschedule_facts where
          reservation_id=r.id) facts,
        (select count(*)::text from integration_outbox where
          correlation_id='reschedule-d1') effects
      from reservations r where r.id=${fixture.occupied.reservationId}::uuid
    `);
    expect(facts.rows[0]).toMatchObject({
      slotId: targetSlotId,
      status: "booked",
      version: 2,
      cancelledJobs: "3",
      facts: "1",
      effects: "2",
    });
  });

  it("persists a stable waitlist promotion command in the expiry transaction", async () => {
    await database.db.execute(sql`
      update reservations
      set status='reserved',created_at=clock_timestamp() - interval '2 seconds',
        reserved_until=clock_timestamp() - interval '1 second'
      where id=${fixture.occupied.reservationId}::uuid
    `);
    const jobs = new PostgresWorkerJobsRepository(database.db);
    await expect(
      jobs.expireDueBatch({ now: new Date(0), batchSize: 10 }),
    ).resolves.toEqual({ examined: 1, changed: 1, failed: 0 });
    const command = await database.db.execute<{
      topic: string;
      slotId: string;
      reservationId: string;
    }>(sql`
      select topic,payload->>'slotId' as "slotId",
        payload->>'reservationId' as "reservationId"
      from integration_outbox
      where topic='waitlist.promote.v1'
        and payload->>'reservationId'=${fixture.occupied.reservationId}
    `);
    expect(command.rows).toEqual([
      {
        topic: "waitlist.promote.v1",
        slotId: expect.any(String),
        reservationId: fixture.occupied.reservationId,
      },
    ]);
  });
});

describe("booking waitlist leave idempotency", () => {
  it("conflicts when one leave key is reused for another owned handle", async () => {
    const database = await startTestPostgres();
    try {
      await database.migrate();
      const firstSlot = await seedWaitlistFixture(database);
      const first = await firstSlot.candidate("leave-key-first");
      const source = (
        await database.db.execute<{ expertId: string; serviceId: string }>(sql`
          select es.expert_id as "expertId",s.expert_service_id as "serviceId"
          from slots s join expert_services es on es.id=s.expert_service_id
          where s.id=${firstSlot.occupied.slotId}::uuid
        `)
      ).rows[0]!;
      const secondStartsAt = new Date(
        firstSlot.occupied.databaseNow.getTime() + 96 * 60 * 60 * 1_000,
      );
      const secondSlotId = (
        await database.db.execute<{ id: string }>(sql`
          insert into slots(
            expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity
          ) values(
            ${source.serviceId}::uuid,'local','leave-key-second-slot',${secondStartsAt},
            ${new Date(secondStartsAt.getTime() + 60 * 60 * 1_000)},
            ${firstSlot.occupied.databaseNow},1
          ) returning id
        `)
      ).rows[0]!.id;
      const occupyingUserId = await database.createUser();
      await database.db.execute(sql`
        insert into reservations(
          user_id,slot_id,expert_id,expert_service_id,status,idempotency_key,reserved_until
        ) values(
          ${occupyingUserId}::uuid,${secondSlotId}::uuid,${source.expertId}::uuid,
          ${source.serviceId}::uuid,'booked','leave-key-second-occupancy',
          ${new Date(firstSlot.occupied.databaseNow.getTime() + 60 * 60 * 1_000)}
        )
      `);
      const secondChoiceDigest = `sha256:${createHash("sha256")
        .update("choice-leave-key-second")
        .digest("hex")}` as const;
      const secondRequestId = (
        await database.db.execute<{ id: string }>(sql`
          insert into client_catalog_requests(user_id,request_digest,state,expires_at)
          values(
            ${first.userId}::uuid,${createHash("sha256").update("request-leave-key-second").digest("hex")},
            'ready',${new Date(firstSlot.occupied.databaseNow.getTime() + 60 * 60 * 1_000)}
          ) returning id
        `)
      ).rows[0]!.id;
      await database.db.execute(sql`
        insert into client_catalog_choices(request_id,choice_digest,slot_id,expires_at)
        values(
          ${secondRequestId}::uuid,${secondChoiceDigest},${secondSlotId}::uuid,
          ${new Date(firstSlot.occupied.databaseNow.getTime() + 60 * 60 * 1_000)}
        )
      `);
      const second = {
        ...first,
        choiceDigest: secondChoiceDigest,
        idempotencyKey: createHash("sha256")
          .update("join-leave-key-second")
          .digest("hex"),
        waitlistHandle: `wl1.${Buffer.from("leave-key-second".padEnd(32, "x"))
          .toString("base64url")
          .slice(0, 43)
          .padEnd(43, "A")}` as const,
        correlationId: "join-leave-key-second",
      };
      await expect(firstSlot.repository.join(first)).resolves.toMatchObject({
        kind: "joined",
      });
      await expect(firstSlot.repository.join(second)).resolves.toMatchObject({
        kind: "joined",
      });
      const leaveKey = "e".repeat(64);
      const leaveFirst = {
        userId: first.userId,
        waitlistHandle: first.waitlistHandle,
        idempotencyKey: leaveKey,
        correlationId: "leave-key-first",
      };

      await expect(firstSlot.repository.leave(leaveFirst)).resolves.toEqual({
        kind: "left",
      });
      await expect(
        firstSlot.repository.leave({
          ...leaveFirst,
          waitlistHandle: second.waitlistHandle,
          correlationId: "leave-key-second",
        }),
      ).resolves.toEqual({ kind: "conflict" });
      await expect(firstSlot.repository.leave(leaveFirst)).resolves.toEqual({
        kind: "replayed",
      });
      const state = await database.db.execute<{
        waitlistHandle: string;
        status: string;
      }>(sql`
        select waitlist_handle as "waitlistHandle",status
        from booking_waitlist_entries
        where waitlist_handle in (${first.waitlistHandle},${second.waitlistHandle})
        order by waitlist_handle
      `);
      expect(state.rows).toEqual(
        expect.arrayContaining([
          { waitlistHandle: first.waitlistHandle, status: "cancelled" },
          { waitlistHandle: second.waitlistHandle, status: "waiting" },
        ]),
      );
    } finally {
      await database.stop();
    }
  }, 120_000);
});
