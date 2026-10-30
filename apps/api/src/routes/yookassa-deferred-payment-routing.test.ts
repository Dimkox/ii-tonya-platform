import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { yookassaWebhookRoutes } from "./yookassa-webhook.js";
import { createEarlyBirdWebhookRouting } from "../early-bird-webhook-routing.js";
it("routes a verified bound deferred payment to its handler, not legacy", async () => {
  const app = Fastify(),
    handle = vi.fn().mockResolvedValue(true),
    verify = vi.fn(),
    complete = vi.fn();
  const routing = createEarlyBirdWebhookRouting({
    legacy: async () => null,
    findInvoice: async () => null,
    getRefund: vi.fn(),
    exactLegacyRefund: async () => false,
    paymentHandler: { handle: vi.fn() },
    refundDiscovery: { handle: vi.fn() },
    deferredRefund: {
      findByProviderPayment: async () => ({ providerId: "p1" }),
      handle: vi.fn(),
    },
    deferredPaymentHandler: { handle },
    deferredPaymentLookup: {
      findByProviderPayment: async () => ({ providerId: "p1" }),
    },
  });
  await yookassaWebhookRoutes(app, {
    ...routing,
    effectivePeerAddress: () => "185.71.76.1",
    inbox: {
      claim: async () => ({ kind: "claimed", claimId: "c" }),
      complete,
      fail: vi.fn(),
    },
    verify,
    deliver: vi.fn(),
    resolveSucceeded: vi.fn(),
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: {
      type: "notification",
      event: "payment.succeeded",
      object: { id: "p1" },
    },
  });
  expect(res.statusCode).toBe(200);
  expect(handle).toHaveBeenCalledOnce();
  expect(verify).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledOnce();
  await app.close();
});
it("fails closed if legacy and deferred payment bindings conflict", async () => {
  const app = Fastify(),
    handle = vi.fn(),
    fail = vi.fn();
  const routing = createEarlyBirdWebhookRouting({
    legacy: async () => "MAIN_SUBSCRIPTION",
    findInvoice: async () => null,
    getRefund: vi.fn(),
    exactLegacyRefund: async () => false,
    paymentHandler: { handle: vi.fn() },
    refundDiscovery: { handle: vi.fn() },
    deferredRefund: {
      findByProviderPayment: async () => ({ providerId: "p1" }),
      handle: vi.fn(),
    },
    deferredPaymentHandler: { handle },
    deferredPaymentLookup: {
      findByProviderPayment: async () => ({ providerId: "p1" }),
    },
  });
  await yookassaWebhookRoutes(app, {
    ...routing,
    effectivePeerAddress: () => "185.71.76.1",
    inbox: {
      claim: async () => ({ kind: "claimed", claimId: "c" }),
      complete: vi.fn(),
      fail,
    },
    verify: vi.fn(),
    deliver: vi.fn(),
    resolveSucceeded: vi.fn(),
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: {
      type: "notification",
      event: "payment.succeeded",
      object: { id: "p1" },
    },
  });
  expect(res.statusCode).toBe(503);
  expect(handle).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledOnce();
  await app.close();
});
it("rejects partially configured deferred webhook capabilities before startup", () => {
  expect(() =>
    createEarlyBirdWebhookRouting({
      legacy: async () => null,
      findInvoice: async () => null,
      getRefund: vi.fn(),
      exactLegacyRefund: async () => false,
      paymentHandler: { handle: vi.fn() },
      refundDiscovery: { handle: vi.fn() },
      deferredRefund: {
        findByProviderPayment: async () => null,
        handle: vi.fn(),
      },
    }),
  ).toThrow("early_bird_deferred_webhook_incomplete");
});
