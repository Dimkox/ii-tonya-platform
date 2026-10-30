import { describe, expect, it } from "vitest";
import {
  YooKassaEarlyBirdVerifier,
  assertVerifiedEarlyBirdPayment,
} from "./early-bird-verifier.js";

const binding = {
  invoiceId: "2526c71d-803f-4c3d-9b57-74e902170001",
  userId: "2526c71d-803f-4c3d-9b57-74e902170002",
  operationId: "2526c71d-803f-4c3d-9b57-74e902170003",
  providerObjectId: "payment_1",
  pricingPolicy: "wave1_standard_v1" as const,
  priceKind: "discounted" as "discounted" | "full_price",
  onboardingMinor: "300000" as const,
  subscriptionMinor: "500000",
  totalMinor: "800000",
  mode: "test" as const,
  launchAt: "2027-01-10T21:00:00.000Z",
  baseOfferShownAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2026-11-11T00:00:00.000Z",
};
const payment = {
  id: "payment_1",
  status: "succeeded",
  paid: true,
  amount: { value: "8000.00", currency: "RUB" },
  test: true,
  createdAt: "2026-11-01T00:00:00.000Z",
  capturedAt: "2026-11-10T00:00:00.000Z",
  metadata: {
    order_id: binding.invoiceId,
    operation_id: binding.operationId,
    user_id: binding.userId,
    purpose: "combined_early_bird",
    price_kind: "discounted",
    pricing_policy: "wave1_standard_v1",
  },
};
const verifier = (p: typeof payment = payment, b: typeof binding = binding) =>
  new YooKassaEarlyBirdVerifier({ getPayment: async () => p } as never, {
    findEarlyBirdBinding: async () => b,
  });

