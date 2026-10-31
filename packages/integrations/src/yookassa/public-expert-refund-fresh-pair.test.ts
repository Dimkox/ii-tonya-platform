import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { PublicExpertGatewayTransport } from "./public-expert-gateway.js";
import {
  PublicExpertRecovery,
  assertPublicExpertFreshObservation,
  type PublicExpertFreshObservation,
} from "./public-expert-recovery.js";
import { publicExpertPaymentSnapshotSchema } from "./public-expert-gateway-contracts.js";
import type { YooKassaPayment, YooKassaRefund } from "./contracts.js";
afterEach(() => vi.useRealTimers());
const delay = (signal?: AbortSignal, ms = 8000) =>
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
function fixture(bound = true) {
  vi.useFakeTimers();
  vi.setSystemTime("2027-01-11T12:01:00Z");
  let s = publicExpertPaymentSnapshotSchema.parse({
    version: 1,
    requestId: randomUUID(),
    userId: randomUUID(),
    product: "refund",
    kind: "main_refund",
    legacySourceId: randomUUID(),
    legacyOperationId: randomUUID(),
    mode: "test",
    amountMinor: "10000",
    currency: "RUB",
    idempotencyKey: randomUUID(),
    contactId: randomUUID(),
    parentPaymentId: "immutable_parent",
    requestDigest: `sha256:${"a".repeat(64)}`,
    bodyVersion: 1,
    bodyExpiresAt: "2027-01-12T10:00:00Z",
    paymentDeadline: "2027-01-11T14:00:00Z",
    providerDeadline: "2027-01-11T14:00:00Z",
    createdAt: "2027-01-11T12:00:00Z",
    state: bound ? "bound" : "uncertain",
    providerObjectId: bound ? "stage_refund" : null,
    envelope: { ciphertext: "fixture", keyReference: "public:fixture" },
  });
  const parent: YooKassaPayment = {
    id: "immutable_parent",
    status: "succeeded",
    paid: true,
    refundable: true,
    test: true,
    amount: { value: "100.00", currency: "RUB" },
    createdAt: "2027-01-11T11:59:00Z",
    capturedAt: "2027-01-11T11:59:30Z",
    metadata: {
      purpose: "main_residency",
      operation_id: randomUUID(),
      order_id: s.legacySourceId,
      user_id: s.userId,
    },
  };
  const refund: YooKassaRefund = {
    id: "stage_refund",
    paymentId: "immutable_parent",
    status: "pending",
    amount: { value: "100.00", currency: "RUB" },
    createdAt: s.createdAt,
    metadata: {
      purpose: "public_main_refund",
      operation_id: s.legacyOperationId,
      order_id: s.legacySourceId,
      user_id: s.userId,
    },
  };
  const facts: PublicExpertFreshObservation[] = [],
    reads: {
      kind: string;
      id: string;
      start: number;
      end: number | undefined;
    }[] = [];
  let binds = 0,
    active = 0,
    listed = 0,
    posts = 0,
    ambiguous = false,
    failRefund = false,
    refuseBinding = false;
  const transport = new PublicExpertGatewayTransport({
    dispatchPublic: async () => {
      posts++;
      throw Error("unexpected-post");
    },
    listPublicPage: async (
      _resource: unknown,
      _input: unknown,
      signal?: AbortSignal,
    ) => {
      listed++;
      active++;
      try {
        await delay(signal);
        return {
          items: ambiguous
            ? [
                structuredClone(refund),
                { ...structuredClone(refund), id: "duplicate_refund" },
              ]
            : [structuredClone(refund)],
        };
      } finally {
        active--;
      }
    },
    getRefund: async (id: string, signal?: AbortSignal) => {
      const read = {
        kind: "refund",
        id,
        start: Date.now(),
        end: undefined as number | undefined,
      };
      reads.push(read);
      active++;
      try {
        await delay(signal, failRefund ? 1000 : 8000);
        if (failRefund) throw Error("unavailable");
        read.end = Date.now();
        return structuredClone(refund);
      } finally {
        active--;
      }
    },
    getPayment: async (id: string, signal?: AbortSignal) => {
      const read = {
        kind: "parent",
        id,
        start: Date.now(),
        end: undefined as number | undefined,
      };
      reads.push(read);
      active++;
      try {
        await delay(signal);
        read.end = Date.now();
        return structuredClone(parent);
      } finally {
        active--;
      }
    },
  } as never);
  const recovery = new PublicExpertRecovery({
    transport,
    binder: {
      candidate: async () => structuredClone(s),
      bind: async (_id, fact) => {
        assertPublicExpertFreshObservation(fact);
        expect(fact.parentPaymentId).toBe("immutable_parent");
        expect(fact.identity).toEqual({
          purpose: "public_main_refund",
          operationId: s.legacyOperationId,
          orderId: s.legacySourceId,
          userId: s.userId,
        });
        if (refuseBinding) {
          refuseBinding = false;
          return null;
        }
        binds++;
        s = { ...s, state: "bound", providerObjectId: fact.providerObjectId };
        return structuredClone(s);
      },
    },
    observations: {
      observe: async (fact) => {
        assertPublicExpertFreshObservation(fact);
        expect(Date.parse(fact.observedAt)).toBeGreaterThanOrEqual(
          Math.max(
            ...reads
              .filter((read) => read.end !== undefined)
              .map((read) => read.end!),
          ),
        );
        facts.push(fact);
        return randomUUID();
      },
    },
  });
  return {
    recovery,
    transport,
    parent,
    refund,
    facts,
    reads,
    id: s.requestId,
    counts: () => ({ binds, active, listed, posts }),
    ambiguous: () => {
      ambiguous = true;
    },
    fail: () => {
      failRefund = true;
    },
    refuseBinding: () => {
      refuseBinding = true;
    },
  };
}
async function turn(f: ReturnType<typeof fixture>, ms = 15000) {
  const abort = new AbortController(),
    timer = setTimeout(() => abort.abort(), ms);
  try {
    const work = f.recovery.recover(f.id, { signal: abort.signal });
    await vi.advanceTimersByTimeAsync(ms);
    return await work;
  } finally {
    clearTimeout(timer);
  }
}
it("bound refund and immutable parent both take8s yet verify fresh within one15s turn", async () => {
  const f = fixture();
  expect((await turn(f)).kind).toBe("observed");
  expect(f.facts).toHaveLength(1);
  expect(f.reads.map((read) => read.id)).toEqual([
    "stage_refund",
    "immutable_parent",
  ]);
  expect(f.reads[0]!.start).toBe(f.reads[1]!.start);
  expect(f.counts()).toMatchObject({ active: 0, posts: 0 });
});
it("unbound refund retains complete discovery until its two fresh8s GETs can bind", async () => {
  const f = fixture(false);
  expect((await turn(f)).kind).toBe("pending");
  expect(f.counts().binds).toBe(0);
  expect(f.facts).toHaveLength(0);
  expect((await turn(f)).kind).toBe("observed");
  expect(f.counts()).toMatchObject({
    binds: 1,
    listed: 1,
    active: 0,
    posts: 0,
  });
});
it("binding refusal invalidates completed discovery and forces fresh complete selection", async () => {
  const f = fixture(false);
  await turn(f);
  f.refuseBinding();
  expect((await turn(f)).kind).toBe("pending");
  expect(f.facts).toHaveLength(0);
  expect((await turn(f)).kind).toBe("pending");
  expect(f.counts().binds).toBe(0);
  expect((await turn(f)).kind).toBe("observed");
  expect(f.counts()).toMatchObject({ listed: 2, binds: 1, posts: 0 });
});
it("a mismatching fresh GET discards the cached unique candidate instead of trusting LIST metadata", async () => {
  const f = fixture(false);
  await turn(f);
  const operation = f.refund.metadata!.operation_id!;
  f.refund.metadata!.operation_id = randomUUID();
  expect((await turn(f)).kind).toBe("pending");
  expect(f.facts).toHaveLength(0);
  expect(f.counts().binds).toBe(0);
  f.refund.metadata!.operation_id = operation;
  expect((await turn(f)).kind).toBe("pending");
  expect((await turn(f)).kind).toBe("observed");
  expect(f.counts()).toMatchObject({ listed: 2, binds: 1, posts: 0 });
});
it("aborted parallel verification persists no half-pair and retries both GETs fresh", async () => {
  const f = fixture();
  expect((await turn(f, 4000)).kind).toBe("pending");
  expect(f.facts).toHaveLength(0);
  expect(f.counts().active).toBe(0);
  expect(f.reads.map((read) => read.kind)).toEqual(["refund", "parent"]);
  expect((await turn(f)).kind).toBe("observed");
  expect(f.reads.filter((read) => read.kind === "refund")).toHaveLength(2);
  expect(f.reads.filter((read) => read.kind === "parent")).toHaveLength(2);
  expect(f.counts().posts).toBe(0);
});
it.each([
  "refund_parent",
  "refund_source",
  "parent_id",
  "parent_source",
  "parent_user",
  "parent_mode",
  "parent_capture",
] as const)(
  "rejects %s mismatch against immutable source and parent authority",
  async (kind) => {
    const f = fixture();
    if (kind === "refund_parent") f.refund.paymentId = "other-parent";
    if (kind === "refund_source")
      f.refund.metadata!.operation_id = randomUUID();
    if (kind === "parent_id") f.parent.id = "other-parent";
    if (kind === "parent_source") f.parent.metadata.order_id = randomUUID();
    if (kind === "parent_user") f.parent.metadata.user_id = randomUUID();
    if (kind === "parent_mode") f.parent.test = false;
    if (kind === "parent_capture") f.parent.capturedAt = "2027-01-11T11:58:00Z";
    expect((await turn(f)).kind).toBe("pending");
    expect(f.facts).toHaveLength(0);
    expect(f.counts()).toMatchObject({ binds: 0, active: 0, posts: 0 });
  },
);
it("ambiguous complete discovery is discarded and never reaches GET or binding", async () => {
  const f = fixture(false);
  f.ambiguous();
  expect((await turn(f)).kind).toBe("pending");
  expect((await turn(f)).kind).toBe("pending");
  expect(f.counts()).toMatchObject({ listed: 2, binds: 0, posts: 0 });
  expect(f.reads).toHaveLength(0);
});
it("one failed read still drains its concurrently running sibling before returning", async () => {
  const f = fixture();
  f.fail();
  const abort = new AbortController();
  let done = false;
  const work = f.recovery
    .recover(f.id, { signal: abort.signal })
    .then((result) => {
      done = true;
      return result;
    });
  await vi.advanceTimersByTimeAsync(2000);
  const prematurelyFinished = done;
  await vi.advanceTimersByTimeAsync(10000);
  expect((await work).kind).toBe("pending");
  expect(prematurelyFinished).toBe(false);
  expect(f.counts().active).toBe(0);
  expect(f.facts).toHaveLength(0);
});
