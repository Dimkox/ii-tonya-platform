/** Scheduling policy only; callers must atomically persist and recheck decisions. */
export type FinalCallAttempt = {
  status: "none" | "pending" | "uncertain" | "delivered";
  deliveredAtMs?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Round the first eligibility instant to the configured daily campaign tick. */
export function nextFinalCallTick(
  triggerAtMs: number,
  eligibleAtMs: number,
  clientStartAtMs: number,
): number | null {
  if (
    ![triggerAtMs, eligibleAtMs, clientStartAtMs].every(Number.isSafeInteger) ||
    triggerAtMs >= clientStartAtMs
  )
    return null;
  const days = Math.max(0, Math.ceil((eligibleAtMs - triggerAtMs) / DAY_MS));
  const tick = triggerAtMs + days * DAY_MS;
  return Number.isSafeInteger(tick) && tick < clientStartAtMs ? tick : null;
}

export function decideFinalCall(input: {
  nowMs: number;
  triggerAtMs: number;
  clientStartAtMs: number;
  paymentStatus: string;
  verified: boolean;
  messagingConsent: boolean;
  first: FinalCallAttempt;
  repeat: FinalCallAttempt;
}): "first" | "repeat" | null {
  if (
    !Number.isSafeInteger(input.nowMs) ||
    !Number.isSafeInteger(input.triggerAtMs) ||
    !Number.isSafeInteger(input.clientStartAtMs) ||
    input.triggerAtMs >= input.clientStartAtMs ||
    input.nowMs < input.triggerAtMs ||
    input.nowMs >= input.clientStartAtMs ||
    input.paymentStatus !== "ONBOARDING_ONLY" ||
    input.verified !== true ||
    input.messagingConsent !== true
  )
    return null;

  if (input.first.status === "none")
    return input.repeat.status === "none" ? "first" : null;
  if (input.first.status !== "delivered" || input.repeat.status !== "none")
    return null;
  const firstDelivered = input.first.deliveredAtMs;
  if (
    !Number.isSafeInteger(firstDelivered) ||
    firstDelivered! < input.triggerAtMs ||
    firstDelivered! > input.nowMs
  )
    return null;
  const earliest = firstDelivered! + 3 * DAY_MS;
  const nextTick = nextFinalCallTick(
    input.triggerAtMs,
    earliest,
    input.clientStartAtMs,
  );
  return nextTick !== null && input.nowMs >= nextTick ? "repeat" : null;
}