describe("combined early bird payment verification", () => {
  it("mints a proof only after an exact provider GET and stored binding match", async () => {
    const trusted = verifier();
    const proof = await trusted.verify(binding.invoiceId);
    expect(proof?.disposition).toBe("eligible");
    expect(() => assertVerifiedEarlyBirdPayment(proof, trusted)).not.toThrow();
    expect(() => assertVerifiedEarlyBirdPayment({ ...proof }, trusted)).toThrow(
      "early_bird_payment_proof_required",
    );
    expect(() =>
      assertVerifiedEarlyBirdPayment({} as never, undefined as never),
    ).toThrow();
    const forged = await verifier().verify(binding.invoiceId);
    expect(() => assertVerifiedEarlyBirdPayment(forged, trusted)).toThrow(
      "early_bird_payment_proof_required",
    );
  });
  it("routes a captured payment at the expiry boundary to reconciliation", async () => {
    const proof = await verifier({
      ...payment,
      capturedAt: binding.expiresAt,
    }).verify(binding.invoiceId);
    expect(proof?.disposition).toBe("reconcile");
  });
  it("rejects mismatched amounts, metadata, mode and components", async () => {
    for (const p of [
      { ...payment, amount: { ...payment.amount, value: "7999.99" } },
      { ...payment, test: false },
      { ...payment, metadata: { ...payment.metadata, purpose: "onboarding" } },
    ])
      await expect(verifier(p).verify(binding.invoiceId)).rejects.toThrow(
        "early_bird_payment_binding_mismatch",
      );
    await expect(
      verifier(payment, { ...binding, totalMinor: "700000" }).verify(
        binding.invoiceId,
      ),
    ).rejects.toThrow("early_bird_payment_binding_mismatch");
  });
  it("verifies a bound owner test invoice for exactly 30 rubles", async () => {
    const testBinding = {
      ...binding,
      mode: "live" as const,
      pricingPolicy: "owner_test_10_20_v1",
      priceKind: "fixed_test",
      grantId: "2526c71d-803f-4c3d-9b57-74e902170004",
      onboardingMinor: "1000",
      subscriptionMinor: "2000",
      totalMinor: "3000",
    };
    const testPayment = {
      ...payment,
      test: false,
      amount: { value: "30.00", currency: "RUB" },
      metadata: {
        ...payment.metadata,
        price_kind: testBinding.priceKind,
        pricing_policy: testBinding.pricingPolicy,
        pricing_grant_id: testBinding.grantId,
      },
    };
    const v = new YooKassaEarlyBirdVerifier(
      { getPayment: async () => testPayment } as never,
      {
        findEarlyBirdBinding: async () => testBinding as never,
      },
    );
    expect((await v.verify(binding.invoiceId))?.disposition).toBe("eligible");
    const wrong = new YooKassaEarlyBirdVerifier(
      { getPayment: async () => testPayment } as never,
      {
        findEarlyBirdBinding: async () =>
          ({ ...testBinding, grantId: undefined }) as never,
      },
    );
    await expect(wrong.verify(binding.invoiceId)).rejects.toThrow(
      "early_bird_payment_binding_mismatch",
    );
    const wrongMetadata = new YooKassaEarlyBirdVerifier(
      {
        getPayment: async () => ({
          ...testPayment,
          metadata: {
            ...testPayment.metadata,
            pricing_grant_id: binding.userId,
          },
        }),
      } as never,
      { findEarlyBirdBinding: async () => testBinding as never },
    );
    await expect(wrongMetadata.verify(binding.invoiceId)).rejects.toThrow(
      "early_bird_payment_binding_mismatch",
    );
  });
  it("accepts an undiscounted payment after promotion expiry before launch", async () => {
    const full = { ...binding, priceKind: "full_price" as const };
    const fullPayment = {
      ...payment,
      capturedAt: "2026-11-12T00:00:00.000Z",
      metadata: { ...payment.metadata, price_kind: "full_price" },
    };
    expect(
      (await verifier(fullPayment, full).verify(binding.invoiceId))
        ?.disposition,
    ).toBe("eligible");
    await expect(
      verifier(
        {
          ...fullPayment,
          metadata: { ...fullPayment.metadata, price_kind: "discounted" },
        },
        full,
      ).verify(binding.invoiceId),
    ).rejects.toThrow("early_bird_payment_binding_mismatch");
  });
  it("accepts fixed owner pricing after promo expiry before launch", async () => {
    const b = {
      ...binding,
      mode: "live" as const,
      pricingPolicy: "owner_test_10_20_v1",
      priceKind: "fixed_test",
      grantId: "2526c71d-803f-4c3d-9b57-74e902170004",
      onboardingMinor: "1000",
      subscriptionMinor: "2000",
      totalMinor: "3000",
    };
    const p = {
      ...payment,
      test: false,
      amount: { value: "30.00", currency: "RUB" },
      capturedAt: "2026-11-12T00:00:00.000Z",
      metadata: {
        ...payment.metadata,
        pricing_policy: b.pricingPolicy,
        pricing_grant_id: b.grantId,
        price_kind: b.priceKind,
      },
    };
    const v = new YooKassaEarlyBirdVerifier(
      { getPayment: async () => p } as never,
      { findEarlyBirdBinding: async () => b as never },
    );
    expect((await v.verify(binding.invoiceId))?.disposition).toBe("eligible");
  });
  it("rejects owner pricing when the provider mode is test", async () => {
    const b = {
      ...binding,
      pricingPolicy: "owner_test_10_20_v1",
      priceKind: "fixed_test",
      grantId: "2526c71d-803f-4c3d-9b57-74e902170004",
      onboardingMinor: "1000",
      subscriptionMinor: "2000",
      totalMinor: "3000",
    };
    const p = {
      ...payment,
      amount: { value: "30.00", currency: "RUB" },
      metadata: {
        ...payment.metadata,
        price_kind: b.priceKind,
        pricing_policy: b.pricingPolicy,
        pricing_grant_id: b.grantId,
      },
    };
    const v = new YooKassaEarlyBirdVerifier(
      { getPayment: async () => p } as never,
      { findEarlyBirdBinding: async () => b as never },
    );
    await expect(v.verify(binding.invoiceId)).rejects.toThrow(
      "early_bird_payment_binding_mismatch",
    );
  });
  it("rejects an expiry that is not exactly ten days after the first offer", async () => {
    await expect(
      verifier(payment, {
        ...binding,
        expiresAt: "2026-11-12T00:00:00.000Z",
      }).verify(binding.invoiceId),
    ).rejects.toThrow("early_bird_payment_binding_mismatch");
  });
  it("rejects a payment created before the first offer", async () => {
    await expect(
      verifier({ ...payment, createdAt: "2026-10-31T23:59:59.000Z" }).verify(
        binding.invoiceId,
      ),
    ).rejects.toThrow("early_bird_payment_binding_mismatch");
  });
  it("routes a capture after the wave launch to reconciliation, even inside the ten-day window", async () => {
    const lateBinding = {
      ...binding,
      baseOfferShownAt: "2027-01-09T00:00:00.000Z",
      expiresAt: "2027-01-19T00:00:00.000Z",
    };
    const latePayment = {
      ...payment,
      createdAt: "2027-01-09T01:00:00.000Z",
      capturedAt: "2027-01-11T00:00:00.000Z",
    };
    expect(
      (await verifier(latePayment, lateBinding).verify(binding.invoiceId))
        ?.disposition,
    ).toBe("reconcile");
  });
  it("does not mint a proof while payment is pending", async () => {
    await expect(
      verifier({ ...payment, status: "pending", paid: false }).verify(
        binding.invoiceId,
      ),
    ).resolves.toBeNull();
  });
});
