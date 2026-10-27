import { expect, it, vi } from "vitest";
import {
  createWorkerRuntime,
  type WorkerRuntimeDependencies,
} from "../../../apps/worker/src/runtime.js";
import {
  runYooKassaBoundReconciliation,
  type YooKassaBoundReconciliationDependencies,
} from "./yookassa-bound-reconciliation.js";
import {
  YooKassaTerminalError,
  createCanonicalExpertResidencyPaymentEventVerifier,
  type YooKassaOperation,
  YooKassaExpertResidencyProviderReader,
  type YooKassaTransport,
} from "@ii-tonya/integrations";
import { createYooKassaWorkerComposition } from "../../../apps/worker/src/yookassa-composition.js";
import { loadEnv } from "../../config/src/env.js";
import type { DrizzleDb } from "@ii-tonya/db";

const row = (id: string): YooKassaOperation => ({
  id,
  orderId: "order",
  paymentAttemptId: "attempt",
  kind: "create_payment",
  mode: "test",
  amountMinor: "100",
  currency: "RUB",
  requestDigest: "digest",
  idempotencyKey: "key",
  providerObjectId: `bound-${id}`,
  status: "pending",
});
function runner(rows: readonly YooKassaOperation[]) {
  const claim = vi.fn(async () => rows);
  const resolve = vi.fn(async () => undefined);
  const read = vi.fn(async () => null);
  const deliver = vi.fn(async () => undefined);
  const deps: YooKassaBoundReconciliationDependencies = {
    enabled: true,
    mode: "test",
    control: { accepting: true, credentialsUnavailable: false },
    operations: {
      claimReconciliationBatch: claim,
      resolve,
      findByProviderObject: async () => null,
    },
    verifier: { verifyPayment: read, verifyRefund: read },
    deliver,
  };
  return { deps, claim, resolve, read, deliver };
}

it("bounds requests to 25 and supplies the configured mode to the claim", async () => {
  const f = runner(Array.from({ length: 30 }, (_, i) => row(String(i))));
  expect(await runYooKassaBoundReconciliation(f.deps)).toMatchObject({
    examined: 25,
    pending: 25,
  });
  expect(f.claim).toHaveBeenCalledWith(25, "test");
  expect(f.read).toHaveBeenCalledTimes(25);
});
it("rejects a wrong-mode claim before invoking the verifier", async () => {
  const f = runner([{ ...row("wrong"), mode: "live" }, row("good")]);
  expect(await runYooKassaBoundReconciliation(f.deps)).toMatchObject({
    examined: 2,
    failed: 1,
    pending: 1,
  });
  expect(f.read).toHaveBeenCalledExactlyOnceWith(row("good"));
});
it.each([401, 403])(
  "stops claims and reads permanently after HTTP %i",
  async (code) => {
    const f = runner([row("first"), row("second")]);
    f.read.mockRejectedValue(
      new YooKassaTerminalError(`yookassa_http_${code}`),
    );
    expect(await runYooKassaBoundReconciliation(f.deps)).toMatchObject({
      reason: "credentials_unavailable",
      examined: 1,
    });
    expect(await runYooKassaBoundReconciliation(f.deps)).toMatchObject({
      reason: "credentials_unavailable",
      claimed: 0,
    });
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.claim).toHaveBeenCalledTimes(1);
  },
);
it("sanitizes one transport error and continues the batch without resolving it", async () => {
  const f = runner([row("first"), row("second")]);
  f.read.mockRejectedValueOnce(new Error("private-contact-and-payload"));
  const result = await runYooKassaBoundReconciliation(f.deps);
  expect(result).toMatchObject({ failed: 1, pending: 1, examined: 2 });
  expect(JSON.stringify(result)).not.toContain("private");
  expect(f.resolve).not.toHaveBeenCalled();
});
it("exhausted 20s admission window leaves subsequent claims untouched", async () => {
  let now = 0;
  const f = runner([row("first"), row("second")]);
  f.read.mockImplementationOnce(async () => {
    now = 20_000;
    return null;
  });
  expect(
    await runYooKassaBoundReconciliation({ ...f.deps, now: () => now }),
  ).toMatchObject({ examined: 1, pending: 1, reason: "budget_exhausted" });
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.resolve).not.toHaveBeenCalled();
});
it("stopping during a claimed batch prevents its next read", async () => {
  const f = runner([row("first"), row("second")]);
  f.read.mockImplementationOnce(async () => {
    f.deps.control.accepting = false;
    return null;
  });
  expect(await runYooKassaBoundReconciliation(f.deps)).toMatchObject({
    examined: 1,
    reason: "closing",
  });
  expect(f.read).toHaveBeenCalledTimes(1);
});
it("disabled and already-closing runners do not claim", async () => {
  const f = runner([row("first")]);
  await runYooKassaBoundReconciliation({ ...f.deps, enabled: false });
  f.deps.control.accepting = false;
  await runYooKassaBoundReconciliation(f.deps);
  expect(f.claim).not.toHaveBeenCalled();
});
it("claim failures remain bounded and sanitized", async () => {
  const f = runner([]);
  f.claim.mockRejectedValue(new Error("private-db-url"));
  expect(await runYooKassaBoundReconciliation(f.deps)).toMatchObject({
    reason: "claim_failed",
    examined: 0,
  });
});

