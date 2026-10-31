import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.migrate();
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("admits only the prelaunch wave in Moscow time and uses the real database clock", async () => {
  const result = await fixture.db.execute<{
    before: boolean;
    start: boolean;
    before_end: boolean;
    end: boolean;
    real_clock: boolean;
  }>(
    sql`select early_bird_wave_active('2026-10-31T20:59:59.999Z'::timestamptz) as before, early_bird_wave_active('2026-10-31T21:00:00Z'::timestamptz) as start, early_bird_wave_active('2027-01-10T20:59:59.999Z'::timestamptz) as before_end, early_bird_wave_active('2027-01-10T21:00:00Z'::timestamptz) as end, abs(extract(epoch from (early_bird_current_time()-clock_timestamp())))<5 as real_clock`,
  );
  expect(result.rows[0]).toEqual({
    before: false,
    start: true,
    before_end: true,
    end: false,
    real_clock: true,
  });
}, 120_000);
