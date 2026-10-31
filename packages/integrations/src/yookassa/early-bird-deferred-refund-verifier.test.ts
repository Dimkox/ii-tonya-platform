import { expect, it } from "vitest";
import {
  YooKassaDeferredRefundVerifier,
  assertVerifiedDeferredRefund,
} from "./early-bird-deferred-refund-verifier.js";

it("verifies pending and partial refund by independent provider observations and binds issuer", async () => {
  const invoiceId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    grantId = crypto.randomUUID();
  const snapshot = {
    invoiceId,
    operationId: invoiceId,
    userId,
    grantId,
    policy: "owner_test_10_20_v1" as const,
    stage: "subscription" as const,
    amountMinor: "2000",
    mode: "live" as const,
    launchAt: "2027-01-11T00:00:00+03:00",
    providerId: "payment1",
  };
  let status: "pending" | "succeeded" | "canceled" = "pending",
    amount = "5.00";
  const metadata = {
    order_id: invoiceId,
    operation_id: invoiceId,
    user_id: userId,
    purpose: "early_bird_deferred",
    stage: "subscription",
    pricing_policy: snapshot.policy,
    pricing_grant_id: grantId,
  };
  const verifier = new YooKassaDeferredRefundVerifier(
    {
      getRefund: async () => ({
        id: "refund1",
        paymentId: "payment1",
        status,
        amount: { value: amount, currency: "RUB" },
        createdAt: "2026-01-02T00:00:00Z",
      }),
      getPayment: async () => ({
        id: "payment1",
        status: "succeeded",
        paid: true,
        test: false,
        amount: { value: "20.00", currency: "RUB" },
        createdAt: "2026-01-01T00:00:00Z",
        capturedAt: "2026-01-01T00:01:00Z",
        metadata,
      }),
    } as never,
    { findByProviderPayment: async () => snapshot },
  );
  const pending = await verifier.verify("refund1");
  expect(pending).toMatchObject({
    status: "pending",
    refundAmountMinor: "500",
  });
  expect(() =>
    assertVerifiedDeferredRefund({ ...pending }, verifier),
  ).toThrow();
  status = "succeeded";
  const succeeded = await verifier.verify("refund1");
  expect(succeeded?.evidenceDigest).toBe(pending?.evidenceDigest);
  expect(() => assertVerifiedDeferredRefund(succeeded, verifier)).not.toThrow();
  status = "canceled";
  const canceled = await verifier.verify("refund1");
  expect(canceled).toMatchObject({
    status: "canceled",
    evidenceDigest: pending?.evidenceDigest,
  });
  amount = "21.00";
  await expect(verifier.verify("refund1")).rejects.toThrow();
});
