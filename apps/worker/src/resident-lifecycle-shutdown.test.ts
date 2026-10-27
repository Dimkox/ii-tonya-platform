import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrizzleDb } from "@ii-tonya/db";
import type { RuntimeConfig } from "@ii-tonya/config";
import type { ResidentWorkTransport } from "@ii-tonya/contracts";
const control = vi.hoisted(() => ({
  cached: false,
  persisted: "unknown",
  wire: 0,
  recoveries: 0,
  stops: 0,
  failRecovery: false,
  ackGate: undefined as Promise<void> | undefined,
  recoveryGate: undefined as Promise<void> | undefined,
  received: () => {},
  order: [] as string[],
  deadline: 0,
}));
vi.mock("@ii-tonya/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ii-tonya/db")>()),
  PostgresResidentLifecycleCompletionRepository: class {
    constructor(
      _db: unknown,
      private readonly policy: { transport?: ResidentWorkTransport },
    ) {}
    async processBatch() {
      return 0;
    }
    async deliverBatch() {
      const result = await this.policy.transport!.send({
        botKey: "core-work",
        chatId: "991122",
        text: "Synthetic reviewed notice",
        deadline: new Date(Date.now() + 8000).toISOString(),
      });
      if (result.kind !== "applied") throw Error("fixture_receipt_missing");
      control.cached = true;
      control.received();
      await control.ackGate;
      return 0; /* simulated failed database acknowledgement retains validated receipt */
    }
    stopAccepting() {
      control.stops++;
    }
    async recoverReceipts() {
      control.recoveries++;
      control.order.push("recover");
      await control.recoveryGate;
      if (control.failRecovery) throw Error("database_ack_failed");
      if (control.cached) {
        control.cached = false;
        control.persisted = "delivered";
      }
    }
  },
}));
import { createResidentLifecycleCompletionWorker } from "./resident-lifecycle-completion-composition.js";
import { createWorkerRuntime } from "./runtime.js";
function latch() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((r) => (resolve = r)),
    resolve: () => resolve(),
  };
}
beforeEach(() => {
  Object.assign(control, {
    cached: false,
    persisted: "unknown",
    wire: 0,
    recoveries: 0,
    stops: 0,
    failRecovery: false,
    ackGate: undefined,
    recoveryGate: undefined,
    received: () => {},
    order: [],
    deadline: 0,
  });
});
afterEach(() => vi.useRealTimers());
function fixture(
  extra: Partial<Parameters<typeof createWorkerRuntime>[0]> = {},
) {
  const config = {
    features: { expertCard: true },
    expertCard: {
      paymentMode: "test",
      materialDeliveryEnabled: false,
      mainCheckoutEnabled: false,
      workBotId: "818181",
      workBotKey: "core-work",
      workBotUsername: "synthetic_work_bot",
      workBotToken: "818181:" + "a".repeat(35),
      webhookSecret: "synthetic-core-webhook-secret-12345678",
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
    residentLifecycleCompletion: { enabled: true, deliveryEnabled: true },
  } as unknown as RuntimeConfig;
  const worker = createResidentLifecycleCompletionWorker(
    {} as DrizzleDb,
    config,
    async () => {
      control.wire++;
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 101,
            from: { id: 818181, is_bot: true },
            chat: { id: 991122, type: "private" },
          },
        }),
        { status: 200 },
      );
    },
  )!;
  const idle = async () => ({ disabled: true }),
    closeDatabase = vi.fn(async () => {
      control.order.push("database");
    });
  const runtime = createWorkerRuntime({
    residentLifecycleCompletion: worker,
    safetyHandoffs: idle,
    recoverExpiredLeases: idle,
    reconcileUnknownOutcomes: idle,
    reservationExpiry: idle,
    expertResidencyExpiry: idle,
    expertTelegramCheckoutCleanup: idle,
    expertResidencyReconciliation: idle,
    expertReferralHoldReplay: idle,
    deliverConfirmedOutbox: idle,
    processorPrivacy: idle,
    providerReconciliation: idle,
    closeDatabase,
    closeTelemetry: async () => {},
    ...extra,
  });
  return { worker, runtime, closeDatabase };
}
it("normal close awaits retained validated WORK receipt recovery before closing DB and never sends twice", async () => {
  const f = fixture();
  await f.runtime.runOnce();
  expect(control.cached).toBe(true);
  const gate = latch();
  control.recoveryGate = gate.promise;
  const closing = f.runtime.close();
  try {
    await vi.waitFor(() => expect(control.recoveries).toBe(1));
    expect(f.closeDatabase).not.toHaveBeenCalled();
  } finally {
    gate.resolve();
    await closing;
  }
  expect(control.order).toEqual(["recover", "database"]);
  expect(control.persisted).toBe("delivered");
  expect(control.wire).toBe(1);
  expect(control.stops).toBeGreaterThan(0);
  await f.runtime.close();
  expect(control.recoveries).toBe(1);
});
it("close waits for an in-flight final receipt before draining without starting another lifecycle batch", async () => {
  const receipt = latch(),
    ack = latch();
  control.received = receipt.resolve;
  control.ackGate = ack.promise;
  const f = fixture(),
    cycle = f.runtime.runOnce();
  await receipt.promise;
  const closing = f.runtime.close();
  expect(control.recoveries).toBe(0);
  expect(f.closeDatabase).not.toHaveBeenCalled();
  ack.resolve();
  await cycle;
  await closing;
  expect(control.persisted).toBe("delivered");
  expect(control.wire).toBe(1);
  expect(control.recoveries).toBe(1);
});
it("failed receipt persistence keeps unknown state and closes resources without a resend", async () => {
  const f = fixture();
  await f.runtime.runOnce();
  control.failRecovery = true;
  await expect(f.runtime.close()).rejects.toThrow("database_ack_failed");
  expect(control.persisted).toBe("unknown");
  expect(control.cached).toBe(true);
  expect(control.wire).toBe(1);
  expect(f.closeDatabase).toHaveBeenCalledOnce();
});
it("receipt drain uses the remaining shared shutdown budget after other drain work", async () => {
  const gate = latch();
  const f = fixture({
    shutdownTimeoutMs: 20,
    bookingNotifications: {
      runOnce: async () => {},
      stopAccepting() {},
      drain: async () => {
        await new Promise((r) => setTimeout(r, 15));
      },
    },
  });
  await f.runtime.runOnce();
  vi.useFakeTimers();
  control.recoveryGate = gate.promise;
  const result = f.runtime.close().then(
    () => ({ error: null }),
    (error) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(20);
  const outcome = await result;
  expect(outcome.error).toBeInstanceOf(Error);
  expect(control.recoveries).toBe(1);
  expect(control.wire).toBe(1);
  expect(f.closeDatabase).toHaveBeenCalledOnce();
  gate.resolve();
});
