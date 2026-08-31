import { describe, expect, it, vi } from "vitest";
import {
  createProductionWorkerRuntime,
  createWorkerRuntime,
} from "./runtime.js";

describe("worker runtime", () => {
  const maturityDeps = (
    grantDueMaturityBatch: ReturnType<typeof vi.fn>,
    record: ReturnType<typeof vi.fn>,
  ) => ({
    jobsRepository: {
      processDueBatch: vi.fn(async () => ({})),
      expireDueBatch: vi.fn(async () => ({})),
      listLocalReservations: vi.fn(async () => []),
      recordProviderUnavailable: vi.fn(async () => undefined),
      materializeOperatorCasesBatch: vi.fn(async () => ({})),
    },
    expertReferralJobsRepository: {
      expireDueBatch: vi.fn(async () => ({ examined: 0, released: 0 })),
      replayDueBatch: vi.fn(async () => ({
        examined: 0,
        granted: 0,
        cancelled: 0,
      })),
      listReconciliationBatch: vi.fn(async () => []),
      recordReconciliationMismatches: vi.fn(async () => undefined),
      grantDueMaturityBatch,
    },
    expertTelegramCheckoutRepository: {
      clearExpiredCheckoutUrls: vi.fn(async () => 0),
    },
    outboxRepository: {
      recoverExpiredDispatchLeases: vi.fn(async () => 0),
      recoverExpiredReconciliationLeases: vi.fn(async () => 0),
    },
    closeDatabase: vi.fn(async () => undefined),
    closeTelemetry: vi.fn(async () => undefined),
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    expertReferralMaturityWorkerEnabled: true,
    expertReferralMaturityMetrics: { record },
  });

  it("records fixed maturity outcomes and records failure before rethrow", async () => {
    const record = vi.fn();
    const success = createProductionWorkerRuntime(
      maturityDeps(
        vi.fn(async () => ({
          examined: 4,
          granted: 1,
          cancelled: 1,
          pending: 2,
        })),
        record,
      ) as never,
    );
    await success.runOnce();
    expect(record.mock.calls).toEqual([
      ["examined", 4],
      ["granted", 1],
      ["cancelled", 1],
      ["retry", 2],
    ]);
    const failure = new Error("maturity_failed");
    const failedRecord = vi.fn();
    const failed = createProductionWorkerRuntime(
      maturityDeps(
        vi.fn(async () => {
          throw failure;
        }),
        failedRecord,
      ) as never,
    );
    await expect(failed.runOnce()).rejects.toBe(failure);
    expect(failedRecord).toHaveBeenCalledWith("failed");
  });

  it("fails closed when maturity is enabled without its repository capability", () => {
    const deps = {
      jobsRepository: {
        processDueBatch: vi.fn(async () => ({})),
        expireDueBatch: vi.fn(async () => ({})),
        listLocalReservations: vi.fn(async () => []),
        recordProviderUnavailable: vi.fn(async () => undefined),
        materializeOperatorCasesBatch: vi.fn(async () => ({})),
      },
      expertReferralJobsRepository: {
        expireDueBatch: vi.fn(async () => ({})),
        replayDueBatch: vi.fn(async () => ({})),
        listReconciliationBatch: vi.fn(async () => []),
        recordReconciliationMismatches: vi.fn(async () => undefined),
      },
      expertTelegramCheckoutRepository: {
        clearExpiredCheckoutUrls: vi.fn(async () => 0),
      },
      outboxRepository: {
        recoverExpiredDispatchLeases: vi.fn(async () => 0),
        recoverExpiredReconciliationLeases: vi.fn(async () => 0),
      },
      closeDatabase: vi.fn(async () => undefined),
      closeTelemetry: vi.fn(async () => undefined),
      now: () => new Date("2026-08-14T10:00:00.000Z"),
      expertReferralMaturityWorkerEnabled: true,
    };

    expect(() => createProductionWorkerRuntime(deps as never)).toThrow(
      "expert_referral_maturity_worker_capability_unavailable",
    );
  });

  it("runs bounded jobs in the required safety-first order", async () => {
    const calls: string[] = [];
    const job = (name: string) =>
      vi.fn(async () => {
        calls.push(name);
        return { name };
      });
    const runtime = createWorkerRuntime({
      safetyHandoffs: job("safety"),
      recoverExpiredLeases: job("lease-recovery"),
      reconcileUnknownOutcomes: job("unknown-reconciliation"),
      reservationExpiry: job("expiry"),
      expertResidencyExpiry: job("expert-residency-expiry"),
      expertTelegramCheckoutCleanup: job("expert-telegram-checkout-cleanup"),
      expertResidencyReconciliation: job("expert-residency-reconciliation"),
      expertReferralHoldReplay: job("expert-referral-hold-replay"),
      deliverConfirmedOutbox: job("outbox"),
      processorPrivacy: job("privacy"),
      providerReconciliation: job("provider-reconciliation"),
      closeDatabase: vi.fn(async () => undefined),
      closeTelemetry: vi.fn(async () => undefined),
    });

    const report = await runtime.runOnce();

    expect(calls).toEqual([
      "safety",
      "lease-recovery",
      "unknown-reconciliation",
      "expiry",
      "expert-residency-expiry",
      "expert-telegram-checkout-cleanup",
      "expert-residency-reconciliation",
      "expert-referral-hold-replay",
      "outbox",
      "privacy",
      "provider-reconciliation",
    ]);
    expect(report.expertResidencyExpiry).toEqual({
      name: "expert-residency-expiry",
    });
    expect(report.expertTelegramCheckoutCleanup).toEqual({
      name: "expert-telegram-checkout-cleanup",
    });
    expect(report.expertResidencyReconciliation).toEqual({
      name: "expert-residency-reconciliation",
    });
    expect(report.expertReferralHoldReplay).toEqual({
      name: "expert-referral-hold-replay",
    });
  });

  it("stops new cycles, finishes the current cycle, and closes resources once", async () => {
    let finishSafety: (() => void) | undefined;
    const safetyHandoffs = vi.fn(
      () =>
        new Promise<{ name: string }>((resolve) => {
          finishSafety = () => resolve({ name: "safety" });
        }),
    );
    const closeDatabase = vi.fn(async () => undefined);
    const closeTelemetry = vi.fn(async () => undefined);
    const noop = vi.fn(async () => ({}));
    const runtime = createWorkerRuntime({
      safetyHandoffs,
      recoverExpiredLeases: noop,
      reconcileUnknownOutcomes: noop,
      reservationExpiry: noop,
      expertResidencyExpiry: noop,
      expertTelegramCheckoutCleanup: noop,
      expertResidencyReconciliation: noop,
      expertReferralHoldReplay: noop,
      deliverConfirmedOutbox: noop,
      processorPrivacy: noop,
      providerReconciliation: noop,
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
    const noop = vi.fn(async () => ({}));
    const runtime = createWorkerRuntime({
      safetyHandoffs: vi.fn(() => new Promise(() => undefined)),
      recoverExpiredLeases: noop,
      reconcileUnknownOutcomes: noop,
      reservationExpiry: noop,
      expertResidencyExpiry: noop,
      expertTelegramCheckoutCleanup: noop,
      expertResidencyReconciliation: noop,
      expertReferralHoldReplay: noop,
      deliverConfirmedOutbox: noop,
      processorPrivacy: noop,
      providerReconciliation: noop,
      closeDatabase,
      closeTelemetry,
      shutdownTimeoutMs: 10,
    });
    void runtime.runOnce();

    await expect(runtime.close()).rejects.toThrow("shutdown deadline");

    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(closeTelemetry).toHaveBeenCalledOnce();
  });

  it("composes the safe PostgreSQL jobs with expert provider reads disabled", async () => {
    const jobsRepository = {
      processDueBatch: vi.fn(async () => ({
        examined: 0,
        escalated: 0,
        unchanged: 0,
      })),
      expireDueBatch: vi.fn(async () => ({
        examined: 0,
        changed: 0,
        failed: 0,
      })),
      listLocalReservations: vi.fn(async () => []),
      recordObservation: vi.fn(async () => undefined),
      recordProviderUnavailable: vi.fn(async () => undefined),
      materializeOperatorCasesBatch: vi.fn(async () => ({ materialized: 2 })),
    };
    const expertReferralJobsRepository = {
      expireDueBatch: vi.fn(async () => ({
        examined: 1,
        changed: 1,
        failed: 0,
      })),
      replayDueBatch: vi.fn(async () => ({
        examined: 1,
        granted: 0,
        cancelled: 1,
      })),
      listReconciliationBatch: vi.fn(async () => [
        {
          orderId: "00000000-0000-4000-8000-000000000001",
          provider: "sandbox",
          paymentId: "pay_1",
          amountMinor: "50000",
          currency: "RUB" as const,
          status: "settled" as const,
        },
      ]),
      recordReconciliationMismatches: vi.fn(async () => undefined),
    };
    const expertResidencyProviderReader = {
      readPayments: vi.fn(async () => ({ kind: "disabled" as const })),
    };
    const outboxRepository = {
      recoverExpiredDispatchLeases: vi.fn(async () => 1),
      recoverExpiredReconciliationLeases: vi.fn(async () => 2),
    };
    const expertTelegramCheckoutRepository = {
      clearExpiredCheckoutUrls: vi.fn(async () => 3),
    };
    const runtime = createProductionWorkerRuntime({
      jobsRepository,
      expertReferralJobsRepository,
      expertTelegramCheckoutRepository,
      expertResidencyProviderReader,
      outboxRepository,
      closeDatabase: vi.fn(async () => undefined),
      closeTelemetry: vi.fn(async () => undefined),
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    });

    const report = await runtime.runOnce();

    expect(jobsRepository.processDueBatch).toHaveBeenCalledOnce();
    expect(jobsRepository.expireDueBatch).toHaveBeenCalledOnce();
    expect(expertReferralJobsRepository.expireDueBatch).toHaveBeenCalledOnce();
    expect(expertReferralJobsRepository.replayDueBatch).toHaveBeenCalledOnce();
    expect(expertResidencyProviderReader.readPayments).toHaveBeenCalledOnce();
    expect(report.expertResidencyExpiry).toEqual({
      examined: 1,
      changed: 1,
      failed: 0,
    });
    expect(report.expertTelegramCheckoutCleanup).toEqual({ cleared: 3 });
    expect(report.expertResidencyReconciliation).toEqual({
      examined: 1,
      matched: 0,
      mismatches: 0,
      provider: "disabled",
    });
    expect(report.expertReferralHoldReplay).toEqual({
      examined: 1,
      granted: 0,
      cancelled: 1,
    });
    expect(report.expiredLeaseRecovery).toEqual({
      dispatch: 1,
      reconciliation: 2,
    });
    expect(jobsRepository.materializeOperatorCasesBatch).toHaveBeenCalledOnce();
    expect(report.confirmedOutboxDelivery).toEqual({ materialized: 2 });
  });

  it("uses the disabled expert residency provider reader when no capability is injected", async () => {
    const jobsRepository = {
      processDueBatch: vi.fn(async () => ({})),
      expireDueBatch: vi.fn(async () => ({})),
      listLocalReservations: vi.fn(async () => []),
      recordProviderUnavailable: vi.fn(async () => undefined),
      materializeOperatorCasesBatch: vi.fn(async () => ({})),
    };
    const expertReferralJobsRepository = {
      expireDueBatch: vi.fn(async () => ({
        examined: 0,
        changed: 0,
        failed: 0,
      })),
      replayDueBatch: vi.fn(async () => ({
        examined: 0,
        granted: 0,
        cancelled: 0,
      })),
      listReconciliationBatch: vi.fn(async () => []),
      recordReconciliationMismatches: vi.fn(async () => undefined),
    };
    const runtime = createProductionWorkerRuntime({
      jobsRepository,
      expertReferralJobsRepository,
      expertTelegramCheckoutRepository: {
        clearExpiredCheckoutUrls: vi.fn(async () => 0),
      },
      outboxRepository: {
        recoverExpiredDispatchLeases: vi.fn(async () => 0),
        recoverExpiredReconciliationLeases: vi.fn(async () => 0),
      },
      closeDatabase: vi.fn(async () => undefined),
      closeTelemetry: vi.fn(async () => undefined),
      now: () => new Date("2026-08-14T10:00:00.000Z"),
    });

    await expect(runtime.runOnce()).resolves.toMatchObject({
      expertResidencyReconciliation: { provider: "disabled" },
    });
  });

  it("gives registered rows to exactly one runtime owner", async () => {
    const productionDeps = () => ({
      jobsRepository: {
        processDueBatch: vi.fn(async () => ({})),
        expireDueBatch: vi.fn(async () => ({})),
        listLocalReservations: vi.fn(async () => []),
        recordProviderUnavailable: vi.fn(async () => undefined),
        materializeOperatorCasesBatch: vi.fn(async () => ({ materialized: 2 })),
      },
      expertReferralJobsRepository: {
        expireDueBatch: vi.fn(async () => ({
          examined: 0,
          changed: 0,
          failed: 0,
        })),
        replayDueBatch: vi.fn(async () => ({
          examined: 0,
          granted: 0,
          cancelled: 0,
        })),
        listReconciliationBatch: vi.fn(async () => []),
        recordReconciliationMismatches: vi.fn(async () => undefined),
      },
      expertTelegramCheckoutRepository: {
        clearExpiredCheckoutUrls: vi.fn(async () => 0),
      },
      outboxRepository: {
        recoverExpiredDispatchLeases: vi.fn(async () => 0),
        recoverExpiredReconciliationLeases: vi.fn(async () => 0),
      },
      closeDatabase: vi.fn(async () => undefined),
      closeTelemetry: vi.fn(async () => undefined),
      now: () => new Date("2026-08-14T10:00:00.000Z"),
    });
    const disabled = productionDeps();
    await createProductionWorkerRuntime(disabled).runOnce();
    expect(
      disabled.jobsRepository.materializeOperatorCasesBatch,
    ).toHaveBeenCalledOnce();
    expect(
      disabled.outboxRepository.recoverExpiredDispatchLeases,
    ).toHaveBeenCalledOnce();
    expect(
      disabled.outboxRepository.recoverExpiredReconciliationLeases,
    ).toHaveBeenCalledOnce();

    const enabled = productionDeps();
    const workerOutboxRunner = vi.fn(async () => ({
      reconciled: 1,
      dispatched: 2,
    }));
    const report = await createProductionWorkerRuntime({
      ...enabled,
      workerOutboxRegistry: {
        topics: ["safety.operator_escalation", "admin.negative_feedback"],
      },
      workerOutboxRunner,
    } as never).runOnce();

    expect(workerOutboxRunner).toHaveBeenCalledOnce();
    expect(
      enabled.jobsRepository.materializeOperatorCasesBatch,
    ).not.toHaveBeenCalled();
    expect(
      enabled.outboxRepository.recoverExpiredDispatchLeases,
    ).not.toHaveBeenCalled();
    expect(
      enabled.outboxRepository.recoverExpiredReconciliationLeases,
    ).not.toHaveBeenCalled();
    expect(report.confirmedOutboxDelivery).toEqual({
      reconciled: 1,
      dispatched: 2,
    });
  });
});
