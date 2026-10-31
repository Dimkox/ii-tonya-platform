import { expect, it } from "vitest";
import {
  YooKassaEarlyBirdRefundVerifier,
  assertVerifiedEarlyBirdRefund,
} from "./early-bird-refund-verifier.js";

const binding = {
  invoiceId: "2526c71d-803f-4c3d-9b57-74e902170001",
  userId: "2526c71d-803f-4c3d-9b57-74e902170002",
  operationId: "2526c71d-803f-4c3d-9b57-74e902170003",
  refundOperationId: "2526c71d-803f-4c3d-9b57-74e902170004",
  pricingPolicy: "owner_test_10_20_v1" as const,
  priceKind: "fixed_test" as const,
  grantId: "2526c71d-803f-4c3d-9b57-74e902170005",
  paymentId: "payment-1",
  refundId: "refund-1",
  totalMinor: "3000" as const,
  mode: "live" as const,
};
const refund = {
  id: "refund-1",
  paymentId: "payment-1",
  status: "succeeded" as const,
  amount: { value: "30.00", currency: "RUB" as const },
  createdAt: "2026-11-10T00:00:00.000Z",
};
const payment = {
  id: "payment-1",
  status: "succeeded" as const,
  paid: true,
  amount: { value: "30.00", currency: "RUB" as const },
  test: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  capturedAt: "2026-11-02T00:00:00.000Z",
  metadata: {
    order_id: binding.invoiceId,
    operation_id: binding.operationId,
    user_id: binding.userId,
    purpose: "combined_early_bird",
    pricing_policy: binding.pricingPolicy,
    price_kind: binding.priceKind,
    pricing_grant_id: binding.grantId,
  },
  refundable: true,
};

it("verifies a full refund and its original payment with fresh provider reads", async () => {
  const verifier = new YooKassaEarlyBirdRefundVerifier(
    { getRefund: async () => refund, getPayment: async () => payment },
    { findRefundBinding: async () => binding },
  );
  const proof = await verifier.verify("refund-1");
  assertVerifiedEarlyBirdRefund(proof, verifier);
  expect(proof).toMatchObject({
    refundId: "refund-1",
    paymentId: "payment-1",
    amountMinor: "3000",
    disposition: "full_refund",
  });
});

it("does not turn partial refunds or mismatched payment identities into full reversal", async () => {
  const partial = new YooKassaEarlyBirdRefundVerifier(
    {
      getRefund: async () => ({
        ...refund,
        amount: { value: "10.00", currency: "RUB" },
      }),
      getPayment: async () => payment,
    },
    { findRefundBinding: async () => binding },
  );
  const result = await partial.verify("refund-1");
  expect(result?.disposition).toBe("reconcile");
  const mismatch = new YooKassaEarlyBirdRefundVerifier(
    {
      getRefund: async () => ({ ...refund, paymentId: "other" }),
      getPayment: async () => payment,
    },
    { findRefundBinding: async () => binding },
  );
  await expect(mismatch.verify("refund-1")).rejects.toThrow(
    "early_bird_refund_binding_mismatch",
  );
});

it("never mints proof for a pending refund, and rejects proof from another issuer", async () => {
  const verifier = new YooKassaEarlyBirdRefundVerifier(
    {
      getRefund: async () => ({ ...refund, status: "pending" }),
      getPayment: async () => payment,
    },
    { findRefundBinding: async () => binding },
  );
  expect(await verifier.verify("refund-1")).toBeNull();
  expect(() => assertVerifiedEarlyBirdRefund({ ...binding }, verifier)).toThrow(
    "early_bird_refund_proof_required",
  );
});

it("rejects a refund when the payment has a different grant or pricing policy", async () => {
  const verifier = new YooKassaEarlyBirdRefundVerifier(
    {
      getRefund: async () => refund,
      getPayment: async () => ({
        ...payment,
        metadata: { ...payment.metadata, pricing_grant_id: "wrong-grant" },
      }),
    },
    { findRefundBinding: async () => binding },
  );
  await expect(verifier.verify("refund-1")).rejects.toThrow(
    "early_bird_refund_binding_mismatch",
  );
});

it("verifies standard price refunds and rejects mismatched price metadata", async () => {
  const standard = {
    invoiceId: binding.invoiceId,
    userId: binding.userId,
    operationId: binding.operationId,
    refundOperationId: binding.refundOperationId,
    paymentId: binding.paymentId,
    refundId: binding.refundId,
    mode: binding.mode,
    pricingPolicy: "wave1_standard_v1" as const,
    priceKind: "full_price" as const,
    totalMinor: "830000",
  };
  const fullRefund = {
    ...refund,
    amount: { value: "8300.00", currency: "RUB" as const },
  };
  const standardPayment = {
    ...payment,
    amount: fullRefund.amount,
    metadata: {
      order_id: binding.invoiceId,
      operation_id: binding.operationId,
      user_id: binding.userId,
      purpose: "combined_early_bird",
      pricing_policy: standard.pricingPolicy,
      price_kind: standard.priceKind,
    },
  };
  const verifier = new YooKassaEarlyBirdRefundVerifier(
    {
      getRefund: async () => fullRefund,
      getPayment: async () => standardPayment,
    },
    { findRefundBinding: async () => standard },
  );
  expect((await verifier.verify("refund-1"))?.disposition).toBe("full_refund");
  const mismatch = new YooKassaEarlyBirdRefundVerifier(
    {
      getRefund: async () => fullRefund,
      getPayment: async () => ({
        ...standardPayment,
        metadata: { ...standardPayment.metadata, price_kind: "discounted" },
      }),
    },
    { findRefundBinding: async () => standard },
  );
  await expect(mismatch.verify("refund-1")).rejects.toThrow(
    "early_bird_refund_binding_mismatch",
  );
});

it("rejects proofs minted by a different verifier and prevents over-refund", async () => {
  const first = new YooKassaEarlyBirdRefundVerifier(
    { getRefund: async () => refund, getPayment: async () => payment },
    { findRefundBinding: async () => binding },
  );
  const second = new YooKassaEarlyBirdRefundVerifier(
    { getRefund: async () => refund, getPayment: async () => payment },
    { findRefundBinding: async () => binding },
  );
  const proof = await first.verify("refund-1");
  expect(() => assertVerifiedEarlyBirdRefund(proof, second)).toThrow(
    "early_bird_refund_proof_required",
  );
  const over = new YooKassaEarlyBirdRefundVerifier(
    {
      getRefund: async () => ({
        ...refund,
        amount: { value: "30.01", currency: "RUB" },
      }),
      getPayment: async () => payment,
    },
    { findRefundBinding: async () => binding },
  );
  await expect(over.verify("refund-1")).rejects.toThrow(
    "early_bird_refund_binding_mismatch",
  );
});

it("keeps the provider creation timestamp distinct from confirmation time", async () => {
  const verifier = new YooKassaEarlyBirdRefundVerifier(
    { getRefund: async () => refund, getPayment: async () => payment },
    { findRefundBinding: async () => binding },
  );
  const proof = await verifier.verify("refund-1");
  expect(proof).toHaveProperty("providerCreatedAt", refund.createdAt);
  expect(proof).not.toHaveProperty("occurredAt");
});
