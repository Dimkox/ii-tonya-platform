import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { yookassaWebhookRoutes } from "./yookassa-webhook.js";
import { createEarlyBirdWebhookRouting } from "../early-bird-webhook-routing.js";
function setup() {
  const inbox = {
    claim: vi.fn(async () => ({ kind: "claimed" as const, claimId: "claim" })),
    complete: vi.fn(),
    fail: vi.fn(),
  };
  const legacy = vi.fn(
    async (
      id: string,
      event: string,
    ): Promise<"ONBOARDING_FEE" | "MAIN_SUBSCRIPTION" | null> =>
      (id === "legacy-ref" && event === "refund.succeeded") ||
      (id === "legacy-pay" && event === "payment.succeeded")
        ? ("MAIN_SUBSCRIPTION" as const)
        : null,
  );
  const getRefund = vi.fn(async (id: string) => ({
    id,
    paymentId: id === "legacy-ref" ? "legacy-pay" : "wave-pay",
    status: "succeeded" as const,
  }));
  const findInvoice = vi.fn(async (id: string) =>
    id === "wave-pay" ? "invoice" : null,
  );
  const exact = vi.fn(async () => true);
  const payment = vi.fn(async () => true),
    refund = vi.fn(async () => true);
  const routing = createEarlyBirdWebhookRouting({
    legacy,
    findInvoice,
    getRefund,
    exactLegacyRefund: exact,
    paymentHandler: { handle: payment },
    refundDiscovery: { handle: refund },
  });
  return {
    inbox,
    routing,
    legacy,
    getRefund,
    findInvoice,
    exact,
    payment,
    refund,
  };
}
async function appWith(f: ReturnType<typeof setup>) {
  const app = Fastify(),
    verify = vi.fn(async () => ({}) as never),
    deliver = vi.fn();
  await yookassaWebhookRoutes(app, {
    ...f.routing,
    inbox: f.inbox,
    effectivePeerAddress: () => "185.71.76.1",
    verify,
    deliver,
    resolveSucceeded: vi.fn(),
  });
  return { app, verify, deliver };
}
const notify = (
  app: ReturnType<typeof Fastify>,
  id: string,
  event = "refund.succeeded",
) =>
  app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: { type: "notification", event, object: { id } },
  });
