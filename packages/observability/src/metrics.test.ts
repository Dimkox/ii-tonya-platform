import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as observability from "./index.js";
import { referralMetricLabels } from "./metrics.js";

describe("expert referral metric cardinality", () => {
  it("does not expose the raw instrument as a cardinality bypass", () => {
    expect("expertReferralMetrics" in observability).toBe(false);
  });

  it("accepts only the four bounded lifecycle labels", () => {
    expect(
      referralMetricLabels({
        module: "expert_referral",
        operation: "held_replay",
        outcome: "cancelled",
        errorCode: "none",
      }),
    ).toEqual({
      module: "expert_referral",
      operation: "held_replay",
      outcome: "cancelled",
      errorCode: "none",
    });
  });

  it.each([
    { expertId: randomUUID() },
    { paymentId: "pay-secret" },
    { code: "plaintext-secret" },
    { suffix: "1234" },
    { hash: `sha256:${"a".repeat(64)}` },
    { name: "Expert Name" },
    { reason: "free text" },
    { payload: { paymentId: "pay-secret" } },
    { timestamp: "2026-09-02T00:00:00.000Z" },
    { url: "https://provider.invalid/pay-secret" },
    { correlationId: randomUUID() },
    { idempotencyKey: randomUUID() },
    { errorCode: "raw exception: pay-secret" },
    { operation: "expert-" + randomUUID() },
  ])("rejects unknown or high-cardinality labels %#", (unsafe) => {
    expect(() =>
      referralMetricLabels({
        module: "expert_referral",
        operation: "held_replay",
        outcome: "failed",
        ...unsafe,
      }),
    ).toThrow("invalid_referral_metric_labels");
  });
});
