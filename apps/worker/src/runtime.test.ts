import { describe, expect, it, vi } from "vitest";
import {
  createProductionWorkerRuntime,
  createWorkerRuntime,
} from "./runtime.js";

describe("worker runtime", () => {
  it("runs bounded jobs in the required safety-first order", async () => {
    const calls: string[] = [];
    const job = (name: string) => vi.fn(async () => {
      calls.push(name);
      return { name };
    });
    const runtime = createWorkerRuntime({
      safetyHandoffs: job("safety"),
      recoverExpiredLeases: job("lease-recovery"),
      reconcileUnknownOutcomes: job("unknown-reconciliation"),
      reservationExpiry: job("expiry"),
      deliverConfirmedOutbox: job("outbox"),
      processorPrivacy: job("privacy"),
      providerReconciliation: job("provider-reconciliation"),
      expertResidencyExpiry: job("expert-residency-expiry"),
      expertResidencyReconciliation: job("expert-residency-reconciliation"),
      expertReferralHoldReplay: job("expert-referral-hold-replay"),
      closeDatabase: vi.fn(async () => undefined),
      closeTelemetry: vi.fn(async () => undefined),
    });

    const report = await runtime.runOnce();

    expect(calls).toEqual([
      "safety",
      "lease-recovery",
      "unknown-reconciliation",
      "expiry",
      "outbox",
      "privacy",
      "provider-reconciliation",
      "expert-residency-expiry",
      "expert-residency-reconciliation",
      "expert-referral-hold-replay",
    ]);
    expect(report.safetyHandoffs).toEqual({ name: "safety" });
    expect(report.expertResidencyExpiry).toEqual({
      name: "expert-residency-expiry",
    });
  });

  it("stops new cycles, finishes the current cycle, and closes resources once", async () => {
    let finishSafety: (() => void) | undefined;
    const safetyHandoffs = vi.fn(() => new Promise<{ name: string }>((resolve) => {
      finishSafety = () => resolve({ name: "safety" });
    }));
    const closeDatabase = vi.fn(async () => undefined);
    const closeTelemetry = vi.fn(async () => undefined);
    const noop = vi.fn(async () => ({}));
    const runtime = createWorkerRuntime({
      safetyHandoffs,
      recoverExpiredLeases: noop,
      reconcileUnknownOutcomes: noop,
      reservationExpiry: noop,
      deliverConfirmedOutbox: noop,
      processorPrivacy: noop,
      providerReconciliation: noop,
      expertResidencyExpiry: noop,
      expertResidencyReconciliation: noop,
      expertReferralHoldReplay: noop,
      closeDatabase,
      closeTelemetry,
    });
    const cycle = runtime.runOnce();
    await vi.waitFor(() => expect(safetyHandoffs).toHaveBeenCalledOnce());

    const closing = runtime.close();
    await expect(runtime.runOnce()).rejects.toThrow("closing");
    expect(closeDatabase).not.toHaveBeenCalled();
    finishSafety?.();
    await cycle;
    await closing;
    await runtime.close();

    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(closeTelemetry).toHaveBeenCalledOnce();
  });

  it("bounds shutdown even when the current cycle never settles", async () => {
    const closeDatabase = vi.fn(async () => undefined);
    const closeTelemetry = vi.fn(async () => undefined);
    const runtime = createWorkerRuntime({
      safetyHandoffs: vi.fn(() => new Promise(() => undefined)),
      recoverExpiredLeases: vi.fn(async () => ({})),
      reconcileUnknownOutcomes: vi.fn(async () => ({})),
      reservationExpiry: vi.fn(async () => ({})),
      deliverConfirmedOutbox: vi.fn(async () => ({})),
      processorPrivacy: vi.fn(async () => ({})),
      providerReconciliation: vi.fn(async () => ({})),
      expertResidencyExpiry: vi.fn(async () => ({})),
      expertResidencyReconciliation: vi.fn(async () => ({})),
      expertReferralHoldReplay: vi.fn(async () => ({})),
      closeDatabase,
      closeTelemetry,
      shutdownTimeoutMs: 10,
    });
    void runtime.runOnce();

    await expect(runtime.close()).rejects.toThrow("shutdown deadline");

    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(closeTelemetry).toHaveBeenCalledOnce();
  });

  it("composes the safe PostgreSQL jobs without a live provider dispatcher", async () => {
    const jobsRepository = {
      processDueBatch: vi.fn(async () => ({ examined: 0, escalated: 0, unchanged: 0 })),
      expireDueBatch: vi.fn(async () => ({ examined: 0, changed: 0, failed: 0 })),
      listLocalReservations: vi.fn(async () => []),
      recordObservation: vi.fn(async () => undefined),
      recordProviderUnavailable: vi.fn(async () => undefined),
      deliverSafetyEscalationsBatch: vi.fn(async () => ({ delivered: 1 })),
    };
    const outboxRepository = {
      recoverExpiredDispatchLeases: vi.fn(async () => 1),
      recoverExpiredReconciliationLeases: vi.fn(async () => 2),
    };
    const expertReferralWorkerRepository = {
      expireDueBatch: vi.fn(async () => ({
        examined: 1,
        changed: 1,
        failed: 0,
      })),
      claimReconciliationBatch: vi.fn(async () => []),
      compareAndRecordReconciliation: vi.fn(),
      replayDueBatch: vi.fn(async () => ({
        examined: 0,
        granted: 0,
        debtRepaid: 0,
        ineligible: 0,
        cancelled: 0,
        stillHeld: 0,
        failed: 0,
      })),
    };
    const runtime = createProductionWorkerRuntime({
      jobsRepository,
      outboxRepository,
      expertReferralWorkerRepository,
      expertResidencyProvider: { reconcile: vi.fn(async () => null) },
      closeDatabase: vi.fn(async () => undefined),
      closeTelemetry: vi.fn(async () => undefined),
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    });

    const report = await runtime.runOnce();

    expect(jobsRepository.processDueBatch).toHaveBeenCalledOnce();
    expect(jobsRepository.expireDueBatch).toHaveBeenCalledOnce();
    expect(report.expiredLeaseRecovery).toEqual({ dispatch: 1, reconciliation: 2 });
    expect(report.confirmedOutboxDelivery).toEqual({ delivered: 1 });
    expect(report.expertResidencyExpiry).toEqual({
      examined: 1,
      changed: 1,
      failed: 0,
    });
    expect(report.expertResidencyReconciliation).toEqual({
      examined: 0,
      matched: 0,
      mismatches: 0,
      providerDisabled: 0,
      failed: 0,
    });
  });
});
