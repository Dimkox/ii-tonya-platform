import { expect, it, vi } from "vitest";
import { YooKassaEarlyBirdVerifier } from "@ii-tonya/integrations";
import { PostgresEarlyBirdPaymentSettlementStore } from "./early-bird-payment-settlement-store.js";
import type { DrizzleDb } from "../client.js";
const binding = {
  invoiceId: "2526c71d-803f-4c3d-9b57-74e902170001",
  userId: "2526c71d-803f-4c3d-9b57-74e902170002",
  operationId: "2526c71d-803f-4c3d-9b57-74e902170003",
  grantId: "2526c71d-803f-4c3d-9b57-74e902170004",
  providerObjectId: "pay1",
  pricingPolicy: "owner_test_10_20_v1" as const,
  priceKind: "fixed_test" as const,
  mode: "live" as const,
  onboardingMinor: "1000" as const,
  subscriptionMinor: "2000" as const,
  totalMinor: "3000" as const,
  baseOfferShownAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2026-11-11T00:00:00.000Z",
  launchAt: "2027-01-10T21:00:00.000Z",
};
const verifier = () =>
  new YooKassaEarlyBirdVerifier(
    {
      getPayment: async () => ({
        id: "pay1",
        status: "succeeded",
        paid: true,
        test: false,
        amount: { value: "30.00", currency: "RUB" },
        createdAt: binding.baseOfferShownAt,
        capturedAt: "2026-11-02T00:00:00.000Z",
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
it("requires an authentic proof from its own verifier and retries only serialization failures", async () => {
  const v = verifier(),
    execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ safe: true }] })
      .mockRejectedValueOnce(new Error("sql", { cause: { code: "40001" } }))
      .mockResolvedValueOnce({ rows: [{ safe: true }] })
      .mockResolvedValue({ rows: [] });
  const transaction = vi.fn(async (callback) => callback({ execute }));
  const store = new PostgresEarlyBirdPaymentSettlementStore(
    { transaction } as unknown as DrizzleDb,
    v,
    "wave_login",
  );
  const proof = await v.verify(binding.invoiceId);
  await expect(store.commit({ ...proof })).rejects.toThrow(
    "early_bird_payment_proof_required",
  );
  await expect(
    store.commit(await verifier().verify(binding.invoiceId)),
  ).rejects.toThrow("early_bird_payment_proof_required");
  await store.commit(proof);
  expect(transaction).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenCalledTimes(4);
});
it("refuses an unsafe database principal before executing settlement", async () => {
  const v = verifier();
  const execute = vi.fn().mockResolvedValue({ rows: [{ safe: false }] });
  const transaction = vi.fn(async (callback) => callback({ execute }));
  const store = new PostgresEarlyBirdPaymentSettlementStore(
    { transaction } as unknown as DrizzleDb,
    v,
    "wave_login",
  );
  await expect(store.commit(await v.verify(binding.invoiceId))).rejects.toThrow(
    "early_bird_settlement_principal_unsafe",
  );
  expect(execute).toHaveBeenCalledOnce();
});
