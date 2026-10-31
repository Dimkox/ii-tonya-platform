import { describe, expect, it } from "vitest";
import {
  readLaunchPhaseConfig,
  resolveLaunchPhase,
} from "./launch-phase-config.js";

describe("wave one launch configuration", () => {
  it("defaults to public launch and the established, database-compatible dates", () => {
    expect(readLaunchPhaseConfig({})).toEqual({
      configuredPhase: "PUBLIC_LAUNCH",
      enrollmentStartMs: Date.parse("2026-11-01T00:00:00+03:00"),
      clientStartMs: Date.parse("2027-01-11T00:00:00+03:00"),
      promoDeadlineDays: 10,
      finalCallTriggerMs: Date.parse("2026-12-28T10:00:00+03:00"),
      policyVersion: "wave1-2027-01-11-v1",
    });
  });
  it("switches automatically at launch and never exposes the wave before enrollment", () => {
    const config = readLaunchPhaseConfig({ LAUNCH_PHASE: "WAVE_1_EARLY_BIRD" });
    expect(resolveLaunchPhase(config, config.enrollmentStartMs - 1)).toBe(
      "PUBLIC_LAUNCH",
    );
    expect(resolveLaunchPhase(config, config.enrollmentStartMs)).toBe(
      "WAVE_1_EARLY_BIRD",
    );
    expect(resolveLaunchPhase(config, config.clientStartMs - 1)).toBe(
      "WAVE_1_EARLY_BIRD",
    );
    expect(resolveLaunchPhase(config, config.clientStartMs)).toBe(
      "PUBLIC_LAUNCH",
    );
    expect(
      resolveLaunchPhase(readLaunchPhaseConfig({}), config.enrollmentStartMs),
    ).toBe("PUBLIC_LAUNCH");
  });
  it.each([
    { LAUNCH_PHASE: "on" },
    { CLIENT_START_DATE: "2027-01-12T00:00:00+03:00" },
    { PROMO_DEADLINE_DAYS: "11" },
    { FINAL_CALL_TRIGGER_DATE: "2026-12-29" },
    { CLIENT_START_DATE: "2027-01-11" },
  ])("rejects values that disagree with database policy: %o", (source) => {
    expect(() => readLaunchPhaseConfig(source)).toThrow(
      "launch_phase_configuration_invalid",
    );
  });
  it("rejects a non-finite clock", () => {
    expect(() => resolveLaunchPhase(readLaunchPhaseConfig({}), NaN)).toThrow(
      "launch_phase_clock_invalid",
    );
  });
});
