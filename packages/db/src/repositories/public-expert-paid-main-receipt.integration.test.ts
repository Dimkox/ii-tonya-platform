import { randomUUID } from "node:crypto";
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
  publicTestVault,
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
import { PostgresExpertCardRepository } from "./expert-card-repository.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "./expert-onboarding-main-payment-repository.js";
import { PostgresPayerReceiptContactRepository } from "./payer-receipt-contact-repository.js";
import { verifyExpertOfferProfile } from "./expert-offer-v2.js";
import { correctionEvent } from "../../../../tests/support/residency-correction-fixture.js";

let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
const pools: DrizzleDb[] = [];
let source: PostgresPublicExpertPaymentSource,
  binder: PostgresPublicExpertPaymentBinder,
  observations: PostgresPublicExpertPaymentObservations,
  posting: PostgresPublicExpertPaymentPosting,
  gateway: DrizzleDb;
const q = (text: string, args: unknown[] = []) =>
  context.db.db.$client.query(text, args);
const receipts = () =>
  new PostgresPayerReceiptContactRepository(context.db.db, publicTestVault, 30);
beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
  const sender = await publicTestPrincipal(context, "onboarding"),
    bind = await publicTestPrincipal(context, "binder"),
    writer = await publicTestPrincipal(context, "writer");
  gateway = await publicTestPrincipal(context, "gateway");
  pools.push(sender, bind, writer, gateway);
  source = new PostgresPublicExpertPaymentSource({
    onboarding: sender,
    main: sender,
    refund: sender,
  });
  binder = new PostgresPublicExpertPaymentBinder(bind);
  observations = new PostgresPublicExpertPaymentObservations(writer);
  posting = new PostgresPublicExpertPaymentPosting(
    observations,
    new PostgresExpertResidencyProviderInboxRepository(context.db.db),
    new PostgresExpertVerificationRepository(context.db.db, {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    }),
  );
}, 120000);
async function restoreClock() {
  await q(
    "create or replace function pg_catalog.clock_timestamp() returns timestamptz language internal volatile strict as 'clock_timestamp'",
  );
}
afterAll(async () => {
  if (context) await restoreClock();
  await Promise.all(pools.map((db) => db.$client.end()));
  await context?.db.stop();
}, 120000);

