import { types } from "node:util";
import {
  metrics,
  type Attributes,
  type Counter,
  type Histogram,
  type UpDownCounter,
} from "@opentelemetry/api";
import { ownData } from "./telemetry-schema.js";

const rawMeter = metrics.getMeter("ii-tonya");

// Copy primitive own data before validation. Even a toJSON property or accessor
// on an otherwise valid label object must never reach an instrument/exporter.
function metricData(value: unknown): Record<string, string> | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    types.isProxy(value) ||
    Array.isArray(value)
  )
    return undefined;
  const result: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const item = ownData(value, key);
    if (typeof item !== "string") return undefined;
    result[key] = item;
  }
  return result;
}

const reconciliationNames = new Set([
  "reconciliation_age",
  "units_consumed",
  "units_released",
  "unknown_outcome",
]);
function singleLabel(
  value: Record<string, string>,
  key: string,
  allowed: ReadonlySet<string>,
): Attributes {
  if (Object.keys(value).length !== 1 || !allowed.has(value[key]!))
    throw new Error("invalid_operational_metric_labels");
  return value;
}
function instrumentLabels(name: string, attributes: unknown): Attributes {
  if (attributes === undefined) return {};
  const labels = metricData(attributes);
  if (!labels) throw new Error("invalid_operational_metric_labels");
  switch (name) {
    case "ii_tonya_inbox_duplicates":
      return singleLabel(
        labels,
        "provider",
        new Set(["telegram", "selarti", "yookassa"]),
      );
    case "ii_tonya_client_catalog":
      return clientCatalogMetricLabels(labels);
    case "ii_tonya_client_session":
      return clientSessionMetricLabels(labels);
    case "ii_tonya_client_booking":
      return clientBookingMetricLabels(labels);
    case "ii_tonya_worker_outbox_delivery":
      return workerOutboxMetricLabels(labels);
    case "ii_tonya_selarti_budget_outcomes":
      return selartiBudgetMetricLabels(labels);
    case "ii_tonya_test_expert_reconciliation":
      return singleLabel(labels, "outcome", reconciliationNames);
    case "ii_tonya_expert_referral_maturity":
      return singleLabel(labels, "outcome", expertReferralMaturityOutcomes);
    default:
      if (name.startsWith("ii_tonya_expert_"))
        return referralMetricLabels(labels);
      if (Object.keys(labels).length !== 0)
        throw new Error("invalid_operational_metric_labels");
      return labels;
  }
}
function checkValue(value: number, signed = false): void {
  if (!Number.isFinite(value) || (!signed && value < 0))
    throw new Error("invalid_operational_metric_value");
}
// Only these guarded facades are exported; raw instruments stay module-private.
const meter = {
  createCounter(name: string): Counter {
    const instrument = rawMeter.createCounter(name);
    return {
      add(value, attributes) {
        checkValue(value);
        instrument.add(value, instrumentLabels(name, attributes));
      },
    };
  },
  createUpDownCounter(name: string): UpDownCounter {
    const instrument = rawMeter.createUpDownCounter(name);
    return {
      add(value, attributes) {
        checkValue(value, true);
        instrument.add(value, instrumentLabels(name, attributes));
      },
    };
  },
  createHistogram(name: string): Histogram {
    const instrument = rawMeter.createHistogram(name);
    return {
      record(value, attributes) {
        checkValue(value);
        instrument.record(value, instrumentLabels(name, attributes));
      },
    };
  },
};

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
  selartiBudgetOutcomes: meter.createCounter(
    "ii_tonya_selarti_budget_outcomes",
  ),
  testExpertReconciliation: meter.createCounter(
    "ii_tonya_test_expert_reconciliation",
  ),
} as const;

export function recordTestExpertReconciliationMetric(event: {
  name:
    | "reconciliation_age"
    | "units_consumed"
    | "units_released"
    | "unknown_outcome";
  value: number;
}): void {
  const name = ownData(event, "name");
  const value = ownData(event, "value");
  if (
    typeof name !== "string" ||
    !reconciliationNames.has(name) ||
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  )
    throw new Error("invalid_test_expert_reconciliation_metric");
  operationalMetrics.testExpertReconciliation.add(value, {
    outcome: name,
  });
}

const selartiBudgetOutcomes = new Set([
  "admitted",
  "warning",
  "soft_stop",
  "hard_stop",
  "released",
  "reconciled",
  "overrun",
  "unknown",
]);
export type SelartiBudgetMetricLabels = Readonly<{
  outcome:
    | "admitted"
    | "warning"
    | "soft_stop"
    | "hard_stop"
    | "released"
    | "reconciled"
    | "overrun"
    | "unknown";
}>;
export function selartiBudgetMetricLabels(
  value: unknown,
): SelartiBudgetMetricLabels {
  value = metricData(value);
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.outcome !== "string" ||
    !selartiBudgetOutcomes.has(value.outcome)
  )
    throw new Error("invalid_selarti_budget_metric_labels");
  return value as SelartiBudgetMetricLabels;
}
export function recordSelartiBudgetMetric(
  labels: SelartiBudgetMetricLabels,
  count = 1,
): void {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("invalid_selarti_budget_metric_count");
  operationalMetrics.selartiBudgetOutcomes.add(
    count,
    selartiBudgetMetricLabels(labels),
  );
}

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
  value = metricData(value);
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
  value = metricData(value);
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
  value = metricData(value);
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
  value = metricData(value);
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
  value = metricData(value);
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
