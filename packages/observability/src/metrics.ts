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
  workerOutboxDelivery: meter.createCounter("ii_tonya_worker_outbox_delivery"),
  clientCatalog: meter.createCounter("ii_tonya_client_catalog"),
  clientSession: meter.createCounter("ii_tonya_client_session"),
  clientBooking: meter.createCounter("ii_tonya_client_booking"),
  providerCircuitState: meter.createUpDownCounter(
    "ii_tonya_provider_circuit_state",
  ),
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
  expertReferralMaturity: meter.createCounter(
    "ii_tonya_expert_referral_maturity",
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

const expertReferralMaturityOutcomes = new Set([
  "examined",
  "granted",
  "cancelled",
  "retry",
  "failed",
]);
export type ExpertReferralMaturityMetricOutcome =
  "examined" | "granted" | "cancelled" | "retry" | "failed";
export function recordExpertReferralMaturityMetric(
  outcome: ExpertReferralMaturityMetricOutcome,
  count = 1,
): void {
  if (
    !expertReferralMaturityOutcomes.has(outcome) ||
    !Number.isSafeInteger(count) ||
    count < 1
  )
    throw new Error("invalid_expert_referral_maturity_metric");
  operationalMetrics.expertReferralMaturity.add(count, { outcome });
}

const clientSessionOperations = new Set([
  "issue",
  "resolve",
  "revoke",
  "cleanup",
]);
const clientSessionOutcomes = new Set([
  "allowed",
  "denied",
  "unavailable",
  "removed",
]);

export type ClientSessionMetricLabels = Readonly<{
  operation: "issue" | "resolve" | "revoke" | "cleanup";
  outcome: "allowed" | "denied" | "unavailable" | "removed";
}>;

export function clientSessionMetricLabels(
  value: unknown,
): ClientSessionMetricLabels {
  if (!isRecord(value)) {
    throw new Error("invalid_client_session_metric_labels");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    keys.some((key) => key !== "operation" && key !== "outcome") ||
    typeof value.operation !== "string" ||
    !clientSessionOperations.has(value.operation) ||
    typeof value.outcome !== "string" ||
    !clientSessionOutcomes.has(value.outcome)
  ) {
    throw new Error("invalid_client_session_metric_labels");
  }
  return value as ClientSessionMetricLabels;
}

export function recordClientSessionMetric(
  labels: ClientSessionMetricLabels,
  count = 1,
): void {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("invalid_client_session_metric_count");
  }
  operationalMetrics.clientSession.add(
    count,
    clientSessionMetricLabels(labels),
  );
}

const clientBookingOperations = new Set(["reserve", "cancel"]);
const clientBookingOutcomes = new Set([
  "created",
  "replayed",
  "cancelled",
  "not_found",
  "conflict",
  "invalid",
  "disabled",
  "failed",
]);

export type ClientBookingMetricLabels = Readonly<{
  operation: "reserve" | "cancel";
  outcome:
    | "created"
    | "replayed"
    | "cancelled"
    | "not_found"
    | "conflict"
    | "invalid"
    | "disabled"
    | "failed";
}>;

export function clientBookingMetricLabels(
  value: unknown,
): ClientBookingMetricLabels {
  if (!isRecord(value)) {
    throw new Error("invalid_client_booking_metric_labels");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    keys.some((key) => key !== "operation" && key !== "outcome") ||
    typeof value.operation !== "string" ||
    !clientBookingOperations.has(value.operation) ||
    typeof value.outcome !== "string" ||
    !clientBookingOutcomes.has(value.outcome)
  ) {
    throw new Error("invalid_client_booking_metric_labels");
  }
  return value as ClientBookingMetricLabels;
}

export function recordClientBookingMetric(
  labels: ClientBookingMetricLabels,
  count = 1,
): void {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("invalid_client_booking_metric_count");
  }
  operationalMetrics.clientBooking.add(
    count,
    clientBookingMetricLabels(labels),
  );
}

export type MetricLabels = Readonly<{
  module: string;
  operation: string;
  outcome: string;
  errorCode?: string;
}>;

