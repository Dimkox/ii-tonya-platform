import { describe, expect, it, vi } from "vitest";
import { YooKassaExpertResidencyProviderReader } from "../../packages/integrations/src/yookassa/reconciliation-reader.js";
import { reconcileExpertResidencyPayments } from "../../packages/worker/src/expert-residency-reconciliation.js";

describe("YooKassa reconciliation", () => {
  it("reports an authoritative mismatch without mutating financial state", async () => {
    const recordReconciliationMismatches = vi.fn(async () => undefined);
    const reader = new YooKassaExpertResidencyProviderReader(
      {
        getPayment: vi.fn(async () => ({
          id: "2f4b6d0d-000f-5000-9000-000000000001",
          status: "succeeded" as const,
          paid: true,
          amount: { value: "500.00", currency: "RUB" as const },
          test: true,
          createdAt: "2026-08-14T10:00:00.000Z",
          metadata: {},
          refundable: true,
        })),
      },
      "test",
    );

    const result = await reconcileExpertResidencyPayments(
      {
        listReconciliationBatch: vi.fn(async () => [
          {
            orderId: "00000000-0000-4000-8000-000000000001",
            provider: "yookassa",
            paymentId: "2f4b6d0d-000f-5000-9000-000000000001",
            amountMinor: "50000",
            currency: "RUB" as const,
            status: "refunded" as const,
          },
        ]),
        recordReconciliationMismatches,
      },
      reader,
      new Date("2026-08-14T10:00:00.000Z"),
      100,
    );

    expect(result).toEqual({
      examined: 1,
      matched: 0,
      mismatches: 1,
      provider: "available",
    });
    expect(recordReconciliationMismatches).toHaveBeenCalledWith([
      expect.objectContaining({ reason: "status", providerStatus: "settled" }),
    ]);
  });
});
