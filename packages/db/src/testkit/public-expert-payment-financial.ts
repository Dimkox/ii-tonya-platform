import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type { ExpertReferralTestDatabase } from "./expert-referral.js";
import {
  createCorrectionOnboardingFixture,
  correctionEvent,
} from "../../../../tests/support/residency-correction-fixture.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "../repositories/expert-onboarding-main-payment-repository.js";
import { PostgresPayerReceiptContactRepository } from "../repositories/payer-receipt-contact-repository.js";
import { createPayerReceiptVault } from "@ii-tonya/integrations";
const hash = (v: string) =>
  `sha256:${createHash("sha256").update(v).digest("hex")}`;
const capture = "2027-01-11T21:00:00.123456Z";
const q = (
  db: ExpertReferralTestDatabase,
  text: string,
  values: unknown[] = [],
) => db.db.$client.query(text, values);
export async function publicFinancialCall(
  db: ExpertReferralTestDatabase,
  name: string,
  args: unknown[],
) {
  return (
    await q(
      db,
      `select ${name.includes(".") ? name : `early_bird_private.${name}`}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
      args,
    )
  ).rows[0]!.value;
}
export async function publicFinancialClock(
  db: ExpertReferralTestDatabase,
  at: string,
) {
  await q(
    db,
    `create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$select '${at}'::timestamptz$$`,
  );
}
const call = publicFinancialCall,
  clock = publicFinancialClock;
export async function publicFinancialOwner(db: ExpertReferralTestDatabase) {
  const f = await createCorrectionOnboardingFixture(db);
  await f.cards.submitPromoProof({
    ...correctionEvent(f.scope),
    expectedRevision: 0,
    proof: {
      kind: "link",
      reference: "https://example.invalid/period-financial",
    },
  });
  await f.cards.confirmPromo({
    sessionHash: f.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
  });
  const revision = (await f.approveCard()).revision;
  return {
    ...f,
    revision,
    financial: new PostgresExpertOnboardingMainPaymentRepository(db.db, {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    }),
  };
}
export async function publicFinancialPrepared(
  db: ExpertReferralTestDatabase,
  f: Awaited<ReturnType<typeof publicFinancialOwner>>,
) {
  await clock(db, "2027-01-11T20:00:00Z");
  const quote = await f.financial.quoteMain({
    ...correctionEvent(f.workScope),
    tariffVersionId: f.tariffId,
    termMonths: 1,
    revision: f.revision,
  });
  await f.financial.acceptMain({
    ...correctionEvent(f.workScope),
    quoteId: quote.id,
    revision: f.revision,
  });
  const vault = createPayerReceiptVault({
    activeKeyId: "fixture",
    keys: new Map([["fixture", new Uint8Array(32).fill(19)]]),
  });
  await new PostgresPayerReceiptContactRepository(db.db, vault, 30).capture({
    userId: f.userId,
    quoteId: quote.id,
    email: "period@example.invalid",
    idempotencyKey: randomUUID(),
  });
  const contact = (
    await q(
      db,
      "select id from payer_receipt_contacts where user_id=$1 and quote_id=$2",
      [f.userId, quote.id],
    )
  ).rows[0]!.id;
  const order = await f.financial.createMainInvoice({
    ...correctionEvent(f.workScope),
    revision: f.revision,
  });
  await q(
    db,
    "insert into payer_receipt_order_bindings(order_id,contact_id,quote_id,user_id) values($1,$2,$3,$4)",
    [order.orderId, contact, quote.id, f.userId],
  );
  await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table expert_residency_orders disable trigger expert_campaign_order_snapshot_immutable`,
    );
    await tx.execute(
      sql`update expert_residency_orders set payment_deadline='2027-01-11T21:10:00Z',provider_deadline='2027-01-11T21:10:00Z' where id=${order.orderId}::uuid`,
    );
    await tx.execute(
      sql`alter table expert_residency_orders enable trigger expert_campaign_order_snapshot_immutable`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts disable trigger payer_receipt_contact_guard`,
    );
    await tx.execute(
      sql`update payer_receipt_contacts set captured_at='2027-01-11T20:00:00Z',expires_at='2027-01-11T23:00:00Z' where id=${contact}::uuid`,
    );
    await tx.execute(
      sql`alter table payer_receipt_contacts enable trigger payer_receipt_contact_guard`,
    );
  });
  const d = {
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    legacyDeliveryOperationId: randomUUID(),
    kind: "main_create",
    requestDigest: hash(randomUUID()),
    bodyVersion: 1,
    ciphertext: "synthetic-period-envelope",
    keyReference: "fixture:key",
    bodyExpiresAt: "2027-01-11T22:00:00Z",
  };
  const s = await call(db, "public_main_prepare", [
    f.userId,
    order.orderId,
    contact,
    JSON.stringify(d),
  ]);
  expect(s).toMatchObject({ state: "prepared" });
  await call(db, "public_main_admit", [f.userId, d.requestId, d.requestDigest]);
  expect(
    await call(db, "public.public_expert_gateway_claim", [
      f.userId,
      d.requestId,
      contact,
      d.idempotencyKey,
      d.requestDigest,
      d.kind,
    ]),
  ).toMatchObject({ state: "uncertain" });
  return { ...f, order, d, s };
}
export async function publicFinancialTerminal(
  db: ExpertReferralTestDatabase,
  f: Awaited<ReturnType<typeof publicFinancialPrepared>>,
  at = capture,
  status = "succeeded",
) {
  await clock(db, "2027-01-12T12:00:00Z");
  const fact = {
    version: 1,
    requestId: f.d.requestId,
    providerObjectId: `period_${randomUUID()}`,
    parentPaymentId: null,
    status,
    paid: status === "succeeded",
    amountMinor: f.s.amountMinor,
    currency: "RUB",
    mode: "test",
    providerCreatedAt: "2027-01-11T20:00:00Z",
    providerCapturedAt: status === "succeeded" ? at : null,
    paymentMethodType: "bank_card",
    identity: {
      purpose: "main_residency",
      operationId: f.s.legacyOperationId,
      orderId: f.order.orderId,
      userId: f.userId,
    },
    evidenceDigest: hash(randomUUID()),
    observedAt: "2027-01-12T12:00:00Z",
  };
  expect(
    await call(db, "public_payment_bind", [
      f.d.requestId,
      fact.providerObjectId,
      JSON.stringify({
        version: 1,
        complete: true,
        exactCandidates: 1,
        observation: fact,
      }),
    ]),
  ).toBeTruthy();
  const observationId = await call(db, "public_payment_observe", [
    f.d.requestId,
    fact.providerObjectId,
    JSON.stringify(fact),
  ]);
  return {
    fact,
    observationId,
    action: await call(db, "public_payment_resolve", [
      f.d.requestId,
      observationId,
    ]),
  };
}

/** Genuine existing paid wave card. The caller owns the isolated source DB. */
export async function approvePublicWaveFinancialCard(
  db: ExpertReferralTestDatabase,
  userId: string,
) {
  const { PostgresExpertCardRepository } =
    await import("../repositories/expert-card-repository.js");
  const { verifyExpertOfferProfile } =
    await import("../repositories/expert-offer-v2.js");
  const application = (
    await q(
      db,
      "select application_id from early_bird_form_bridges where user_id=$1",
      [userId],
    )
  ).rows[0]!.application_id as string;
  const session = (
    await q(
      db,
      "select manager_session_hash from expert_verification_decisions where application_id=$1 and decision='approved'",
      [application],
    )
  ).rows[0]!.manager_session_hash as string;
  const cards = new PostgresExpertCardRepository(db.db, {
    waveWorkspace: true,
    messagingConsentPolicyVersion: "client-messaging-v1",
    workBotId: "2",
    workBotKey: "wave-financial-work",
  });
  const promo = {
    botId: "1",
    botKey: "fixture-bot",
    telegramUserId: "123456",
    chatId: "123456",
  };
  const workScope = {
    botId: "2",
    botKey: "wave-financial-work",
    telegramUserId: "123456",
    chatId: "123456",
  };
  const handoff = await cards.issueWorkHandoff(correctionEvent(promo));
  if (handoff.kind !== "issued") throw Error("wave_financial_handoff_missing");
  await cards.redeemWorkHandoff({
    ...correctionEvent(workScope),
    token: handoff.token,
  });
  let state = (await cards.getWorkflow(workScope))!;
  await cards.addEntry({
    ...correctionEvent(workScope),
    expectedRevision: state.revision,
    entry: { kind: "text", text: "Частные консультации и практики" },
  });
  state = (await cards.getWorkflow(workScope))!;
  await cards.submitDraft({
    ...correctionEvent(workScope),
    expectedRevision: state.revision,
  });
  await cards.editPublicCard({
    sessionHash: session,
    applicationId: application,
    expectedRevision: state.revision,
    idempotencyKey: randomUUID(),
    publicCard: {
      displayName: "Мария",
      profession: "Психолог",
      city: "Казань",
      summary: "Частные консультации",
    },
  });
  state = (await cards.getWorkflow(workScope))!;
  const approved = await cards.reviewCard({
    sessionHash: session,
    applicationId: application,
    expectedRevision: state.revision,
    idempotencyKey: randomUUID(),
    action: "approve",
  });
  await verifyExpertOfferProfile(db.db, {
    sessionHash: session,
    userId,
    revision: 1,
  });
  const tariffId = (
    await q(
      db,
      "select id from expert_residency_tariff_versions where tariff_key='PRO' and active_to>clock_timestamp() order by active_from desc limit 1",
    )
  ).rows[0]!.id as string;
  return {
    userId,
    applicationId: application,
    revision: approved.revision,
    tariffId,
    workScope,
    financial: new PostgresExpertOnboardingMainPaymentRepository(db.db, {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    }),
  };
}