const workerOutboxTopics = new Set([
  "safety_operator_escalation",
  "admin_negative_feedback",
  "catalog_show",
  "telegram_send_text",
]);
const workerOutboxPhases = new Set([
  "claim",
  "dispatch",
  "reconciliation",
  "lease_recovery",
]);
const workerOutboxOutcomes = new Set([
  "applied",
  "retry",
  "unknown",
  "terminal",
  "dead_letter",
  "no_op",
]);
const workerOutboxReasonClasses = new Set([
  "invalid_payload",
  "local_source_invalid",
  "attempts_exhausted",
  "reconciliation_exhausted",
  "lease_expired",
  "internal",
]);

export type WorkerOutboxMetricLabels = Readonly<{
  topic:
    | "safety_operator_escalation"
    | "admin_negative_feedback"
    | "catalog_show"
    | "telegram_send_text";
  phase: "claim" | "dispatch" | "reconciliation" | "lease_recovery";
  outcome:
    "applied" | "retry" | "unknown" | "terminal" | "dead_letter" | "no_op";
  reasonClass:
    | "invalid_payload"
    | "local_source_invalid"
    | "attempts_exhausted"
    | "reconciliation_exhausted"
    | "lease_expired"
    | "internal";
}>;

const clientCatalogPhases = new Set(["request", "materialize", "cleanup"]);
const clientCatalogOutcomes = new Set([
  "applied",
  "replayed",
  "missing",
  "expired",
  "removed",
  "no_op",
  "retry",
  "unknown",
  "terminal",
  "dead_letter",
  "rejected",
  "failed",
]);

export type ClientCatalogMetricLabels = Readonly<{
  phase: "request" | "materialize" | "cleanup";
  outcome:
    | "applied"
    | "replayed"
    | "missing"
    | "expired"
    | "removed"
    | "no_op"
    | "retry"
    | "unknown"
    | "terminal"
    | "dead_letter"
    | "rejected"
    | "failed";
}>;

export function clientCatalogMetricLabels(
  value: unknown,
): ClientCatalogMetricLabels {
  if (!isRecord(value)) {
    throw new Error("invalid_client_catalog_metric_labels");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    keys.some((key) => key !== "phase" && key !== "outcome") ||
    typeof value.phase !== "string" ||
    !clientCatalogPhases.has(value.phase) ||
    typeof value.outcome !== "string" ||
    !clientCatalogOutcomes.has(value.outcome)
  ) {
    throw new Error("invalid_client_catalog_metric_labels");
  }
  return value as ClientCatalogMetricLabels;
}

export function recordClientCatalogMetric(
  labels: ClientCatalogMetricLabels,
  count = 1,
): void {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("invalid_client_catalog_metric_count");
  }
  operationalMetrics.clientCatalog.add(
    count,
    clientCatalogMetricLabels(labels),
  );
}

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

export function workerOutboxMetricLabels(
  value: unknown,
): WorkerOutboxMetricLabels {
  if (!isRecord(value)) {
    throw new Error("invalid_worker_outbox_metric_labels");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 4 ||
    keys.some(
      (key) =>
        key !== "topic" &&
        key !== "phase" &&
        key !== "outcome" &&
        key !== "reasonClass",
    ) ||
    typeof value.topic !== "string" ||
    !workerOutboxTopics.has(value.topic) ||
    typeof value.phase !== "string" ||
    !workerOutboxPhases.has(value.phase) ||
    typeof value.outcome !== "string" ||
    !workerOutboxOutcomes.has(value.outcome) ||
    typeof value.reasonClass !== "string" ||
    !workerOutboxReasonClasses.has(value.reasonClass)
  ) {
    throw new Error("invalid_worker_outbox_metric_labels");
  }
  return value as WorkerOutboxMetricLabels;
}

export function recordWorkerOutboxMetric(
  labels: WorkerOutboxMetricLabels,
  count = 1,
): void {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("invalid_worker_outbox_metric_count");
  }
  const normalized = workerOutboxMetricLabels(labels);
  if (normalized.topic === "catalog_show") {
    recordClientCatalogMetric(
      {
        phase:
          normalized.phase === "lease_recovery" ? "cleanup" : "materialize",
        outcome: normalized.outcome,
      },
      count,
    );
    return;
  }
  operationalMetrics.workerOutboxDelivery.add(count, normalized);
}

export function referralMetricLabels(
  value: unknown,
): ExpertReferralMetricLabels {
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
