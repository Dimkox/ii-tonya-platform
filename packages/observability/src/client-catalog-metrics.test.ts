import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  clientCatalogMetricLabels,
  recordWorkerOutboxMetric,
} from "./metrics.js";

describe("client catalog metrics", () => {
  it("accepts only the fixed phase and normalized outcome dimensions", () => {
    expect(
      clientCatalogMetricLabels({
        phase: "materialize",
        outcome: "applied",
      }),
    ).toEqual({ phase: "materialize", outcome: "applied" });

    expect(() =>
      recordWorkerOutboxMetric({
        topic: "catalog_show",
        phase: "dispatch",
        outcome: "applied",
        reasonClass: "internal",
      }),
    ).not.toThrow();
  });

  it.each([
    { phase: "materialize", outcome: "applied", requestId: randomUUID() },
    { phase: "materialize", outcome: "applied", filter: "career" },
    { phase: "provider", outcome: "applied" },
    { phase: "cleanup", outcome: `missing:${randomUUID()}` },
  ])("rejects IDs, filters and dynamic labels: %j", (labels) => {
    expect(() => clientCatalogMetricLabels(labels)).toThrow(
      "invalid_client_catalog_metric_labels",
    );
  });
});
