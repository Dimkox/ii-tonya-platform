import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { yookassaWebhookRoutes } from "./yookassa-webhook.js";

it("routes a stored composite purpose to its own handler and never to the main verifier", async () => {
  const app = Fastify();
  const handle = vi.fn().mockResolvedValue(true);
  const verify = vi.fn();
  const complete = vi.fn();
  await yookassaWebhookRoutes(app, {
    resolvePurpose: async () => "COMBINED_EARLY_BIRD",
    composite: { handle },
    verify,
    deliver: vi.fn(),
    resolveSucceeded: vi.fn(),
    inbox: {
      claim: async () => ({ kind: "claimed", claimId: "claim" }),
      complete,
      fail: vi.fn(),
    },
    effectivePeerAddress: () => "185.71.76.1",
  });
  const result = await app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: {
      type: "notification",
      event: "payment.succeeded",
      object: { id: "payment-id" },
    },
  });
  expect(result.statusCode).toBe(200);
  expect(handle).toHaveBeenCalledOnce();
  expect(verify).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledOnce();
  await app.close();
});

it("does not acknowledge a composite event when its handler is absent", async () => {
  const app = Fastify();
  const verify = vi.fn();
  const fail = vi.fn();
  await yookassaWebhookRoutes(app, {
    resolvePurpose: async () => "COMBINED_EARLY_BIRD",
    verify,
    deliver: vi.fn(),
    resolveSucceeded: vi.fn(),
    inbox: {
      claim: async () => ({ kind: "claimed", claimId: "claim" }),
      complete: vi.fn(),
      fail,
    },
    effectivePeerAddress: () => "185.71.76.1",
  });
  const result = await app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: {
      type: "notification",
      event: "payment.succeeded",
      object: { id: "payment-id" },
    },
  });
  expect(result.statusCode).toBe(503);
  expect(verify).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledOnce();
  await app.close();
});

it("passes a verified provider payment to the composite store before acknowledging", async () => {
  const { YooKassaEarlyBirdVerifier } =
    await import("../../../../packages/integrations/src/yookassa/early-bird-verifier.js");
  const { YooKassaEarlyBirdWebhookCapability } =
    await import("../../../../packages/integrations/src/yookassa/early-bird-webhook-capability.js");
  const invoiceId = "2526c71d-803f-4c3d-9b57-74e902170001";
  const userId = "2526c71d-803f-4c3d-9b57-74e902170002";
  const operationId = "2526c71d-803f-4c3d-9b57-74e902170003";
  const grantId = "2526c71d-803f-4c3d-9b57-74e902170004";
  const binding = {
    invoiceId,
    userId,
    operationId,
    grantId,
    providerObjectId: "payment-id",
    pricingPolicy: "owner_test_10_20_v1" as const,
    priceKind: "fixed_test" as const,
    onboardingMinor: "1000" as const,
    subscriptionMinor: "2000" as const,
    totalMinor: "3000" as const,
    mode: "live" as const,
    launchAt: "2027-01-10T21:00:00.000Z",
    baseOfferShownAt: "2026-11-01T00:00:00.000Z",
    expiresAt: "2026-11-11T00:00:00.000Z",
  };
  const payment = {
    id: "payment-id",
    status: "succeeded",
    paid: true,
    amount: { value: "30.00", currency: "RUB" },
    test: false,
    createdAt: "2026-11-01T01:00:00.000Z",
    capturedAt: "2026-11-02T00:00:00.000Z",
    metadata: {
      order_id: invoiceId,
      user_id: userId,
      operation_id: operationId,
      purpose: "combined_early_bird",
      pricing_policy: binding.pricingPolicy,
      price_kind: binding.priceKind,
      pricing_grant_id: grantId,
    },
  };
  const verifier = new YooKassaEarlyBirdVerifier(
    { getPayment: async () => payment } as never,
    { findEarlyBirdBinding: async () => binding },
  );
  const commit = vi.fn();
  const composite = new YooKassaEarlyBirdWebhookCapability(
    { findInvoiceByProviderObject: async () => invoiceId, commit },
    verifier,
  );
  const app = Fastify();
  await yookassaWebhookRoutes(app, {
    resolvePurpose: async () => "COMBINED_EARLY_BIRD",
    composite,
    verify: vi.fn(),
    deliver: vi.fn(),
    resolveSucceeded: vi.fn(),
    inbox: {
      claim: async () => ({ kind: "claimed", claimId: "claim" }),
      complete: vi.fn(),
      fail: vi.fn(),
    },
    effectivePeerAddress: () => "185.71.76.1",
  });
  const result = await app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: {
      type: "notification",
      event: "payment.succeeded",
      object: { id: "payment-id" },
    },
  });
  expect(result.statusCode).toBe(200);
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0]?.[0]).toMatchObject({
    invoiceId,
    disposition: "eligible",
    totalMinor: "3000" as const,
  });
  await app.close();
});
