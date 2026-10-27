import { type ExpertCardCapability } from "../../apps/api/src/expert-card-composition.js";
import type { RuntimeConfig } from "../../packages/config/src/index.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { telegramWebhookRoutes } from "../../apps/api/src/routes/telegram-webhook.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import {
  createYooKassaClient,
  YooKassaOnboardingPaymentVerifier,
} from "@ii-tonya/integrations";
import { verifyExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import { PostgresExpertVerificationRepository } from "../../packages/db/src/repositories/expert-verification-repository.js";
import { PostgresExpertCardRepository } from "../../packages/db/src/repositories/expert-card-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { createExpertCardService } from "../../packages/application/src/expert-card-service.js";

const promoScope = { botId: "717171", botKey: "core-promo" };
const workScope = { botId: "818181", botKey: "core-work" };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
let database: ExpertReferralTestDatabase;
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
import { PostgresResidentLifecycleCompletionRepository } from "../../packages/db/src/repositories/resident-lifecycle-completion-repository.js";
import { residentLifecycleRoutes } from "../../apps/api/src/routes/resident-lifecycle.js";
import { createResidentLifecycleCompletionWorker } from "../../apps/worker/src/resident-lifecycle-completion-composition.js";
import type { ResidentWorkOutcome } from "../../packages/contracts/src/resident-lifecycle-completion.js";
const lifecycle = (
  send?: (input: {
    botKey: string;
    chatId: string;
    text: string;
    deadline: string;
  }) => Promise<ResidentWorkOutcome>,
) =>
  new PostgresResidentLifecycleCompletionRepository(database.db, {
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
    ...(send ? { transport: { send } } : {}),
  });
const notices = async (userId: string) =>
  (
    await database.db.execute<{
      id: string;
      kind: string;
      state: string;
      attempts: number;
    }>(
      sql`select id,kind,state,attempt_count as attempts from resident_work_notices where user_id=${userId}::uuid order by created_at,id`,
    )
  ).rows;
const receipt = async (input: {
  botKey: string;
  chatId: string;
}): Promise<ResidentWorkOutcome> => ({
  kind: "applied",
  receipt: { botKey: input.botKey, chatId: input.chatId, messageId: 101 },
});
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
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
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);

