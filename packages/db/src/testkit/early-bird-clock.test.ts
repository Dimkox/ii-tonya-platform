import { describe, expect, it } from "vitest";
import {
  EARLY_BIRD_TEST_ANCHOR,
  earlyBirdLaunchPeriodClockBody,
  earlyBirdLaunchPeriodOffsetMs,
} from "./early-bird-clock.js";

const waveActive = (ms: number) =>
  ms >= Date.parse("2026-10-31T21:00:00Z") &&
  ms < Date.parse("2027-01-10T21:00:00Z");
const finalCall = Date.parse("2026-12-28T07:00:00Z");

describe("early-bird launch-period test clock (SCRUM-515)", () => {
  it("uses the real clock inside the safe pre-final-call window", () => {
    expect(
      earlyBirdLaunchPeriodOffsetMs(Date.parse("2026-11-04T12:00:00Z")),
    ).toBe(0);
    expect(
      earlyBirdLaunchPeriodClockBody(Date.parse("2026-12-19T23:59:59Z")),
    ).toBe("select clock_timestamp()");
  });

  it.each([
    "2026-10-01T00:00:00Z",
    "2026-12-20T00:00:00Z",
    "2026-12-28T07:00:00Z",
    "2027-01-10T20:59:59.999Z",
    "2027-01-10T21:00:00Z",
    "2027-06-01T00:00:00Z",
    "2030-01-01T00:00:00Z",
  ])("maps %s onto an in-wave pre-final-call time", (iso) => {
    const now = Date.parse(iso);
    const shifted = now + earlyBirdLaunchPeriodOffsetMs(now);
    expect(shifted).toBe(EARLY_BIRD_TEST_ANCHOR);
    expect(waveActive(shifted)).toBe(true);
    expect(shifted).toBeLessThan(finalCall);
    expect(earlyBirdLaunchPeriodClockBody(now)).toMatch(
      /^select clock_timestamp\(\) \+ interval '-?\d+ milliseconds'$/u,
    );
  });

  it("rejects a non-finite clock", () => {
    expect(() => earlyBirdLaunchPeriodOffsetMs(Number.NaN)).toThrow(
      "early_bird_test_clock_invalid",
    );
  });
});
