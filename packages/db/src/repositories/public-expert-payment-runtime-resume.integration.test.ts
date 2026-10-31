import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import {
  ExperimentalGatewayIpc,
  type YooKassaPayment,
  type YooKassaRefund,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import {
  createPublicExpertPaymentRuntime,
  type PublicExpertRuntimeConfiguration,
} from "../public-expert-payment-runtime.js";
import {
  startPublicExpertTestDatabase,
  createPublicOnboardingFixture,
  publicTestPrincipal,
  publicTestDigest,
  publicTestVault,
} from "../testkit/public-expert-payment.js";
import {
  publicFinancialOwner,
  publicFinancialPrepared,
  publicFinancialCall,
  publicFinancialClock,
} from "../testkit/public-expert-payment-financial.js";
import {
  PostgresPublicExpertPaymentSource,
  PostgresPublicExpertPaymentObservations,
} from "./public-expert-payment-gateway.js";
import { PostgresYooKassaOperationRepository } from "./yookassa-operation-repository.js";

// Distinct crash/reconstruction cases: all provider facts enter via the real
// runtime GET verifier. Faults occur only at actual SQL transaction boundaries.
let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
const pools: DrizzleDb[] = [];
const runtimes: ReturnType<typeof createPublicExpertPaymentRuntime>[] = [];
let config: PublicExpertRuntimeConfiguration;
let source: PostgresPublicExpertPaymentSource, gateway: DrizzleDb;
let now = Date.parse("2027-01-11T12:00:00Z");
const realNow = Date.now;
const payments = new Map<string, YooKassaPayment>();
const refunds = new Map<string, YooKassaRefund>();
let posts = 0,
  gets = 0;
const q = (text: string, args: unknown[] = []) =>
  context.db.db.$client.query(text, args);
async function clock(at: string) {
  now = Date.parse(at);
  await publicFinancialClock(context.db, at);
}
function runtime(
  db = context.db.db,
  observations = config.connections.observations.db,
) {
  const r = createPublicExpertPaymentRuntime(db, {
    ...config,
    connections: {
      ...config.connections,
      observations: { ...config.connections.observations, db: observations },
    },
  });
  runtimes.push(r);
  return r;
}
beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
  const connections = {} as PublicExpertRuntimeConfiguration["connections"];
  for (const [name, label] of [
    ["onboardingSender", "onboarding"],
    ["mainSender", "main"],
    ["refundSender", "refund"],
    ["binder", "binder"],
    ["observations", "writer"],
  ] as const) {
    const db = await publicTestPrincipal(context, label);
    pools.push(db);
    connections[name] = {
      db,
      login: (await db.$client.query("select session_user login")).rows[0]!
        .login,
    };
  }
  gateway = await publicTestPrincipal(context, "gateway");
  pools.push(gateway);
  source = new PostgresPublicExpertPaymentSource({
    onboarding: connections.onboardingSender.db,
    main: connections.mainSender.db,
    refund: connections.refundSender.db,
  });
  const ipc = new ExperimentalGatewayIpc({
    address: "\0resume-fixture",
    key: new Uint8Array(32).fill(1),
    authKey: new Uint8Array(32).fill(2),
    timeoutMs: 1000,
  });
  vi.spyOn(ipc, "dispatchPublic").mockImplementation(async () => {
    posts++;
    throw Error("unexpected_POST");
  });
  vi.spyOn(ipc, "getPayment").mockImplementation(async (id) => {
    gets++;
    const p = payments.get(id);
    if (!p) throw Error("unknown_payment");
    return structuredClone(p);
  });
  vi.spyOn(ipc, "getRefund").mockImplementation(async (id) => {
    gets++;
    const p = refunds.get(id);
    if (!p) throw Error("unknown_refund");
    return structuredClone(p);
  });
  vi.spyOn(ipc, "listPublicPage").mockImplementation(
    async (resource, input) => ({
      items: structuredClone(
        [...(resource === "payments" ? payments : refunds).values()].filter(
          (p) =>
            Date.parse(p.createdAt) >= Date.parse(input.createdFrom) &&
            Date.parse(p.createdAt) < Date.parse(input.createdTo),
        ),
      ),
    }),
  );
  const key = Buffer.alloc(32, 7);
  config = {
    connections,
    gateway: ipc,
    mode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    vault: publicTestVault,
    requestKey: key,
    requestKeyReference: "fixture",
    retainedRequestKeys: new Map([["fixture", key]]),
    returnUrl: "https://example.invalid/return",
    vatCode: 1,
  };
  vi.spyOn(Date, "now").mockImplementation(() => now);
}, 120000);
afterAll(async () => {
  await Promise.all(runtimes.map((r) => r.stop()));
  vi.restoreAllMocks();
  await Promise.all(pools.map((db) => db.$client.end()));
  await context?.db.stop();
}, 120000);

