import { expect, it } from "vitest";
import {
  YooKassaOnboardingPaymentVerifier,
  type OnboardingPaymentBinding,
  type VerifiedOnboardingPayment,
} from "./onboarding-verifier.js";
import { YooKassaOnboardingWebhookCapability } from "./onboarding-webhook-capability.js";
import type { YooKassaNotification } from "./contracts.js";
const binding: OnboardingPaymentBinding = {
  invoiceId: "00000000-0000-4000-8000-000000000001",
  applicationId: "00000000-0000-4000-8000-000000000002",
  userId: "00000000-0000-4000-8000-000000000003",
  operationId: "00000000-0000-4000-8000-000000000004",
  providerObjectId: "synthetic_payment",
  purpose: "onboarding",
  amountMinor: "300000",
  currency: "RUB",
  mode: "test",
};
const notification: YooKassaNotification = {
  type: "notification",
  event: "payment.succeeded",
  object: { id: binding.providerObjectId },
};
function fixture(known = true, pending = false) {
  const reads: string[] = [];
  const settlements: VerifiedOnboardingPayment[] = [];
  const verifier = new YooKassaOnboardingPaymentVerifier(
    {
      getPayment: async (id) => {
        reads.push(id);
        return {
          id,
          status: pending ? "pending" : "succeeded",
          paid: !pending,
          test: true,
          amount: { value: "3000.00", currency: "RUB" },
          createdAt: "2026-10-23T10:00:00.000Z",
          ...(!pending ? { capturedAt: "2026-10-23T10:01:00.000Z" } : {}),
          metadata: { order_id: binding.invoiceId },
          refundable: true,
        };
      },
    },
    { findOnboardingPaymentBinding: async () => binding },
  );
  const capability = new YooKassaOnboardingWebhookCapability(
    {
      findOnboardingInvoiceByProviderObjectId: async (paymentId) =>
        known && paymentId === binding.providerObjectId
          ? binding.invoiceId
          : null,
    },
    verifier,
    {
      settleVerified: async (proof) => {
        settlements.push(proof);
        return { kind: "interview" };
      },
    },
  );
  return { capability, reads, settlements };
}
it("looks up immutable onboarding ownership then performs GET before settlement", async () => {
  const f = fixture();
  expect(await f.capability.handle(notification)).toBe(true);
  expect(f.reads).toEqual([binding.providerObjectId]);
  expect(f.settlements).toHaveLength(1);
  expect(f.settlements[0]).toMatchObject({ ...binding, provider: "yookassa" });
});
it("leaves unknown provider objects for existing legacy handling without GET", async () => {
  const f = fixture(false);
  expect(await f.capability.handle(notification)).toBe(false);
  expect(f.reads).toEqual([]);
  expect(f.settlements).toEqual([]);
});
it("retains known nonfinal payments for bounded retry", async () => {
  const f = fixture(true, true);
  await expect(f.capability.handle(notification)).rejects.toThrow(
    "onboarding_payment_not_final",
  );
  expect(f.settlements).toEqual([]);
});
it.each(["payment.waiting_for_capture", "payment.canceled"] as const)(
  "does not pass known onboarding%s to residency handling",
  async (event) => {
    const f = fixture();
    await expect(
      f.capability.handle({ ...notification, event }),
    ).rejects.toThrow("onboarding_payment_manual_review_required");
    expect(f.reads).toEqual([]);
    expect(f.settlements).toEqual([]);
  },
);
it("rejects a lookalike proof from an injected verifier", async () => {
  let settled = false;
  const capability = new YooKassaOnboardingWebhookCapability(
    { findOnboardingInvoiceByProviderObjectId: async () => binding.invoiceId },
    {
      verify: async () =>
        ({
          ...binding,
          provider: "yookassa",
          capturedAt: "2026-10-23T10:01:00.000Z",
          eventId: "forged",
          evidenceDigest: "forged",
        }) as VerifiedOnboardingPayment,
    },
    {
      settleVerified: async () => {
        settled = true;
      },
    },
  );
  await expect(capability.handle(notification)).rejects.toThrow(
    "onboarding_webhook_unavailable",
  );
  expect(settled).toBe(false);
});
it("does not let additional callback metadata override stored purpose or owner", async () => {
  const f = fixture();
  expect(
    await f.capability.handle({
      ...notification,
      object: {
        id: binding.providerObjectId,
        user_id: "attacker",
        purpose: "residency",
      },
    } as YooKassaNotification),
  ).toBe(true);
  expect(f.settlements[0]?.userId).toBe(binding.userId);
  expect(f.settlements[0]?.purpose).toBe("onboarding");
});
it("rejects malformed notifications before lookup", async () => {
  let called = false;
  const capability = new YooKassaOnboardingWebhookCapability(
    {
      findOnboardingInvoiceByProviderObjectId: async () => {
        called = true;
        return null;
      },
    },
    { verify: async () => null },
    { settleVerified: async () => undefined },
  );
  await expect(
    capability.handle({
      object: { id: "bad/path" },
      event: "payment.succeeded",
    } as YooKassaNotification),
  ).rejects.toThrow("onboarding_webhook_invalid");
  expect(called).toBe(false);
});
it("sanitizes infrastructure errors and does not fall through to residency", async () => {
  const capability = new YooKassaOnboardingWebhookCapability(
    {
      findOnboardingInvoiceByProviderObjectId: async () => {
        throw new Error("synthetic_secret");
      },
    },
    { verify: async () => null },
    { settleVerified: async () => undefined },
  );
  await expect(capability.handle(notification)).rejects.toThrow(
    /^onboarding_webhook_unavailable$/u,
  );
});
it("rejects a real branded proof for another stored invoice", async () => {
  const f = fixture();
  await f.capability.handle(notification);
  const proof = f.settlements[0]!;
  let settled = false;
  const capability = new YooKassaOnboardingWebhookCapability(
    {
      findOnboardingInvoiceByProviderObjectId: async () =>
        "00000000-0000-4000-8000-000000000009",
    },
    { verify: async () => proof },
    {
      settleVerified: async () => {
        settled = true;
      },
    },
  );
  await expect(capability.handle(notification)).rejects.toThrow(
    "onboarding_webhook_binding_mismatch",
  );
  expect(settled).toBe(false);
});

it("leaves a distinct refund ID to legacy refund lookup without misclassifying it as a payment", async () => {
  const refundId = "synthetic_refund_distinct_from_payment";
  expect(refundId).not.toBe(binding.providerObjectId);
  let paymentLookup = false,
    providerRead = false,
    settled = false;
  const capability = new YooKassaOnboardingWebhookCapability(
    {
      findOnboardingInvoiceByProviderObjectId: async () => {
        paymentLookup = true;
        throw new Error("refund ID must not enter payment lookup");
      },
    },
    {
      verify: async () => {
        providerRead = true;
        return null;
      },
    },
    {
      settleVerified: async () => {
        settled = true;
      },
    },
  );
  expect(
    await capability.handle({
      type: "notification",
      event: "refund.succeeded",
      object: { id: refundId },
    }),
  ).toBe(false);
  expect({ paymentLookup, providerRead, settled }).toEqual({
    paymentLookup: false,
    providerRead: false,
    settled: false,
  });
});
