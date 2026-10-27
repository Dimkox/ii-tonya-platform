import { afterEach, expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import {
  PostgresBookingNotificationRepository,
  PostgresWorkerJobsRepository,
  PostgresExpertReferralWorkerRepository,
  PostgresExpertTelegramResidencyCallbackRepository,
  PostgresOutboxRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
const injected = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@ii-tonya/db", async (original) => {
  const actual = await original<typeof import("@ii-tonya/db")>();
  return {
    ...actual,
    createDb: (...args: Parameters<typeof actual.createDb>) =>
      injected.db ?? actual.createDb(...args),
  };
});
import { createProductionWorkerRuntimeFactory } from "./main.js";
import { createBookingNotificationRuntime } from "./booking-notifications.js";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  injected.db = undefined;
});
it("connects actual main factory to notification recovery and shutdown", async () => {
  const d = database();
  const end = vi.fn(async () => {});
  injected.db = { ...d.db, $client: { end } };
  vi.spyOn(
    PostgresWorkerJobsRepository.prototype,
    "processDueBatch",
  ).mockResolvedValue({} as never);
  vi.spyOn(
    PostgresWorkerJobsRepository.prototype,
    "expireDueBatch",
  ).mockResolvedValue({} as never);
  vi.spyOn(
    PostgresWorkerJobsRepository.prototype,
    "materializeOperatorCasesBatch",
  ).mockResolvedValue({} as never);
  vi.spyOn(
    PostgresExpertReferralWorkerRepository.prototype,
    "expireDueBatch",
  ).mockResolvedValue({ examined: 0, changed: 0, failed: 0 });
  vi.spyOn(
    PostgresExpertReferralWorkerRepository.prototype,
    "listReconciliationBatch",
  ).mockResolvedValue([]);
  vi.spyOn(
    PostgresExpertReferralWorkerRepository.prototype,
    "replayDueBatch",
  ).mockResolvedValue({ examined: 0, granted: 0, cancelled: 0 });
  vi.spyOn(
    PostgresExpertTelegramResidencyCallbackRepository.prototype,
    "clearExpiredCheckoutUrls",
  ).mockResolvedValue(0);
  vi.spyOn(
    PostgresOutboxRepository.prototype,
    "recoverExpiredDispatchLeases",
  ).mockResolvedValue(0);
  vi.spyOn(
    PostgresOutboxRepository.prototype,
    "recoverExpiredReconciliationLeases",
  ).mockResolvedValue(0);
  const recovery = vi.spyOn(
    PostgresBookingNotificationRepository.prototype,
    "recoverExpired",
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const c = Object.assign(config(), {
    clientTelegramBotKey: "client",
    bookingNotifications: {
      admissionEnabled: false,
      sendEnabled: false,
      recoveryEnabled: true,
    },
  });
  const runtime = await createProductionWorkerRuntimeFactory().create(c);
  const report = await runtime.runOnce();
  expect(report.bookingNotifications).toEqual({
    sent: 0,
    pendingCompletion: false,
  });
  expect(recovery).toHaveResolvedWith(0);
  await runtime.close();
  expect(end).toHaveBeenCalledOnce();
  expect(fetcher).not.toHaveBeenCalled();
});
const config = () =>
  loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
function database() {
  const execute = vi.fn(async () => ({ rows: [] }));
  const db = {
    execute,
    transaction: async (
      work: (tx: { execute: typeof execute }) => Promise<unknown>,
    ) => work({ execute }),
  } as unknown as DrizzleDb;
  return { db, execute };
}
it("does not construct a disabled runtime or access DB", async () => {
  const d = database();
  expect(
    await createBookingNotificationRuntime(config(), d.db),
  ).toBeUndefined();
  expect(d.execute).not.toHaveBeenCalled();
});
it("runs actual local recovery without credentials or sending", async () => {
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  const recovery = vi.spyOn(
    PostgresBookingNotificationRepository.prototype,
    "recoverExpired",
  );
  const capture = vi.spyOn(
    PostgresBookingNotificationRepository.prototype,
    "capturePending",
  );
  const c = Object.assign(config(), {
    clientTelegramBotKey: "client",
    bookingNotifications: {
      admissionEnabled: false,
      sendEnabled: false,
      recoveryEnabled: true,
    },
  });
  const d = database();
  const runtime = await createBookingNotificationRuntime(c, d.db);
  expect(runtime).toBeDefined();
  await runtime!.runOnce();
  expect(recovery).toHaveResolvedWith(0);
  expect(capture).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  expect(d.execute).toHaveBeenCalled();
  await runtime!.drain(Date.now() + 100);
});
function enabled(sendEnabled: boolean, admissionEnabled: boolean) {
  const c = Object.assign(config(), {
    clientTelegramBotKey: "client",
    clientTelegramBotToken: `123456:${"a".repeat(35)}`,
    telegramWebhookSecret: "s".repeat(32),
    clientMessagingConsentPolicyVersion: "messaging-v1",
    bookingNotifications: {
      admissionEnabled,
      sendEnabled,
      recoveryEnabled: true,
    },
    bookingCallbacks: {
      hmacKey: new Uint8Array(32).fill(1),
      activeKeyId: "k1",
      keys: new Map([["k1", new Uint8Array(32).fill(2)]]),
    },
  });
  c.features.bookingCallbacks = true;
  return c;
}
it("requires provisioned control for enabled sending", async () => {
  await expect(
    createBookingNotificationRuntime(enabled(true, false), database().db),
  ).rejects.toThrow("booking_notification_control_required");
});
it.each([
  [true, false],
  [false, true],
  [true, true],
])(
  "composes send=%s admission=%s without changing control",
  async (send, admission) => {
    const d = database();
    const read = vi.fn(async () => ({
      rows: [
        {
          bot_key: "client",
          paused_at: "2026-10-01",
          admission_enabled: false,
        },
      ],
    }));
    const db = { ...d.db, execute: read } as unknown as DrizzleDb;
    const runtime = await createBookingNotificationRuntime(
      enabled(send!, admission!),
      db,
    );
    expect(runtime).toBeDefined();
    expect(read).toHaveBeenCalledOnce();
    await runtime!.drain(Date.now() + 100);
    expect(read).toHaveBeenCalledOnce();
  },
);
it("refuses enabled sending without callback capabilities", async () => {
  const c = Object.assign(config(), {
    clientTelegramBotKey: "client",
    bookingNotifications: {
      admissionEnabled: false,
      sendEnabled: true,
      recoveryEnabled: true,
    },
  });
  await expect(
    createBookingNotificationRuntime(c, database().db),
  ).rejects.toThrow("booking_notification_runtime_configuration_invalid");
});