// Shared setup only: new assertions below concern paid-main receipt authority,
// not previously exhausted gateway/settlement/replay behavior.
async function paidOwner() {
  await restoreClock();
  await publicFinancialClock(context.db, "2027-01-11T12:00:00Z");
  const f = await createPublicOnboardingFixture(context);
  function descriptor(kind: "onboarding_create" | "onboarding_capture") {
    return {
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      legacyDeliveryOperationId: null,
      kind,
      requestDigest: publicTestDigest(randomUUID()),
      bodyVersion: 1 as const,
      ciphertext:
        kind === "onboarding_create" ? "receipt-fixture-unused-replay" : null,
      keyReference: kind === "onboarding_create" ? "fixture:key" : null,
      bodyExpiresAt:
        kind === "onboarding_create" ? "2027-01-11T13:00:00Z" : null,
    };
  }
  async function prepare(kind: "onboarding_create" | "onboarding_capture") {
    const d = descriptor(kind),
      contact = kind === "onboarding_create" ? f.contactId : null;
    const s = await source.prepare(
      "onboarding",
      f.userId,
      f.invoiceId,
      contact,
      d,
    );
    if (!s) throw Error("receipt_fixture_prepare");
    expect(await source.admit(s)).toBeTruthy();
    expect(
      (
        await gateway.$client.query(
          "select public.public_expert_gateway_claim($1,$2,$3,$4,$5,$6) value",
          [
            f.userId,
            d.requestId,
            contact,
            d.idempotencyKey,
            d.requestDigest,
            kind,
          ],
        )
      ).rows[0]!.value,
    ).toBeTruthy();
    return s;
  }
  const created = await prepare("onboarding_create");
  let at = "2027-01-11T12:00:00Z";
  let payment: YooKassaPayment = {
    id: `receipt_${randomUUID()}`,
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
      listPayments: async () => ({ complete: true, items: [payment] }),
      getPayment: async () => structuredClone(payment),
      listRefunds: async () => ({ complete: true, items: [] }),
      getRefund: async () => {
        throw Error("unexpected_refund");
      },
    },
  });
  expect((await recovery.recover(created.requestId)).kind).toBe("observed");
  const captured = await prepare("onboarding_capture");
  payment = {
    ...payment,
    status: "succeeded",
    capturedAt: "2027-01-11T12:00:00.123456Z",
  };
  at = "2027-01-11T12:00:01Z";
  await publicFinancialClock(context.db, at);
  const fresh = await recovery.recover(captured.requestId);
  if (fresh.kind !== "observed") throw Error("receipt_fixture_capture");
  expect(
    await posting.apply(captured.requestId, fresh.observationId),
  ).toMatchObject({ kind: "already_applied" });
  const ci = (
    await q(
      "select external_id,external_chat_id,bot_key from channel_identities where user_id=$1",
      [f.userId],
    )
  ).rows[0]!;
  const scope = {
      botId: "717171",
      botKey: ci.bot_key as string,
      telegramUserId: ci.external_id as string,
      chatId: ci.external_chat_id as string,
    },
    workScope = { ...scope, botId: "818181", botKey: "paid-receipt-work" };
  const cards = new PostgresExpertCardRepository(context.db.db, {
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  await verifyExpertOfferProfile(context.db.db, {
    sessionHash: context.session,
    userId: f.userId,
    revision: (
      await q("select revision from expert_offer_profiles where user_id=$1", [
        f.userId,
      ])
    ).rows[0]!.revision,
  });
  await cards.submitPromoProof({
    ...correctionEvent(scope),
    expectedRevision: 0,
    proof: { kind: "link", reference: "https://example.invalid/paid-receipt" },
  });
  await cards.confirmPromo({
    sessionHash: context.session,
    applicationId: f.applicationId,
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
  });
  const handoff = await cards.issueWorkHandoff(correctionEvent(scope));
  if (handoff.kind !== "issued") throw Error("receipt_fixture_handoff");
  await cards.redeemWorkHandoff({
    ...correctionEvent(workScope),
    token: handoff.token,
  });
  await cards.addEntry({
    ...correctionEvent(workScope),
    expectedRevision: 0,
    entry: { kind: "text", text: "Частные консультации" },
  });
  let state = (await cards.getWorkflow(workScope))!;
  await cards.submitDraft({
    ...correctionEvent(workScope),
    expectedRevision: state.revision,
  });
  await cards.editPublicCard({
    sessionHash: context.session,
    applicationId: f.applicationId,
    expectedRevision: state.revision,
    idempotencyKey: randomUUID(),
    publicCard: {
      displayName: "Мария",
      profession: "Психолог",
      city: "Казань",
      summary: "Индивидуальные консультации",
    },
  });
  state = (await cards.getWorkflow(workScope))!;
  await cards.reviewCard({
    sessionHash: context.session,
    applicationId: f.applicationId,
    expectedRevision: state.revision,
    idempotencyKey: randomUUID(),
    action: "approve",
  });
  state = (await cards.getWorkflow(workScope))!;
  const financial = new PostgresExpertOnboardingMainPaymentRepository(
    context.db.db,
    {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
  );
  const quote = await financial.quoteMain({
    ...correctionEvent(workScope),
    tariffVersionId: context.tariff,
    termMonths: 1,
    revision: state.revision,
  });
  const accept = () =>
    financial.acceptMain({
      ...correctionEvent(workScope),
      quoteId: quote.id,
      revision: state.revision,
    });
  const capture = (idempotencyKey = randomUUID(), userId = f.userId) =>
    receipts().capture({
      userId,
      quoteId: quote.id,
      email: "paid-main@example.invalid",
      idempotencyKey,
    });
  return {
    ...f,
    financial,
    quote,
    workScope,
    revision: state.revision,
    accept,
    capture,
  };
}
async function due(id: string) {
  return (
    await q(
      "select payer_receipt_redaction_due(c) due from payer_receipt_contacts c where id=$1",
      [id],
    )
  ).rows[0]!.due;
}
async function shiftClock(hours: number) {
  const at = (
    await q("select (clock_timestamp()+($1::int*interval '1 hour'))::text at", [
      hours,
    ])
  ).rows[0]!.at as string;
  await q(
    `create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$select '${at}'::timestamptz$$`,
  );
}

it("preserves existing unpaid form-bridge receipt capture", async () => {
  const f = await createPublicOnboardingFixture(context);
  expect(
    await receipts().capture({
      userId: f.userId,
      quoteId: f.quoteId,
      email: "unpaid@example.invalid",
      idempotencyKey: randomUUID(),
    }),
  ).toMatchObject({ quoteId: f.quoteId });
}, 60000);

it("admits the accepted canonical paid-main quote and retains only its exact bound receipt after quote expiry", async () => {
  const f = await paidOwner();
  await expect(f.capture()).rejects.toThrow("PAYER_RECEIPT_UNAVAILABLE");
  await f.accept();
  const key = randomUUID(),
    c = await f.capture(key),
    unused = await f.capture();
  const snapshot = (
    await q(
      "select q.rule_version,q.paid_lock_invoice_id,q.price_minor::text,q.sales_selection_id,l.final_locked_price::text from expert_campaign_quotes q join expert_sales_paid_locks l on l.invoice_id=q.paid_lock_invoice_id and l.user_id=q.user_id and l.selection_id=q.sales_selection_id where q.id=$1",
      [f.quote.id],
    )
  ).rows[0]!;
  expect(snapshot).toMatchObject({
    rule_version: "expert_separated_sales_v3",
    paid_lock_invoice_id: f.invoiceId,
    price_minor: snapshot.final_locked_price,
  });
  const order = await f.financial.createMainInvoice({
    ...correctionEvent(f.workScope),
    revision: f.revision,
  });
  await q(
    "insert into payer_receipt_order_bindings(order_id,contact_id,quote_id,user_id) values($1,$2,$3,$4)",
    [order.orderId, c.receiptContactId, f.quote.id, f.userId],
  );
  await expect(f.capture()).rejects.toThrow("PAYER_RECEIPT_UNAVAILABLE");
  // Bypass the repository only to prove SQL also refuses a NEW post-order row.
  await expect(
    q(
      "insert into payer_receipt_contacts(id,quote_id,user_id,idempotency_key,kind,basis,captured_at,expires_at,key_id,ciphertext) select gen_random_uuid(),quote_id,user_id,$2,kind,basis,captured_at,expires_at,key_id,ciphertext from payer_receipt_contacts where id=$1",
      [c.receiptContactId, randomUUID()],
    ),
  ).rejects.toThrow("payer_receipt_unavailable");
  expect(await f.capture(key)).toEqual(c);
  expect(await due(c.receiptContactId)).toBe(false);
  expect(await due(unused.receiptContactId)).toBe(true);
  try {
    await shiftClock(25);
    expect(
      (
        await q(
          "select expires_at<clock_timestamp() expired from expert_campaign_quotes where id=$1",
          [f.quote.id],
        )
      ).rows[0]!.expired,
    ).toBe(true);
    expect(await due(c.receiptContactId)).toBe(false);
    expect(await due(unused.receiptContactId)).toBe(true);
    expect(
      await receipts().receiptContactForOrder(order.orderId),
    ).toMatchObject({ email: "paid-main@example.invalid" });
    await expect(f.capture()).rejects.toThrow("PAYER_RECEIPT_UNAVAILABLE");
    await shiftClock(31 * 24);
    expect(await due(c.receiptContactId)).toBe(true);
    expect(await receipts().receiptContactForOrder(order.orderId)).toBeNull();
  } finally {
    await restoreClock();
  }
}, 60000);

it("rejects foreign owners and an expired unbound paid-main quote", async () => {
  const f = await paidOwner();
  await f.accept();
  await expect(
    f.capture(randomUUID(), await context.db.createUser()),
  ).rejects.toThrow("PAYER_RECEIPT_UNAVAILABLE");
  try {
    await shiftClock(25);
    await expect(f.capture()).rejects.toThrow("PAYER_RECEIPT_UNAVAILABLE");
  } finally {
    await restoreClock();
  }
}, 60000);

it("revokes receipt admission and retention when the canonical paid owner loses messaging consent", async () => {
  const f = await paidOwner();
  await f.accept();
  const c = await f.capture();
  const order = await f.financial.createMainInvoice({
    ...correctionEvent(f.workScope),
    revision: f.revision,
  });
  await q(
    "insert into payer_receipt_order_bindings(order_id,contact_id,quote_id,user_id) values($1,$2,$3,$4)",
    [order.orderId, c.receiptContactId, f.quote.id, f.userId],
  );
  expect(await due(c.receiptContactId)).toBe(false);
  const unbound = await f.financial.quoteMain({
    ...correctionEvent(f.workScope),
    tariffVersionId: context.tariff,
    termMonths: 1,
    revision: f.revision,
  });
  await f.financial.acceptMain({
    ...correctionEvent(f.workScope),
    quoteId: unbound.id,
    revision: f.revision,
  });
  expect(
    (
      await q("select expert_sales_receipt_authority($1,$2) valid", [
        unbound.id,
        f.userId,
      ])
    ).rows[0]!.valid,
  ).toBe(true);
  await q(
    "insert into consents(user_id,consent_type,decision,policy_version,channel,basis,scope_fields) values($1,'client_messaging','revoked','client-messaging-v1','telegram','consent','{}')",
    [f.userId],
  );
  await expect(
    receipts().capture({
      userId: f.userId,
      quoteId: unbound.id,
      email: "revoked@example.invalid",
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow("PAYER_RECEIPT_UNAVAILABLE");
  expect(
    (
      await q("select expert_sales_receipt_authority($1,$2) valid", [
        f.quote.id,
        f.userId,
      ])
    ).rows[0]!.valid,
  ).toBe(false);
  expect(await due(c.receiptContactId)).toBe(true);
}, 60000);
