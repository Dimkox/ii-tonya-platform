import { expect, it, vi } from "vitest";
import { createWorkerRuntime } from "./runtime.js";
import { createFinalCallScheduler } from "./early-bird-final-call-scheduler.js";
it("runs the injected final call in the real worker cycle and stops it during shutdown", async () => {
  const noop = async () => ({}),
    run = vi.fn().mockResolvedValue({ queued: 1 }),
    scheduler = createFinalCallScheduler({ run });
  const runtime = createWorkerRuntime({
    safetyHandoffs: noop,
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
    closeDatabase: async () => undefined,
    closeTelemetry: async () => undefined,
    deferredFinalCall: {
      runOnce: () => scheduler.run(),
      stopAccepting: () => scheduler.stop(),
    },
  });
  expect((await runtime.runOnce()).deferredFinalCall).toEqual({ queued: 1 });
  expect(run).toHaveBeenCalledOnce();
  const signal = run.mock.calls[0]?.[1] as AbortSignal;
  expect(signal.aborted).toBe(false);
  await runtime.close();
  expect(signal.aborted).toBe(true);
  expect(await scheduler.run()).toBeNull();
});
