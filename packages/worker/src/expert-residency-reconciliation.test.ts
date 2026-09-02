import { describe, expect, it, vi } from "vitest";
import {
  reconcileExpertResidencyPayments,
  type ExpertResidencyReconciliationCandidate,
} from "./expert-residency-reconciliation.js";

const at = new Date("2026-09-02T00:00:00.000Z");

describe("expert residency reconciliation job", () => {
  it("returns an explicit bounded disabled-provider outcome without inventing a mismatch", async () => {
    const candidate: ExpertResidencyReconciliationCandidate = {
      attemptId: "00000000-0000-4000-8000-000000000001",
      providerPaymentId: "disabled-payment",
      claimedAt: "2026-09-02T00:00:00.000Z",
    };
    const repository = {
      claimReconciliationBatch: vi.fn(async () => [candidate]),
      compareAndRecordReconciliation: vi.fn(),
    };
    const provider = { reconcile: vi.fn(async () => null) };

    await expect(
      reconcileExpertResidencyPayments(repository, provider, at, 100),
    ).resolves.toEqual({
      examined: 1,
      matched: 0,
      mismatches: 0,
      providerDisabled: 1,
      failed: 0,
    });
    expect(repository.compareAndRecordReconciliation).not.toHaveBeenCalled();
  });

  it("forwards the exact reconciliation lease including claimedAt", async () => {
    const candidate = {
      attemptId: "00000000-0000-4000-8000-000000000001",
      providerPaymentId: "payment-1",
      claimedAt: "2026-09-02T00:00:00.000Z",
    };
    const event = { paymentId: "payment-1" };
    const repository = {
      claimReconciliationBatch: vi.fn(async () => [candidate]),
      compareAndRecordReconciliation: vi.fn(async () => "matched" as const),
    };
    const provider = { reconcile: vi.fn(async () => event) };

    await reconcileExpertResidencyPayments(repository, provider, at, 1);

    expect(repository.compareAndRecordReconciliation).toHaveBeenCalledWith(
      candidate,
      event,
    );
  });

  it("isolates a poisoned item and continues the bounded batch", async () => {
    const candidates = [
      {
        attemptId: "attempt-1",
        providerPaymentId: "payment-1",
        claimedAt: at.toISOString(),
      },
      {
        attemptId: "attempt-2",
        providerPaymentId: "payment-2",
        claimedAt: at.toISOString(),
      },
      {
        attemptId: "attempt-3",
        providerPaymentId: "payment-3",
        claimedAt: at.toISOString(),
      },
    ];
    const events = new Map([
      ["payment-1", { paymentId: "payment-1" }],
      ["payment-2", { paymentId: "payment-2" }],
      ["payment-3", { paymentId: "payment-3" }],
    ]);
    const repository = {
      claimReconciliationBatch: vi.fn(async () => candidates),
      compareAndRecordReconciliation: vi
        .fn()
        .mockResolvedValueOnce("matched")
        .mockRejectedValueOnce(new Error("conflicting_state"))
        .mockResolvedValueOnce("mismatch"),
    };
    const provider = {
      reconcile: vi.fn(async (paymentId: string) => events.get(paymentId)!),
    };

    await expect(
      reconcileExpertResidencyPayments(repository, provider, at, 3),
    ).resolves.toEqual({
      examined: 3,
      matched: 1,
      mismatches: 1,
      providerDisabled: 0,
      failed: 1,
    });
  });

  it.each([0, 1_001])(
    "rejects unsafe batch size %s before provider access",
    async (batchSize) => {
      const repository = {
        claimReconciliationBatch: vi.fn(),
        compareAndRecordReconciliation: vi.fn(),
      };
      const provider = { reconcile: vi.fn() };

      await expect(
        reconcileExpertResidencyPayments(repository, provider, at, batchSize),
      ).rejects.toThrow("invalid_batch_size");
      expect(provider.reconcile).not.toHaveBeenCalled();
    },
  );
});
