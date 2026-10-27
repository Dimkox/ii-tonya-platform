import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { yookassaWebhookRoutes } from "./yookassa-webhook.js";
const payload = {
  type: "notification",
  event: "payment.succeeded",
  object: { id: "synthetic-payment" },
};
async function fixture(handled = true) {
  const handle = vi.fn(async () => handled);
  const verify = vi.fn(async () => null);
  const complete = vi.fn(async () => {});
  const fail = vi.fn(async () => {});
  const deliver = vi.fn(async () => {});
  const resolveSucceeded = vi.fn(async () => {});
  const claim = vi.fn(async () => ({
    kind: "claimed" as const,
    claimId: "synthetic-claim",
  }));
  const app = Fastify({ logger: false });
  await yookassaWebhookRoutes(app, {
    effectivePeerAddress: () => "185.71.76.1",
    inbox: { claim, complete, fail },
    verify,
    deliver,
    resolveSucceeded,
    onboarding: { handle },
  });
  return {
    app,
    handle,
    verify,
    complete,
    fail,
    deliver,
    resolveSucceeded,
    claim,
  };
}
it("routes stored onboarding payment through configured capability before residency verifier", async () => {
  const f = await fixture();
  const r = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload,
  });
  expect(r.statusCode).toBe(200);
  expect(f.handle).toHaveBeenCalledWith(payload);
  expect(f.verify).not.toHaveBeenCalled();
  expect(f.deliver).not.toHaveBeenCalled();
  expect(f.resolveSucceeded).not.toHaveBeenCalled();
  expect(f.complete).toHaveBeenCalledWith("synthetic-claim");
  await f.app.close();
});
it("preserves verified legacy cancellation processing", async () => {
  const f = await fixture(false);
  expect(
    (
      await f.app.inject({
        method: "POST",
        url: "/v1/webhooks/yookassa",
        payload: { ...payload, event: "payment.canceled" },
      })
    ).statusCode,
  ).toBe(200);
  expect(f.verify).toHaveBeenCalled();
  await f.app.close();
});
it("keeps unverified known onboarding payment retryable without legacy fallback", async () => {
  const f = await fixture();
  f.handle.mockRejectedValueOnce(new Error("synthetic-not-paid"));
  const r = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload,
  });
  expect(r.statusCode).toBe(503);
  expect(f.fail).toHaveBeenCalledWith("synthetic-claim");
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.verify).not.toHaveBeenCalled();
  await f.app.close();
});
it("does not process duplicate merchant notification", async () => {
  const f = await fixture();
  f.claim.mockResolvedValueOnce({ kind: "duplicate" } as never);
  expect(
    (
      await f.app.inject({
        method: "POST",
        url: "/v1/webhooks/yookassa",
        payload,
      })
    ).statusCode,
  ).toBe(200);
  expect(f.handle).not.toHaveBeenCalled();
  await f.app.close();
});

it("keeps early success callback retryable until durable binding arrives", async () => {
  const f = await fixture(false);
  f.handle.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const first = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload,
  });
  expect(first.statusCode).toBe(503);
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.fail).toHaveBeenCalledWith("synthetic-claim");
  const second = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload,
  });
  expect(second.statusCode).toBe(200);
  expect(f.complete).toHaveBeenCalledTimes(1);
  await f.app.close();
});

it("retains a distinct unknown refund notification for retry instead of consuming it", async () => {
  const f = await fixture(false);
  const refund = {
    ...payload,
    event: "refund.succeeded",
    object: { id: "synthetic-distinct-refund-id" },
  };
  const r = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: refund,
  });
  expect(r.statusCode).toBe(503);
  expect(f.fail).toHaveBeenCalledWith("synthetic-claim");
  expect(f.complete).not.toHaveBeenCalled();
  await f.app.close();
});
