import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { EarlyBirdDeferredCheckoutSender } from "./early-bird-deferred-checkout-sender.js";

it("fences gateway dispatch by the admitted receipt contact, not the user", async () => {
  const userId = crypto.randomUUID(),
    receiptContactId = crypto.randomUUID(),
    invoiceId = crypto.randomUUID();
  const body = "{}",
    digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const dispatch = vi.fn().mockResolvedValue({ kind: "unknown" });
  const sender = new EarlyBirdDeferredCheckoutSender({
    enabled: true,
    admission: {
      admit: async () => ({
        kind: "initial_send_admitted",
        userId,
        receiptContactId,
        invoiceId,
        operationId: invoiceId,
        idempotencyKey: crypto.randomUUID(),
        digest,
        body,
        amountMinor: "1000",
        stage: "onboarding",
      }),
    },
    gateway: { dispatch },
    verifier: {} as never,
    binding: {} as never,
    client: {} as never,
  });
  expect(
    await sender.createOrRecover({ userId, invoiceId, receiptContactId }),
  ).toEqual({
    kind: "reconcile",
    invoiceId,
  });
  expect(dispatch).toHaveBeenCalledOnce();
  expect(dispatch.mock.calls[0]![0]).toBe(receiptContactId);
});

it("returns a provider checkout only after binding and a matching fresh GET", async () => {
  const userId = crypto.randomUUID(),
    receiptContactId = crypto.randomUUID(),
    invoiceId = crypto.randomUUID(),
    grantId = crypto.randomUUID();
  const body = "{}",
    digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const metadata = {
    order_id: invoiceId,
    operation_id: invoiceId,
    user_id: userId,
    purpose: "early_bird_deferred",
    stage: "subscription",
    pricing_policy: "owner_test_10_20_v1",
    pricing_grant_id: grantId,
  };
  const proof = {
    invoiceId,
    operationId: invoiceId,
    userId,
    providerId: "payment1",
    amountMinor: "2000",
    stage: "subscription",
    mode: "live",
    policy: "owner_test_10_20_v1",
    grantId,
  };
  const bind = vi.fn().mockResolvedValue(undefined);
  const sender = new EarlyBirdDeferredCheckoutSender({
    enabled: true,
    admission: {
      admit: async () => ({
        kind: "initial_send_admitted",
        userId,
        receiptContactId,
        invoiceId,
        operationId: invoiceId,
        idempotencyKey: crypto.randomUUID(),
        digest,
        body,
        amountMinor: "2000",
        stage: "subscription",
      }),
    },
    gateway: {
      dispatch: async () => ({ kind: "response", paymentId: "payment1" }),
    },
    verifier: { verify: async () => proof } as never,
    binding: { bind },
    client: {
      getPayment: async () => ({
        id: "payment1",
        status: "pending",
        paid: false,
        test: false,
        amount: { value: "20.00", currency: "RUB" },
        metadata,
        confirmation: { url: "https://yoomoney.ru/checkout" },
      }),
    } as never,
  });
  expect(
    await sender.createOrRecover({ userId, invoiceId, receiptContactId }),
  ).toEqual({
    kind: "ready",
    invoiceId,
    paymentId: "payment1",
    confirmationUrl: "https://yoomoney.ru/checkout",
  });
  expect(bind).toHaveBeenCalledOnce();
});
