import { expect, it, vi } from "vitest";
import { YooKassaEarlyBirdWebhookCapability } from "./early-bird-webhook-capability.js";
import { YooKassaEarlyBirdVerifier } from "./early-bird-verifier.js";

const invoiceId = "2526c71d-803f-4c3d-9b57-74e902170001";
const userId = "2526c71d-803f-4c3d-9b57-74e902170002";
const operationId = "2526c71d-803f-4c3d-9b57-74e902170003";
const grantId = "2526c71d-803f-4c3d-9b57-74e902170004";
const binding = {
  invoiceId,
  userId,
  operationId,
  grantId,
  pricingPolicy: "owner_test_10_20_v1" as const,
  priceKind: "fixed_test" as const,
  providerObjectId: "p1",
  onboardingMinor: "1000" as const,
  subscriptionMinor: "2000" as const,
  totalMinor: "3000" as const,
  mode: "live" as const,
  launchAt: "2027-01-10T21:00:00.000Z",
  baseOfferShownAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2026-11-11T00:00:00.000Z",
};
const payment = {
  id: "p1",
  status: "succeeded",
  paid: true,
  refundable: true,
  amount: { value: "30.00", currency: "RUB" },
  test: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  capturedAt: "2026-11-10T00:00:00.000Z",
  metadata: {
    order_id: invoiceId,
    operation_id: operationId,
    user_id: userId,
    purpose: "combined_early_bird",
    pricing_policy: binding.pricingPolicy,
    price_kind: binding.priceKind,
    pricing_grant_id: grantId,
  },
} as const;
const notice = {
  type: "notification",
  event: "payment.succeeded",
  object: { id: "p1" },
} as const;

it("looks up the invoice, verifies provider facts and commits the proof", async () => {
  const commit = vi.fn();
  const verifier = new YooKassaEarlyBirdVerifier(
    { getPayment: async () => payment } as never,
    { findEarlyBirdBinding: async () => binding },
  );
  const handler = new YooKassaEarlyBirdWebhookCapability(
    { findInvoiceByProviderObject: async () => invoiceId, commit },
    verifier,
  );
  expect(await handler.handle(notice)).toBe(true);
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0]?.[0]).toMatchObject({
    invoiceId,
    providerObjectId: "p1",
    disposition: "eligible",
  });
});

it("does not commit a forged verification result", async () => {
  const commit = vi.fn();
  const handler = new YooKassaEarlyBirdWebhookCapability(
    { findInvoiceByProviderObject: async () => invoiceId, commit },
    {
      verify: async () =>
        ({
          ...binding,
          capturedAt: payment.capturedAt,
          eventId: "forged",
          evidenceDigest: "forged",
          disposition: "eligible",
        }) as never,
    },
  );
  await expect(handler.handle(notice)).rejects.toThrow(
    "early_bird_payment_proof_required",
  );
  expect(commit).not.toHaveBeenCalled();
});

it("commits a late payment as reconciliation, never eligible", async () => {
  const commit = vi.fn();
  const verifier = new YooKassaEarlyBirdVerifier(
    {
      getPayment: async () => ({ ...payment, capturedAt: binding.launchAt }),
    } as never,
    { findEarlyBirdBinding: async () => binding },
  );
  const handler = new YooKassaEarlyBirdWebhookCapability(
    { findInvoiceByProviderObject: async () => invoiceId, commit },
    verifier,
  );
  expect(await handler.handle(notice)).toBe(true);
  expect(commit.mock.calls[0]?.[0]).toMatchObject({ disposition: "reconcile" });
});