it("missing template remains truthful and does not invent material delivery", async () => {
  const f = await secondRichFixture();
  const approved = await f.approve();
  const job = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_card_material_jobs where review_id=${approved.reviewId!}::uuid`,
    )
  ).rows[0]!;
  expect(await f.repo.deliverMaterials(job.id)).not.toMatchObject({
    kind: "delivered",
  });
  expect(
    (
      await database.db.execute(
        sql`select status,delivered_at,delivery_receipt from expert_card_material_jobs where id=${job.id}::uuid`,
      )
    ).rows[0],
  ).toMatchObject({
    status: "waiting_content",
    delivered_at: null,
    delivery_receipt: null,
  });
}, 60000);

it("actual card decisions create source-bound WORK notices, stale revision is suppressed and return reason is preserved", async () => {
  const f = await secondRichFixture(),
    { rev, detail } = await f.prepareReview();
  const reason = "Уточните специализацию и описание услуги";
  await f.repo.reviewCard({
    sessionHash: manager.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: rev,
    idempotencyKey: randomUUID(),
    action: "return_changes",
    returnReason: reason,
    warningAcknowledgment: detail.safety.digest,
  });
  const original = (await notices(f.userId))[0]!;
  expect(original).toMatchObject({
    kind: "card_returned",
    state: "pending",
    attempts: 0,
  });
  const texts: string[] = [];
  const worker = lifecycle(async (input) => {
    texts.push(input.text);
    return receipt(input);
  });
  expect(await worker.deliverNotice(original.id)).toBe("delivered");
  expect(texts[0]).toContain(reason);
  expect(await worker.deliverNotice(original.id)).toBe("deferred_or_terminal");
  await f.approve();
  const approved = (await notices(f.userId)).find(
    (n) => n.kind === "card_approved",
  )!;
  expect(await worker.deliverNotice(approved.id)).toBe("delivered");
  expect(texts).toHaveLength(2);
  expect(texts[1]).not.toContain("опубликована");
  await expect(
    database.db.execute(
      sql`update resident_work_notices set target_chat_id='123' where id=${approved.id}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    database.db.execute(
      sql`update resident_work_notice_attempts set payload_digest=${"sha256:" + "a".repeat(64)} where notice_id=${approved.id}::uuid`,
    ),
  ).rejects.toThrow();
  const originalAttempt = (
    await database.db.execute<{ id: string }>(
      sql`select last_attempt_id id from resident_work_notices where id=${original.id}::uuid`,
    )
  ).rows[0]!.id;
  await expect(
    database.db.execute(
      sql`update resident_work_notices set last_attempt_id=${originalAttempt}::uuid where id=${approved.id}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    database.db.execute(
      sql`update resident_work_notices set attempt_count=2 where id=${approved.id}::uuid`,
    ),
  ).rejects.toThrow();
  const unissued = await secondRichFixture();
  await unissued.approve();
  const pending = (await notices(unissued.userId))[0]!;
  await expect(
    database.db.execute(
      sql`update resident_work_notices set state='delivered' where id=${pending.id}::uuid`,
    ),
  ).rejects.toThrow();
}, 60000);

it("actual first publication emits one welcome; duplicate projection and renewal scans never invent delivery", async () => {
  const f = await nativeFixture();
  const rows = await notices(f.userId);
  expect(rows.filter((n) => n.kind === "first_activation")).toHaveLength(1);
  const sent: string[] = [];
  const worker = lifecycle(async (input) => {
    sent.push(input.text);
    return receipt(input);
  });
  const welcome = rows.find((n) => n.kind === "first_activation")!;
  expect(await worker.deliverNotice(welcome.id)).toBe("delivered");
  expect(await worker.deliverNotice(welcome.id)).toBe("deferred_or_terminal");
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("/schedule");
  expect(sent[0]).not.toContain("example.com/room");
  const marker = (
    await database.db.execute(
      sql`select activation_kind,activation_order_id from resident_lifecycle_subjects where user_id=${f.userId}::uuid`,
    )
  ).rows[0];
  expect(marker).toEqual({
    activation_kind: "first_projection",
    activation_order_id: f.orderId,
  });
  await worker.processBatch(50);
  expect(
    (await worker.listCases(manager.sessionHash)).filter(
      (c) => c.applicationId === f.applicationId,
    ),
  ).toEqual([]);
}, 60000);

it("unknown delivery is not retried, throttled second due row spends no attempt, and validated receipt repairs lost acknowledgement", async () => {
  const a = await secondRichFixture();
  await a.approve();
  const b = await secondRichFixture();
  await b.approve();
  const na = (await notices(a.userId))[0]!,
    nb = (await notices(b.userId))[0]!;
  let calls = 0;
  const unknown = lifecycle(async () => {
    calls++;
    return { kind: "unknown", reasonCode: "synthetic_timeout" };
  });
  expect(await unknown.deliverNotice(na.id)).toBe("unknown");
  expect(await unknown.deliverNotice(na.id)).toBe("deferred_or_terminal");
  expect(calls).toBe(1);
  const throttle = lifecycle(async () => ({
    kind: "not_applied",
    retryAfterSeconds: 30,
    reasonCode: "rate_limited",
  }));
  expect(await throttle.deliverNotice(nb.id)).toBe("deferred");
  const c = await secondRichFixture();
  await c.approve();
  const nc = (await notices(c.userId))[0]!;
  expect(await lifecycle(receipt).deliverNotice(nc.id)).toBe(
    "deferred_or_terminal",
  );
  expect((await notices(c.userId))[0]!.attempts).toBe(0);
  await database.db.execute(
    sql`update resident_work_bot_state set not_before=clock_timestamp()-interval '1 second'`,
  );
  await database.db.execute(
    sql`update resident_work_notices set available_at=clock_timestamp()-interval '1 second' where id=${nc.id}::uuid`,
  );
  // Inject a DB acknowledgement failure after the transport returns its validated receipt.
  await database.db.execute(
    sql.raw(
      "create function test_lifecycle_ack_failure() returns trigger language plpgsql as $$ begin if NEW.state='delivered' then raise exception 'synthetic_ack_failure'; end if; return NEW; end $$; create trigger test_lifecycle_ack_failure before update on resident_work_notices for each row execute function test_lifecycle_ack_failure()",
    ),
  );
  let sent = 0;
  const recovery = lifecycle(async (input) => {
    sent++;
    return receipt(input);
  });
  try {
    expect(await recovery.deliverNotice(nc.id)).toBe("unknown");
  } finally {
    await database.db.execute(
      sql.raw(
        "drop trigger test_lifecycle_ack_failure on resident_work_notices; drop function test_lifecycle_ack_failure()",
      ),
    );
  }
  await recovery.recoverReceipts();
  expect(sent).toBe(1);
  expect((await notices(c.userId))[0]!.state).toBe("delivered");
}, 60000);

it("fee-only missing materials creates internal case; actual delivery starts separate seven-day grace; fresh MFA staff API closes idempotently", async () => {
  const f = await secondRichFixture();
  const approved = await f.approve();
  // Explicit fixture clock travel changes only immutable source timestamps under a scoped trigger disable.
  await database.db.execute(
    sql.raw("alter table expert_card_reviews disable trigger user"),
  );
  try {
    await database.db.execute(
      sql`update expert_card_reviews set created_at=clock_timestamp()-interval '8 days' where id=${approved.reviewId!}::uuid`,
    );
  } finally {
    await database.db.execute(
      sql.raw("alter table expert_card_reviews enable trigger user"),
    );
  }
  await database.db.execute(
    sql`update resident_lifecycle_subjects set last_scanned_at='-infinity' where user_id=${f.userId}::uuid`,
  );
  const repo = lifecycle();
  await repo.processBatch(50);
  const own = (await repo.listCases(manager.sessionHash)).filter(
    (c) => c.applicationId === f.applicationId,
  );
  expect(own.map((c) => c.kind)).toEqual(["materials_missing"]);
  const app = Fastify();
  await app.register(residentLifecycleRoutes, {
    enabled: true,
    repository: repo,
  });
  try {
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/expert-cards/lifecycle",
        })
      ).statusCode,
    ).toBe(401);
    const headers = { authorization: "Bearer " + manager.token };
    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/expert-cards/lifecycle",
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    const item = own[0]!;
    const payload = {
      expectedRevision: item.revision,
      idempotencyKey: randomUUID(),
      resolution: "Шаблоны ещё готовятся; это внутренняя задача",
    };
    const url = "/v1/admin/expert-cards/lifecycle/" + item.id + "/close";
    expect(
      (await app.inject({ method: "POST", url, headers, payload })).json(),
    ).toMatchObject({ kind: "ok", replay: false });
    expect(
      (await app.inject({ method: "POST", url, headers, payload })).json(),
    ).toMatchObject({ kind: "ok", replay: true });
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: { ...payload, resolution: "Другой ответ" },
        })
      ).statusCode,
    ).toBe(409);
    await database.db.execute(
      sql`update admin_sessions set mfa_verified_at=clock_timestamp()-interval '16 minutes' where session_id_hash=${manager.sessionHash}`,
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/expert-cards/lifecycle/" + item.id,
          headers,
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
    await database.db.execute(
      sql`update admin_sessions set mfa_verified_at=clock_timestamp() where session_id_hash=${manager.sessionHash}`,
    );
  }

  const job = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_card_material_jobs where review_id=${approved.reviewId!}::uuid`,
    )
  ).rows[0]!;
  expect(await f.repo.deliverMaterials(job.id)).toMatchObject({
    kind: "delivered",
  });
  await database.db.execute(
    sql`update resident_lifecycle_subjects set last_scanned_at='-infinity' where user_id=${f.userId}::uuid`,
  );
  await repo.processBatch(50);
  expect(
    (await repo.listCases(manager.sessionHash)).filter(
      (c) => c.applicationId === f.applicationId,
    ),
  ).toEqual([]);
  await database.db.execute(
    sql.raw("alter table expert_card_material_jobs disable trigger user"),
  );
  try {
    await database.db.execute(
      sql`update expert_card_material_jobs set delivered_at=clock_timestamp()-interval '7 days'+interval '1 minute' where id=${job.id}::uuid`,
    );
  } finally {
    await database.db.execute(
      sql.raw("alter table expert_card_material_jobs enable trigger user"),
    );
  }
  await database.db.execute(
    sql`update resident_lifecycle_subjects set last_scanned_at='-infinity' where user_id=${f.userId}::uuid`,
  );
  await repo.processBatch(50);
  expect(
    (await repo.listCases(manager.sessionHash)).filter(
      (c) => c.applicationId === f.applicationId,
    ),
  ).toEqual([]);
  await database.db.execute(
    sql.raw("alter table expert_card_material_jobs disable trigger user"),
  );
  try {
    await database.db.execute(
      sql`update expert_card_material_jobs set delivered_at=clock_timestamp()-interval '7 days'-interval '1 minute' where id=${job.id}::uuid`,
    );
  } finally {
    await database.db.execute(
      sql.raw("alter table expert_card_material_jobs enable trigger user"),
    );
  }
  await database.db.execute(
    sql`update resident_lifecycle_subjects set last_scanned_at='-infinity' where user_id=${f.userId}::uuid`,
  );
  await repo.processBatch(50);
  expect(
    (await repo.listCases(manager.sessionHash))
      .filter((c) => c.applicationId === f.applicationId)
      .map((c) => c.kind),
  ).toEqual(["promotion_overdue"]);
}, 60000);

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
    EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET:
      "synthetic_resident_secret_1234567890",
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
    const { createPayerReceiptVault } = await import("@ii-tonya/integrations");
    const { PostgresPayerReceiptContactRepository } =
      await import("../../packages/db/src/repositories/payer-receipt-contact-repository.js");
    const { PostgresHeldOnboardingCheckout } =
      await import("../../packages/db/src/repositories/expert-held-onboarding-repository.js");
    const { startHeldOnboardingLocal } =
      await import("../support/held-onboarding-local.js");
    const vault = createPayerReceiptVault({
      activeKeyId: "fixture",
      keys: new Map([["fixture", new Uint8Array(32).fill(11)]]),
    });
    const bridge = (
      await database.db.execute<{ quoteId: string }>(
        sql`select quote_id as "quoteId" from expert_sales_form_bridges where application_id=${applicationId}::uuid`,
      )
    ).rows[0]!;
    await new PostgresPayerReceiptContactRepository(
      database.db,
      vault,
      30,
    ).capture({
      userId,
      quoteId: bridge.quoteId,
      email: "synthetic@example.com",
      idempotencyKey: randomUUID(),
    });
    const local = await startHeldOnboardingLocal("synthetic_" + randomUUID());
    try {
      const checkout = new PostgresHeldOnboardingCheckout(database.db, {
        enabled: true,
        client: local.client,
        vault,
        protector: local.protector,
        decryptor: local.decryptor,
        repository: verification,
        returnUrl: "https://example.com/return",
        vatCode: 1,
        mode: "test",
      });
      expect(
        await checkout.createCheckout({ invoiceId: invoice.id }),
      ).toMatchObject({ url: "https://yookassa.ru/synthetic-sales-checkout" });
      local.waiting();
      await checkout.reconcile(invoice.id);
      await checkout.reconcile(invoice.id);
      expect(
        local.requests.filter((r) => r.method === "POST").map((r) => r.path),
      ).toEqual(["/v3/payments", expect.stringMatching(/\/capture$/)]);
      expect(
        (
          await database.db.execute(
            sql`select admission,amount_minor::text amount from expert_onboarding_payment_facts where invoice_id=${invoice.id}::uuid`,
          )
        ).rows[0],
      ).toEqual({ admission: "interview", amount: "300000" });
    } finally {
      await local.stop();
    }
    const binding = await verification.findOnboardingPaymentBinding(invoice.id);
    if (!binding) throw Error("normal_form_binding_missing");
    return { userId, scope, applicationId, invoice, binding };
  } finally {
    await app.close();
  }
}

