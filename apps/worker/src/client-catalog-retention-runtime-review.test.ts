import { describe, expect, it, vi } from "vitest";

import { selectClientCatalogRetention } from "./main.js";
import { createProductionWorkerRuntime } from "./runtime.js";

const runtimeDeps = () => ({
  jobsRepository: {
    processDueBatch: vi.fn(async () => ({})),
    expireDueBatch: vi.fn(async () => ({})),
    listLocalReservations: vi.fn(async () => []),
    recordProviderUnavailable: vi.fn(async () => undefined),
    materializeOperatorCasesBatch: vi.fn(async () => ({})),
  },
  expertReferralJobsRepository: {
    expireDueBatch: vi.fn(async () => ({ examined: 0, changed: 0, failed: 0 })),
    replayDueBatch: vi.fn(async () => ({ examined: 0, granted: 0, cancelled: 0 })),
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
  now: () => new Date("2026-08-15T10:00:00.000Z"),
});

describe("client catalog retention production composition", () => {
  it.each([
    { worker: false, catalog: false, selected: false },
    { worker: true, catalog: false, selected: false },
    { worker: false, catalog: true, selected: false },
    { worker: true, catalog: true, selected: true },
  ])("selects retention only for worker=$worker catalog=$catalog", ({ worker, catalog, selected }) => {
    const job = vi.fn(async () => ({}));
    const factory = vi.fn(() => job);
    const result = selectClientCatalogRetention(
      { features: { workerOutboxDelivery: worker, clientCatalog: catalog } } as never,
      factory,
    );
    expect(result === job).toBe(selected);
    expect(factory).toHaveBeenCalledTimes(selected ? 1 : 0);
  });

  it("runs the bounded retention job once in every enabled worker cycle", async () => {
    const clientCatalogRetention = vi.fn(async () => ({
      examined: 1,
      expired: 1,
      removed: 0,
    }));
    const report = await createProductionWorkerRuntime({
      ...runtimeDeps(),
      clientCatalogRetention,
    } as never).runOnce();
    expect(clientCatalogRetention).toHaveBeenCalledOnce();
    expect(report.processorPrivacy).toEqual({
      examined: 1,
      expired: 1,
      removed: 0,
    });
  });
});
