import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  PublicExpertRecovery,
  type YooKassaPayment,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import {
  startPublicExpertTestDatabase,
  createPublicOnboardingFixture,
  publicTestPrincipal,
  publicTestDigest,
  createPublicTestReplay,
} from "../testkit/public-expert-payment.js";
import { publicFinancialClock } from "../testkit/public-expert-payment-financial.js";
import {
  PostgresPublicExpertPaymentSource,
  PostgresPublicExpertPaymentBinder,
  PostgresPublicExpertPaymentObservations,
  PostgresPublicExpertPaymentPosting,
} from "./public-expert-payment-gateway.js";
import { PostgresExpertVerificationRepository } from "./expert-verification-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
const connections: DrizzleDb[] = [];
let source: PostgresPublicExpertPaymentSource,
  binder: PostgresPublicExpertPaymentBinder,
  observations: PostgresPublicExpertPaymentObservations,
  gateway: DrizzleDb;
let posting: PostgresPublicExpertPaymentPosting,
  verification: PostgresExpertVerificationRepository;
const capture = "2027-01-11T12:00:00.123456Z";
const q = (text: string, values: unknown[] = []) =>
  context.db.db.$client.query(text, values);
async function clock(at: string) {
  await publicFinancialClock(context.db, at);
}
beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
  const sender = await publicTestPrincipal(context, "onboarding");
  const binderDb = await publicTestPrincipal(context, "binder");
  const writer = await publicTestPrincipal(context, "writer");
  gateway = await publicTestPrincipal(context, "gateway");
  connections.push(sender, binderDb, writer, gateway);
  source = new PostgresPublicExpertPaymentSource({
    onboarding: sender,
    main: sender,
    refund: sender,
  });
  binder = new PostgresPublicExpertPaymentBinder(binderDb);
  observations = new PostgresPublicExpertPaymentObservations(writer);
  verification = new PostgresExpertVerificationRepository(context.db.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  posting = new PostgresPublicExpertPaymentPosting(
    observations,
    new PostgresExpertResidencyProviderInboxRepository(context.db.db),
    verification,
  );
}, 120000);
afterAll(async () => {
  await Promise.all(connections.map((c) => c.$client.end()));
  await context?.db.stop();
}, 120000);
async function heldPair() {
  await clock("2027-01-11T12:00:00.000Z");
  const f = await createPublicOnboardingFixture(context);
  const requestId = randomUUID(),
    idempotencyKey = randomUUID(),
    requestDigest = publicTestDigest(randomUUID());
  const replay = await createPublicTestReplay();
  const envelope = await replay.protector.protect({
    body: "{}",
    bodyVersion: 1,
    associatedData: {
      operationId: requestId,
      operationKind: "create_payment",
      idempotencyKey,
      requestDigest,
      bodyVersion: 1,
    },
  });
  const created = await source.prepare(
    "onboarding",
    f.userId,
    f.invoiceId,
    f.contactId,
    {
      requestId,
      idempotencyKey,
      legacyDeliveryOperationId: null,
      kind: "onboarding_create",
      requestDigest,
      bodyVersion: 1,
      ciphertext: envelope.ciphertext,
      keyReference: envelope.keyReference,
      bodyExpiresAt: envelope.expiresAt,
    },
  );
  if (!created) throw Error("held_replay_create_missing");
  expect(await source.admit(created)).not.toBeNull();
  expect(
    (
      await gateway.$client.query(
        "select public.public_expert_gateway_claim($1,$2,$3,$4,$5,$6) value",
        [
          f.userId,
          created.requestId,
          f.contactId,
          created.idempotencyKey,
          created.requestDigest,
          created.kind,
        ],
      )
    ).rows[0]!.value,
  ).not.toBeNull();
  let at = "2027-01-11T12:00:00.000Z";
  let payment: YooKassaPayment = {
    id: `held_replay_${randomUUID()}`,
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
  };
  const recovery = new PublicExpertRecovery({
    binder,
    observations,
    now: () => at,
    transport: {
      listPayments: async () => ({ complete: true as const, items: [payment] }),
      getPayment: async () => payment,
      listRefunds: async () => ({ complete: true as const, items: [] }),
      getRefund: async () => {
        throw Error("unexpected_refund");
      },
    },
  });
  expect((await recovery.recover(created.requestId)).kind).toBe("observed");
  const captured = await source.prepare(
    "onboarding",
    f.userId,
    f.invoiceId,
    null,
    {
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      legacyDeliveryOperationId: null,
      kind: "onboarding_capture",
      requestDigest: publicTestDigest(randomUUID()),
      bodyVersion: 1,
      ciphertext: null,
      keyReference: null,
      bodyExpiresAt: null,
    },
  );
  if (!captured) throw Error("held_replay_capture_missing");
  expect(await source.admit(captured)).not.toBeNull();
  expect(
    (
      await gateway.$client.query(
        "select public.public_expert_gateway_claim($1,$2,$3,$4,$5,$6) value",
        [
          f.userId,
          captured.requestId,
          null,
          captured.idempotencyKey,
          captured.requestDigest,
          captured.kind,
        ],
      )
    ).rows[0]!.value,
  ).not.toBeNull();
  payment = { ...payment, status: "succeeded", capturedAt: capture };
  async function observe(id: string, second = 1) {
    at = `2027-01-11T12:00:0${second}.000Z`;
    await clock(at);
    return recovery.recover(id);
  }
  return {
    ...f,
    created,
    captured,
    observe,
    setPayment: (p: YooKassaPayment) => {
      payment = p;
    },
    payment: () => payment,
  };
}
async function fact(invoice: string) {
  return (
    await q(
      "select to_jsonb(f) fact from expert_onboarding_payment_facts f where invoice_id=$1",
      [invoice],
    )
  ).rows[0]!.fact;
}
async function applied(
  id: string,
  result: Awaited<ReturnType<Awaited<ReturnType<typeof heldPair>>["observe"]>>,
) {
  if (result.kind !== "observed") throw Error("fresh_success_not_observed");
  return posting.apply(id, result.observationId);
}
it.each(["capture", "create"] as const)(
  "acknowledges %s-first settlement and fresh GETs through both requests without changing the canonical paid fact",
  async (first) => {
    const f = await heldPair();
    const initial = first === "capture" ? f.captured : f.created,
      other = first === "capture" ? f.created : f.captured;
    expect(
      await applied(initial.requestId, await f.observe(initial.requestId)),
    ).toMatchObject({ kind: "already_applied" });
    const original = await fact(f.invoiceId);
    expect(original.captured_at).toBe("2027-01-11T12:00:00.123456+00:00");
    expect(
      await applied(other.requestId, await f.observe(other.requestId, 2)),
    ).toMatchObject({ kind: "already_applied" });
    expect(
      await applied(initial.requestId, await f.observe(initial.requestId, 3)),
    ).toMatchObject({ kind: "already_applied" });
    expect(
      await applied(other.requestId, await f.observe(other.requestId, 4)),
    ).toMatchObject({ kind: "already_applied" });
    expect(await fact(f.invoiceId)).toEqual(original);
    expect(
      (
        await q(
          "select count(*)::int n from expert_sales_paid_locks where invoice_id=$1",
          [f.invoiceId],
        )
      ).rows[0]!.n,
    ).toBe(1);
    expect(
      (
        await q(
          "select count(*)::int n from audit_events where action='expert_onboarding.payment_verified' and object_id=$1",
          [f.invoiceId],
        )
      ).rows[0]!.n,
    ).toBe(1);
    expect(
      (
        await q(
          "select count(*)::int n from public_expert_payment_resolutions r join public_expert_payment_requests p on p.id=r.request_id where p.invoice_id=$1 and r.kind='manual_reconciliation'",
          [f.invoiceId],
        )
      ).rows[0]!.n,
    ).toBe(0);
  },
);
it("repairs CAPTURE commit-before-complete from immutable evidence and acknowledges CREATE after archive without reactivation", async () => {
  const f = await heldPair();
  const terminal = await f.observe(f.captured.requestId);
  if (terminal.kind !== "observed") throw Error("fresh_capture_missing");
  const action = await observations.resolve(
    f.captured.requestId,
    terminal.observationId,
  );
  if (!action?.applyAttemptId) throw Error("capture_apply_attempt_missing");
  expect(
    await verification.applyPublic(
      f.captured.requestId,
      terminal.observationId,
      action.applyAttemptId,
    ),
  ).toMatchObject({ settled: true });
  const original = await fact(f.invoiceId);
  await q(
    "update expert_onboarding_applications set archived_at=clock_timestamp(),archive_until_date=clock_timestamp()+interval '1 day' where id=$1",
    [f.applicationId],
  );
  const archived = (
    await q(
      "select to_jsonb(a) app from expert_onboarding_applications a where id=$1",
      [f.applicationId],
    )
  ).rows[0]!.app;
  expect(
    await applied(f.created.requestId, await f.observe(f.created.requestId, 2)),
  ).toMatchObject({ kind: "already_applied" });
  expect(
    await applied(
      f.captured.requestId,
      await f.observe(f.captured.requestId, 3),
    ),
  ).toMatchObject({ kind: "already_applied" });
  expect(await fact(f.invoiceId)).toEqual(original);
  expect(
    (
      await q(
        "select to_jsonb(a) app from expert_onboarding_applications a where id=$1",
        [f.applicationId],
      )
    ).rows[0]!.app,
  ).toEqual(archived);
  expect(
    (
      await q(
        "select count(*)::int n from public_expert_payment_resolutions r join public_expert_payment_requests p on p.id=r.request_id where p.invoice_id=$1 and r.kind='applied'",
        [f.invoiceId],
      )
    ).rows[0]!.n,
  ).toBe(2);
});
it("retains the first fact and refuses wrong parent, amount, source and contradictory microsecond capture on a sibling request", async () => {
  const f = await heldPair();
  expect(
    await applied(f.captured.requestId, await f.observe(f.captured.requestId)),
  ).toMatchObject({ kind: "already_applied" });
  const original = await fact(f.invoiceId),
    payment = f.payment();
  for (const malformed of [
    { ...payment, id: `other_${randomUUID()}` },
    { ...payment, amount: { value: "3000.01", currency: "RUB" as const } },
    { ...payment, metadata: { ...payment.metadata, order_id: randomUUID() } },
  ]) {
    f.setPayment(malformed);
    expect((await f.observe(f.created.requestId, 2)).kind).toBe("pending");
  }
  f.setPayment({ ...payment, capturedAt: "2027-01-11T12:00:00.123455Z" });
  const contradictory = await f.observe(f.created.requestId, 3);
  if (contradictory.kind !== "observed")
    throw Error("contradictory_fresh_fact_not_retained");
  expect(
    await posting.apply(f.created.requestId, contradictory.observationId),
  ).toMatchObject({ kind: "manual_reconciliation" });
  expect(await fact(f.invoiceId)).toEqual(original);
  expect(
    (
      await q(
        "select count(*)::int n from expert_sales_paid_locks where invoice_id=$1",
        [f.invoiceId],
      )
    ).rows[0]!.n,
  ).toBe(1);
});

