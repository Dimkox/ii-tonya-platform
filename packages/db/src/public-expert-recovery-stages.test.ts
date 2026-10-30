import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  ExperimentalGatewayIpc,
  createPayerReceiptVault,
  publicExpertPaymentSnapshotSchema,
  type YooKassaPayment,
} from "@ii-tonya/integrations";
import { createPublicExpertPaymentRuntime } from "./public-expert-payment-runtime.js";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const wait = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 8000);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
function fixture(pages: number, backlog = false) {
  vi.useFakeTimers();
  vi.setSystemTime("2027-01-11T12:01:00Z");
  let snapshot = publicExpertPaymentSnapshotSchema.parse({
    version: 1,
    requestId: "10000000-0000-4000-8000-000000000001",
    userId: randomUUID(),
    product: "main",
    kind: "main_create",
    legacySourceId: randomUUID(),
    legacyOperationId: randomUUID(),
    mode: "test",
    amountMinor: "10000",
    currency: "RUB",
    idempotencyKey: randomUUID(),
    contactId: randomUUID(),
    parentPaymentId: null,
    requestDigest: `sha256:${"a".repeat(64)}`,
    bodyVersion: 1,
    bodyExpiresAt: "2027-01-12T10:00:00Z",
    paymentDeadline: "2027-01-11T14:00:00Z",
    providerDeadline: "2027-01-11T14:00:00Z",
    createdAt: "2027-01-11T12:00:00Z",
    state: "uncertain",
    providerObjectId: null,
    envelope: {
      ciphertext: "sealed-test-fixture",
      keyReference: "public:fixture",
    },
  });
  const payment: YooKassaPayment = {
    id: "stage_payment",
    status: "pending",
    paid: false,
    refundable: false,
    test: true,
    amount: { value: "100.00", currency: "RUB" },
    createdAt: snapshot.createdAt,
    paymentMethodType: "bank_card",
    metadata: {
      purpose: "main_residency",
      operation_id: snapshot.legacyOperationId,
      order_id: snapshot.legacySourceId,
      user_id: snapshot.userId,
    },
    confirmation: { type: "redirect", url: "https://yookassa.ru/pay" },
  };
  const observations: Record<string, unknown>[] = [];
  let binds = 0,
    active = 0,
    posts = 0,
    gets = 0;
  const listed: number[] = [];
  const gateway = new ExperimentalGatewayIpc({
    address: "\0unused-stage",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  vi.spyOn(gateway, "dispatchPublic").mockImplementation(async () => {
    posts++;
    throw Error("unexpected-post");
  });
  vi.spyOn(gateway, "listPublicPage").mockImplementation(
    async (_resource, input, signal) => {
      const page = Number(input.cursor ?? 0);
      listed.push(page);
      active++;
      try {
        await wait(signal);
        return {
          items: [
            page === pages - 1
              ? structuredClone(payment)
              : {
                  ...structuredClone(payment),
                  id: `other_${page}`,
                  metadata: { ...payment.metadata, user_id: randomUUID() },
                },
          ],
          ...(page === pages - 1 ? {} : { nextCursor: String(page + 1) }),
        };
      } finally {
        active--;
      }
    },
  );
  vi.spyOn(gateway, "getPayment").mockImplementation(async (id, signal) => {
    gets++;
    active++;
    try {
      await wait(signal);
      expect(id).toBe(payment.id);
      return structuredClone(payment);
    } finally {
      active--;
    }
  });
  const dialect = new PgDialect();
  // Exercise actual runtime/recovery/transport and actual repository parsers and
  // branded bind/observe entrypoints. This deterministic SQL port records their
  // effects; it does not replace or claim PostgreSQL financial/grant evidence.
  const execute = async (query: SQL) => {
    const { sql, params } = dialect.sqlToQuery(query);
    let value: unknown;
    if (sql.includes("public_payment_pending"))
      value =
        params[0] === null
          ? [
              snapshot.requestId,
              ...(backlog
                ? Array.from(
                    { length: 9 },
                    (_, i) =>
                      `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
                  )
                : []),
            ]
          : [];
    else if (
      sql.includes("public_onboarding_pending") ||
      sql.includes("public_refund_pending")
    )
      value = [];
    else if (sql.includes("public_payment_candidate"))
      value =
        params[0] === snapshot.requestId ? structuredClone(snapshot) : null;
    else if (sql.includes("public_payment_bind")) {
      const proof = JSON.parse(params[2] as string);
      expect(proof.observation.requestId).toBe(snapshot.requestId);
      expect(proof.observation.providerObjectId).toBe(payment.id);
      expect(proof.observation.identity.userId).toBe(snapshot.userId);
      snapshot = {
        ...snapshot,
        state: "bound",
        providerObjectId: params[1] as string,
      };
      binds++;
      value = structuredClone(snapshot);
    } else if (sql.includes("public_payment_observe")) {
      const fact = JSON.parse(params[2] as string);
      expect(Date.now() - Date.parse(fact.observedAt)).toBeLessThan(1000);
      observations.push(fact);
      value = randomUUID();
    } else throw Error(`unexpected SQL operation:${sql}`);
    return { rows: [{ value }] };
  };
  const make = () => {
    const role = (login: string) => ({ login, db: { execute } as never }),
      key = Buffer.alloc(32, 4);
    return createPublicExpertPaymentRuntime({} as never, {
      connections: {
        onboardingSender: role("onboarding"),
        mainSender: role("main"),
        refundSender: role("refund"),
        binder: role("binder"),
        observations: role("observations"),
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
  };
  return {
    make,
    payment,
    listed,
    observations,
    counts: () => ({ binds, active, posts, gets }),
    snapshot: () => snapshot,
  };
}
async function turn(
  runtime: ReturnType<typeof createPublicExpertPaymentRuntime>,
) {
  const work = runtime.runOnce();
  await vi.advanceTimersByTimeAsync(15000);
  await work;
}
it.each([1, 10])(
  "%i slow8s LIST pages plus8s fresh GET eventually bind through the real runtime stages",
  async (pages) => {
    const f = fixture(pages, true),
      runtime = f.make();
    try {
      for (let index = 0; index < pages; index++) await turn(runtime);
      expect(f.counts().binds).toBe(0);
      expect(f.observations).toHaveLength(0);
      // Match the ordinary60s API cadence; completed verification must take its
      // next turn before unrelated records consume its finite discovery lifetime.
      await vi.advanceTimersByTimeAsync(45000);
      await turn(runtime);
      expect(f.snapshot().providerObjectId).toBe(f.payment.id);
      expect(f.counts().binds).toBe(1);
      expect(f.observations).toHaveLength(1);
      expect(f.listed.filter((page) => page === 0)).toHaveLength(1);
      expect(f.counts().posts).toBe(0);
      expect(f.counts().active).toBe(0);
    } finally {
      await runtime.stop();
    }
  },
);
it("restart loses discovery safely and repeats read-only discovery before fresh binding", async () => {
  const f = fixture(1);
  let runtime = f.make();
  try {
    await turn(runtime);
    expect(f.counts().binds).toBe(0);
    await runtime.stop();
    runtime = f.make();
    await turn(runtime);
    expect(f.counts().binds).toBe(0);
    await turn(runtime);
    expect(f.counts().binds).toBe(1);
    expect(f.listed.filter((page) => page === 0)).toHaveLength(2);
    expect(f.counts().posts).toBe(0);
  } finally {
    await runtime.stop();
  }
});
it("an expired completed discovery is rescanned rather than becoming binding evidence", async () => {
  const f = fixture(1);
  const runtime = f.make();
  try {
    await turn(runtime);
    await vi.advanceTimersByTimeAsync(130000);
    await turn(runtime);
    expect(f.counts().binds).toBe(0);
    await turn(runtime);
    expect(f.counts().binds).toBe(1);
    expect(f.listed.filter((page) => page === 0)).toHaveLength(2);
    expect(f.counts().posts).toBe(0);
  } finally {
    await runtime.stop();
  }
});
