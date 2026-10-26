import { createDb, type DrizzleDb } from "../../packages/db/src/client.js";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createSafeDocumentParser } from "../../packages/integrations/src/documents/safe-document-parser.js";
import { createRequire } from "node:module";
import { telegramWebhookRoutes } from "../../apps/api/src/routes/telegram-webhook.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  createYooKassaClient,
  YooKassaOnboardingPaymentVerifier,
} from "@ii-tonya/integrations";
import { verifyExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import { PostgresExpertVerificationRepository } from "../../packages/db/src/repositories/expert-verification-repository.js";
import { PostgresExpertCardRepository } from "../../packages/db/src/repositories/expert-card-repository.js";
import { PostgresResidentWorkspaceRepository } from "../../packages/db/src/repositories/resident-workspace-repository.js";
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
function workspace(
  send?: (i: {
    botId: string;
    botKey: string;
    chatId: string;
    text: string;
    signal: AbortSignal;
  }) => Promise<{ botId: string; chatId: string; messageId: string }>,
) {
  return new PostgresResidentWorkspaceRepository(database.db, {
    messagingConsentPolicyVersion: "client-messaging-v1",
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
    workBotUsername: "synthetic_work_bot",
    ...(send ? { notifier: { send } } : {}),
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
describe("residency core stabilization PG17.5", () => {
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
  it("activates once inside canonical settlement, denies unpaid/erased/withdrawn and never grants main", async () => {
    const unpaid = await onboarding();
    expect(await workspace().activateResidentWorkspace(unpaid.userId)).toEqual({
      kind: "denied",
    });
    const f = await paid();
    expect(await workspace().activateResidentWorkspace(f.userId)).toMatchObject(
      { kind: "activated", access: "interview", replay: true },
    );
    await verification.settleVerified(f.proof);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from audit_events where action='ACCESS_ACTIVATED' and object_id=${f.applicationId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_residency_orders`,
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
    await database.db.execute(
      sql`update users set active=false where id=${f.userId}::uuid`,
    );
    expect(await workspace().activateResidentWorkspace(f.userId)).toEqual({
      kind: "denied",
    });
    await erase(f.userId);
    expect(await workspace().activateResidentWorkspace(f.userId)).toEqual({
      kind: "denied",
    });
    expect(await verification.settleVerified(f.proof)).toMatchObject({
      replay: true,
      stage: null,
    });
  });
  it("delivers an owned handoff once and quarantines ambiguous outcomes", async () => {
    const f = await paid();
    let text = "";
    const send = vi.fn(
      async (i: {
        botId: string;
        botKey: string;
        chatId: string;
        text: string;
        signal: AbortSignal;
      }) => {
        text = i.text;
        return { botId: i.botId, chatId: i.chatId, messageId: "123" };
      },
    );
    const job = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_verification_work where application_id=${f.applicationId}::uuid and kind='interview_ready'`,
      )
    ).rows[0]!;
    const repo = workspace(send);
    expect(
      await repo.deliverMaterials(job.id, {
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "delivered" });
    expect(text).toContain("?start=card_");
    expect(
      await repo.deliverMaterials(job.id, {
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "already_delivered" });
    expect(send).toHaveBeenCalledTimes(1);
    const foreign = {
      ...workScope,
      telegramUserId: "99999999",
      chatId: "99999999",
    };
    await expect(
      cards().redeemWorkHandoff({
        ...event(foreign),
        token: text.split("card_")[1]!,
      }),
    ).rejects.toThrow("card_handoff_unavailable");
    const next = await paid();
    const unknown = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_verification_work where application_id=${next.applicationId}::uuid and kind='interview_ready'`,
      )
    ).rows[0]!;
    const fail = vi.fn(async () => {
      throw new Error("synthetic ambiguous send");
    });
    expect(
      await workspace(fail).deliverMaterials(unknown.id, {
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "unknown_outcome" });
    expect(
      await workspace(fail).deliverMaterials(unknown.id, {
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "unknown_outcome" });
    expect(fail).toHaveBeenCalledTimes(1);
    expect(
      (
        await database.db.execute(
          sql`select status,attempt_id from expert_verification_work where id=${unknown.id}::uuid`,
        )
      ).rows[0],
    ).toMatchObject({ status: "unknown_outcome" });
  });
  it("cancels notification after original identity is removed", async () => {
    const f = await paid();
    const send = vi.fn(async (i: { botId: string; chatId: string }) => ({
      botId: i.botId,
      chatId: i.chatId,
      messageId: "123",
    }));
    await database.db.execute(
      sql`update channel_identities set status='blocked' where user_id=${f.userId}::uuid`,
    );
    const job = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_verification_work where application_id=${f.applicationId}::uuid and kind='interview_ready'`,
      )
    ).rows[0]!;
    expect(
      await workspace(send).deliverMaterials(job.id, {
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "cancelled" });
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await database.db.execute(
          sql`select status from expert_verification_work where id=${job.id}::uuid`,
        )
      ).rows[0]?.status,
    ).toBe("cancelled");
    expect(
      (await workspace(send).listDueMaterialJobs(50)).map((j) => j.jobId),
    ).not.toContain(job.id);
  });
  it("keeps original document and manual interview through fallback, stale completion and erasure", async () => {
    const f = await linked();
    const e = event(f.work);
    const saved = await f.card.addEntry({
      ...e,
      expectedRevision: 0,
      entry: { kind: "document", reference: "telegram:file:synthetic_doc" },
    });
    expect(
      await f.card.completeDocumentImport({
        ...e,
        expectedRevision: saved.revision,
        proposal: null,
      }),
    ).toBe(true);
    expect(
      (
        await database.db.execute(
          sql`select input_mode,document_proposal from expert_card_drafts where user_id=${f.userId}::uuid`,
        )
      ).rows[0],
    ).toEqual({ input_mode: "INTERVIEW", document_proposal: null });
    expect((await cards().getWorkflow(f.work))?.entryCount).toBe(1);
    const proposal = {
      source: "pdf" as const,
      content: "Private untrusted biography ".repeat(5),
    };
    await f.card.addEntry({
      ...event(f.work),
      expectedRevision: 1,
      entry: { kind: "text", text: "newer answer" },
    });
    expect(
      await f.card.completeDocumentImport({
        ...e,
        expectedRevision: 1,
        proposal,
      }),
    ).toBe(false);
    const next = event(f.work);
    await f.card.addEntry({
      ...next,
      expectedRevision: 2,
      entry: { kind: "document", reference: "telegram:file:synthetic_next" },
    });
    expect(
      await f.card.completeDocumentImport({
        ...next,
        expectedRevision: 3,
        proposal,
      }),
    ).toBe(true);
    expect(
      await f.card.completeDocumentImport({
        ...next,
        expectedRevision: 3,
        proposal: null,
      }),
    ).toBe(false);
    expect(
      (
        await database.db.execute(
          sql`select input_mode from expert_card_drafts where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.input_mode,
    ).toBe("DOCUMENT_PROPOSAL");
    expect(
      (
        await database.db.execute(
          sql`select public_payload from expert_card_drafts where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.public_payload,
    ).toBeNull();
    await erase(f.userId);
    expect(
      await f.card.completeDocumentImport({
        ...next,
        expectedRevision: 3,
        proposal,
      }),
    ).toBe(false);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_card_drafts where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  });
  it("loads all164 owner tags, rejects malformed proposal/catalogue and preserves old projection", async () => {
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n,count(distinct parent_category)::int categories,min(weight_score) weight from hashtags_db`,
        )
      ).rows[0],
    ).toEqual({ n: 164, categories: 7, weight: 5 });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from hashtags_taxonomy`,
        )
      ).rows[0]?.n,
    ).toBe(164);
    const f = await linked();
    await f.card.getDraftTags(f.work);
    for (const proposal of [
      { source: null, content: null },
      { source: "pdf", content: 42 },
      { source: "pdf", content: "x".repeat(50), extra: true },
    ])
      await expect(
        database.db.execute(
          sql`update expert_card_drafts set input_mode='DOCUMENT_PROPOSAL',document_proposal=${JSON.stringify(proposal)}::jsonb where user_id=${f.userId}::uuid`,
        ),
      ).rejects.toThrow();
    await expect(
      database.db.execute(
        sql`update hashtags_db set synonyms_json='[null]'::jsonb where id=(select id from hashtags_db limit 1)`,
      ),
    ).rejects.toThrow();
  });
  it("saves owned active draft tags with revisions/replay/limit20 and erases selection", async () => {
    const f = await linked();
    const page = await f.card.getDraftTags(f.work);
    expect(page.tags).toHaveLength(8);
    expect(page.pages).toBe(21);
    const first = page.tags[0]!;
    const action = { ...event(f.work), expectedRevision: 0, tagId: first.id };
    expect(await f.card.toggleDraftTag(action)).toMatchObject({
      revision: 1,
      replay: false,
    });
    expect(await f.card.toggleDraftTag(action)).toMatchObject({
      revision: 1,
      replay: true,
    });
    expect((await f.card.getDraftTags(f.work)).tags_array).toEqual([
      first.label,
    ]);
    await expect(
      f.card.toggleDraftTag({ ...action, tagId: page.tags[1]!.id }),
    ).rejects.toThrow("card_idempotency_conflict");
    await expect(
      f.card.toggleDraftTag({
        ...event(f.work),
        expectedRevision: 0,
        tagId: first.id,
      }),
    ).rejects.toThrow("card_revision_conflict");
    await expect(
      f.card.toggleDraftTag({
        ...event({ ...f.work, chatId: "1" }),
        expectedRevision: 1,
        tagId: first.id,
      }),
    ).rejects.toThrow();
    const all = (
      await database.db.execute<{ id: string }>(
        sql`select id from hashtags_db where id<>${first.id}::uuid order by id limit 20`,
      )
    ).rows;
    let rev = 1;
    for (const row of all.slice(0, 19)) {
      await f.card.toggleDraftTag({
        ...event(f.work),
        expectedRevision: rev++,
        tagId: row.id,
      });
    }
    await expect(
      f.card.toggleDraftTag({
        ...event(f.work),
        expectedRevision: 20,
        tagId: all[19]!.id,
      }),
    ).rejects.toThrow();
    expect((await f.card.getDraftTags(f.work)).tags_array).toHaveLength(20);
    await database.db.execute(
      sql`update hashtags_db set is_active=false where id=${all[19]!.id}::uuid`,
    );
    await expect(
      f.card.toggleDraftTag({
        ...event(f.work),
        expectedRevision: 20,
        tagId: all[19]!.id,
      }),
    ).rejects.toThrow("card_invalid_tags");
    await expect(
      f.card.toggleDraftTag({
        ...event(f.work),
        expectedRevision: 20,
        tagId: randomUUID(),
      }),
    ).rejects.toThrow("card_invalid_tags");
    await database.db.execute(
      sql`update hashtags_db set is_active=true where id=${all[19]!.id}::uuid`,
    );
    await erase(f.userId);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_card_draft_tags where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  });
  it("runs real work-bot import fallback and paginated InlineButton save/reload with abuse denial", async () => {
    const f = await linked();
    const parser = vi.fn(async () => {
      throw new Error("PRIVATE_PARSER_SENTINEL");
    });
    const app = await workHttp(f.card, {
      read: async () => ({ bytes: Buffer.from("broken"), type: "pdf" }),
      parser: { parse: parser },
    });
    const post = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token": "synthetic-core-webhook-secret",
        },
        payload,
      });
    const message = (body: object) => ({
      update_id: ++sequence,
      message: {
        from: { id: Number(f.work.telegramUserId) },
        chat: { id: Number(f.work.chatId), type: "private" },
        ...body,
      },
    });
    try {
      const fallback = await post(
        message({ document: { file_id: "synthetic_upload" } }),
      );
      expect(fallback.statusCode).toBe(200);
      expect(fallback.json().text).toBe(
        "Не удалось автоматически прочитать файл. Возможно, это картинка или сложный формат. Давайте заполним данные вручную.",
      );
      expect(parser).toHaveBeenCalledTimes(1);
      const state = (
        await database.db.execute(
          sql`select input_mode,document_proposal from expert_card_drafts where user_id=${f.userId}::uuid`,
        )
      ).rows[0];
      expect(state).toEqual({
        input_mode: "INTERVIEW",
        document_proposal: null,
      });
      const menu = await post(message({ text: "/tags" }));
      expect(menu.statusCode).toBe(200);
      const data = menu.json().reply_markup.inline_keyboard[0][0]
        .callback_data as string;
      const callback = (patch: object = {}) => ({
        update_id: ++sequence,
        callback_query: {
          id: "synthetic-callback",
          data,
          from: { id: Number(f.work.telegramUserId) },
          message: {
            from: { id: Number(workScope.botId), is_bot: true },
            chat: { id: Number(f.work.chatId), type: "private" },
            text: "Теги",
          },
          ...patch,
        },
      });
      const successfulCallback = callback();
      const selected = await post(successfulCallback);
      expect(selected.statusCode).toBe(200);
      expect(selected.json().text).toContain("1/20");
      const replay = await post(successfulCallback);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ duplicate: true });
      const reload = await post(message({ text: "/tags" }));
      expect(reload.json().text).toContain("1/20");
      const row = (
        await database.db.execute(
          sql`select count(*)::int n from expert_card_draft_tags where user_id=${f.userId}::uuid`,
        )
      ).rows[0];
      expect(row?.n).toBe(1);
      for (const patch of [
        { from: { id: 999999 } },
        {
          message: {
            from: { id: 818181, is_bot: true },
            chat: { id: Number(f.work.chatId), type: "group" },
            text: "Теги",
          },
        },
        {
          message: {
            from: { id: 919191, is_bot: true },
            chat: { id: Number(f.work.chatId), type: "private" },
            text: "Теги",
          },
        },
        { message: { from: { id: 818181, is_bot: true }, text: "Теги" } },
      ])
        expect((await post(callback(patch))).statusCode).toBe(400);
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_residency_orders`,
          )
        ).rows[0]?.n,
      ).toBe(0);
    } finally {
      await app.close();
    }
  });
  it("denies current consent withdrawal for activation, import completion and notification", async () => {
    const f = await linked();
    const e = event(f.work);
    await f.card.addEntry({
      ...e,
      expectedRevision: 0,
      entry: { kind: "document", reference: "telegram:file:withdrawn" },
    });
    const privacy = new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: { enabled: true },
    });
    await privacy.withdrawConsentAtomically({
      targetUserId: f.userId,
      purpose: "client_messaging",
      policyVersion: "client-messaging-v1",
      correlationId: `core-withdraw:${f.userId}`,
    });
    expect(await workspace().activateResidentWorkspace(f.userId)).toEqual({
      kind: "denied",
    });
    expect(
      await f.card.completeDocumentImport({
        ...e,
        expectedRevision: 1,
        proposal: { source: "pdf", content: "private ".repeat(20) },
      }),
    ).toBe(false);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from resident_workspace_access where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    const send = vi.fn(async (i: { botId: string; chatId: string }) => ({
      botId: i.botId,
      chatId: i.chatId,
      messageId: "123",
    }));
    const job = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_verification_work where application_id=${f.applicationId}::uuid and kind='interview_ready'`,
      )
    ).rows[0]!;
    expect(
      await workspace(send).deliverMaterials(job.id, {
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "cancelled" });
    expect(send).not.toHaveBeenCalled();
  });
  it.runIf(!!process.env.II_TONYA_PARSER_PYTHON)(
    "extracts actual PDF and DOCX through Fastify, saves private proposal and leaves publication empty",
    async () => {
      const python = process.env.II_TONYA_PARSER_PYTHON!;
      const data = JSON.parse(
        execFileSync(
          python,
          [
            "-I",
            "-c",
            `import io,json,base64,pymupdf;from docx import Document
text='Synthetic private biography for complete local work bot parser acceptance. '*3
pdf=pymupdf.open();pdf.new_page().insert_text((50,50),text)
doc=Document();doc.add_paragraph(text);out=io.BytesIO();doc.save(out)
print(json.dumps({'pdf':base64.b64encode(pdf.tobytes()).decode(),'docx':base64.b64encode(out.getvalue()).decode()}))`,
          ],
          { maxBuffer: 1024 * 1024 },
        ).toString(),
      );
      for (const type of ["pdf", "docx"] as const) {
        const f = await linked();
        const app = await workHttp(f.card, {
          read: async () => ({
            bytes: Buffer.from(data[type], "base64"),
            type,
          }),
          parser: createSafeDocumentParser({
            enabled: true,
            pythonExecutable: python,
            helperPath: resolve("packages/integrations/parser/helper.py"),
          }),
        });
        try {
          const response = await app.inject({
            method: "POST",
            url: "/v1/webhooks/telegram",
            headers: {
              "x-telegram-bot-api-secret-token":
                "synthetic-core-webhook-secret",
            },
            payload: {
              update_id: ++sequence,
              message: {
                from: { id: Number(f.work.telegramUserId) },
                chat: { id: Number(f.work.chatId), type: "private" },
                document: { file_id: `synthetic_${type}` },
              },
            },
          });
          expect(response.statusCode).toBe(200);
          expect(response.json().text).toContain(
            "приватный неподтверждённый черновик",
          );
          const row = (
            await database.db.execute(
              sql`select input_mode,document_proposal,public_payload from expert_card_drafts where user_id=${f.userId}::uuid`,
            )
          ).rows[0]!;
          expect(row.input_mode).toBe("DOCUMENT_PROPOSAL");
          expect(row.document_proposal).toMatchObject({ source: type });
          expect(row.public_payload).toBeNull();
          expect((await f.card.getWorkflow(f.work))?.entryCount).toBe(1);
        } finally {
          await app.close();
        }
      }
    },
  );
  it("prevents delayed parser completion from overwriting a newer interview revision", async () => {
    const f = await linked();
    let started: () => void = () => {},
      release: (v: { source: "pdf"; content: string }) => void = () => {};
    const begin = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<{ source: "pdf"; content: string }>(
      (resolve) => {
        release = resolve;
      },
    );
    const app = await workHttp(f.card, {
      read: async () => ({ bytes: Buffer.from("synthetic"), type: "pdf" }),
      parser: {
        parse: async () => {
          started();
          return pending;
        },
      },
    });
    try {
      const response = app.inject({
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
            document: { file_id: "synthetic_delayed" },
          },
        },
      });
      const sending = Promise.resolve(response);
      await begin;
      await f.card.addEntry({
        ...event(f.work),
        expectedRevision: 1,
        entry: { kind: "text", text: "newer answer" },
      });
      release({
        source: "pdf",
        content: "Untrusted delayed content ".repeat(5),
      });
      expect((await sending).json().text).toContain("Карточка уже изменилась");
      expect(
        (
          await database.db.execute(
            sql`select input_mode,document_proposal,revision from expert_card_drafts where user_id=${f.userId}::uuid`,
          )
        ).rows[0],
      ).toEqual({
        input_mode: "INTERVIEW",
        document_proposal: null,
        revision: 2,
      });
    } finally {
      release({ source: "pdf", content: "release for teardown ".repeat(5) });
      await app.close();
    }
  });
  it("R1 commits notification token before disclosure and permits independently queued redemption", async () => {
    const f = await paid();
    const independent = createDb(database.db.$client.options.connectionString!);
    let redemption: Promise<unknown> | undefined;
    try {
      const target = new PostgresExpertCardRepository(independent, {
        messagingConsentPolicyVersion: "client-messaging-v1",
        workBotId: workScope.botId,
        workBotKey: workScope.botKey,
      });
      const send = vi.fn(
        async (i: {
          botId: string;
          botKey: string;
          chatId: string;
          text: string;
          signal: AbortSignal;
        }) => {
          const token = i.text.split("card_")[1]!;
          expect(
            (
              await independent.execute(
                sql`select count(*)::int n from expert_card_handoffs where token_digest=${`sha256:${hash(token)}`}`,
              )
            ).rows[0]?.n,
          ).toBe(1);
          redemption = target.redeemWorkHandoff({
            ...event({
              ...workScope,
              telegramUserId: f.scope.telegramUserId,
              chatId: f.scope.chatId,
            }),
            token,
          });
          return { botId: i.botId, chatId: i.chatId, messageId: "123" };
        },
      );
      const job = (
        await database.db.execute<{ id: string }>(
          sql`select id from expert_verification_work where application_id=${f.applicationId}::uuid and kind='interview_ready'`,
        )
      ).rows[0]!;
      expect(
        await workspace(send).deliverMaterials(job.id, {
          signal: new AbortController().signal,
        }),
      ).toEqual({ kind: "delivered" });
      expect(await redemption).toMatchObject({ kind: "linked" });
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      await redemption?.catch(() => undefined);
      await independent.$client.end();
    }
  });
  it("R1-R2 keeps prepared and interactive links after failed transport and completion write", async () => {
    const f = await paid();
    const original = await cards().issueWorkHandoff(event(f.scope));
    if (original.kind !== "issued") throw new Error("fixture_link_missing");
    let disclosed = "";
    const send = vi.fn(
      async (i: {
        botId: string;
        botKey: string;
        chatId: string;
        text: string;
        signal: AbortSignal;
      }) => {
        disclosed = i.text.split("card_")[1]!;
        return { botId: i.botId, chatId: i.chatId, messageId: "123" };
      },
    );
    const job = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_verification_work where application_id=${f.applicationId}::uuid and kind='interview_ready'`,
      )
    ).rows[0]!;
    await database.db.execute(
      sql.raw(
        `create function core_test_completion_failure() returns trigger language plpgsql as $$ begin if new.id='${job.id}'::uuid and new.status='completed' then raise exception 'synthetic completion unavailable'; end if; return new; end $$;create trigger core_test_completion_failure before update on expert_verification_work for each row execute function core_test_completion_failure()`,
      ),
    );
    try {
      expect(
        await workspace(send).deliverMaterials(job.id, {
          signal: new AbortController().signal,
        }),
      ).toEqual({ kind: "unknown_outcome" });
    } finally {
      await database.db.execute(
        sql`drop trigger core_test_completion_failure on expert_verification_work;drop function core_test_completion_failure()`,
      );
    }
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_card_handoffs where token_digest=${`sha256:${hash(disclosed)}`}`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    const target = {
      ...workScope,
      telegramUserId: f.scope.telegramUserId,
      chatId: f.scope.chatId,
    };
    expect(
      await cards().redeemWorkHandoff({ ...event(target), token: disclosed }),
    ).toMatchObject({ kind: "linked" });
    expect(
      await workspace(send).deliverMaterials(job.id, {
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "unknown_outcome" });
    expect(send).toHaveBeenCalledTimes(1);
    const next = await paid();
    const interactive = await cards().issueWorkHandoff(event(next.scope));
    if (interactive.kind !== "issued") throw new Error("fixture_link_missing");
    const nextJob = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_verification_work where application_id=${next.applicationId}::uuid and kind='interview_ready'`,
      )
    ).rows[0]!;
    await workspace(async () => {
      throw new Error("synthetic pre-send rejection");
    }).deliverMaterials(nextJob.id, { signal: new AbortController().signal });
    expect(
      await cards().redeemWorkHandoff({
        ...event({
          ...workScope,
          telegramUserId: next.scope.telegramUserId,
          chatId: next.scope.chatId,
        }),
        token: interactive.token,
      }),
    ).toMatchObject({ kind: "linked" });
  });
  it("R3 recovers unknown crash-before-transport through genuine owner handoff without retry", async () => {
    const f = await paid();
    const controller = new AbortController();
    let transactions = 0;
    const proxied = new Proxy(database.db, {
      get(target, key, receiver) {
        if (key !== "transaction") return Reflect.get(target, key, receiver);
        return (async (...args: Parameters<DrizzleDb["transaction"]>) => {
          const value = await target.transaction(...args);
          if (++transactions === 1) controller.abort();
          return value;
        }) as DrizzleDb["transaction"];
      },
    });
    const send = vi.fn(async (i: { botId: string; chatId: string }) => ({
      botId: i.botId,
      chatId: i.chatId,
      messageId: "123",
    }));
    const repo = new PostgresResidentWorkspaceRepository(proxied, {
      messagingConsentPolicyVersion: "client-messaging-v1",
      workBotId: workScope.botId,
      workBotKey: workScope.botKey,
      workBotUsername: "synthetic_work_bot",
      notifier: { send },
    });
    const job = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_verification_work where application_id=${f.applicationId}::uuid and kind='interview_ready'`,
      )
    ).rows[0]!;
    expect(
      await repo.deliverMaterials(job.id, { signal: controller.signal }),
    ).toEqual({ kind: "unknown_outcome" });
    expect(send).not.toHaveBeenCalled();
    const recoveryService = createExpertCardService({
      enabled: true,
      paymentMode: "test",
      ...{
        workBotId: workScope.botId,
        workBotKey: workScope.botKey,
        workBotUsername: "synthetic_work_bot",
      },
      promoScope,
      repository: cards(),
      financial: new PostgresExpertOnboardingMainPaymentRepository(
        database.db,
        {
          messagingConsentPolicyVersion: "client-messaging-v1",
          providerMode: "test",
        },
      ),
    });
    const recovery = await recoveryService.handlePromoHandoff({
      ...f.scope,
      updateId: String(++sequence),
      text: "/work_handoff",
    });
    if (recovery.status !== "handled")
      throw new Error("fixture_recovery_missing");
    const recoveryToken = recovery.text.split("card_")[1]!;
    expect(
      await cards().redeemWorkHandoff({
        ...event({
          ...workScope,
          telegramUserId: f.scope.telegramUserId,
          chatId: f.scope.chatId,
        }),
        token: recoveryToken,
      }),
    ).toMatchObject({ kind: "linked" });
    expect(
      await workspace(send).deliverMaterials(job.id, {
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "unknown_outcome" });
    expect(send).not.toHaveBeenCalled();
  });
  it("R4 denies archive states identically in projection, activation and notification", async () => {
    const f = await paid();
    const definition = (
      await database.db.execute<{ definition: string }>(
        sql`select definition from pg_views where schemaname='public' and viewname='resident_workspace_access'`,
      )
    ).rows[0]!.definition;
    expect(definition).toContain("a.archived_at IS NULL");
    expect(definition).toContain("a.archive_until_date IS NULL");
    await database.db.execute(
      sql`update expert_onboarding_applications set archived_at=clock_timestamp(),archive_until_date=clock_timestamp()+interval '1 day' where id=${f.applicationId}::uuid`,
    );
    expect(await workspace().activateResidentWorkspace(f.userId)).toEqual({
      kind: "denied",
    });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from resident_workspace_access where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    await expect(
      database.db.execute(
        sql`update expert_onboarding_applications set archived_at=null where id=${f.applicationId}::uuid`,
      ),
    ).rejects.toThrow();
  });
  it("R5-R8 acknowledges exact callbacks, traverses real pages, handles scoped replay and bounds pages", async () => {
    const f = await linked();
    const ack = vi.fn(async () => {});
    const app = await workHttp(f.card, undefined, ack);
    const post = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token": "synthetic-core-webhook-secret",
        },
        payload,
      });
    const callback = (data: string, patch: object = {}) => ({
      update_id: ++sequence,
      callback_query: {
        id: `synthetic-${sequence}`,
        data,
        from: { id: Number(f.work.telegramUserId) },
        message: {
          from: { id: Number(workScope.botId), is_bot: true },
          chat: { id: Number(f.work.chatId), type: "private" },
          text: "Теги",
        },
        ...patch,
      },
    });
    try {
      const initial = (
        await post({
          update_id: ++sequence,
          message: {
            from: { id: Number(f.work.telegramUserId) },
            chat: { id: Number(f.work.chatId), type: "private" },
            text: "/tags",
          },
        })
      ).json();
      const firstIds = initial.reply_markup.inline_keyboard
        .slice(0, 8)
        .map((row: { callback_data: string }[]) =>
          row[0]!.callback_data.split(":").at(-1),
        );
      const next = callback(
        initial.reply_markup.inline_keyboard.at(-1)[0].callback_data,
      );
      const second = (await post(next)).json();
      expect(second.text).toContain("Страница 2/21");
      expect(second.reply_markup.inline_keyboard[0][0].callback_data).toContain(
        ":1:",
      );
      expect(
        second.reply_markup.inline_keyboard
          .slice(0, 8)
          .map((row: { callback_data: string }[]) =>
            row[0]!.callback_data.split(":").at(-1),
          )
          .some((id: string) => firstIds.includes(id)),
      ).toBe(false);
      expect(ack).toHaveBeenCalledWith(
        expect.objectContaining({
          botId: workScope.botId,
          callbackQueryId: next.callback_query.id,
        }),
      );
      const selection = callback(
        second.reply_markup.inline_keyboard[0][0].callback_data,
      );
      expect((await post(selection)).json().text).toContain("1/20");
      expect((await post(selection)).json()).toMatchObject({ duplicate: true });
      expect(
        (
          await post({
            ...selection,
            callback_query: {
              ...selection.callback_query,
              data: second.reply_markup.inline_keyboard[1][0].callback_data,
            },
          })
        ).json(),
      ).not.toMatchObject({ duplicate: true });
      const foreign = await linked();
      const acknowledgements = ack.mock.calls.length;
      const forgedReplay = {
        ...selection,
        callback_query: {
          ...selection.callback_query,
          from: { id: Number(foreign.work.telegramUserId) },
          message: {
            from: { id: Number(workScope.botId), is_bot: true },
            chat: { id: Number(foreign.work.chatId), type: "private" },
            text: "Теги",
          },
        },
      };
      expect((await post(forgedReplay)).json()).not.toMatchObject({
        duplicate: true,
      });
      expect(ack).toHaveBeenCalledTimes(acknowledgements);
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_card_draft_tags where user_id=${foreign.userId}::uuid`,
          )
        ).rows[0]?.n,
      ).toBe(0);
      const reload = (await post(callback("ct1:p:1:1"))).json();
      expect(reload.reply_markup.inline_keyboard[0][0].text).toContain("✓");
      const last = (await post(callback("ct1:p:1:20"))).json();
      expect(last.text).toContain("Страница 21/21");
      expect(last.reply_markup.inline_keyboard.at(-1)).toHaveLength(1);
      expect(last.reply_markup.inline_keyboard.at(-1)[0].callback_data).toBe(
        "ct1:p:1:19",
      );
      expect(
        (
          await post(
            callback(last.reply_markup.inline_keyboard.at(-1)[0].callback_data),
          )
        ).json().text,
      ).toContain("Страница 20/21");
      expect((await f.card.getDraftTags(f.work, 21)).page).toBe(20);
      const before = ack.mock.calls.length;
      await post(
        callback("ct1:p:1:1", {
          message: {
            from: { id: 999, is_bot: true },
            chat: { id: Number(f.work.chatId), type: "private" },
            text: "Теги",
          },
        }),
      );
      await post(callback("forged"));
      expect(ack).toHaveBeenCalledTimes(before);
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_card_draft_tags where user_id=${f.userId}::uuid`,
          )
        ).rows[0]?.n,
      ).toBe(1);
    } finally {
      await app.close();
    }
    const empty = await linked();
    await database.db.execute(sql`update hashtags_db set is_active=false`);
    try {
      const result = await empty.card.getDraftTags(empty.work, 21);
      expect(result).toMatchObject({ page: 0, pages: 1, tags: [] });
    } finally {
      await database.db.execute(sql`update hashtags_db set is_active=true`);
    }
  });
  it("R9 exposes inactive selected tags for owned removal then replacement at limit20", async () => {
    const f = await linked();
    const all = (
      await database.db.execute<{ id: string }>(
        sql`select id from hashtags_db order by parent_category,sub_category,tag_value,id limit 21`,
      )
    ).rows;
    for (let revision = 0; revision < 20; revision++)
      await f.card.toggleDraftTag({
        ...event(f.work),
        expectedRevision: revision,
        tagId: all[revision]!.id,
      });
    await database.db.execute(
      sql`update hashtags_db set is_active=false where id=${all[0]!.id}::uuid`,
    );
    const app = await workHttp(f.card);
    const post = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token": "synthetic-core-webhook-secret",
        },
        payload,
      });
    try {
      const menu = (
        await post({
          update_id: ++sequence,
          message: {
            from: { id: Number(f.work.telegramUserId) },
            chat: { id: Number(f.work.chatId), type: "private" },
            text: "/tags",
          },
        })
      ).json();
      const button = menu.reply_markup.inline_keyboard
        .flat()
        .find((b: { callback_data: string }) =>
          b.callback_data.endsWith(all[0]!.id),
        );
      expect(button).toBeDefined();
      expect(button.text).toContain("неактивен");
      expect(menu.text).toContain("20/20");
      const removal = {
        update_id: ++sequence,
        callback_query: {
          id: "remove-inactive",
          data: button.callback_data,
          from: { id: Number(f.work.telegramUserId) },
          message: {
            from: { id: Number(workScope.botId), is_bot: true },
            chat: { id: Number(f.work.chatId), type: "private" },
            text: "Теги",
          },
        },
      };
      expect((await post(removal)).json().text).toContain("19/20");
      expect((await post(removal)).json()).toMatchObject({ duplicate: true });
      await f.card.toggleDraftTag({
        ...event(f.work),
        expectedRevision: 21,
        tagId: all[20]!.id,
      });
      expect((await f.card.getDraftTags(f.work)).tags_array).toHaveLength(20);
      await expect(
        f.card.toggleDraftTag({
          ...event(f.work),
          expectedRevision: 22,
          tagId: all[0]!.id,
        }),
      ).rejects.toThrow("card_invalid_tags");
    } finally {
      await app.close();
      await database.db.execute(sql`update hashtags_db set is_active=true`);
    }
  });
  it("R13 concurrent independent connection claims produce exactly one durable attempt/send", async () => {
    const f = await paid();
    const other = createDb(database.db.$client.options.connectionString!, {
      options: "-c application_name=core_notification_claim2",
    });
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(
      async (i: {
        botId: string;
        botKey: string;
        chatId: string;
        text: string;
        signal: AbortSignal;
      }) => {
        entered();
        await gate;
        return { botId: i.botId, chatId: i.chatId, messageId: "123" };
      },
    );
    const job = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_verification_work where application_id=${f.applicationId}::uuid and kind='interview_ready'`,
      )
    ).rows[0]!;
    const second = new PostgresResidentWorkspaceRepository(other, {
      messagingConsentPolicyVersion: "client-messaging-v1",
      workBotId: workScope.botId,
      workBotKey: workScope.botKey,
      workBotUsername: "synthetic_work_bot",
      notifier: { send },
    });
    try {
      const first = workspace(send).deliverMaterials(job.id, {
        signal: new AbortController().signal,
      });
      await started;
      const contender = second.deliverMaterials(job.id, {
        signal: new AbortController().signal,
      });
      let observedLockWait = false;
      for (let n = 0; n < 30; n++) {
        observedLockWait = (
          await database.db.execute<{ waiting: boolean }>(
            sql`select exists(select 1 from pg_stat_activity where application_name='core_notification_claim2' and wait_event_type='Lock') waiting`,
          )
        ).rows[0]!.waiting;
        if (observedLockWait) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observedLockWait).toBe(true);
      release();
      const results = await Promise.all([first, contender]);
      expect(results.filter((r) => r.kind === "delivered")).toHaveLength(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        (
          await database.db.execute(
            sql`select status,attempt_id from expert_verification_work where id=${job.id}::uuid`,
          )
        ).rows[0],
      ).toMatchObject({ status: "completed", attempt_id: expect.any(String) });
    } finally {
      release();
      await other.$client.end();
    }
  });
});
