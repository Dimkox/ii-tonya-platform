import { expect, it, vi } from "vitest";
import { createWorkerRuntime } from "./runtime.js";
it("runs publication before launch materials and stops both on shutdown", async () => {
  const noop = async () => ({}),
    calls: string[] = [];
  const publication = {
    runOnce: vi.fn(async () => {
      calls.push("publication");
      return 1;
    }),
    stopAccepting: vi.fn(),
  };
  const launchKit = {
    runOnce: vi.fn(async () => {
      calls.push("kit");
      return 1;
    }),
    stopAccepting: vi.fn(),
  };
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
    earlyBirdPublication: publication,
    earlyBirdLaunchKit: launchKit,
  });
  await runtime.runOnce();
  expect(calls).toEqual(["publication", "kit"]);
  await runtime.close();
  expect(publication.stopAccepting).toHaveBeenCalledOnce();
  expect(launchKit.stopAccepting).toHaveBeenCalledOnce();
});