it("keeps unrelated events and missing bindings retryable without a commit", async () => {
  const commit = vi.fn();
  const verify = vi.fn();
  const handler = new YooKassaEarlyBirdWebhookCapability(
    { findInvoiceByProviderObject: async () => null, commit },
    { verify },
  );
  expect(await handler.handle(notice)).toBe(false);
  expect(await handler.handle({ ...notice, event: "refund.succeeded" })).toBe(
    false,
  );
  expect(verify).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it("commits only a trusted full refund proof, with refund ID matched", async () => {
  const { YooKassaEarlyBirdRefundVerifier } =
    await import("./early-bird-refund-verifier.js");
  const refundVerifier = new YooKassaEarlyBirdRefundVerifier(
    {
      getRefund: async () => ({
        id: "refund1",
        paymentId: "p1",
        status: "succeeded",
        amount: { value: "30.00", currency: "RUB" },
        createdAt: "2026-11-11T00:00:00.000Z",
      }),
      getPayment: async () => payment,
    },
    {
      findRefundBinding: async () => ({
        invoiceId,
        userId,
        operationId,
        refundOperationId: "2526c71d-803f-4c3d-9b57-74e902170005",
        grantId,
        pricingPolicy: binding.pricingPolicy,
        priceKind: binding.priceKind,
        paymentId: "p1",
        refundId: "refund1",
        totalMinor: "3000",
        mode: "live",
      }),
    },
  );
  const verifier = new YooKassaEarlyBirdVerifier(
    { getPayment: async () => payment } as never,
    { findEarlyBirdBinding: async () => binding },
  );
  const commitRefund = vi.fn();
  const handler = new YooKassaEarlyBirdWebhookCapability(
    { findInvoiceByProviderObject: async () => invoiceId, commit: vi.fn() },
    verifier,
    { verifier: refundVerifier, commit: commitRefund },
  );
  expect(
    await handler.handle({
      type: "notification",
      event: "refund.succeeded",
      object: { id: "refund1" },
    }),
  ).toBe(true);
  expect(commitRefund).toHaveBeenCalledOnce();
  expect(commitRefund.mock.calls[0]?.[0]).toMatchObject({
    refundId: "refund1",
    disposition: "full_refund",
  });
});

it("routes verified partial refunds only as reconciliation and does not accept forged proofs", async () => {
  const { YooKassaEarlyBirdRefundVerifier } =
    await import("./early-bird-refund-verifier.js");
  const refundVerifier = new YooKassaEarlyBirdRefundVerifier(
    {
      getRefund: async () => ({
        id: "refund1",
        paymentId: "p1",
        status: "succeeded",
        amount: { value: "10.00", currency: "RUB" },
        createdAt: "2026-11-11T00:00:00.000Z",
      }),
      getPayment: async () => payment,
    },
    {
      findRefundBinding: async () => ({
        invoiceId,
        userId,
        operationId,
        refundOperationId: "2526c71d-803f-4c3d-9b57-74e902170005",
        grantId,
        pricingPolicy: binding.pricingPolicy,
        priceKind: binding.priceKind,
        paymentId: "p1",
        refundId: "refund1",
        totalMinor: "3000",
        mode: "live",
      }),
    },
  );
  const verifier = new YooKassaEarlyBirdVerifier(
    { getPayment: async () => payment } as never,
    { findEarlyBirdBinding: async () => binding },
  );
  const commit = vi.fn();
  const handler = new YooKassaEarlyBirdWebhookCapability(
    { findInvoiceByProviderObject: async () => invoiceId, commit: vi.fn() },
    verifier,
    { verifier: refundVerifier, commit },
  );
  expect(
    await handler.handle({
      type: "notification",
      event: "refund.succeeded",
      object: { id: "refund1" },
    }),
  ).toBe(true);
  expect(commit.mock.calls[0]?.[0]).toMatchObject({ disposition: "reconcile" });
  const forged = new YooKassaEarlyBirdWebhookCapability(
    { findInvoiceByProviderObject: async () => invoiceId, commit: vi.fn() },
    verifier,
    {
      verifier: { verify: async () => ({ refundId: "refund1" }) as never },
      commit,
    },
  );
  await expect(
    forged.handle({
      type: "notification",
      event: "refund.succeeded",
      object: { id: "refund1" },
    }),
  ).rejects.toThrow("early_bird_refund_proof_required");
});
