import { describe, expect, it } from "vitest";
import {
  YooKassaEarlyBirdCandidateVerifier,
  assertVerifiedEarlyBirdCandidate,
} from "./early-bird-candidate-verifier.js";
const intent = {
  invoiceId: "2526c71d-803f-4c3d-9b57-74e902170001",
  userId: "2526c71d-803f-4c3d-9b57-74e902170002",
  operationId: "2526c71d-803f-4c3d-9b57-74e902170003",
  grantId: "2526c71d-803f-4c3d-9b57-74e902170004",
  pricingPolicy: "owner_test_10_20_v1" as const,
  priceKind: "fixed_test" as const,
  onboardingMinor: "1000" as const,
  subscriptionMinor: "2000" as const,
  totalMinor: "3000" as const,
  mode: "live" as const,
  baseOfferShownAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2026-11-11T00:00:00.000Z",
  launchAt: "2027-01-10T21:00:00.000Z",
};
const payment = {
  id: "p1",
  status: "pending",
  paid: false,
  amount: { value: "30.00", currency: "RUB" },
  test: false,
  createdAt: "2026-11-01T01:00:00.000Z",
  metadata: {
    order_id: intent.invoiceId,
    user_id: intent.userId,
    operation_id: intent.operationId,
    purpose: "combined_early_bird",
    pricing_policy: intent.pricingPolicy,
    price_kind: intent.priceKind,
    pricing_grant_id: intent.grantId,
  },
};
const verify = (p = payment, i = intent) =>
  new YooKassaEarlyBirdCandidateVerifier(
    { getPayment: async () => p } as never,
    { findIntent: async () => i },
  );
describe("candidate provider payment binding", () => {
  it("mints a proof only for a fresh matching provider GET and persisted intent", async () => {
    const trusted = verify();
    const proof = await trusted.verify(intent.operationId, "p1");
    expect(proof).toMatchObject({
      operationId: intent.operationId,
      providerObjectId: "p1",
      providerStatus: "pending",
    });
    expect(() =>
      assertVerifiedEarlyBirdCandidate(proof, trusted),
    ).not.toThrow();
    expect(() =>
      assertVerifiedEarlyBirdCandidate({ ...proof }, trusted),
    ).toThrow();
    expect(() =>
      assertVerifiedEarlyBirdCandidate({} as never, undefined as never),
    ).toThrow();
    const forged = await verify().verify(intent.operationId, "p1");
    expect(() => assertVerifiedEarlyBirdCandidate(forged, trusted)).toThrow();
  });
  it("rejects substitution of amount, operation, grant, mode, and chronology", async () => {
    for (const p of [
      { ...payment, amount: { value: "29.99", currency: "RUB" } },
      { ...payment, test: true },
      { ...payment, createdAt: "2026-10-31T23:00:00.000Z" },
      {
        ...payment,
        metadata: { ...payment.metadata, pricing_grant_id: intent.userId },
      },
      {
        ...payment,
        metadata: { ...payment.metadata, operation_id: intent.userId },
      },
    ])
      await expect(verify(p).verify(intent.operationId, "p1")).rejects.toThrow(
        "early_bird_candidate_mismatch",
      );
    await expect(
      verify(payment, {
        ...intent,
        expiresAt: "2026-11-12T00:00:00.000Z",
      }).verify(intent.operationId, "p1"),
    ).rejects.toThrow("early_bird_candidate_mismatch");
  });
  it("rejects inconsistent terminal status and absent binding", async () => {
    await expect(
      verify({ ...payment, status: "succeeded", paid: false }).verify(
        intent.operationId,
        "p1",
      ),
    ).rejects.toThrow("early_bird_candidate_mismatch");
    const missing = new YooKassaEarlyBirdCandidateVerifier(
      { getPayment: async () => payment } as never,
      { findIntent: async () => null },
    );
    await expect(missing.verify(intent.operationId, "p1")).rejects.toThrow(
      "early_bird_candidate_mismatch",
    );
  });
});

it.each([
  ["waiting_for_capture", true],
  ["succeeded", true],
  ["canceled", false],
] as const)(
  "verifies provider state %s without assuming settlement",
  async (status, paid) => {
    const proof = await verify({
      ...payment,
      status,
      paid,
      ...(status === "succeeded"
        ? { capturedAt: "2026-11-01T02:00:00.000Z" }
        : {}),
    }).verify(intent.operationId, "p1");
    expect(proof.providerStatus).toBe(status);
  },
);

it("rejects the candidate if GET returned a different provider object", async () => {
  await expect(
    verify({ ...payment, id: "other" }).verify(intent.operationId, "p1"),
  ).rejects.toThrow("early_bird_candidate_mismatch");
});

it("verifies a standard candidate against the stored snapshot and actual total", async () => {
  const standard = {
    invoiceId: intent.invoiceId,
    userId: intent.userId,
    operationId: intent.operationId,
    pricingPolicy: "wave1_standard_v1",
    priceKind: "discounted",
    mode: "live",
    baseMonthlyMinor: "1000000",
    onboardingMinor: "300000",
    subscriptionMinor: "600000",
    totalMinor: "900000",
    baseOfferShownAt: intent.baseOfferShownAt,
    expiresAt: intent.expiresAt,
    launchAt: intent.launchAt,
    ruleVersion: "expert_separated_sales_v3",
    participantKind: "expert",
    promotionEligible: true,
    quotedAt: "2026-11-01T00:30:00.000Z",
  };
  const observed = {
    ...payment,
    amount: { value: "9000.00", currency: "RUB" },
    metadata: {
      order_id: standard.invoiceId,
      user_id: standard.userId,
      operation_id: standard.operationId,
      purpose: "combined_early_bird",
      pricing_policy: standard.pricingPolicy,
      price_kind: standard.priceKind,
    },
  };
  const verifier = new YooKassaEarlyBirdCandidateVerifier(
    { getPayment: async () => observed } as never,
    { findIntent: async () => standard as never },
  );
  const stale = new YooKassaEarlyBirdCandidateVerifier(
    {
      getPayment: async () => ({
        ...observed,
        createdAt: "2026-11-01T00:15:00.000Z",
      }),
    } as never,
    { findIntent: async () => standard as never },
  );
  await expect(stale.verify(intent.operationId, "p1")).rejects.toThrow(
    "early_bird_candidate_mismatch",
  );

  expect((await verifier.verify(intent.operationId, "p1")).pricingPolicy).toBe(
    "wave1_standard_v1",
  );
  const wrong = new YooKassaEarlyBirdCandidateVerifier(
    {
      getPayment: async () => ({
        ...observed,
        amount: { value: "8000.00", currency: "RUB" },
      }),
    } as never,
    { findIntent: async () => standard as never },
  );
  await expect(wrong.verify(intent.operationId, "p1")).rejects.toThrow(
    "early_bird_candidate_mismatch",
  );
});
