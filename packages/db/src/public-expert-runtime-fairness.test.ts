import { createHash, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createPublicExpertPaymentRuntime } from "./public-expert-payment-runtime.js";
import {
  PostgresPublicExpertPaymentBinder,
  PostgresPublicExpertPaymentObservations,
  PublicHeldOnboardingCheckout,
  PublicMainResidencyCheckout,
} from "./repositories/public-expert-payment-gateway.js";
import {
  PublicExpertRecovery,
  ExperimentalGatewayIpc,
  createPayerReceiptVault,
} from "@ii-tonya/integrations";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("shutdown cancels active pagination, drains it and admits no partial facts or duplicate POST", async () => {
  vi.useFakeTimers();
  const id = randomUUID();
  let pages = 0,
    inFlight = 0;
  vi.spyOn(
    PostgresPublicExpertPaymentBinder.prototype,
    "candidate",
  ).mockResolvedValue({
    requestId: id,
    providerObjectId: null,
    createdAt: "2027-01-11T12:00:00Z",
    product: "main",
  } as never);
  const bind = vi.spyOn(PostgresPublicExpertPaymentBinder.prototype, "bind"),
    observe = vi.spyOn(
      PostgresPublicExpertPaymentObservations.prototype,
      "observe",
    );
  const gateway = new ExperimentalGatewayIpc({
    address: "\0unused-shutdown",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  const post = vi.spyOn(gateway, "dispatchPublic");
  vi.spyOn(gateway, "listPublicPage").mockImplementation(
    async (_resource, input, signal) => {
      pages++;
      inFlight++;
      try {
        await delay(8000, signal);
        return {
          items: [
            { id: `page-${pages}`, createdAt: "2027-01-11T12:00:00Z" },
          ] as never,
          nextCursor: String(Number(input.cursor ?? 0) + 1),
        };
      } finally {
        inFlight--;
      }
    },
  );
  const role = (login: string, value: unknown) => ({
      login,
      db: { execute: async () => ({ rows: [{ value }] }) } as never,
    }),
    key = Buffer.alloc(32, 4);
  const runtime = createPublicExpertPaymentRuntime({} as never, {
    connections: {
      onboardingSender: role("onboarding", []),
      mainSender: role("main", []),
      refundSender: role("refund", []),
      binder: role("binder", [id]),
      observations: role("writer", []),
    },
    gateway,
    mode: "test",
    messagingConsentPolicyVersion: "v1",
    vault: createPayerReceiptVault({
      activeKeyId: "v1",
      keys: new Map([["v1", Buffer.alloc(32, 3)]]),
    }),
    requestKey: key,
    requestKeyReference: "public:v1",
    retainedRequestKeys: new Map([["public:v1", key]]),
    returnUrl: "https://ii-tonya.ru/return",
    vatCode: 1,
  });
  const work = runtime.runOnce();
  await vi.advanceTimersByTimeAsync(9000);
  await runtime.runOnce();
  expect(pages).toBe(2);
  expect(inFlight).toBe(1);
  const stop = runtime.stop();
  await vi.advanceTimersByTimeAsync(0);
  await stop;
  await work;
  expect(inFlight).toBe(0);
  expect(bind).not.toHaveBeenCalled();
  expect(observe).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  await runtime.runOnce();
  expect(pages).toBe(2);
});
it("abort after admission preserves uncertainty and never sends or retries the POST", async () => {
  const abort = new AbortController();
  let admissions = 0,
    posts = 0;
  const request = {
    requestId: randomUUID(),
    kind: "main_refund",
    state: "prepared",
    envelope: { ciphertext: "sealed", keyReference: "public:v1" },
    product: "refund",
    requestDigest: `sha256:${createHash("sha256").update("{}").digest("hex")}`,
  };
  const source = {
    source: async () => ({ mode: "test", requests: [request] }),
    admit: async () => {
      admissions++;
      request.state = "admitted";
      abort.abort();
      return request;
    },
  };
  const main = new PublicMainResidencyCheckout({
    enabled: true,
    mode: "test",
    source,
    decryptor: { decrypt: async () => ({ body: "{}", bodyVersion: 1 }) },
    transport: {
      dispatch: async () => {
        posts++;
      },
    },
    recovery: { recover: async () => ({ kind: "pending" }) },
    returnUrl: "https://ii-tonya.ru/return",
  } as never);
  const input = { userId: randomUUID(), operationId: randomUUID() };
  expect(
    await main.createOrRecoverRefund(input, { signal: abort.signal }),
  ).toEqual({ kind: "pending" });
  expect(await main.createOrRecoverRefund(input)).toEqual({ kind: "pending" });
  expect(admissions).toBe(1);
  expect(posts).toBe(0);
  expect(request.state).toBe("admitted");
});
const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
it("held batches respect abort inside operations and advance only through attempted invoices", async () => {
  vi.useFakeTimers();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const after: (string | null)[] = [];
  const source = {
    pending: async (_limit: number, cursor: string | null) => {
      after.push(cursor);
      return ids;
    },
    invoice: async () => ({
      requests: [{ requestId: randomUUID(), state: "bound" }],
    }),
  };
  const held = new PublicHeldOnboardingCheckout({
    enabled: true,
    mode: "test",
    source,
    recovery: {
      recover: async (_id: string, options?: { signal?: AbortSignal }) => {
        await delay(8000, options?.signal);
        return { kind: "pending" };
      },
    },
    returnUrl: "https://ii-tonya.ru/return",
  } as never);
  const abort = new AbortController();
  const work = held.reconcileKnown(3, { signal: abort.signal } as never);
  await vi.advanceTimersByTimeAsync(15000);
  abort.abort();
  await vi.advanceTimersByTimeAsync(100000);
  const result = await work;
  expect(result.examined).toBe(2);
  const stopped = new AbortController();
  stopped.abort();
  await held.reconcileKnown(3, { signal: stopped.signal } as never);
  // A live next batch observes the last attempted invoice, not the unread tail.
  const next = held.reconcileKnown(1, {
    signal: AbortSignal.timeout(1),
  } as never);
  await vi.advanceTimersByTimeAsync(100000);
  await next;
  expect(after[1]).toBe(ids[1]);
});
it("slow sustained payment and held backlog gives authorized refunds an independent turn", async () => {
  vi.useFakeTimers();
  let refunds = 0,
    paymentStarts = 0,
    heldStarts = 0;
  vi.spyOn(PublicExpertRecovery.prototype, "recover").mockImplementation(
    async (_id, options?: { signal?: AbortSignal | undefined }) => {
      paymentStarts++;
      await delay(40000, options?.signal);
      return { kind: "pending" };
    },
  );
  vi.spyOn(
    PublicHeldOnboardingCheckout.prototype,
    "reconcileKnown",
  ).mockImplementation(
    async (_limit, options?: { signal?: AbortSignal | undefined }) => {
      heldStarts++;
      await delay(40000, options?.signal);
      return { examined: 1 };
    },
  );
  vi.spyOn(
    PublicMainResidencyCheckout.prototype,
    "createOrRecoverRefund",
  ).mockImplementation(async () => {
    refunds++;
    return { kind: "pending" };
  });
  const id = randomUUID(),
    command = { userId: randomUUID(), operationId: randomUUID() };
  const role = (login: string, value: unknown) => ({
    login,
    db: { execute: async () => ({ rows: [{ value }] }) } as never,
  });
  const key = Buffer.alloc(32, 4);
  const runtime = createPublicExpertPaymentRuntime({} as never, {
    connections: {
      onboardingSender: role("onboarding", []),
      mainSender: role("main", []),
      refundSender: role("refund", [command]),
      binder: role("binder", [id]),
      observations: role("facts", []),
    },
    gateway: new ExperimentalGatewayIpc({
      address: "\0unused",
      key: Buffer.alloc(32, 1),
      authKey: Buffer.alloc(32, 2),
      timeoutMs: 10,
    }),
    mode: "test",
    messagingConsentPolicyVersion: "v1",
    vault: createPayerReceiptVault({
      activeKeyId: "v1",
      keys: new Map([["v1", Buffer.alloc(32, 3)]]),
    }),
    requestKey: key,
    requestKeyReference: "public:v1",
    retainedRequestKeys: new Map([["public:v1", key]]),
    returnUrl: "https://ii-tonya.ru/return",
    vatCode: 1,
  });
  try {
    for (let turn = 0; turn < 3; turn++) {
      const work = runtime.runOnce();
      await vi.advanceTimersByTimeAsync(16000);
      const count = refunds;
      await vi.advanceTimersByTimeAsync(100000);
      await work;
      expect(count).toBe(turn + 1);
    }
    expect(paymentStarts).toBe(3);
    expect(heldStarts).toBe(3);
  } finally {
    const stopped = runtime.stop();
    await vi.advanceTimersByTimeAsync(100000);
    await stopped;
  }
});
