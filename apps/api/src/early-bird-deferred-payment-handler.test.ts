import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { YooKassaDeferredVerifier } from "@ii-tonya/integrations";
import { DeferredPaymentWebhookHandler } from "./early-bird-deferred-payment-handler.js";
it("settles only fresh verified deferred payment bound to its invoice", async () => {
  const invoiceId = randomUUID(),
    userId = randomUUID(),
    grantId = randomUUID(),
    snapshot = {
      invoiceId,
      operationId: invoiceId,
      userId,
      grantId,
      policy: "owner_test_10_20_v1" as const,
      stage: "subscription" as const,
      amountMinor: "2000",
      mode: "live" as const,
      launchAt: "2027-01-11T00:00:00+03:00",
    };
  const verifier = new YooKassaDeferredVerifier(
    {
      getPayment: async () => ({
        id: "p1",
        status: "succeeded",
        paid: true,
        test: false,
        amount: { value: "20.00", currency: "RUB" },
        createdAt: "2026-01-01T00:00:00Z",
        capturedAt: "2026-01-02T00:00:00Z",
        metadata: {
          order_id: invoiceId,
          operation_id: invoiceId,
          user_id: userId,
          purpose: "early_bird_deferred",
          stage: "subscription",
          pricing_policy: snapshot.policy,
          pricing_grant_id: grantId,
        },
      }),
    } as never,
    { findInvoice: async () => snapshot },
  );
  const reader = {
      findByProviderPayment: vi
        .fn()
        .mockResolvedValue({ ...snapshot, providerId: "p1" }),
    },
    store = { bind: vi.fn(), commit: vi.fn() },
    handler = new DeferredPaymentWebhookHandler(reader, verifier, store);
  expect(
    await handler.handle({
      type: "notification",
      event: "payment.succeeded",
      object: { id: "p1" },
    }),
  ).toBe(true);
  expect(store.bind).toHaveBeenCalledOnce();
  expect(store.commit).toHaveBeenCalledOnce();
  reader.findByProviderPayment.mockResolvedValue({
    ...snapshot,
    providerId: "other",
  });
  await expect(
    handler.handle({
      type: "notification",
      event: "payment.succeeded",
      object: { id: "p1" },
    }),
  ).rejects.toThrow();
  expect(store.commit).toHaveBeenCalledOnce();
});
