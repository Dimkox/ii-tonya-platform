import { verifyExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PostgresExpertReferralControlRepository } from "../../packages/db/src/repositories/expert-referral-control-repository.js";
import { ExpertCodeCrypto } from "../../packages/application/src/expert-code-crypto.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { loadEnv } from "../../packages/config/src/index.js";
import { createExpertCardComposition } from "../../apps/api/src/expert-card-composition.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach as vitestBeforeEach,
  describe,
  expect,
  it as vitestIt,
  vi,
} from "vitest";
import {
  createExpertMaterialTransport,
  createYooKassaClient,
  YooKassaOnboardingPaymentVerifier,
  YooKassaOnboardingWebhookCapability,
  YooKassaPaymentVerifier,
  YooKassaExpertResidencyPaymentAdapter,
  type OnboardingPaymentBinding,
} from "@ii-tonya/integrations";
import { createExpertCardService } from "../../packages/application/src/expert-card-service.js";
import { createExpertCardAdminService } from "../../packages/application/src/expert-card-admin-service.js";
import { PostgresExpertCardRepository } from "../../packages/db/src/repositories/expert-card-repository.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import { PostgresExpertVerificationRepository } from "../../packages/db/src/repositories/expert-verification-repository.js";
import {
  ExpertResidencySettlementError,
  PostgresExpertResidencyProviderInboxRepository,
} from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresYooKassaOperationRepository } from "../../packages/db/src/repositories/yookassa-operation-repository.js";
import { PostgresWebhookInboxRepository } from "../../packages/db/src/repositories/webhook-inbox-repository.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { createExpertCardMaterialsRunner } from "../../packages/worker/src/expert-card-materials.js";
import { telegramWebhookRoutes } from "../../apps/api/src/routes/telegram-webhook.js";
import { expertCardAdminRoutes } from "../../apps/api/src/routes/expert-cards.js";
import { yookassaWebhookRoutes } from "../../apps/api/src/routes/yookassa-webhook.js";

import { createAsyncCaseDrainFence } from "../support/async-case-drain.js";
const caseDrain = createAsyncCaseDrainFence({ drainTimeoutMs: 2000 });
async function configuredPhase<T>(
  label: string,
  body: () => Promise<T>,
): Promise<T> {
  if (process.env.II_TONYA_PHASE1_TRACE_CONFIGURED !== "true") return body();
  const started = performance.now();
  process.stderr.write(
    JSON.stringify({
      event: "phase1_configured_phase",
      label,
      stage: "start",
    }) + "\n",
  );
  try {
    return await body();
  } finally {
    process.stderr.write(
      JSON.stringify({
        event: "phase1_configured_phase",
        label,
        stage: "end",
        elapsedMs: Math.round(performance.now() - started),
      }) + "\n",
    );
  }
}

