import { it, expect, vi } from "vitest";
import type { RuntimeConfig } from "@ii-tonya/config";
import type { DrizzleDb } from "@ii-tonya/db";
import { createResidentWorkspaceNotificationLifecycle } from "./resident-workspace-notification-composition.js";
import {
  createWorkerRuntime,
  type WorkerRuntimeDependencies,
} from "./runtime.js";
it("default-off notification composition does not access DB or send", () => {
  const db = { execute: vi.fn() };
  const send = vi.fn();
  expect(
    createResidentWorkspaceNotificationLifecycle(
      { features: {} } as RuntimeConfig,
      db as unknown as DrizzleDb,
      { send },
    ),
  ).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
  expect(db.execute).not.toHaveBeenCalled();
});
it("enabled notification composition requires original promo and work configuration", () => {
  expect(() =>
    createResidentWorkspaceNotificationLifecycle(
      { features: { residentWorkspaceNotifications: true } } as RuntimeConfig,
      {} as DrizzleDb,
    ),
  ).toThrow("resident_workspace_notifier_required");
});
it("worker consumes durable notification lifecycle and stops it on shutdown", async () => {
  const job = async () => ({ processed: 0 });
  const base = {
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
  const lifecycle = {
    runOnce: vi.fn(async () => ({ examined: 1, delivered: 1 })),
    stopAccepting: vi.fn(),
  };
  const runtime = createWorkerRuntime({
    ...base,
    residentWorkspaceNotifications: lifecycle,
  });
  expect(await runtime.runOnce()).toMatchObject({
    residentWorkspaceNotifications: { examined: 1, delivered: 1 },
  });
  await runtime.close();
  expect(lifecycle.stopAccepting).toHaveBeenCalledTimes(1);
  await expect(runtime.runOnce()).rejects.toThrow("Worker runtime is closing");
  expect(lifecycle.runOnce).toHaveBeenCalledTimes(1);
});
