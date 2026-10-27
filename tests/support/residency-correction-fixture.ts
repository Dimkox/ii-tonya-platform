import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { ExpertReferralTestDatabase } from "../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import { PostgresExpertVerificationRepository } from "../../packages/db/src/repositories/expert-verification-repository.js";
import {
  PostgresExpertCardRepository,
  type ExpertCardMaterialTransport,
} from "../../packages/db/src/repositories/expert-card-repository.js";
import { verifyExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import {
  createYooKassaClient,
  YooKassaOnboardingPaymentVerifier,
} from "@ii-tonya/integrations";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const correctionPromo = { botId: "717171", botKey: "correction-promo" };
export const correctionWork = { botId: "818181", botKey: "correction-work" };
let sequence = 180000;
export function correctionEvent<T extends { botId: string }>(scope: T) {
  const requestKey = `${scope.botId}:${++sequence}`;
  return { ...scope, requestKey, requestDigest: hash(requestKey) };
}
/** Bounded fixture owns real verified fee evidence, consent, profile and manager MFA. No provider I/O. */
export async function createCorrectionOnboardingFixture(
  database: ExpertReferralTestDatabase,
  options: {
    transport?: ExpertCardMaterialTransport;
    approvedCard?: boolean;
    promoEnrollment?: boolean;
  } = {},
) {
  const userId = await database.createUser(),
    telegramUserId = String(++sequence);
  const scope = { ...correctionPromo, telegramUserId, chatId: telegramUserId };
  const identity = (
    await database.db.execute<{ id: string }>(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${telegramUserId},${scope.botKey},${telegramUserId},'active') returning id`,
    )
  ).rows[0]!;
  const consent = await seedClientConsent(
    database.db,
    userId,
    "client_messaging",
  );
  if (options.promoEnrollment !== false)
    await database.db.execute(
      sql`insert into expert_promo_enrollments(user_id,channel_identity_id,bot_id,presentation_id,policy_version,status) select ${userId}::uuid,${identity.id}::uuid,${scope.botId},presentation_id,'client-messaging-v1','granted' from consents where id=${consent.decisionId}::uuid`,
    );
  const promo = new PostgresExpertPromoRepository(database.db, {
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  await promo.register(correctionEvent(scope));
  const profile = await promo.saveProfile({
    ...correctionEvent(scope),
    cityCode: "kazan",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
  });
  const existingTariff = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_residency_tariff_versions where tariff_key='PRO' and price_minor=999000 and duration_seconds=2592000 and commercial_policy_version='expert_residency_v2' and active_from<=clock_timestamp() and active_to>clock_timestamp() order by active_from desc limit 1`,
    )
  ).rows[0];
  const tariffId =
    existingTariff?.id ??
    (await database.createResidencyTariff({
      tariffKey: "PRO",
      displayName: "PRO",
      priceMinor: 999000,
      durationSeconds: 2592000,
    }));
  const quote = await promo.createQuote({
    ...correctionEvent(scope),
    tariffVersionId: tariffId,
    termMonths: 1,
  });
  const app = await promo.createApplication({
    ...correctionEvent(scope),
    quoteId: quote.id,
  });
  const managerId = await database.createUser(),
    sessionHash = `sha256:${hash(randomUUID())}`;
  await database.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${sessionHash},${managerId}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
  );
  await database.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${managerId}::uuid,'support')`,
  );
  await verifyExpertOfferProfile(database.db, {
    sessionHash,
    userId,
    revision: profile.revision,
  });
  const verification = new PostgresExpertVerificationRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  const decision = await verification.decide({
    sessionHash,
    applicationId: app.applicationId,
    decision: "approved",
    reasonCode: "identity_verified",
    idempotencyKey: randomUUID(),
  });
  const invoice = await verification.invoiceForOwner(
    scope,
    decision.invoiceId!,
  );
  if (!invoice) throw new Error("fixture_invoice_missing");
  const providerObjectId = `synthetic_${randomUUID()}`;
  await verification.bindPayment(invoice.id, {
    id: invoice.operationId,
    providerObjectId,
    userId,
    purpose: "onboarding",
    amountMinor: "300000",
    currency: "RUB",
    mode: "test",
  });
  const client = createYooKassaClient(
    { mode: "test", shopId: "test-shop", secretKey: "synthetic-only" },
    async () =>
      new Response(
        JSON.stringify({
          id: providerObjectId,
          status: "succeeded",
          paid: true,
          test: true,
          amount: { value: "3000.00", currency: "RUB" },
          created_at: new Date(Date.now() - 1000).toISOString(),
          captured_at: new Date().toISOString(),
          metadata: {
            order_id: invoice.id,
            user_id: userId,
            purpose: "onboarding",
            operation_id: invoice.operationId,
          },
          refundable: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  const proof = await new YooKassaOnboardingPaymentVerifier(
    client,
    verification,
  ).verify(invoice.id);
  if (!proof) throw new Error("fixture_fee_proof_missing");
  await verification.settleVerified(proof);
  const cards = new PostgresExpertCardRepository(database.db, {
    workBotId: correctionWork.botId,
    workBotKey: correctionWork.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
    ...(options.transport ? { materialTransport: options.transport } : {}),
  });
  const workScope = {
    ...correctionWork,
    telegramUserId,
    chatId: telegramUserId,
  };
  const approveCard = async () => {
    const handoff = await cards.issueWorkHandoff(correctionEvent(scope));
    if (handoff.kind !== "issued") throw new Error("fixture_handoff_missing");
    await cards.redeemWorkHandoff({
      ...correctionEvent(workScope),
      token: handoff.token,
    });
    await cards.addEntry({
      ...correctionEvent(workScope),
      expectedRevision: 0,
      entry: { kind: "text", text: "Частные ответы интервью" },
    });
    let state = await cards.getWorkflow(workScope);
    if (!state) throw new Error("fixture_workflow_missing");
    await cards.submitDraft({
      ...correctionEvent(workScope),
      expectedRevision: state.revision,
    });
    await cards.editPublicCard({
      sessionHash,
      applicationId: app.applicationId,
      expectedRevision: state.revision,
      idempotencyKey: randomUUID(),
      publicCard: {
        displayName: "Мария",
        profession: "Психолог",
        city: "Казань",
        summary: "Индивидуальные консультации",
      },
    });
    state = await cards.getWorkflow(workScope);
    if (!state) throw new Error("fixture_workflow_missing");
    await cards.reviewCard({
      sessionHash,
      applicationId: app.applicationId,
      expectedRevision: state.revision,
      idempotencyKey: randomUUID(),
      action: "approve",
    });
    return (await cards.getWorkflow(workScope))!;
  };
  if (options.approvedCard) await approveCard();
  return {
    database,
    userId,
    scope,
    workScope,
    applicationId: app.applicationId,
    quote,
    tariffId,
    profile,
    sessionHash,
    managerId,
    invoice,
    verification,
    cards,
    promo,
    approveCard,
  };
}
