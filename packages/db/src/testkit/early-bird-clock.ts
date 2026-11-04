import { sql, type SQL } from "drizzle-orm";

// SCRUM-515: early-bird SQL is pinned to wave 1 (2026-10-31 21:00Z .. 2027-01-10 21:00Z,
// final call at 2026-12-28 07:00Z). Disposable test databases must keep running the real
// phase logic after those dates, so tests use a launch-period clock: the real clock while
// it is safely inside the pre-final-call part of the wave, otherwise the real clock shifted
// onto a fixed in-wave anchor (still advancing in real time).
export const EARLY_BIRD_TEST_SAFE_FROM = Date.parse("2026-11-01T00:00:00.000Z");
export const EARLY_BIRD_TEST_SAFE_UNTIL = Date.parse(
  "2026-12-20T00:00:00.000Z",
);
export const EARLY_BIRD_TEST_ANCHOR = Date.parse("2026-11-15T09:00:00.000Z");

export const earlyBirdLaunchPeriodOffsetMs = (nowMs: number): number => {
  if (!Number.isFinite(nowMs)) throw new Error("early_bird_test_clock_invalid");
  return nowMs >= EARLY_BIRD_TEST_SAFE_FROM &&
    nowMs < EARLY_BIRD_TEST_SAFE_UNTIL
    ? 0
    : Math.trunc(EARLY_BIRD_TEST_ANCHOR - nowMs);
};

export const earlyBirdLaunchPeriodClockBody = (nowMs = Date.now()): string => {
  const offset = earlyBirdLaunchPeriodOffsetMs(nowMs);
  return offset === 0
    ? "select clock_timestamp()"
    : `select clock_timestamp() + interval '${offset} milliseconds'`;
};

/** `create or replace function early_bird_current_time()` on a disposable test database. */
export const earlyBirdLaunchPeriodClock = (nowMs = Date.now()): SQL =>
  sql.raw(
    `create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ ${earlyBirdLaunchPeriodClockBody(nowMs)} $$`,
  );