it("paused first settlement records payment without premature welcome; eligible resume produces exactly one", async () => {
  const f = await nativeFixture({ pauseBeforeSettlement: true });
  expect(
    (await notices(f.userId)).filter((n) => n.kind === "first_activation"),
  ).toEqual([]);
  const { PostgresExpertResidencyLifecycleRepository } =
    await import("../../packages/db/src/repositories/expert-residency-lifecycle-repository.js");
  const paidLifecycle = new PostgresExpertResidencyLifecycleRepository(
    database.db,
    {
      workBotId: workScope.botId,
      workBotKey: workScope.botKey,
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
  );
  expect(await paidLifecycle.resume(event(f.work))).toMatchObject({
    status: "active",
  });
  expect(
    (await notices(f.userId)).filter((n) => n.kind === "first_activation"),
  ).toHaveLength(1);
  const notice = (await notices(f.userId)).find(
    (n) => n.kind === "first_activation",
  )!;
  const until = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await paidLifecycle.requestPause({ ...event(f.work), returnDate: until });
  expect(await lifecycle(receipt).deliverNotice(notice.id)).toBe(
    "deferred_or_terminal",
  );
  expect(
    (await notices(f.userId)).find((n) => n.id === notice.id)!.attempts,
  ).toBe(0);
  await paidLifecycle.resume(event(f.work));
  await database.db.execute(
    sql`update resident_work_notices set available_at=clock_timestamp()-interval '1 second' where id=${notice.id}::uuid`,
  );
  expect(await lifecycle(receipt).deliverNotice(notice.id)).toBe("delivered");
}, 60000);

it("actual client reserve and human prebooking refusals use daily strict twenty-percent cohort", async () => {
  const { PostgresBookingRepository } =
    await import("../../packages/db/src/repositories/booking-repository.js");
  for (const refused of [1, 2]) {
    const f = await nativeFixture();
    const bookings = new PostgresBookingRepository(database.db);
    const slots = (
      await database.db.execute<{ id: string }>(
        sql`select s.id from slots s join expert_services e on e.id=s.expert_service_id join resident_native_slots n on n.slot_id=s.id where e.expert_id=${f.expertId}::uuid and e.duration_minutes=60 and n.withdrawn_at is null order by s.starts_at`,
      )
    ).rows;
    expect(slots.length).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < refused + 4; index++) {
      const userId = await database.createUser();
      const held = await bookings.reserve({
        userId,
        slotId: slots[index < refused ? 0 : index - refused]!.id,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        now: new Date(),
        minimumLeadMs: 86400000,
        confirmationBufferMs: 900000,
      });
      if (held.kind !== "reserved") throw Error("quality_actual_hold_missing");
      const action = index < refused ? "expert_cancel" : "expert_confirm";
      await bookings.transition({
        reservationId: held.reservationId,
        expectedVersion: held.version,
        action,
        actor: { type: "expert", id: f.expertId },
        now: new Date(),
        correlationId: randomUUID(),
      });
    }
    await lifecycle().processBatch(50);
    const row = (
      await database.db.execute<{
        numerator: number;
        denominator: number;
        status: string;
        id: string;
      }>(
        sql`select id,numerator,denominator,status from resident_lifecycle_cases where user_id=${f.userId}::uuid and kind='quality_window'`,
      )
    ).rows[0]!;
    expect(row).toMatchObject({
      numerator: refused,
      denominator: refused + 4,
      status: refused === 1 ? "no_action" : "open",
    });
    await database.db.execute(
      sql`update resident_lifecycle_subjects set last_scanned_at='-infinity' where user_id=${f.userId}::uuid`,
    );
    await lifecycle().processBatch(50);
    expect(
      (
        await database.db.execute(
          sql`select id from resident_lifecycle_cases where user_id=${f.userId}::uuid and kind='quality_window'`,
        )
      ).rows,
    ).toEqual([{ id: row.id }]);
  }
}, 60000);

