// Narrow fixture reuse from lifecycle completion: no test registration/import.
// Exercises genuine repositories and local verified payment facts, never seeds settlement.
import { type ExpertCardCapability } from "../../apps/api/src/expert-card-composition.js";
import { telegramWebhookRoutes } from "../../apps/api/src/routes/telegram-webhook.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js";
import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { sql } from "drizzle-orm";
import {
  createYooKassaClient,
  YooKassaOnboardingPaymentVerifier,
} from "@ii-tonya/integrations";
import { verifyExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import { PostgresExpertVerificationRepository } from "../../packages/db/src/repositories/expert-verification-repository.js";
import { PostgresExpertCardRepository } from "../../packages/db/src/repositories/expert-card-repository.js";
import { type ExpertReferralTestDatabase } from "../../packages/db/src/testkit/expert-referral.js";
import { startPublicHeldOnboardingFixture } from "./public-held-onboarding-fixture.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { createExpertCardService } from "../../packages/application/src/expert-card-service.js";

const promoScope = { botId: "717171", botKey: "core-promo" };
const workScope = { botId: "818181", botKey: "core-work" };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
let database: ExpertReferralTestDatabase;
let publicPayments: Awaited<
  ReturnType<typeof startPublicHeldOnboardingFixture>
>;
let verification: PostgresExpertVerificationRepository;
let promo: PostgresExpertPromoRepository;
let manager: { sessionHash: string; token: string };
let tariffId: string;
let sequence = 970000;
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

async function paid(prepared?: Awaited<ReturnType<typeof onboarding>>) {
  const f = prepared ?? (await onboarding());
  if (prepared) {
    expect(
      (
        await database.db.execute(
          sql`select admission from expert_onboarding_payment_facts where invoice_id=${f.invoice.id}::uuid`,
        )
      ).rows[0],
    ).toEqual({ admission: "interview" });
    return { ...f, proof: null };
  }
  const body = providerPayment(
    f.binding.providerObjectId,
    f.binding.invoiceId,
    "300000",
    {
      user_id: f.userId,
      purpose: f.binding.purpose,
      operation_id: f.binding.operationId,
    },
  );
  const verifier = new YooKassaOnboardingPaymentVerifier(
    client(body),
    verification,
  );
  const proof = await verifier.verify(f.invoice.id);
  if (!proof) throw new Error("fixture_verified_proof_missing");
  await verification.settleVerified(proof);
  return { ...f, proof };
}
function cards(richOnboarding = true) {
  return new PostgresExpertCardRepository(database.db, {
    richOnboarding,
    messagingConsentPolicyVersion: "client-messaging-v1",
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
  });
}
async function linked(
  richOnboarding = true,
  prepared?: Awaited<ReturnType<typeof onboarding>>,
) {
  const f = await paid(prepared);
  const card = cards(richOnboarding);
  const token = await card.issueWorkHandoff(event(f.scope));
  if (token.kind !== "issued") throw new Error("fixture_handoff_missing");
  const scope = {
    ...workScope,
    telegramUserId: f.scope.telegramUserId,
    chatId: f.scope.chatId,
  };
  await card.redeemWorkHandoff({ ...event(scope), token: token.token });
  return { ...f, card, work: scope };
}

async function secondRichFixture(
  tag = "#тревожность",
  prepared?: Awaited<ReturnType<typeof onboarding>>,
) {
  const f = await linked(true, prepared);
  const repo = new PostgresExpertCardRepository(database.db, {
    richOnboarding: true,
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
    materialTransport: {
      send: async (i) => ({
        messageIds: ["123"],
        botId: i.botId,
        chatId: i.chatId,
        contentVersion: i.contentVersion,
        payloadDigest: i.payloadDigest,
      }),
    },
    photoCustody: {
      read: async () => new Uint8Array([1]),
      put: async () => true,
      presign: async (i) => "https://example.com/private-photo/" + i.custodyId,
    },
  });
  const bio =
    "Помогаю разобраться в жизненных задачах и выбрать собственные следующие шаги без обещаний результата.";
  const service = {
    id: randomUUID(),
    title: "Консультация",
    format: "ONLINE",
    eventDelivery: null,
    durationMinutes: 60,
    price: { kind: "exact", minRub: "1000.00", maxRub: null },
    description: bio,
    audience: "Взрослые",
    result: "План",
    expiryDate: null,
    detailsUrl: null,
    tags: [tag],
  };
  const workflow = () => repo.getWorkflow(f.work);
  const revision = async () => (await workflow())!.revision;
  const photos = async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = event(f.work),
        reference = "telegram:file:second_" + sequence;
      const entry = await repo.addEntry({
        ...e,
        expectedRevision: await revision(),
        entry: { kind: "photo", reference },
      });
      ids.push(
        (
          await repo.ingestRichPhoto({
            ...e,
            expectedRevision: entry.revision,
            reference,
            size: 1,
            mimeType: "image/jpeg",
          })
        ).id,
      );
    }
    return ids;
  };
  const initialPhotos = await photos();
  await repo.richAction({
    ...event(f.work),
    expectedRevision: await revision(),
    action: "patch",
    value: {
      fullName: "Анна",
      specialization: "Консультант",
      bio,
      socialLinks: ["https://example.com/profile"],
      photos: initialPhotos,
      onlineRoomType: "STATIC_LINK",
      staticRoomLink: "https://example.com/room",
      services: [service],
    },
  });
  const prepareReview = async () => {
    let rev = await revision();
    rev = (
      await repo.editPublicCard({
        sessionHash: manager.sessionHash,
        applicationId: f.applicationId,
        expectedRevision: rev,
        idempotencyKey: randomUUID(),
        publicCard: {
          displayName: "Анна",
          profession: "Консультант",
          city: "Казань",
          summary: bio,
        },
      })
    ).revision;
    let preview = await repo.richAction({
      ...event(f.work),
      expectedRevision: rev,
      action: "preview",
    });
    while (preview.pageText!.split("\n").at(-1)!.startsWith("/card_preview")) {
      const parts = preview.pageText!.split("\n").at(-1)!.split(" ");
      preview = await repo.richAction({
        ...event(f.work),
        expectedRevision: rev,
        action: "preview",
        page: Number(parts[2]),
        token: parts[3]!,
      });
    }
    await repo.richAction({
      ...event(f.work),
      expectedRevision: rev,
      action: "confirm",
      token: preview.pageText!.split(" ").at(-1)!,
    });
    await repo.submitDraft({ ...event(f.work), expectedRevision: rev });
    const detail = (await repo.readDraft(
      manager.sessionHash,
      f.applicationId,
    ))!;
    return { rev, detail };
  };
  const approve = async () => {
    const { rev, detail } = await prepareReview();
    return repo.reviewCard({
      sessionHash: manager.sessionHash,
      applicationId: f.applicationId,
      expectedRevision: rev,
      idempotencyKey: randomUUID(),
      action: "approve",
      warningAcknowledgment: detail.safety.digest,
    });
  };
  return {
    ...f,
    repo,
    service,
    photos,
    initialPhotos,
    revision,
    approve,
    prepareReview,
  };
}
async function nativeFixture(
  options: {
    prepared?: Awaited<ReturnType<typeof onboarding>>;
    pauseBeforeSettlement?: boolean;
    pendingMain?: boolean;
    near?: boolean;
    hybrid?: boolean;
    richId?: ReturnType<typeof randomUUID>;
  } = {},
) {
  const f = await secondRichFixture("#тревожность", options.prepared);
  if (options.richId) {
    await f.repo.richAction({
      ...event(f.work),
      expectedRevision: await f.revision(),
      action: "patch",
      value: { services: [{ ...f.service, id: options.richId }] },
    });
    f.service.id = options.richId;
  }
  if (options.hybrid) {
    f.service.format = "HYBRID";
    await f.repo.richAction({
      ...event(f.work),
      expectedRevision: await f.revision(),
      action: "patch",
      value: {
        address: "Казань, улица Примерная, дом 1",
        arrival: "Главный вход, второй этаж",
        yandexMapsUrl: "https://yandex.ru/maps/",
        services: [f.service],
      },
    });
  }
  await f.repo.richAction({
    ...event(f.work),
    expectedRevision: await f.revision(),
    action: "service",
    value: {
      ...f.service,
      id: randomUUID(),
      title: "Разбор задач",
      durationMinutes: 90,
    },
  });
  const target = new Date(
    Date.now() + (options.near ? 20 * 60000 : 3 * 86400000),
  );
  const date = target.toISOString().slice(0, 10),
    start = options.near ? target.toISOString().slice(11, 16) : "09:00",
    end = options.near ? "23:59" : "14:00";
  const http = options.prepared ? await workHttp(f.repo) : undefined;
  const send = async (text: string): Promise<string> => {
    if (!http)
      return (await f.repo.scheduleAction({ ...event(f.work), text })).pageText;
    const response = await http.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: {
        "x-telegram-bot-api-secret-token":
          "synthetic-core-webhook-secret-12345678",
      },
      payload: {
        update_id: ++sequence,
        message: {
          message_id: sequence,
          from: { id: Number(f.work.chatId) },
          chat: { id: Number(f.work.chatId), type: "private" },
          text,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().text;
  };
  await send("/slots_setup");
  for (const answer of [
    options.near ? "Etc/UTC" : "2",
    date + " " + date,
    "1 2 3 4 5 6 7",
    start + "-" + end,
    "нет",
    "15",
  ])
    await send("/slots_answer " + answer);
  let page = await send("/slots_preview");
  while (page.split("\n").at(-1)!.startsWith("/slots_page"))
    page = await send(page.split("\n").at(-1)!);
  await send(page.split("\n").at(-1)!);
  const approved = await f.approve(),
    revision = await f.revision();
  await database.db.execute(
    sql`insert into expert_card_material_templates(content_version,status,text_body) values(${randomUUID()},'approved','Материалы для участника')`,
  );
  const job = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_card_material_jobs where review_id=${approved.reviewId!}::uuid`,
    )
  ).rows[0]!;
  expect(await f.repo.deliverMaterials(job.id)).toMatchObject({
    kind: "delivered",
  });
  await f.repo.submitPromoProof({
    ...event(f.work),
    expectedRevision: revision,
    proof: { kind: "link", reference: "https://example.com/promo" },
  });
  await f.repo.confirmPromo({
    sessionHash: manager.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: revision,
    idempotencyKey: randomUUID(),
  });
  const financial = new PostgresExpertOnboardingMainPaymentRepository(
    database.db,
    {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
  );
  const quote = await financial.quoteMain({
    ...event(f.work),
    tariffVersionId: tariffId,
    termMonths: 1,
    revision,
  });
  await financial.acceptMain({ ...event(f.work), quoteId: quote.id, revision });
  const order = await financial.createMainInvoice({
    ...event(f.work),
    revision,
  });
  const { PostgresYooKassaOperationRepository } =
    await import("../../packages/db/src/repositories/yookassa-operation-repository.js");
  const { PostgresExpertResidencyProviderInboxRepository } =
    await import("../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js");
  const { YooKassaPaymentVerifier } = await import("@ii-tonya/integrations");
  const operations = new PostgresYooKassaOperationRepository(database.db);
  const claimed = await operations.claim({
    commandId: randomUUID(),
    orderId: order.orderId,
    kind: "create_payment",
    mode: "test",
    amountMinor: order.cashMinor,
    currency: "RUB",
    requestDigest: "sha256:" + hash(order.orderId),
  });
  const paymentId = "synthetic_" + randomUUID();
  const operation = await operations.bindProviderObject(claimed.id, paymentId);
  expect(
    await financial.verifyMainCheckoutForOwner(
      { ...event(f.work), revision },
      order.orderId,
      paymentId,
      "https://yookassa.ru/checkout/synthetic",
    ),
  ).toBe(true);
  if (options.prepared) {
    const { PostgresExpertPersonalOfferRepository } =
      await import("../../packages/db/src/repositories/expert-personal-offer-repository.js");
    const offers = new PostgresExpertPersonalOfferRepository(database.db, {
      ...workScope,
      workBotId: workScope.botId,
      workBotKey: workScope.botKey,
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    await database.db.execute(
      sql`update expert_personal_offer_state set next_refresh_at='epoch' where user_id=${f.userId}::uuid`,
    );
    await offers.refreshDue(50);
    expect(await offers.read(f.work)).toMatchObject({
      readiness: "ready",
      payment_url: "https://yookassa.ru/checkout/synthetic",
      selected_locked_term: 1,
    });
  }
  if (!options.pendingMain) {
    const proof = await new YooKassaPaymentVerifier(
      client(providerPayment(paymentId, order.orderId, order.cashMinor)),
      operations,
    ).verifyPayment(operation);
    if (!proof) throw Error("synthetic_main_proof_missing");
    if (options.pauseBeforeSettlement)
      await database.db.execute(
        sql`insert into expert_residency_lifecycle(user_id,expert_id,status,paused_until) select ${f.userId}::uuid,id,'paused',current_date+1 from experts where user_id=${f.userId}::uuid on conflict(user_id) do update set status='paused',paused_until=current_date+1`,
      );
    expect(
      await new PostgresExpertResidencyProviderInboxRepository(
        database.db,
      ).settle(proof),
    ).toMatchObject({ kind: "settled" });
  }
  const expert = (
    await database.db.execute<{ id: string }>(
      sql`select id from experts where user_id=${f.userId}::uuid`,
    )
  ).rows[0]!;
  return {
    ...f,
    expertId: expert.id,
    send,
    date,
    orderId: order.orderId,
    financial,
    http,
  };
}
import { createRequire } from "node:module";
const Fastify = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
)(
  "fastify",
) as typeof import("../../apps/api/node_modules/fastify/fastify.js").default;
async function normalFormOnboarding(): Promise<
  Awaited<ReturnType<typeof onboarding>>
> {
  const { loadEnv } = await import("../../packages/config/src/env.js");
  const { createExpertApplicantComposition } =
    await import("../../apps/api/src/expert-applicant-composition.js");
  const { expertApplicantTelegramRoutes } =
    await import("../../apps/api/src/routes/expert-applicant-telegram.js");
  const { createExpertVerificationComposition } =
    await import("../../apps/api/src/expert-verification-composition.js");
  const { expertVerificationRoutes } =
    await import("../../apps/api/src/routes/expert-verification.js");
  const { saveExpertOfferProfile } =
    await import("../../packages/db/src/repositories/expert-offer-v2.js");
  const { PostgresExpertSeparatedSalesRepository } =
    await import("../../packages/db/src/repositories/expert-separated-sales-repository.js");
  const config = loadEnv({
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_APPLICANT_ENABLED: "true",
    EXPERT_VERIFICATION_FORM_ENABLED: "true",
    EXPERT_PROMO_TELEGRAM_BOT_ID: promoScope.botId,
    EXPERT_PROMO_TELEGRAM_BOT_KEY: promoScope.botKey,
    EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET: [
      "synthetic",
      "resident",
      "secret",
      "1234567890",
    ].join("_"),
    EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
    EXPERT_VERIFICATION_ENABLED: "true",
    EXPERT_VERIFICATION_PAYMENT_MODE: "test",
    EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
  });
  const app = Fastify({ logger: false });
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: createExpertApplicantComposition(database.db, config)!,
  });
  await app.register(expertVerificationRoutes, {
    enabled: true,
    service: createExpertVerificationComposition(database.db, config)!.service,
  });
  const telegramUserId = String(++sequence);
  const scope = { ...promoScope, telegramUserId, chatId: telegramUserId };
  const post = (text: string, callbackData?: string) =>
    app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/expert-promo/" + promoScope.botKey,
      headers: {
        "x-telegram-bot-api-secret-token":
          config.expertApplicant!.webhookSecret,
      },
      payload: {
        update_id: ++sequence,
        ...(callbackData
          ? {
              callback_query: {
                id: "synthetic_" + sequence,
                from: { id: Number(telegramUserId) },
                message: {
                  from: { id: Number(promoScope.botId), is_bot: true },
                  chat: { id: Number(telegramUserId), type: "private" },
                },
                data: callbackData,
              },
            }
          : {
              message: {
                from: { id: Number(telegramUserId) },
                chat: { id: Number(telegramUserId), type: "private" },
                text,
              },
            }),
      },
    });
  try {
    const shown = await post("/start");
    expect(shown.statusCode).toBe(200);
    const token = /\/consent ([A-Za-z0-9_-]{43}) granted/u.exec(
      shown.json().text,
    )?.[1];
    expect(token).toBeDefined();
    expect((await post("/consent " + token + " granted")).statusCode).toBe(200);
    await post("/start");
    const userId = (
      await database.db.execute<{ id: string }>(
        sql`select user_id id from channel_identities where bot_key=${promoScope.botKey} and external_id=${telegramUserId}`,
      )
    ).rows[0]!.id;
    const profile = await saveExpertOfferProfile(database.db, {
      userId,
      cityCode: "kazan",
      millionCity: false,
      serviceFormat: "offline",
      ticketMinor: "300000",
      participantKind: "expert",
      idempotencyKey: randomUUID(),
    });
    await verifyExpertOfferProfile(database.db, {
      sessionHash: manager.sessionHash,
      userId,
      revision: profile.revision,
    });
    const sales = new PostgresExpertSeparatedSalesRepository(database.db, {
      ...promoScope,
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    const command = () => ({
      ...scope,
      userId,
      requestKey: randomUUID(),
      requestDigest: hash(randomUUID()),
    });
    let sale = await sales.transition({
      ...command(),
      tariffVersionId: tariffId,
    });
    for (const action of ["positive", "promo", "month"] as const)
      sale = await sales.transition({
        ...command(),
        baseId: sale!.id,
        revision: sale!.revision,
        action,
      });
    for (const [field, value] of Object.entries({
      roles: "EXPERT",
      primaryRole: "EXPERT",
      category: "BOTH",
      tax: "INDIVIDUAL_NO_STATUS",
      city: "Онлайн",
      socialLinks: "https://example.com/profile",
      motivation: "Развитие практики",
      specialization: "Консультирование",
      averageCheckMinor: "3000",
      methods: "Разбор жизненных задач",
      experienceYears: "3",
      cases: "Опыт индивидуальных консультаций",
    }))
      expect((await post("/set " + field + " " + value)).statusCode).toBe(200);
    const current = (
      await database.db.execute<{ id: string; revision: number }>(
        sql`select id,revision from residents_applications where user_id=${userId}::uuid`,
      )
    ).rows[0]!;
    expect(
      (await post("", `rv:${current.id}:${current.revision}:submit`))
        .statusCode,
    ).toBe(200);
    const form = (
      await database.db.execute<{
        revision: number;
        status: string;
        generation: number;
      }>(
        sql`select revision,status,check_generation as generation from residents_applications a where id=${current.id}::uuid`,
      )
    ).rows[0]!;
    expect(form.status).toBe("UNDER_REVIEW");
    const applicationId = (
      await database.db.execute<{ id: string }>(
        sql`select application_id id from expert_sales_form_bridges where form_id=${current.id}::uuid`,
      )
    ).rows[0]!.id;
    const headers = { authorization: "Bearer " + manager.token };
    const preview = await app.inject({
      method: "POST",
      url: `/v1/admin/expert-verification/${applicationId}/review-preview`,
      headers,
      payload: {
        key: "APPROVED_BASIC",
        expectedRevision: form.revision,
        expectedGeneration: 1,
      },
    });
    expect(preview.statusCode).toBe(200);
    const value = preview.json();
    const p = value.item ?? value;
    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/admin/expert-verification/${applicationId}/review-confirm`,
      headers,
      payload: { previewId: p.previewId, finalHash: p.hash },
    });
    expect(confirmed.statusCode).toBe(200);
    const invoiceId = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_onboarding_invoices where application_id=${applicationId}::uuid`,
      )
    ).rows[0]!.id;
    const invoice = await verification.invoiceForOwner(scope, invoiceId);
    if (!invoice) throw Error("normal_form_invoice_missing");
    expect(invoice.amountMinor).toBe("300000");
    const { PostgresPayerReceiptContactRepository } =
      await import("../../packages/db/src/repositories/payer-receipt-contact-repository.js");
    const bridge = (
      await database.db.execute<{ quoteId: string }>(
        sql`select quote_id as "quoteId" from expert_sales_form_bridges where application_id=${applicationId}::uuid`,
      )
    ).rows[0]!;
    await new PostgresPayerReceiptContactRepository(
      database.db,
      publicPayments.vault,
      30,
    ).capture({
      userId,
      quoteId: bridge.quoteId,
      email: "synthetic@example.com",
      idempotencyKey: randomUUID(),
    });
    const checkout = publicPayments.runtime.held;
    const payment = await checkout.createCheckout({ invoiceId: invoice.id });
    expect(payment).toMatchObject({
      url: "https://yoomoney.ru/checkout/local",
    });
    await publicPayments.waiting(payment.paymentId);
    await checkout.reconcile(invoice.id);
    await checkout.reconcile(invoice.id);
    expect(
      (await publicPayments.stats()).posts
        .filter(
          (r) =>
            r.metadata?.order_id === invoice.id ||
            r.path.startsWith(`/v3/payments/${payment.paymentId}/`),
        )
        .map((r) => r.path),
    ).toEqual(["/v3/payments", expect.stringMatching(/\/capture$/)]);
    expect(
      (
        await database.db.execute(
          sql`select admission,amount_minor::text amount from expert_onboarding_payment_facts where invoice_id=${invoice.id}::uuid`,
        )
      ).rows[0],
    ).toEqual({ admission: "interview", amount: "300000" });
    const binding = await verification.findOnboardingPaymentBinding(invoice.id);
    if (!binding) throw Error("normal_form_binding_missing");
    return { userId, scope, applicationId, invoice, binding };
  } finally {
    await app.close();
  }
}

async function workHttp(
  card: PostgresExpertCardRepository,
  documentImport?: Parameters<
    typeof createExpertCardService
  >[0]["documentImport"],
  answerTagCallback?: (input: {
    botId: string;
    callbackQueryId: string;
    signal: AbortSignal;
  }) => Promise<void>,
  capability?: ExpertCardCapability,
) {
  const service = createExpertCardService({
    enabled: true,
    paymentMode: "test",
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
    workBotUsername: "synthetic_work_bot",
    draftTagsEnabled: true,
    repository: card,
    financial: new PostgresExpertOnboardingMainPaymentRepository(database.db, {
      messagingConsentPolicyVersion: "client-messaging-v1",
      providerMode: "test",
    }),
    ...(documentImport ? { documentImport } : {}),
  });
  const app = Fastify({ logger: false });
  await app.register(telegramWebhookRoutes, {
    secret: ["synthetic-core-webh", "ook-secret-12345678"].join(""),
    clientIngressEnabled: false,
    clientHybridRoutingEnabled: false,
    clientBotKey: "disabled-client",
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
      ...{ workBotId: workScope.botId, workBotKey: workScope.botKey },
      webhookSecret: ["synthetic-core-webh", "ook-secret-12345678"].join(""),
      service: capability?.service ?? service,
      legacyReplay: capability?.legacyReplay ?? { read: async () => "absent" },
      ...(answerTagCallback ? { answerTagCallback } : {}),
    },
  });
  return app;
}

export async function startAuthorityFixture() {
  publicPayments = await startPublicHeldOnboardingFixture();
  database = publicPayments.database;
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0]
      ?.server_version_num,
  ).toBe("170005");
  await database.enableExpertReferralCommands();
  verification = new PostgresExpertVerificationRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  promo = new PostgresExpertPromoRepository(database.db, {
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  manager = await staff();
  tariffId = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
}
export async function stopAuthorityFixture() {
  await publicPayments?.close();
}
export {
  database,
  manager,
  tariffId,
  workScope,
  event,
  hash,
  secondRichFixture,
  nativeFixture,
  normalFormOnboarding,
};
