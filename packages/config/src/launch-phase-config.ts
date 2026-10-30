/** These values are pinned to the wave-one SQL admission policy in migration 0075. */
const ENROLLMENT_START_MS = Date.parse("2026-11-01T00:00:00+03:00");
const CLIENT_START_DATE = "2027-01-11T00:00:00+03:00";
const FINAL_CALL_TRIGGER_DATE = "2026-12-28";

export type LaunchPhase = "WAVE_1_EARLY_BIRD" | "PUBLIC_LAUNCH";
export interface LaunchPhaseConfig {
  readonly configuredPhase: LaunchPhase;
  readonly enrollmentStartMs: number;
  readonly clientStartMs: number;
  readonly promoDeadlineDays: 10;
  readonly finalCallTriggerMs: number;
  /** Identifies the values bound to the SQL policy; do not reuse after a policy change. */
  readonly policyVersion: "wave1-2027-01-11-v1";
}

export function readLaunchPhaseConfig(
  source: NodeJS.ProcessEnv,
): LaunchPhaseConfig {
  const phase = source.LAUNCH_PHASE ?? "PUBLIC_LAUNCH";
  if (
    (phase !== "PUBLIC_LAUNCH" && phase !== "WAVE_1_EARLY_BIRD") ||
    (source.CLIENT_START_DATE ?? CLIENT_START_DATE) !== CLIENT_START_DATE ||
    (source.PROMO_DEADLINE_DAYS ?? "10") !== "10" ||
    (source.FINAL_CALL_TRIGGER_DATE ?? FINAL_CALL_TRIGGER_DATE) !==
      FINAL_CALL_TRIGGER_DATE
  )
    throw new Error("launch_phase_configuration_invalid");
  return Object.freeze({
    configuredPhase: phase,
    enrollmentStartMs: ENROLLMENT_START_MS,
    clientStartMs: Date.parse(CLIENT_START_DATE),
    promoDeadlineDays: 10,
    finalCallTriggerMs: Date.parse(`${FINAL_CALL_TRIGGER_DATE}T10:00:00+03:00`),
    policyVersion: "wave1-2027-01-11-v1",
  });
}

/** The effective phase is computed at use time, so no scheduler must flip a flag. */
export function resolveLaunchPhase(
  config: LaunchPhaseConfig,
  nowMs: number,
): LaunchPhase {
  if (!Number.isSafeInteger(nowMs))
    throw new Error("launch_phase_clock_invalid");
  return config.configuredPhase === "WAVE_1_EARLY_BIRD" &&
    nowMs >= config.enrollmentStartMs &&
    nowMs < config.clientStartMs
    ? "WAVE_1_EARLY_BIRD"
    : "PUBLIC_LAUNCH";
}
