import { describe, expect, it, vi } from "vitest";
import { YooKassaEarlyBirdVerifier } from "@ii-tonya/integrations";
import { EarlyBirdSettlementBoundary } from "./early-bird-settlement-boundary.js";

const binding = {
  invoiceId: "2526c71d-803f-4c3d-9b57-74e902170001",
  userId: "2526c71d-803f-4c3d-9b57-74e902170002",
  operationId: "2526c71d-803f-4c3d-9b57-74e902170003",
  providerObjectId: "payment_1",
  pricingPolicy: "owner_test_10_20_v1" as const,
  priceKind: "fixed_test" as const,
  mode: "live" as const,
  grantId: "2526c71d-803f-4c3d-9b57-74e902170004",
  onboardingMinor: "1000" as const,
  subscriptionMinor: "2000" as const,
  totalMinor: "3000" as const,
  baseOfferShownAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2026-11-11T00:00:00.000Z",
  launchAt: "2027-01-10T21:00:00.000Z",
};
function verifier(capturedAt = "2026-11-02T00:00:00.000Z") {
  return new YooKassaEarlyBirdVerifier(
    {
      getPayment: async () => ({
        id: binding.providerObjectId,
        status: "succeeded",
        paid: true,
        test: false,
        amount: { value: "30.00", currency: "RUB" },
        createdAt: binding.baseOfferShownAt,
        capturedAt,
        metadata: {
          order_id: binding.invoiceId,
          operation_id: binding.operationId,
          user_id: binding.userId,
          purpose: "combined_early_bird",
          pricing_policy: binding.pricingPolicy,
          price_kind: binding.priceKind,
          pricing_grant_id: binding.grantId,
        },
      }),
    } as never,
    { findEarlyBirdBinding: async () => binding },
  );
}
describe("early bird settlement proof boundary", () => {
  it("accepts only genuine proof from its own verifier and reconciles late captures", async () => {
    const v = verifier();
    const settle = vi.fn(async () => undefined);
    const reconcile = vi.fn(async () => undefined);
    const boundary = new EarlyBirdSettlementBoundary(v, { settle, reconcile });
    const proof = await v.verify(binding.invoiceId);
    await expect(boundary.apply({ ...proof })).rejects.toThrow(
      "early_bird_payment_proof_required",
    );
    await expect(
      boundary.apply(await verifier().verify(binding.invoiceId)),
    ).rejects.toThrow("early_bird_payment_proof_required");
    expect(settle).not.toHaveBeenCalled();
    await boundary.apply(proof);
    expect(settle).toHaveBeenCalledOnce();
    const late = await verifier("2027-01-11T00:00:00.000Z").verify(
      binding.invoiceId,
    );
    const lateVerifier = verifier("2027-01-11T00:00:00.000Z");
    const lateBoundary = new EarlyBirdSettlementBoundary(lateVerifier, {
      settle,
      reconcile,
    });
    await expect(lateBoundary.apply(late)).rejects.toThrow(
      "early_bird_payment_proof_required",
    );
    await lateBoundary.apply(await lateVerifier.verify(binding.invoiceId));
    expect(reconcile).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledOnce();
  });
});
