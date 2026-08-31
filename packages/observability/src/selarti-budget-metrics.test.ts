import { describe, expect, it } from "vitest";
import { selartiBudgetMetricLabels } from "./metrics.js";

describe("Selarti budget metric cardinality", () => {
  it.each([
    "admitted",
    "warning",
    "soft_stop",
    "hard_stop",
    "released",
    "reconciled",
    "overrun",
    "unknown",
  ] as const)("allows bounded outcome %s", (outcome) => {
    expect(selartiBudgetMetricLabels({ outcome })).toEqual({ outcome });
  });
  it.each([
    { outcome: "admitted", userId: "pii" },
    { outcome: "other" },
    { requestId: "raw" },
  ])("rejects unbounded labels %#", (labels) => {
    expect(() => selartiBudgetMetricLabels(labels)).toThrow(
      "invalid_selarti_budget_metric_labels",
    );
  });
});
