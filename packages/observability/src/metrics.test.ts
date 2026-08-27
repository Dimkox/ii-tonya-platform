import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  operationalMetrics,
  clientSessionMetricLabels,
  referralMetricLabels,
  workerOutboxMetricLabels,
} from "./metrics.js";

describe("client session metric labels", () => {
  it("accepts only fixed operation and outcome labels", () => {
    expect(
      clientSessionMetricLabels({ operation: "resolve", outcome: "denied" }),
    ).toEqual({ operation: "resolve", outcome: "denied" });
    expect(operationalMetrics).toHaveProperty("clientSession");
  });

  it("rejects identifiers, reasons, hashes, and credentials", () => {
    for (const labels of [
      { operation: "issue", outcome: "allowed", userId: randomUUID() },
      { operation: "resolve", outcome: "denied", reason: "expired" },
      { operation: "revoke", outcome: "allowed", tokenHash: "sha256:x" },
      { operation: "cleanup", outcome: "removed", count: 2 },
    ]) {
      expect(() => clientSessionMetricLabels(labels)).toThrow(
        "invalid_client_session_metric_labels",
      );
    }
  });
});

describe("expert referral metric labels", () => {
  it("exposes bounded instruments for the full referral lifecycle", () => {
    expect(Object.keys(operationalMetrics)).toEqual(
      expect.arrayContaining([
        "expertReferralCodeLifecycle",
        "expertReferralRedemption",
        "expertReferralRewardOutcome",
        "expertResidencyCreditSpend",
        "expertResidencyCreditExpiry",
        "expertReferralDebt",
        "expertReferralDuplicateEvents",
        "expertReferralHeldReplay",
        "expertResidencyRefundReversal",
        "expertResidencyReconciliationMismatch",
        "expertResidencyJobDurationMs",
      ]),
    );
  });

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

describe("worker outbox metric labels", () => {
  it("accepts only the documented closed vocabulary", () => {
    expect(
      workerOutboxMetricLabels({
        topic: "safety_operator_escalation",
        phase: "dispatch",
        outcome: "terminal",
        reasonClass: "invalid_payload",
      }),
    ).toEqual({
      topic: "safety_operator_escalation",
      phase: "dispatch",
      outcome: "terminal",
      reasonClass: "invalid_payload",
    });
    expect(operationalMetrics).toHaveProperty("workerOutboxDelivery");
  });

  it.each([
    {
      topic: "provider_notification",
      phase: "dispatch",
      outcome: "applied",
      reasonClass: "internal",
    },
    {
      topic: "admin_negative_feedback",
      phase: "send",
      outcome: "applied",
      reasonClass: "internal",
    },
    {
      topic: "admin_negative_feedback",
      phase: "dispatch",
      outcome: randomUUID(),
      reasonClass: "internal",
    },
    {
      topic: "admin_negative_feedback",
      phase: "dispatch",
      outcome: "applied",
      reasonClass: "database:customer-42",
    },
    {
      topic: "admin_negative_feedback",
      phase: "dispatch",
      outcome: "applied",
      reasonClass: "internal",
      payloadHash: "f".repeat(64),
    },
  ])("rejects dynamic or content-bearing labels", (labels) => {
    expect(() => workerOutboxMetricLabels(labels)).toThrow(
      "invalid_worker_outbox_metric_labels",
    );
  });
});
