import { metrics as api } from "@opentelemetry/api";
import { metrics as sdk } from "@opentelemetry/sdk-node";
import { beforeAll, afterAll, expect, it, vi } from "vitest";

class Reader extends sdk.MetricReader {
  protected async onForceFlush() {}
  protected async onShutdown() {}
}
const reader = new Reader();
const provider = new sdk.MeterProvider({ readers: [reader] });
let telemetry: typeof import("./metrics.js");
beforeAll(async () => {
  api.disable();
  expect(api.setGlobalMeterProvider(provider)).toBe(true);
  telemetry = await import("./metrics.js");
});
afterAll(async () => {
  api.disable();
  await provider.shutdown();
});

it("guards every exported instrument against arbitrary labels and keeps valid values in a recording meter", async () => {
  const canary = "ordinary private appointment details";
  for (const instrument of Object.values(telemetry.operationalMetrics)) {
    const record =
      "add" in instrument
        ? instrument.add.bind(instrument)
        : instrument.record.bind(instrument);
    expect(() => record(1, { [canary]: canary })).toThrow();
    expect(() => record(1, { outcome: canary })).toThrow();
    expect(() => record(NaN)).toThrow();
  }
  telemetry.operationalMetrics.inboxDuplicates.add(2, { provider: "selarti" });
  telemetry.operationalMetrics.providerCircuitState.add(-1);
  telemetry.operationalMetrics.outboxLagMs.record(12.5);
  telemetry.recordClientCatalogMetric(
    { phase: "request", outcome: "applied" },
    3,
  );
  telemetry.recordWorkerOutboxMetric(
    {
      topic: "telegram_send_text",
      phase: "dispatch",
      outcome: "unknown",
      reasonClass: "internal",
    },
    4,
  );
  telemetry.recordExpertReferralMaturityMetric("granted", 5);
  telemetry.recordTestExpertReconciliationMetric({
    name: "units_consumed",
    value: 0.5,
  });
  const result = await reader.collect();
  expect(result.errors).toEqual([]);
  const recorded = result.resourceMetrics.scopeMetrics.flatMap(
    (scope) => scope.metrics,
  );
  expect(JSON.stringify(recorded)).not.toContain(canary);
  const points = (name: string) =>
    recorded.find((metric) => metric.descriptor.name === name)?.dataPoints;
  expect(points("ii_tonya_inbox_duplicates")).toEqual([
    expect.objectContaining({ attributes: { provider: "selarti" }, value: 2 }),
  ]);
  expect(points("ii_tonya_provider_circuit_state")).toEqual([
    expect.objectContaining({ attributes: {}, value: -1 }),
  ]);
  expect(points("ii_tonya_outbox_lag_ms")).toEqual([
    expect.objectContaining({
      attributes: {},
      value: expect.objectContaining({ sum: 12.5, count: 1 }),
    }),
  ]);
  expect(points("ii_tonya_client_catalog")).toEqual([
    expect.objectContaining({
      attributes: { phase: "request", outcome: "applied" },
      value: 3,
    }),
  ]);
  expect(points("ii_tonya_worker_outbox_delivery")).toEqual([
    expect.objectContaining({
      attributes: {
        topic: "telegram_send_text",
        phase: "dispatch",
        outcome: "unknown",
        reasonClass: "internal",
      },
      value: 4,
    }),
  ]);
  expect(points("ii_tonya_expert_referral_maturity")).toEqual([
    expect.objectContaining({ attributes: { outcome: "granted" }, value: 5 }),
  ]);
  expect(points("ii_tonya_test_expert_reconciliation")).toEqual([
    expect.objectContaining({
      attributes: { outcome: "units_consumed" },
      value: 0.5,
    }),
  ]);
});

it("rejects runtime reconciliation names and hostile label accessors without invoking them", () => {
  expect(() =>
    telemetry.recordTestExpertReconciliationMetric({
      name: "private name" as never,
      value: 1,
    }),
  ).toThrow("invalid_test_expert_reconciliation_metric");
  const invoked = vi.fn(() => {
    throw new Error("private accessor");
  });
  const labels = {
    operation: "issue",
    get outcome() {
      return invoked();
    },
  };
  expect(() => telemetry.clientSessionMetricLabels(labels)).toThrow(
    "invalid_client_session_metric_labels",
  );
  expect(() =>
    telemetry.operationalMetrics.clientSession.add(1, labels),
  ).toThrow();
  expect(invoked).not.toHaveBeenCalled();
});
