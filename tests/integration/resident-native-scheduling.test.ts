import {
  createExpertCardComposition,
  type ExpertCardCapability,
} from "../../apps/api/src/expert-card-composition.js";
import type { RuntimeConfig } from "../../packages/config/src/index.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { createRequire } from "node:module";
import { telegramWebhookRoutes } from "../../apps/api/src/routes/telegram-webhook.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, it, expect, vi } from "vitest";
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

// Browser replay is an explicit local evidence export, never a prerequisite for tests.
async function exportBrowserFixture(
  name: string,
  body: unknown,
): Promise<void> {
  const directory = process.env.II_TONYA_NATIVE_BROWSER_FIXTURE_DIR;
  if (!directory) return;
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), JSON.stringify(body));
}

const promoScope = { botId: "717171", botKey: "core-promo" };
const workScope = { botId: "818181", botKey: "core-work" };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
let database: ExpertReferralTestDatabase;
let verification: PostgresExpertVerificationRepository;
let promo: PostgresExpertPromoRepository;
let manager: { sessionHash: string; token: string };
let tariffId: string;
let historical: { slotId: string; row: unknown };
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

async function paid() {
  const f = await onboarding();
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
async function linked(richOnboarding = true) {
  const f = await paid();
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
beforeAll(async () => {
  database = await startExpertReferralTestDatabase(async (db) => {
    const { readFileSync } = await import("node:fs");
    const journal = JSON.parse(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    );
    for (const entry of journal.entries.filter(
      (e: { idx: number }) => e.idx < 70,
    ))
      await db.execute(
        sql.raw(
          readFileSync("packages/db/migrations/" + entry.tag + ".sql", "utf8"),
        ),
      );
    const user = (
      await db.execute<{ id: string }>(
        sql`insert into users default values returning id`,
      )
    ).rows[0]!;
    const expert = (
      await db.execute<{ id: string }>(
        sql`insert into experts(user_id,active,verified) values(${user.id}::uuid,true,true) returning id`,
      )
    ).rows[0]!;
    const service = (
      await db.execute<{ id: string }>(
        sql`insert into expert_services(expert_id,name,code,language,duration_minutes,active) values(${expert.id}::uuid,'Историческая услуга','legacy-native-upgrade','ru',60,true) returning id`,
      )
    ).rows[0]!;
    const slot = (
      await db.execute<{ id: string }>(
        sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity) values(${service.id}::uuid,'planerka','populated-native-upgrade',clock_timestamp()+interval '4 days',clock_timestamp()+interval '4 days 1 hour',clock_timestamp(),1) returning id`,
      )
    ).rows[0]!;
    const before = (
      await db.execute(
        sql`select to_jsonb(s) as slot,to_jsonb(es) as service from slots s join expert_services es on es.id=s.expert_service_id where s.id=${slot.id}::uuid`,
      )
    ).rows[0];
    historical = { slotId: slot.id, row: before };
    // Nullable projection columns allow the current reader to seed an approval
    // under unchanged 0069 source guards before native authority/backfill exists.
    const migration = readFileSync(
      "packages/db/migrations/0070_resident_native_scheduling.sql",
      "utf8",
    ).split("--> statement-breakpoint");
    await db.execute(sql.raw(migration.slice(0, 2).join(";")));
  });
  await database.enableExpertReferralCommands();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0]
      ?.server_version_num,
  ).toBe("170005");
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
  const legacy = await secondRichFixture();
  const approved = await legacy.approve();
  const before = (
    await database.db.execute(
      sql`select to_jsonb(v) as value from resident_card_versions v where review_id=${approved.reviewId!}::uuid`,
    )
  ).rows[0];
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync(
    "packages/db/migrations/0070_resident_native_scheduling.sql",
    "utf8",
  ).split("--> statement-breakpoint");
  await database.db.execute(sql.raw(migration.slice(2).join(";")));
  expect(
    (
      await database.db.execute(
        sql`select to_jsonb(v) as value from resident_card_versions v where review_id=${approved.reviewId!}::uuid`,
      )
    ).rows[0],
  ).toEqual(before);
  expect(
    (
      await database.db.execute(
        sql`select title,duration_minutes from resident_service_versions where review_id=${approved.reviewId!}::uuid`,
      )
    ).rows,
  ).toEqual([{ title: "Консультация", duration_minutes: 60 }]);
  expect(
    (
      await database.db.execute(
        sql`select to_jsonb(s) as slot,to_jsonb(es) as service from slots s join expert_services es on es.id=s.expert_service_id where s.id=${historical.slotId}::uuid`,
      )
    ).rows[0],
  ).toEqual(historical.row);
  expect(
    (
      await database.db.execute(
        sql`select resident_slot_fresh(${historical.slotId}::uuid,clock_timestamp()) as fresh`,
      )
    ).rows[0]?.fresh,
  ).toBe(true);
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);
it("paid owner can prepare private schedule through ordinary commands without prior approval", async () => {
  const f = await linked();
  const service = createExpertCardService({
    enabled: true,
    paymentMode: "test",
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
    workBotUsername: "synthetic_work_bot",
    repository: f.card,
    financial: new PostgresExpertOnboardingMainPaymentRepository(database.db, {
      messagingConsentPolicyVersion: "client-messaging-v1",
      providerMode: "test",
    }),
  });
  const result = await service.handleWork({
    ...f.work,
    updateId: String(++sequence),
    requestDigest: hash(String(sequence)),
    content: { kind: "text", text: "/slots_setup" },
  });
  expect(JSON.stringify(result)).toContain("Москва");
});
it("native schedule schema preserves existing provider transition and adds real source authority", async () => {
  const tables = await database.db.execute(
    sql`select to_regclass('resident_schedule_previews') as preview,to_regclass('resident_native_confirmations') as confirmations`,
  );
  expect(tables.rows[0]).toMatchObject({
    preview: "resident_schedule_previews",
    confirmations: "resident_native_confirmations",
  });
});

async function secondRichFixture(tag = "#тревожность") {
  const f = await linked();
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
it("initial owner schedule joins exact full card review and maps approved services privately", async () => {
  const f = await secondRichFixture();
  const send = async (text: string) =>
    (await f.repo.scheduleAction({ ...event(f.work), text })).pageText;
  expect(await send("/slots_setup")).toContain("Москва");
  for (const answer of [
    "2",
    "2026-11-10 2026-11-10",
    "2",
    "09:00-13:00",
    "нет",
    "15",
  ])
    await send("/slots_answer " + answer);
  let page = await send("/slots_preview");
  expect(page).toContain("Консультация");
  while (page.split("\n").at(-1)!.startsWith("/slots_page"))
    page = await send(page.split("\n").at(-1)!);
  expect(await send(page.split("\n").at(-1)!)).toContain("приватно");
  const approved = await f.approve();
  const state = (
    await database.db.execute(
      sql`select v.initial_schedule,(select count(*)::int from resident_native_slots) as slots from resident_card_versions v where v.review_id=${approved.reviewId!}::uuid`,
    )
  ).rows[0]!;
  expect(state.initial_schedule).toBeTruthy();
  expect(state.slots).toBeGreaterThan(0);
  expect(
    (
      await database.db.execute(
        sql`select resident_native_admission(e.id) as allowed from experts e where e.user_id=${f.userId}::uuid`,
      )
    ).rows[0]?.allowed,
  ).toBe(false);
});

async function nativeFixture(
  options: {
    near?: boolean;
    hybrid?: boolean;
    richId?: ReturnType<typeof randomUUID>;
  } = {},
) {
  const f = await secondRichFixture();
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
  const send = async (text: string) =>
    (await f.repo.scheduleAction({ ...event(f.work), text })).pageText;
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
  const proof = await new YooKassaPaymentVerifier(
    client(providerPayment(paymentId, order.orderId, order.cashMinor)),
    operations,
  ).verifyPayment(operation);
  if (!proof) throw Error("synthetic_main_proof_missing");
  expect(
    await new PostgresExpertResidencyProviderInboxRepository(
      database.db,
    ).settle(proof),
  ).toMatchObject({ kind: "settled" });
  const expert = (
    await database.db.execute<{ id: string }>(
      sql`select id from experts where user_id=${f.userId}::uuid`,
    )
  ).rows[0]!;
  return { ...f, expertId: expert.id, send, date, orderId: order.orderId };
}
it("native approved services are publicly discovered with titles and actually reserve and confirm without Planerka", async () => {
  const f = await nativeFixture(),
    n = await notificationFixture(f),
    booked = await bookFirst(f, n);
  expect(
    (
      await database.db.execute(
        sql`select id from planerka_booking_operations where reservation_id=${booked.reservationId}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await database.db.execute(
        sql`select snapshot from resident_native_confirmations where reservation_id=${booked.reservationId}::uuid`,
      )
    ).rows[0]?.snapshot,
  ).toMatchObject({
    title: "Консультация",
    durationMinutes: 60,
    bufferMinutes: 15,
    logistics: { room: "https://example.com/room" },
  });
});
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
it("real native catalog request → protected choice → callback replay → ordinary worker and client read", async () => {
  const f = await nativeFixture(),
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
  await exportBrowserFixture("booking-api-fixture.json", {
    cards: [...publicSnapshot.cards, ...otherSnapshot.cards],
  });

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
  await database.db.execute(
    sql`update experts set active=false where id=${f.expertId}::uuid`,
  );
  expect(
    await catalog.listPublicServices({ serviceCode: own.code, limit: 20 }),
  ).toEqual([]);
  expect(
    await n.bookings.listOwnedActive({ userId: n.clientId }),
  ).toMatchObject({ bookings: [{ state: "booked" }] });
  expect(
    await n.bookings.cancelOwnedByHandle({
      userId: n.clientId,
      bookingHandle: handle,
      correlationId: randomUUID(),
    }),
  ).toMatchObject({ kind: "cancelled", providerCancellationPending: false });
  expect(await n.runner.runOnce()).toMatchObject({ sent: 1 });
  expect(n.bodies.at(-1)).not.toContain("календар");
}, 60000);

async function bookFirst(
  f: Awaited<ReturnType<typeof nativeFixture>>,
  n: Awaited<ReturnType<typeof notificationFixture>>,
  near = false,
) {
  const selected = (
    await database.db.execute<{ id: string }>(
      sql`select s.id from slots s join expert_services es on es.id=s.expert_service_id join resident_native_slots ns on ns.slot_id=s.id where es.expert_id=${f.expertId}::uuid and ns.withdrawn_at is null order by s.starts_at,es.duration_minutes limit 1`,
    )
  ).rows[0]!;
  const held = await n.bookings.reserve({
    userId: n.clientId,
    slotId: selected.id,
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    now: new Date(),
    minimumLeadMs: near ? 0 : 86400000,
    confirmationBufferMs: near ? 60000 : 900000,
  });
  if (held.kind !== "reserved") throw Error("native_fixture_hold_missing");
  const confirmed = await n.bookings.transition({
    reservationId: held.reservationId,
    expectedVersion: held.version,
    action: "expert_confirm",
    actor: { type: "expert", id: f.expertId },
    now: new Date(),
    correlationId: randomUUID(),
  });
  expect(confirmed.status).toBe("booked");
  return { ...held, slotId: selected.id };
}
it("dedicated automatic logistics respects online window, immutable snapshot, pause, dedup and unknown receipt recovery", async () => {
  const { PostgresResidentNativeLogistics } =
    await import("../../packages/db/src/repositories/resident-native-logistics.js");
  const future = await nativeFixture({ hybrid: true }),
    futureNotify = await notificationFixture(future),
    futureBooking = await bookFirst(future, futureNotify);
  const futureDelivery = new PostgresResidentNativeLogistics(
    database.db,
    futureNotify.botKey,
    futureNotify.transport,
  );
  expect(await futureDelivery.runOnce()).toBe(1);
  expect(futureNotify.bodies).toHaveLength(1);
  expect(futureNotify.bodies[0]).toContain("Примерная");
  expect(futureNotify.bodies[0]).not.toContain("example.com/room");
  expect(
    (
      await database.db.execute(
        sql`select kind,state from resident_native_logistics where reservation_id=${futureBooking.reservationId}::uuid order by kind`,
      )
    ).rows,
  ).toEqual([
    { kind: "offline", state: "delivered" },
    { kind: "online", state: "pending" },
  ]);
  // Synthetic near-time fixture exercises due delivery without changing the production 24-hour choice lead.
  const f = await nativeFixture({ near: true }),
    n = await notificationFixture(f),
    booked = await bookFirst(f, n, true);
  await f.repo.richAction({
    ...event(f.work),
    expectedRevision: await f.revision(),
    action: "patch",
    value: { staticRoomLink: "https://example.com/replacement" },
  });
  await database.db.execute(
    sql`update experts set active=false where id=${f.expertId}::uuid`,
  );
  const delivery = new PostgresResidentNativeLogistics(
    database.db,
    n.botKey,
    n.transport,
  );
  expect(await delivery.runOnce()).toBe(1);
  expect(n.bodies).toHaveLength(1);
  expect(n.bodies[0]).toContain("https://example.com/room");
  expect(n.bodies[0]).not.toContain("replacement");
  expect(await delivery.runOnce()).toBe(0);
  await expect(
    database.db.execute(
      sql`update resident_native_confirmations set snapshot=jsonb_set(snapshot,'{logistics,room}','"https://example.com/forged"') where reservation_id=${booked.reservationId}::uuid`,
    ),
  ).rejects.toThrow();
  const unknownF = await nativeFixture({ near: true }),
    unknownN = await notificationFixture(unknownF),
    unknownB = await bookFirst(unknownF, unknownN, true);
  let calls = 0;
  const unknown = new PostgresResidentNativeLogistics(
    database.db,
    unknownN.botKey,
    {
      send: async () => {
        calls++;
        return { kind: "unknown", reasonCode: "delivery_uncertain" };
      },
    },
  );
  expect(await unknown.runOnce()).toBe(0);
  expect(await unknown.runOnce()).toBe(0);
  expect(calls).toBe(1);
  const attempt = (
    await database.db.execute<{ id: string; state: string }>(
      sql`select attempt_id as id,state from resident_native_logistics where reservation_id=${unknownB.reservationId}::uuid`,
    )
  ).rows[0]!;
  expect(attempt.state).toBe("unknown");
  expect(
    await unknown.resolveReceipt(attempt.id, {
      botKey: unknownN.botKey,
      chatId: "wrong",
      messageId: 900,
    }),
  ).toBe(false);
  expect(
    await unknown.resolveReceipt(attempt.id, {
      botKey: unknownN.botKey,
      chatId: "401",
      messageId: 900,
    }),
  ).toBe(true);
  expect(await unknown.runOnce()).toBe(0);
  expect(calls).toBe(1);
}, 60000);

it("mixed native/external race shares buffered capacity and stale external remains denied", async () => {
  const f = await nativeFixture(),
    n = await notificationFixture(f);
  const slot = (
    await database.db.execute<{
      id: string;
      service: string;
      starts: Date;
      ends: Date;
    }>(
      sql`select s.id,s.expert_service_id as service,s.starts_at as starts,s.ends_at as ends from slots s join expert_services es on es.id=s.expert_service_id where es.expert_id=${f.expertId}::uuid order by s.starts_at,es.duration_minutes limit 1`,
    )
  ).rows[0]!;
  const external = (
    await database.db.execute<{ id: string }>(
      sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity) values(${slot.service}::uuid,'planerka',${randomUUID()},${slot.ends}::timestamptz+interval '5 minutes',${slot.ends}::timestamptz+interval '65 minutes',clock_timestamp(),1) returning id`,
    )
  ).rows[0]!;
  const second = await database.createUser();
  const reserve = (userId: string, slotId: string) =>
    n.bookings.reserve({
      userId,
      slotId,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      now: new Date(),
      minimumLeadMs: 86400000,
      confirmationBufferMs: 900000,
    });
  const results = await Promise.all([
    reserve(n.clientId, slot.id),
    reserve(second, external.id),
  ]);
  expect(results.filter((r) => r.kind === "reserved")).toHaveLength(1);
  expect(results.filter((r) => r.kind === "unavailable")).toHaveLength(1);
  const winner = results.find((r) => r.kind === "reserved")!;
  if (winner.kind !== "reserved") throw Error("missing_race_winner");
  const before = (
    await database.db.execute(
      sql`select slot_id,status,reserved_until,version from reservations where id=${winner.reservationId}::uuid`,
    )
  ).rows[0];
  const busy = await f.send("/slots_busy " + f.date + " 09:00-12:00");
  expect(busy).toContain("1");
  expect(busy).toContain("сохранены");
  expect(
    (
      await database.db.execute(
        sql`select slot_id,status,reserved_until,version from reservations where id=${winner.reservationId}::uuid`,
      )
    ).rows[0],
  ).toEqual(before);
  const blocked = await reserve(await database.createUser(), external.id);
  expect(blocked.kind).toBe("unavailable");
  await database.db.execute(
    sql`update slots set observed_at=clock_timestamp()-interval '16 minutes' where id=${external.id}::uuid`,
  );
  expect(
    (
      await database.db.execute(
        sql`select resident_slot_fresh(${external.id}::uuid,clock_timestamp()) as fresh`,
      )
    ).rows[0]?.fresh,
  ).toBe(false);
  await expect(
    database.db.execute(
      sql`update reservations set status='booked',version=version+1 where id=${winner.reservationId}::uuid`,
    ),
  ).rejects.toThrow();
}, 60000);
it("R3 owner-scoped stable service versions preserve candidate and callback detail through replacement and expiry", async () => {
  const richId = randomUUID(),
    f = await nativeFixture({ richId }),
    n = await notificationFixture(f),
    booked = await bookFirst(f, n);
  const original = (
    await database.db.execute<{ id: string }>(
      sql`select expert_service_id as id from resident_service_mappings m join expert_card_drafts d on d.id=m.draft_id where d.user_id=${f.userId}::uuid and rich_service_id=${richId}::uuid`,
    )
  ).rows[0]!;
  const heldSlot = (
    await database.db.execute<{ id: string }>(
      sql`select s.id from slots s join resident_native_slots ns on ns.slot_id=s.id where s.expert_service_id=${original.id}::uuid and s.starts_at>=(select occupied_until from resident_native_slots where slot_id=${booked.slotId}::uuid) order by s.starts_at limit 1`,
    )
  ).rows[0]!;
  const held = await n.bookings.reserve({
    userId: await database.createUser(),
    slotId: heldSlot.id,
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    now: new Date(),
    minimumLeadMs: 86400000,
    confirmationBufferMs: 900000,
  });
  if (held.kind !== "reserved") throw Error("missing_preserved_native_hold");
  const other = await nativeFixture({ richId });
  const otherMap = (
    await database.db.execute<{ id: string }>(
      sql`select expert_service_id as id from resident_service_mappings m join expert_card_drafts d on d.id=m.draft_id where d.user_id=${other.userId}::uuid and rich_service_id=${richId}::uuid`,
    )
  ).rows[0]!;
  expect(otherMap.id).not.toBe(original.id);
  await expect(
    database.db.execute(
      sql`update resident_service_mappings set expert_service_id=${otherMap.id}::uuid where expert_service_id=${original.id}::uuid`,
    ),
  ).rejects.toThrow();
  await f.repo.richAction({
    ...event(f.work),
    expectedRevision: await f.revision(),
    action: "service",
    value: { ...f.service, title: "Новая консультация", durationMinutes: 75 },
  });
  await f.repo.richAction({
    ...event(f.work),
    expectedRevision: await f.revision(),
    action: "patch",
    value: { staticRoomLink: "https://example.com/new-approved" },
  });
  expect(
    (
      await database.db.execute(
        sql`select resident_native_admission(${f.expertId}::uuid) as allowed`,
      )
    ).rows[0]?.allowed,
  ).toBe(true);
  await f.send("/slots_card");
  for (const a of [
    "2",
    f.date + " " + f.date,
    "1 2 3 4 5 6 7",
    "09:00-16:00",
    "нет",
    "15",
  ])
    await f.send("/slots_answer " + a);
  let page = await f.send("/slots_preview");
  while (page.split("\n").at(-1)!.startsWith("/slots_page"))
    page = await f.send(page.split("\n").at(-1)!);
  expect(await f.send(page.split("\n").at(-1)!)).toContain("приватно");
  await f.approve();
  expect(
    (
      await database.db.execute(
        sql`select id,duration_minutes from expert_services where id=${original.id}::uuid`,
      )
    ).rows[0],
  ).toMatchObject({ id: original.id, duration_minutes: 75 });
  expect(
    (
      await database.db.execute(
        sql`select snapshot from resident_native_confirmations where reservation_id=${booked.reservationId}::uuid`,
      )
    ).rows[0]?.snapshot,
  ).toMatchObject({
    title: "Консультация",
    durationMinutes: 60,
    logistics: { room: "https://example.com/room" },
  });
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from resident_native_slots n join slots s on s.id=n.slot_id where s.expert_service_id=${original.id}::uuid and n.withdrawn_at is null and s.ends_at-s.starts_at=interval '75 minutes'`,
      )
    ).rows[0]?.n,
  ).toBeGreaterThan(0);
  await expect(
    database.db.execute(
      sql`update resident_native_slots set withdrawn_at=clock_timestamp() where slot_id=${booked.slotId}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    database.db.execute(
      sql`update reservations set user_id=${other.userId}::uuid where id=${booked.reservationId}::uuid`,
    ),
  ).rejects.toThrow();
  // Synthetic historical shift keeps the exact 30-day paid term while proving immediate expiry before projection reconciliation.
  await database.db.execute(
    sql`update expert_residency_orders set settled_at=settled_at-interval '31 days',residency_starts_at=residency_starts_at-interval '31 days',residency_ends_at=residency_ends_at-interval '31 days' where id=${f.orderId}::uuid`,
  );
  expect(
    (
      await database.db.execute(
        sql`select resident_native_admission(${f.expertId}::uuid) as allowed,resident_native_obligation(${f.expertId}::uuid) as obligation`,
      )
    ).rows[0],
  ).toEqual({ allowed: false, obligation: true });
  const { PostgresExpertTelegramQueryRepository: QueryRepository } =
    await import("../../packages/db/src/repositories/expert-telegram-query-repository.js");
  const { createExpertTelegramQueryService } =
    await import("../../packages/application/src/expert-telegram-query-service.js");
  const { issueClientViewCallback, authenticateClientViewCallback } =
    await import("../../packages/integrations/src/telegram/client-view-callback-token.js");
  const queryRepository = new QueryRepository(database.db);
  const clientSecret = Buffer.alloc(32, 39);
  const principal = {
    expertId: f.expertId,
    telegramUserId: "301",
    timezone: "Europe/Moscow",
  };
  const queryService = createExpertTelegramQueryService({
    repository: queryRepository,
    booking: {
      getExpertSchedule: async () => {
        throw Error("unused_schedule_read");
      },
    },
    clientViewCallbacks: {
      issue: (claims) =>
        issueClientViewCallback(claims, clientSecret, queryRepository),
    },
    clock: { now: () => new Date() },
  });
  const choices = await queryService.clientChoices(principal);
  expect(choices).toHaveLength(2);
  const viewed: string[] = [];
  for (const choice of choices) {
    expect(choice.serviceName).toBe("Консультация");
    const authenticated = await authenticateClientViewCallback(
      choice.callbackData,
      "301",
      { ...principal, active: true, verified: true },
      clientSecret,
      queryRepository,
      new Date(),
    );
    const detail = await queryService.clientView({
      principal,
      authenticated,
      correlationId: randomUUID(),
    });
    viewed.push(detail.reservationId);
    expect(detail.serviceName).toBe(choice.serviceName);
  }
  expect(viewed).toEqual([booked.reservationId, held.reservationId]);
  const { PostgresCatalogRepository } =
    await import("../../packages/db/src/repositories/catalog-repository.js");
  const catalog = new PostgresCatalogRepository(database.db);
  expect(
    (await catalog.listPublicServices({ limit: 20 })).some(
      (s) => s.sourceKey === original.id,
    ),
  ).toBe(false);
  const freshSlot = (
    await database.db.execute<{ id: string }>(
      sql`select s.id from slots s join resident_native_slots n on n.slot_id=s.id where s.expert_service_id=${original.id}::uuid and n.withdrawn_at is null and s.id<>${booked.slotId}::uuid limit 1`,
    )
  ).rows[0]!;
  expect(
    (
      await n.bookings.reserve({
        userId: await database.createUser(),
        slotId: freshSlot.id,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        now: new Date(),
        minimumLeadMs: 86400000,
        confirmationBufferMs: 900000,
      })
    ).kind,
  ).toBe("unavailable");
  const { PostgresExpertTelegramQueryRepository } =
    await import("../../packages/db/src/repositories/expert-telegram-query-repository.js");
  expect(
    await new PostgresExpertTelegramQueryRepository(
      database.db,
    ).listClientCandidates({
      expertId: f.expertId,
      telegramUserId: "301",
      now: new Date(),
      limit: 20,
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        reservationId: booked.reservationId,
        serviceName: "Консультация",
      }),
    ]),
  );
}, 60000);

const Fastify = createRequire(import.meta.url)("fastify");
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
it("actual authenticated work ingress keeps ordinary profile input and exposes complete protected manager schedule", async () => {
  const f = await secondRichFixture();
  const config = {
    features: { expertCard: true, residentPrivateJobs: false },
    expertCard: {
      materialDeliveryEnabled: false,
      mainCheckoutEnabled: false,
      workBotId: workScope.botId,
      workBotKey: workScope.botKey,
      workBotUsername: "synthetic_work_bot",
      workBotToken: workScope.botId + ":synthetic",
      webhookSecret: "synthetic-core-webhook-secret-12345678",
      messagingConsentPolicyVersion: "client-messaging-v1",
      paymentMode: "test",
    },
  } as unknown as RuntimeConfig;
  const capability = createExpertCardComposition(database.db, config)!;
  const app = await workHttp(f.repo, undefined, undefined, capability);
  const send = async (
    text: string,
    secret = "synthetic-core-webhook-secret-12345678",
    chat = f.work.chatId,
  ) =>
    app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: { "x-telegram-bot-api-secret-token": secret },
      payload: {
        update_id: ++sequence,
        message: {
          message_id: sequence,
          from: { id: Number(chat) },
          chat: { id: Number(chat), type: "private" },
          text,
        },
      },
    });
  try {
    expect((await send("/slots_setup", "wrong")).statusCode).toBe(401);
    expect((await send("/slots_setup")).json()).toMatchObject({
      text: expect.stringContaining("Москва"),
    });
    // Schedule commands do not reinterpret ordinary rich text as a timezone answer.
    const ordinary = await send(
      "Помогаю спокойно разобраться в жизненных задачах",
    );
    expect(ordinary.statusCode).toBe(200);
    expect(ordinary.json().text).not.toContain("Какие даты");
    for (const a of [
      "2",
      "2026-11-11 2026-11-11",
      "3",
      "09:00-13:00",
      "нет",
      "15",
    ])
      expect((await send("/slots_answer " + a)).statusCode).toBe(200);
    let previous = (await send("/slots_preview")).json().text as string;
    while (previous.split("\n").at(-1)!.startsWith("/slots_page"))
      previous = (await send(previous.split("\n").at(-1)!)).json().text;
    const staleConfirmation = previous.split("\n").at(-1)!;
    const invalidRaw = "2026-11-11 09:00-09:30 Консультация";
    expect((await send("/slots_import\n" + invalidRaw)).json().text).toContain(
      "Импорт сохранён",
    );
    let invalid = (await send("/slots_preview")).json().text as string;
    while (invalid.split("\n").at(-1)!.startsWith("/slots_page"))
      invalid = (await send(invalid.split("\n").at(-1)!)).json().text;
    expect(invalid).toContain("Исправьте строки");
    expect(invalid).not.toContain("/slots_confirm");
    expect(
      (
        await database.db.execute(
          sql`select d.initial_schedule,p.raw_input,jsonb_array_length(p.errors) as errors from expert_card_drafts d join resident_schedule_state s on s.draft_id=d.id join resident_schedule_previews p on p.id=s.current_preview where d.user_id=${f.userId}::uuid`,
        )
      ).rows[0],
    ).toMatchObject({
      initial_schedule: null,
      raw_input: invalidRaw,
      errors: 1,
    });
    const validRaw =
      '2026-11-11,09:00,10:00,"Консультация"\n2026-11-11,10:15,11:15,"Консультация"';
    expect((await send("/slots_import\n" + validRaw)).json().text).toContain(
      "Импорт сохранён",
    );
    expect((await send(staleConfirmation)).json().text).not.toContain(
      "Расписание сохранено приватно",
    );
    let page = (await send("/slots_preview")).json().text as string;
    expect(page).toContain("Консультация");
    while (page.split("\n").at(-1)!.startsWith("/slots_page"))
      page = (await send(page.split("\n").at(-1)!)).json().text;
    expect((await send(page.split("\n").at(-1)!)).json().text).toContain(
      "приватно",
    );
    expect(
      JSON.stringify(
        (await send("/slots_preview", undefined, "999999")).json(),
      ),
    ).not.toContain("Консультация");
    await f.prepareReview();
    const { createExpertCardAdminService } =
      await import("../../packages/application/src/expert-card-admin-service.js");
    const { expertCardAdminRoutes } =
      await import("../../apps/api/src/routes/expert-cards.js");
    const admin = Fastify({ logger: false });
    await admin.register(expertCardAdminRoutes, {
      enabled: true,
      service: createExpertCardAdminService({
        enabled: true,
        repository: f.repo,
      }),
    });
    try {
      const response = await admin.inject({
        method: "GET",
        url: "/v1/admin/expert-cards/" + f.applicationId,
        headers: { authorization: "Bearer " + manager.token },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().item.rich.schedule.entries.length).toBeGreaterThan(
        0,
      );
      expect(response.json().item.rich.confirmed).toBe(true);
      await exportBrowserFixture("manager-api-fixture.json", {
        detail: response.json(),
      });
      const expired = await staff();
      await database.db.execute(
        sql`update admin_sessions set created_at=clock_timestamp()-interval '2 minutes',mfa_verified_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()-interval '1 second' where session_id_hash=${expired.sessionHash}`,
      );
      expect(
        (
          await admin.inject({
            method: "GET",
            url: "/v1/admin/expert-cards/" + f.applicationId,
            headers: { authorization: "Bearer " + expired.token },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await admin.close();
    }
  } finally {
    await app.close();
  }
}, 60000);
it.each(["cancelled", "revoked", "recipient_changed"] as const)(
  "native logistics suppresses %s and erases private delivery/source data",
  async (scenario) => {
    const f = await nativeFixture({ hybrid: true }),
      n = await notificationFixture(f),
      booked = await bookFirst(f, n);
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
    if (scenario === "cancelled")
      await n.bookings.transition({
        reservationId: booked.reservationId,
        expectedVersion: 2,
        action: "client_cancel",
        actor: { type: "client", id: n.clientId },
        now: new Date(),
        correlationId: randomUUID(),
      });
    if (scenario === "revoked")
      await privacy.withdrawConsentAtomically({
        targetUserId: n.clientId,
        purpose: "client_messaging",
        policyVersion: "client-messaging-v1",
        correlationId: randomUUID(),
      });
    if (scenario === "recipient_changed")
      await database.db.execute(
        sql`update channel_identities set external_id='402',external_chat_id='402' where user_id=${n.clientId}::uuid and bot_key=${n.botKey}`,
      );
    const { PostgresResidentNativeLogistics } =
      await import("../../packages/db/src/repositories/resident-native-logistics.js");
    expect(
      await new PostgresResidentNativeLogistics(
        database.db,
        n.botKey,
        n.transport,
      ).runOnce(),
    ).toBe(0);
    expect(n.bodies).toEqual([]);
    expect(
      (
        await database.db.execute(
          sql`select state from resident_native_logistics where reservation_id=${booked.reservationId}::uuid and kind='offline'`,
        )
      ).rows[0]?.state,
    ).toBe("suppressed");
    await privacy.startErasureAtomically({
      targetUserId: scenario === "cancelled" ? f.userId : n.clientId,
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      pseudonym: "hmac:synthetic-native-erasure",
    });
    expect(
      (
        await database.db.execute(
          sql`select reservation_id from resident_native_confirmations where reservation_id=${booked.reservationId}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await database.db.execute(
          sql`select id from resident_native_logistics where reservation_id=${booked.reservationId}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
    if (scenario === "cancelled")
      expect(
        (
          await database.db.execute(
            sql`select s.id from resident_schedule_previews s join expert_card_drafts d on d.id=s.draft_id where d.user_id=${f.userId}::uuid`,
          )
        ).rows,
      ).toHaveLength(0);
  },
  60000,
);
it("expiry during an actual expert-row wait denies both native reserve and confirmation using final database time", async () => {
  const f = await nativeFixture(),
    n = await notificationFixture(f);
  const slots = (
    await database.db.execute<{ id: string }>(
      sql`select s.id from slots s join expert_services es on es.id=s.expert_service_id where es.expert_id=${f.expertId}::uuid and es.duration_minutes=60 order by s.starts_at`,
    )
  ).rows;
  const held = await n.bookings.reserve({
    userId: n.clientId,
    slotId: slots[0]!.id,
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    now: new Date(),
    minimumLeadMs: 86400000,
    confirmationBufferMs: 900000,
  });
  if (held.kind !== "reserved") throw Error("missing_wait_hold");
  await database.db.execute(
    sql`with t as materialized(select clock_timestamp() as at) update expert_residency_orders set settled_at=settled_at-(residency_ends_at-t.at-interval '600 milliseconds'),residency_starts_at=residency_starts_at-(residency_ends_at-t.at-interval '600 milliseconds'),residency_ends_at=t.at+interval '600 milliseconds' from t where id=${f.orderId}::uuid`,
  );
  let locked!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (locked = r)),
    gate = new Promise<void>((r) => (release = r));
  const blocker = database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from experts where id=${f.expertId}::uuid for update`,
    );
    locked();
    await gate;
  });
  await started;
  const confirm = n.bookings.transition({
    reservationId: held.reservationId,
    expectedVersion: 1,
    action: "expert_confirm",
    actor: { type: "expert", id: f.expertId },
    now: new Date("2000-01-01"),
    correlationId: randomUUID(),
  });
  const reserve = n.bookings.reserve({
    userId: await database.createUser(),
    slotId: slots.at(-1)!.id,
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    now: new Date(),
    minimumLeadMs: 86400000,
    confirmationBufferMs: 900000,
  });
  const outcomes = Promise.allSettled([confirm, reserve]);
  await new Promise((r) => setTimeout(r, 800));
  release();
  await blocker;
  const result = await outcomes;
  expect(result[0]!.status).toBe("rejected");
  expect(result[1]).toMatchObject({
    status: "fulfilled",
    value: { kind: "unavailable" },
  });
  expect(
    (
      await database.db.execute(
        sql`select status,version from reservations where id=${held.reservationId}::uuid`,
      )
    ).rows[0],
  ).toEqual({ status: "reserved", version: 1 });
}, 60000);

it.each(["throttle", "pause"] as const)(
  "R2 due native notices survive temporary bot %s without spending unsent attempts",
  async (control) => {
    const { PostgresResidentNativeLogistics } =
      await import("../../packages/db/src/repositories/resident-native-logistics.js");
    const f = await nativeFixture({ near: true, hybrid: true }),
      n = await notificationFixture(f),
      booked = await bookFirst(f, n, true);
    let calls = 0;
    const delivery = new PostgresResidentNativeLogistics(
      database.db,
      n.botKey,
      {
        send: async (input) => {
          calls++;
          if (calls === 1)
            return control === "throttle"
              ? { kind: "not_applied", retryAfterSeconds: 600 }
              : { kind: "unknown", pauseBot: true, reasonCode: "bot_rejected" };
          return {
            kind: "applied",
            receipt: {
              botKey: input.botKey,
              chatId: input.chatId,
              messageId: 990 + calls,
            },
          };
        },
      },
    );
    const rows = () =>
      database.db.execute(
        sql`select state,attempt_count from resident_native_logistics where reservation_id=${booked.reservationId}::uuid order by due_at,id`,
      );
    expect(await delivery.runOnce()).toBe(0);
    expect(calls).toBe(1);
    expect((await rows()).rows).toEqual([
      {
        state: control === "throttle" ? "pending" : "unknown",
        attempt_count: 1,
      },
      { state: "pending", attempt_count: 0 },
    ]);
    expect(await delivery.runOnce()).toBe(0);
    expect(calls).toBe(1);
    // Explicit synthetic operator recovery/elapsed throttle; never reset unknown work.
    await database.db.execute(
      sql`update booking_notification_bot_controls set paused_at=null,pause_reason=null,not_before=clock_timestamp()-interval '1 second' where bot_key=${n.botKey}`,
    );
    await database.db.execute(
      sql`update resident_native_logistics set lease_until=null where reservation_id=${booked.reservationId}::uuid and state='pending'`,
    );
    expect(await delivery.runOnce()).toBe(control === "throttle" ? 2 : 1);
    expect((await rows()).rows).toEqual([
      {
        state: control === "throttle" ? "delivered" : "unknown",
        attempt_count: control === "throttle" ? 2 : 1,
      },
      { state: "delivered", attempt_count: 1 },
    ]);
    expect(await delivery.runOnce()).toBe(0);
    expect(calls).toBe(control === "throttle" ? 3 : 2);
  },
  60000,
);

it.each(["expert_cancel", "client_cancel", "expire"] as const)(
  "R4 unconfirmed native %s uses native ordinary worker presentation",
  async (action) => {
    const f = await nativeFixture(),
      n = await notificationFixture(f);
    const slot = (
      await database.db.execute<{ id: string }>(
        sql`select s.id from slots s join resident_native_slots ns on ns.slot_id=s.id join expert_services es on es.id=s.expert_service_id where es.expert_id=${f.expertId}::uuid order by s.starts_at limit 1`,
      )
    ).rows[0]!;
    const hold = await n.bookings.reserve({
      userId: n.clientId,
      slotId: slot.id,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      now: new Date(),
      minimumLeadMs: 86400000,
      confirmationBufferMs: 900000,
    });
    if (hold.kind !== "reserved") throw Error("missing_native_hold");
    expect(await n.runner.runOnce()).toMatchObject({ sent: 1 });
    const priorMessages = n.bodies.length;
    if (action === "expire")
      await database.db.execute(
        sql`update reservations set created_at=clock_timestamp()-interval '2 minutes',reserved_until=clock_timestamp()-interval '1 minute' where id=${hold.reservationId}::uuid`,
      );
    await n.bookings.transition({
      reservationId: hold.reservationId,
      expectedVersion: hold.version,
      action,
      actor: {
        type:
          action === "expert_cancel"
            ? "expert"
            : action === "client_cancel"
              ? "client"
              : "system",
        id: action === "expert_cancel" ? f.expertId : n.clientId,
      },
      now: new Date(),
      correlationId: randomUUID(),
    });
    expect(await n.runner.runOnce()).toMatchObject({ sent: 1 });
    if (action === "expire")
      expect(await n.runner.runOnce()).toMatchObject({ sent: 1 });
    expect(n.bodies).toHaveLength(
      priorMessages + (action === "expire" ? 2 : 1),
    );
    for (const body of n.bodies.slice(priorMessages)) {
      expect(JSON.parse(body).text).not.toMatch(/календар|локальн/iu);
      expect(JSON.parse(body).text).toMatch(
        action === "expire" ? /истёк/u : /отменена/u,
      );
    }
    expect(
      (
        await database.db.execute(
          sql`select reservation_id from resident_native_confirmations where reservation_id=${hold.reservationId}::uuid`,
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await database.db.execute(
          sql`select id from planerka_booking_operations where reservation_id=${hold.reservationId}::uuid`,
        )
      ).rows,
    ).toEqual([]);
  },
  60000,
);

it("R5 production-composed runtime delivers due native private logistics and recovery-only never sends", async () => {
  const { createBookingNotificationRuntime } =
    await import("../../apps/worker/src/booking-notifications.js");
  const { createProductionWorkerRuntime } =
    await import("../../apps/worker/src/runtime.js");
  const { loadEnv } = await import("../../packages/config/src/index.js");
  const f = await nativeFixture({ near: true, hybrid: true }),
    n = await notificationFixture(f),
    booked = await bookFirst(f, n, true);
  const config = Object.assign(
    loadEnv({
      DATABASE_URL: "postgresql://synthetic:synthetic@localhost/test",
      ALLOW_INSECURE_LOCAL_DATABASE: "true",
    }),
    {
      clientTelegramBotKey: n.botKey,
      clientTelegramBotToken: `12345:${"a".repeat(35)}`,
      telegramWebhookSecret: "s".repeat(32),
      clientMessagingConsentPolicyVersion: "client-messaging-v1",
      bookingNotifications: {
        admissionEnabled: true,
        sendEnabled: true,
        recoveryEnabled: true,
      },
      bookingCallbacks: {
        hmacKey: Buffer.alloc(32, 91),
        activeKeyId: "native-test",
        keys: new Map([["native-test", Buffer.alloc(32, 92)]]),
      },
    },
  );
  config.features.bookingCallbacks = true;
  const bodies: { chat_id: string; text: string }[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    return new Response(
      JSON.stringify({
        ok: true,
        result: {
          message_id: 1200 + bodies.length,
          from: { id: 12345, is_bot: true },
          chat: { id: Number(body.chat_id), type: "private" },
        },
      }),
      { status: 200 },
    );
  });
  let runtime: ReturnType<typeof createProductionWorkerRuntime> | undefined;
  try {
    const recovery = await createBookingNotificationRuntime(
      {
        ...config,
        bookingNotifications: {
          admissionEnabled: false,
          sendEnabled: false,
          recoveryEnabled: true,
        },
      },
      database.db,
    );
    expect(await recovery!.runOnce()).toMatchObject({ sent: 0 });
    expect(bodies).toEqual([]);
    expect(
      (
        await database.db.execute(
          sql`select state,attempt_count from resident_native_logistics where reservation_id=${booked.reservationId}::uuid`,
        )
      ).rows,
    ).toEqual([
      { state: "pending", attempt_count: 0 },
      { state: "pending", attempt_count: 0 },
    ]);
    await recovery!.drain(Date.now() + 1000);
    const notifications = await createBookingNotificationRuntime(
      config,
      database.db,
    );
    const empty = async () => ({});
    runtime = createProductionWorkerRuntime({
      bookingNotifications: notifications!,
      jobsRepository: {
        processDueBatch: empty,
        expireDueBatch: empty,
        listLocalReservations: async () => [],
        recordProviderUnavailable: async () => {},
        materializeOperatorCasesBatch: empty,
      },
      expertReferralJobsRepository: {
        expireDueBatch: async () => ({ examined: 0, changed: 0, failed: 0 }),
        listReconciliationBatch: async () => [],
        recordReconciliationMismatches: async () => {},
        replayDueBatch: async () => ({ examined: 0, granted: 0, cancelled: 0 }),
      },
      expertTelegramCheckoutRepository: {
        clearExpiredCheckoutUrls: async () => 0,
      },
      outboxRepository: {
        recoverExpiredDispatchLeases: async () => 0,
        recoverExpiredReconciliationLeases: async () => 0,
      },
      closeDatabase: async () => {},
      closeTelemetry: async () => {},
      now: () => new Date(),
    });
    const report = await runtime.runOnce();
    expect(report.bookingNotifications).toMatchObject({ sent: 3 });
    expect(
      bodies.filter((body) => body.text.includes("https://example.com/room")),
    ).toEqual([expect.objectContaining({ chat_id: "401" })]);
    expect(bodies.filter((body) => body.text.includes("Примерная"))).toEqual([
      expect.objectContaining({ chat_id: "401" }),
    ]);
    expect(
      (
        await database.db.execute(
          sql`select kind,state,attempt_count from resident_native_logistics where reservation_id=${booked.reservationId}::uuid order by kind`,
        )
      ).rows,
    ).toEqual([
      { kind: "offline", state: "delivered", attempt_count: 1 },
      { kind: "online", state: "delivered", attempt_count: 1 },
    ]);
    const calls = bodies.length;
    expect((await runtime.runOnce()).bookingNotifications).toMatchObject({
      sent: 0,
    });
    expect(bodies).toHaveLength(calls);
    notifications!.stopAccepting();
    expect(await notifications!.runOnce()).toMatchObject({ sent: 0 });
    expect(bodies).toHaveLength(calls);
  } finally {
    await runtime?.close();
    vi.unstubAllGlobals();
  }
}, 60000);
