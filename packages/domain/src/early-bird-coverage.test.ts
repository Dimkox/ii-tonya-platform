import { describe, expect, it } from "vitest";
import { calculateEarlyBirdCoverage } from "./early-bird-coverage.js";

const launch = Date.parse("2027-01-11T00:00:00+03:00");
const day = 86_400_000;

describe("early bird paid coverage", () => {
  it("starts a verified pre-launch payment at launch, preserving its full duration", () => {
    expect(
      calculateEarlyBirdCoverage({
        settledAtMs: launch - day,
        launchAtMs: launch,
        durationSeconds: 30 * 86400,
        previousEndMs: null,
      }),
    ).toEqual({ startsAtMs: launch, endsAtMs: launch + 30 * day });
  });
  it("uses the actual payment date after launch", () => {
    expect(
      calculateEarlyBirdCoverage({
        settledAtMs: launch + day,
        launchAtMs: launch,
        durationSeconds: 30 * 86400,
        previousEndMs: null,
      }),
    ).toEqual({ startsAtMs: launch + day, endsAtMs: launch + 31 * day });
  });
  it("never overlaps an existing paid interval ending after launch", () => {
    expect(
      calculateEarlyBirdCoverage({
        settledAtMs: launch - day,
        launchAtMs: launch,
        durationSeconds: 30 * 86400,
        previousEndMs: launch + 3 * day,
      }),
    ).toEqual({ startsAtMs: launch + 3 * day, endsAtMs: launch + 33 * day });
  });
  it("rejects invalid durations, invalid clocks and arithmetic overflow", () => {
    const good = {
      settledAtMs: launch,
      launchAtMs: launch,
      durationSeconds: 30 * 86400,
      previousEndMs: null,
    };
    for (const bad of [
      { ...good, durationSeconds: 0 },
      { ...good, settledAtMs: NaN },
      { ...good, previousEndMs: -1 },
      { ...good, settledAtMs: 8640000000000000 },
    ])
      expect(() => calculateEarlyBirdCoverage(bad)).toThrow();
  });
});