it("awaits durable delivery before success and keeps a failed delivery retryable", async () => {
  const f = runner([row("first"), row("second")]);
  const event =
    createCanonicalExpertResidencyPaymentEventVerifier().verifyCanonical(
      {
        kind: "settled",
        provider: "yookassa",
        eventId: "fixture-event",
        paymentId: "fixture-payment",
        orderId: "00000000-0000-4000-8000-000000000001",
        amountMinor: "100",
        currency: "RUB",
        occurredAt: "2026-10-12T00:00:00.000Z",
        payloadDigest: `sha256:${"a".repeat(64)}`,
      },
      {
        verificationId: "fixture",
        verifierKeyVersion: "fixture",
        verifiedAt: "2026-10-12T00:00:00.000Z",
      },
    );
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let attempts = 0;
  const running = runYooKassaBoundReconciliation({
    ...f.deps,
    verifier: {
      verifyPayment: async () => event,
      verifyRefund: async () => event,
    },
    deliver: async () => {
      attempts++;
      if (attempts === 1) throw new Error("financial-operator-case");
      reached();
      await wait;
    },
  });
  await entered;
  expect(f.resolve).not.toHaveBeenCalled();
  release();
  expect(await running).toMatchObject({ succeeded: 1, failed: 1 });
  expect(f.resolve).toHaveBeenCalledExactlyOnceWith("second", "succeeded");
});

