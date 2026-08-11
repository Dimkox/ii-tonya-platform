import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { referralMetricLabels } from "./metrics.js";

describe("expert referral metric labels", () => {
  it("accepts only bounded low-cardinality dimensions", () => {
    expect(
      referralMetricLabels({
        module: "expert_residency",
        operation: "reconciliation",
        outcome: "mismatch",
        errorCode: "state_mismatch",
      }),
    ).toEqual({
      module: "expert_residency",
      operation: "reconciliation",
      outcome: "mismatch",
      errorCode: "state_mismatch",
    });
  });

  it("rejects expert identifiers and arbitrary labels", () => {
    expect(() =>
      referralMetricLabels({
        module: "expert_referral",
        operation: "held_replay",
        outcome: "granted",
        expertId: randomUUID(),
      }),
    ).toThrow("invalid_referral_metric_labels");
  });

  it("rejects high-cardinality error codes", () => {
    expect(() =>
      referralMetricLabels({
        module: "expert_referral",
        operation: "redemption",
        outcome: "failed",
        errorCode: `payment:${randomUUID()}`,
      }),
    ).toThrow("invalid_referral_metric_labels");
  });
});
