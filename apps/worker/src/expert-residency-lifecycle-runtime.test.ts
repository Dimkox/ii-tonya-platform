import { expect, it, vi } from "vitest";
import {
  createWorkerRuntime,
  createProductionWorkerRuntime,
  type WorkerRuntimeDependencies,
  type ProductionWorkerRuntimeDependencies,
} from "./runtime.js";
function basic() {
  const job = async () => ({ processed: 0 });
  return {
    safetyHandoffs: job,
    recoverExpiredLeases: job,
    reconcileUnknownOutcomes: job,
    reservationExpiry: job,
    expertResidencyExpiry: job,
    expertTelegramCheckoutCleanup: job,
    expertResidencyReconciliation: job,
    expertReferralHoldReplay: job,
    deliverConfirmedOutbox: job,
    processorPrivacy: job,
    providerReconciliation: job,
    closeDatabase: vi.fn(async () => {}),
    closeTelemetry: vi.fn(async () => {}),
  } satisfies WorkerRuntimeDependencies;
}
it("actual worker cycle invokes residency lifecycle after canonical reconciliation and reports its result", async () => {
  const deps = basic();
  const lifecycle = {
    runOnce: vi.fn(async () => ({
      lifecycle: { billsCreated: 1, suspended: 1 },
      notices: { delivered: 1 },
    })),
    stopAccepting: vi.fn(),
  };
  const reconcile = vi.fn(deps.expertResidencyReconciliation);
  const worker = createWorkerRuntime({
    ...deps,
    expertResidencyReconciliation: reconcile,
    expertResidencyLifecycle: lifecycle,
  });
  expect(await worker.runOnce()).toMatchObject({
    expertResidencyLifecycle: {
      lifecycle: { billsCreated: 1, suspended: 1 },
      notices: { delivered: 1 },
    },
  });
  expect(reconcile.mock.invocationCallOrder[0]).toBeLessThan(
    lifecycle.runOnce.mock.invocationCallOrder[0]!,
  );
  await worker.close();
  expect(lifecycle.stopAccepting).toHaveBeenCalledTimes(1);
});
it("shutdown prevents new lifecycle claims while an earlier job drains", async () => {
  const deps = basic();
  let release!: () => void;
  deps.safetyHandoffs = () =>
    new Promise((resolve) => {
      release = () => resolve({ processed: 0 });
    });
  const lifecycle = {
    runOnce: vi.fn(async () => ({})),
    stopAccepting: vi.fn(),
  };
  const worker = createWorkerRuntime({
    ...deps,
    expertResidencyLifecycle: lifecycle,
  });
  const cycle = worker.runOnce();
  const closing = worker.close();
  const stopped = lifecycle.stopAccepting.mock.calls.length;
  release();
  await cycle;
  await closing;
  expect(stopped).toBe(1);
  expect(lifecycle.runOnce).not.toHaveBeenCalled();
});
it("default disabled composition leaves existing worker report unchanged", async () => {
  const worker = createWorkerRuntime(basic());
  expect(await worker.runOnce()).not.toHaveProperty("expertResidencyLifecycle");
  await worker.close();
});
it("production runtime forwards the residency lifecycle capability", async () => {
  const job = async () => ({ examined: 0, changed: 0, failed: 0 });
  const runOnce = vi.fn(async () => ({
    lifecycle: { examined: 1 },
    notices: { reason: "disabled" },
  }));
  const deps = {
    jobsRepository: {
      processDueBatch: job,
      expireDueBatch: job,
      listLocalReservations: async () => [],
      recordProviderUnavailable: async () => {},
      materializeOperatorCasesBatch: job,
    },
    expertReferralJobsRepository: {
      expireDueBatch: job,
      listReconciliationBatch: async () => [],
      recordReconciliationMismatches: async () => {},
      replayDueBatch: async () => ({
        examined: 0,
        granted: 0,
        cancelled: 0,
        failed: 0,
      }),
    },
    expertTelegramCheckoutRepository: {
      clearExpiredCheckoutUrls: async () => 0,
    },
    outboxRepository: {
      recoverExpiredDispatchLeases: async () => 0,
      recoverExpiredReconciliationLeases: async () => 0,
    },
    closeDatabase: async () => {},
    closeTelemetry: async () => {},
    now: () => new Date("2026-10-23T00:00:00Z"),
    expertResidencyLifecycle: { runOnce, stopAccepting: () => {} },
  } as unknown as ProductionWorkerRuntimeDependencies;
  const worker = createProductionWorkerRuntime(deps);
  expect(await worker.runOnce()).toMatchObject({
    expertResidencyLifecycle: { lifecycle: { examined: 1 } },
  });
  expect(runOnce).toHaveBeenCalledTimes(1);
  await worker.close();
});