it("serializes first CREATE and CAPTURE postings so the held parent is financially applied once", async () => {
  const f = await heldPair();
  const create = await f.observe(f.created.requestId),
    capture = await f.observe(f.captured.requestId, 2);
  const results = await Promise.all([
    applied(f.created.requestId, create),
    applied(f.captured.requestId, capture),
  ]);
  expect(results).toMatchObject([
    { kind: "already_applied" },
    { kind: "already_applied" },
  ]);
  expect(
    (
      await q(
        "select count(*)::int n from expert_onboarding_payment_facts where invoice_id=$1",
        [f.invoiceId],
      )
    ).rows[0]!.n,
  ).toBe(1);
  expect(
    (
      await q(
        "select count(*)::int n from expert_sales_paid_locks where invoice_id=$1",
        [f.invoiceId],
      )
    ).rows[0]!.n,
  ).toBe(1);
  expect(
    (
      await q(
        "select count(*)::int n from audit_events where action='expert_onboarding.payment_verified' and object_id=$1",
        [f.invoiceId],
      )
    ).rows[0]!.n,
  ).toBe(1);
});
it("refuses completion inside the real first financial transaction and acknowledges only its committed fact", async () => {
  const f = await heldPair(),
    observed = await f.observe(f.captured.requestId);
  if (observed.kind !== "observed") throw Error("fresh_capture_missing");
  const action = await observations.resolve(
    f.captured.requestId,
    observed.observationId,
  );
  if (!action?.applyAttemptId) throw Error("capture_apply_attempt_missing");
  type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
  let checked = false;
  // Inspect the actual canonical callback immediately before its real commit;
  // all verification, guard, fact, paid-lock and workspace writes are unchanged.
  const inspectedDb = new Proxy(context.db.db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return (work: (tx: Tx) => Promise<unknown>) =>
          target.transaction(async (tx) => {
            const result = await work(tx);
            const inside = (
              await tx.execute<{ value: unknown }>(
                sql`select early_bird_private.public_payment_complete(${f.captured.requestId}::uuid,${action.applyAttemptId}::uuid) value`,
              )
            ).rows[0]!.value;
            expect(inside).toMatchObject({ kind: "not_ready" });
            checked = true;
            return result;
          });
      return Reflect.get(target, key, receiver);
    },
  });
  const verifier = new PostgresExpertVerificationRepository(inspectedDb, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  expect(
    await verifier.applyPublic(
      f.captured.requestId,
      observed.observationId,
      action.applyAttemptId,
    ),
  ).toMatchObject({ settled: true });
  expect(checked).toBe(true);
  expect(
    await observations.complete(f.captured.requestId, action.applyAttemptId),
  ).toMatchObject({ kind: "already_applied" });
});
