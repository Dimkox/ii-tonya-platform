import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  startPublicExpertTestDatabase,
  createPublicOnboardingFixture,
  publicTestDigest,
} from "../testkit/public-expert-payment.js";
import {
  publicFinancialOwner,
  publicFinancialPrepared,
  publicFinancialTerminal,
  publicFinancialCall,
  publicFinancialClock,
} from "../testkit/public-expert-payment-financial.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "./expert-residency-repository.js";
import { PostgresExpertVerificationRepository } from "./expert-verification-repository.js";
import { PostgresYooKassaOperationRepository } from "./yookassa-operation-repository.js";
import { PostgresExpertReferralRepository } from "./expert-referral-repository.js";
import { ExpertCodeCrypto } from "../../../application/src/expert-code-crypto.js";
import { verifiedEventFixture } from "../../../integrations/src/expert-residency/verified-event.js";
let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
const database = () => context.db;
const q = (text: string, values: unknown[] = []) =>
  database().db.$client.query(text, values);
const call = (name: string, args: unknown[]) =>
  publicFinancialCall(database(), name, args);
const clock = (at: string) => publicFinancialClock(database(), at);
beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
}, 120000);
afterAll(async () => context?.db.stop(), 120000);
async function creditOwner() {
  const f = await publicFinancialOwner(database());
  await q(
    "insert into experts(user_id,active,verified) values($1,true,true) on conflict(user_id) do update set active=true,verified=true",
    [f.userId],
  );
  const expert = (
    await q("select id from experts where user_id=$1", [f.userId])
  ).rows[0]!.id;
  await database().seedFirstSettlement(expert);
  await q(
    "update expert_referral_feature_controls set reward_grants_enabled=true,version=version+1 where control_key='expert_referrals'",
  );
  const invitee = await database().createExpertIdentity();
  const crypto = new ExpertCodeCrypto({
    currentVersion: "v1",
    activeVersions: ["v1"],
    key: () => new Uint8Array(32).fill(41),
  });
  const repo = new PostgresExpertReferralRepository(database().db, crypto);
  const audit = await database().createAdminAudit({
    action: "expert_referral.batch_generate",
    objectId: expert,
  });
  const batch = await repo.issueBatch({
    inviterExpertId: expert,
    count: 1,
    issuedByAdminId: audit.adminId,
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  await repo.redeemCode({
    plaintext: batch.codes[0]!.plaintext,
    userId: invitee.userId,
    provider: invitee.provider,
    externalId: invitee.externalId,
  });
  const tariff = await database().createResidencyTariff({
    tariffKey: `public-financial-reward-${randomUUID()}`,
    displayName: "Referral",
    priceMinor: 999000,
    durationSeconds: 2592000,
    commercialPolicyVersion: "legacy_residency_v1",
  });
  const order = await new PostgresExpertResidencyRepository(
    database().db,
  ).createCheckoutOrder({
    expertId: invitee.expertId,
    tariffVersionId: tariff,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  const at = new Date().toISOString();
  const proof = verifiedEventFixture(
    {
      kind: "settled",
      provider: "financial-fixture",
      eventId: randomUUID(),
      paymentId: randomUUID(),
      orderId: order.id,
      amountMinor: order.cashMinor,
      currency: "RUB",
      occurredAt: at,
      payloadDigest: publicTestDigest(randomUUID()),
    },
    {
      verificationId: randomUUID(),
      verifierKeyVersion: "financial-fixture-v1",
      verifiedAt: at,
    },
  );
  expect(
    (
      await new PostgresExpertResidencyProviderInboxRepository(
        database().db,
      ).settle(proof)
    ).rewardGranted,
  ).toBe(true);
  return { ...f, expertId: expert };
}
it("canonical canceled posting releases actual reserved credit exactly once across concurrent retries, without waiting for local deadline", async () => {
  const f = await publicFinancialPrepared(database(), await creditOwner());
  const before = (
    await q(
      "select credit_minor::text credit from expert_residency_orders where id=$1",
      [f.order.orderId],
    )
  ).rows[0]!;
  expect(BigInt(before.credit)).toBeGreaterThan(0n);
  const t = await publicFinancialTerminal(database(), f, undefined, "canceled");
  const repo = new PostgresExpertResidencyProviderInboxRepository(
    database().db,
  );
  const results = await Promise.all([
    repo.applyPublic(f.d.requestId, t.observationId, t.action.applyAttemptId),
    repo.applyPublic(f.d.requestId, t.observationId, t.action.applyAttemptId),
  ]);
  expect(results.some((r) => r.kind === "released")).toBe(true);
  expect(
    await call("public_payment_complete", [
      f.d.requestId,
      t.action.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "already_applied" });
  expect(
    (
      await q(
        "select count(*)::int n,sum(amount_minor)::text amount from expert_referral_ledger_entries where order_id=$1 and entry_kind='release'",
        [f.order.orderId],
      )
    ).rows[0],
  ).toEqual({ n: 1, amount: before.credit });
  expect(
    (
      await q(
        "select count(*)::int n from expert_referral_ledger_entries where order_id=$1 and entry_kind='spend'",
        [f.order.orderId],
      )
    ).rows[0]!.n,
  ).toBe(0);
});
it("canonical paid posting consumes nonzero reservation once and a full public refund preserves zero credit restoration", async () => {
  const f = await publicFinancialPrepared(database(), await creditOwner());
  const t = await publicFinancialTerminal(database(), f);
  const repo = new PostgresExpertResidencyProviderInboxRepository(
    database().db,
  );
  await repo.applyPublic(
    f.d.requestId,
    t.observationId,
    t.action.applyAttemptId,
  );
  expect(
    await call("public_payment_complete", [
      f.d.requestId,
      t.action.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "already_applied" });
  const ledger = (
    await q(
      "select entry_kind,sum(amount_minor)::text amount,count(*)::int n from expert_referral_ledger_entries where order_id=$1 group by entry_kind order by entry_kind",
      [f.order.orderId],
    )
  ).rows;
  expect(ledger.filter((r) => r.entry_kind === "spend")).toEqual([
    { entry_kind: "spend", amount: "-100000", n: 1 },
  ]);
  await clock("2027-01-11T20:30:00Z");
  const operations = new PostgresYooKassaOperationRepository(database().db);
  await operations.resolve(f.s.legacyOperationId, "succeeded");
  const digest = publicTestDigest(randomUUID());
  const refund = await operations.claim({
    commandId: randomUUID(),
    orderId: f.order.orderId,
    kind: "create_refund",
    mode: "test",
    amountMinor: f.s.amountMinor,
    currency: "RUB",
    parentPaymentId: t.fact.providerObjectId,
    requestDigest: digest,
  });
  const d = {
    requestId: randomUUID(),
    idempotencyKey: refund.idempotencyKey,
    legacyDeliveryOperationId: null,
    kind: "main_refund",
    requestDigest: digest,
    bodyVersion: 1,
    ciphertext: "synthetic-financial-refund",
    keyReference: "fixture:key",
    bodyExpiresAt: "2027-01-11T22:00:00Z",
  };
  const s = await call("public_refund_prepare", [
    f.userId,
    refund.id,
    f.s.contactId,
    JSON.stringify(d),
  ]);
  expect(s).toBeTruthy();
  await call("public_refund_admit", [f.userId, d.requestId, d.requestDigest]);
  expect(
    await call("public.public_expert_gateway_claim", [
      f.userId,
      d.requestId,
      f.s.contactId,
      d.idempotencyKey,
      d.requestDigest,
      d.kind,
    ]),
  ).toBeTruthy();
  await clock("2027-01-12T12:00:00Z");
  const fact = {
    ...t.fact,
    requestId: d.requestId,
    providerObjectId: `financial_refund_${randomUUID()}`,
    parentPaymentId: t.fact.providerObjectId,
    paid: null,
    providerCreatedAt: "2027-01-11T21:01:00.654321Z",
    providerCapturedAt: null,
    paymentMethodType: null,
    identity: {
      ...t.fact.identity,
      purpose: "public_main_refund",
      operationId: refund.id,
    },
    evidenceDigest: publicTestDigest(randomUUID()),
  };
  expect(
    await call("public_payment_bind", [
      d.requestId,
      fact.providerObjectId,
      JSON.stringify({
        version: 1,
        complete: true,
        exactCandidates: 1,
        observation: fact,
      }),
    ]),
  ).toBeTruthy();
  const observation = await call("public_payment_observe", [
    d.requestId,
    fact.providerObjectId,
    JSON.stringify(fact),
  ]);
  const action = await call("public_payment_resolve", [
    d.requestId,
    observation,
  ]);
  expect(action).toMatchObject({
    kind: "ready_to_apply",
    action: "main_refund",
  });
  expect(
    await repo.applyPublic(d.requestId, observation, action.applyAttemptId),
  ).toMatchObject({
    kind: "refunded",
    restoredCreditMinor: 0n,
    terminated: true,
  });
  expect(
    await call("public_payment_complete", [d.requestId, action.applyAttemptId]),
  ).toMatchObject({ kind: "already_applied" });
  expect(
    (
      await q(
        "select sum(amount_minor)::text amount from expert_referral_ledger_entries where order_id=$1 and entry_kind='spend'",
        [f.order.orderId],
      )
    ).rows[0]!.amount,
  ).toBe("-100000");
});
it("onboarding capture posts real paid-lock and workspace admission after deadline with microsecond evidence", async () => {
  await clock("2027-01-11T12:00:00Z");
  const f = await createPublicOnboardingFixture(context);
  const descriptor = (kind: string) => ({
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    legacyDeliveryOperationId: null,
    kind,
    requestDigest: publicTestDigest(randomUUID()),
    bodyVersion: 1,
    ciphertext:
      kind === "onboarding_create" ? "synthetic-onboarding-financial" : null,
    keyReference: kind === "onboarding_create" ? "fixture:key" : null,
    bodyExpiresAt: kind === "onboarding_create" ? "2027-01-11T13:00:00Z" : null,
  });
  const d = descriptor("onboarding_create");
  expect(
    await call("public_onboarding_prepare", [
      f.userId,
      f.invoiceId,
      f.contactId,
      JSON.stringify(d),
    ]),
  ).toBeTruthy();
  await call("public_onboarding_admit", [
    f.userId,
    d.requestId,
    d.requestDigest,
  ]);
  await call("public.public_expert_gateway_claim", [
    f.userId,
    d.requestId,
    f.contactId,
    d.idempotencyKey,
    d.requestDigest,
    d.kind,
  ]);
  const fact = {
    version: 1,
    requestId: d.requestId,
    providerObjectId: `held_financial_${randomUUID()}`,
    parentPaymentId: null,
    status: "waiting_for_capture",
    paid: true,
    amountMinor: "300000",
    currency: "RUB",
    mode: "test",
    providerCreatedAt: "2027-01-11T11:59:00Z",
    providerCapturedAt: null as string | null,
    paymentMethodType: "bank_card",
    identity: {
      purpose: "onboarding",
      operationId: f.operationId,
      orderId: f.invoiceId,
      userId: f.userId,
    },
    evidenceDigest: publicTestDigest(randomUUID()),
    observedAt: "2027-01-11T12:00:00Z",
  };
  expect(
    await call("public_payment_bind", [
      d.requestId,
      fact.providerObjectId,
      JSON.stringify({
        version: 1,
        complete: true,
        exactCandidates: 1,
        observation: fact,
      }),
    ]),
  ).toBeTruthy();
  await call("public_payment_observe", [
    d.requestId,
    fact.providerObjectId,
    JSON.stringify(fact),
  ]);
  const c = descriptor("onboarding_capture");
  expect(
    await call("public_onboarding_prepare", [
      f.userId,
      f.invoiceId,
      null,
      JSON.stringify(c),
    ]),
  ).toBeTruthy();
  await call("public_onboarding_admit", [
    f.userId,
    c.requestId,
    c.requestDigest,
  ]);
  expect(
    await call("public.public_expert_gateway_claim", [
      f.userId,
      c.requestId,
      null,
      c.idempotencyKey,
      c.requestDigest,
      c.kind,
    ]),
  ).toBeTruthy();
  await clock("2027-01-11T15:00:00Z");
  const paid = {
    ...fact,
    requestId: c.requestId,
    parentPaymentId: fact.providerObjectId,
    status: "succeeded",
    providerCapturedAt: "2027-01-11T12:00:00.123456Z",
    observedAt: "2027-01-11T15:00:00Z",
    evidenceDigest: publicTestDigest(randomUUID()),
  };
  const observation = await call("public_payment_observe", [
    c.requestId,
    fact.providerObjectId,
    JSON.stringify(paid),
  ]);
  const action = await call("public_payment_resolve", [
    c.requestId,
    observation,
  ]);
  expect(action).toMatchObject({
    kind: "ready_to_apply",
    action: "onboarding_settle",
  });
  const repo = new PostgresExpertVerificationRepository(database().db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  expect(
    await repo.applyPublic(c.requestId, observation, action.applyAttemptId),
  ).toMatchObject({ settled: true, stage: "interview" });
  expect(
    await call("public_payment_complete", [c.requestId, action.applyAttemptId]),
  ).toMatchObject({ kind: "already_applied" });
  expect(
    (
      await q(
        "select early_bird_private.public_time(captured_at) capture,admission from expert_onboarding_payment_facts where invoice_id=$1",
        [f.invoiceId],
      )
    ).rows[0],
  ).toEqual({ capture: paid.providerCapturedAt, admission: "interview" });
  expect(
    (
      await q(
        "select invoice_id from expert_sales_paid_locks where user_id=$1",
        [f.userId],
      )
    ).rows[0]!.invoice_id,
  ).toBe(f.invoiceId);
});
it("shared batch expiry skips uncertain paid evidence and retains reservations while a canonical apply is pending", async () => {
  const f = await publicFinancialPrepared(database(), await creditOwner());
  const t = await publicFinancialTerminal(database(), f);
  await q(
    "create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$select '2027-01-12T12:00:00Z'::timestamptz$$",
  );
  try {
    const result = await new PostgresExpertResidencyRepository(
      database().db,
    ).releaseExpiredOrders();
    expect(result.released).toBe(0);
    expect(
      (
        await q("select status from expert_residency_orders where id=$1", [
          f.order.orderId,
        ])
      ).rows[0]!.status,
    ).toBe("payment_pending");
    expect(
      (
        await q(
          "select count(*)::int n from expert_referral_ledger_entries where order_id=$1 and entry_kind='release'",
          [f.order.orderId],
        )
      ).rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await q(
          "select count(*)::int n from public_expert_payment_observations where id=$1 and status='succeeded'",
          [t.observationId],
        )
      ).rows[0]!.n,
    ).toBe(1);
  } finally {
    await q(
      "create or replace function pg_catalog.clock_timestamp() returns timestamptz language internal volatile strict as 'clock_timestamp'",
    );
  }
});

it("continues a genuine paid wave card with a fresh explicit public quote and atomically hands off the current projection source", async () => {
  const { createEarlyBirdOwnerJourney } =
    await import("../testkit/early-bird-owner-journey.js");
  const { YooKassaEarlyBirdCandidateVerifier } =
    await import("@ii-tonya/integrations");
  const { PostgresExpertCardRepository } =
    await import("./expert-card-repository.js");
  const { PostgresExpertOnboardingMainPaymentRepository } =
    await import("./expert-onboarding-main-payment-repository.js");
  const { verifyExpertOfferProfile } = await import("./expert-offer-v2.js");
  const { correctionEvent } =
    await import("../../../../tests/support/residency-correction-fixture.js");
  const w = await createEarlyBirdOwnerJourney();
  const wq = (text: string, values: unknown[] = []) =>
    w.db.db.$client.query(text, values);
  const wc = (name: string, args: unknown[]) =>
    publicFinancialCall(w.db, name, args);
  try {
    await w.db.enableExpertReferralCommands();
    await wq(
      "update early_bird_composite_intents set status='unknown' where id=$1",
      [w.identity.operationId],
    );
    const candidate = await wc("find_candidate_intent", [
      w.identity.operationId,
    ]);
    const provider = `continuation_${randomUUID()}`;
    const verifier = new YooKassaEarlyBirdCandidateVerifier(
      {
        getPayment: async () => ({
          id: provider,
          status: "succeeded",
          paid: true,
          test: false,
          refundable: true,
          amount: { value: "30.00", currency: "RUB" },
          createdAt: new Date().toISOString(),
          capturedAt: new Date().toISOString(),
          metadata: {
            order_id: candidate.invoiceId,
            user_id: w.user,
            operation_id: candidate.operationId,
            purpose: "combined_early_bird",
            pricing_policy: "owner_test_10_20_v1",
            price_kind: "fixed_test",
            pricing_grant_id: w.grant,
          },
        }),
      },
      { findIntent: async () => candidate },
    );
    const proof = await verifier.verify(w.identity.operationId, provider);
    await wc("bind_verified", [
      w.identity.operationId,
      w.user,
      provider,
      proof.evidenceDigest,
      JSON.stringify({
        ...candidate,
        baseMonthlyMinor: null,
        ruleVersion: null,
        participantKind: null,
        promotionEligible: null,
        quotedAt: null,
      }),
    ]);
    await wc("public.early_bird_record_success", [
      w.identity.operationId,
      w.user,
      provider,
      proof.evidenceDigest,
      proof.providerCapturedAt,
    ]);
    const application = (
      await wq(
        "select application_id from early_bird_form_bridges where user_id=$1",
        [w.user],
      )
    ).rows[0]!.application_id;
    const session = (
      await wq(
        "select manager_session_hash from expert_verification_decisions where application_id=$1 and decision='approved'",
        [application],
      )
    ).rows[0]!.manager_session_hash;
    const cards = new PostgresExpertCardRepository(w.db.db, {
      waveWorkspace: true,
      messagingConsentPolicyVersion: "client-messaging-v1",
      workBotId: "2",
      workBotKey: "continuation-work",
    });
    const promo = {
      botId: "1",
      botKey: "fixture-bot",
      telegramUserId: "123456",
      chatId: "123456",
    };
    const workScope = {
      botId: "2",
      botKey: "continuation-work",
      telegramUserId: "123456",
      chatId: "123456",
    };
    const handoff = await cards.issueWorkHandoff(correctionEvent(promo));
    if (handoff.kind !== "issued") throw Error("wave_handoff_missing");
    await cards.redeemWorkHandoff({
      ...correctionEvent(workScope),
      token: handoff.token,
    });
    let state = (await cards.getWorkflow(workScope))!;
    await cards.addEntry({
      ...correctionEvent(workScope),
      expectedRevision: state.revision,
      entry: { kind: "text", text: "Практика частных консультаций" },
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
    await verifyExpertOfferProfile(w.db.db, {
      sessionHash: session,
      userId: w.user,
      revision: 1,
    });
    await publicFinancialClock(w.db, "2027-01-11T20:00:00Z");
    expect(await wc("public_wave_application", [w.user])).toBe(application);
    const tariff = (
      await wq(
        "select id from expert_residency_tariff_versions where tariff_key='PRO' and active_to>clock_timestamp() order by active_from desc limit 1",
      )
    ).rows[0]!.id;
    const financial = new PostgresExpertOnboardingMainPaymentRepository(
      w.db.db,
      {
        providerMode: "test",
        messagingConsentPolicyVersion: "client-messaging-v1",
      },
    );
    const f = await publicFinancialPrepared(w.db, {
      userId: w.user,
      revision: approved.revision,
      tariffId: tariff,
      financial,
      workScope,
    } as Awaited<ReturnType<typeof publicFinancialOwner>>);
    await wq(
      "create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$select '2027-01-11T21:00:01Z'::timestamptz$$",
    );
    await w.db.db.transaction(
      async (tx) => {
        await tx.execute(
          sql`select public.early_bird_activate_projection(${w.user}::uuid,${w.identity.operationId}::uuid)`,
        );
      },
      { isolationLevel: "serializable" },
    );
    const previous = (
      await wq(
        "select wave_intent_id,paid_order_id,review_id,draft_id from experts_published where user_id=$1",
        [w.user],
      )
    ).rows[0]!;
    expect(previous.wave_intent_id).toBe(w.identity.operationId);
    const t = await publicFinancialTerminal(w.db, f);
    const repo = new PostgresExpertResidencyProviderInboxRepository(w.db.db);
    const result = await repo.applyPublic(
      f.d.requestId,
      t.observationId,
      t.action.applyAttemptId,
    );
    expect(result).toMatchObject({
      kind: "settled",
      residencyStartsAt: "2027-02-09T21:00:00.000Z",
      residencyEndsAt: "2027-03-11T21:00:00.000Z",
    });
    expect(
      await wc("public_payment_complete", [
        f.d.requestId,
        t.action.applyAttemptId,
      ]),
    ).toMatchObject({ kind: "already_applied" });
    expect(
      (
        await wq(
          "select wave_intent_id,paid_order_id,review_id,draft_id,active from experts_published where user_id=$1",
          [w.user],
        )
      ).rows[0],
    ).toEqual({
      ...previous,
      wave_intent_id: null,
      paid_order_id: f.order.orderId,
      active: true,
    });
    expect(
      (
        await wq(
          "select count(*)::int n from expert_onboarding_invoices where user_id=$1",
          [w.user],
        )
      ).rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await wq(
          "select count(*)::int n from early_bird_payment_successes where intent_id=$1",
          [w.identity.operationId],
        )
      ).rows[0]!.n,
    ).toBe(1);
  } finally {
    await w.db.stop();
  }
}, 120000);

it("rejects capture before provider creation at microsecond precision without admitting a second paid observation", async () => {
  const f = await publicFinancialPrepared(
    database(),
    await publicFinancialOwner(database()),
  );
  const t = await publicFinancialTerminal(database(), f);
  const invalid = {
    ...t.fact,
    providerCapturedAt: "2027-01-11T19:59:59.999999Z",
    evidenceDigest: publicTestDigest(randomUUID()),
  };
  expect(
    await call("public_payment_observe", [
      f.d.requestId,
      t.fact.providerObjectId,
      JSON.stringify(invalid),
    ]),
  ).toBeNull();
  expect(
    (
      await q(
        "select count(*)::int n from public_expert_payment_observations where request_id=$1",
        [f.d.requestId],
      )
    ).rows[0]!.n,
  ).toBe(1);
  expect(
    (
      await q(
        "select count(*)::int n from expert_residency_provider_event_inbox where order_id=$1",
        [f.order.orderId],
      )
    ).rows[0]!.n,
  ).toBe(0);
});
