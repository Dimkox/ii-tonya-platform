import { expertCardAdminRoutes } from "../../apps/api/src/routes/expert-cards.js";
import { createExpertCardAdminService } from "../../packages/application/src/expert-card-admin-service.js";
import type { ResidentSafetyAssessment } from "../../packages/db/src/repositories/resident-content-safety.js";
import { createRequire } from "node:module";
import { telegramWebhookRoutes } from "../../apps/api/src/routes/telegram-webhook.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import {
  createYooKassaClient,
  YooKassaOnboardingPaymentVerifier,
} from "@ii-tonya/integrations";
import { verifyExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import { PostgresExpertVerificationRepository } from "../../packages/db/src/repositories/expert-verification-repository.js";
import { PostgresExpertCardRepository } from "../../packages/db/src/repositories/expert-card-repository.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
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
  if (!proof) throw new Error("fixture_verified_proof_missing");
  await verification.settleVerified(proof);
  return { ...f, proof };
}
function cards() {
  return new PostgresExpertCardRepository(database.db, {
    messagingConsentPolicyVersion: "client-messaging-v1",
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
  });
}
async function linked() {
  const f = await paid();
  const card = cards();
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
async function erase(userId: string) {
  const repository = new PostgresPrivacyRepository(database.db, {
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
  await repository.startErasureAtomically({
    targetUserId: userId,
    correlationId: `core-erase:${userId}`,
    idempotencyKey: `core-erase:${userId}`,
    pseudonym: "hmac:synthetic-core-erasure",
  });
}
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const Fastify = apiRequire("fastify") as (o: {
  logger: false;
}) => Parameters<typeof telegramWebhookRoutes>[0];
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
    secret: "synthetic-core-webhook-secret",
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
      webhookSecret: "synthetic-core-webhook-secret",
      service,
      legacyReplay: { read: async () => "absent" },
      ...(answerTagCallback ? { answerTagCallback } : {}),
    },
  });
  return app;
}
const publicCard = {
  displayName: "Мария",
  profession: "Психолог",
  city: "Казань",
  summary: "Индивидуальные консультации",
};
async function assess(
  fields: Record<string, string>,
): Promise<ResidentSafetyAssessment> {
  return (
    await database.db.execute<{ v: ResidentSafetyAssessment }>(
      sql`select resident_safety_assess(${JSON.stringify(fields)}::jsonb,1) as v`,
    )
  ).rows[0]!.v;
}
async function probeSafetyFault(fault: "missing" | "engine" | "compiled") {
  const rollback = new Error("synthetic_fault_probe_rollback");
  let outcome:
    | { kind: "accepted" }
    | { kind: "denied"; code: string | undefined }
    | undefined;
  try {
    await database.db.transaction(async (tx) => {
      if (fault === "missing") {
        await tx.execute(
          sql`alter table resident_safety_active disable trigger user`,
        );
        await tx.execute(sql`delete from resident_safety_active`);
      } else if (fault === "engine") {
        await tx.execute(
          sql`alter table resident_safety_policies disable trigger user`,
        );
        await tx.execute(
          sql`update resident_safety_policies set engine='unknown' where id=(select policy_id from resident_safety_active)`,
        );
      } else {
        await tx.execute(
          sql`alter table forbidden_patterns disable trigger user`,
        );
        await tx.execute(
          sql`update forbidden_patterns set compiled='{}' where policy_id=(select policy_id from resident_safety_active)`,
        );
      }
      try {
        await tx.execute(
          sql`select resident_safety_assess('{"bio":"normal"}',1)`,
        );
        outcome = { kind: "accepted" };
      } catch (error) {
        outcome = {
          kind: "denied",
          code: (error as { cause?: { code?: string } }).cause?.code,
        };
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  if (!outcome) throw new Error("fault_probe_incomplete");
  return outcome;
}
describe("resident content safety PG17.5", () => {
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
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
  }, 120000);
  afterAll(async () => {
    await database?.stop();
  }, 120000);
  it("commits blocked outcomes without saving unsafe answers and replays them", async () => {
    const f = await linked();
    const input = {
      ...event(f.work),
      expectedRevision: 0,
      entry: { kind: "text" as const, text: "вылечу рак" },
    };
    const result = await f.card.addEntry(input);
    expect(result).toMatchObject({ safetyBlocked: true, entryCount: 0 });
    expect(await f.card.addEntry(input)).toMatchObject({
      safetyBlocked: true,
      replay: true,
    });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from security_logs where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
  });
  it("matches every seeded witness and Unicode boundaries without banning benign esoteric text", async () => {
    const rules = (
      await database.db.execute<{
        id: string;
        pattern_regex: string;
        positive_witness: string;
      }>(
        sql`select id,pattern_regex,positive_witness from forbidden_patterns where is_active`,
      )
    ).rows;
    expect(rules.length).toBeGreaterThanOrEqual(20);
    for (const rule of rules)
      expect(
        (
          await database.db.execute(
            sql`select resident_safety_matches(${rule.positive_witness},resident_safety_compile(${rule.pattern_regex})) as matched`,
          )
        ).rows[0]?.matched,
        rule.pattern_regex,
      ).toBe(true);
    for (const [value, blocked] of [
      ["ВыЛеЧу\u00a0рак", true],
      ["избавлю\nот\nрака", true],
      ["доходность 20%", true],
      ["крипто сигналы 100%", true],
      ["вылечусь самостоятельно", false],
      ["приворотный", false],
      ["Астрология и таро, CAT_03", false],
      ["#лечениерака", true],
      ["#быстрые_деньги", true],
    ] as const) {
      expect((await assess({ bio: value })).blocked, value).toBe(blocked);
    }
    expect((await assess({ tag: "#приворот" })).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "WARNING" }),
      ]),
    );
    for (const caps of [49, 50, 51])
      expect(
        (
          await assess({ bio: "А".repeat(caps) + "б".repeat(100 - caps) })
        ).issues.some((i) => i.ruleId === null),
      ).toBe(caps > 50);
    expect((await assess({ bio: "123 !?" })).issues).toEqual([]);
  });
  it("accepts a near-limit document and representative large aggregate within the repository timeout", async () => {
    const f = await linked();
    const e = event(f.work);
    await f.card.addEntry({
      ...e,
      expectedRevision: 0,
      entry: { kind: "document", reference: "telegram:file:large_source" },
    });
    const content = "neutral text ".repeat(4923).slice(0, 63999);
    expect(Buffer.byteLength(content)).toBeGreaterThan(63900);
    expect(
      await f.card.completeDocumentImport({
        ...e,
        expectedRevision: 1,
        proposal: { source: "pdf", content },
      }),
    ).toBe(true);
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      const fields = Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [
          `entry:${i}`,
          "обычная практика ".repeat(200),
        ]),
      );
      const result = (
        await tx.execute<{ v: ResidentSafetyAssessment }>(
          sql`select resident_safety_assess(${JSON.stringify(fields)}::jsonb,1) as v`,
        )
      ).rows[0]!.v;
      expect(result.blocked).toBe(false);
      expect(result.issues).toEqual([]);
    });
  });
  it("rejects unsupported and oversized syntax, fields and aggregate budgets", async () => {
    for (const source of [
      "(a+)+",
      String.raw`\b(a|b(c))\b`,
      String.raw`\b(a)\1\b`,
      "a".repeat(513),
      "(" + Array(17).fill("a").join("|") + ")",
      String.raw`x\d+`,
      "a" + String.raw`\s+a`.repeat(16),
    ]) {
      await expect(
        database.db.execute(sql`select resident_safety_compile(${source})`),
      ).rejects.toThrow();
    }
    await expect(assess({ bio: "a".repeat(64001) })).rejects.toThrow();
    await expect(
      assess(
        Object.fromEntries(
          Array.from({ length: 126 }, (_, i) => [String(i), "a"]),
        ),
      ),
    ).rejects.toThrow();
    await expect(
      assess(
        Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [String(i), "a".repeat(64000)]),
        ),
      ),
    ).rejects.toThrow();
  });
  it("uses actual work ingress for refusal, preserved file fallback and correction at the raw-entry cap", async () => {
    const f = await linked();
    const app = await workHttp(f.card, {
      read: async () => ({ bytes: Buffer.from("fixture"), type: "pdf" }),
      parser: {
        parse: async () => ({
          source: "pdf",
          content: "вылечу рак. " + "Нейтральное описание. ".repeat(5),
        }),
      },
    });
    const send = (message: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token": "synthetic-core-webhook-secret",
        },
        payload: {
          update_id: ++sequence,
          message: {
            from: { id: Number(f.work.telegramUserId) },
            chat: { id: Number(f.work.chatId), type: "private" },
            ...message,
          },
        },
      });
    try {
      const blocked = await send({ text: "вылечу рак" });
      expect(blocked.statusCode).toBe(200);
      expect(blocked.body).toContain("Уберите");
      expect((await f.card.getWorkflow(f.work))?.entryCount).toBe(0);
      const invisible = await send({ text: "вы\u200bлечу рак" });
      expect(invisible.body).toContain("невидимые");
      expect((await f.card.getWorkflow(f.work))?.entryCount).toBe(0);
      const imported = await send({ document: { file_id: "source_unsafe" } });
      expect(imported.body).toContain("вручную");
      const d = (
        await database.db.execute<{ id: string }>(
          sql`select id from expert_card_drafts where user_id=${f.userId}::uuid`,
        )
      ).rows[0]!;
      expect(
        (
          await database.db.execute(
            sql`select media_reference from expert_card_entries where draft_id=${d.id}::uuid`,
          )
        ).rows[0]?.media_reference,
      ).toBe("telegram:file:source_unsafe");
      expect(
        (
          await database.db.execute(
            sql`select document_proposal from expert_card_drafts where id=${d.id}::uuid`,
          )
        ).rows[0]?.document_proposal,
      ).toBeNull();
      // Historical accepted answers may become blocked by a later policy. Preserve
      // the originals and force the real command through its 100-entry boundary.
      await database.db.execute(
        sql`insert into expert_card_entries(draft_id,user_id,revision,kind,text_content) select ${d.id}::uuid,${f.userId}::uuid,n,'text',case when n=2 then 'вылечу рак' else 'обычная практика' end from generate_series(2,100) n`,
      );
      for (let revision = 2; revision <= 100; revision++)
        await database.db.execute(
          sql`update expert_card_drafts set revision=${revision} where id=${d.id}::uuid`,
        );
      const entry = (
        await database.db.execute<{ id: string }>(
          sql`select id from expert_card_entries where draft_id=${d.id}::uuid and revision=2`,
        )
      ).rows[0]!;
      const pages = [];
      for (let page = 0; page < 13; page++) {
        const response = await send({ text: `/card_answers ${page}` });
        expect(response.body.length).toBeLessThan(4000);
        pages.push(response.body);
      }
      expect(pages.join(" ")).toContain(entry.id);
      const fixed = await send({
        text: `/card_correct 100 ${entry.id} Работаю с темой благополучия`,
      });
      expect(fixed.body).toContain("Ответ исправлен");
      expect((await f.card.getWorkflow(f.work))?.entryCount).toBe(100);
      expect(
        (
          await database.db.execute(
            sql`select text_content from expert_card_entries where id=${entry.id}::uuid`,
          )
        ).rows[0]?.text_content,
      ).toBe("вылечу рак");
      const detail = await f.card.readDraft(
        manager.sessionHash,
        f.applicationId,
      );
      expect(detail?.effectiveFields[`entry:${entry.id}`]).toBe(
        "Работаю с темой благополучия",
      );
      expect(detail?.safety.blocked).toBe(false);
      expect((await send({ text: "/card_submit 101" })).body).toContain(
        "передана менеджеру",
      );
    } finally {
      await app.close();
    }
  });
  it("shows warnings in actual manager API, denies unacknowledged review and binds proof to current tag labels", async () => {
    const f = await linked();
    await f.card.addEntry({
      ...event(f.work),
      expectedRevision: 0,
      entry: { kind: "text", text: "#приворот" },
    });
    const tag = (
      await database.db.execute<{ id: string }>(
        sql`select id from hashtags_db where is_active order by id limit 1`,
      )
    ).rows[0]!;
    await f.card.toggleDraftTag({
      ...event(f.work),
      expectedRevision: 1,
      tagId: tag.id,
    });
    await f.card.submitDraft({ ...event(f.work), expectedRevision: 2 });
    await f.card.editPublicCard({
      sessionHash: manager.sessionHash,
      applicationId: f.applicationId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      publicCard,
    });
    const app = Fastify({ logger: false });
    await app.register(expertCardAdminRoutes, {
      enabled: true,
      service: createExpertCardAdminService({
        enabled: true,
        repository: f.card,
      }),
    });
    try {
      const detail = (
        await app.inject({
          method: "GET",
          url: `/v1/admin/expert-cards/${f.applicationId}`,
          headers: { authorization: `Bearer ${manager.token}` },
        })
      ).json().item;
      expect(detail.safety.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "WARNING",
            field: expect.stringContaining("entry:"),
          }),
        ]),
      );
      expect(detail.effectiveFields).toHaveProperty(`tag:${tag.id}`);
      const post = (extra: Record<string, unknown>) =>
        app.inject({
          method: "POST",
          url: `/v1/admin/expert-cards/${f.applicationId}/review`,
          headers: { authorization: `Bearer ${manager.token}` },
          payload: {
            expectedRevision: 3,
            idempotencyKey: randomUUID(),
            action: "approve",
            ...extra,
          },
        });
      expect((await post({})).json().item.safetyBlocked).toBe(true);
      expect(
        (await post({ warningAcknowledgment: detail.safety.digest })).json()
          .item.status,
      ).toBe("approved");
      const review = (
        await database.db.execute<{ safety_proof: { digest: string } }>(
          sql`select safety_proof from expert_card_reviews where draft_id=${detail.draftId}::uuid and action='approve'`,
        )
      ).rows[0]!;
      expect(review.safety_proof.digest).toBe(detail.safety.digest);
      await f.card.submitPromoProof({
        ...event(f.work),
        expectedRevision: 3,
        proof: { kind: "link", reference: "https://example.org/promo" },
      });
      const confirmed = await f.card.confirmPromo({
        sessionHash: manager.sessionHash,
        applicationId: f.applicationId,
        expectedRevision: 3,
        idempotencyKey: randomUUID(),
      });
      expect(
        (
          await database.db.execute(
            sql`select expert_card_activation_gate_valid(${f.userId}::uuid,${confirmed.reviewId!}::uuid) as valid`,
          )
        ).rows[0]?.valid,
      ).toBe(true);
      await database.db.execute(
        sql`update hashtags_db set display_label=display_label||' новая' where id=${tag.id}::uuid`,
      );
      const changed = await f.card.readDraft(
        manager.sessionHash,
        f.applicationId,
      );
      expect(changed?.safety.digest).not.toBe(detail.safety.digest);
      expect(
        (
          await database.db.execute(
            sql`select expert_card_activation_gate_valid(${f.userId}::uuid,${changed!.approvedReviewId}::uuid) as valid`,
          )
        ).rows[0]?.valid,
      ).toBe(false);
    } finally {
      await app.close();
    }
  });
  it("rejects forbidden selections and manager writes with committed private reasons", async () => {
    const f = await linked();
    await f.card.addEntry({
      ...event(f.work),
      expectedRevision: 0,
      entry: { kind: "text", text: "обычная практика" },
    });
    const tag = (
      await database.db.execute<{ id: string }>(
        sql`select id from hashtags_db where is_active order by id limit 1`,
      )
    ).rows[0]!;
    await database.db.execute(
      sql`update hashtags_db set display_label='#лечениерака' where id=${tag.id}::uuid`,
    );
    const input = { ...event(f.work), expectedRevision: 1, tagId: tag.id };
    expect(await f.card.toggleDraftTag(input)).toMatchObject({
      safetyBlocked: true,
      revision: 1,
    });
    expect(await f.card.toggleDraftTag(input)).toMatchObject({
      safetyBlocked: true,
      replay: true,
    });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_card_draft_tags where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    await f.card.submitDraft({ ...event(f.work), expectedRevision: 1 });
    const edit = {
      sessionHash: manager.sessionHash,
      applicationId: f.applicationId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      publicCard: { ...publicCard, summary: "вылечу рак" },
    };
    expect(await f.card.editPublicCard(edit)).toMatchObject({
      safetyBlocked: true,
      revision: 1,
    });
    expect(await f.card.editPublicCard(edit)).toMatchObject({
      safetyBlocked: true,
      replay: true,
    });
    expect(
      (await f.card.readDraft(manager.sessionHash, f.applicationId))
        ?.publicCard,
    ).toBeNull();
    await database.db.execute(
      sql`update hashtags_db set display_label='обычный тег' where id=${tag.id}::uuid`,
    );
  });
  it("does not trust raw-SQL safe proofs or stale revision on review/publication", async () => {
    const f = await linked();
    await f.card.addEntry({
      ...event(f.work),
      expectedRevision: 0,
      entry: { kind: "text", text: "обычная практика" },
    });
    await f.card.submitDraft({ ...event(f.work), expectedRevision: 1 });
    const d = (await f.card.readDraft(manager.sessionHash, f.applicationId))!;
    const unsafe = { ...publicCard, summary: "вылечу рак" };
    await database.db.execute(
      sql`update expert_card_drafts set public_payload=${JSON.stringify(unsafe)}::jsonb where id=${d.draftId}::uuid`,
    );
    const managerId = (
      await database.db.execute<{ admin_id: string }>(
        sql`select admin_id from admin_sessions where session_id_hash=${manager.sessionHash}`,
      )
    ).rows[0]!.admin_id;
    await expect(
      database.db.execute(
        sql`insert into expert_card_reviews(draft_id,user_id,revision,action,public_payload,public_digest,manager_id,manager_session_hash,safety_proof,warning_acknowledgment) values(${d.draftId}::uuid,${f.userId}::uuid,1,'approve',${JSON.stringify(unsafe)}::jsonb,'sha256:'||encode(digest(${JSON.stringify(unsafe)}::jsonb::text,'sha256'),'hex'),${managerId}::uuid,${manager.sessionHash},'{"blocked":false}',${"a".repeat(64)})`,
      ),
    ).rejects.toThrow();
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_card_reviews where draft_id=${d.draftId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  });
  it("atomically publishes only valid policies, rejects missing/corrupt active policy and serializes an approval race", async () => {
    const f = await linked();
    await f.card.addEntry({
      ...event(f.work),
      expectedRevision: 0,
      entry: { kind: "text", text: "обычная практика" },
    });
    await f.card.submitDraft({ ...event(f.work), expectedRevision: 1 });
    await f.card.editPublicCard({
      sessionHash: manager.sessionHash,
      applicationId: f.applicationId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      publicCard,
    });
    const previous = (
      await database.db.execute<{ policy_id: string }>(
        sql`select policy_id from resident_safety_active`,
      )
    ).rows[0]!.policy_id;
    const managerId = (
      await database.db.execute<{ admin_id: string }>(
        sql`select admin_id from admin_sessions where session_id_hash=${manager.sessionHash}`,
      )
    ).rows[0]!.admin_id;
    await database.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${managerId}::uuid,'security_admin') on conflict do nothing`,
    );
    const candidate = async (pattern: string) => {
      const id = randomUUID();
      await database.db.execute(
        sql`insert into resident_safety_policies(id) values(${id}::uuid)`,
      );
      await database.db.execute(
        sql`insert into forbidden_patterns(policy_id,pattern_regex,category,severity_level,error_message_template,provenance,positive_witness) values(${id}::uuid,${pattern},'MEDICAL_CLAIM','BLOCKER','Исправьте текст','test','обычная практика')`,
      );
      return id;
    };
    const bad = await candidate("(a+)+");
    await expect(
      database.db.execute(
        sql`select resident_safety_publish(${bad}::uuid,${managerId}::uuid,${manager.sessionHash})`,
      ),
    ).rejects.toThrow();
    expect(
      (
        await database.db.execute(
          sql`select policy_id from resident_safety_active`,
        )
      ).rows[0]?.policy_id,
    ).toBe(previous);
    const fresh = await candidate("обычная");
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (reached = r));
    const publish = database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select resident_safety_publish(${fresh}::uuid,${managerId}::uuid,${manager.sessionHash})`,
      );
      reached();
      await gate;
    });
    await started;
    const approving = f.card.reviewCard({
      sessionHash: manager.sessionHash,
      applicationId: f.applicationId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      action: "approve",
    });
    release();
    await publish;
    expect(await approving).toMatchObject({ safetyBlocked: true });
    expect((await assess({ bio: "обычная практика" })).blocked).toBe(true);
    await database.db.execute(
      sql`select resident_safety_publish(${previous}::uuid,${managerId}::uuid,${manager.sessionHash})`,
    );
    expect(await probeSafetyFault("missing")).toEqual({
      kind: "denied",
      code: "P0001",
    });
    // Failed transactions leave the singleton intact; a missing policy cannot pass.
    expect(
      (
        await database.db.execute(
          sql`select policy_id from resident_safety_active`,
        )
      ).rows[0]?.policy_id,
    ).toBe(previous);
    await expect(
      database.db.execute(
        sql`update forbidden_patterns set compiled='{}' where policy_id=${previous}::uuid`,
      ),
    ).rejects.toThrow();
  });
  it("denies corrupted engines/programs and lock exhaustion without saving content", async () => {
    const f = await linked();
    for (const fault of ["engine", "compiled"] as const) {
      expect(await probeSafetyFault(fault)).toEqual({
        kind: "denied",
        code: "P0001",
      });
    }
    let release!: () => void, ready!: () => void;
    const hold = new Promise<void>((r) => (release = r)),
      locked = new Promise<void>((r) => (ready = r));
    const holder = database.db.transaction(async (tx) => {
      await tx.execute(sql`select * from resident_safety_active for update`);
      ready();
      await hold;
    });
    await locked;
    try {
      await expect(
        f.card.addEntry({
          ...event(f.work),
          expectedRevision: 0,
          entry: { kind: "text", text: "обычная практика" },
        }),
      ).rejects.toThrow("card_storage_unavailable");
    } finally {
      release();
      await holder;
    }
    expect((await f.card.getWorkflow(f.work))?.entryCount).toBe(0);
  });
  it("allows removal of each legacy forbidden tag while other forbidden selections remain", async () => {
    const f = await linked();
    await f.card.addEntry({
      ...event(f.work),
      expectedRevision: 0,
      entry: { kind: "text", text: "обычная практика" },
    });
    const d = (await f.card.getWorkflow(f.work))!;
    const tags = (
      await database.db.execute<{ id: string; display_label: string }>(
        sql`select id,display_label from hashtags_db where is_active order by id limit 2`,
      )
    ).rows;
    for (const tag of tags) {
      await database.db.execute(
        sql`insert into expert_card_draft_tags(draft_id,user_id,tag_id) values(${d.draftId}::uuid,${f.userId}::uuid,${tag.id}::uuid)`,
      );
    }
    // These selections were valid when saved; a later catalogue change makes
    // them legacy forbidden labels that the owner must still be able to remove.
    for (const tag of tags)
      await database.db.execute(
        sql`update hashtags_db set display_label='#быстрые_деньги' where id=${tag.id}::uuid`,
      );
    for (const [index, tag] of tags.entries())
      expect(
        await f.card.toggleDraftTag({
          ...event(f.work),
          expectedRevision: index + 1,
          tagId: tag.id,
        }),
      ).toMatchObject({ revision: index + 2, safetyBlocked: false });
    expect((await f.card.getDraftTags(f.work)).tags_array).toEqual([]);
    for (const tag of tags)
      await database.db.execute(
        sql`update hashtags_db set display_label=${tag.display_label} where id=${tag.id}::uuid`,
      );
  });
  it("erases private incidents/outcomes and denies foreign, stale, replayed or post-erasure writes", async () => {
    const f = await linked();
    const input = {
      ...event(f.work),
      expectedRevision: 0,
      entry: { kind: "text" as const, text: "вылечу рак" },
    };
    await f.card.addEntry(input);
    const foreign = await linked();
    await expect(
      f.card.addEntry({ ...input, ...foreign.work }),
    ).rejects.toThrow("card_idempotency_conflict");
    await expect(
      f.card.correctEntry({
        ...event(f.work),
        expectedRevision: 5,
        entryId: randomUUID(),
        text: "обычный ответ",
      }),
    ).rejects.toThrow("card_revision_conflict");
    await erase(f.userId);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from security_logs where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from resident_safety_outcomes where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    await expect(f.card.addEntry(input)).rejects.toThrow();
  });
  it("R1 rejects direct publication/pointer writes and never revives old review authority after authorized rollback", async () => {
    const initial = (
      await database.db.execute<{ policy_id: string }>(
        sql`select policy_id from resident_safety_active`,
      )
    ).rows[0]!.policy_id;
    const before = await assess({ bio: "обычная практика" });
    const f = await linked();
    await f.card.addEntry({
      ...event(f.work),
      expectedRevision: 0,
      entry: { kind: "text", text: "#приворот" },
    });
    await f.card.submitDraft({ ...event(f.work), expectedRevision: 1 });
    await f.card.editPublicCard({
      sessionHash: manager.sessionHash,
      applicationId: f.applicationId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      publicCard,
    });
    const detail = (await f.card.readDraft(
      manager.sessionHash,
      f.applicationId,
    ))!;
    await f.card.reviewCard({
      sessionHash: manager.sessionHash,
      applicationId: f.applicationId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      action: "approve",
      warningAcknowledgment: detail.safety.digest,
    });
    await f.card.submitPromoProof({
      ...event(f.work),
      expectedRevision: 2,
      proof: { kind: "link", reference: "https://example.org/promo" },
    });
    const confirmed = await f.card.confirmPromo({
      sessionHash: manager.sessionHash,
      applicationId: f.applicationId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
    });
    const valid = async () =>
      (
        await database.db.execute(
          sql`select expert_card_activation_gate_valid(${f.userId}::uuid,${confirmed.reviewId!}::uuid) valid`,
        )
      ).rows[0]?.valid;
    expect(await valid()).toBe(true);

    await expect(
      database.db.execute(
        sql`update resident_safety_active set policy_id=${initial}::uuid`,
      ),
    ).rejects.toThrow();
    const candidate = randomUUID();
    await expect(
      database.db.execute(
        sql`insert into resident_safety_policies(id,published_at) values(${candidate}::uuid,clock_timestamp())`,
      ),
    ).rejects.toThrow();
    await database.db.execute(
      sql`insert into resident_safety_policies(id) values(${candidate}::uuid)`,
    );
    await database.db.execute(
      sql`insert into forbidden_patterns(policy_id,pattern_regex,category,severity_level,error_message_template,provenance,positive_witness) values(${candidate}::uuid,'обычная','MEDICAL_CLAIM','BLOCKER','Исправьте текст','regression','обычная')`,
    );
    await expect(
      database.db.execute(
        sql`update resident_safety_policies set published_at=clock_timestamp() where id=${candidate}::uuid`,
      ),
    ).rejects.toThrow();
    const managerId = (
      await database.db.execute<{ admin_id: string }>(
        sql`select admin_id from admin_sessions where session_id_hash=${manager.sessionHash}`,
      )
    ).rows[0]!.admin_id;
    await database.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${managerId}::uuid,'security_admin') on conflict do nothing`,
    );
    await expect(
      database.db.execute(
        sql`select resident_safety_publish(${candidate}::uuid,${managerId}::uuid,${"sha256:" + "0".repeat(64)})`,
      ),
    ).rejects.toThrow();
    await database.db.execute(
      sql`select resident_safety_publish(${candidate}::uuid,${managerId}::uuid,${manager.sessionHash})`,
    );
    expect((await assess({ bio: "обычная практика" })).blocked).toBe(true);
    await expect(
      database.db.execute(
        sql`update resident_safety_active set policy_id=${initial}::uuid`,
      ),
    ).rejects.toThrow();
    await database.db.execute(
      sql`select resident_safety_publish(${initial}::uuid,${managerId}::uuid,${manager.sessionHash})`,
    );
    expect(await valid()).toBe(false);
    const after = await assess({ bio: "обычная практика" });
    expect(after.blocked).toBe(false);
    expect(after.policyId).toBe(before.policyId);
    expect(after.digest).not.toBe(before.digest);
  });
  it("R2 discards and replaces a legacy blocked proposal through the owner bot at100 media entries", async () => {
    const f = await linked();
    const source = event(f.work);
    await f.card.addEntry({
      ...source,
      expectedRevision: 0,
      entry: { kind: "document", reference: "telegram:file:source_proposal" },
    });
    await f.card.completeDocumentImport({
      ...source,
      expectedRevision: 1,
      proposal: { source: "pdf", content: "обычная практика ".repeat(8) },
    });
    const d = (await f.card.getWorkflow(f.work))!;
    await database.db.execute(
      sql`insert into expert_card_entries(draft_id,user_id,revision,kind,media_reference) select ${d.draftId}::uuid,${f.userId}::uuid,n,'document','telegram:file:original_'||n from generate_series(2,100) n`,
    );
    for (let revision = 2; revision <= 100; revision++)
      await database.db.execute(
        sql`update expert_card_drafts set revision=${revision} where id=${d.draftId}::uuid`,
      );
    await database.db.execute(
      sql`update expert_card_drafts set document_proposal=jsonb_build_object('source','pdf','content',${"вылечу рак. " + "старое описание ".repeat(8)}::text) where id=${d.draftId}::uuid`,
    );
    const other = await linked();
    const app = await workHttp(f.card);
    const send = (text: string, scope = f.work, update = ++sequence) =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token": "synthetic-core-webhook-secret",
        },
        payload: {
          update_id: update,
          message: {
            from: { id: Number(scope.telegramUserId) },
            chat: { id: Number(scope.chatId), type: "private" },
            text,
          },
        },
      });
    try {
      await send("/card_document 100 discard", other.work);
      await send("/card_document 99 discard");
      expect(
        (await f.card.readDraft(manager.sessionHash, f.applicationId))?.safety
          .blocked,
      ).toBe(true);
      expect(
        (
          await send(
            "/card_document 100 replace Работаю с темой благополучия. " +
              "Описание консультации. ".repeat(3),
          )
        ).body,
      ).toContain("Предложение из файла заменено");
      expect((await f.card.getWorkflow(f.work))?.entryCount).toBe(100);
      const update = ++sequence;
      expect(
        (await send("/card_document 101 discard", f.work, update)).body,
      ).toContain("Предложение из файла удалено");
      await send("/card_document 101 discard", f.work, update);
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from resident_card_proposal_changes where draft_id=${d.draftId}::uuid`,
          )
        ).rows[0]?.n,
      ).toBe(2);
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_card_entries where draft_id=${d.draftId}::uuid`,
          )
        ).rows[0]?.n,
      ).toBe(100);
      expect((await send("/card_submit 102")).body).toContain(
        "передана менеджеру",
      );
    } finally {
      await app.close();
    }
  });
});
