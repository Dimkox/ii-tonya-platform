import { describe, expect, it } from "vitest";
import { createYooKassaClient } from "./client.js";
import type { YooKassaPayment } from "./contracts.js";
import {
  YooKassaOnboardingPaymentVerifier,
  assertVerifiedOnboardingPayment,
  type OnboardingPaymentBinding,
} from "./onboarding-verifier.js";
const binding: OnboardingPaymentBinding = {
  invoiceId: "00000000-0000-4000-8000-000000000001",
  applicationId: "00000000-0000-4000-8000-000000000002",
  userId: "00000000-0000-4000-8000-000000000003",
  operationId: "00000000-0000-4000-8000-000000000004",
  providerObjectId: "synthetic_onboarding_payment",
  purpose: "onboarding",
  amountMinor: "300000",
  currency: "RUB",
  mode: "test",
};
const payment = (): YooKassaPayment => ({
  id: binding.providerObjectId,
  status: "succeeded",
  paid: true,
  amount: { value: "3000.00", currency: "RUB" },
  test: true,
  createdAt: "2026-10-23T10:00:00.000Z",
  capturedAt: "2026-10-23T10:01:00.000Z",
  metadata: {
    order_id: binding.invoiceId,
    user_id: binding.userId,
    purpose: "onboarding",
    operation_id: binding.operationId,
  },
  refundable: true,
});
function fixture(value: unknown = payment(), stored: unknown = binding) {
  const calls: string[] = [];
  const verifier = new YooKassaOnboardingPaymentVerifier(
    {
      getPayment: async (id) => {
        calls.push(id);
        return value as YooKassaPayment;
      },
    },
    {
      findOnboardingPaymentBinding: async () =>
        stored as OnboardingPaymentBinding | null,
    },
  );
  return { verifier, calls };
}
describe("purpose-bound onboarding GET verifier", () => {
  it("creates only a frozen private proof from authoritative GET facts", async () => {
    const f = fixture();
    const proof = await f.verifier.verify(binding.invoiceId);
    expect(proof).toMatchObject({
      ...binding,
      capturedAt: payment().capturedAt,
      provider: "yookassa",
    });
    expect(f.calls).toEqual([binding.providerObjectId]);
    expect(Object.isFrozen(proof)).toBe(true);
    expect(() => assertVerifiedOnboardingPayment(proof)).not.toThrow();
    expect(proof?.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(proof?.eventId).toBe(
      `yookassa:onboarding:${binding.providerObjectId}:succeeded`,
    );
    expect(() => assertVerifiedOnboardingPayment({ ...proof })).toThrow(
      "onboarding_payment_proof_required",
    );
    expect(() =>
      assertVerifiedOnboardingPayment(JSON.parse(JSON.stringify(proof))),
    ).toThrow("onboarding_payment_proof_required");
  });
  it("returns deterministic replay evidence without minting a residency event", async () => {
    const f = fixture();
    expect(await f.verifier.verify(binding.invoiceId)).toEqual(
      await f.verifier.verify(binding.invoiceId),
    );
  });
  it("handles missing bindings without reading provider data", async () => {
    const f = fixture(payment(), null);
    expect(await f.verifier.verify(binding.invoiceId)).toBeNull();
    expect(f.calls).toEqual([]);
  });
  it.each(["pending", "waiting_for_capture", "canceled"] as const)(
    "does not admit nonsettled%s",
    async (status) => {
      const f = fixture({
        ...payment(),
        status,
        paid: false,
        capturedAt: undefined,
      });
      expect(await f.verifier.verify(binding.invoiceId)).toBeNull();
    },
  );
  it.each([
    { id: "another_payment" },
    { paid: false },
    { test: false },
    { capturedAt: undefined },
    { capturedAt: "Infinity" },
    { capturedAt: "2026-02-30T00:00:00Z" },
    { capturedAt: "2026-10-23T09:59:00.000Z" },
    { amount: { value: "3000.01", currency: "RUB" } },
    { amount: { value: "3000.0", currency: "RUB" } },
    { amount: { value: "3000.00", currency: "USD" } },
    { metadata: { order_id: binding.userId } },
    { metadata: { order_id: binding.invoiceId, user_id: binding.invoiceId } },
    { metadata: { order_id: binding.invoiceId, purpose: "residency" } },
    {
      metadata: {
        order_id: binding.invoiceId,
        operation_id: binding.invoiceId,
      },
    },
    { metadata: null },
  ])("rejects mismatched or unsafe GET facts%j", async (change) => {
    const f = fixture({ ...payment(), ...change });
    await expect(f.verifier.verify(binding.invoiceId)).rejects.toThrow(
      "onboarding_payment_binding_mismatch",
    );
  });
  it("does not infer owner or purpose from optional metadata", async () => {
    const f = fixture({
      ...payment(),
      metadata: { order_id: binding.invoiceId },
    });
    expect(await f.verifier.verify(binding.invoiceId)).toMatchObject({
      userId: binding.userId,
      purpose: "onboarding",
    });
  });
  it.each([
    { purpose: "residency" },
    { amountMinor: "300001" },
    { currency: "USD" },
    { mode: "sandbox" },
    { userId: "bad" },
    { providerObjectId: "bad/id" },
    { invoiceId: "00000000-0000-4000-8000-000000000009" },
  ])("rejects unsafe stored binding before GET%j", async (change) => {
    const f = fixture(payment(), { ...binding, ...change });
    await expect(f.verifier.verify(binding.invoiceId)).rejects.toThrow(
      "onboarding_payment_binding_mismatch",
    );
    expect(f.calls).toEqual([]);
  });
  it("captures stored binding before awaiting the GET", async () => {
    const original = { ...binding };
    const verifier = new YooKassaOnboardingPaymentVerifier(
      {
        getPayment: async () => {
          original.userId = binding.invoiceId;
          return payment();
        },
      },
      { findOnboardingPaymentBinding: async () => original },
    );
    expect(await verifier.verify(binding.invoiceId)).toMatchObject({
      userId: binding.userId,
    });
  });
  it("sanitizes repository and transport failures", async () => {
    const v = new YooKassaOnboardingPaymentVerifier(
      {
        getPayment: async () => {
          throw new Error("synthetic_secret_pii");
        },
      },
      { findOnboardingPaymentBinding: async () => binding },
    );
    await expect(v.verify(binding.invoiceId)).rejects.toThrow(
      /^onboarding_payment_verification_unavailable$/u,
    );
  });
  it("uses the real fixed-origin client GET decoder with an injected synthetic transport", async () => {
    const requests: { url: string; method: string | undefined }[] = [];
    const client = createYooKassaClient(
      { mode: "test", shopId: "test-shop", secretKey: "synthetic-secret" },
      async (url, init) => {
        requests.push({ url, method: init.method });
        return new Response(
          JSON.stringify({
            id: binding.providerObjectId,
            status: "succeeded",
            paid: true,
            amount: { value: "3000.00", currency: "RUB" },
            test: true,
            created_at: "2026-10-23T10:00:00.000Z",
            captured_at: "2026-10-23T10:01:00.000Z",
            metadata: { order_id: binding.invoiceId },
            refundable: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const v = new YooKassaOnboardingPaymentVerifier(client, {
      findOnboardingPaymentBinding: async () => binding,
    });
    expect(await v.verify(binding.invoiceId)).toMatchObject({
      purpose: "onboarding",
    });
    expect(requests).toEqual([
      {
        url: `https://api.yookassa.ru/v3/payments/${binding.providerObjectId}`,
        method: "GET",
      },
    ]);
  });
});
