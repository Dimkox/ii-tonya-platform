import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { loadEnv } from "../../packages/config/src/index.js";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach as vitestBeforeEach,
  describe,
  expect,
  it as vitestIt,
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
import { expectPostgresErrorCause } from "../support/postgres-error.js";
import { createExpertResidencyLifecycleComposition } from "../../apps/api/src/expert-residency-lifecycle-composition.js";
import type { ExpertCardMainCheckout } from "../../packages/application/src/expert-card-service.js";
import { createExpertCardService } from "../../packages/application/src/expert-card-service.js";
import { createExpertCardAdminService } from "../../packages/application/src/expert-card-admin-service.js";
import { PostgresExpertCardRepository } from "../../packages/db/src/repositories/expert-card-repository.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import { PostgresExpertVerificationRepository } from "../../packages/db/src/repositories/expert-verification-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
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
  await seedClientConsent(database.db, userId, "client_messaging");
  await promo.register({ ...event(scope), ...(refCode ? { refCode } : {}) });
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
async function shortTariff(key: "BASE" | "START" = "BASE") {
  const tuple =
    key === "BASE"
      ? { name: "База", price: 590000, groups: 1, statistics: "expanded" }
      : { name: "Старт", price: 390000, groups: 0, statistics: "basic" };
  const audit = await database.createAdminAudit({
    action: "expert_residency.tariff_create_v2",
    objectId: randomUUID(),
  });
  return (
    await database.db.execute<{ id: string }>(
      sql`insert into expert_residency_tariff_versions(tariff_key,display_name,price_minor,duration_seconds,active_from,active_to,commercial_policy_version,credit_cap_bps,individual_services_enabled,group_event_limit,statistics_level,support_priority,approval_id,admin_session_id_hash) values(${key},${tuple.name},${tuple.price},2592000,clock_timestamp()-interval '1 day',clock_timestamp()+interval '3 seconds','expert_residency_v2',3000,true,${tuple.groups},${tuple.statistics},'standard',${audit.approvalId}::uuid,${audit.sessionIdHash}) returning id`,
    )
  ).rows[0]!.id;
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

import { PostgresExpertResidencyLifecycleRepository } from "../../packages/db/src/repositories/expert-residency-lifecycle-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { createExpertResidencyLifecycleWorker } from "../../apps/worker/src/expert-residency-lifecycle-composition.js";
let lifecycle: PostgresExpertResidencyLifecycleRepository;

/** Real C registration/fee/interview/review/material/promo/main GET, no minted facts. */
async function publishedActor() {
  const f = await readyCard();
  const { order } = await checkout(f);
  const payment = await mainPayment(order);
  try {
    expect((await payment.notify()).statusCode).toBe(200);
  } finally {
    await payment.app.close();
  }
  const row = (
    await database.db.execute<{ expertId: string }>(
      sql`select id as "expertId" from experts where user_id=${f.userId}::uuid`,
    )
  ).rows[0]!;
  return { ...f, ...row, order };
}
async function databaseDates() {
  return (
    await database.db.execute<{
      tomorrow: string;
      max: string;
      tooFar: string;
    }>(
      sql`select to_char((clock_timestamp() at time zone 'UTC')::date+1,'YYYY-MM-DD') as tomorrow,to_char(((clock_timestamp() at time zone 'UTC')::date+interval '3 months')::date,'YYYY-MM-DD') as max,to_char(((clock_timestamp() at time zone 'UTC')::date+interval '3 months')::date+1,'YYYY-MM-DD') as "tooFar"`,
    )
  ).rows[0]!;
}
/** Legacy tariffs legitimately support short coverage. Main C tariffs stay 30 days. */
async function legacyCoverage(
  durationSeconds: number,
  beforeSettlement?: (actor: {
    userId: string;
    externalId: string;
    expertId: string;
  }) => Promise<void>,
) {
  const actor = await database.createExpertIdentity({
    provider: "telegram",
    externalId: String(++sequence),
  });
  await database.db.execute(
    sql`update channel_identities set bot_key=${work.botKey},external_chat_id=external_id where user_id=${actor.userId}::uuid`,
  );
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${actor.userId}::uuid,'telegram',${actor.externalId},${actor.externalId},${promoScope.botKey},'active')`,
  );
  await seedClientConsent(database.db, actor.userId, "client_messaging");
  const tariffVersionId = await database.createResidencyTariff({
    tariffKey: `lifecycle-${randomUUID()}`,
    displayName: "Synthetic legacy lifecycle",
    priceMinor: 50000,
    durationSeconds,
    commercialPolicyVersion: "legacy_residency_v1",
  });
  const order = await new PostgresExpertResidencyRepository(
    database.db,
  ).createCheckoutOrder({
    expertId: actor.expertId,
    tariffVersionId,
    providerDeadline: new Date(
      String(
        (
          await database.db.execute(
            sql`select clock_timestamp()+interval '1 hour' as deadline`,
          )
        ).rows[0]!.deadline,
      ),
    ),
    idempotencyKey: randomUUID(),
  });
  if (beforeSettlement) await beforeSettlement(actor);
  const payment = await mainPayment({
    orderId: order.id,
    cashMinor: order.cashMinor,
  });
  try {
    expect((await payment.notify()).statusCode).toBe(200);
  } finally {
    await payment.app.close();
  }
  return {
    ...actor,
    paidUntil: new Date(
      String(
        (
          await database.db.execute(
            sql`select residency_ends_at::text as ends from expert_residency_orders where id=${order.id}::uuid`,
          )
        ).rows[0]!.ends,
      ),
    ).toISOString(),
    scope: {
      ...work,
      telegramUserId: actor.externalId,
      chatId: actor.externalId,
    },
    order,
  };
}
async function renewalReadyActor() {
  const actor = await legacyCoverage(6 * 86400);
  const f = await readyCard(undefined, {
    userId: actor.userId,
    telegramUserId: actor.externalId,
  });
  await lifecycle.processLifecycleBatch(10);
  const state = await lifecycle.readLifecycle(f.workScope);
  if (!state?.bill) throw new Error("fixture_renewal_bill_missing");
  expect(state.bill.readiness).toBe("ready");
  return {
    ...f,
    expertId: actor.expertId,
    legacyOrder: actor.order,
    bill: state.bill,
  };
}
function lifecycleConfig(delivery = false, checkout = false) {
  return loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_CARD_ENABLED: "false",
    EXPERT_RESIDENCY_LIFECYCLE_ENABLED: "true",
    EXPERT_RESIDENCY_LIFECYCLE_COMMANDS_ENABLED: "true",
    EXPERT_RESIDENCY_NOTICE_DELIVERY_ENABLED: String(delivery),
    EXPERT_RESIDENCY_RENEWAL_CHECKOUT_ENABLED: String(checkout),
    EXPERT_CARD_PAYMENT_MODE: "test",
    EXPERT_CARD_WORK_BOT_ID: work.botId,
    EXPERT_CARD_WORK_BOT_KEY: work.botKey,
    EXPERT_CARD_WORK_BOT_USERNAME: "synthetic_card_bot",
    EXPERT_CARD_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
    TELEGRAM_WEBHOOK_SECRET: secret,
    ...(delivery
      ? {
          EXPERT_TELEGRAM_BOT_TOKEN:
            "818181:synthetic_lifecycle_transport_token_1234567890",
        }
      : {}),
  });
}
function lifecycleWorker(delivery = false, unknown = false) {
  const calls: string[] = [];
  const runner = createExpertResidencyLifecycleWorker(
    lifecycleConfig(delivery),
    {
      createRepository: (noticeTransport) =>
        new PostgresExpertResidencyLifecycleRepository(database.db, {
          workBotId: work.botId,
          workBotKey: work.botKey,
          messagingConsentPolicyVersion: "client-messaging-v1",
          ...(noticeTransport ? { noticeTransport } : {}),
        }),
      fetch: async (url, init) => {
        calls.push(String(url));
        if (unknown) throw new Error("synthetic_notice_lost_response");
        const body = JSON.parse(String(init?.body)) as { chat_id: string };
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: ++messageSequence,
              from: { id: Number(work.botId), is_bot: true },
              chat: { id: Number(body.chat_id), type: "private" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );
  if (!runner) throw new Error("fixture_lifecycle_runner_missing");
  return { runner, calls };
}
async function noticeTemplate(stage = "seven_days") {
  await database.db.execute(
    sql`insert into expert_card_material_templates(content_version,status,text_body,assets) values(${`lifecycle.${stage}.v1`},'approved','Synthetic approved residency reminder','[]'::jsonb)`,
  );
}
async function paidIntervals(expertId: string) {
  return (
    await database.db.execute(
      sql`select id,status,residency_starts_at::text as starts,residency_ends_at::text as ends from expert_residency_orders where expert_id=${expertId}::uuid and status='settled' order by id`,
    )
  ).rows;
}
async function refundFor(order: { orderId: string; cashMinor: string }) {
  const row = (
    await database.db.execute<{ paymentId: string }>(
      sql`select provider_payment_id as "paymentId" from expert_residency_orders where id=${order.orderId}::uuid`,
    )
  ).rows[0]!;
  const operations = new PostgresYooKassaOperationRepository(database.db);
  const claimed = await operations.claim({
    commandId: randomUUID(),
    orderId: order.orderId,
    kind: "create_refund",
    mode: "test",
    parentPaymentId: row.paymentId,
    amountMinor: order.cashMinor,
    currency: "RUB",
    requestDigest: `sha256:${hash(randomUUID())}`,
  });
  const refundId = `synthetic_${randomUUID()}`;
  const operation = await operations.bindProviderObject(claimed.id, refundId);
  const amount = BigInt(order.cashMinor);
  const refund = {
    id: refundId,
    payment_id: row.paymentId,
    status: "succeeded",
    amount: {
      value: `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`,
      currency: "RUB",
    },
    created_at: new Date().toISOString(),
  };
  const calls: string[] = [];
  const provider = createYooKassaClient(
    { mode: "test", shopId: "test-shop", secretKey: "synthetic-fixture-only" },
    async (url, init) => {
      calls.push(`${String(init.method)} ${url}`);
      return new Response(
        JSON.stringify(
          String(url).includes("/refunds/")
            ? refund
            : providerPayment(row.paymentId, order.orderId, order.cashMinor),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  const verifier = new YooKassaPaymentVerifier(provider, operations);
  return {
    calls,
    execute: async () => {
      const proof = await verifier.verifyRefund(operation);
      if (!proof) throw new Error("fixture_refund_proof_missing");
      return new PostgresExpertResidencyProviderInboxRepository(
        database.db,
      ).reverse(proof);
    },
  };
}
async function renewalCheckout(
  f: Awaited<ReturnType<typeof renewalReadyActor>>,
) {
  const quote = await financial.quoteMain({
    ...event(f.workScope),
    tariffVersionId: tariffId,
    termMonths: 1,
    revision: f.revision,
    renewalBillId: f.bill.id,
  });
  const command = {
    ...event(f.workScope),
    quoteId: quote.id,
    revision: f.revision,
    renewalBillId: f.bill.id,
  };
  const order = await financial.acceptRenewalAndCreateInvoice(command);
  const payment = await mainPayment(order);
  return { quote, command, order, payment };
}
async function shortInterviewActor() {
  let interviewActor: Awaited<ReturnType<typeof interview>> | undefined;
  const actor = await legacyCoverage(3, async (identity) => {
    interviewActor = await interview(undefined, {
      userId: identity.userId,
      telegramUserId: identity.externalId,
    });
  });
  if (!interviewActor) throw new Error("fixture_interview_missing");
  return { ...actor, ...interviewActor };
}

async function prepaidActor(count = 2) {
  const f = await publishedActor();
  const orders = [f.order];
  for (let index = 1; index < count; index++) {
    const { order } = await checkout(f);
    const payment = await mainPayment(order);
    try {
      expect((await payment.notify()).statusCode).toBe(200);
    } finally {
      await payment.app.close();
    }
    orders.push(order);
  }
  const chainEnd = String(
    (
      await database.db.execute(
        sql`select max(residency_ends_at)::text as ends from expert_residency_orders where expert_id=${f.expertId}::uuid and status='settled'`,
      )
    ).rows[0]!.ends,
  );
  return { ...f, orders, chainEnd: new Date(chainEnd).toISOString() };
}
async function gapActorFixture() {
  let prepared: Awaited<ReturnType<typeof readyCard>> | undefined;
  const legacy = await legacyCoverage(3, async (actor) => {
    prepared = await readyCard(undefined, {
      userId: actor.userId,
      telegramUserId: actor.externalId,
    });
  });
  if (!prepared) throw new Error("fixture_gap_card_missing");
  const f = prepared;
  const orders: { orderId: string; cashMinor: string }[] = [
    { orderId: legacy.order.id, cashMinor: legacy.order.cashMinor },
  ];
  for (let index = 0; index < 2; index++) {
    const { order } = await checkout(f);
    const payment = await mainPayment(order);
    try {
      expect((await payment.notify()).statusCode).toBe(200);
    } finally {
      await payment.app.close();
    }
    orders.push(order);
  }
  return { ...f, expertId: legacy.expertId, pastEnd: legacy.paidUntil, orders };
}
async function lifecycleHttp(mainCheckout?: ExpertCardMainCheckout) {
  const config = lifecycleConfig(false, !!mainCheckout);
  const cap = createExpertResidencyLifecycleComposition(
    database.db,
    config,
    mainCheckout ? { mainCheckout } : {},
  );
  if (!cap) throw new Error("fixture_lifecycle_capability_missing");
  const app = Fastify({ logger: false });
  await app.register(telegramWebhookRoutes, {
    secret,
    clientIngressEnabled: false,
    clientHybridRoutingEnabled: false,
    clientBotKey: "disabled-client-fixture",
    clientGateway: undefined,
    rateLimiter: { consume: () => true },
    inbox: new PostgresWebhookInboxRepository(database.db),
    callbacks: {
      isAuthorizedIdentity: async () => false,
      verifyCallback: async () => false,
      process: async () => {},
    },
    expertCardEnabled: false,
    expertResidencyLifecycleEnabled: true,
    expertResidencyLifecycle: cap,
  });
  return app;
}
function workUpdate(
  scope: { telegramUserId: string; chatId: string },
  text: string,
  updateId = ++sequence,
) {
  return {
    update_id: updateId,
    message: {
      from: { id: Number(scope.telegramUserId) },
      chat: { id: Number(scope.chatId), type: "private" },
      text,
    },
  };
}
function sendWork(
  app: Awaited<ReturnType<typeof lifecycleHttp>>,
  payload: ReturnType<typeof workUpdate>,
) {
  return app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram",
    headers: { "x-telegram-bot-api-secret-token": secret },
    payload,
  });
}
async function configuredRenewalActor() {
  const f = await renewalReadyActor();
  const operations = new PostgresYooKassaOperationRepository(database.db);
  const paymentId = `synthetic_${randomUUID()}`;
  const checkoutUrl = `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${paymentId}`;
  let paymentBody: Record<string, unknown> | undefined;
  const calls: { method: string; url: string }[] = [];
  const provider = createYooKassaClient(
    { mode: "test", shopId: "test-shop", secretKey: "synthetic-fixture-only" },
    async (url, init) => {
      calls.push({ method: String(init.method), url });
      if (init.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          amount: unknown;
          metadata: unknown;
        };
        paymentBody = {
          id: paymentId,
          status: "pending",
          paid: false,
          test: true,
          amount: body.amount,
          metadata: body.metadata,
          created_at: new Date().toISOString(),
          refundable: false,
          confirmation: { type: "redirect", confirmation_url: checkoutUrl },
        };
      }
      if (!paymentBody) throw new Error("fixture_payment_body_missing");
      return new Response(JSON.stringify(paymentBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const adapter = new YooKassaExpertResidencyPaymentAdapter({
    client: provider,
    operations,
    mode: "test",
    returnUrl: "https://example.org/lifecycle-return",
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
  const mainCheckout: ExpertCardMainCheckout = {
    strictFirstSendCancellation: true,
    createOrRecover: async (binding) => {
      try {
        const result = await adapter.createCheckout({
          orderId: binding.orderId,
          amountMinor: binding.amountMinor,
          currency: binding.currency,
          idempotencyKey: binding.idempotencyKey,
        });
        return {
          kind: "ready",
          orderId: binding.orderId,
          paymentId: result.paymentId,
          url: result.checkoutUrl,
        };
      } catch {
        return { kind: "pending" };
      }
    },
  };
  const app = await lifecycleHttp(mainCheckout);
  const merchant = Fastify({ logger: false });
  const verifier = new YooKassaPaymentVerifier(provider, operations);
  const core = new PostgresExpertResidencyProviderInboxRepository(database.db);
  await merchant.register(yookassaWebhookRoutes, {
    effectivePeerAddress: () => "185.71.76.1",
    inbox: new PostgresWebhookInboxRepository(database.db),
    verify: async (notification) => {
      const operation = await operations.findByProviderObject(
        notification.object.id,
        "create_payment",
      );
      if (!operation) throw new Error("fixture_operation_missing");
      return verifier.verifyPayment(operation);
    },
    deliver: async (proof) => {
      await core.settle(proof);
    },
    resolveSucceeded: async (notification) => {
      const operation = await operations.findByProviderObject(
        notification.object.id,
        "create_payment",
      );
      if (!operation) throw new Error("fixture_operation_missing");
      await operations.resolve(operation.id, "succeeded");
    },
  });
  return {
    f,
    app,
    merchant,
    calls,
    paymentId,
    checkoutUrl,
    paid: () => {
      if (!paymentBody) throw new Error("fixture_payment_body_missing");
      paymentBody = {
        ...paymentBody,
        status: "succeeded",
        paid: true,
        refundable: true,
        captured_at: new Date().toISOString(),
      };
    },
    notify: () =>
      merchant.inject({
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
async function waitForSubjectWaiters(count: number) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const waiting = Number(
      (
        await database.db.execute(
          sql`select count(*)::int n from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%pg_advisory_xact_lock%'`,
        )
      ).rows[0]?.n,
    );
    if (waiting >= count) return;
  }
  throw new Error("fixture_subject_lock_wait_not_observed");
}
/** Authorized synthetic calendar state only: no paid intervals or audit history are rewritten. */
async function seedDuePause(actor: { userId: string; expertId: string }) {
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`insert into expert_residency_lifecycle(user_id,expert_id,status,paused_until) values(${actor.userId}::uuid,${actor.expertId}::uuid,'paused',(clock_timestamp() at time zone 'UTC')::date) on conflict(user_id) do update set status='paused',paused_until=(clock_timestamp() at time zone 'UTC')::date,updated_at=clock_timestamp()`,
    );
    await tx.execute(
      sql`update experts set active=false,updated_at=clock_timestamp() where id=${actor.expertId}::uuid`,
    );
    await tx.execute(
      sql`update experts_published set active=false,updated_at=clock_timestamp() where expert_id=${actor.expertId}::uuid`,
    );
    await tx.execute(
      sql`insert into expert_residency_lifecycle_audits(user_id,expert_id,action,return_date) values(${actor.userId}::uuid,${actor.expertId}::uuid,'pause',(clock_timestamp() at time zone 'UTC')::date)`,
    );
  });
}
async function renewalExpiryActor() {
  const f = await renewalReadyActor();
  const firstTariff = await shortTariff();
  const expiredQuote = await financial.quoteMain({
    ...event(f.workScope),
    tariffVersionId: firstTariff,
    termMonths: 1,
    revision: f.revision,
    renewalBillId: f.bill.id,
  });
  await database.db.execute(
    sql`select pg_sleep(greatest(0,extract(epoch from(expires_at-clock_timestamp())))+0.02) from expert_campaign_quotes where id=${expiredQuote.id}::uuid`,
  );
  await expect(
    financial.acceptRenewalAndCreateInvoice({
      ...event(f.workScope),
      quoteId: expiredQuote.id,
      revision: f.revision,
      renewalBillId: f.bill.id,
    }),
  ).rejects.toThrow();
  const oldQuote = await financial.quoteMain({
    ...event(f.workScope),
    tariffVersionId: await shortTariff("START"),
    termMonths: 1,
    revision: f.revision,
    renewalBillId: f.bill.id,
  });
  const oldCommand = {
    ...event(f.workScope),
    quoteId: oldQuote.id,
    revision: f.revision,
    renewalBillId: f.bill.id,
  };
  const oldOrder = await financial.acceptRenewalAndCreateInvoice(oldCommand);
  const oldPayment = await mainPayment(oldOrder);
  return { f, oldQuote, oldCommand, oldOrder, oldPayment };
}
describe("Phase1 residency lifecycle real calendar and canonical renewal (PG17.5)", () => {
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
    lifecycle = new PostgresExpertResidencyLifecycleRepository(database.db, {
      workBotId: work.botId,
      workBotKey: work.botKey,
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    const materialTransport = createExpertMaterialTransport({
      token: "818181:synthetic_fixture_material_token",
      botId: work.botId,
      botKey: work.botKey,
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body)) as { chat_id: string };
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: ++messageSequence,
              from: { id: Number(work.botId), is_bot: true },
              chat: { id: Number(body.chat_id), type: "private" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    cards = new PostgresExpertCardRepository(database.db, {
      workBotId: work.botId,
      workBotKey: work.botKey,
      messagingConsentPolicyVersion: "client-messaging-v1",
      materialTransport,
    });
  });
  describe("seven-day provisional cycle", () => {
    let f: Awaited<ReturnType<typeof legacyCoverage>>;
    let worker: ReturnType<typeof lifecycleWorker>;
    beforeEach(async () => {
      f = await legacyCoverage(6 * 86400);
      worker = lifecycleWorker();
    });
    it("creates one provisional bill/stage under concurrent workers without accepted money or automatic fallback", async () => {
      const results = await Promise.allSettled([
        worker.runner.runOnce(),
        lifecycle.processLifecycleBatch(10),
      ]);
      for (const result of results) expect(result.status).toBe("fulfilled");
      await worker.runner.runOnce();
      const state = await lifecycle.readLifecycle(f.scope);
      expect(state?.bill).toMatchObject({
        readiness: "requires_card",
        quoteId: null,
        acceptanceId: null,
        orderId: null,
        termMonths: 1,
      });
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_residency_renewal_bills where expert_id=${f.expertId}::uuid`,
          )
        ).rows[0]?.n,
      ).toBe(1);
      expect(
        (
          await database.db.execute(
            sql`select stage,status from expert_residency_lifecycle_notices where expert_id=${f.expertId}::uuid`,
          )
        ).rows,
      ).toEqual([{ stage: "seven_days", status: "waiting_content" }]);
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_referral_reward_grants`,
          )
        ).rows[0]?.n,
      ).toBe(0);
      for (const [liveOwner, auditOwner, message] of [
        [null, f.userId, "residency_bill_live_owner_required"],
        [f.userId, randomUUID(), "residency_bill_source"],
      ] as const) {
        try {
          await database.db.execute(
            sql`insert into expert_residency_renewal_bills(user_id,owner_audit_id,expert_id,cycle_end,source_order_id,tariff_version_id,term_months) select ${liveOwner}::uuid,${auditOwner}::uuid,expert_id,residency_ends_at,id,tariff_version_id,1 from expert_residency_orders where id=${f.order.id}::uuid`,
          );
          throw new Error("fixture_invalid_bill_was_accepted");
        } catch (error) {
          expectPostgresErrorCause(error, "23514", message);
        }
      }
    });
  });
  describe("owner-bound renewal price and order", () => {
    let fixture: Awaited<ReturnType<typeof renewalExpiryActor>>;
    beforeEach(async () => {
      fixture = await renewalExpiryActor();
    });
    it("expires old quotes and attempts, requires fresh explicit acceptance and preserves original replay/order history", async () => {
      const { f, oldQuote, oldCommand, oldOrder, oldPayment } = fixture;
      try {
        expect(
          await financial.acceptRenewalAndCreateInvoice({
            ...event(f.workScope),
            quoteId: oldQuote.id,
            revision: f.revision,
            renewalBillId: f.bill.id,
          }),
        ).toMatchObject({ orderId: oldOrder.orderId });
        await database.db.execute(
          sql`select pg_sleep(greatest(0,extract(epoch from(payment_deadline-clock_timestamp())))+0.02) from expert_residency_orders where id=${oldOrder.orderId}::uuid`,
        );
        expect(
          await new PostgresExpertResidencyRepository(
            database.db,
          ).releaseExpiredOrders(),
        ).toMatchObject({ released: 1 });
        const next = await financial.quoteMain({
          ...event(f.workScope),
          tariffVersionId: tariffId,
          termMonths: 1,
          revision: f.revision,
          renewalBillId: f.bill.id,
        });
        await expect(
          financial.createMainInvoice({
            ...event(f.workScope),
            revision: f.revision,
            renewalBillId: f.bill.id,
          }),
        ).rejects.toThrow();
        const command = {
          ...event(f.workScope),
          quoteId: next.id,
          revision: f.revision,
          renewalBillId: f.bill.id,
        };
        const order = await financial.acceptRenewalAndCreateInvoice(command);
        expect(order.orderId).not.toBe(oldOrder.orderId);
        expect(
          await financial.acceptRenewalAndCreateInvoice(command),
        ).toMatchObject({
          orderId: order.orderId,
          quoteId: next.id,
          replay: true,
        });
        expect(
          await financial.acceptRenewalAndCreateInvoice(oldCommand),
        ).toMatchObject({
          orderId: oldOrder.orderId,
          quoteId: oldQuote.id,
          replay: true,
        });
        expect(
          (
            await database.db.execute(
              sql`select sequence,order_id,quote_id from expert_residency_renewal_attempts where bill_id=${f.bill.id}::uuid order by sequence`,
            )
          ).rows,
        ).toEqual([
          { sequence: 1, order_id: oldOrder.orderId, quote_id: oldQuote.id },
          { sequence: 2, order_id: order.orderId, quote_id: next.id },
        ]);
        expect((await oldPayment.notify()).statusCode).toBe(503);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_residency_provider_event_inbox where order_id=${oldOrder.orderId}::uuid and authenticated and result_code='EXPERT_RESIDENCY_PAYMENT_EXPIRED'`,
            )
          ).rows[0]?.n,
        ).toBe(1);
        expect(
          (
            await database.db.execute(
              sql`select status from expert_residency_orders where id=${order.orderId}::uuid`,
            )
          ).rows[0]?.status,
        ).toBe("payment_pending");
      } finally {
        await oldPayment.app.close();
      }
    });
  });
  for (const unknown of [false, true])
    describe(`real lifecycle delivery unknown=${unknown}`, () => {
      let f: Awaited<ReturnType<typeof legacyCoverage>>;
      let worker: ReturnType<typeof lifecycleWorker>;
      beforeEach(async () => {
        f = await legacyCoverage(unknown ? 12 * 3600 : 6 * 86400);
        await noticeTemplate(unknown ? "one_day" : "seven_days");
        worker = lifecycleWorker(true, unknown);
      });
      it(`uses the configured bounded transport and never retries confirmed or uncertain stage sends (unknown=${unknown})`, async () => {
        await worker.runner.runOnce();
        await worker.runner.runOnce();
        expect(worker.calls).toHaveLength(1);
        expect(worker.calls[0]).toMatch(
          /^https:\/\/api\.telegram\.org\/bot[^/]+\/sendMessage$/u,
        );
        const stored = (
          await database.db.execute(
            sql`select stage,status,receipt,attempt_id is not null attempted from expert_residency_lifecycle_notices where expert_id=${f.expertId}::uuid`,
          )
        ).rows[0];
        expect(stored).toMatchObject({
          stage: unknown ? "one_day" : "seven_days",
          status: unknown ? "unknown_outcome" : "delivered",
          attempted: true,
        });
        if (unknown) expect(stored?.receipt).toBeNull();
        else
          expect(stored?.receipt).toMatchObject({
            botId: work.botId,
            chatId: f.externalId,
            contentVersion: "lifecycle.seven_days.v1",
            messageIds: [expect.any(String)],
          });
      });
    });
  describe("paid calendar pause", () => {
    let f: Awaited<ReturnType<typeof prepaidActor>>;
    let dates: Awaited<ReturnType<typeof databaseDates>>;
    let original: Awaited<ReturnType<typeof paidIntervals>>;
    beforeEach(async () => {
      f = await prepaidActor();
      dates = await databaseDates();
      original = await paidIntervals(f.expertId);
    });
    it("accepts exactly three calendar months, rejects longer/wrong scope, and resumes without rewriting paid periods", async () => {
      await expect(
        lifecycle.requestPause({
          ...event(f.workScope),
          returnDate: dates.tooFar,
        }),
      ).rejects.toThrow();
      await expect(
        lifecycle.requestPause({
          ...event({ ...f.workScope, botId: "919191" }),
          returnDate: dates.tomorrow,
        }),
      ).rejects.toThrow();
      const command = { ...event(f.workScope), returnDate: dates.max };
      expect(await lifecycle.requestPause(command)).toMatchObject({
        status: "paused",
        pausedUntil: dates.max,
        replay: false,
      });
      expect(await lifecycle.requestPause(command)).toMatchObject({
        status: "paused",
        replay: true,
      });
      expect(
        (
          await database.db.execute(
            sql`select e.active,p.active published from experts e join experts_published p on p.expert_id=e.id where e.id=${f.expertId}::uuid`,
          )
        ).rows[0],
      ).toEqual({ active: false, published: false });
      expect(await paidIntervals(f.expertId)).toEqual(original);
      expect(await lifecycle.resume(event(f.workScope))).toMatchObject({
        status: "active",
        paidUntil: f.chainEnd,
        pausedUntil: null,
      });
      expect(await paidIntervals(f.expertId)).toEqual(original);
      expect(
        (
          await database.db.execute(
            sql`select next_billing_date::text as ends from experts_published where expert_id=${f.expertId}::uuid`,
          )
        ).rows[0]?.ends,
      ).toBeDefined();
      expect(
        (
          await database.db.execute(
            sql`select next_billing_date=${f.chainEnd}::timestamptz as matches from experts_published where expert_id=${f.expertId}::uuid`,
          )
        ).rows[0]?.matches,
      ).toBe(true);

      expect(
        (
          await database.db.execute(
            sql`select active from experts_published where expert_id=${f.expertId}::uuid`,
          )
        ).rows[0]?.active,
      ).toBe(true);
      await seedDuePause(f);
      await lifecycleWorker().runner.runOnce();
      expect(await lifecycle.readLifecycle(f.workScope)).toMatchObject({
        status: "active",
        paidUntil: f.chainEnd,
        pausedUntil: null,
      });
      expect(await paidIntervals(f.expertId)).toEqual(original);
      expect(
        (
          await database.db.execute(
            sql`select active,next_billing_date=${f.chainEnd}::timestamptz as continuous from experts_published where expert_id=${f.expertId}::uuid`,
          )
        ).rows[0],
      ).toEqual({ active: true, continuous: true });
    });
  });
  describe("real short paid coverage expiry", () => {
    let f: Awaited<ReturnType<typeof shortInterviewActor>>;
    let dates: Awaited<ReturnType<typeof databaseDates>>;
    let original: Awaited<ReturnType<typeof paidIntervals>>;
    beforeEach(async () => {
      f = await shortInterviewActor();
      dates = await databaseDates();
      original = await paidIntervals(f.expertId);
    });
    it("does not restore expired paid access on return and retains canonical period history", async () => {
      expect(
        await lifecycle.requestPause({
          ...event(f.workScope),
          returnDate: dates.tomorrow,
        }),
      ).toMatchObject({ status: "paused" });
      await database.db.execute(
        sql`select pg_sleep(greatest(0,extract(epoch from(residency_ends_at-clock_timestamp())))+0.02) from expert_residency_orders where id=${f.order.id}::uuid`,
      );
      expect(await lifecycle.resume(event(f.workScope))).toMatchObject({
        status: "payment_required",
      });
      expect(await paidIntervals(f.expertId)).toEqual(original);
      expect(
        (
          await database.db.execute(
            sql`select active from experts where id=${f.expertId}::uuid`,
          )
        ).rows[0]?.active,
      ).toBe(false);
    });
  });
  describe("pause against verified renewal", () => {
    let f: Awaited<ReturnType<typeof renewalReadyActor>>;
    let checkoutFixture: Awaited<ReturnType<typeof renewalCheckout>>;
    let dates: Awaited<ReturnType<typeof databaseDates>>;
    let original: Awaited<ReturnType<typeof paidIntervals>>;
    beforeEach(async () => {
      f = await renewalReadyActor();
      checkoutFixture = await renewalCheckout(f);
      dates = await databaseDates();
      original = await paidIntervals(f.expertId);
    });
    it("records actual new money while concurrent pause cannot resurrect access or extend historical periods", async () => {
      const outcomes = await Promise.allSettled([
        lifecycle.requestPause({
          ...event(f.workScope),
          returnDate: dates.tomorrow,
        }),
        checkoutFixture.payment.notify(),
      ]);
      try {
        for (const outcome of outcomes)
          expect(outcome.status).toBe("fulfilled");
        const notification = outcomes[1]!;
        if (notification.status !== "fulfilled") throw notification.reason;
        expect(notification.value.statusCode).toBe(200);
        expect(await lifecycle.readLifecycle(f.workScope)).toMatchObject({
          status: "paused",
        });
        expect(
          (
            await database.db.execute(
              sql`select active from experts where id=${f.expertId}::uuid`,
            )
          ).rows[0]?.active,
        ).toBe(false);
        const after = await paidIntervals(f.expertId);
        expect(after).toEqual(expect.arrayContaining(original));
        expect(after).toHaveLength(original.length + 1);
        expect(
          (
            await database.db.execute(
              sql`select status from expert_residency_orders where id=${checkoutFixture.order.orderId}::uuid`,
            )
          ).rows[0]?.status,
        ).toBe("settled");
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_referral_reward_grants`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(await lifecycle.resume(event(f.workScope))).toMatchObject({
          status: "active",
        });
        expect(
          (
            await database.db.execute(
              sql`select p.active,p.paid_order_id=${checkoutFixture.order.orderId}::uuid as exact,p.next_billing_date=o.residency_ends_at as billed from experts_published p join expert_residency_orders o on o.id=p.paid_order_id where p.expert_id=${f.expertId}::uuid`,
            )
          ).rows[0],
        ).toEqual({ active: true, exact: true, billed: true });
        expect(await paidIntervals(f.expertId)).toEqual(after);
      } finally {
        await checkoutFixture.payment.app.close();
      }
    });
  });
  describe("pause against verified refund", () => {
    let f: Awaited<ReturnType<typeof publishedActor>>;
    let refund: Awaited<ReturnType<typeof refundFor>>;
    let dates: Awaited<ReturnType<typeof databaseDates>>;
    beforeEach(async () => {
      f = await publishedActor();
      refund = await refundFor(f.order);
      dates = await databaseDates();
    });
    it("never re-enables a reversed residency when pause/refund commit in either order", async () => {
      const outcomes = await Promise.allSettled([
        lifecycle.requestPause({
          ...event(f.workScope),
          returnDate: dates.tomorrow,
        }),
        refund.execute(),
      ]);
      for (const outcome of outcomes) expect(outcome.status).toBe("fulfilled");
      expect(await lifecycle.resume(event(f.workScope))).toMatchObject({
        status: "payment_required",
      });
      expect(
        (
          await database.db.execute(
            sql`select e.active,p.active published from experts e join experts_published p on p.expert_id=e.id where e.id=${f.expertId}::uuid`,
          )
        ).rows[0],
      ).toEqual({ active: false, published: false });
      expect(
        refund.calls.filter((url) => url.includes("/refunds/")),
      ).toHaveLength(1);
    });
  });
  describe("middle paid interval refund gap", () => {
    let f: Awaited<ReturnType<typeof gapActorFixture>>;
    let refund: Awaited<ReturnType<typeof refundFor>>;
    let future: Awaited<ReturnType<typeof checkout>>;
    let futurePayment: Awaited<ReturnType<typeof mainPayment>>;
    let markerId: string;
    let dates: Awaited<ReturnType<typeof databaseDates>>;
    beforeEach(async () => {
      f = await gapActorFixture();
      refund = await refundFor(f.orders[1]!);
      future = await checkout(f);
      futurePayment = await mainPayment(future.order);
      markerId = String(
        (
          await database.db.execute(
            sql`select id from expert_first_residency_settlements where expert_id=${f.expertId}::uuid`,
          )
        ).rows[0]!.id,
      );
      dates = await databaseDates();
    });
    it("stops continuous paid coverage at a refunded gap and cannot activate through a later future order", async () => {
      try {
        await refund.execute();
        await database.db.execute(
          sql`select pg_sleep(greatest(0,extract(epoch from(residency_ends_at-clock_timestamp())))+0.02) from expert_residency_orders where id=${f.orders[0]!.orderId}::uuid`,
        );
        expect(await lifecycle.readLifecycle(f.workScope)).toMatchObject({
          status: "payment_required",
          paidUntil: f.pastEnd,
        });
        await lifecycle.requestPause({
          ...event(f.workScope),
          returnDate: dates.tomorrow,
        });
        expect(await lifecycle.resume(event(f.workScope))).toMatchObject({
          status: "payment_required",
          paidUntil: f.pastEnd,
        });
        expect(
          (
            await database.db.execute(
              sql`select e.active,p.active published from experts e join experts_published p on p.expert_id=e.id where e.id=${f.expertId}::uuid`,
            )
          ).rows[0],
        ).toEqual({ active: false, published: false });
        expect(
          (
            await database.db.execute(
              sql`select status,residency_starts_at>(select residency_ends_at from expert_residency_orders where id=${f.orders[0]!.orderId}::uuid) as separated from expert_residency_orders where id=${f.orders[2]!.orderId}::uuid`,
            )
          ).rows[0],
        ).toEqual({ status: "settled", separated: true });
        expect(
          (
            await database.db.execute(
              sql`select clock_timestamp()<residency_starts_at as still_future from expert_residency_orders where id=${f.orders[2]!.orderId}::uuid`,
            )
          ).rows[0]?.still_future,
        ).toBe(true);
        expect((await futurePayment.notify()).statusCode).toBe(200);
        expect(
          (
            await database.db.execute(
              sql`select o.status,o.residency_starts_at>=prior.residency_ends_at as future_stacked from expert_residency_orders o join expert_residency_orders prior on prior.id=${f.orders[2]!.orderId}::uuid where o.id=${future.order.orderId}::uuid`,
            )
          ).rows[0],
        ).toEqual({ status: "settled", future_stacked: true });
        expect(await lifecycle.readLifecycle(f.workScope)).toMatchObject({
          status: "payment_required",
          paidUntil: f.pastEnd,
        });
        expect(
          (
            await database.db.execute(
              sql`select e.active,p.active published from experts e join experts_published p on p.expert_id=e.id where e.id=${f.expertId}::uuid`,
            )
          ).rows[0],
        ).toEqual({ active: false, published: false });
        expect(
          (
            await database.db.execute(
              sql`select id::text from expert_first_residency_settlements where expert_id=${f.expertId}::uuid`,
            )
          ).rows,
        ).toEqual([{ id: markerId }]);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_referral_reward_grants`,
            )
          ).rows[0]?.n,
        ).toBe(0);
      } finally {
        await futurePayment.app.close();
      }
    });
  });
  describe("erasure against real renewal money", () => {
    let f: Awaited<ReturnType<typeof renewalReadyActor>>;
    let checkoutFixture: Awaited<ReturnType<typeof renewalCheckout>>;
    beforeEach(async () => {
      f = await renewalReadyActor();
      checkoutFixture = await renewalCheckout(f);
    });
    it("retains verified financial truth but no routing, bill ownership, publication or access after erasure", async () => {
      const outcomes = await Promise.allSettled([
        privacy().startErasureAtomically({
          targetUserId: f.userId,
          correlationId: `lifecycle-erase:${f.userId}`,
          idempotencyKey: `lifecycle-erase:${f.userId}`,
          pseudonym: "hmac:synthetic-lifecycle-erasure",
        }),
        checkoutFixture.payment.notify(),
      ]);
      try {
        for (const outcome of outcomes)
          expect(outcome.status).toBe("fulfilled");
        const notification = outcomes[1]!;
        if (notification.status !== "fulfilled") throw notification.reason;
        expect(notification.value.statusCode).toBe(200);
        expect(await lifecycle.readLifecycle(f.workScope)).toBeNull();
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from experts_published where expert_id=${f.expertId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(0);

        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_residency_lifecycle where user_id=${f.userId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_residency_lifecycle_notices where user_id=${f.userId}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await database.db.execute(
              sql`select user_id from expert_residency_renewal_bills where id=${f.bill.id}::uuid`,
            )
          ).rows[0]?.user_id,
        ).toBeNull();
        expect(
          (
            await database.db.execute(
              sql`select active from experts where id=${f.expertId}::uuid`,
            )
          ).rows[0]?.active,
        ).toBe(false);
        expect(
          (
            await database.db.execute(
              sql`select status from expert_residency_orders where id=${checkoutFixture.order.orderId}::uuid`,
            )
          ).rows[0]?.status,
        ).toBe("settled");
      } finally {
        await checkoutFixture.payment.app.close();
      }
    });
  });
  describe("actual D owner renewal and merchant wiring", () => {
    let fixture: Awaited<ReturnType<typeof configuredRenewalActor>>;
    beforeEach(async () => {
      fixture = await configuredRenewalActor();
    });
    it("uses explicit atomic acceptance, exact-order recovery and concurrent verified settlement without losing current projection", async () => {
      const { f, app, merchant, calls, checkoutUrl } = fixture;
      let concurrent:
        | Promise<
            PromiseSettledResult<Awaited<ReturnType<typeof fixture.notify>>>[]
          >
        | undefined;
      try {
        expect(
          (
            await sendWork(
              app,
              workUpdate(f.workScope, `/renewal_quote ${tariffId} 1`),
            )
          ).statusCode,
        ).toBe(200);
        const bill = (await lifecycle.readLifecycle(f.workScope))!.bill!;
        if (!bill.quoteId) throw new Error("fixture_renewal_quote_missing");
        const accept = workUpdate(
          f.workScope,
          `/renewal_accept ${bill.quoteId}`,
        );
        const accepted = await sendWork(app, accept);
        expect(accepted.statusCode).toBe(200);
        expect(JSON.stringify(accepted.json())).toContain(checkoutUrl);
        expect((await sendWork(app, accept)).json()).toMatchObject({
          accepted: true,
          duplicate: true,
        });
        expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
        const before = (await lifecycle.readLifecycle(f.workScope))!;
        const orderId = before.bill!.orderId!;
        expect(orderId).toBeTruthy();
        expect(
          (await sendWork(app, workUpdate(f.workScope, "/renewal_invoice")))
            .statusCode,
        ).toBe(200);
        fixture.paid();
        const recoveryPayload = workUpdate(f.workScope, "/renewal_invoice");
        await database.db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${f.userId}::uuid::text,0))`,
          );
          const recovery = sendWork(app, recoveryPayload);
          const observedRecovery = recovery.then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason) => ({
              status: "rejected" as const,
              reason: reason as unknown,
            }),
          );
          concurrent = Promise.all([observedRecovery]);
          await waitForSubjectWaiters(1);
          const notification = fixture.notify();
          const observedNotification = notification.then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason) => ({
              status: "rejected" as const,
              reason: reason as unknown,
            }),
          );
          concurrent = Promise.all([observedRecovery, observedNotification]);
          await waitForSubjectWaiters(2);
        });
        const outcomes = await concurrent;
        expect(outcomes).toHaveLength(2);
        for (const outcome of outcomes!)
          expect(outcome.status).toBe("fulfilled");
        const recoveryOutcome = outcomes![0]!,
          notificationOutcome = outcomes![1]!;
        if (recoveryOutcome.status !== "fulfilled")
          throw recoveryOutcome.reason;
        if (notificationOutcome.status !== "fulfilled")
          throw notificationOutcome.reason;
        expect(notificationOutcome.value.statusCode).toBe(200);
        expect([200, 503]).toContain(recoveryOutcome.value.statusCode);
        if (recoveryOutcome.value.statusCode === 503) {
          const recovered = await sendWork(app, recoveryPayload);
          expect(recovered.statusCode).toBe(200);
          expect(recovered.json()).toMatchObject({
            accepted: true,
            duplicate: true,
          });
        }

        const state = await lifecycle.readLifecycle(f.workScope);
        expect(state?.status).toBe("active");
        expect(
          (
            await database.db.execute(
              sql`select o.status,p.paid_order_id=o.id as exact,p.active,p.next_billing_date=o.residency_ends_at as billed from expert_residency_orders o join experts_published p on p.expert_id=o.expert_id where o.id=${orderId}::uuid`,
            )
          ).rows[0],
        ).toEqual({
          status: "settled",
          exact: true,
          active: true,
          billed: true,
        });
        expect(
          (
            await database.db.execute(
              sql`select count(*)::int n from expert_residency_renewal_attempts where bill_id=${f.bill.id}::uuid`,
            )
          ).rows[0]?.n,
        ).toBe(1);
        expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
      } finally {
        try {
          await concurrent;
        } finally {
          try {
            await app.close();
          } finally {
            await merchant.close();
          }
        }
      }
    });
  });
  describe("overdue retained lifecycle surface", () => {
    let f: Awaited<ReturnType<typeof legacyCoverage>>;
    let app: Awaited<ReturnType<typeof lifecycleHttp>>;
    let worker: ReturnType<typeof lifecycleWorker>;
    beforeEach(async () => {
      f = await legacyCoverage(3);
      app = await lifecycleHttp();
      worker = lifecycleWorker();
    });
    it("closes overdue expert access while actual private lifecycle commands remain available with C ingress off", async () => {
      try {
        await database.db.execute(
          sql`select pg_sleep(greatest(0,extract(epoch from(residency_ends_at-clock_timestamp())))+0.02) from expert_residency_orders where id=${f.order.id}::uuid`,
        );
        await worker.runner.runOnce();
        expect(
          (
            await database.db.execute(
              sql`select active from experts where id=${f.expertId}::uuid`,
            )
          ).rows[0]?.active,
        ).toBe(false);
        expect(await lifecycle.readLifecycle(f.scope)).toMatchObject({
          status: "payment_required",
          paidUntil: f.paidUntil,
        });
        const response = await sendWork(app, workUpdate(f.scope, "/residency"));
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          method: "sendMessage",
          protect_content: true,
        });
        expect(
          (
            await database.db.execute(
              sql`select stage from expert_residency_lifecycle_notices where expert_id=${f.expertId}::uuid`,
            )
          ).rows,
        ).toEqual([{ stage: "overdue" }]);
      } finally {
        await app.close();
      }
    });
  });
});