type Subject = {
  requestId: string;
  sourceId: string;
  product: "onboarding" | "main" | "refund";
  objectId: string;
  parentId?: string;
};
async function claim(
  userId: string,
  d: {
    requestId: string;
    idempotencyKey: string;
    requestDigest: string;
    kind: string;
  },
  contact: string | null,
) {
  expect(
    (
      await gateway.$client.query(
        "select public.public_expert_gateway_claim($1,$2,$3,$4,$5,$6) value",
        [
          userId,
          d.requestId,
          contact,
          d.idempotencyKey,
          d.requestDigest,
          d.kind,
        ],
      )
    ).rows[0]!.value,
  ).toBeTruthy();
}
function descriptor(
  kind: "onboarding_create" | "onboarding_capture" | "main_refund",
) {
  const capture = kind === "onboarding_capture";
  return {
    requestId: randomUUID(),
    idempotencyKey: randomUUID() as string,
    legacyDeliveryOperationId: null,
    kind,
    requestDigest: publicTestDigest(randomUUID()),
    bodyVersion: 1 as const,
    ciphertext: capture ? null : "unused-recovery-only",
    keyReference: capture ? null : "fixture:key",
    bodyExpiresAt: capture ? null : "2027-01-11T22:00:00Z",
  };
}
async function onboarding(): Promise<Subject> {
  await clock("2027-01-11T12:00:00Z");
  const f = await createPublicOnboardingFixture(context),
    d = descriptor("onboarding_create");
  const s = await source.prepare(
    "onboarding",
    f.userId,
    f.invoiceId,
    f.contactId,
    d,
  );
  if (!s) throw Error("create_missing");
  expect(await source.admit(s)).toBeTruthy();
  await claim(f.userId, d, f.contactId);
  const id = `resume_${randomUUID()}`;
  payments.set(id, {
    id,
    status: "waiting_for_capture",
    paid: true,
    test: true,
    amount: { value: "3000.00", currency: "RUB" },
    createdAt: "2027-01-11T11:59:59.999Z",
    paymentMethodType: "bank_card",
    metadata: {
      purpose: "onboarding",
      operation_id: f.operationId,
      order_id: f.invoiceId,
      user_id: f.userId,
    },
    refundable: true,
  });
  expect((await runtime().recovery.recover(d.requestId)).kind).toBe("observed");
  const c = descriptor("onboarding_capture");
  const captured = await source.prepare(
    "onboarding",
    f.userId,
    f.invoiceId,
    null,
    c,
  );
  if (!captured) throw Error("capture_missing");
  expect(await source.admit(captured)).toBeTruthy();
  await claim(f.userId, c, null);
  payments.set(id, {
    ...payments.get(id)!,
    status: "succeeded",
    capturedAt: "2027-01-11T12:00:00.123456Z",
  });
  await clock("2027-01-11T12:00:01Z");
  return {
    requestId: c.requestId,
    sourceId: f.invoiceId,
    objectId: id,
    product: "onboarding",
  };
}
async function main() {
  // The legacy approved-card fixture uses actual wall-clock captures. Keep its
  // creation/capture clock coherent before switching to the public runtime seam.
  now = realNow();
  const f = await publicFinancialPrepared(
    context.db,
    await publicFinancialOwner(context.db),
  );
  const id = `resume_${randomUUID()}`;
  payments.set(id, {
    id,
    status: "succeeded",
    paid: true,
    test: true,
    amount: {
      value: (Number(f.s.amountMinor) / 100).toFixed(2),
      currency: "RUB",
    },
    createdAt: "2027-01-11T20:00:00Z",
    capturedAt: "2027-01-11T20:00:00.123456Z",
    paymentMethodType: "bank_card",
    metadata: {
      purpose: "main_residency",
      operation_id: f.s.legacyOperationId,
      order_id: f.order.orderId,
      user_id: f.userId,
    },
    refundable: true,
  });
  await clock("2027-01-11T20:00:01Z");
  return {
    ...f,
    subject: {
      requestId: f.d.requestId,
      sourceId: f.order.orderId,
      objectId: id,
      product: "main" as const,
    },
  };
}
async function refund(): Promise<Subject> {
  const f = await main();
  expect((await runtime().recovery.recover(f.d.requestId)).kind).toBe(
    "observed",
  );
  const operations = new PostgresYooKassaOperationRepository(context.db.db);
  await operations.resolve(f.s.legacyOperationId, "succeeded");
  const d = descriptor("main_refund");
  const op = await operations.claim({
    commandId: randomUUID(),
    orderId: f.order.orderId,
    kind: "create_refund",
    mode: "test",
    amountMinor: f.s.amountMinor,
    currency: "RUB",
    parentPaymentId: f.subject.objectId,
    requestDigest: d.requestDigest,
  });
  d.idempotencyKey = op.idempotencyKey;
  const s = await source.prepare("refund", f.userId, op.id, f.s.contactId, d);
  if (!s) throw Error("refund_missing");
  expect(await source.admit(s)).toBeTruthy();
  await claim(f.userId, d, f.s.contactId);
  const id = `refund_${randomUUID()}`;
  refunds.set(id, {
    id,
    status: "succeeded",
    paymentId: f.subject.objectId,
    amount: payments.get(f.subject.objectId)!.amount,
    createdAt: "2027-01-11T20:00:02.654321Z",
    metadata: {
      purpose: "public_main_refund",
      operation_id: op.id,
      order_id: f.order.orderId,
      user_id: f.userId,
    },
  });
  await clock("2027-01-11T20:00:03Z");
  return {
    requestId: d.requestId,
    sourceId: f.order.orderId,
    objectId: id,
    parentId: f.subject.objectId,
    product: "refund",
  };
}
async function subject(product: Subject["product"]) {
  return product === "onboarding"
    ? onboarding()
    : product === "refund"
      ? refund()
      : (await main()).subject;
}
type Fault = "resolved" | "rollback" | "committed";
function crashing(fault: Fault) {
  let committed = false,
    injected = false;
  const db = new Proxy(context.db.db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return async (work: Parameters<DrizzleDb["transaction"]>[0]) => {
          const result = await target.transaction(async (tx) => {
            const value = await work(tx);
            if (fault === "rollback") {
              injected = true;
              throw Error("fixture_financial_rollback");
            }
            return value;
          });
          committed = true;
          return result;
        };
      return Reflect.get(target, key, receiver);
    },
  });
  const observations = new Proxy(config.connections.observations.db, {
    get(target, key, receiver) {
      if (key === "execute")
        return async (query: SQL) => {
          const text = new PgDialect().sqlToQuery(query).sql;
          if (
            fault === "committed" &&
            committed &&
            text.includes("public_payment_complete")
          ) {
            injected = true;
            throw Error("fixture_lost_completion");
          }
          const result = await target.execute(query);
          if (fault === "resolved" && text.includes("public_payment_resolve")) {
            injected = true;
            throw Error("fixture_after_resolve");
          }
          return result;
        };
      return Reflect.get(target, key, receiver);
    },
  });
  return Object.assign(runtime(db, observations), { injected: () => injected });
}
async function stored(s: Subject) {
  return (
    await q(
      "select a.observation_id,a.apply_attempt_id,o.evidence_digest,o.observed_at::text observed_at from public_expert_payment_resolutions a join public_expert_payment_observations o on o.id=a.observation_id where a.request_id=$1 and a.kind='apply_attempt'",
      [s.requestId],
    )
  ).rows[0]!;
}
async function financial(s: Subject) {
  if (s.product === "onboarding")
    return (
      await q(
        "select event_id,evidence_digest,captured_at::text captured_at from expert_onboarding_payment_facts where invoice_id=$1",
        [s.sourceId],
      )
    ).rows;
  return (
    await q(
      "select external_event_id event_id,'sha256:'||payload_digest evidence_digest,status,event_kind from expert_residency_provider_event_inbox where order_id=$1 and event_kind=$2",
      [s.sourceId, s.product === "refund" ? "refunded" : "settled"],
    )
  ).rows;
}
for (const product of ["onboarding", "main", "refund"] as const) {
  it.each(["resolved", "rollback", "committed"] as const)(
    `${product}: resumes original attempt after %s using reconstructed runtime and fresh GET`,
    async (fault) => {
      const s = await subject(product),
        beforeGets = gets;
      const broken = crashing(fault);
      await expect(broken.recovery.recover(s.requestId)).rejects.toThrow(
        fault === "resolved"
          ? "fixture_after_resolve"
          : fault === "rollback"
            ? product === "onboarding"
              ? "verification_storage_unavailable"
              : "fixture_financial_rollback"
            : "fixture_lost_completion",
      );
      expect(broken.injected()).toBe(true);
      await broken.stop();
      const original = await stored(s);
      expect(original).toBeTruthy();
      const committedFact = await financial(s);
      expect(committedFact).toHaveLength(fault === "committed" ? 1 : 0);
      if (fault === "resolved") {
        await clock(new Date(now + 1000).toISOString());
        const interruptedAgain = crashing("resolved");
        await expect(
          interruptedAgain.recovery.recover(s.requestId),
        ).rejects.toThrow("fixture_after_resolve");
        expect(interruptedAgain.injected()).toBe(true);
        const freshId = (
          await q(
            "select id from public_expert_payment_observations where request_id=$1 order by observation_sequence desc limit 1",
            [s.requestId],
          )
        ).rows[0]!.id;
        expect(freshId).not.toBe(original.observation_id);
        expect(
          await publicFinancialCall(context.db, "public_payment_apply_guard", [
            s.requestId,
            freshId,
            original.apply_attempt_id,
          ]),
        ).toBeNull();
        expect(
          (
            await q(
              "select apply_observation_id from public_expert_payment_requests where id=$1",
              [s.requestId],
            )
          ).rows[0]!.apply_observation_id,
        ).toBeNull();
      }
      await clock(new Date(now + 1000).toISOString());
      const rebuilt = runtime();
      const fresh = await rebuilt.recovery.recover(s.requestId);
      expect(fresh.kind).toBe("observed");
      if (fresh.kind !== "observed") throw Error("fresh_GET_missing");
      expect(fresh.observationId).not.toBe(original.observation_id);
      expect(await stored(s)).toEqual(original);
      expect(
        (
          await q(
            "select observation_id,apply_attempt_id from public_expert_payment_resolutions where request_id=$1 and kind='applied'",
            [s.requestId],
          )
        ).rows,
      ).toEqual([
        {
          observation_id: original.observation_id,
          apply_attempt_id: original.apply_attempt_id,
        },
      ]);
      const facts = await financial(s);
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        event_id: `public:${s.requestId}:${original.observation_id}`,
        evidence_digest: original.evidence_digest,
      });
      if (product === "onboarding")
        expect(facts[0]!.captured_at).toBe("2027-01-11 12:00:00.123456+00");
      if (fault === "committed") expect(facts).toEqual(committedFact);
      await clock(new Date(now + 1000).toISOString());
      const again = await runtime().recovery.recover(s.requestId);
      expect(again.kind).toBe("observed");
      if (again.kind !== "observed") throw Error("repeated_GET_missing");
      const observed = new PostgresPublicExpertPaymentObservations(
        config.connections.observations.db,
      );
      expect(
        await observed.resolve(s.requestId, again.observationId),
      ).toMatchObject({
        kind: "already_applied",
        observationId: original.observation_id,
        applyAttemptId: original.apply_attempt_id,
      });
      expect(await financial(s)).toEqual(facts);
      expect(gets - beforeGets).toBeGreaterThanOrEqual(
        product === "refund" ? 6 : 3,
      );
      expect(posts).toBe(0);
    },
    60000,
  );
}

