import { expect, it, vi } from "vitest";
import { YooKassaEarlyBirdRefundVerifier } from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdRefundSettlementStore } from "./early-bird-refund-settlement-store.js";
const binding = {
  invoiceId: "2526c71d-803f-4c3d-9b57-74e902170001",
  userId: "2526c71d-803f-4c3d-9b57-74e902170002",
  operationId: "2526c71d-803f-4c3d-9b57-74e902170003",
  refundOperationId: "2526c71d-803f-4c3d-9b57-74e902170004",
  pricingPolicy: "owner_test_10_20_v1" as const,
  priceKind: "fixed_test" as const,
  grantId: "2526c71d-803f-4c3d-9b57-74e902170005",
  paymentId: "pay1",
  refundId: "ref1",
  totalMinor: "3000" as const,
  mode: "live" as const,
};
function verifier(amount = "30.00") {
  return new YooKassaEarlyBirdRefundVerifier(
    {
      getRefund: async () => ({
        id: "ref1",
        paymentId: "pay1",
        status: "succeeded" as const,
        amount: { value: amount, currency: "RUB" as const },
        createdAt: "2026-11-10T00:00:00.000Z",
      }),
      getPayment: async () => ({
        id: "pay1",
        status: "succeeded" as const,
        paid: true,
        refundable: true,
        test: false,
        amount: { value: "30.00", currency: "RUB" as const },
        createdAt: "2026-11-01T00:00:00.000Z",
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
    },
    { findRefundBinding: async () => binding },
  );
}
it("accepts only its issuer proof and commits with bounded transaction retry", async () => {
  const v = verifier(),
    execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ safe: true }] })
      .mockRejectedValueOnce(new Error("sql", { cause: { code: "40001" } }))
      .mockResolvedValueOnce({ rows: [{ safe: true }] })
      .mockResolvedValue({ rows: [] });
  const transaction = vi.fn(async (cb) => cb({ execute })),
    store = new PostgresEarlyBirdRefundSettlementStore(
      { transaction } as unknown as DrizzleDb,
      v,
      "wave_refund_login",
    );
  const proof = await v.verify("ref1");
  await expect(store.commit({ ...proof })).rejects.toThrow(
    "early_bird_refund_proof_required",
  );
  await store.commit(proof);
  expect(transaction).toHaveBeenCalledTimes(2);
});
it("fails closed when its DB principal audit is unsafe", async () => {
  const v = verifier("10.00"),
    execute = vi.fn().mockResolvedValue({ rows: [{ safe: false }] }),
    transaction = vi.fn(async (cb) => cb({ execute }));
  const store = new PostgresEarlyBirdRefundSettlementStore(
    { transaction } as unknown as DrizzleDb,
    v,
    "wave_refund_login",
  );
  await expect(store.commit(await v.verify("ref1"))).rejects.toThrow(
    "early_bird_refund_principal_unsafe",
  );
  expect(execute).toHaveBeenCalledOnce();
});
