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
} from "./public-expert-payment-gateway.js";
import { PostgresExpertVerificationRepository } from "./expert-verification-repository.js";
let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
const connections: DrizzleDb[] = [];
let source: PostgresPublicExpertPaymentSource,
  binder: PostgresPublicExpertPaymentBinder,
  observations: PostgresPublicExpertPaymentObservations,
  gateway: DrizzleDb;
const q = (text: string, values: unknown[] = []) =>
  context.db.db.$client.query(text, values);
beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
  const sender = await publicTestPrincipal(context, "onboarding"),
    binderDb = await publicTestPrincipal(context, "binder"),
    writer = await publicTestPrincipal(context, "writer");
  gateway = await publicTestPrincipal(context, "gateway");
  connections.push(sender, binderDb, writer, gateway);
  source = new PostgresPublicExpertPaymentSource({
    onboarding: sender,
    main: sender,
    refund: sender,
  });
  binder = new PostgresPublicExpertPaymentBinder(binderDb);
  observations = new PostgresPublicExpertPaymentObservations(writer);
}, 120000);
afterAll(async () => {
  await Promise.all(connections.map((c) => c.$client.end()));
  await context?.db.stop();
}, 120000);
async function preparedPair() {
  await publicFinancialClock(context.db, "2027-01-11T12:00:00.000Z");
  const f = await createPublicOnboardingFixture(context);
  const requestId = randomUUID(),
    idempotencyKey = randomUUID(),
    requestDigest = publicTestDigest("{}");
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
  if (!created) throw Error("savepoint_create_missing");
  async function claim(
    snapshot: NonNullable<typeof created>,
    contact: string | null,
  ) {
    expect(await source.admit(snapshot)).not.toBeNull();
    expect(
      (
        await gateway.$client.query(
          "select public.public_expert_gateway_claim($1,$2,$3,$4,$5,$6) value",
          [
            f.userId,
            snapshot.requestId,
            contact,
            snapshot.idempotencyKey,
            snapshot.requestDigest,
            snapshot.kind,
          ],
        )
      ).rows[0]!.value,
    ).not.toBeNull();
  }
  await claim(created, f.contactId);
  let at = "2027-01-11T12:00:00.000Z";
  let payment: YooKassaPayment = {
    id: `savepoint_${randomUUID()}`,
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
      requestDigest: publicTestDigest("{}"),
      bodyVersion: 1,
      ciphertext: null,
      keyReference: null,
      bodyExpiresAt: null,
    },
  );
  if (!captured) throw Error("savepoint_capture_missing");
  await claim(captured, null);
  payment = {
    ...payment,
    status: "succeeded",
    capturedAt: "2027-01-11T12:00:00.123456Z",
  };
  at = "2027-01-11T12:00:01.000Z";
  await publicFinancialClock(context.db, at);
  const create = await recovery.recover(created.requestId),
    capture = await recovery.recover(captured.requestId);
  if (create.kind !== "observed" || capture.kind !== "observed")
    throw Error("savepoint_fresh_success_missing");
  const createAction = await observations.resolve(
      created.requestId,
      create.observationId,
    ),
    captureAction = await observations.resolve(
      captured.requestId,
      capture.observationId,
    );
  if (!createAction?.applyAttemptId || !captureAction?.applyAttemptId)
    throw Error("savepoint_apply_attempt_missing");
  return {
    ...f,
    created,
    captured,
    create,
    capture,
    createAttempt: createAction.applyAttemptId,
    captureAttempt: captureAction.applyAttemptId,
  };
}
type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
async function inspectCanonicalSavepoint(
  f: Awaited<ReturnType<typeof preparedPair>>,
  rollback: boolean,
) {
  const checks: unknown[] = [];
  const witnesses: { subxid: string; topxid: string; sameTop: boolean }[] = [];
  const externalVisible: number[] = [];
  async function check(tx: Tx) {
    witnesses.push(
      (
        await tx.execute<{ subxid: string; topxid: string; sameTop: boolean }>(
          sql`select fact.xmin::text subxid,mod(pg_current_xact_id()::text::numeric,4294967296)::text topxid,origin.apply_xid=pg_current_xact_id() as "sameTop" from expert_onboarding_payment_facts fact join public_expert_payment_requests origin on origin.id=${f.captured.requestId}::uuid where fact.invoice_id=${f.invoiceId}::uuid`,
        )
      ).rows[0]!,
    );
    for (const [id, attempt] of [
      [f.captured.requestId, f.captureAttempt],
      [f.created.requestId, f.createAttempt],
    ])
      checks.push(
        (
          await tx.execute<{ value: unknown }>(
            sql`select early_bird_private.public_payment_complete(${id}::uuid,${attempt}::uuid) value`,
          )
        ).rows[0]!.value,
      );
    externalVisible.push(
      (
        await q(
          "select count(*)::int n from expert_onboarding_payment_facts where invoice_id=$1",
          [f.invoiceId],
        )
      ).rows[0]!.n,
    );
  }
  const inspectedDb = new Proxy(context.db.db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return (work: (tx: Tx) => Promise<unknown>) =>
          target.transaction(async (tx) => {
            await tx.execute(sql`savepoint actual_held_posting`);
            const result = await work(tx);
            await check(tx);
            await tx.execute(sql`release savepoint actual_held_posting`);
            await check(tx);
            if (rollback) throw Error("intentional_outer_rollback");
            return result;
          });
      return Reflect.get(target, key, receiver);
    },
  });
  const repository = new PostgresExpertVerificationRepository(inspectedDb, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  const result = await repository
    .applyPublic(
      f.captured.requestId,
      f.capture.observationId,
      f.captureAttempt,
    )
    .then(
      (value) => ({ kind: "returned" as const, value }),
      (error) => ({ kind: "rejected" as const, error }),
    );
  return { result, checks, witnesses, externalVisible };
}
function expectUncommitted(
  result: Awaited<ReturnType<typeof inspectCanonicalSavepoint>>,
) {
  expect(result.witnesses).toHaveLength(2);
  for (const witness of result.witnesses) {
    expect(witness.subxid).not.toBe(witness.topxid);
    expect(witness.sameTop).toBe(true);
  }
  expect(result.externalVisible).toEqual([0, 0]);
  expect(result.checks).toMatchObject([
    { kind: "not_ready" },
    { kind: "not_ready" },
    { kind: "not_ready" },
    { kind: "not_ready" },
  ]);
}
it("refuses original and sibling completion before and after SAVEPOINT release until the outer canonical transaction commits", async () => {
  const f = await preparedPair(),
    result = await inspectCanonicalSavepoint(f, false);
  expect(result.result).toMatchObject({
    kind: "returned",
    value: { settled: true },
  });
  expectUncommitted(result);
  expect(
    await observations.complete(f.captured.requestId, f.captureAttempt),
  ).toMatchObject({ kind: "already_applied" });
  expect(
    await observations.complete(f.created.requestId, f.createAttempt),
  ).toMatchObject({ kind: "already_applied" });
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
});
it("outer rollback removes real SAVEPOINT settlement and cannot leave completion evidence; the original fresh fact remains recoverable", async () => {
  const f = await preparedPair(),
    result = await inspectCanonicalSavepoint(f, true);
  expect(result.result).toMatchObject({
    kind: "rejected",
    error: { message: "verification_storage_unavailable" },
  });
  expectUncommitted(result);
  expect(
    (
      await q(
        "select count(*)::int n from expert_onboarding_payment_facts where invoice_id=$1",
        [f.invoiceId],
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await q(
        "select count(*)::int n from expert_sales_paid_locks where invoice_id=$1",
        [f.invoiceId],
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await q(
        "select count(*)::int n from public_expert_payment_resolutions r join public_expert_payment_requests p on p.id=r.request_id where p.invoice_id=$1 and r.kind='applied'",
        [f.invoiceId],
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    await observations.complete(f.captured.requestId, f.captureAttempt),
  ).toMatchObject({ kind: "not_ready" });
  const repository = new PostgresExpertVerificationRepository(context.db.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  expect(
    await repository.applyPublic(
      f.captured.requestId,
      f.capture.observationId,
      f.captureAttempt,
    ),
  ).toMatchObject({ settled: true });
  expect(
    await observations.complete(f.captured.requestId, f.captureAttempt),
  ).toMatchObject({ kind: "already_applied" });
  expect(
    await observations.complete(f.created.requestId, f.createAttempt),
  ).toMatchObject({ kind: "already_applied" });
  expect(
    (
      await q(
        "select count(*)::int n from audit_events where action='expert_onboarding.payment_verified' and object_id=$1",
        [f.invoiceId],
      )
    ).rows[0]!.n,
  ).toBe(1);
});
