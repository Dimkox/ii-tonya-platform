import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { YooKassaDeferredRefundVerifier } from "@ii-tonya/integrations";
import { DeferredRefundWebhookHandler } from "./early-bird-deferred-refund-handler.js";
it("persists pending and only acknowledges after a verified success commits", async () => {
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
      providerId: "p1",
    };
  let status: "pending" | "succeeded" | "canceled" = "pending";
  const verifier = new YooKassaDeferredRefundVerifier(
    {
      getRefund: async () => ({
        id: "r1",
        paymentId: "p1",
        status,
        amount: { value: "5.00", currency: "RUB" },
        createdAt: "2026-01-03T00:00:00Z",
      }),
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
    { findByProviderPayment: async () => snapshot },
  );
  const store = { bind: vi.fn(), commit: vi.fn(), cancel: vi.fn() },
    handler = new DeferredRefundWebhookHandler(verifier, store),
    notification = {
      type: "notification",
      event: "refund.succeeded",
      object: { id: "r1" },
    } as const;
  expect(await handler.handle(notification)).toBe(false);
  expect(store.bind).toHaveBeenCalledOnce();
  expect(store.commit).not.toHaveBeenCalled();
  status = "succeeded";
  expect(await handler.handle(notification)).toBe(true);
  expect(store.bind).toHaveBeenCalledTimes(2);
  expect(store.commit).toHaveBeenCalledOnce();
  status = "canceled";
  expect(await handler.handle(notification)).toBe(false);
  expect(store.cancel).toHaveBeenCalledOnce();
});
