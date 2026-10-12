import { afterEach, expect, it, vi } from "vitest";
import {
  createWorkerRuntime,
  createProductionWorkerRuntime,
  type WorkerRuntimeDependencies,
} from "./runtime.js";
afterEach(() => vi.useRealTimers());

function fixture() {
  const events: string[] = [];
  const job = async () => ({});
  const notifications = {
    runOnce: vi.fn(async () => {
      events.push("notification");
      return { sent: 1 };
    }),
    stopAccepting: vi.fn(() => {
      events.push("stop");
    }),
    drain: vi.fn<(deadline: number) => Promise<void>>(async () => {
      events.push("drain");
    }),
  };
  const deps: WorkerRuntimeDependencies & {
    bookingNotifications: typeof notifications;
  } = {
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
    closeDatabase: async () => {
      events.push("database");
    },
    closeTelemetry: async () => {},
    bookingNotifications: notifications,
  };
  return { events, notifications, deps };
}
it("schedules booking notifications through the actual runtime cycle", async () => {
  const f = fixture();
  const runtime = createWorkerRuntime(f.deps);
  const report = await runtime.runOnce();
  expect(report).toHaveProperty("bookingNotifications", { sent: 1 });
  expect(f.notifications.runOnce).toHaveBeenCalledOnce();
  await runtime.close();
  expect(f.events).toEqual(["notification", "stop", "drain", "database"]);
});
it("forwards notifications through the production runtime wrapper", async () => {
  const f = fixture();
  const empty = async () => ({});
  const runtime = createProductionWorkerRuntime({
    bookingNotifications: f.notifications,
    jobsRepository: {
      processDueBatch: empty,
      expireDueBatch: empty,
      listLocalReservations: async () => [],
      recordProviderUnavailable: async () => {},
      materializeOperatorCasesBatch: empty,
    },
    expertReferralJobsRepository: {
      expireDueBatch: async () => ({ examined: 0, changed: 0, failed: 0 }),
      listReconciliationBatch: async () => [],
      recordReconciliationMismatches: async () => {},
      replayDueBatch: async () => ({ examined: 0, granted: 0, cancelled: 0 }),
    },
    expertTelegramCheckoutRepository: {
      clearExpiredCheckoutUrls: async () => 0,
    },
    outboxRepository: {
      recoverExpiredDispatchLeases: async () => 0,
      recoverExpiredReconciliationLeases: async () => 0,
    },
    closeDatabase: f.deps.closeDatabase,
    closeTelemetry: f.deps.closeTelemetry,
    now: () => new Date(),
  });
  expect(await runtime.runOnce()).toHaveProperty("bookingNotifications", {
    sent: 1,
  });
  await runtime.close();
  expect(f.events).toEqual(["notification", "stop", "drain", "database"]);
});
it("keeps the original shutdown deadline and waits for drain", async () => {
  vi.useFakeTimers();
  const start = Date.now();
  const f = fixture();
  let releaseCycle!: () => void;
  let releaseDrain!: () => void;
  f.notifications.drain.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        releaseDrain = resolve;
      }),
  );
  const runtime = createWorkerRuntime({
    ...f.deps,
    shutdownTimeoutMs: 1000,
    safetyHandoffs: () =>
      new Promise<void>((resolve) => {
        releaseCycle = resolve;
      }),
  });
  const cycle = runtime.runOnce();
  const close = runtime.close();
  await vi.advanceTimersByTimeAsync(400);
  releaseCycle();
  await cycle;
  await vi.advanceTimersByTimeAsync(0);
  expect(f.notifications.drain).toHaveBeenCalledWith(start + 1000);
  expect(f.events).not.toContain("database");
  releaseDrain();
  await close;
  expect(f.events).toContain("database");
});
it("closes DB and telemetry when drain rejects", async () => {
  const f = fixture();
  const telemetry = vi.fn(async () => {});
  f.notifications.drain.mockRejectedValue(new Error("drain-failed"));
  const runtime = createWorkerRuntime({ ...f.deps, closeTelemetry: telemetry });
  await expect(runtime.close()).rejects.toThrow("drain-failed");
  expect(f.events).toContain("database");
  expect(telemetry).toHaveBeenCalledOnce();
});
it("closes DB when a drain stalls past the remaining deadline", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.notifications.drain.mockImplementation(() => new Promise<void>(() => {}));
  const runtime = createWorkerRuntime({ ...f.deps, shutdownTimeoutMs: 100 });
  const result = runtime.close().then(
    () => "ok",
    () => "timeout",
  );
  await vi.advanceTimersByTimeAsync(99);
  expect(f.events).not.toContain("database");
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe("timeout");
  expect(f.events).toContain("database");
});
it("stops sends immediately while an earlier job is still running", async () => {
  const f = fixture();
  let release!: () => void;
  const runtime = createWorkerRuntime({
    ...f.deps,
    safetyHandoffs: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const cycle = runtime.runOnce();
  const closing = runtime.close();
  expect(f.notifications.stopAccepting).toHaveBeenCalledOnce();
  release();
  await cycle;
  await closing;
  expect(f.notifications.runOnce).not.toHaveBeenCalled();
  expect(f.events).toEqual(["stop", "drain", "database"]);
});
