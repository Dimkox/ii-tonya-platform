/** Arithmetic only: callers must verify and atomically persist the payment. */
export function calculateEarlyBirdCoverage(input: {
  settledAtMs: number;
  launchAtMs: number;
  durationSeconds: number;
  previousEndMs: number | null;
}): { startsAtMs: number; endsAtMs: number } {
  const maxDate = 8640000000000000;
  const validTime = (value: number) =>
    Number.isSafeInteger(value) && value >= 0 && value <= maxDate;
  if (
    !input ||
    !validTime(input.settledAtMs) ||
    !validTime(input.launchAtMs) ||
    (input.previousEndMs !== null && !validTime(input.previousEndMs)) ||
    !Number.isSafeInteger(input.durationSeconds) ||
    input.durationSeconds <= 0
  )
    throw new Error("early_bird_coverage_invalid");
  const startsAtMs = Math.max(
    input.settledAtMs,
    input.launchAtMs,
    input.previousEndMs ?? 0,
  );
  const endsAtMs = startsAtMs + input.durationSeconds * 1000;
  if (!validTime(endsAtMs)) throw new Error("early_bird_coverage_invalid");
  return Object.freeze({ startsAtMs, endsAtMs });
}