it("actual waitlist join, promotion and client receipt count once; missing provenance remains explicit and receipt cannot be rewritten", async () => {
  const { seedWaitlistFixture } = await import("./booking-waitlist.fixture.js");
  const { PostgresBookingRepository } =
    await import("../../packages/db/src/repositories/booking-repository.js");
  const f = await seedWaitlistFixture(database),
    candidate = await f.candidate(randomUUID());
  expect(await f.repository.join(candidate)).toMatchObject({ kind: "joined" });
  await expect(
    database.db.execute(
      sql`update booking_waitlist_command_receipts set request_hash=${"sha256:" + "f".repeat(64)} where idempotency_key=${candidate.idempotencyKey}`,
    ),
  ).rejects.toThrow();
  await database.db.execute(
    sql`update reservations set status='cancelled_by_client' where id=${f.occupied.reservationId}::uuid`,
  );
  const promoted = await f.repository.promoteNext({
    slotId: f.occupied.slotId,
    now: f.occupied.databaseNow,
    holdDurationMs: 259200000,
  });
  if (promoted.kind !== "promoted")
    throw Error("actual_waitlist_promotion_missing");
  const expert = (
    await database.db.execute<{ id: string; userId: string }>(
      sql`select e.id,e.user_id as "userId" from experts e join reservations r on r.expert_id=e.id where r.id=${promoted.reservationId}::uuid`,
    )
  ).rows[0]!;
  const row = (
    await database.db.execute<{ version: number }>(
      sql`select version from reservations where id=${promoted.reservationId}::uuid`,
    )
  ).rows[0]!;
  await new PostgresBookingRepository(database.db).transition({
    reservationId: promoted.reservationId,
    expectedVersion: row.version,
    action: "expert_cancel",
    actor: { type: "expert", id: expert.id },
    now: new Date(),
    correlationId: randomUUID(),
  });
  await database.db.execute(
    sql`insert into resident_lifecycle_subjects(user_id,expert_id) values(${expert.userId}::uuid,${expert.id}::uuid)`,
  );
  await lifecycle().processBatch(50);
  expect(
    (
      await database.db.execute(
        sql`select numerator,denominator,missing_provenance,status from resident_lifecycle_cases where user_id=${expert.userId}::uuid and kind='quality_window'`,
      )
    ).rows[0],
  ).toEqual({
    numerator: 1,
    denominator: 1,
    missing_provenance: 1,
    status: "open",
  });
  await database.db.execute(
    sql`delete from booking_waitlist_command_receipts where idempotency_key=${candidate.idempotencyKey}`,
  );
}, 60000);

