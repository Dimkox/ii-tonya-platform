import { describe, expect, it, vi } from "vitest";
import { YooKassaEarlyBirdCandidateVerifier } from "@ii-tonya/integrations";
import { EarlyBirdCandidateBindingBoundary } from "./early-bird-candidate-binding-boundary.js";
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
  id: "candidate_1",
  status: "pending",
  paid: false,
  test: false,
  amount: { value: "30.00", currency: "RUB" },
  createdAt: "2026-11-02T00:00:00.000Z",
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
const verifier = () =>
  new YooKassaEarlyBirdCandidateVerifier(
    { getPayment: async () => payment } as never,
    { findIntent: async () => intent },
  );
describe("verified candidate binding", () => {
  it("accepts only a fresh proof from its configured verifier", async () => {
    const issuer = verifier(),
      bind = vi.fn(async () => undefined),
      boundary = new EarlyBirdCandidateBindingBoundary(issuer, { bind });
    const proof = await issuer.verify(intent.operationId, payment.id);
    await expect(boundary.bind({ ...proof })).rejects.toThrow(
      "early_bird_candidate_proof_required",
    );
    await expect(
      boundary.bind(await verifier().verify(intent.operationId, payment.id)),
    ).rejects.toThrow("early_bird_candidate_proof_required");
    expect(bind).not.toHaveBeenCalled();
    await boundary.bind(proof);
    expect(bind).toHaveBeenCalledOnce();
  });
});
