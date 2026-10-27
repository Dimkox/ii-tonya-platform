import { expect, it, vi } from "vitest";
import { createWorkerRuntime } from "./runtime.js";
it("runs personal offers after canonical reconciliation and closes the acquisition runner", async () => {
  const job = vi.fn(async () => ({ processed: 0 }));
  const offers = {
    runOnce: vi.fn(async () => ({ refreshed: 2, links: 0 })),
    stopAccepting: vi.fn(),
  };
  const reconciliation = vi.fn(job);
  const runtime = createWorkerRuntime({
    safetyHandoffs: job,
    recoverExpiredLeases: job,
    reconcileUnknownOutcomes: job,
    reservationExpiry: job,
    expertResidencyExpiry: job,
    expertTelegramCheckoutCleanup: job,
    expertResidencyReconciliation: reconciliation,
    expertReferralHoldReplay: job,
    deliverConfirmedOutbox: job,
    processorPrivacy: job,
    providerReconciliation: job,
    closeDatabase: async () => {},
    closeTelemetry: async () => {},
    expertPersonalOffers: offers,
  });
  expect(await runtime.runOnce()).toMatchObject({
    expertPersonalOffers: { refreshed: 2, links: 0 },
  });
  expect(reconciliation.mock.invocationCallOrder[0]).toBeLessThan(
    offers.runOnce.mock.invocationCallOrder[0]!,
  );
  await runtime.close();
  expect(offers.stopAccepting).toHaveBeenCalledOnce();
});
