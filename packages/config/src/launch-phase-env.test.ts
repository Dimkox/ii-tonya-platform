import { expect, it } from "vitest";
import { loadEnv } from "./env.js";
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
it("loads the fail-closed launch settings and validates SQL-compatible dates", () => {
  expect(loadEnv(base).launchPhase?.configuredPhase).toBe("PUBLIC_LAUNCH");
  expect(
    loadEnv({
      ...base,
      LAUNCH_PHASE: "WAVE_1_EARLY_BIRD",
      CLIENT_START_DATE: "2027-01-11T00:00:00+03:00",
      PROMO_DEADLINE_DAYS: "10",
      FINAL_CALL_TRIGGER_DATE: "2026-12-28",
    }).launchPhase?.configuredPhase,
  ).toBe("WAVE_1_EARLY_BIRD");
  expect(() =>
    loadEnv({ ...base, CLIENT_START_DATE: "2027-02-01T00:00:00+03:00" }),
  ).toThrow("launch_phase_configuration_invalid");
});
