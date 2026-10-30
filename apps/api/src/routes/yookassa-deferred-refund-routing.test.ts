import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { yookassaWebhookRoutes } from "./yookassa-webhook.js";
import { createEarlyBirdWebhookRouting } from "../early-bird-webhook-routing.js";
it("routes a deferred refund only to its durable handler before acknowledging", async () => {
  const app = Fastify(),
    handle = vi.fn().mockResolvedValue(true),
    legacy = vi.fn().mockResolvedValue(null),
    verify = vi.fn(),
    complete = vi.fn();
  const routing = createEarlyBirdWebhookRouting({
    legacy,
    findInvoice: async () => null,
    getRefund: async () => ({
      id: "refund",
      paymentId: "deferred-pay",
      status: "succeeded",
    }),
    exactLegacyRefund: async () => false,
    paymentHandler: { handle: vi.fn() },
    refundDiscovery: { handle: vi.fn() },
    deferredRefund: { findByProviderPayment: async () => ({}), handle },
    deferredPaymentHandler: { handle: vi.fn() },
    deferredPaymentLookup: { findByProviderPayment: async () => ({}) },
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
      event: "refund.succeeded",
      object: { id: "refund" },
    },
  });
  expect(res.statusCode).toBe(200);
  expect(handle).toHaveBeenCalledOnce();
  expect(verify).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledOnce();
  await app.close();
});
it("rejects ambiguous deferred/composite bindings and never acknowledges", async () => {
  const app = Fastify(),
    handle = vi.fn(),
    fail = vi.fn();
  const routing = createEarlyBirdWebhookRouting({
    legacy: async () => null,
    findInvoice: async () => "invoice",
    getRefund: async () => ({
      id: "refund",
      paymentId: "p1",
      status: "succeeded",
    }),
    exactLegacyRefund: async () => false,
    paymentHandler: { handle: vi.fn() },
    refundDiscovery: { handle: vi.fn() },
    deferredRefund: { findByProviderPayment: async () => ({}), handle },
    deferredPaymentHandler: { handle: vi.fn() },
    deferredPaymentLookup: { findByProviderPayment: async () => ({}) },
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
      event: "refund.succeeded",
      object: { id: "refund" },
    },
  });
  expect(res.statusCode).toBe(503);
  expect(handle).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledOnce();
  await app.close();
});