it("quarantines a fresh conflicting immutable payment method and never resumes its original attempt", async () => {
  const s = (await main()).subject;
  await expect(
    crashing("resolved").recovery.recover(s.requestId),
  ).rejects.toThrow("fixture_after_resolve");
  const original = await stored(s),
    payment = payments.get(s.objectId)!;
  payments.set(s.objectId, { ...payment, paymentMethodType: "sbp" });
  await clock(new Date(now + 1000).toISOString());
  expect((await runtime().recovery.recover(s.requestId)).kind).toBe("observed");
  expect(await financial(s)).toHaveLength(0);
  expect(
    (
      await q(
        "select reason,apply_attempt_id from public_expert_payment_resolutions where request_id=$1 and kind='manual_reconciliation'",
        [s.requestId],
      )
    ).rows,
  ).toEqual([
    {
      reason: "fresh_terminal_fact_conflict",
      apply_attempt_id: original.apply_attempt_id,
    },
  ]);
  payments.set(s.objectId, payment);
  await clock(new Date(now + 1000).toISOString());
  expect((await runtime().recovery.recover(s.requestId)).kind).toBe("observed");
  expect(await financial(s)).toHaveLength(0);
  expect(await stored(s)).toEqual(original);
  expect(posts).toBe(0);
}, 60000);

