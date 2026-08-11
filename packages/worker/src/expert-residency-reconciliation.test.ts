import { describe, expect, it, vi } from "vitest";
import { reconcileExpertResidencyPayments } from "./expert-residency-reconciliation.js";

const local = {
  orderId: "00000000-0000-4000-8000-000000000001",
  provider: "sandbox",
  paymentId: "pay_1",
  amountMinor: "50000",
  currency: "RUB" as const,
  status: "settled" as const,
};

describe("expert residency reconciliation", () => {
  it("returns a distinct disabled-provider outcome without incidents", async () => {
    const recordReconciliationMismatches = vi.fn(async () => undefined);
    const result = await reconcileExpertResidencyPayments(
      {
        listReconciliationBatch: vi.fn(async () => [local]),
        recordReconciliationMismatches,
      },
      { readPayments: vi.fn(async () => ({ kind: "disabled" as const })) },
      new Date("2026-08-11T08:00:00.000Z"),
      100,
    );

    expect(result).toEqual({
      examined: 1,
      matched: 0,
      mismatches: 0,
      provider: "disabled",
    });
    expect(recordReconciliationMismatches).not.toHaveBeenCalled();
  });

  it("records a provider mismatch without mutating local authority", async () => {
    const recordReconciliationMismatches = vi.fn(async () => undefined);
    const result = await reconcileExpertResidencyPayments(
      {
        listReconciliationBatch: vi.fn(async () => [local]),
        recordReconciliationMismatches,
      },
      {
        readPayments: vi.fn(async () => ({
          kind: "available" as const,
          payments: [{ ...local, status: "refunded" as const }],
        })),
      },
      new Date("2026-08-11T08:00:00.000Z"),
      100,
    );

    expect(result).toEqual({
      examined: 1,
      matched: 0,
      mismatches: 1,
      provider: "available",
    });
    expect(recordReconciliationMismatches).toHaveBeenCalledWith([
      expect.objectContaining({
        orderId: local.orderId,
        reason: "status",
        localStatus: "settled",
        providerStatus: "refunded",
      }),
    ]);
  });

  it("rejects duplicate provider facts", async () => {
    await expect(
      reconcileExpertResidencyPayments(
        {
          listReconciliationBatch: vi.fn(async () => [local]),
          recordReconciliationMismatches: vi.fn(async () => undefined),
        },
        {
          readPayments: vi.fn(async () => ({
            kind: "available" as const,
            payments: [local, local],
          })),
        },
        new Date("2026-08-11T08:00:00.000Z"),
        100,
      ),
    ).rejects.toThrow("duplicate_expert_residency_provider_payment");
  });
});
