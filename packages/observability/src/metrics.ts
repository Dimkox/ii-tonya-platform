import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("ii-tonya");

export const operationalMetrics = {
  inboxDuplicates: meter.createCounter("ii_tonya_inbox_duplicates"),
  debitOutcomes: meter.createCounter("ii_tonya_debit_outcomes"),
  reservationTransitions: meter.createCounter(
    "ii_tonya_reservation_transitions",
  ),
  outboxUnknownOutcomes: meter.createCounter(
    "ii_tonya_outbox_unknown_outcomes",
  ),
  outboxLagMs: meter.createHistogram("ii_tonya_outbox_lag_ms"),
  outboxDeadLetters: meter.createCounter("ii_tonya_outbox_dead_letters"),
  providerCircuitState: meter.createUpDownCounter(
    "ii_tonya_provider_circuit_state",
  ),
  safetyHandoffs: meter.createCounter("ii_tonya_safety_handoffs"),
  reconciliationDrift: meter.createCounter("ii_tonya_reconciliation_drift"),
} as const;

export type MetricLabels = Readonly<{
  module: string;
  operation: string;
  outcome: string;
  errorCode?: string;
}>;

const REFERRAL_MODULE_VALUES = ["expert_referral", "expert_residency"] as const;
const REFERRAL_OPERATION_VALUES = [
  "batch_lifecycle",
  "code_lifecycle",
  "redemption",
  "first_payment_qualification",
  "reward_grant",
  "credit_spend",
  "credit_expiry",
  "debt",
  "bonus_share",
  "duplicate_event",
  "held_replay",
  "refund",
  "reversal",
  "reconciliation_mismatch",
] as const;
const REFERRAL_OUTCOME_VALUES = [
  "issued",
  "revoked",
  "redeemed",
  "rejected",
  "eligible",
  "ineligible",
  "pending_feature_hold",
  "not_first_settlement",
  "granted",
  "not_granted",
  "debt_repaid",
  "spent",
  "expired",
  "unchanged",
  "debt_created",
  "applied",
  "not_applied",
  "duplicate",
  "cancelled",
  "still_held",
  "matched",
  "mismatch",
  "provider_disabled",
  "refunded",
  "charged_back",
  "reversed",
  "not_reversed",
  "failed",
] as const;
const REFERRAL_ERROR_CODE_VALUES = [
  "none",
  "invalid_state",
  "provider_disabled",
  "provider_unavailable",
  "conflicting_fact",
  "database_unavailable",
  "unknown",
] as const;
const REFERRAL_MODULES = new Set<string>(REFERRAL_MODULE_VALUES);
const REFERRAL_OPERATIONS = new Set<string>(REFERRAL_OPERATION_VALUES);
const REFERRAL_OUTCOMES = new Set<string>(REFERRAL_OUTCOME_VALUES);
const REFERRAL_ERROR_CODES = new Set<string>(REFERRAL_ERROR_CODE_VALUES);

export type ReferralMetricLabels = Readonly<{
  module: (typeof REFERRAL_MODULE_VALUES)[number];
  operation: (typeof REFERRAL_OPERATION_VALUES)[number];
  outcome: (typeof REFERRAL_OUTCOME_VALUES)[number];
  errorCode?: (typeof REFERRAL_ERROR_CODE_VALUES)[number];
}>;

export function referralMetricLabels(input: unknown): ReferralMetricLabels {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("invalid_referral_metric_labels");
  }
  const labels = input as Record<string, unknown>;
  const keys = Object.keys(labels);
  if (
    keys.some(
      (key) => !["module", "operation", "outcome", "errorCode"].includes(key),
    ) ||
    typeof labels.module !== "string" ||
    !REFERRAL_MODULES.has(labels.module) ||
    typeof labels.operation !== "string" ||
    !REFERRAL_OPERATIONS.has(labels.operation) ||
    typeof labels.outcome !== "string" ||
    !REFERRAL_OUTCOMES.has(labels.outcome) ||
    (labels.errorCode !== undefined &&
      (typeof labels.errorCode !== "string" ||
        !REFERRAL_ERROR_CODES.has(labels.errorCode)))
  ) {
    throw new Error("invalid_referral_metric_labels");
  }
  return {
    module: labels.module as ReferralMetricLabels["module"],
    operation: labels.operation as ReferralMetricLabels["operation"],
    outcome: labels.outcome as ReferralMetricLabels["outcome"],
    ...(labels.errorCode === undefined
      ? {}
      : {
          errorCode: labels.errorCode as Exclude<
            ReferralMetricLabels["errorCode"],
            undefined
          >,
        }),
  };
}

const expertReferralMetrics = {
  lifecycle: meter.createCounter("ii_tonya_expert_referral_lifecycle"),
  operationDurationMs: meter.createHistogram(
    "ii_tonya_expert_referral_operation_duration_ms",
  ),
} as const;

export function recordExpertReferralLifecycle(input: unknown, count = 1): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > 1_000) {
    throw new Error("invalid_referral_metric_count");
  }
  expertReferralMetrics.lifecycle.add(count, referralMetricLabels(input));
}

export function safelyRecordExpertReferralLifecycle(
  input: ReferralMetricLabels,
  count = 1,
): void {
  try {
    recordExpertReferralLifecycle(input, count);
  } catch {
    // Telemetry must never change an already-decided financial outcome.
  }
}

export function observeExpertReferralDuration(
  input: unknown,
  durationMs: number,
): void {
  if (
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > 3_600_000
  ) {
    throw new Error("invalid_referral_metric_duration");
  }
  expertReferralMetrics.operationDurationMs.record(
    durationMs,
    referralMetricLabels(input),
  );
}

export function safelyObserveExpertReferralDuration(
  input: ReferralMetricLabels,
  durationMs: number,
): void {
  try {
    observeExpertReferralDuration(input, durationMs);
  } catch {
    // Telemetry must never change an already-decided financial outcome.
  }
}