async function notificationFixture(
  f: Awaited<ReturnType<typeof nativeFixture>>,
) {
  const { PostgresBookingRepository } =
    await import("../../packages/db/src/repositories/booking-repository.js");
  const { PostgresBookingNotificationRepository } =
    await import("../../packages/db/src/repositories/booking-notification-repository.js");
  const { PostgresBookingNotificationCallbackRepository } =
    await import("../../packages/db/src/repositories/booking-notification-callback-repository.js");
  const { createBookingCallbackVault } =
    await import("../../packages/integrations/src/telegram/booking-callback-vault.js");
  const { issueCallback, authenticateCallbackToken } =
    await import("../../packages/integrations/src/telegram/callback-token.js");
  const { createBookingNotificationTransport } =
    await import("../../packages/integrations/src/telegram/booking-notification-transport.js");
  const { createBookingNotificationRunner } =
    await import("../../packages/worker/src/booking-notification-runner.js");
  const { renderBookingNotification } =
    await import("../../packages/worker/src/booking-notification-renderer.js");
  const botKey = randomUUID(),
    clientId = await database.createUser(),
    secret = Buffer.alloc(32, 91);
  await seedClientConsent(database.db, clientId, "client_messaging");
  await database.db.execute(
    sql`insert into booking_notification_bot_controls(bot_key,admission_enabled) values(${botKey},true)`,
  );
  for (const [id, chat] of [
    [f.userId, "301"],
    [clientId, "401"],
  ])
    await database.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${id!}::uuid,'telegram',${chat!},${chat!},${botKey},'active')`,
    );
  const vault = createBookingCallbackVault({
    activeKeyId: "native-test",
    keys: new Map([["native-test", Buffer.alloc(32, 92)]]),
  });
  const ledger = new PostgresBookingNotificationRepository(
    database.db,
    botKey,
    {
      render: renderBookingNotification,
      open: vault.open,
      authenticateToken: (token) => authenticateCallbackToken(token, secret),
    },
  );
  const callbacks = new PostgresBookingNotificationCallbackRepository(
    database.db,
    botKey,
    {
      ...vault,
      issue: async (claims) => {
        let tokenHash = "";
        const token = await issueCallback(claims, secret, {
          put: async (hash) => {
            tokenHash = hash;
          },
          peek: async () => null,
          consumeIfValid: async () => null,
        });
        return { token, tokenHash };
      },
    },
  );
  const bodies: string[] = [];
  const transport = createBookingNotificationTransport({
    botKey,
    token: `12345:${"a".repeat(35)}`,
    fetch: async (_url, init) => {
      const body = String(init?.body);
      bodies.push(body);
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 500 + bodies.length,
            from: { id: 12345, is_bot: true },
            chat: { id: Number(JSON.parse(body).chat_id), type: "private" },
          },
        }),
        { status: 200 },
      );
    },
  });
  const bookings = new PostgresBookingRepository(database.db, {
    notificationOrigin: {
      botKey,
      messagingPolicyVersion: "client-messaging-v1",
    },
  });
  const runner = createBookingNotificationRunner({
    workerId: "native-proof",
    sendEnabled: true,
    callbacks,
    transport,
    repository: {
      capturePending: (limit) => ledger.capturePending(limit),
      recoverExpired: (limit) => ledger.recoverExpired(limit),
      claimDeliveries: (limit, id) => ledger.claimDeliveries(limit, id),
      admitPrepared: (claim) => ledger.admitPrepared(claim),
      resolveReceipt: (id, receipt) => ledger.resolveReceipt(id, receipt),
      recordOutcome: (id, outcome) =>
        ledger.recordOutcome(
          id,
          outcome as Parameters<typeof ledger.recordOutcome>[1],
        ),
    },
  });
  return {
    botKey,
    clientId,
    bookings,
    ledger,
    callbacks,
    runner,
    transport,
    bodies,
    authenticate: (t: string) => authenticateCallbackToken(t, secret),
  };
}

it("normal API consent/form/manager → fixed fee → rich card/materials → main → native booking/logistics → prepaid renewal/pause/return", async () => {
  const f = await nativeFixture({
      prepared: await normalFormOnboarding(),
      hybrid: true,
    }),
    n = await notificationFixture(f);
  const { PostgresCatalogRepository } =
    await import("../../packages/db/src/repositories/catalog-repository.js");
  const { PostgresClientCatalogRepository } =
    await import("../../packages/db/src/repositories/client-catalog-repository.js");
  const { createClientCatalogSourceReader, createClientCatalogOutboxRegistry } =
    await import("../../apps/worker/src/client-catalog-outbox.js");
  const catalog = new PostgresCatalogRepository(database.db),
    requests = new PostgresClientCatalogRepository(database.db);
  const ownServices = (
    await database.db.execute<{ id: string; code: string; duration: number }>(
      sql`select id,code,duration_minutes as duration from expert_services where expert_id=${f.expertId}::uuid order by duration_minutes`,
    )
  ).rows;
  expect(ownServices.map((s) => s.duration)).toEqual([60, 90]);
  const own = ownServices[0]!;
  const shown = [];
  for (const service of ownServices)
    shown.push(
      ...(await catalog.listPublicServices({
        serviceCode: service.code,
        limit: 20,
      })),
    );
  expect(shown.map((s) => s.serviceTitle)).toEqual([
    "Консультация",
    "Разбор задач",
  ]);
  // A future source-reader clock proves native validity survives the provider TTL without fake observations.
  const later = await catalog.read({
    sourceKey: own.id,
    databaseNow: new Date(Date.now() + 20 * 60000),
  });
  expect(later.kind).toBe("complete");
  if (later.kind === "complete")
    expect(
      later.slots.every((s) => s.observedAt === null && s.nativeValidUntil),
    ).toBe(true);
  const request = await requests.createOrReplay({
    userId: n.clientId,
    requestDigest: hash(randomUUID()),
    correlationId: randomUUID(),
    serviceCode: own.code,
    version: 2,
  });
  const registry = createClientCatalogOutboxRegistry({
    requests,
    source: createClientCatalogSourceReader(catalog, catalog, {}),
    local: {
      topics: ["safety.operator_escalation", "admin.negative_feedback"],
      dispatch: async () => ({ kind: "applied" }),
      reconcile: async () => ({ kind: "applied" }),
    },
  });
  const outbox = (
    await database.db.execute<{ id: string; topic: string; payload: unknown }>(
      sql`select id,topic,payload from integration_outbox where idempotency_key=${"client-catalog:" + request.catalogRequestId}`,
    )
  ).rows[0]!;
  expect(await registry.dispatch(outbox)).toEqual({ kind: "applied" });
  const publicSnapshot = await requests.getOwned({
    userId: n.clientId,
    catalogRequestId: request.catalogRequestId,
  });
  expect(JSON.stringify(publicSnapshot)).toContain("Консультация");
  expect(JSON.stringify(publicSnapshot)).not.toContain("example.com/room");
  const otherRequest = await requests.createOrReplay({
    userId: n.clientId,
    requestDigest: hash(randomUUID()),
    correlationId: randomUUID(),
    serviceCode: ownServices[1]!.code,
    version: 2,
  });
  const otherOutbox = (
    await database.db.execute<{ id: string; topic: string; payload: unknown }>(
      sql`select id,topic,payload from integration_outbox where idempotency_key=${"client-catalog:" + otherRequest.catalogRequestId}`,
    )
  ).rows[0]!;
  expect(await registry.dispatch(otherOutbox)).toEqual({ kind: "applied" });
  const otherSnapshot = await requests.getOwned({
    userId: n.clientId,
    catalogRequestId: otherRequest.catalogRequestId,
  });
  expect(JSON.stringify(otherSnapshot)).toContain("Разбор задач");
  if (publicSnapshot?.state !== "ready" || otherSnapshot?.state !== "ready")
    throw Error("choice_snapshot_missing");

  const choice = (
    await database.db.execute<{ digest: `sha256:${string}` }>(
      sql`select choice_digest as digest from client_catalog_choices where request_id=${request.catalogRequestId}::uuid order by slot_id limit 1`,
    )
  ).rows[0]!;
  const handle = `bk1.${"a".repeat(43)}` as const;
  const held = await n.bookings.reserveProtectedChoice({
    userId: n.clientId,
    choiceDigest: choice.digest,
    idempotencyKey: hash(randomUUID()),
    bookingHandle: handle,
    correlationId: randomUUID(),
    minimumLeadMs: 86400000,
    slotFreshnessMs: 900000,
    confirmationBufferMs: 900000,
  });
  expect(held.kind).toBe("reserved");
  const reservation = (
    await database.db.execute<{ id: string }>(
      sql`select reservation_id as id from client_booking_receipts where booking_handle=${handle}`,
    )
  ).rows[0]!;
  expect(await n.runner.runOnce()).toMatchObject({
    sent: 1,
    pendingCompletion: false,
  });
  const delivery = (
    await database.db.execute<{ id: string }>(
      sql`select id from booking_notification_deliveries where reservation_id=${reservation.id}::uuid and kind='telegram.reservation_request'`,
    )
  ).rows[0]!;
  const wire = JSON.parse(n.bodies[0]!);
  const token = wire.reply_markup.inline_keyboard
    .flat()
    .find((b: { text: string }) =>
      b.text.includes("Подтвердить"),
    ).callback_data;
  const command = {
    tokenHash: n.authenticate(token),
    reservationId: reservation.id,
    expertId: f.expertId,
    action: "confirm" as const,
    version: 1,
    now: new Date("2000-01-01"),
    correlationId: randomUUID(),
    telegramContext: {
      botKey: n.botKey,
      telegramUserId: "301",
      chatId: "301",
      messageId: 501,
      deliveryId: delivery.id,
    },
  };
  expect(
    await n.bookings.transitionFromTelegramCallback(command),
  ).toMatchObject({ status: "booked", version: 2 });
  expect(
    await n.bookings.transitionFromTelegramCallback(command),
  ).toMatchObject({ status: "booked", version: 2 });
  expect(await n.runner.runOnce()).toMatchObject({
    sent: 1,
    pendingCompletion: false,
  });
  expect(JSON.parse(n.bodies[1]!).text).toContain("подтвержд");
  expect(n.bodies[1]).not.toContain("example.com/room");
  expect(
    await n.bookings.listOwnedActive({ userId: n.clientId }),
  ).toMatchObject({ kind: "found", bookings: [{ state: "booked" }] });
  expect(
    (
      await database.db.execute(
        sql`select id from planerka_booking_operations where reservation_id=${reservation.id}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  const beforeRevision = await f.revision();
  await f.send("/slots_setup");
  for (const a of [
    "2",
    f.date + " " + f.date,
    "1 2 3 4 5 6 7",
    "09:00-16:00",
    "нет",
    "20",
  ])
    await f.send("/slots_answer " + a);
  let page = await f.send("/slots_preview");
  expect(page).toContain("Сохранена");
  while (page.split("\n").at(-1)!.startsWith("/slots_page"))
    page = await f.send(page.split("\n").at(-1)!);
  expect(await f.send(page.split("\n").at(-1)!)).toContain("обновлено");
  expect(await f.revision()).toBe(beforeRevision);
  expect(
    await n.bookings.listOwnedActive({ userId: n.clientId }),
  ).toMatchObject({ bookings: [{ state: "booked" }] });

  const { PostgresResidentNativeLogistics } =
    await import("../../packages/db/src/repositories/resident-native-logistics.js");
  const logistics = new PostgresResidentNativeLogistics(
    database.db,
    n.botKey,
    n.transport,
  );
  expect(await logistics.runOnce()).toBe(1);
  expect(n.bodies.at(-1)).toContain("Примерная");
  expect(n.bodies.at(-1)).not.toContain("example.com/room");
  const config = {
    features: { expertCard: true },
    expertCard: {
      paymentMode: "test",
      materialDeliveryEnabled: false,
      mainCheckoutEnabled: false,
      workBotId: workScope.botId,
      workBotKey: workScope.botKey,
      workBotUsername: "synthetic_work_bot",
      workBotToken: workScope.botId + ":" + "a".repeat(35),
      webhookSecret: "synthetic-core-webhook-secret-12345678",
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
    residentLifecycleCompletion: { enabled: true, deliveryEnabled: true },
  } as unknown as RuntimeConfig;
  const wireTexts: string[] = [];
  const completion = createResidentLifecycleCompletionWorker(
    database.db,
    config,
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      wireTexts.push(body.text);
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 101,
            from: { id: Number(workScope.botId), is_bot: true },
            chat: { id: Number(body.chat_id), type: "private" },
          },
        }),
        { status: 200 },
      );
    },
  )!;
  const { createWorkerRuntime } =
    await import("../../apps/worker/src/runtime.js");
  const idle = async () => ({ disabled: true });
  const runtime = createWorkerRuntime({
    residentLifecycleCompletion: completion,
    safetyHandoffs: idle,
    recoverExpiredLeases: idle,
    reconcileUnknownOutcomes: idle,
    reservationExpiry: idle,
    expertResidencyExpiry: idle,
    expertTelegramCheckoutCleanup: idle,
    expertResidencyReconciliation: idle,
    expertReferralHoldReplay: idle,
    deliverConfirmedOutbox: idle,
    processorPrivacy: idle,
    providerReconciliation: idle,
    closeDatabase: async () => {},
    closeTelemetry: async () => {},
  });
  try {
    for (
      let i = 0;
      i < 10 &&
      (await notices(f.userId)).some(
        (r) => r.kind === "first_activation" && r.state !== "delivered",
      );
      i++
    )
      expect(
        (await runtime.runOnce()).residentLifecycleCompletion,
      ).toBeDefined();
  } finally {
    await runtime.close();
  }
  expect(
    (await notices(f.userId)).find((r) => r.kind === "first_activation")!.state,
  ).toBe("delivered");
  expect(
    wireTexts.some((t) => t.includes("Вы стали активным резидентом")),
  ).toBe(true);
  expect(await completion.runOnce()).toMatchObject({
    reason: "closing",
    delivered: 0,
  });
  const { PostgresExpertPersonalOfferRepository } =
    await import("../../packages/db/src/repositories/expert-personal-offer-repository.js");
  expect(
    await new PostgresExpertPersonalOfferRepository(database.db, {
      workBotId: workScope.botId,
      workBotKey: workScope.botKey,
      messagingConsentPolicyVersion: "client-messaging-v1",
    }).read(f.work),
  ).toMatchObject({
    selected_locked_term: 1,
    readiness: "pending_gates",
    payment_url: null,
  });
  const { PostgresExpertResidencyLifecycleRepository } =
    await import("../../packages/db/src/repositories/expert-residency-lifecycle-repository.js");
  const paidLifecycle = new PostgresExpertResidencyLifecycleRepository(
    database.db,
    {
      workBotId: workScope.botId,
      workBotKey: workScope.botKey,
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
  );
  // A separately accepted real prepaid renewal extends the calendar without a second welcome.
  const renewalRevision = await f.revision();
  const renewalQuote = await f.financial.quoteMain({
    ...event(f.work),
    tariffVersionId: tariffId,
    termMonths: 1,
    revision: renewalRevision,
  });
  await f.financial.acceptMain({
    ...event(f.work),
    quoteId: renewalQuote.id,
    revision: renewalRevision,
  });
  const renewal = await f.financial.createMainInvoice({
    ...event(f.work),
    revision: renewalRevision,
  });
  expect(renewal.orderId).not.toBe(f.orderId);
  const { PostgresYooKassaOperationRepository } =
    await import("../../packages/db/src/repositories/yookassa-operation-repository.js");
  const { PostgresExpertResidencyProviderInboxRepository } =
    await import("../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js");
  const { YooKassaPaymentVerifier } = await import("@ii-tonya/integrations");
  const operations = new PostgresYooKassaOperationRepository(database.db);
  const claimed = await operations.claim({
    commandId: randomUUID(),
    orderId: renewal.orderId,
    kind: "create_payment",
    mode: "test",
    amountMinor: renewal.cashMinor,
    currency: "RUB",
    requestDigest: "sha256:" + hash(renewal.orderId),
  });
  const paymentId = "synthetic_" + randomUUID();
  const operation = await operations.bindProviderObject(claimed.id, paymentId);
  const proof = await new YooKassaPaymentVerifier(
    client(providerPayment(paymentId, renewal.orderId, renewal.cashMinor)),
    operations,
  ).verifyPayment(operation);
  if (!proof) throw Error("renewal_proof_missing");
  expect(
    await new PostgresExpertResidencyProviderInboxRepository(
      database.db,
    ).settle(proof),
  ).toMatchObject({ kind: "settled" });
  expect(
    (
      await database.db.execute(
        sql`select b.residency_starts_at=a.residency_ends_at as contiguous,b.residency_ends_at>a.residency_ends_at as extended from expert_residency_orders a join expert_residency_orders b on b.id=${renewal.orderId}::uuid where a.id=${f.orderId}::uuid`,
      )
    ).rows[0],
  ).toEqual({ contiguous: true, extended: true });
  const coverageBefore = (
    await database.db.execute(
      sql`select residency_starts_at,residency_ends_at from expert_residency_orders where id=${f.orderId}::uuid`,
    )
  ).rows[0];
  const returnDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  expect(
    await paidLifecycle.requestPause({ ...event(f.work), returnDate }),
  ).toMatchObject({ status: "paused" });
  expect(
    await catalog.listPublicServices({ serviceCode: own.code, limit: 20 }),
  ).toEqual([]);
  expect(
    await n.bookings.listOwnedActive({ userId: n.clientId }),
  ).toMatchObject({ bookings: [{ state: "booked" }] });
  expect(await paidLifecycle.resume(event(f.work))).toMatchObject({
    status: "active",
  });
  expect(
    await catalog.listPublicServices({ serviceCode: own.code, limit: 20 }),
  ).not.toEqual([]);
  expect(
    (
      await database.db.execute(
        sql`select residency_starts_at,residency_ends_at from expert_residency_orders where id=${f.orderId}::uuid`,
      )
    ).rows[0],
  ).toEqual(coverageBefore);
  expect(
    (await notices(f.userId)).filter((r) => r.kind === "first_activation"),
  ).toHaveLength(1);
  await f.http?.close();
}, 120000);

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
    secret: "synthetic-core-webhook-secret-12345678",
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
      webhookSecret: "synthetic-core-webhook-secret-12345678",
      service: capability?.service ?? service,
      legacyReplay: capability?.legacyReplay ?? { read: async () => "absent" },
      ...(answerTagCallback ? { answerTagCallback } : {}),
    },
  });
  return app;
}
it("main acquisition uses first actual invoice beyond three days and separates provider uncertainty", async () => {
  const f = await nativeFixture({ pendingMain: true });
  await database.db.execute(
    sql.raw("alter table resident_lifecycle_subjects disable trigger user"),
  );
  try {
    await database.db.execute(
      sql`update resident_lifecycle_subjects set first_main_invoice_at=clock_timestamp()-interval '3 days'+interval '1 minute' where first_main_invoice_order_id=${f.orderId}::uuid`,
    );
  } finally {
    await database.db.execute(
      sql.raw("alter table resident_lifecycle_subjects enable trigger user"),
    );
  }
  await lifecycle().processBatch(50);
  expect(
    (await lifecycle().listCases(manager.sessionHash)).filter(
      (c) => c.applicationId === f.applicationId,
    ),
  ).toEqual([]);
  await database.db.execute(
    sql.raw("alter table resident_lifecycle_subjects disable trigger user"),
  );
  try {
    await database.db.execute(
      sql`update resident_lifecycle_subjects set first_main_invoice_at=clock_timestamp()-interval '3 days'-interval '1 minute' where first_main_invoice_order_id=${f.orderId}::uuid`,
    );
  } finally {
    await database.db.execute(
      sql.raw("alter table resident_lifecycle_subjects enable trigger user"),
    );
  }
  await database.db.execute(
    sql`update resident_lifecycle_subjects set last_scanned_at='-infinity' where user_id=${f.userId}::uuid`,
  );
  await lifecycle().processBatch(50);
  const cases = (await lifecycle().listCases(manager.sessionHash)).filter(
    (c) => c.applicationId === f.applicationId,
  );
  expect(cases.map((c) => c.kind)).toEqual(["main_payment_overdue"]);
  expect(cases[0]!.sourceId).toBe(f.orderId);
  const op = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_residency_provider_operations where order_id=${f.orderId}::uuid and operation_kind='create_payment'`,
    )
  ).rows[0]!;
  const { PostgresYooKassaOperationRepository } =
    await import("../../packages/db/src/repositories/yookassa-operation-repository.js");
  await new PostgresYooKassaOperationRepository(database.db).markUnknown(op.id);
  await database.db.execute(
    sql`update resident_lifecycle_subjects set last_scanned_at='-infinity' where user_id=${f.userId}::uuid`,
  );
  await lifecycle().processBatch(50);
  const unresolved = (await lifecycle().listCases(manager.sessionHash)).filter(
    (c) => c.applicationId === f.applicationId,
  );
  expect(unresolved.map((c) => c.kind)).toEqual(["payment_reconciliation"]);
  expect(unresolved[0]!.dueAt).toBe(cases[0]!.dueAt);
}, 60000);

it("privacy withdrawal blocks queued disclosures and physical erasure removes notices, attempts and cases", async () => {
  const f = await secondRichFixture();
  await f.approve();
  const row = (await notices(f.userId))[0]!;
  const privacy = new PostgresPrivacyRepository(database.db, {
    privacyMutationCapability: {
      enabled: true,
      captureManifests: async () =>
        ["object_store", "selarti", "planerka", "make_projection"].map(
          (processor) => ({
            processor: processor as
              "object_store" | "selarti" | "planerka" | "make_projection",
            ciphertext: "ciphertext:" + processor,
            keyReference: "fixture:" + processor,
            algorithm: "test-envelope-v1",
            version: "1",
            subjectDeletionKeyHash: "sha256:" + processor,
          }),
        ),
      verifyEnvelope: () => true,
    },
  });
  await privacy.withdrawConsentAtomically({
    targetUserId: f.userId,
    purpose: "client_messaging",
    policyVersion: "client-messaging-v1",
    correlationId: randomUUID(),
  });
  let calls = 0;
  expect(
    await lifecycle(async (input) => {
      calls++;
      return receipt(input);
    }).deliverNotice(row.id),
  ).toBe("deferred_or_terminal");
  expect(calls).toBe(0);
  await privacy.startErasureAtomically({
    targetUserId: f.userId,
    correlationId: randomUUID(),
    idempotencyKey: randomUUID(),
    pseudonym: "hmac:synthetic-lifecycle-erasure",
  });
  expect(await notices(f.userId)).toEqual([]);
  expect(
    (
      await database.db.execute(
        sql`select user_id from resident_lifecycle_subjects where user_id=${f.userId}::uuid`,
      )
    ).rows,
  ).toEqual([]);
}, 60000);