it("routes a composite refund through discovery before acknowledgement", async () => {
  const f = setup(),
    { app, verify } = await appWith(f);
  const response = await notify(app, "wave-ref");
  expect(response.statusCode).toBe(200);
  expect(f.refund).toHaveBeenCalledWith("wave-ref");
  expect(verify).not.toHaveBeenCalled();
  expect(f.inbox.complete).toHaveBeenCalledOnce();
  await app.close();
});
it("preserves legacy refund verification and delivery", async () => {
  const f = setup(),
    { app, verify, deliver } = await appWith(f);
  const response = await notify(app, "legacy-ref");
  expect(response.statusCode).toBe(200);
  expect(f.refund).not.toHaveBeenCalled();
  expect(verify).toHaveBeenCalledOnce();
  expect(deliver).toHaveBeenCalledOnce();
  await app.close();
});
it("returns retryable failure when composite settlement is unavailable", async () => {
  const f = setup();
  f.refund.mockResolvedValue(false);
  const { app } = await appWith(f);
  const response = await notify(app, "wave-ref");
  expect(response.statusCode).toBe(503);
  expect(f.inbox.fail).toHaveBeenCalledOnce();
  expect(f.inbox.complete).not.toHaveBeenCalled();
  await app.close();
});
it("verifies the provider refund and commits branded proof before acknowledging", async () => {
  const { YooKassaEarlyBirdRefundDiscovery } =
    await import("../../../../packages/integrations/src/yookassa/early-bird-refund-discovery.js");
  const userId = "2526c71d-803f-4c3d-9b57-74e902170002",
    invoiceId = "2526c71d-803f-4c3d-9b57-74e902170001",
    operationId = "2526c71d-803f-4c3d-9b57-74e902170003",
    grantId = "2526c71d-803f-4c3d-9b57-74e902170004";
  const binding = {
    invoiceId,
    userId,
    operationId,
    grantId,
    providerObjectId: "wave-pay",
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
  const getRefund = vi.fn(async () => ({
    id: "wave-ref",
    paymentId: "wave-pay",
    status: "succeeded" as const,
    amount: { value: "10.00", currency: "RUB" as const },
    createdAt: "2026-01-03T00:00:00.000Z",
  }));
  const getPayment = vi.fn(async () => ({
    id: "wave-pay",
    status: "succeeded" as const,
    paid: true,
    refundable: true,
    test: false,
    amount: { value: "30.00", currency: "RUB" as const },
    createdAt: "2026-01-01T00:00:00.000Z",
    capturedAt: "2026-01-02T00:00:00.000Z",
    metadata: {
      order_id: invoiceId,
      operation_id: operationId,
      user_id: userId,
      purpose: "combined_early_bird",
      pricing_policy: binding.pricingPolicy,
      price_kind: binding.priceKind,
      pricing_grant_id: grantId,
    },
  }));
  const bind = vi.fn(),
    settle = vi.fn(),
    discovery = new YooKassaEarlyBirdRefundDiscovery(
      { getRefund, getPayment },
      {
        findInvoiceByProviderObject: async () => invoiceId,
        findEarlyBirdBinding: async () => binding,
      },
      { findRefundBinding: async () => null },
      () => ({ bind, settle }),
    );
  const f = setup();
  f.routing = createEarlyBirdWebhookRouting({
    legacy: f.legacy,
    findInvoice: f.findInvoice,
    getRefund,
    exactLegacyRefund: f.exact,
    paymentHandler: { handle: f.payment },
    refundDiscovery: discovery,
  });
  const { app } = await appWith(f);
  const response = await notify(app, "wave-ref");
  expect(response.statusCode).toBe(200);
  expect(bind).toHaveBeenCalledOnce();
  expect(settle).toHaveBeenCalledOnce();
  expect(settle.mock.calls[0]?.[0]).toMatchObject({
    refundId: "wave-ref",
    disposition: "reconcile",
    amountMinor: "1000",
  });
  expect(getRefund).toHaveBeenCalledTimes(3);
  expect(f.inbox.complete).toHaveBeenCalledOnce();
  await app.close();
});
it("retries after a temporary failure and acknowledges only the successful attempt", async () => {
  const f = setup();
  f.refund.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const { app } = await appWith(f);
  expect((await notify(app, "wave-ref")).statusCode).toBe(503);
  expect(f.inbox.complete).not.toHaveBeenCalled();
  expect((await notify(app, "wave-ref")).statusCode).toBe(200);
  expect(f.inbox.fail).toHaveBeenCalledOnce();
  expect(f.inbox.complete).toHaveBeenCalledOnce();
  await app.close();
});
it("keeps legacy onboarding and legacy subscription payments on their existing handlers", async () => {
  const f = setup();
  f.legacy.mockImplementation(async (id) =>
    id === "onboard"
      ? "ONBOARDING_FEE"
      : id === "legacy-pay"
        ? "MAIN_SUBSCRIPTION"
        : null,
  );
  const app = Fastify(),
    onboarding = vi.fn().mockResolvedValue(true),
    verify = vi.fn().mockResolvedValue({}),
    deliver = vi.fn();
  await yookassaWebhookRoutes(app, {
    ...f.routing,
    onboarding: { handle: onboarding },
    inbox: f.inbox,
    effectivePeerAddress: () => "185.71.76.1",
    verify,
    deliver,
    resolveSucceeded: vi.fn(),
  });
  expect((await notify(app, "onboard", "payment.succeeded")).statusCode).toBe(
    200,
  );
  expect(onboarding).toHaveBeenCalledOnce();
  expect(verify).not.toHaveBeenCalled();
  expect(
    (await notify(app, "legacy-pay", "payment.succeeded")).statusCode,
  ).toBe(200);
  expect(verify).toHaveBeenCalledOnce();
  expect(deliver).toHaveBeenCalledOnce();
  await app.close();
});
it("fails closed if a payment matches both legacy and early bird bindings", async () => {
  const f = setup();
  f.legacy.mockResolvedValue("MAIN_SUBSCRIPTION");
  const { app, verify } = await appWith(f);
  expect((await notify(app, "wave-pay", "payment.succeeded")).statusCode).toBe(
    503,
  );
  expect(verify).not.toHaveBeenCalled();
  expect(f.payment).not.toHaveBeenCalled();
  expect(f.inbox.fail).toHaveBeenCalledOnce();
  await app.close();
});
