import { expect, it, vi } from "vitest";
import { YooKassaEarlyBirdRefundDiscovery } from "./early-bird-refund-discovery.js";
const binding = {
  invoiceId: "2526c71d-803f-4c3d-9b57-74e902170001",
  userId: "2526c71d-803f-4c3d-9b57-74e902170002",
  operationId: "2526c71d-803f-4c3d-9b57-74e902170003",
  grantId: "2526c71d-803f-4c3d-9b57-74e902170004",
  providerObjectId: "pay1",
  pricingPolicy: "owner_test_10_20_v1" as const,
  priceKind: "fixed_test" as const,
  mode: "live" as const,
  onboardingMinor: "1000" as const,
  subscriptionMinor: "2000" as const,
  totalMinor: "3000" as const,
  baseOfferShownAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-11T00:00:00.000Z",
  launchAt: "2027-01-10T21:00:00.000Z",
};
function setup() {
  const getRefund = vi.fn().mockResolvedValue({
    id: "ref1",
    paymentId: "pay1",
    status: "succeeded",
    amount: { value: "10.00", currency: "RUB" },
    createdAt: "2026-01-03T00:00:00.000Z",
  });
  const getPayment = vi.fn().mockResolvedValue({
    id: "pay1",
    status: "succeeded",
    paid: true,
    refundable: true,
    test: false,
    amount: { value: "30.00", currency: "RUB" },
    createdAt: "2026-01-01T00:00:00.000Z",
    capturedAt: "2026-01-02T00:00:00.000Z",
    metadata: {
      order_id: binding.invoiceId,
      operation_id: binding.operationId,
      user_id: binding.userId,
      purpose: "combined_early_bird",
      pricing_policy: binding.pricingPolicy,
      price_kind: binding.priceKind,
      pricing_grant_id: binding.grantId,
    },
  });
  return { getRefund, getPayment };
}
it("performs fresh reads and gives a verifier-issued proof to the trusted binder", async () => {
  const client = setup(),
    bind = vi.fn(),
    result = vi.fn();
  const discovery = new YooKassaEarlyBirdRefundDiscovery(
    client,
    {
      findInvoiceByProviderObject: async () => binding.invoiceId,
      findEarlyBirdBinding: async () => binding,
    },
    { findRefundBinding: async () => null },
    () => ({ bind, settle: result }),
  );
  await discovery.handle("ref1");
  expect(bind).toHaveBeenCalledOnce();
  expect(result).toHaveBeenCalledOnce();
  expect(client.getRefund).toHaveBeenCalledTimes(2);
  expect(client.getPayment).toHaveBeenCalledOnce();
});
it("does not bind mismatched provider identities", async () => {
  const client = setup(),
    bind = vi.fn();
  client.getRefund.mockResolvedValueOnce({
    id: "ref1",
    paymentId: "wrong",
    status: "succeeded",
  });
  const discovery = new YooKassaEarlyBirdRefundDiscovery(
    client,
    {
      findInvoiceByProviderObject: async () => binding.invoiceId,
      findEarlyBirdBinding: async () => binding,
    },
    { findRefundBinding: async () => null },
    () => ({ bind, settle: vi.fn() }),
  );
  await expect(discovery.handle("ref1")).rejects.toThrow();
  expect(bind).not.toHaveBeenCalled();
});
