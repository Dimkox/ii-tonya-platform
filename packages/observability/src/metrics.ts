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
} as const;

export type MetricLabels = Readonly<{
  module: string;
  operation: string;
  outcome: string;
  errorCode?: string;
}>;
