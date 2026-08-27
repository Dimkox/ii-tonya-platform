import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { selectClientSessionRetention } from "./main.js";
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
  now: () => new Date("2026-08-15T10:00:00.000Z"),
});

describe("client session retention production review closure", () => {
  it.each([
    { enabled: false, selected: false },
    { enabled: true, selected: true },
  ])(
    "selects bounded cleanup only when session=$enabled",
    ({ enabled, selected }) => {
      const job = vi.fn(async () => ({}));
      const factory = vi.fn(() => job);
      const result = selectClientSessionRetention(
        { features: { clientSession: enabled } } as never,
        factory,
      );
      expect(result === job).toBe(selected);
      expect(factory).toHaveBeenCalledTimes(selected ? 1 : 0);
    },
  );

  it("runs session cleanup once in every enabled production cycle", async () => {
    const clientSessionRetention = vi.fn(async () => ({
      receiptsRemoved: 1,
      sessionsRemoved: 1,
    }));
    const report = await createProductionWorkerRuntime({
      ...runtimeDeps(),
      clientSessionRetention,
    } as never).runOnce();
    expect(clientSessionRetention).toHaveBeenCalledOnce();
    expect(report.processorPrivacy).toEqual({
      clientSession: {
        receiptsRemoved: 1,
        sessionsRemoved: 1,
      },
    });
  });

  it("binds the PostgreSQL session repository and fixed metric recorder in production", () => {
    const source = readFileSync("apps/worker/src/main.ts", "utf8");
    expect(source).toMatch(/PostgresClientSessionRepository/iu);
    expect(source).toMatch(/runClientSessionRetention/iu);
    expect(source).toMatch(/recordClientSessionMetric/iu);
  });
});
