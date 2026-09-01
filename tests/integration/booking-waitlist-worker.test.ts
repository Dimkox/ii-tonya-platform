import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresWorkerJobsRepository } from "../../packages/db/src/repositories/worker-jobs-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { seedWaitlistFixture } from "./booking-waitlist.fixture.js";

describe("booking waitlist promotion worker", () => {
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

  it("consumes the expiry command and gives the promoted client a protected booking handle", async () => {
    const candidate = await fixture.candidate("worker-promote");
    await expect(fixture.repository.join(candidate)).resolves.toMatchObject({
      kind: "joined",
    });
    await database.db.execute(sql`
      update slots set starts_at=clock_timestamp()+interval '96 hours',
        observed_at=clock_timestamp()
      where id=${fixture.occupied.slotId}::uuid
    `);
    await database.db.execute(sql`
      update reservations set status='reserved',
        created_at=clock_timestamp()-interval '2 seconds',
        reserved_until=clock_timestamp()-interval '1 second'
      where id=${fixture.occupied.reservationId}::uuid
    `);
    await new PostgresWorkerJobsRepository(database.db).expireDueBatch({
      now: new Date(0),
      batchSize: 10,
    });

    await expect(
      fixture.repository.processPromotionCommandsBatch(10),
    ).resolves.toEqual({ examined: 1, promoted: 1, completed: 1 });

    const state = await database.db.execute<{
      outboxStatus: string;
      bookingHandle: string;
      reservationId: string;
      waitlistStatus: string;
    }>(sql`
      select o.status as "outboxStatus",b.booking_handle as "bookingHandle",
        b.reservation_id as "reservationId",w.status as "waitlistStatus"
      from integration_outbox o
      join booking_waitlist_entries w on w.slot_id=(o.payload->>'slotId')::uuid
        and w.status='promoted'
      join client_booking_receipts b on b.reservation_id=w.promoted_reservation_id
      where o.topic='waitlist.promote.v1'
    `);
    expect(state.rows).toEqual([
      {
        outboxStatus: "succeeded",
        bookingHandle: expect.stringMatching(/^bk1\.[A-Za-z0-9_-]{43}$/u),
        reservationId: expect.any(String),
        waitlistStatus: "promoted",
      },
    ]);
  });
});