const registerCase = (
  name: string,
  body: () => Promise<void>,
  timeout?: number,
) => vitestIt(name, () => caseDrain.run(body), timeout);
const it = Object.assign(registerCase, {
  each:
    <T>(values: readonly T[]) =>
    (name: string, body: (value: T) => Promise<void>, timeout?: number) => {
      for (const value of values)
        registerCase(
          name.replace("%s", String(value)),
          () => body(value),
          timeout,
        );
    },
});
const beforeEach = (body: () => Promise<void>) =>
  vitestBeforeEach(() => {
    caseDrain.assertReady();
    return caseDrain.run(body);
  });
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const Fastify = apiRequire("fastify") as (options: {
  logger: false;
}) => Parameters<typeof yookassaWebhookRoutes>[0];
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const work = { botId: "818181", botKey: "card-work-fixture" };
const promoScope = { botId: "717171", botKey: "card-promo-fixture" };
const secret = "synthetic_card_webhook_secret_123456789";
const publicCard = {
  displayName: "Мария",
  profession: "Психолог",
  city: "Казань",
  summary: "Индивидуальные консультации",
};
let database: ExpertReferralTestDatabase;
let cards: PostgresExpertCardRepository;
let financial: PostgresExpertOnboardingMainPaymentRepository;
let verification: PostgresExpertVerificationRepository;
let promo: PostgresExpertPromoRepository;
let tariffId: string;
let manager: { sessionHash: string; token: string };
let sequence = 940000;
let messageSequence = 1;
let transportCalls: string[] = [];
let transportFailure = false;
const event = <T extends { botId: string }>(scope: T) => {
  const requestKey = `${scope.botId}:${++sequence}`;
  return { ...scope, requestKey, requestDigest: hash(requestKey) };
};
async function staff() {
  const userId = await database.createUser();
  const token = `synthetic_staff_${randomUUID()}`;
  const sessionHash = `sha256:${hash(token)}`;
  await database.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${sessionHash},${userId}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
  );
  await database.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${userId}::uuid,'support')`,
  );
  return { token, sessionHash };
}
function client(body: Record<string, unknown>, calls: string[] = []) {
  return createYooKassaClient(
    { mode: "test", shopId: "test-shop", secretKey: "synthetic-fixture-only" },
    async (url, init) => {
      calls.push(`${String(init.method)} ${url}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
}
function providerPayment(
  id: string,
  orderId: string,
  minor: string,
  metadata: Record<string, string> = {},
) {
  const amount = BigInt(minor);
  return {
    id,
    status: "succeeded",
    paid: true,
    test: true,
    amount: {
      value: `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`,
      currency: "RUB",
    },
    created_at: new Date(Date.now() - 1000).toISOString(),
    captured_at: new Date().toISOString(),
    metadata: { order_id: orderId, ...metadata },
    refundable: true,
  };
}
type ExistingActor = { userId: string; telegramUserId: string };
async function onboarding(refCode?: string, existing?: ExistingActor) {
  const userId = existing?.userId ?? (await database.createUser());
  const telegramUserId = existing?.telegramUserId ?? String(++sequence);
  const scope = { ...promoScope, telegramUserId, chatId: telegramUserId };
  if (!existing)
    await database.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${telegramUserId},${scope.botKey},${telegramUserId},'active')`,
    );
  const consent = await seedClientConsent(
    database.db,
    userId,
    "client_messaging",
  );
  await database.db.execute(
    sql`insert into expert_promo_enrollments(user_id,channel_identity_id,bot_id,presentation_id,policy_version,status) select ${userId}::uuid,ci.id,${scope.botId},c.presentation_id,'client-messaging-v1','granted' from channel_identities ci join consents c on c.id=${consent.decisionId}::uuid where ci.user_id=${userId}::uuid and ci.provider='telegram' and ci.bot_key=${scope.botKey} and ci.external_id=${scope.telegramUserId} and ci.external_chat_id=${scope.chatId} and ci.status='active' on conflict(user_id) do nothing`,
  );
  await promo.register({ ...event(scope), ...(refCode ? { refCode } : {}) });
  const profile = await promo.saveProfile({
    ...event(scope),
    cityCode: "kazan",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
  });
  await verifyExpertOfferProfile(database.db, {
    sessionHash: manager.sessionHash,
    userId,
    revision: profile.revision,
  });
  const quote = await promo.createQuote({
    ...event(scope),
    tariffVersionId: tariffId,
    termMonths: 1,
  });
  const application = await promo.createApplication({
    ...event(scope),
    quoteId: quote.id,
  });
  const decision = await verification.decide({
    sessionHash: manager.sessionHash,
    applicationId: application.applicationId,
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
  const binding = await verification.findOnboardingPaymentBinding(invoice.id);
  if (!binding) throw new Error("fixture_onboarding_binding_missing");
  return {
    userId,
    scope,
    applicationId: application.applicationId,
    invoice,
    binding,
  };
}
async function payOnboarding(binding: OnboardingPaymentBinding) {
  const body = providerPayment(
    binding.providerObjectId,
    binding.invoiceId,
    "300000",
    {
      user_id: binding.userId,
      purpose: binding.purpose,
      operation_id: binding.operationId,
    },
  );
  const calls: string[] = [];
  const verifier = new YooKassaOnboardingPaymentVerifier(
    client(body, calls),
    verification,
  );
  const app = Fastify({ logger: false });
  await app.register(yookassaWebhookRoutes, {
    effectivePeerAddress: () => "185.71.76.1",
    inbox: new PostgresWebhookInboxRepository(database.db),
    verify: async () => {
      throw new Error("unexpected_residency_verifier");
    },
    deliver: async () => {
      throw new Error("unexpected_residency_delivery");
    },
    resolveSucceeded: async () => {},
    onboarding: new YooKassaOnboardingWebhookCapability(
      verification,
      verifier,
      verification,
    ),
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/webhooks/yookassa",
    payload: {
      type: "notification",
      event: "payment.succeeded",
      object: { id: binding.providerObjectId },
    },
  });
  await app.close();
  expect(response.statusCode).toBe(200);
  expect(calls).toEqual([
    `GET https://api.yookassa.ru/v3/payments/${binding.providerObjectId}`,
  ]);
}
async function interview(refCode?: string, existing?: ExistingActor) {
  const f = await onboarding(refCode, existing);
  expect(
    await cards.getWorkflow({
      ...work,
      telegramUserId: f.scope.telegramUserId,
      chatId: f.scope.chatId,
    }),
  ).toBeNull();
  await payOnboarding(f.binding);
  const handoff = await cardService().handlePromoHandoff({
    ...f.scope,
    updateId: ++sequence,
    text: "/work_handoff",
  });
  if (handoff.status !== "handled")
    throw new Error("fixture_handoff_not_issued");
  const token = /card_([A-Za-z0-9_-]{43})/u.exec(handoff.text)?.[1];
  if (!token) throw new Error("fixture_handoff_token_missing");
  const scope = {
    ...work,
    telegramUserId: f.scope.telegramUserId,
    chatId: f.scope.chatId,
  };
  const app = await workHttp();
  try {
    const linked = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: { "x-telegram-bot-api-secret-token": secret },
      payload: {
        update_id: ++sequence,
        message: {
          from: { id: Number(scope.telegramUserId) },
          chat: { id: Number(scope.chatId), type: "private" },
          text: `/start card_${token}`,
        },
      },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({
      method: "sendMessage",
      protect_content: true,
    });
  } finally {
    await app.close();
  }
  return { ...f, workScope: scope, handoffToken: token };
}
function cardService(
  options: Pick<
    Parameters<typeof createExpertCardService>[0],
    "mainCheckout"
  > = {},
) {
  return createExpertCardService({
    enabled: true,
    paymentMode: "test",
    ...options,
    ...{
      workBotId: work.botId,
      workBotKey: work.botKey,
      workBotUsername: "synthetic_card_bot",
    },
    promoScope,
    repository: cards,
    financial,
  });
}
async function workHttp(
  service = cardService(),
  legacyReplay: {
    read(input: {
      botId: string;
      updateId: string;
    }): Promise<"absent" | "complete" | "pending">;
  } = { read: async () => "absent" },
) {
  const app = Fastify({ logger: false });
  await app.register(telegramWebhookRoutes, {
    secret,
    clientIngressEnabled: false,
    clientHybridRoutingEnabled: false,
    clientBotKey: "disabled-client-fixture",
    clientGateway: undefined,
    rateLimiter: { consume: () => true },
    inbox: {
      claim: async () => ({ kind: "claimed" as const, claimId: "fixture" }),
      complete: async () => {},
      fail: async () => {},
    },
    callbacks: {
      isAuthorizedIdentity: async () => false,
      verifyCallback: async () => false,
      process: async () => {},
    },
    expertCardEnabled: true,
    expertCard: {
      workBotId: work.botId,
      workBotKey: work.botKey,
      webhookSecret: secret,
      service,
      legacyReplay,
    },
  });
  return app;
}
async function adminHttp() {
  const app = Fastify({ logger: false });
  await app.register(expertCardAdminRoutes, {
    enabled: true,
    service: createExpertCardAdminService({ enabled: true, repository: cards }),
  });
  return app;
}
async function approvedCard(refCode?: string, existing?: ExistingActor) {
  const f = await interview(refCode, existing);
  let state = await cards.getWorkflow(f.workScope);
  if (!state) throw new Error("fixture_workflow_missing");
  const app = await workHttp();
  for (const content of [
    { text: "Исходные частные ответы" },
    { photo: [{ file_id: "synthetic_photo" }] },
    { document: { file_id: "synthetic_document" } },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: { "x-telegram-bot-api-secret-token": secret },
      payload: {
        update_id: ++sequence,
        message: {
          from: { id: Number(f.scope.telegramUserId) },
          chat: { id: Number(f.scope.chatId), type: "private" },
          ...content,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      method: "sendMessage",
      protect_content: true,
    });
  }
  await app.close();
  state = await cards.getWorkflow(f.workScope);
  await cards.submitDraft({
    ...event(f.workScope),
    expectedRevision: state!.revision,
  });
  const admin = await adminHttp();
  const mutate = async (path: string, payload: Record<string, unknown>) => {
    const response = await admin.inject({
      method: "POST",
      url: `/v1/admin/expert-cards/${f.applicationId}/${path}`,
      headers: { authorization: `Bearer ${manager.token}` },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  };
  await mutate("public-card", {
    expectedRevision: state!.revision,
    idempotencyKey: randomUUID(),
    publicCard,
  });
  state = await cards.getWorkflow(f.workScope);
  await mutate("review", {
    expectedRevision: state!.revision,
    idempotencyKey: randomUUID(),
    action: "approve",
  });
  await admin.close();
  return { ...f, revision: state!.revision, draftId: state!.draftId! };
}
async function template() {
  await database.db.execute(
    sql`insert into expert_card_material_templates(content_version,status,text_body,assets) values(${`fixture-${randomUUID()}`},'approved','Утверждённые материалы',${JSON.stringify(
      [
        { kind: "photo", reference: "telegram:file:material_photo" },
        { kind: "document", reference: "telegram:file:material_document" },
      ],
    )}::jsonb)`,
  );
}
async function readyCard(refCode?: string, existing?: ExistingActor) {
  const f = await approvedCard(refCode, existing);
  await template();
  expect(
    await createExpertCardMaterialsRunner({
      enabled: true,
      repository: cards,
    }).runOnce(),
  ).toMatchObject({ examined: 1, delivered: 1, failed: 0 });
  await cards.submitPromoProof({
    ...event(f.workScope),
    expectedRevision: f.revision,
    proof: { kind: "photo", reference: "telegram:file:private_promo_proof" },
  });
  const app = await adminHttp();
  const response = await app.inject({
    method: "POST",
    url: `/v1/admin/expert-cards/${f.applicationId}/promo-review`,
    headers: { authorization: `Bearer ${manager.token}` },
    payload: { expectedRevision: f.revision, idempotencyKey: randomUUID() },
  });
  await app.close();
  expect(response.statusCode).toBe(200);
  return f;
}
async function checkout(
  f: Awaited<ReturnType<typeof readyCard>>,
  termMonths: 1 | 3 = 1,
) {
  const quote = await financial.quoteMain({
    ...event(f.workScope),
    tariffVersionId: tariffId,
    termMonths,
    revision: f.revision,
  });
  await financial.acceptMain({
    ...event(f.workScope),
    quoteId: quote.id,
    revision: f.revision,
  });
  const command = { ...event(f.workScope), revision: f.revision };
  const order = await financial.createMainInvoice(command);
  return { quote, command, order };
}
async function mainPayment(order: { orderId: string; cashMinor: string }) {
  const operations = new PostgresYooKassaOperationRepository(database.db);
  const claimed = await operations.claim({
    commandId: randomUUID(),
    orderId: order.orderId,
    kind: "create_payment",
    mode: "test",
    amountMinor: order.cashMinor,
    currency: "RUB",
    requestDigest: `sha256:${hash(order.orderId)}`,
  });
  const paymentId = `synthetic_${randomUUID()}`;
  const operation = await operations.bindProviderObject(claimed.id, paymentId);
  const calls: string[] = [];
  const verifier = new YooKassaPaymentVerifier(
    client(providerPayment(paymentId, order.orderId, order.cashMinor), calls),
    operations,
  );
  const core = new PostgresExpertResidencyProviderInboxRepository(database.db);
  const app = Fastify({ logger: false });
  await app.register(yookassaWebhookRoutes, {
    effectivePeerAddress: () => "185.71.76.1",
    inbox: new PostgresWebhookInboxRepository(database.db),
    verify: () => verifier.verifyPayment(operation),
    deliver: async (proof) => {
      await core.settle(proof);
    },
    resolveSucceeded: async () => {
      await operations.resolve(operation.id, "succeeded");
    },
  });
  return {
    app,
    calls,
    proof: () => verifier.verifyPayment(operation),
    notify: () =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/yookassa",
        payload: {
          type: "notification",
          event: "payment.succeeded",
          object: { id: paymentId },
        },
      }),
  };
}
async function shortTariff() {
  const audit = await database.createAdminAudit({
    action: "expert_residency.tariff_create_v2",
    objectId: randomUUID(),
  });
  return (
    await database.db.execute<{ id: string }>(
      sql`insert into expert_residency_tariff_versions(tariff_key,display_name,price_minor,duration_seconds,active_from,active_to,commercial_policy_version,credit_cap_bps,individual_services_enabled,group_event_limit,statistics_level,support_priority,approval_id,admin_session_id_hash) values('BASE','База',590000,2592000,clock_timestamp()-interval '1 day',clock_timestamp()+interval '3 seconds','expert_residency_v2',3000,true,1,'expanded','standard',${audit.approvalId}::uuid,${audit.sessionIdHash}) returning id`,
    )
  ).rows[0]!.id;
}
type CoreSettlement = Awaited<
  ReturnType<PostgresExpertResidencyProviderInboxRepository["settle"]>
>;
function observeSettlement(promise: Promise<CoreSettlement>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error: error as unknown }),
  );
}
async function settledOutcome(
  promise: ReturnType<typeof observeSettlement> | undefined,
) {
  if (!promise) throw new Error("fixture_settlement_not_started");
  const outcome = await promise;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
async function waitForMainBindingLock() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const waiting = (
      await database.db.execute<{ waiting: boolean }>(
        sql`select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%from expert_card_main_orders%' and query like '%for update%') as waiting`,
      )
    ).rows[0]?.waiting;
    if (waiting) return;
    await delay(3);
  }
  throw new Error("fixture_settlement_did_not_reach_main_binding_lock");
}
async function seedExpertSession(userId: string) {
  await database.db.execute(
    sql`insert into expert_sessions(token_digest,user_id,expert_id,channel_identity_id,external_id,bot_key,external_chat_id,expires_at) select ${`sha256:${hash(randomUUID())}`},e.user_id,e.id,c.id,c.external_id,c.bot_key,c.external_chat_id,clock_timestamp()+interval '30 minutes' from experts e join expert_first_residency_settlements f on f.expert_id=e.id join channel_identities c on c.id=f.settlement_invitee_channel_identity_id where e.user_id=${userId}::uuid`,
  );
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_sessions where user_id=${userId}::uuid`,
      )
    ).rows[0]?.n,
  ).toBe(1);
}
async function assertErasedFinancialIdentity(
  userId: string,
  externalId: string,
) {
  const identities = (
    await database.db.execute<{
      id: string;
      external_id: string;
      bot_key: string | null;
      external_chat_id: string | null;
      status: string;
    }>(
      sql`select id,external_id,bot_key,external_chat_id,status from channel_identities where user_id=${userId}::uuid`,
    )
  ).rows;
  expect(identities.length).toBeGreaterThan(0);
  for (const identity of identities)
    expect(identity).toEqual({
      id: identity.id,
      external_id: `erased:${identity.id}`,
      bot_key: null,
      external_chat_id: null,
      status: "blocked",
    });
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from channel_identities where user_id=${userId}::uuid and external_id=${externalId}`,
      )
    ).rows[0]?.n,
  ).toBe(0);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_sessions where user_id=${userId}::uuid`,
      )
    ).rows[0]?.n,
  ).toBe(0);
}
function privacy() {
  return new PostgresPrivacyRepository(database.db, {
    privacyMutationCapability: {
      enabled: true,
      captureManifests: async () =>
        ["object_store", "selarti", "planerka", "make_projection"].map(
          (processor) => ({
            processor: processor as
              "object_store" | "selarti" | "planerka" | "make_projection",
            ciphertext: `ciphertext:${processor}`,
            keyReference: `fixture:${processor}`,
            algorithm: "test-envelope-v1",
            version: "1",
            subjectDeletionKeyHash: `sha256:${processor}`,
          }),
        ),
      verifyEnvelope: () => true,
    },
  });
}

async function deadlineCaseFixture() {
  const f = await readyCard();
  const short = { id: await shortTariff() };
  const quote = await financial.quoteMain({
    ...event(f.workScope),
    tariffVersionId: short.id,
    termMonths: 1,
    revision: f.revision,
  });
  await financial.acceptMain({
    ...event(f.workScope),
    quoteId: quote.id,
    revision: f.revision,
  });
  const order = await financial.createMainInvoice({
    ...event(f.workScope),
    revision: f.revision,
  });
  const payment = await mainPayment(order);
  const proof = await payment.proof();
  if (!proof) throw new Error("fixture_main_proof_missing");
  return { f, order, payment, proof };
}
async function firstSourceCaseFixture(
  prior: "legacy_source" | "prior_ineligible",
) {
  const oldInviter = await database.createExpertIdentity({
    externalId: String(++sequence),
  });
  const newInviter = await database.createExpertIdentity({
    externalId: String(++sequence),
  });
  const invitee = await database.createExpertIdentity({
    externalId: String(++sequence),
  });
  for (const identity of [oldInviter, newInviter, invitee]) {
    await database.db.execute(
      sql`update channel_identities set bot_key=${promoScope.botKey},external_chat_id=external_id where user_id=${identity.userId}::uuid`,
    );
    await seedClientConsent(database.db, identity.userId, "client_messaging");
  }
  const referralRepo = new PostgresExpertReferralRepository(
    database.db,
    new ExpertCodeCrypto({
      currentVersion: "v1",
      activeVersions: ["v1"],
      key: () => new Uint8Array(32).fill(29),
    }),
  );
  let originalReferral: string | undefined;
  if (prior === "legacy_source") {
    const audit = await database.createAdminAudit({
      action: "expert_referral.batch_generate",
      objectId: oldInviter.expertId,
    });
    const issued = await referralRepo.issueBatch({
      inviterExpertId: oldInviter.expertId,
      count: 1,
      issuedByAdminId: audit.adminId,
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
    });
    // Redeem before a second bot identity exists; no legacy code is auto-issued by production.
    await referralRepo.redeemCode({
      plaintext: issued.codes[0]!.plaintext,
      userId: invitee.userId,
      provider: invitee.provider,
      externalId: invitee.externalId,
    });
    originalReferral = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_referrals where invitee_expert_id=${invitee.expertId}::uuid`,
      )
    ).rows[0]!.id;
  } else await database.seedFirstSettlement(invitee.expertId);
  const inviterScope = {
    ...promoScope,
    telegramUserId: newInviter.externalId,
    chatId: newInviter.externalId,
  };
  const registered = await promo.register(event(inviterScope));
  // Existing verified actor was suspended before this onboarding application.
  await database.db.execute(
    sql`update experts set active=false,verified=false where id=${invitee.expertId}::uuid`,
  );
  const f = await readyCard(registered.refCode, {
    userId: invitee.userId,
    telegramUserId: invitee.externalId,
  });
  const { order } = await checkout(f);
  const payment = await mainPayment(order);
  return { oldInviter, invitee, originalReferral, payment };
}
async function ownerReplayFixture() {
  const f = await interview();
  return { f };
}
async function materialDeliveryFixture() {
  const f = await approvedCard();
  return { f };
}
async function erasedPaymentFixture() {
  const f = await readyCard();
  const { order } = await checkout(f);
  const payment = await mainPayment(order);
  return { f, order, payment };
}
async function sqlRejectionFixture() {
  const f = await approvedCard();
  const review = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_card_reviews where draft_id=${f.draftId}::uuid`,
    )
  ).rows[0]!;
  const a = await database.createExpertIdentity(),
    b = await database.createExpertIdentity();
  return { f, review, a, b };
}
async function qualifiedRewardFixture() {
  const inviter = await database.createExpertIdentity({
    provider: "telegram",
    externalId: String(++sequence),
  });
  const inviterScope = {
    ...promoScope,
    telegramUserId: inviter.externalId,
    chatId: inviter.externalId,
  };
  await database.db.execute(
    sql`update channel_identities set bot_key=${promoScope.botKey},external_chat_id=external_id where user_id=${inviter.userId}::uuid`,
  );
  await seedClientConsent(database.db, inviter.userId, "client_messaging");
  const registered = await promo.register(event(inviterScope));
  const f = await readyCard(registered.refCode);
  // Three independently consented referrals earn the visible, nonspendable indication.
  for (let n = 0; n < 2; n++) {
    const userId = await database.createUser(),
      externalId = String(++sequence);
    await database.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${userId}::uuid,'telegram',${externalId},${externalId},${promoScope.botKey},'active')`,
    );
    await seedClientConsent(database.db, userId, "client_messaging");
    await promo.register({
      ...event({
        ...promoScope,
        telegramUserId: externalId,
        chatId: externalId,
      }),
      refCode: registered.refCode,
    });
  }
  expect(await promo.register(event(inviterScope))).toMatchObject({
    bonusStatus: "frozen",
    bonusPoints: 100,
  });
  const control = await database.createFeatureControlApproval({
    expectedVersion: 1,
    newCommandsEnabled: true,
    rewardGrantsEnabled: true,
  });
  await new PostgresExpertReferralControlRepository(
    database.db,
  ).setFeatureControl({
    expectedVersion: 1,
    newCommandsEnabled: true,
    rewardGrantsEnabled: true,
    approvalId: control.approvalId,
    adminSessionIdHash: control.sessionIdHash,
  });
  const { order } = await checkout(f);
  const payment = await mainPayment(order);
  return { f, inviterScope, order, payment };
}
async function expiredQuoteFixture() {
  const f = await readyCard();
  const tariffVersionId = await shortTariff();
  const quote = await financial.quoteMain({
    ...event(f.workScope),
    tariffVersionId,
    termMonths: 1,
    revision: f.revision,
  });
  return { f, quote };
}
async function noticeRaceFixture() {
  const f = await readyCard();
  const { order } = await checkout(f);
  const payment = await mainPayment(order);
  const proof = await payment.proof();
  if (!proof) throw new Error("fixture_main_proof_missing");
  return { f, order, payment, proof };
}
async function legacyReceiptFixture() {
  const f = await interview();
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_CARD_ENABLED: "true",
    EXPERT_CARD_PAYMENT_MODE: "test",
    EXPERT_CARD_WORK_BOT_ID: work.botId,
    EXPERT_CARD_WORK_BOT_KEY: work.botKey,
    EXPERT_CARD_WORK_BOT_USERNAME: "synthetic_card_bot",
    EXPERT_CARD_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
    TELEGRAM_WEBHOOK_SECRET: secret,
  });
  const capability = createExpertCardComposition(database.db, config);
  if (!capability) throw new Error("fixture_card_capability_missing");
  const inbox = new PostgresWebhookInboxRepository(database.db);
  const completeId = ++sequence,
    pendingId = ++sequence;
  const complete = await inbox.claim("telegram", String(completeId));
  if (complete.kind !== "claimed")
    throw new Error("fixture_legacy_claim_missing");
  await inbox.complete(complete.claimId);
  const pending = await inbox.claim("telegram", String(pendingId));
  if (pending.kind !== "claimed")
    throw new Error("fixture_legacy_pending_missing");
  const app = await workHttp(cardService(), capability.legacyReplay);
  return { f, completeId, pendingId, pending, app };
}
describe("Phase1 card publication and main-payment gates (PostgreSQL17.5)", () => {
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
    expect(
      (await database.db.execute(sql`show server_version_num`)).rows[0]
        ?.server_version_num,
    ).toBe("170005");
  }, 120000);
  afterAll(async () => {
    await database?.stop();
  }, 120000);
  afterEach(async () => {
    await caseDrain.drain();
  });
  beforeEach(async () => {
    await database.reset();
    // These immutable, globally versioned content tables intentionally outlive
    // users in the shared testkit reset; isolate this file's synthetic fixtures.
    await database.db.execute(
      sql`truncate expert_card_material_templates,consent_document_versions cascade`,
    );
    await database.enableExpertReferralCommands();
    manager = await staff();
    tariffId = await database.createResidencyTariff({
      tariffKey: "PRO",
      displayName: "PRO",
      priceMinor: 999000,
      durationSeconds: 2592000,
    });
    verification = new PostgresExpertVerificationRepository(database.db, {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    promo = new PostgresExpertPromoRepository(database.db, {
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    financial = new PostgresExpertOnboardingMainPaymentRepository(database.db, {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    transportCalls = [];
    transportFailure = false;
    const transportFor = (bot: { botId: string; botKey: string }) =>
      createExpertMaterialTransport({
        token: `${bot.botId}:synthetic_fixture_material_token`,
        botId: bot.botId,
        botKey: bot.botKey,
        fetch: async (url, init) => {
          transportCalls.push(String(url));
          if (transportFailure && transportCalls.length === 2)
            throw new Error("synthetic_lost_response");
          const body = JSON.parse(String(init?.body)) as { chat_id: string };
          return new Response(
            JSON.stringify({
              ok: true,
              result: {
                message_id: ++messageSequence,
                from: { id: Number(bot.botId), is_bot: true },
                chat: { id: Number(body.chat_id), type: "private" },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      });
    const transport = {
      send: (
        input: Parameters<
          ReturnType<typeof createExpertMaterialTransport>["send"]
        >[0],
      ) => {
        const bot =
          input.botId === promoScope.botId && input.botKey === promoScope.botKey
            ? promoScope
            : work;
        return transportFor(bot).send(input);
      },
    };
    cards = new PostgresExpertCardRepository(database.db, {
      workBotId: work.botId,
      workBotKey: work.botKey,
      messagingConsentPolicyVersion: "client-messaging-v1",
      materialTransport: transport,
    });
  });
  for (const term of [1, 3] as const)
    describe(`publication for ${term} months`, () => {
      let fixture: {
        f: Awaited<ReturnType<typeof readyCard>>;
        order: Awaited<ReturnType<typeof checkout>>["order"];
        payment: Awaited<ReturnType<typeof mainPayment>>;
      };
      beforeEach(async () => {
        const f = await readyCard();
        const { order } = await checkout(f, term);
        const payment = await mainPayment(order);
        fixture = { f, order, payment };
      });
      it(`publishes only after real verified main payment for ${term} months; fee, private interview and review grant no residency`, async () => {
        const { f, order, payment } = fixture;
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_first_residency_settlements`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_referral_ledger_entries`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select active,verified from experts where user_id=${f.userId}::uuid`,
            )
          ).rows[0],
        ).toEqual({ active: false, verified: false });
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from experts_published`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        try {
          expect((await payment.notify()).statusCode).toBe(200);
          expect((await payment.notify()).statusCode).toBe(200);
          expect(payment.calls).toHaveLength(1);
          const state = (
            await database.db.execute(
              sql`select e.active,e.verified,p.next_billing_date is not null as billed,p.public_payload from experts e join experts_published p on p.expert_id=e.id where e.user_id=${f.userId}::uuid`,
            )
          ).rows[0];
          expect(state).toEqual({
            active: true,
            verified: true,
            billed: true,
            public_payload: publicCard,
          });
          expect(JSON.stringify(state)).not.toMatch(
            /telegram:file:|private_promo|Исходные/u,
          );
          expect(
            (
              await database.db.execute(
                sql`select count(*)::int n from expert_first_residency_settlements`,
              )
            ).rows[0]?.n,
          ).toBe(1);
          expect(transportCalls).toHaveLength(3);
          if (term === 1) {
            const markerBefore = (
              await database.db.execute(
                sql`select id,settlement_invitee_channel_identity_id from expert_first_residency_settlements where qualifying_order_id=${order.orderId}::uuid`,
              )
            ).rows[0];
            await seedExpertSession(f.userId);
            await privacy().startErasureAtomically({
              targetUserId: f.userId,
              correlationId: `published-card-erasure:${f.userId}`,
              idempotencyKey: `published-card-erasure:${f.userId}`,
              pseudonym: "hmac:synthetic-published-card-erasure",
            });
            expect(
              (
                await database.db.execute(
                  sql`select (select count(*)::int from experts_published where user_id=${f.userId}::uuid) as published,(select count(*)::int from expert_card_entries where user_id=${f.userId}::uuid) as entries,(select count(*)::int from expert_application_promo_proofs where user_id=${f.userId}::uuid) as proofs,(select count(*)::int from expert_card_reviews where user_id=${f.userId}::uuid) as reviews`,
                )
              ).rows[0],
            ).toEqual({ published: 0, entries: 0, proofs: 0, reviews: 0 });
            await assertErasedFinancialIdentity(
              f.userId,
              f.scope.telegramUserId,
            );
            expect(
              (
                await database.db.execute(
                  sql`select id,settlement_invitee_channel_identity_id from expert_first_residency_settlements where qualifying_order_id=${order.orderId}::uuid`,
                )
              ).rows[0],
            ).toEqual(markerBefore);

            expect(
              (
                await database.db.execute(
                  sql`select public_display_name,active,verified from experts where user_id=${f.userId}::uuid`,
                )
              ).rows[0],
            ).toEqual({
              public_display_name: null,
              active: false,
              verified: false,
            });
            expect(
              (
                await database.db.execute(
                  sql`select o.status,m.application_id,m.review_id,m.application_audit_id is not null as applicant_audit,m.review_audit_id is not null as review_audit from expert_residency_orders o join expert_card_main_orders m on m.order_id=o.id where o.id=${order.orderId}::uuid`,
                )
              ).rows[0],
            ).toEqual({
              status: "settled",
              application_id: null,
              review_id: null,
              applicant_audit: true,
              review_audit: true,
            });
          }
        } finally {
          await payment.app.close();
        }
      });
    });

  describe("ownerReplayFixture", () => {
    let fixture: Awaited<ReturnType<typeof ownerReplayFixture>>;
    beforeEach(async () => {
      fixture = await ownerReplayFixture();
    });
    it("binds owner, bot, revision, digest and durable update replay without leaking raw entries", async () => {
      const { f } = fixture;
      await expect(
        cards.redeemWorkHandoff({
          ...event({
            ...f.workScope,
            telegramUserId: "999999",
            chatId: "999999",
          }),
          token: f.handoffToken,
        }),
      ).rejects.toThrow();
      await expect(
        cards.redeemWorkHandoff({
          ...event(f.workScope),
          token: f.handoffToken,
        }),
      ).rejects.toThrow();
      const state = await cards.getWorkflow(f.workScope);
      const command = {
        ...event(f.workScope),
        expectedRevision: state!.revision,
        entry: { kind: "text" as const, text: "private answer" },
      };
      const first = await cards.addEntry(command);
      expect(await cards.addEntry(command)).toMatchObject({
        revision: first.revision,
        replay: true,
      });
      await expect(
        cards.addEntry({ ...command, requestDigest: hash("changed") }),
      ).rejects.toThrow();
      await expect(
        cards.addEntry({
          ...event({ ...f.workScope, botId: "919191" }),
          expectedRevision: first.revision,
          entry: command.entry,
        }),
      ).rejects.toThrow();
      await expect(
        cards.addEntry({
          ...event({
            ...f.workScope,
            telegramUserId: "999999",
            chatId: "999999",
          }),
          expectedRevision: first.revision,
          entry: command.entry,
        }),
      ).rejects.toThrow();
      await expect(
        cards.addEntry({
          ...event(f.workScope),
          expectedRevision: state!.revision,
          entry: command.entry,
        }),
      ).rejects.toThrow("card_revision_conflict");
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_card_entries where user_id=${f.userId}::uuid`,
          )
        ).rows[0]?.n,
      ).toBe(1);
    });
  });
  describe("materialDeliveryFixture", () => {
    let fixture: Awaited<ReturnType<typeof materialDeliveryFixture>>;
    beforeEach(async () => {
      fixture = await materialDeliveryFixture();
    });
    it("requires manager proof confirmation and quarantines unknown materials without blocking that confirmation", async () => {
      const { f } = fixture;
      const runner = createExpertCardMaterialsRunner({
        enabled: true,
        repository: cards,
      });
      expect(await runner.runOnce()).toMatchObject({ examined: 0 });
      await expect(
        financial.quoteMain({
          ...event(f.workScope),
          tariffVersionId: tariffId,
          termMonths: 1,
          revision: f.revision,
        }),
      ).rejects.toThrow();
      await template();
      transportFailure = true;
      expect(await runner.runOnce()).toMatchObject({ examined: 1, unknown: 1 });
      const sends = transportCalls.length;
      transportFailure = false;
      expect(await runner.runOnce()).toMatchObject({ examined: 0 });
      expect(transportCalls).toHaveLength(sends);
      expect(sends).toBe(2);
      await expect(
        cards.confirmPromo({
          sessionHash: manager.sessionHash,
          applicationId: f.applicationId,
          expectedRevision: f.revision,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow();
      await cards.submitPromoProof({
        ...event(f.workScope),
        expectedRevision: f.revision,
        proof: {
          kind: "link",
          reference: "https://example.com/independent-announcement",
        },
      });
      expect(
        await cards.confirmPromo({
          sessionHash: manager.sessionHash,
          applicationId: f.applicationId,
          expectedRevision: f.revision,
          idempotencyKey: randomUUID(),
        }),
      ).toMatchObject({
        promoConfirmed: true,
        materialStatus: "unknown_outcome",
      });
      expect(
        (
          await database.db.execute(
            sql`select delivery_receipt from expert_application_material_jobs where application_id=${f.applicationId}::uuid`,
          )
        ).rows[0],
      ).toEqual({ delivery_receipt: null });
    });
  });
  describe("private public-card references", () => {
    let f: Awaited<ReturnType<typeof approvedCard>>;
    beforeEach(async () => {
      f = await approvedCard();
    });
    it.each([
      "telegram:file:private_raw",
      "rfpg:private_reference",
      "https://example.org/private",
    ])("rejects private/public boundary reference %s", async (summary) => {
      await expect(
        cards.editPublicCard({
          sessionHash: manager.sessionHash,
          applicationId: f.applicationId,
          expectedRevision: f.revision,
          idempotencyKey: randomUUID(),
          publicCard: { ...publicCard, summary },
        }),
      ).rejects.toThrow("card_invalid_public_payload");
    });
  });
  describe("invoice acceptance replay", () => {
    let f: Awaited<ReturnType<typeof readyCard>>;
    let first: Awaited<ReturnType<typeof checkout>>;
    beforeEach(async () => {
      f = await readyCard();
      first = await checkout(f);
    });
    it("replays original invoice after a separately accepted fresh quote", async () => {
      const next = await financial.quoteMain({
        ...event(f.workScope),
        tariffVersionId: tariffId,
        termMonths: 3,
        revision: f.revision,
      });
      await financial.acceptMain({
        ...event(f.workScope),
        quoteId: next.id,
        revision: f.revision,
      });
      expect(await financial.createMainInvoice(first.command)).toMatchObject({
        orderId: first.order.orderId,
        quoteId: first.quote.id,
        replay: true,
      });
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_residency_orders`,
          )
        ).rows[0]?.n,
      ).toBe(1);
    });
  });
  describe("erasedPaymentFixture", () => {
    let fixture: Awaited<ReturnType<typeof erasedPaymentFixture>>;
    beforeEach(async () => {
      fixture = await erasedPaymentFixture();
    });
    it("erases real raw media and reconciles later verified money without recreating applicant access", async () => {
      const { f, order, payment } = fixture;
      try {
        await privacy().startErasureAtomically({
          targetUserId: f.userId,
          correlationId: `card-erasure:${f.userId}`,
          idempotencyKey: `card-erasure:${f.userId}`,
          pseudonym: "hmac:synthetic-card-erasure",
        });
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_card_entries where user_id=${f.userId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_application_promo_proofs where user_id=${f.userId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect((await payment.notify()).statusCode).toBe(200);
        expect(await cards.getWorkflow(f.workScope)).toBeNull();
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_onboarding_applications where user_id=${f.userId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from experts_published`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select status from expert_residency_orders where id=${order.orderId}::uuid`,
            )
          ).rows[0]?.status,
        ).toBe("settled");
      } finally {
        await payment.app.close();
      }
    });
  });
  describe("sqlRejectionFixture", () => {
    let fixture: Awaited<ReturnType<typeof sqlRejectionFixture>>;
    beforeEach(async () => {
      fixture = await sqlRejectionFixture();
    });
    it("rejects NULL SQL entry/review/receipt authority and cannot erase code-source identity", async () => {
      const { f, review, a, b } = fixture;
      await expect(
        database.db.execute(
          sql`insert into expert_card_entries(draft_id,user_id,revision,kind) values(${f.draftId}::uuid,${f.userId}::uuid,99,'text')`,
        ),
      ).rejects.toThrow();
      await expect(
        database.db.execute(
          sql`insert into expert_card_reviews(draft_id,user_id,revision,action,public_payload,public_digest,manager_id,manager_session_hash) select draft_id,user_id,revision+1,'approve',public_payload,null,manager_id,manager_session_hash from expert_card_reviews where id=${review.id}::uuid`,
        ),
      ).rejects.toThrow();
      await expect(
        database.db.execute(
          sql`update expert_application_material_jobs set status='delivered',delivery_receipt='{}'::jsonb,delivered_at=clock_timestamp(),attempt_id=gen_random_uuid(),attempt_started_at=clock_timestamp() where application_id=${f.applicationId}::uuid`,
        ),
      ).rejects.toThrow();
      await expect(
        database.db.execute(
          sql`insert into expert_referrals(code_id,inviter_expert_id,invitee_expert_id) values(null,${a.expertId}::uuid,${b.expertId}::uuid)`,
        ),
      ).rejects.toThrow();
    });
  });
  describe("qualifiedRewardFixture", () => {
    let fixture: Awaited<ReturnType<typeof qualifiedRewardFixture>>;
    beforeEach(async () => {
      fixture = await qualifiedRewardFixture();
    });
    it("qualifies one canonical1000 reward pending30days and supersedes the indicative100 before any spendable grant", async () => {
      const { f, inviterScope, order, payment } = fixture;
      try {
        expect((await payment.notify()).statusCode).toBe(200);
        const maturity = (
          await database.db.execute(
            sql`select amount_minor::text amount,status,matures_at=settled_at+interval '30 days' as thirty_days from expert_referral_reward_maturities where qualifying_order_id=${order.orderId}::uuid`,
          )
        ).rows;
        expect(maturity).toEqual([
          { amount: "100000", status: "pending", thirty_days: true },
        ]);
        expect(await promo.register(event(inviterScope))).toMatchObject({
          bonusStatus: "superseded",
          bonusPoints: 0,
        });
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_referral_reward_grants`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_referral_ledger_entries`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        const referral = (
          await database.db.execute<{
            id: string;
            inviter_expert_id: string;
            invitee_expert_id: string;
            promo_qualification_id: string;
          }>(
            sql`select id,inviter_expert_id,invitee_expert_id,promo_qualification_id from expert_referrals`,
          )
        ).rows[0]!;
        await expect(
          database.db.execute(
            sql`insert into expert_referrals(code_id,inviter_expert_id,invitee_expert_id,acquisition_source,promo_qualification_id) values(null,${referral.inviter_expert_id}::uuid,${referral.invitee_expert_id}::uuid,'promo_registration',${referral.promo_qualification_id}::uuid)`,
          ),
        ).rejects.toThrow();
        await expect(
          database.db.execute(
            sql`update expert_referrals set acquisition_source='qualified_code',promo_qualification_id=null where id=${referral.id}::uuid`,
          ),
        ).rejects.toThrow();

        const markerBefore = (
          await database.db.execute(
            sql`select id,settlement_invitee_channel_identity_id,settlement_inviter_channel_identity_id,referral_id from expert_first_residency_settlements where qualifying_order_id=${order.orderId}::uuid`,
          )
        ).rows[0];
        await seedExpertSession(f.userId);
        await privacy().startErasureAtomically({
          targetUserId: f.userId,
          correlationId: `qualified-card-erasure:${f.userId}`,
          idempotencyKey: `qualified-card-erasure:${f.userId}`,
          pseudonym: "hmac:synthetic-qualified-card-erasure",
        });
        await assertErasedFinancialIdentity(f.userId, f.scope.telegramUserId);
        const lateProof = await payment.proof();
        if (!lateProof) throw new Error("fixture_late_verified_proof_missing");
        expect(
          await new PostgresExpertResidencyProviderInboxRepository(
            database.db,
          ).settle(lateProof),
        ).toMatchObject({
          kind: "settled",
          orderId: order.orderId,
          rewardGranted: false,
        });
        const oldWork = await workHttp();
        try {
          const oldStart = await oldWork.inject({
            method: "POST",
            url: "/v1/webhooks/telegram",
            headers: { "x-telegram-bot-api-secret-token": secret },
            payload: {
              update_id: ++sequence,
              message: {
                from: { id: Number(f.scope.telegramUserId) },
                chat: { id: Number(f.scope.chatId), type: "private" },
                text: `/start card_${f.handoffToken}`,
              },
            },
          });
          expect(oldStart.statusCode).toBe(503);
        } finally {
          await oldWork.close();
        }
        expect(await cards.getWorkflow(f.workScope)).toBeNull();
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_onboarding_applications where user_id=${f.userId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from experts_published where user_id=${f.userId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select active,verified,public_display_name from experts where user_id=${f.userId}::uuid`,
            )
          ).rows[0],
        ).toEqual({
          active: false,
          verified: false,
          public_display_name: null,
        });
        expect(
          (
            await database.db.execute(
              sql`select id,settlement_invitee_channel_identity_id,settlement_inviter_channel_identity_id,referral_id from expert_first_residency_settlements where qualifying_order_id=${order.orderId}::uuid`,
            )
          ).rows[0],
        ).toEqual(markerBefore);
        expect(
          (
            await database.db.execute(
              sql`select amount_minor::text amount,status from expert_referral_reward_maturities where qualifying_order_id=${order.orderId}::uuid`,
            )
          ).rows,
        ).toEqual([{ amount: "100000", status: "pending" }]);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_promo_qualification_audits where main_order_id=${order.orderId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(1);
      } finally {
        await payment.app.close();
      }
    });
  });
  describe("expiredQuoteFixture", () => {
    let fixture: Awaited<ReturnType<typeof expiredQuoteFixture>>;
    beforeEach(async () => {
      fixture = await expiredQuoteFixture();
    });
    it("expires the immutable main quote normally and requires a new explicit acceptance", async () => {
      const { f, quote } = fixture;
      await database.db.execute(
        sql`select pg_sleep(greatest(0,extract(epoch from (expires_at-clock_timestamp())))+0.02) from expert_campaign_quotes where id=${quote.id}::uuid`,
      );
      await expect(
        financial.acceptMain({
          ...event(f.workScope),
          quoteId: quote.id,
          revision: f.revision,
        }),
      ).rejects.toThrow();
      expect(
        (
          await database.db.execute(
            sql`select price_minor::text as price from expert_campaign_quotes where id=${quote.id}::uuid`,
          )
        ).rows[0]?.price,
      ).toBe(quote.priceMinor);
      const renewed = await financial.quoteMain({
        ...event(f.workScope),
        tariffVersionId: tariffId,
        termMonths: 3,
        revision: f.revision,
      });
      expect(renewed.id).not.toBe(quote.id);
      await expect(
        financial.createMainInvoice({
          ...event(f.workScope),
          revision: f.revision,
        }),
      ).rejects.toThrow();
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_residency_orders`,
          )
        ).rows[0]?.n,
      ).toBe(0);
      await financial.acceptMain({
        ...event(f.workScope),
        quoteId: renewed.id,
        revision: f.revision,
      });
      expect(
        await financial.createMainInvoice({
          ...event(f.workScope),
          revision: f.revision,
        }),
      ).toMatchObject({ quoteId: renewed.id, priceMinor: renewed.priceMinor });
    }, 15000);
  });
  describe("main settlement deadline races", () => {
    let fixture: Awaited<ReturnType<typeof deadlineCaseFixture>>;
    beforeEach(async () => {
      fixture = await deadlineCaseFixture();
    });
    it.each([false, true])(
      "retains actual expired money after a main binding wait across deadline (withdrawal=%s)",
      async (withdrawal) => {
        const { f, order, payment, proof } = fixture;
        let settlement: ReturnType<typeof observeSettlement> | undefined;
        try {
          await database.db.transaction(async (tx) => {
            await tx.execute(
              sql`select order_id from expert_card_main_orders where order_id=${order.orderId}::uuid for update`,
            );
            // Use the database's real clock; leave60ms for the canonical pre-wait deadline check.
            await tx.execute(
              sql`select pg_sleep(greatest(0,extract(epoch from (payment_deadline-clock_timestamp()))-0.06)) from expert_residency_orders where id=${order.orderId}::uuid`,
            );
            settlement = observeSettlement(
              new PostgresExpertResidencyProviderInboxRepository(
                database.db,
              ).settle(proof),
            );
            // Bounded actual wait lets the real transaction reach the held binding row.
            await waitForMainBindingLock();
            if (withdrawal)
              await privacy().withdrawConsentAtomically({
                targetUserId: f.userId,
                purpose: "client_messaging",
                policyVersion: "client-messaging-v1",
                correlationId: `card-race:${f.userId}`,
              });
            await tx.execute(
              sql`select pg_sleep(greatest(0,extract(epoch from (payment_deadline-clock_timestamp())))+0.01) from expert_residency_orders where id=${order.orderId}::uuid`,
            );
          });
          await expect(settledOutcome(settlement)).rejects.toBeInstanceOf(
            ExpertResidencySettlementError,
          );
          await expect(settledOutcome(settlement)).rejects.toMatchObject({
            code: "EXPERT_RESIDENCY_PAYMENT_EXPIRED",
          });
          expect(
            (
              await database.db.execute(
                sql`select status,residency_starts_at,residency_ends_at from expert_residency_orders where id=${order.orderId}::uuid`,
              )
            ).rows[0],
          ).toEqual({
            status: "expired",
            residency_starts_at: null,
            residency_ends_at: null,
          });
          expect(
            (
              await database.db.execute(
                sql`select count(*)::int n from expert_residency_provider_event_inbox where order_id=${order.orderId}::uuid and authenticated and result_code='EXPERT_RESIDENCY_PAYMENT_EXPIRED'`,
              )
            ).rows[0]?.n,
          ).toBe(1);
          expect(
            (
              await database.db.execute(
                sql`select count(*)::int n from experts_published`,
              )
            ).rows[0]?.n,
          ).toBe(0);
          expect(
            (
              await database.db.execute(
                sql`select active,verified from experts where user_id=${f.userId}::uuid`,
              )
            ).rows[0],
          ).toEqual({ active: false, verified: false });
        } finally {
          await settlement;
          await payment.app.close();
        }
      },
    );
  });
  describe("noticeRaceFixture", () => {
    let fixture: Awaited<ReturnType<typeof noticeRaceFixture>>;
    beforeEach(async () => {
      fixture = await noticeRaceFixture();
    });
    it("retries the whole SERIALIZABLE settlement after a newer approved consent notice wins during a binding wait", async () => {
      const { f, order, payment, proof } = fixture;
      let settlement: ReturnType<typeof observeSettlement> | undefined;
      let attempts = 0;
      let restoreSpy = () => {};
      try {
        await database.db.transaction(async (tx) => {
          await tx.execute(
            sql`select order_id from expert_card_main_orders where order_id=${order.orderId}::uuid for update`,
          );
          const original = database.db.transaction.bind(database.db);
          const spy = vi
            .spyOn(database.db, "transaction")
            .mockImplementation((...args) => {
              attempts++;
              return original(...args);
            });
          restoreSpy = () => spy.mockRestore();
          settlement = observeSettlement(
            new PostgresExpertResidencyProviderInboxRepository(
              database.db,
            ).settle(proof),
          );
          await waitForMainBindingLock();
          // A genuine new immutable notice invalidates the previous presentation;
          // no fabricated grant is made for the applicant's new notice version.
          await database.db.execute(
            sql`insert into consent_document_versions(document_key,version,title,body,text_sha256,status,effective_at,approved_at,approved_by) select document_key,version+1,title,body,text_sha256,'approved',clock_timestamp(),clock_timestamp(),'synthetic-c-race' from consent_document_versions where document_key='consent.client_messaging' and version=1`,
          );
        });
        expect(await settledOutcome(settlement)).toMatchObject({
          kind: "settled",
        });
        expect(attempts).toBeGreaterThanOrEqual(2);
        expect(attempts).toBeLessThanOrEqual(3);
        expect(
          (
            await database.db.execute(
              sql`select active,verified from experts where user_id=${f.userId}::uuid`,
            )
          ).rows[0],
        ).toEqual({ active: false, verified: false });
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from experts_published`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_referral_reward_maturities`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(await cards.getWorkflow(f.workScope)).toBeNull();
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from consents where user_id=${f.userId}::uuid and decision='granted' and document_version_id in(select id from consent_document_versions where version=2)`,
            )
          ).rows[0]?.n,
        ).toBe(0);
      } finally {
        await settlement;
        restoreSpy();
        await payment.app.close();
      }
    });
  });
  for (const prior of ["legacy_source", "prior_ineligible"] as const)
    describe(`first source ${prior}`, () => {
      let fixture: Awaited<ReturnType<typeof firstSourceCaseFixture>>;
      beforeEach(async () => {
        fixture = await firstSourceCaseFixture(prior);
      });
      it(`preserves authoritative first source/snapshot: ${prior}`, async () => {
        const { oldInviter, invitee, originalReferral, payment } = fixture;
        try {
          expect((await payment.notify()).statusCode).toBe(200);
          const sources = (
            await database.db.execute(
              sql`select id,inviter_expert_id,acquisition_source from expert_referrals where invitee_expert_id=${invitee.expertId}::uuid`,
            )
          ).rows;
          expect(sources).toEqual(
            prior === "legacy_source"
              ? [
                  {
                    id: originalReferral,
                    inviter_expert_id: oldInviter.expertId,
                    acquisition_source: "qualified_code",
                  },
                ]
              : [],
          );
          expect(
            (
              await database.db.execute(
                sql`select count(*)::int n from expert_promo_qualification_audits`,
              )
            ).rows[0]?.n,
          ).toBe(0);
          expect(
            (
              await database.db.execute(
                sql`select count(*)::int n from expert_first_residency_settlements where expert_id=${invitee.expertId}::uuid`,
              )
            ).rows[0]?.n,
          ).toBe(1);
          if (prior === "prior_ineligible")
            expect(
              (
                await database.db.execute(
                  sql`select count(*)::int n from expert_referral_reward_maturities`,
                )
              ).rows[0]?.n,
            ).toBe(0);
        } finally {
          await payment.app.close();
        }
      });
    });

  for (const lostResponse of [false, true] as const)
    describe(`configured main checkout ${lostResponse}`, () => {
      let calls: { method: string; url: string }[];
      let paymentId: string;
      let checkoutUrl: string;
      let portCalls: number;
      let traceRestore: (() => void)[];
      let app: Awaited<ReturnType<typeof workHttp>>;
      let fixture: {
        f: Awaited<ReturnType<typeof readyCard>>;
        quote: Awaited<ReturnType<typeof financial.quoteMain>>;
      };
      beforeEach(async () => {
        const f = await readyCard();
        const quote = await financial.quoteMain({
          ...event(f.workScope),
          tariffVersionId: tariffId,
          termMonths: 1,
          revision: f.revision,
        });
        await financial.acceptMain({
          ...event(f.workScope),
          quoteId: quote.id,
          revision: f.revision,
        });
        fixture = { f, quote };
        calls = [];
        traceRestore = [];
        if (process.env.II_TONYA_PHASE1_TRACE_CONFIGURED === "true") {
          const create = financial.createMainInvoice.bind(financial);
          const binding = financial.checkoutBindingForOwner.bind(financial);
          const verify = financial.verifyMainCheckoutForOwner.bind(financial);
          const createSpy = vi
            .spyOn(financial, "createMainInvoice")
            .mockImplementation((...args) =>
              configuredPhase("service_create_invoice", () => create(...args)),
            );
          const bindingSpy = vi
            .spyOn(financial, "checkoutBindingForOwner")
            .mockImplementation((...args) =>
              configuredPhase("service_owner_binding", () => binding(...args)),
            );
          const verifySpy = vi
            .spyOn(financial, "verifyMainCheckoutForOwner")
            .mockImplementation((...args) =>
              configuredPhase("service_verify_binding", () => verify(...args)),
            );
          traceRestore.push(
            () => createSpy.mockRestore(),
            () => bindingSpy.mockRestore(),
            () => verifySpy.mockRestore(),
          );
        }
        let providerBody: Record<string, unknown> | undefined;
        paymentId = `synthetic_${randomUUID()}`;
        checkoutUrl = `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${paymentId}`;
        const operations = new PostgresYooKassaOperationRepository(database.db);
        if (process.env.II_TONYA_PHASE1_TRACE_CONFIGURED === "true") {
          const claim = operations.claimInitialPayment.bind(operations);
          const bind = operations.bindProviderObject.bind(operations);
          const claimSpy = vi
            .spyOn(operations, "claimInitialPayment")
            .mockImplementation((...args) =>
              configuredPhase("operation_claim", () => claim(...args)),
            );
          const bindSpy = vi
            .spyOn(operations, "bindProviderObject")
            .mockImplementation((...args) =>
              configuredPhase("operation_bind", () => bind(...args)),
            );
          traceRestore.push(
            () => claimSpy.mockRestore(),
            () => bindSpy.mockRestore(),
          );
        }
        const provider = createYooKassaClient(
          {
            mode: "test",
            shopId: "test-shop",
            secretKey: "synthetic-fixture-only",
          },
          async (url, init) => {
            const method = String(init.method);
            calls.push({ method, url });
            if (method === "POST") {
              const request = JSON.parse(String(init.body)) as {
                amount: { value: string; currency: string };
                metadata: { order_id: string };
              };
              providerBody = {
                id: paymentId,
                status: "pending",
                paid: false,
                test: true,
                amount: request.amount,
                metadata: request.metadata,
                created_at: new Date().toISOString(),
                confirmation: {
                  type: "redirect",
                  confirmation_url: checkoutUrl,
                },
                refundable: false,
              };
              if (lostResponse) throw new Error("synthetic_unknown_first_send");
            }
            if (!providerBody)
              throw new Error("fixture_missing_provider_payment");
            return new Response(JSON.stringify(providerBody), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          },
        );
        const adapter = new YooKassaExpertResidencyPaymentAdapter({
          client: provider,
          operations,
          mode: "test",
          returnUrl: "https://example.org/payment-return",
          contacts: {
            receiptContactForOrder: async () => ({
              email: "synthetic@example.org",
              authorityReference: "fixture:approved_receipt_contact",
            }),
          },
          receipt: {
            vatCode: 1,
            paymentSubject: "service",
            paymentMode: "full_payment",
          },
        });
        portCalls = 0;
        const service = cardService({
          mainCheckout: {
            strictFirstSendCancellation: true,
            createOrRecover: async (binding) => {
              portCalls++;
              try {
                const result = await configuredPhase("adapter_checkout", () =>
                  adapter.createCheckout({
                    orderId: binding.orderId,
                    amountMinor: binding.amountMinor,
                    currency: binding.currency,
                    idempotencyKey: binding.idempotencyKey,
                  }),
                );
                return {
                  kind: "ready" as const,
                  orderId: binding.orderId,
                  paymentId: result.paymentId,
                  url: result.checkoutUrl,
                };
              } catch {
                return { kind: "pending" as const };
              }
            },
          },
        });
        app = await workHttp(service);
      });
      it(`configured owner invoice path binds the canonical adapter to one order (lostresponse=${lostResponse})`, async () => {
        const { f, quote } = fixture;
        const payload = (updateId: number) => ({
          update_id: updateId,
          message: {
            from: { id: Number(f.scope.telegramUserId) },
            chat: { id: Number(f.scope.chatId), type: "private" },
            text: `/main_invoice ${f.revision}`,
          },
        });
        const send = (body: ReturnType<typeof payload>) =>
          app.inject({
            method: "POST",
            url: "/v1/webhooks/telegram",
            headers: { "x-telegram-bot-api-secret-token": secret },
            payload: body,
          });
        try {
          const first = payload(++sequence);
          const response = await configuredPhase("http_first", () =>
            send(first),
          );
          expect(response.statusCode).toBe(200);
          expect(JSON.stringify(response.json()).includes(checkoutUrl)).toBe(
            !lostResponse,
          );
          const replay = await configuredPhase("http_replay", () =>
            send(first),
          );
          expect(replay.statusCode).toBe(200);
          expect(JSON.stringify(replay.json())).not.toContain(checkoutUrl);
          expect(portCalls).toBe(1);
          const recovery = await configuredPhase("http_recovery", () =>
            send(payload(++sequence)),
          );
          expect(recovery.statusCode).toBe(200);
          expect(JSON.stringify(recovery.json()).includes(checkoutUrl)).toBe(
            !lostResponse,
          );
          expect(portCalls).toBe(2);
          expect(calls.map((call) => call.method)).toEqual(
            lostResponse ? ["POST"] : ["POST", "GET"],
          );
          const stored = (
            await database.db.execute(
              sql`select o.id,o.cash_minor::text amount,p.provider_object_id,p.status,p.environment_mode from expert_residency_orders o join expert_residency_provider_operations p on p.order_id=o.id`,
            )
          ).rows;
          expect(stored).toHaveLength(1);
          expect(stored[0]).toMatchObject({
            amount: quote.priceMinor,
            provider_object_id: lostResponse ? null : paymentId,
            status: lostResponse ? "unknown_outcome" : "pending",
            environment_mode: "test",
          });
          const orderId = String(stored[0]!.id);
          const frame = { ...event(f.workScope), revision: f.revision };
          expect(
            await configuredPhase("db_binding", () =>
              financial.checkoutBindingForOwner(frame, orderId),
            ),
          ).toMatchObject({
            orderId,
            amountMinor: quote.priceMinor,
            purpose: "main_residency",
            providerMode: "test",
          });
          expect(
            await configuredPhase("db_verify_match", () =>
              financial.verifyMainCheckoutForOwner(frame, orderId, paymentId),
            ),
          ).toBe(!lostResponse);
          expect(
            await configuredPhase("db_verify_mismatch", () =>
              financial.verifyMainCheckoutForOwner(
                frame,
                orderId,
                "synthetic_wrong_payment",
              ),
            ),
          ).toBe(false);
        } finally {
          try {
            await configuredPhase("http_close", () => app.close());
          } finally {
            for (const restore of traceRestore.reverse()) restore();
          }
        }
      });
    });
  describe("legacyReceiptFixture", () => {
    let fixture: Awaited<ReturnType<typeof legacyReceiptFixture>>;
    beforeEach(async () => {
      fixture = await legacyReceiptFixture();
    });
    it("normal composition fences historical generic Telegram receipts without reclaiming or mutating cards", async () => {
      const { f, completeId, pendingId, pending, app } = fixture;
      const send = (id: number) =>
        app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram",
          headers: { "x-telegram-bot-api-secret-token": secret },
          payload: {
            update_id: id,
            message: {
              from: { id: Number(f.scope.telegramUserId) },
              chat: { id: Number(f.scope.chatId), type: "private" },
              text: "historical raw update",
            },
          },
        });
      try {
        expect((await send(completeId)).statusCode).toBe(200);
        expect((await send(pendingId)).statusCode).toBe(503);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_card_entries where user_id=${f.userId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select status,claim_id::text from webhook_inbox where provider='telegram' and external_event_id=${String(pendingId)}`,
            )
          ).rows[0],
        ).toEqual({ status: "processing", claim_id: pending.claimId });
        expect((await send(++sequence)).statusCode).toBe(200);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_card_entries where user_id=${f.userId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(1);
      } finally {
        await app.close();
      }
    });
  });
});
