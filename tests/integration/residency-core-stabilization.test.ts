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
      const selected = await post(callback());
      expect(selected.statusCode).toBe(200);
      expect(selected.json().text).toContain("1/20");
      const replay = await post(callback());
      expect(replay.statusCode).toBe(200);
      expect(replay.json().text).toContain("Список изменился");
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
});
