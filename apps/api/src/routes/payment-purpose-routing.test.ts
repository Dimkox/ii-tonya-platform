import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import {
  yookassaWebhookRoutes,
  type BoundPaymentPurpose,
} from "./yookassa-webhook.js";
const notification = {
  type: "notification",
  event: "payment.succeeded",
  object: { id: "bound-payment", metadata: { purpose: "MAIN_SUBSCRIPTION" } },
};
async function fixture(purpose: BoundPaymentPurpose | null) {
  const resolvePurpose = vi.fn().mockResolvedValue(purpose),
    handle = vi.fn().mockResolvedValue(true),
    verify = vi.fn().mockResolvedValue({ kind: "settled" }),
    deliver = vi.fn(),
    resolveSucceeded = vi.fn(),
    complete = vi.fn(),
    fail = vi.fn();
  const app = Fastify();
  await yookassaWebhookRoutes(app, {
    resolvePurpose,
    onboarding: { handle },
    verify,
    deliver,
    resolveSucceeded,
    inbox: {
      claim: async () => ({ kind: "claimed", claimId: "claim" }),
      complete,
      fail,
    },
    effectivePeerAddress: () => "185.71.76.1",
  });
  return {
    app,
    resolvePurpose,
    handle,
    verify,
    deliver,
    resolveSucceeded,
    complete,
    fail,
  };
}
it("routes ONBOARDING_FEE solely from its stored binding despite forged main metadata", async () => {
  const f = await fixture("ONBOARDING_FEE");
  const result = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: notification,
  });
  expect(result.statusCode).toBe(200);
  expect(f.resolvePurpose).toHaveBeenCalledWith(
    "bound-payment",
    "payment.succeeded",
  );
  expect(f.handle).toHaveBeenCalledOnce();
  expect(f.verify).not.toHaveBeenCalled();
  expect(f.deliver).not.toHaveBeenCalled();
  await f.app.close();
});
it("routes MAIN_SUBSCRIPTION only to canonical main verifier despite forged onboarding metadata", async () => {
  const f = await fixture("MAIN_SUBSCRIPTION");
  const result = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: {
      ...notification,
      object: { id: "bound-payment", metadata: { purpose: "ONBOARDING_FEE" } },
    },
  });
  expect(result.statusCode).toBe(200);
  expect(f.handle).not.toHaveBeenCalled();
  expect(f.verify).toHaveBeenCalledOnce();
  expect(f.deliver).toHaveBeenCalledOnce();
  expect(f.resolveSucceeded).toHaveBeenCalledOnce();
  await f.app.close();
});
it("keeps missing binding retryable without any provider or payment mutation", async () => {
  const f = await fixture(null);
  const result = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: notification,
  });
  expect(result.statusCode).toBe(503);
  expect(f.handle).not.toHaveBeenCalled();
  expect(f.verify).not.toHaveBeenCalled();
  expect(f.deliver).not.toHaveBeenCalled();
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.fail).toHaveBeenCalledOnce();
  await f.app.close();
});
it("never falls back from a known fee purpose to main verifier", async () => {
  const f = await fixture("ONBOARDING_FEE");
  f.handle.mockResolvedValue(false);
  const result = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: notification,
  });
  expect(result.statusCode).toBe(503);
  expect(f.verify).not.toHaveBeenCalled();
  expect(f.deliver).not.toHaveBeenCalled();
  await f.app.close();
});
it("looks up distinct refund IDs in durable operation-kind scope", async () => {
  const f = await fixture("MAIN_SUBSCRIPTION");
  await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: {
      ...notification,
      event: "refund.succeeded",
      object: { id: "refund-object" },
    },
  });
  expect(f.resolvePurpose).toHaveBeenCalledWith(
    "refund-object",
    "refund.succeeded",
  );
  expect(f.handle).not.toHaveBeenCalled();
  await f.app.close();
});