it.each(["amount", "identity", "mode", "capture", "status"] as const)(
  "refuses fresh %s contradictions before resuming onboarding",
  async (field) => {
    const s = await onboarding();
    await expect(
      crashing("resolved").recovery.recover(s.requestId),
    ).rejects.toThrow("fixture_after_resolve");
    const original = await stored(s),
      p = payments.get(s.objectId)!;
    const canceled = { ...p, status: "canceled" as const, paid: false };
    delete canceled.capturedAt;
    payments.set(
      s.objectId,
      field === "amount"
        ? { ...p, amount: { value: "3000.01", currency: "RUB" } }
        : field === "identity"
          ? { ...p, metadata: { ...p.metadata, order_id: randomUUID() } }
          : field === "mode"
            ? { ...p, test: false }
            : field === "capture"
              ? { ...p, capturedAt: "2027-01-11T12:00:00.123457Z" }
              : canceled,
    );
    await clock(new Date(now + 1000).toISOString());
    expect((await runtime().recovery.recover(s.requestId)).kind).toBe(
      "pending",
    );
    expect(await financial(s)).toHaveLength(0);
    expect(await stored(s)).toEqual(original);
    expect(posts).toBe(0);
  },
  60000,
);

it("refuses a fresh refund with a different parent without altering its immutable attempt", async () => {
  const s = await refund();
  await expect(
    crashing("resolved").recovery.recover(s.requestId),
  ).rejects.toThrow("fixture_after_resolve");
  const original = await stored(s);
  refunds.set(s.objectId, {
    ...refunds.get(s.objectId)!,
    paymentId: `wrong_${randomUUID()}`,
  });
  await clock(new Date(now + 1000).toISOString());
  expect((await runtime().recovery.recover(s.requestId)).kind).toBe("pending");
  expect(await financial(s)).toHaveLength(0);
  expect(await stored(s)).toEqual(original);
  expect(posts).toBe(0);
}, 60000);
