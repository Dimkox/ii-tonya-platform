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
it("actual worker cycle invokes materials lifecycle and reports bounded result", async () => {
  const deps = basic();
  const runOnce = vi.fn(async () => ({ examined: 1, delivered: 1 }));
  const stopAccepting = vi.fn();
  const runtime = createWorkerRuntime({
    ...deps,
    expertCardMaterials: { runOnce, stopAccepting },
  });
  expect(await runtime.runOnce()).toMatchObject({
    expertCardMaterials: { examined: 1, delivered: 1 },
  });
  expect(runOnce).toHaveBeenCalledTimes(1);
  await runtime.close();
  expect(stopAccepting).toHaveBeenCalledTimes(1);
});
it("shutdown stops material claims before a pending earlier job completes", async () => {
  const deps = basic();
  let release: () => void = () => {};
  deps.safetyHandoffs = async () =>
    new Promise((resolve) => {
      release = () => resolve({ processed: 0 });
    });
  const materials = {
    runOnce: vi.fn(async () => ({ examined: 0 })),
    stopAccepting: vi.fn(),
  };
  const runtime = createWorkerRuntime({
    ...deps,
    expertCardMaterials: materials,
  });
  const cycle = runtime.runOnce();
  const closing = runtime.close();
  const stopped = materials.stopAccepting.mock.calls.length;
  release();
  await cycle;
  await closing;
  expect(stopped).toBe(1);
  expect(materials.runOnce).not.toHaveBeenCalled();
  expect(deps.closeDatabase).toHaveBeenCalledTimes(1);
});
it("preserves default worker report without a materials capability", async () => {
  const runtime = createWorkerRuntime(basic());
  expect(await runtime.runOnce()).not.toHaveProperty("expertCardMaterials");
  await runtime.close();
});
it("production runtime forwards the actual materials capability", async () => {
  const job = async () => ({ examined: 0, changed: 0, failed: 0 });
  const runOnce = vi.fn(async () => ({ examined: 2, waitingContent: 2 }));
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
    expertCardMaterials: { runOnce, stopAccepting: () => {} },
  } as unknown as ProductionWorkerRuntimeDependencies;
  const runtime = createProductionWorkerRuntime(deps);
  expect(await runtime.runOnce()).toMatchObject({
    expertCardMaterials: { examined: 2, waitingContent: 2 },
  });
  expect(runOnce).toHaveBeenCalledTimes(1);
  await runtime.close();
});
