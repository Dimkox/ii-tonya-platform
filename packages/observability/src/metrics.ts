import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("ii-tonya");

export const operationalMetrics = {
  inboxDuplicates: meter.createCounter("ii_tonya_inbox_duplicates"),
  debitOutcomes: meter.createCounter("ii_tonya_debit_outcomes"),
  reservationTransitions: meter.createCounter("ii_tonya_reservation_transitions"),
  outboxUnknownOutcomes: meter.createCounter("ii_tonya_outbox_unknown_outcomes"),
  outboxLagMs: meter.createHistogram("ii_tonya_outbox_lag_ms"),
  outboxDeadLetters: meter.createCounter("ii_tonya_outbox_dead_letters"),
  providerCircuitState: meter.createUpDownCounter("ii_tonya_provider_circuit_state"),
  safetyHandoffs: meter.createCounter("ii_tonya_safety_handoffs"),
  reconciliationDrift: meter.createCounter("ii_tonya_reconciliation_drift"),
  expertReferralCodeLifecycle: meter.createCounter(
    "ii_tonya_expert_referral_code_lifecycle",
  ),
  expertReferralRedemption: meter.createCounter(
    "ii_tonya_expert_referral_redemption",
  ),
  expertReferralRewardOutcome: meter.createCounter(
    "ii_tonya_expert_referral_reward_outcome",
  ),
  expertResidencyCreditSpend: meter.createCounter(
    "ii_tonya_expert_residency_credit_spend",
  ),
  expertResidencyCreditExpiry: meter.createCounter(
    "ii_tonya_expert_residency_credit_expiry",
  ),
  expertReferralDebt: meter.createCounter("ii_tonya_expert_referral_debt"),
  expertReferralDuplicateEvents: meter.createCounter(
    "ii_tonya_expert_referral_duplicate_events",
  ),
  expertReferralHeldReplay: meter.createCounter(
    "ii_tonya_expert_referral_held_replay",
  ),
  expertResidencyRefundReversal: meter.createCounter(
    "ii_tonya_expert_residency_refund_reversal",
  ),
  expertResidencyReconciliationMismatch: meter.createCounter(
    "ii_tonya_expert_residency_reconciliation_mismatch",
  ),
  expertResidencyJobDurationMs: meter.createHistogram(
    "ii_tonya_expert_residency_job_duration_ms",
  ),
} as const;

export type MetricLabels = Readonly<{
  module: string;
  operation: string;
  outcome: string;
  errorCode?: string;
}>;

const referralModules = new Set(["expert_referral", "expert_residency"]);
const referralOperations = new Set([
  "code_lifecycle",
  "redemption",
  "reward",
  "credit_spend",
  "credit_expiry",
  "debt",
  "duplicate_event",
  "held_replay",
  "refund",
  "reversal",
  "reconciliation",
  "residency_expiry",
]);
const referralOutcomes = new Set([
  "success",
  "rejected",
  "duplicate",
  "held",
  "granted",
  "cancelled",
  "expired",
  "mismatch",
  "disabled",
  "failed",
  "no_op",
]);
const referralErrorCodes = new Set([
  "invalid_input",
  "database_error",
  "provider_disabled",
  "provider_unavailable",
  "state_mismatch",
  "duplicate_event",
  "unknown",
]);

export type ExpertReferralMetricLabels = Readonly<{
  module: "expert_referral" | "expert_residency";
  operation:
    | "code_lifecycle"
    | "redemption"
    | "reward"
    | "credit_spend"
    | "credit_expiry"
    | "debt"
    | "duplicate_event"
    | "held_replay"
    | "refund"
    | "reversal"
    | "reconciliation"
    | "residency_expiry";
  outcome:
    | "success"
    | "rejected"
    | "duplicate"
    | "held"
    | "granted"
    | "cancelled"
    | "expired"
    | "mismatch"
    | "disabled"
    | "failed"
    | "no_op";
  errorCode?:
    | "invalid_input"
    | "database_error"
    | "provider_disabled"
    | "provider_unavailable"
    | "state_mismatch"
    | "duplicate_event"
    | "unknown";
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function referralMetricLabels(value: unknown): ExpertReferralMetricLabels {
  if (!isRecord(value)) throw new Error("invalid_referral_metric_labels");
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        key !== "module" &&
        key !== "operation" &&
        key !== "outcome" &&
        key !== "errorCode",
    ) ||
    keys.length < 3 ||
    keys.length > 4 ||
    typeof value.module !== "string" ||
    !referralModules.has(value.module) ||
    typeof value.operation !== "string" ||
    !referralOperations.has(value.operation) ||
    typeof value.outcome !== "string" ||
    !referralOutcomes.has(value.outcome) ||
    (value.errorCode !== undefined &&
      (typeof value.errorCode !== "string" ||
        !referralErrorCodes.has(value.errorCode)))
  ) {
    throw new Error("invalid_referral_metric_labels");
  }
  return value as ExpertReferralMetricLabels;
}
