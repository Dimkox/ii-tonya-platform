import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { seedWaitlistFixture } from "./booking-waitlist.fixture.js";

describe("booking waitlist concurrent FIFO promotion", () => {
  let database: TestDatabase;
  let fixture: Awaited<ReturnType<typeof seedWaitlistFixture>>;

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    fixture = await seedWaitlistFixture(database);
    const first = await fixture.candidate("fifo-first");
    const second = await fixture.candidate("fifo-second");
    await fixture.repository.join(first);
    await fixture.repository.join(second);
    await database.db.execute(sql`
      update reservations set status='cancelled_by_client'
      where id=${fixture.occupied.reservationId}::uuid
    `);
    await database.db.execute(sql`
      update slots set starts_at=${new Date(
        fixture.occupied.databaseNow.getTime() + 96 * 60 * 60 * 1_000,
      )},observed_at=${fixture.occupied.databaseNow}
      where id=${fixture.occupied.slotId}::uuid
    `);
  }, 120_000);
  afterAll(async () => {
    if (database !== undefined) await database.stop();
  }, 120_000);

  it("creates exactly one 72-hour hold across competing promoters", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        fixture.repository.promoteNext({
          slotId: fixture.occupied.slotId,
          now: fixture.occupied.databaseNow,
          holdDurationMs: 259_200_000,
        }),
      ),
    );
    expect(results.filter((result) => result.kind === "promoted")).toHaveLength(
      1,
    );
    const facts = await database.db.execute<{
      promoted: string;
      active: string;
      holdSeconds: string;
    }>(sql`
      select
        (select count(*)::text from booking_waitlist_entries where status='promoted') promoted,
        (select count(*)::text from reservations where slot_id=${fixture.occupied.slotId}::uuid
          and status in ('reserved','booked')) active,
        (select extract(epoch from (promotion_hold_until-updated_at))::text
          from booking_waitlist_entries where status='promoted' limit 1) as "holdSeconds"
    `);
    expect(facts.rows[0]).toEqual({
      promoted: "1",
      active: "1",
      holdSeconds: "259200.000000",
    });
  });
});
