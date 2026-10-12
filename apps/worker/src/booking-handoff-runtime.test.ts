import { afterEach, expect, it, vi } from "vitest";
import {
  createWorkerRuntime,
  createProductionWorkerRuntime,
  type WorkerRuntimeDependencies,
} from "./runtime.js";

afterEach(() => vi.unstubAllGlobals());

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const events: string[] = [];
  const job = async () => ({});
  const deps: WorkerRuntimeDependencies = {
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
  };
  const bookingHandoffRevocations = async () => {
    events.push("local-withdrawal");
    return { examined: 1, processed: 1, quarantined: 0, operatorRequired: 1 };
  };
  return { deps, events, bookingHandoffRevocations };
}

it("processes local handoff withdrawals with no notification sender", async () => {
  const f = fixture();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const runtime = createWorkerRuntime({
    ...f.deps,
    ...{
      bookingHandoffRevocations: f.bookingHandoffRevocations,
    },
  });
  expect(await runtime.runOnce()).toHaveProperty("bookingHandoffRevocations", {
    examined: 1,
    processed: 1,
    quarantined: 0,
    operatorRequired: 1,
  });
  await runtime.close();
  expect(f.events).toEqual(["local-withdrawal", "database"]);
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not start local withdrawal processing after shutdown begins", async () => {
  const f = fixture();
  let release!: () => void;
  const runtime = createWorkerRuntime({
    ...f.deps,
    ...{
      bookingHandoffRevocations: f.bookingHandoffRevocations,
    },
    safetyHandoffs: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const cycle = runtime.runOnce();
  const closing = runtime.close();
  release();
  await cycle;
  await closing;
  expect(f.events).toEqual(["database"]);
  await expect(runtime.runOnce()).rejects.toThrow("Worker runtime is closing");
});

it("forwards local revocations through production composition without send capability", async () => {
  const f = fixture();
  const empty = async () => ({});
  const runtime = createProductionWorkerRuntime({
    ...{ bookingHandoffRevocations: f.bookingHandoffRevocations },
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
  expect(await runtime.runOnce()).toHaveProperty("bookingHandoffRevocations", {
    examined: 1,
    processed: 1,
    quarantined: 0,
    operatorRequired: 1,
  });
  await runtime.close();
  expect(f.events).toEqual(["local-withdrawal", "database"]);
});

it("awaits revocation after safety and before any notification send", async () => {
  const f = fixture();
  const entered = deferred();
  const finished = deferred();
  const runtime = createWorkerRuntime({
    ...f.deps,
    safetyHandoffs: async () => {
      f.events.push("safety");
    },
    bookingHandoffRevocations: async () => {
      f.events.push("revocation-start");
      entered.resolve();
      await finished.promise;
      f.events.push("revocation-finish");
    },
    bookingNotifications: {
      runOnce: async () => {
        f.events.push("send");
      },
      stopAccepting: () => {},
      drain: async () => {},
    },
  });
  const cycle = runtime.runOnce();
  await entered.promise;
  expect(f.events).toEqual(["safety", "revocation-start"]);
  finished.resolve();
  await cycle;
  await runtime.close();
  expect(f.events).toEqual([
    "safety",
    "revocation-start",
    "revocation-finish",
    "send",
    "database",
  ]);
});

it.each([false, true])(
  "closes resources after an in-flight local job settles, rejects=%s",
  async (reject) => {
    const f = fixture();
    const entered = deferred();
    const finished = deferred();
    const runtime = createWorkerRuntime({
      ...f.deps,
      bookingHandoffRevocations: async () => {
        entered.resolve();
        await finished.promise;
      },
      closeTelemetry: async () => {
        f.events.push("telemetry");
      },
    });
    const cycle = runtime.runOnce().then(
      () => "ok",
      () => "failed",
    );
    await entered.promise;
    const closing = runtime.close().then(
      () => "ok",
      () => "failed",
    );
    expect(f.events).toEqual([]);
    if (reject) finished.reject(new Error("local_job_failed"));
    else finished.resolve();
    expect(await cycle).toBe(reject ? "failed" : "ok");
    expect(await closing).toBe(reject ? "failed" : "ok");
    expect(f.events).toEqual(["database", "telemetry"]);
  },
);