it("remaining cycle time reduces the HTTP timeout after claim latency", async () => {
  const config = loadEnv({
    DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
  config.features.yookassa = true;
  config.integrations.payments = true;
  config.yookassa = {
    mode: "test",
    shopId: "12345",
    secretReference: "env://YOOKASSA_SECRET_KEY",
    returnUrl: "https://ii-tonya.ru/return",
    receipt: {
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
  };
  let now = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation(() => new AbortController().signal);
  const fakeDb = {
    execute: async () => {
      now = 15_000;
      return {
        rows: [
          {
            ...row("first"),
            operationKind: "create_payment",
            environmentMode: "test",
            parentPaymentId: null,
          },
        ],
      };
    },
  } as unknown as DrizzleDb;
  const transport = vi.fn(async () => {
    now = 20_000;
    throw new Error("synthetic-abort");
  });
  try {
    const composition = createYooKassaWorkerComposition(config, fakeDb, {
      env: { YOOKASSA_SECRET_KEY: "synthetic-secret" },
      transport,
    })!;
    expect(await composition.runOnce()).toMatchObject({
      reason: "budget_exhausted",
      succeeded: 0,
    });
    expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      15_000, 5_000,
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    clock.mockRestore();
    timeout.mockRestore();
  }
});

it("composition carries remaining window into HTTP signal and aborts on close", async () => {
  const config = loadEnv({
    DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
  config.features.yookassa = true;
  config.integrations.payments = true;
  config.yookassa = {
    mode: "test",
    shopId: "12345",
    secretReference: "env://YOOKASSA_SECRET_KEY",
    returnUrl: "https://ii-tonya.ru/return",
    receipt: {
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
  };
  let capturedSignal: AbortSignal | undefined;
  let ready!: () => void;
  const reached = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const fakeDb = {
    execute: async () => ({
      rows: [
        {
          ...row("first"),
          operationKind: "create_payment",
          environmentMode: "test",
          parentPaymentId: null,
        },
      ],
    }),
  } as unknown as DrizzleDb;
  const composition = createYooKassaWorkerComposition(config, fakeDb, {
    env: { YOOKASSA_SECRET_KEY: "synthetic-secret" },
    transport: async (_url, init) => {
      capturedSignal = init.signal!;
      ready();
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal!.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    },
  })!;
  const cycle = composition.runOnce();
  await reached;
  expect(capturedSignal?.aborted).toBe(false);
  composition.stopAccepting();
  expect(capturedSignal?.aborted).toBe(true);
  expect(await cycle).toMatchObject({ reason: "closing", succeeded: 0 });
});

it("does not start recovery when closing during an earlier job", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const recovery = vi.fn(async () => ({ examined: 0 }));
  const noop = async () => undefined;
  const dependencies: WorkerRuntimeDependencies = {
    safetyHandoffs: () => blocked,
    recoverExpiredLeases: noop,
    reconcileUnknownOutcomes: recovery,
    reservationExpiry: noop,
    expertResidencyExpiry: noop,
    expertTelegramCheckoutCleanup: noop,
    expertResidencyReconciliation: noop,
    expertReferralHoldReplay: noop,
    deliverConfirmedOutbox: noop,
    processorPrivacy: noop,
    providerReconciliation: noop,
    closeDatabase: noop,
    closeTelemetry: noop,
  };
  const runtime = createWorkerRuntime(dependencies);
  const cycle = runtime.runOnce();
  const closing = runtime.close();
  release();
  await cycle;
  await closing;
  expect(recovery).not.toHaveBeenCalled();
  await expect(runtime.runOnce()).rejects.toThrow("closing");
});

function auditConfig() {
  const config = loadEnv({
    DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
  config.features.yookassa = true;
  config.integrations.payments = true;
  config.yookassa = {
    mode: "test",
    shopId: "12345",
    secretReference: "env://YOOKASSA_SECRET_KEY",
    returnUrl: "https://ii-tonya.ru/return",
    receipt: {
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
  };
  return config;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const auditPayments = Array.from({ length: 6 }, (_, i) => ({
  orderId: `order-${i}`,
  provider: "yookassa",
  paymentId: `audit-${i}`,
  amountMinor: "100",
  currency: "RUB" as const,
  status: "settled" as const,
}));
function auditResponse(index: number) {
  return Response.json({
    id: `audit-${index}`,
    status: "succeeded",
    paid: true,
    amount: { value: "1.00", currency: "RUB" },
    test: true,
    created_at: "2026-10-12T00:00:00.000Z",
    captured_at: "2026-10-12T00:00:00.000Z",
    metadata: {},
    refundable: true,
  });
}
function auditComposition(transport: YooKassaTransport) {
  return createYooKassaWorkerComposition(
    auditConfig(),
    {
      execute: async () => ({ rows: [] }),
    } as unknown as DrizzleDb,
    {
      env: { YOOKASSA_SECRET_KEY: "synthetic-secret" },
      transport,
      readerFactory: (client, mode) =>
        new YooKassaExpertResidencyProviderReader(client, mode),
    },
  )!;
}

it.each([401, 403])(
  "an audit HTTP %i aborts siblings and blocks their next GET and subsequent cycles",
  async (status) => {
    const pending = Array.from({ length: 4 }, () => deferred<Response>());
    const entered = deferred<void>();
    const signals: AbortSignal[] = [];
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      const index = signals.length;
      signals.push(init.signal!);
      if (signals.length === 4) entered.resolve();
      // Deliberately ignore abort: even surviving response loops cannot start GET 5.
      return pending[index]!.promise;
    });
    const composition = auditComposition(transport);
    await composition.runOnce();
    const audit = composition.reader.readPayments({
      now: new Date(),
      payments: auditPayments,
    });
    await entered.promise;
    pending[0]!.resolve(new Response("private-error", { status }));
    await expect(audit).resolves.toEqual({ kind: "disabled" });
    expect(composition.unavailableReason()).toBe("credentials_unavailable");
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    for (let i = 1; i < 4; i++) pending[i]!.resolve(auditResponse(i));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(transport).toHaveBeenCalledTimes(4);
    expect(await composition.runOnce()).toMatchObject({
      reason: "credentials_unavailable",
      claimed: 0,
    });
    await composition.reader.readPayments({
      now: new Date(),
      payments: auditPayments,
    });
    expect(transport).toHaveBeenCalledTimes(4);
  },
);

it.each(["closing", "budget_exhausted"])(
  "an in-progress audit fences surviving loops on %s",
  async (reason) => {
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const pending = Array.from({ length: 4 }, () => deferred<Response>());
    const entered = deferred<void>();
    const signals: AbortSignal[] = [];
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      const index = signals.length;
      signals.push(init.signal!);
      if (signals.length === 4) entered.resolve();
      return pending[index]!.promise;
    });
    try {
      const composition = auditComposition(transport);
      await composition.runOnce();
      const audit = composition.reader.readPayments({
        now: new Date(),
        payments: auditPayments,
      });
      await entered.promise;
      if (reason === "closing") {
        composition.stopAccepting();
        expect(signals.every((signal) => signal.aborted)).toBe(true);
      } else now = 20_000;
      for (let i = 0; i < 4; i++) pending[i]!.resolve(auditResponse(i));
      await expect(audit).resolves.toEqual({ kind: "disabled" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(composition.unavailableReason()).toBe(reason);
      expect(transport).toHaveBeenCalledTimes(4);
    } finally {
      clock.mockRestore();
    }
  },
);
