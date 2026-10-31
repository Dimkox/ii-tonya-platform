import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  startPublicExpertTestDatabase,
  publicTestDigest,
} from "../testkit/public-expert-payment.js";
import {
  publicFinancialOwner,
  publicFinancialPrepared,
  publicFinancialTerminal,
  publicFinancialCall,
  publicFinancialClock,
} from "../testkit/public-expert-payment-financial.js";
import {
  createCorrectionOnboardingFixture,
  correctionEvent,
} from "../../../../tests/support/residency-correction-fixture.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "./expert-onboarding-main-payment-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "./expert-residency-repository.js";
import { PostgresExpertReferralRepository } from "./expert-referral-repository.js";
import { PostgresExpertReferralWorkerRepository } from "./expert-referral-worker-repository.js";
import { PostgresYooKassaOperationRepository } from "./yookassa-operation-repository.js";
import { ExpertCodeCrypto } from "../../../application/src/expert-code-crypto.js";
import { verifiedEventFixture } from "../../../integrations/src/expert-residency/verified-event.js";
let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
const database = () => context.db;
const q = (text: string, values: unknown[] = []) =>
  database().db.$client.query(text, values);
const call = (name: string, args: unknown[]) =>
  publicFinancialCall(database(), name, args);
const clock = (at: string) => publicFinancialClock(database(), at);
const canonical = () =>
  new PostgresExpertResidencyProviderInboxRepository(database().db);
beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
}, 120000);
afterAll(async () => context?.db.stop(), 120000);
async function inviter() {
  const owner = await publicFinancialOwner(database());
  const expertId = (
    await q(
      "insert into experts(user_id,active,verified) values($1,true,true) returning id",
      [owner.userId],
    )
  ).rows[0]!.id as string;
  await database().seedFirstSettlement(expertId);
  await q(
    "update expert_referral_feature_controls set reward_grants_enabled=true,version=version+1 where control_key='expert_referrals'",
  );
  const crypto = new ExpertCodeCrypto({
    currentVersion: "v1",
    activeVersions: ["v1"],
    key: () => new Uint8Array(32).fill(61),
  });
  const referral = new PostgresExpertReferralRepository(database().db, crypto);
  const audit = await database().createAdminAudit({
    action: "expert_referral.batch_generate",
    objectId: expertId,
  });
  const issued = await referral.issueBatch({
    inviterExpertId: expertId,
    count: 1,
    issuedByAdminId: audit.adminId,
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  return { ...owner, expertId, referral, code: issued.codes[0]!.plaintext };
}
async function qualifyingPublicOrder(u: Awaited<ReturnType<typeof inviter>>) {
  // Redeem while the approved resident still has one channel identity, before work handoff.
  const raw = await createCorrectionOnboardingFixture(database());
  const inviteeExpert = (
    await q(
      "insert into experts(user_id,active,verified) values($1,true,true) returning id",
      [raw.userId],
    )
  ).rows[0]!.id as string;
  await u.referral.redeemCode({
    plaintext: u.code,
    userId: raw.userId,
    provider: "telegram",
    externalId: raw.scope.telegramUserId,
  });
  await raw.cards.submitPromoProof({
    ...correctionEvent(raw.scope),
    expectedRevision: 0,
    proof: { kind: "link", reference: "https://example.invalid/refund-source" },
  });
  await raw.cards.confirmPromo({
    sessionHash: raw.sessionHash,
    applicationId: raw.applicationId,
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
  });
  const revision = (await raw.approveCard()).revision;
  const v = {
    ...raw,
    revision,
    financial: new PostgresExpertOnboardingMainPaymentRepository(
      database().db,
      {
        providerMode: "test",
        messagingConsentPolicyVersion: "client-messaging-v1",
      },
    ),
  };
  const a = await publicFinancialPrepared(database(), v);
  const paid = await publicFinancialTerminal(database(), a);
  await canonical().applyPublic(
    a.d.requestId,
    paid.observationId,
    paid.action.applyAttemptId,
  );
  expect(
    await call("public_payment_complete", [
      a.d.requestId,
      paid.action.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "already_applied" });
  // Isolated maturity-clock fixture: retain all canonical source/amount/identity
  // facts, move only the pending 30-day time pair, then execute the real worker.
  await q(
    "update expert_referral_reward_maturities set settled_at=settled_at-interval '31 days',matures_at=matures_at-interval '31 days' where qualifying_order_id=$1 and status='pending'",
    [a.order.orderId],
  );
  await q("update experts set active=true,verified=true where id in($1,$2)", [
    u.expertId,
    inviteeExpert,
  ]);
  expect(
    await new PostgresExpertReferralWorkerRepository(
      database().db,
    ).grantDueMaturityBatch({ now: new Date(), batchSize: 10 }),
  ).toMatchObject({ granted: 1 });
  expect(
    (
      await q(
        "select amount_minor::text amount from expert_referral_reward_grants where qualifying_order_id=$1",
        [a.order.orderId],
      )
    ).rows[0]!.amount,
  ).toBe("100000");
  return { a, paid };
}
async function publicRefund(
  a: Awaited<ReturnType<typeof qualifyingPublicOrder>>,
) {
  await clock("2027-01-11T20:30:00Z");
  const operations = new PostgresYooKassaOperationRepository(database().db);
  await operations.resolve(a.a.s.legacyOperationId, "succeeded");
  const digest = publicTestDigest(randomUUID());
  const operation = await operations.claim({
    commandId: randomUUID(),
    orderId: a.a.order.orderId,
    kind: "create_refund",
    mode: "test",
    amountMinor: a.a.s.amountMinor,
    currency: "RUB",
    parentPaymentId: a.paid.fact.providerObjectId,
    requestDigest: digest,
  });
  const d = {
    requestId: randomUUID(),
    idempotencyKey: operation.idempotencyKey,
    legacyDeliveryOperationId: null,
    kind: "main_refund",
    requestDigest: digest,
    bodyVersion: 1,
    ciphertext: "synthetic-dependent-refund",
    keyReference: "fixture:key",
    bodyExpiresAt: "2027-01-11T22:00:00Z",
  };
  expect(
    await call("public_refund_prepare", [
      a.a.userId,
      operation.id,
      a.a.s.contactId,
      JSON.stringify(d),
    ]),
  ).toBeTruthy();
  await call("public_refund_admit", [a.a.userId, d.requestId, d.requestDigest]);
  expect(
    await call("public.public_expert_gateway_claim", [
      a.a.userId,
      d.requestId,
      a.a.s.contactId,
      d.idempotencyKey,
      d.requestDigest,
      d.kind,
    ]),
  ).toBeTruthy();
  await clock("2027-01-12T12:00:00Z");
  const fact = {
    ...a.paid.fact,
    requestId: d.requestId,
    providerObjectId: `dependent_refund_${randomUUID()}`,
    parentPaymentId: a.paid.fact.providerObjectId,
    paid: null,
    providerCreatedAt: "2027-01-11T21:01:00.654321Z",
    providerCapturedAt: null,
    paymentMethodType: null,
    identity: {
      ...a.paid.fact.identity,
      purpose: "public_main_refund",
      operationId: operation.id,
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
  return { d, observation, action };
}
async function assertDependentInvalidated(
  a: string,
  b: string,
  expert: string,
) {
  expect(
    (await q("select status from expert_residency_orders where id=$1", [a]))
      .rows[0]!.status,
  ).toBe("refunded");
  expect(
    (await q("select status from expert_residency_orders where id=$1", [b]))
      .rows[0]!.status,
  ).toBe("failed");
  expect(
    (
      await q(
        "select count(*)::int n,sum(amount_minor)::text amount from expert_referral_ledger_entries where order_id=$1 and entry_kind='release' and source_type='provider_reversal' and source_id=$2",
        [b, a],
      )
    ).rows[0],
  ).toEqual({ n: 1, amount: "100000" });
  expect(
    (
      await q(
        "select count(*)::int n from expert_referral_ledger_entries where order_id=$1 and entry_kind='spend'",
        [b],
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await q(
        "select available_credit_minor::text available,reserved_credit_minor::text reserved,debt_minor::text debt from expert_referral_balances where expert_id=$1",
        [expert],
      )
    ).rows[0],
  ).toEqual({ available: "0", reserved: "0", debt: "0" });
}
it("public qualifying refund invalidates a different uncertain public credit order, rejects arbitrary writes, replays once, and retains later paid evidence", async () => {
  const u = await inviter(),
    a = await qualifyingPublicOrder(u),
    b = await publicFinancialPrepared(database(), u);
  expect(
    (
      await q(
        "select credit_minor::text credit from expert_residency_orders where id=$1",
        [b.order.orderId],
      )
    ).rows[0]!.credit,
  ).toBe("100000");
  const refund = await publicRefund(a);
  // Successful A evidence alone cannot authorize raw B state or arbitrary releases.
  await expect(
    q("update expert_residency_orders set status='failed' where id=$1", [
      b.order.orderId,
    ]),
  ).rejects.toThrow("public_financial_apply_context_required");
  await expect(
    q(
      "insert into expert_referral_ledger_entries(expert_id,entry_kind,amount_minor,order_id,original_entry_id,source_type,source_id,idempotency_key) select expert_id,'release',-amount_minor,order_id,id,'provider_reversal',$2,$3 from expert_referral_ledger_entries where order_id=$1 and entry_kind='reservation'",
      [b.order.orderId, a.a.order.orderId, randomUUID()],
    ),
  ).rejects.toThrow("public_financial_apply_context_required");
  const repo = canonical();
  const results = await Promise.all([
    repo.applyPublic(
      refund.d.requestId,
      refund.observation,
      refund.action.applyAttemptId,
    ),
    repo.applyPublic(
      refund.d.requestId,
      refund.observation,
      refund.action.applyAttemptId,
    ),
  ]);
  expect(results.some((r) => r.kind === "refunded")).toBe(true);
  expect(
    await call("public_payment_complete", [
      refund.d.requestId,
      refund.action.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "already_applied" });
  await assertDependentInvalidated(
    a.a.order.orderId,
    b.order.orderId,
    u.expertId,
  );
  const late = await publicFinancialTerminal(database(), b);
  expect(late.action).toMatchObject({ kind: "manual_reconciliation" });
  await expect(
    repo.applyPublic(
      b.d.requestId,
      late.observationId,
      late.action.applyAttemptId,
    ),
  ).rejects.toThrow("PUBLIC_PAYMENT_APPLY_UNAVAILABLE");
  expect(
    (
      await q(
        "select count(*)::int n from public_expert_payment_observations where id=$1 and status='succeeded'",
        [late.observationId],
      )
    ).rows[0]!.n,
  ).toBe(1);
  expect(
    (
      await q(
        "select count(*)::int n from public_expert_payment_resolutions where request_id=$1 and kind='manual_reconciliation'",
        [b.d.requestId],
      )
    ).rows[0]!.n,
  ).toBe(1);
  await assertDependentInvalidated(
    a.a.order.orderId,
    b.order.orderId,
    u.expertId,
  );
});
async function qualifyingLegacyOrder(u: Awaited<ReturnType<typeof inviter>>) {
  const v = await database().createExpertIdentity();
  await u.referral.redeemCode({
    plaintext: u.code,
    userId: v.userId,
    provider: v.provider,
    externalId: v.externalId,
  });
  const tariff = await database().createResidencyTariff({
    tariffKey: `legacy-dependent-${randomUUID()}`,
    displayName: "Legacy source",
    priceMinor: 999000,
    durationSeconds: 2592000,
    commercialPolicyVersion: "legacy_residency_v1",
  });
  const a = await new PostgresExpertResidencyRepository(
    database().db,
  ).createCheckoutOrder({
    expertId: v.expertId,
    tariffVersionId: tariff,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  const at = new Date().toISOString(),
    payment = randomUUID();
  const evidence = {
    verificationId: randomUUID(),
    verifierKeyVersion: "dependent-fixture-v1",
    verifiedAt: at,
  };
  const facts = {
    provider: "legacy-dependent-fixture",
    paymentId: payment,
    orderId: a.id,
    amountMinor: a.cashMinor,
    currency: "RUB" as const,
    occurredAt: at,
  };
  expect(
    (
      await canonical().settle(
        verifiedEventFixture(
          {
            ...facts,
            kind: "settled",
            eventId: randomUUID(),
            payloadDigest: publicTestDigest(randomUUID()),
          },
          evidence,
        ),
      )
    ).rewardGranted,
  ).toBe(true);
  const reversal = verifiedEventFixture(
    {
      ...facts,
      kind: "refunded",
      eventId: randomUUID(),
      payloadDigest: publicTestDigest(randomUUID()),
    },
    evidence,
  );
  return { a, reversal };
}
it("branded legacy qualifying reversal also invalidates a distinct public reservation exactly once without public cancellation authority", async () => {
  const u = await inviter();
  const { a, reversal } = await qualifyingLegacyOrder(u);
  const b = await publicFinancialPrepared(database(), u);
  const results = await Promise.all([
    canonical().reverse(reversal),
    canonical().reverse(reversal),
  ]);
  expect(results[0]).toMatchObject({ kind: "refunded", rewardReversed: true });
  expect(results[1]).toEqual(results[0]);
  await assertDependentInvalidated(a.id, b.order.orderId, u.expertId);
  expect(
    (
      await q(
        "select count(*)::int n from public_expert_payment_observations where request_id=$1",
        [b.d.requestId],
      )
    ).rows[0]!.n,
  ).toBe(0);
});

it("serializes a qualifying refund against public spending of its reserved reward, retaining either released-credit evidence or spent-credit debt", async () => {
  const u = await inviter(),
    { a, reversal } = await qualifyingLegacyOrder(u);
  const b = await publicFinancialPrepared(database(), u),
    paid = await publicFinancialTerminal(database(), b);
  const [refund, payment] = await Promise.allSettled([
    canonical().reverse(reversal),
    canonical().applyPublic(
      b.d.requestId,
      paid.observationId,
      paid.action.applyAttemptId,
    ),
  ]);
  if (refund.status === "rejected") {
    // NOWAIT deliberately bounds the live refund attempt. A completed winning
    // payment permits the next ordinary reconciliation, not an unbounded retry.
    let cause: unknown = refund.reason;
    const seen = new Set<unknown>();
    let lockRefused = false;
    while (cause && typeof cause === "object" && !seen.has(cause)) {
      seen.add(cause);
      if ((cause as { code?: unknown }).code === "55P03") lockRefused = true;
      cause = (cause as { cause?: unknown }).cause;
    }
    if (!lockRefused) throw refund.reason;
    expect(payment.status).toBe("fulfilled");
    expect(
      (
        await q("select status from expert_residency_orders where id=$1", [
          a.id,
        ])
      ).rows[0]!.status,
    ).toBe("settled");
    expect(
      (
        await q(
          "select count(*)::int n from expert_residency_provider_event_inbox where order_id=$1 and event_kind='refunded'",
          [a.id],
        )
      ).rows[0]!.n,
    ).toBe(0);
    expect(await canonical().reverse(reversal)).toMatchObject({
      kind: "refunded",
      rewardReversed: true,
    });
  }
  const status = (
    await q("select status from expert_residency_orders where id=$1", [
      b.order.orderId,
    ])
  ).rows[0]!.status;
  if (status === "settled") {
    expect(payment.status).toBe("fulfilled");
    expect(
      await call("public_payment_complete", [
        b.d.requestId,
        paid.action.applyAttemptId,
      ]),
    ).toMatchObject({ kind: "already_applied" });
    expect(
      (
        await q(
          "select count(*)::int n,sum(amount_minor)::text amount from expert_referral_ledger_entries where order_id=$1 and entry_kind='spend'",
          [b.order.orderId],
        )
      ).rows[0],
    ).toEqual({ n: 1, amount: "-100000" });
    expect(
      (
        await q(
          "select debt_minor::text debt,reserved_credit_minor::text reserved from expert_referral_balances where expert_id=$1",
          [u.expertId],
        )
      ).rows[0],
    ).toEqual({ debt: "100000", reserved: "0" });
  } else {
    await assertDependentInvalidated(a.id, b.order.orderId, u.expertId);
    expect(
      await call("public_payment_resolve", [b.d.requestId, paid.observationId]),
    ).toMatchObject({ kind: "manual_reconciliation" });
  }
  expect(
    (
      await q(
        "select count(*)::int n from expert_residency_provider_event_inbox where order_id=$1 and event_kind='refunded' and status='processed'",
        [a.id],
      )
    ).rows[0]!.n,
  ).toBe(1);
  expect(
    (
      await q(
        "select count(*)::int n from public_expert_payment_observations where id=$1 and status='succeeded'",
        [paid.observationId],
      )
    ).rows[0]!.n,
  ).toBe(1);
});
