import { writeFileSync } from "node:fs";
import { expertCardAdminRoutes } from "../../apps/api/src/routes/expert-cards.js";
import { createExpertCardAdminService } from "../../packages/application/src/expert-card-admin-service.js";
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
  database = await startExpertReferralTestDatabase();
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
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);
it("has public vector cache and immutable generation identity", async () => {
  expect(await database.columnExists("tag_embeddings_cache", "cache")).toBe(
    true,
  );
});
it("canonical aliases and typography count once across service scopes", async () => {
  const r = (
    await database.db.execute(
      sql`select resident_tag_identity('#ТРЕВОГА')=resident_tag_identity('тревожность') as same, resident_tag_identity('портретная_съёмка')=resident_tag_identity('ПОРТРЕТНАЯ съемка') as yo`,
    )
  ).rows[0];
  expect(r).toEqual({ same: true, yo: true });
});
it("mutable SQL tags cannot exceed aggregate20 or bypass moderation", async () => {
  const f = await linked();
  await patch(f, {});
  const d = await f.card.getWorkflow(f.work);
  await expect(
    database.db.execute(
      sql`update expert_card_drafts set semantic_tags=${JSON.stringify(Array.from({ length: 21 }, (_, i) => "Авторская тема " + i))}::jsonb where id=${d!.draftId}::uuid`,
    ),
  ).rejects.toThrow();
  for (const label of ["Стресс, тревога", "Спокойствие 🙂"])
    await expect(
      database.db.execute(
        sql`update expert_card_drafts set rich_guided=${JSON.stringify({ tags: [label] })}::jsonb,revision=revision+1 where id=${d!.draftId}::uuid`,
      ),
    ).rejects.toMatchObject({ cause: { message: "card_invalid_tags" } });
});

const Fastify = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
)("fastify");
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

async function patch(
  f: Awaited<ReturnType<typeof linked>>,
  value: Record<string, unknown>,
) {
  const d = (await f.card.getWorkflow(f.work))!;
  return f.card.richAction({
    ...event(f.work),
    action: "patch",
    expectedRevision: d.revision,
    value,
  });
}
it("preview is advisory and confirms only the exact displayed scope with replay protection", async () => {
  const f = await linked();
  await patch(f, { specialization: "КПТ", bio: "ПА; паника; тревога" });
  const before = (await f.card.getWorkflow(f.work))!;
  const e = event(f.work),
    r = await f.card.tagAction({ ...e, action: "recommend", scope: "profile" });
  expect(
    r.preview!.candidates.some((c) => c.label === "#КПТ" && c.score === 100),
  ).toBe(true);
  expect(
    r.preview!.candidates.some(
      (c) => c.kind === "related" && c.score === 0 && c.cosine === null,
    ),
  ).toBe(true);
  expect((await f.card.getWorkflow(f.work))!.revision).toBe(before.revision);
  expect(
    (
      await database.db.execute(
        sql`select semantic_tags from expert_card_drafts where id=${before.draftId}::uuid`,
      )
    ).rows[0]!.semantic_tags,
  ).toEqual([]);
  const removed = await f.card.tagAction({
    ...event(f.work),
    action: "toggle",
    token: r.preview!.token,
    index: 0,
  });
  expect(removed.preview!.selected).not.toContain(r.preview!.choices[0]);
  await expect(
    f.card.tagAction({
      ...event(f.work),
      action: "confirm",
      token: r.preview!.token,
    }),
  ).rejects.toThrow("card_revision_conflict");
  const confirm = event(f.work);
  await f.card.tagAction({
    ...confirm,
    action: "confirm",
    token: removed.preview!.token,
  });
  expect(
    (
      await database.db.execute(
        sql`select semantic_tags from expert_card_drafts where id=${before.draftId}::uuid`,
      )
    ).rows[0]!.semantic_tags,
  ).toEqual(removed.preview!.selected);
  expect(
    (
      await f.card.tagAction({
        ...confirm,
        action: "confirm",
        token: removed.preview!.token,
      })
    ).replay,
  ).toBe(true);
  expect(
    (await f.card.tagAction({ ...e, action: "recommend", scope: "profile" }))
      .replay,
  ).toBe(true);
  await expect(
    f.card.tagAction({ ...e, action: "recommend", scope: "guided" }),
  ).rejects.toThrow("card_idempotency_conflict");
});
it("changed profile or registry invalidates an old proposal", async () => {
  const f = await linked();
  await patch(f, { bio: "паника" });
  const r = await f.card.tagAction({ ...event(f.work), action: "recommend" });
  await patch(f, { bio: "рисование" });
  await expect(
    f.card.tagAction({
      ...event(f.work),
      action: "confirm",
      token: r.preview!.token,
    }),
  ).rejects.toThrow("card_revision_conflict");
  const current = await f.card.tagAction({
    ...event(f.work),
    action: "recommend",
  });
  await database.db.execute(
    sql`update hashtags_db set weight_score=6 where tag_value='рисование'`,
  );
  await expect(
    f.card.tagAction({
      ...event(f.work),
      action: "confirm",
      token: current.preview!.token,
    }),
  ).rejects.toThrow("card_revision_conflict");
  await database.db.execute(
    sql`update hashtags_db set weight_score=5 where tag_value='рисование'`,
  );
});
it("concurrent selection previews fence the losing token", async () => {
  const f = await linked();
  await patch(f, { bio: "паника; КПТ" });
  const r = await f.card.tagAction({ ...event(f.work), action: "recommend" });
  const results = await Promise.allSettled(
    [0, 1].map((index) =>
      f.card.tagAction({
        ...event(f.work),
        action: "toggle",
        token: r.preview!.token,
        index,
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
it("custom labels remain pending and BLOCKER refuses without overwriting answers", async () => {
  const f = await linked();
  await patch(f, { bio: "Моя новая тема" });
  let r = await f.card.tagAction({ ...event(f.work), action: "recommend" });
  r = await f.card.tagAction({
    ...event(f.work),
    action: "custom",
    token: r.preview!.token,
    label: "Моя авторская практика",
  });
  await f.card.tagAction({
    ...event(f.work),
    action: "confirm",
    token: r.preview!.token,
  });
  const d = (await f.card.getWorkflow(f.work))!;
  const detail = await f.card.readDraft(manager.sessionHash, f.applicationId);
  if (process.env.II_TONYA_SEMANTIC_BROWSER_FIXTURE)
    writeFileSync(
      process.env.II_TONYA_SEMANTIC_BROWSER_FIXTURE,
      JSON.stringify({ detail: { kind: "ok", item: detail } }),
    );
  expect(detail!.semanticTags).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        identity: "custom:моя авторская практика",
        decision: "pending",
      }),
    ]),
  );
  const app = Fastify({ logger: false });
  await app.register(expertCardAdminRoutes, {
    enabled: true,
    service: createExpertCardAdminService({
      enabled: true,
      repository: f.card,
    }),
  });
  const decision = await app.inject({
    method: "POST",
    url: `/v1/admin/expert-cards/${f.applicationId}/tags/review`,
    headers: { authorization: "Bearer " + manager.token },
    payload: {
      expectedRevision: d.revision,
      idempotencyKey: randomUUID(),
      identity: "custom:моя авторская практика",
      decision: "reject",
      reason: "Уточните предмет практики",
    },
  });
  expect(decision.statusCode).toBe(200);
  await app.close();
  expect((await f.card.getWorkflow(f.work))!.status).toBe("changes_requested");
  expect(
    (
      await database.db.execute(
        sql`select rich_profile->>'bio' as bio from expert_card_drafts where id=${d.draftId}::uuid`,
      )
    ).rows[0]!.bio,
  ).toBe("Моя новая тема");
});
it("aggregate20 is enforced transactionally across staged tags, normalized aliases and concurrent changes", async () => {
  const f = await linked();
  await patch(f, {});
  const d = (await f.card.getWorkflow(f.work))!;
  const labels = Array.from({ length: 19 }, (_, i) => "Авторская тема " + i);
  await database.db.execute(
    sql`update expert_card_drafts set semantic_tags=${JSON.stringify(labels)}::jsonb,revision=revision+1 where id=${d.draftId}::uuid`,
  );
  await database.db.execute(
    sql`update expert_card_drafts set rich_guided='{"tags":["#ПА","панические_атаки"]}'::jsonb,revision=revision+1 where id=${d.draftId}::uuid`,
  );
  const result = (
    await database.db.execute(
      sql`select count(distinct identity)::int n from expert_card_drafts d cross join lateral resident_selected_tags(d) t where d.id=${d.draftId}::uuid`,
    )
  ).rows[0];
  expect(result!.n).toBe(20);
  await expect(
    database.db.execute(
      sql`update expert_card_drafts set rich_pending_services='[{"tags":["ещё одна тема"]}]'::jsonb,revision=revision+1 where id=${d.draftId}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    database.db.execute(
      sql`update expert_card_drafts set semantic_tags=semantic_tags||'["новая тема"]',revision=revision+1 where id=${d.draftId}::uuid`,
    ),
  ).rejects.toThrow();
});
it("current catalog_admin MFA exports only public taxonomy and stale/wrong sessions fail closed", async () => {
  const f = await linked();
  await expect(f.card.exportTagCatalogue(manager.sessionHash)).rejects.toThrow(
    "card_forbidden",
  );
  const admin = await staff();
  await database.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) select admin_id,'catalog_admin' from admin_sessions where session_id_hash=${admin.sessionHash}`,
  );
  const app = Fastify({ logger: false });
  await app.register(expertCardAdminRoutes, {
    enabled: true,
    service: createExpertCardAdminService({
      enabled: true,
      repository: f.card,
    }),
  });
  expect(
    (
      await app.inject({
        method: "GET",
        url: "/v1/admin/expert-cards/catalogue-export",
        headers: { authorization: "Bearer " + manager.token },
      })
    ).statusCode,
  ).toBe(403);
  const exported = await app.inject({
    method: "GET",
    url: "/v1/admin/expert-cards/catalogue-export",
    headers: { authorization: "Bearer " + admin.token },
  });
  expect(exported.statusCode).toBe(200);
  expect(exported.headers["cache-control"]).toBe("no-store");
  await app.close();
  const rows = await f.card.exportTagCatalogue(admin.sessionHash);
  expect(rows).toHaveLength(164);
  expect(JSON.stringify(rows)).not.toContain(f.userId);
  expect(JSON.stringify(rows)).not.toContain("rich_profile");
  await database.db.execute(
    sql`update admin_sessions set mfa_verified_at=clock_timestamp()-interval '16 minutes' where session_id_hash=${admin.sessionHash}`,
  );
  await expect(f.card.exportTagCatalogue(admin.sessionHash)).rejects.toThrow(
    "card_forbidden",
  );
});
it.skipIf(!process.env.II_TONYA_SEMANTIC_TEST_SOCKET)(
  "normal authenticated ingress uses real helper/cache, replays unchanged update after reload, and measures warm composed pipeline",
  async () => {
    const f = await linked();
    await patch(f, {
      bio: "невысокая самооценка; проблемы в отношениях; паника",
    });
    const config = {
      features: { expertCard: true, expertDraftTags: true },
      residentSemanticSocket: process.env.II_TONYA_SEMANTIC_TEST_SOCKET,
      expertCard: {
        materialDeliveryEnabled: false,
        mainCheckoutEnabled: false,
        draftTagsEnabled: true,
        workBotId: workScope.botId,
        workBotKey: workScope.botKey,
        workBotUsername: "synthetic_work_bot",
        workBotToken: workScope.botId + ":" + "s".repeat(35),
        webhookSecret: "synthetic-core-webhook-secret-12345678",
        messagingConsentPolicyVersion: "client-messaging-v1",
        paymentMode: "test",
      },
    } as unknown as RuntimeConfig;
    const capability = createExpertCardComposition(database.db, config)!;
    const initialized = performance.now();
    expect(await capability.initializeTags!()).toBe("semantic");
    console.log(
      JSON.stringify({
        semanticStartupCacheMs: performance.now() - initialized,
      }),
    );
    const app = await workHttp(f.card, undefined, undefined, capability);
    const send = (update: number, text = "/tags_recommend профиль") =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token":
            "synthetic-core-webhook-secret-12345678",
        },
        payload: {
          update_id: update,
          message: {
            message_id: update,
            from: { id: Number(f.work.chatId) },
            chat: { id: Number(f.work.chatId), type: "private" },
            text,
          },
        },
      });
    try {
      const update = ++sequence,
        start = performance.now(),
        cold = await send(update);
      console.log(
        JSON.stringify({ semanticColdPipelineMs: performance.now() - start }),
      );
      expect(cold.json().text).toMatch(/смысловая близость/iu);
      const cache = (
        await database.db.execute<{
          cache: { vectors: unknown[] };
          generation: string;
        }>(sql`select cache,generation from tag_embeddings_cache`)
      ).rows[0]!;
      expect(cache.cache.vectors.length).toBeGreaterThan(600);
      const warm = performance.now();
      expect((await send(++sequence)).json().text).toContain(
        "Локальные рекомендации",
      );
      const elapsed = performance.now() - warm;
      console.log(JSON.stringify({ semanticWarmPipelineMs: elapsed }));
      expect(elapsed).toBeLessThan(500);
      await database.db.execute(
        sql`update hashtags_db set weight_score=6 where tag_value='рисование'`,
      );
      expect((await send(update)).json().duplicate).toBe(true);
      expect(
        (await send(update, "/tags_recommend текущая")).json().duplicate,
      ).not.toBe(true);
      expect((await send(++sequence)).json().text).toContain(
        "Локальные рекомендации",
      );
      expect(
        (
          await database.db.execute(
            sql`select generation from tag_embeddings_cache`,
          )
        ).rows[0]!.generation,
      ).not.toBe(cache.generation);
      await database.db.execute(
        sql`update hashtags_db set weight_score=5 where tag_value='рисование'`,
      );
    } finally {
      await app.close();
    }
  },
);
it("S3b custom BLOCKER refuses and accepted WARNING remains pending with current manager safety evidence", async () => {
  const f = await linked();
  let r = await f.card.tagAction({ ...event(f.work), action: "recommend" });
  const blocked = await f.card.tagAction({
    ...event(f.work),
    action: "custom",
    token: r.preview!.token,
    label: "гарантирую излечение",
  });
  expect(blocked.safetyBlocked).toBe(true);
  r = await f.card.tagAction({
    ...event(f.work),
    action: "custom",
    token: r.preview!.token,
    label: "#приворот",
  });
  await f.card.tagAction({
    ...event(f.work),
    action: "confirm",
    token: r.preview!.token,
  });
  const d = (await f.card.readDraft(manager.sessionHash, f.applicationId))!;
  expect(d.semanticTags).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "#приворот", decision: "pending" }),
    ]),
  );
  expect(d.safety.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ severity: "WARNING" })]),
  );
  expect(d.safety.blocked).toBe(false);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from hashtags_db where tag_value='приворот'`,
      )
    ).rows[0]!.n,
  ).toBe(0);
  await f.card.decideCustomTag({
    sessionHash: manager.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: d.revision,
    idempotencyKey: randomUUID(),
    identity: "custom:приворот",
    decision: "approve",
    reason: "Прочитаны предупреждение и текущий контекст",
  });
  await patch(f, { bio: "Уточнённое описание" });
  expect(
    (await f.card.readDraft(manager.sessionHash, f.applicationId))!
      .semanticTags,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "#приворот", decision: "pending" }),
    ]),
  );
});
it("S3b revocation denies original-update replay and erasure removes private selections/previews/decisions", async () => {
  const f = await linked();
  const e = event(f.work);
  let r = await f.card.tagAction({ ...e, action: "recommend" });
  r = await f.card.tagAction({
    ...event(f.work),
    action: "custom",
    token: r.preview!.token,
    label: "Личная авторская тема",
  });
  await f.card.tagAction({
    ...event(f.work),
    action: "confirm",
    token: r.preview!.token,
  });
  const d = (await f.card.getWorkflow(f.work))!;
  await f.card.decideCustomTag({
    sessionHash: manager.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: d.revision,
    idempotencyKey: randomUUID(),
    identity: "custom:личная авторская тема",
    decision: "approve",
    reason: "Ручная проверка",
  });
  await f.card.tagAction({ ...event(f.work), action: "recommend" });
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
  await expect(f.card.tagAction({ ...e, action: "recommend" })).rejects.toThrow(
    "card_forbidden",
  );
  await privacy.startErasureAtomically({
    targetUserId: f.userId,
    correlationId: "semantic-erase:" + f.userId,
    idempotencyKey: "semantic-erase:" + f.userId,
    pseudonym: "hmac:synthetic-semantic-erasure",
  });
  expect(
    (
      await database.db.execute(
        sql`select id from expert_card_drafts where user_id=${f.userId}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await database.db.execute(
        sql`select identity from resident_tag_decisions where draft_id=${d.draftId}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    JSON.stringify(
      (await database.db.execute(sql`select cache from tag_embeddings_cache`))
        .rows,
    ),
  ).not.toContain("Личная авторская тема");
});
it.skipIf(!process.env.II_TONYA_SEMANTIC_TEST_SOCKET)(
  "S3b realistic partial service warm pipeline, strict cache restore and real callback repeat",
  async () => {
    const f = await linked();
    const narrative =
      "На встрече обсуждаем привычные жизненные ситуации, текущие задачи и ожидания. Вы выбираете удобный темп, темы разговора и следующие самостоятельные шаги. Работа строится вокруг вашего собственного опыта и повседневных наблюдений. ";
    const description =
      narrative.repeat(3) +
      "невысокая самооценка; проблемы в отношениях; паника";
    await database.db.execute(sql`select 1`);
    await patch(f, {});
    const before = (await f.card.getWorkflow(f.work))!;
    await database.db.execute(
      sql`update expert_card_drafts set rich_guided=${JSON.stringify({ id: randomUUID(), title: "Индивидуальная встреча", description, audience: "Взрослые", result: "План собственных действий", format: "ONLINE" })}::jsonb,revision=revision+1 where id=${before.draftId}::uuid`,
    );
    let acks = 0;
    const config = {
      features: { expertCard: true, expertDraftTags: true },
      residentSemanticSocket: process.env.II_TONYA_SEMANTIC_TEST_SOCKET,
      expertCard: {
        materialDeliveryEnabled: false,
        mainCheckoutEnabled: false,
        draftTagsEnabled: true,
        workBotId: workScope.botId,
        workBotKey: workScope.botKey,
        workBotUsername: "synthetic_work_bot",
        workBotToken: workScope.botId + ":" + "s".repeat(35),
        webhookSecret: "synthetic-core-webhook-secret-12345678",
        messagingConsentPolicyVersion: "client-messaging-v1",
        paymentMode: "test",
      },
    } as unknown as RuntimeConfig;
    const cap = createExpertCardComposition(database.db, config, {
      tagCallbackFetch: async () => {
        acks++;
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    })!;
    const startup = performance.now();
    expect(await cap.initializeTags!()).toBe("semantic");
    const cacheStartupMs = performance.now() - startup;
    const app = await workHttp(f.card, undefined, cap.answerTagCallback, cap);
    const send = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token":
            "synthetic-core-webhook-secret-12345678",
        },
        payload,
      });
    const recommend = () => {
      const update = ++sequence;
      return send({
        update_id: update,
        message: {
          message_id: update,
          from: { id: Number(f.work.chatId) },
          chat: { id: Number(f.work.chatId), type: "private" },
          text: "/tags_recommend текущая",
        },
      });
    };
    try {
      const start = performance.now(),
        response = await recommend(),
        elapsed = performance.now() - start;
      expect(response.json().text).toMatch(/смысловая близость/iu);
      expect(response.json().text).toContain("#онлайн");
      expect(elapsed).toBeLessThan(500);
      expect(response.json().text.length).toBeLessThan(4000);
      console.log(
        JSON.stringify({
          realisticWarmPipelineMs: elapsed,
          cacheStartupMs,
          scope: "guided partial service",
          descriptionChars: description.length,
          serviceFields: 5,
          helperCpuLimit: 1,
          helperMemoryBytes: 335544320,
          helperMaxInputChars: 16000,
          helperMaxTokens: 512,
        }),
      );
      const buttons = response.json().reply_markup.inline_keyboard;
      const update = ++sequence;
      const payload = {
        update_id: update,
        callback_query: {
          id: "semantic-callback",
          from: { id: Number(f.work.chatId) },
          message: {
            message_id: update,
            from: { id: Number(workScope.botId), is_bot: true },
            chat: { id: Number(f.work.chatId), type: "private" },
            text: response.json().text,
          },
          data: buttons[0][0].callback_data,
        },
      };
      const changed = await send(payload);
      expect(changed.json().text).toContain("Текущая заполняемая услуга");
      expect((await send(payload)).json().duplicate).toBe(true);
      expect(acks).toBe(2);
      const other = await send({
        ...payload,
        update_id: ++sequence,
        callback_query: { ...payload.callback_query, from: { id: 999999 } },
      });
      expect(JSON.stringify(other.json())).not.toContain(description);
      const customUpdate = ++sequence;
      const customPayload = {
        update_id: customUpdate,
        message: {
          message_id: customUpdate,
          from: { id: Number(f.work.chatId) },
          chat: { id: Number(f.work.chatId), type: "private" },
          text: `/tags_custom ${changed
            .json()
            .reply_markup.inline_keyboard.flat()
            .find((b: { callback_data: string }) =>
              b.callback_data.startsWith("ct2:a:"),
            )
            .callback_data.slice(6)} #личная_практика`,
        },
      };
      const custom = await send(customPayload);
      expect(custom.json().text).toContain("#личная_практика");
      expect((await send(customPayload)).json().duplicate).toBe(true);
      const { createIsolatedSemanticTags } =
        await import("../../packages/integrations/src/documents/isolated-semantic-tags.js");
      const helper = createIsolatedSemanticTags(
        process.env.II_TONYA_SEMANTIC_TEST_SOCKET!,
      );
      const stored = (
        await database.db.execute<{
          cache: Record<string, unknown>;
          generation: string;
        }>(sql`select cache,generation from tag_embeddings_cache`)
      ).rows[0]!;
      expect(
        await helper.call("restore", {
          cache: { ...stored.cache, generation: "0".repeat(64) },
        }),
      ).toBeNull();
      // A different verified public generation in the helper simulates the empty/stale
      // in-memory side of a restart; normal startup restores the exact published row.
      const rows = await f.card.exportTagCatalogue(
        (
          await (async () => {
            const a = await staff();
            await database.db.execute(
              sql`insert into admin_role_assignments(admin_id,role) select admin_id,'catalog_admin' from admin_sessions where session_id_hash=${a.sessionHash}`,
            );
            return a;
          })()
        ).sessionHash,
      );
      await helper.call("prepare", { catalogue: rows.slice(0, 3) });
      expect(await cap.initializeTags!()).toBe("semantic");
      expect((await helper.call("state"))!.generation).toBe(stored.generation);
      const rebuild = performance.now();
      await database.db.execute(
        sql`update hashtags_db set weight_score=6 where tag_value='рисование'`,
      );
      expect(await cap.initializeTags!()).toBe("semantic");
      console.log(
        JSON.stringify({ registryRebuildMs: performance.now() - rebuild }),
      );
      await database.db.execute(
        sql`update hashtags_db set weight_score=5 where tag_value='рисование'`,
      );
    } finally {
      await app.close();
    }
  },
  30000,
);

it("S3b disabled catalogue selection remains visible/removable and new stale preview cannot confirm", async () => {
  const f = await linked();
  await patch(f, { bio: "паника" });
  let r = await f.card.tagAction({ ...event(f.work), action: "recommend" });
  await f.card.tagAction({
    ...event(f.work),
    action: "confirm",
    token: r.preview!.token,
  });
  const id = (
    await database.db.execute<{ id: string }>(
      sql`select id from hashtags_db where tag_value='панические_атаки'`,
    )
  ).rows[0]!.id;
  await database.db.execute(
    sql`update hashtags_db set is_active=false where id=${id}::uuid`,
  );
  try {
    r = await f.card.tagAction({ ...event(f.work), action: "recommend" });
    expect(r.preview!.selected).toContain("#панические_атаки");
    await expect(
      f.card.tagAction({
        ...event(f.work),
        action: "confirm",
        token: r.preview!.token,
      }),
    ).rejects.toThrow();
    const page = await f.card.getDraftTags(f.work);
    expect(page.tags_array).toContain("#панические_атаки");
    await f.card.toggleDraftTag({
      ...event(f.work),
      expectedRevision: page.revision,
      tagId: id,
    });
    expect((await f.card.getDraftTags(f.work)).tags_array).not.toContain(
      "#панические_атаки",
    );
  } finally {
    await database.db.execute(
      sql`update hashtags_db set is_active=true where id=${id}::uuid`,
    );
  }
});

it("rejects absent or null cache vectors instead of SQL unknown acceptance", async () => {
  for (const cache of [
    {},
    { vectors: null },
    { vectors: [{}] },
    { vectors: [{ vector: null }] },
  ]) {
    const result = await database.db.execute<{ valid: boolean }>(
      sql`select resident_tag_cache_valid(${JSON.stringify(cache)}::jsonb) as valid`,
    );
    expect(result.rows[0]!.valid).toBe(false);
  }
});

it("ordinary own-tag ForceReply binds the original preview and never resends uncertain attempts", async () => {
  const f = await linked();
  await patch(f, { specialization: "КПТ" });
  let sends = 0,
    unknown = false;
  const config = {
    features: { expertCard: true, expertDraftTags: true },
    expertCard: {
      materialDeliveryEnabled: false,
      mainCheckoutEnabled: false,
      draftTagsEnabled: true,
      workBotId: workScope.botId,
      workBotKey: workScope.botKey,
      workBotUsername: "synthetic_work_bot",
      workBotToken: workScope.botId + ":" + "s".repeat(35),
      webhookSecret: "synthetic-core-webhook-secret-12345678",
      messagingConsentPolicyVersion: "client-messaging-v1",
      paymentMode: "test",
    },
  } as unknown as RuntimeConfig;
  const cap = createExpertCardComposition(database.db, config, {
    tagCallbackFetch: async () => new Response('{"ok":true,"result":true}'),
    tagPromptFetch: async (_url, init) => {
      sends++;
      const body = JSON.parse(String(init?.body));
      expect(body.text).toBe(
        "Напишите один свой тег в ответ на это сообщение.",
      );
      expect(body.reply_markup.force_reply).toBe(true);
      expect(body.chat_id).toBe(f.work.chatId);
      if (unknown) throw new Error("synthetic unknown delivery");
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 8800 + sends,
            from: { id: Number(workScope.botId), is_bot: true },
            chat: { id: Number(f.work.chatId), type: "private" },
          },
        }),
      );
    },
  })!;
  const app = await workHttp(f.card, undefined, cap.answerTagCallback, cap);
  const send = (body: unknown) =>
    app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: {
        "x-telegram-bot-api-secret-token":
          "synthetic-core-webhook-secret-12345678",
      },
      payload: body,
    });
  const message = (
    text: string,
    replyId?: number,
    bot = Number(workScope.botId),
    chat = Number(f.work.chatId),
  ) => ({
    update_id: ++sequence,
    message: {
      message_id: sequence,
      from: { id: Number(f.work.chatId) },
      chat: { id: Number(f.work.chatId), type: "private" },
      text,
      ...(replyId
        ? {
            reply_to_message: {
              message_id: replyId,
              from: { id: bot, is_bot: true },
              chat: { id: chat, type: "private" },
              text: "Напишите один свой тег в ответ на это сообщение.",
            },
          }
        : {}),
    },
  });
  const add = (r: {
    text: string;
    reply_markup: {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
  }) => ({
    update_id: ++sequence,
    callback_query: {
      id: "add_" + sequence,
      from: { id: Number(f.work.chatId) },
      message: {
        message_id: sequence,
        from: { id: Number(workScope.botId), is_bot: true },
        chat: { id: Number(f.work.chatId), type: "private" },
        text: r.text,
      },
      data: r.reply_markup.inline_keyboard
        .flat()
        .find((b) => b.text === "Добавить свой тег / Другое")!.callback_data,
    },
  });
  try {
    const recommended = (await send(message("/tags_recommend профиль"))).json();
    const start = add(recommended);
    expect((await send(start)).json()).toEqual({ accepted: true });
    expect(sends).toBe(1);
    expect((await send(start)).json().duplicate).toBe(true);
    expect(sends).toBe(1);
    const label = message("личная практика", 8801);
    const selected = (await send(label)).json();
    expect(selected.text).toContain("личная практика");
    expect((await send(label)).json().duplicate).toBe(true);
    const oldStart = add(selected);
    await send(oldStart);
    expect(sends).toBe(2);
    await send(message("/tags_recommend текущая"));
    const stale = await send(message("ошибочный тег", 8802));
    expect(stale.json().text ?? "").not.toContain("ошибочный тег");
    const wrongBot = await send(message("ошибочный тег", 8802, 99999));
    expect(wrongBot.statusCode).toBe(400);
    const wrongChat = await send(
      message("ошибочный тег", 8802, Number(workScope.botId), 99999),
    );
    expect(wrongChat.statusCode).toBe(400);
    const fresh = (await send(message("/tags_recommend профиль"))).json();
    unknown = true;
    const attempt = add(fresh);
    const failed = await send(attempt);
    expect(failed.json().text).toContain("Добавить свой тег");
    expect(sends).toBe(3);
    expect((await send(attempt)).json().duplicate).toBe(true);
    expect(sends).toBe(3);
    const orphan = await send(message("непривязанный тег", 8803));
    expect(orphan.json().text ?? "").not.toContain("непривязанный тег");
    unknown = false;
    await database.db.execute(
      sql`create function semantic_fixture_bind_failure() returns trigger language plpgsql as $$begin if NEW.tag_preview#>>'{customInput,messageId}' is not null then raise exception 'synthetic_bind_rollback'; end if;return NEW;end$$`,
    );
    await database.db.execute(
      sql`create trigger semantic_fixture_bind_failure before update on expert_card_drafts for each row execute function semantic_fixture_bind_failure()`,
    );
    try {
      const next = (await send(message("/tags_recommend профиль"))).json();
      const rollback = add(next);
      expect((await send(rollback)).json().text).toContain("Добавить свой тег");
      expect(sends).toBe(4);
      expect((await send(rollback)).json().duplicate).toBe(true);
      expect(sends).toBe(4);
      const unbound = await send(message("после отката", 8804));
      expect(unbound.json().text ?? "").not.toContain("после отката");
    } finally {
      await database.db.execute(
        sql`drop trigger semantic_fixture_bind_failure on expert_card_drafts`,
      );
      await database.db.execute(
        sql`drop function semantic_fixture_bind_failure()`,
      );
    }
    console.log(
      JSON.stringify({
        ordinaryLabel: true,
        originalBotAndChat: true,
        staleScopeRejected: true,
        callbackAndLabelReplay: true,
        unknownAttemptNotResent: true,
        orphanRejected: true,
        bindingTransactionRollbackNotResent: true,
        promptSends: sends,
      }),
    );
  } finally {
    await app.close();
  }
}, 30000);

it("ordinary interview replies preserve text photo and document intake with tags enabled or disabled", async () => {
  for (const enabled of [true, false]) {
    const f = await linked();
    const config = {
      features: { expertCard: true, expertDraftTags: enabled },
      expertCard: {
        materialDeliveryEnabled: false,
        mainCheckoutEnabled: false,
        draftTagsEnabled: enabled,
        workBotId: workScope.botId,
        workBotKey: workScope.botKey,
        workBotUsername: "synthetic_work_bot",
        workBotToken: workScope.botId + ":" + "s".repeat(35),
        webhookSecret: "synthetic-core-webhook-secret-12345678",
        messagingConsentPolicyVersion: "client-messaging-v1",
        paymentMode: "test",
      },
    } as unknown as RuntimeConfig;
    const cap = createExpertCardComposition(database.db, config, {
      tagPromptFetch: async () => {
        throw new Error("ordinary reply must not send a tag prompt");
      },
    })!;
    const app = await workHttp(f.card, undefined, undefined, cap);
    try {
      const original = await f.card.getWorkflow(f.work);
      const before = original!.entryCount;
      for (const [index, content] of [
        { text: "Отвечаю на вопрос об опыте работы" },
        { photo: [{ file_id: "ordinary_photo_reply" }] },
        { document: { file_id: "ordinary_document_reply" } },
        { text: "Уточняю свой предыдущий ответ" },
      ].entries()) {
        const response = await app.inject({
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
              ...content,
              reply_to_message: {
                message_id: 7300 + index,
                from:
                  index === 3
                    ? { id: Number(f.work.chatId) }
                    : { id: Number(workScope.botId), is_bot: true },
                chat: { id: Number(f.work.chatId), type: "private" },
                text:
                  index === 3
                    ? "Мой предыдущий ответ"
                    : "Расскажите о вашем опыте работы",
              },
            },
          },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().text ?? "").not.toContain(
          "Подбор тегов пока недоступен",
        );
        expect((await f.card.getWorkflow(f.work))!.entryCount).toBe(
          before + index + 1,
        );
      }
      console.log(
        JSON.stringify({
          tagsEnabled: enabled,
          ordinaryTextPhotoDocumentRepliesSaved: true,
          replyToOwnMessageSaved: true,
        }),
      );
    } finally {
      await app.close();
    }
  }
}, 30000);

it("R2 removes obsolete selections across catalogue and staged-service scopes without unrelated edits", async () => {
  const f = await linked();
  await patch(f, { bio: "Сохранить это описание" });
  const ids = (
    await database.db.execute<{ id: string; tag_value: string }>(
      sql`select id,tag_value from hashtags_db where tag_value in ('панические_атаки','тревожность') order by tag_value`,
    )
  ).rows;
  const revision = (await f.card.getWorkflow(f.work))!.revision;
  await f.card.toggleDraftTag({
    ...event(f.work),
    expectedRevision: revision,
    tagId: ids[0]!.id,
  });
  const d = (await f.card.getWorkflow(f.work))!;
  await database.db.execute(
    sql`update expert_card_drafts set rich_guided='{"tags":["#тревожность"]}'::jsonb,rich_pending_services='[{"tags":["#панические_атаки"]}]'::jsonb,revision=revision+1 where id=${d.draftId}::uuid`,
  );
  await database.db.execute(
    sql`update hashtags_db set is_active=false where id=any(${"{" + ids.map((t) => t.id).join(",") + "}"}::uuid[])`,
  );
  try {
    const original = (
      await database.db.execute(
        sql`select rich_profile,public_payload from expert_card_drafts where id=${d.draftId}::uuid`,
      )
    ).rows[0];
    const page = await f.card.getDraftTags(f.work);
    await f.card.toggleDraftTag({
      ...event(f.work),
      expectedRevision: page.revision,
      tagId: ids[0]!.id,
    });
    const remove = async (scope: string) => {
      let r = await f.card.tagAction({
        ...event(f.work),
        action: "recommend",
        scope,
      });
      for (const label of [...r.preview!.selected])
        r = await f.card.tagAction({
          ...event(f.work),
          action: "toggle",
          token: r.preview!.token,
          index: r.preview!.choices.indexOf(label),
        });
      await f.card.tagAction({
        ...event(f.work),
        action: "confirm",
        token: r.preview!.token,
      });
    };
    await expect(
      database.db.execute(
        sql`update expert_card_drafts set rich_profile=jsonb_set(rich_profile,'{bio}','"несогласованное изменение"'),revision=revision+1 where id=${d.draftId}::uuid`,
      ),
    ).rejects.toThrow();
    await remove("guided");
    await expect(
      database.db.execute(
        sql`update expert_card_drafts set semantic_tags='["#КПТ"]',revision=revision+1 where id=${d.draftId}::uuid`,
      ),
    ).rejects.toThrow();
    await remove("pending:1");
    expect(
      (
        await database.db.execute(
          sql`select rich_profile,public_payload from expert_card_drafts where id=${d.draftId}::uuid`,
        )
      ).rows[0],
    ).toEqual(original);
    expect((await f.card.getDraftTags(f.work)).selectedCount).toBe(0);
  } finally {
    await database.db.execute(
      sql`update hashtags_db set is_active=true where id=any(${"{" + ids.map((t) => t.id).join(",") + "}"}::uuid[])`,
    );
  }
});

it.each(["старая тема а", "ПА"])(
  "R2 newly blocked repeated tags can be reduced but cannot authorize another blocked field (%s)",
  async (profileTag) => {
    const f = await linked(),
      unsafe = await linked();
    await patch(f, { bio: "Сохранить описание" });
    await patch(unsafe, { bio: "опасное описание" });
    const d = (await f.card.getWorkflow(f.work))!,
      bad = (await unsafe.card.getWorkflow(unsafe.work))!;
    for (const draft of [d, bad])
      await database.db.execute(
        sql`update expert_card_drafts set semantic_tags=${JSON.stringify([profileTag])}::jsonb,rich_guided='{"tags":["старая тема б"]}',rich_pending_services='[{"tags":["старая тема б"]}]',revision=revision+1 where id=${draft.draftId}::uuid`,
      );
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
    const candidate = randomUUID();
    await database.db.execute(
      sql`insert into resident_safety_policies(id) values(${candidate}::uuid)`,
    );
    for (const pattern of [
      "старая тема а",
      "старая тема б",
      "опасное описание",
    ])
      await database.db.execute(
        sql`insert into forbidden_patterns(policy_id,pattern_regex,category,severity_level,error_message_template,provenance,positive_witness) values(${candidate}::uuid,${pattern},'MEDICAL_CLAIM','BLOCKER','Исправьте текст','synthetic R2 policy',${pattern})`,
      );
    await database.db.execute(
      sql`select resident_safety_publish(${candidate}::uuid,${managerId}::uuid,${manager.sessionHash})`,
    );
    const remove = async (owner: typeof f, scope: string) => {
      let r = await owner.card.tagAction({
        ...event(owner.work),
        action: "recommend",
        scope,
      });
      for (const label of [...r.preview!.selected])
        r = await owner.card.tagAction({
          ...event(owner.work),
          action: "toggle",
          token: r.preview!.token,
          index: r.preview!.choices.indexOf(label),
        });
      return owner.card.tagAction({
        ...event(owner.work),
        action: "confirm",
        token: r.preview!.token,
      });
    };
    try {
      await expect(remove(unsafe, "profile")).rejects.toThrow();
      await remove(f, "profile");
      await expect(
        database.db.execute(
          sql`update expert_card_drafts set owner_confirmed_digest=resident_rich_digest(expert_card_drafts) where id=${d.draftId}::uuid`,
        ),
      ).rejects.toThrow();
      await remove(f, "guided");
      expect((await f.card.getDraftTags(f.work)).selectedCount).toBe(1);
      await remove(f, "pending:1");
      expect((await f.card.getDraftTags(f.work)).selectedCount).toBe(0);
      expect(
        (await f.card.readDraft(manager.sessionHash, f.applicationId))!.rich!
          .profile!.bio,
      ).toBe("Сохранить описание");
    } finally {
      await database.db.execute(
        sql`select resident_safety_publish(${previous}::uuid,${managerId}::uuid,${manager.sessionHash})`,
      );
    }
  },
);

it("R2a profile confirmation preserves catalogue deletion authority and both retained storage scopes", async () => {
  const f = await linked();
  await patch(f, { bio: "Сохранить описание" });
  const d = (await f.card.getWorkflow(f.work))!;
  await database.db.execute(
    sql`update expert_card_drafts set semantic_tags='["ПА"]',rich_guided='{"tags":["#тревожность"]}',revision=revision+1 where id=${d.draftId}::uuid`,
  );
  const { semanticTagOwnerFlow } =
    await import("../support/semantic-tag-owner-flow.js");
  const app = await workHttp(f.card);
  const flow = semanticTagOwnerFlow(
    (payload) =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token":
            "synthetic-core-webhook-secret-12345678",
        },
        payload,
      }),
    { chatId: f.work.chatId, botId: workScope.botId },
    () => ++sequence,
  );
  try {
    await flow.catalogue("#депрессия");
    await database.db.execute(
      sql`insert into expert_card_draft_tags(draft_id,user_id,tag_id) select d.id,d.user_id,h.id from hashtags_db h cross join expert_card_drafts d where d.id=${d.draftId}::uuid and h.tag_value='панические_атаки'`,
    );
    await database.db.execute(
      sql`update hashtags_db set is_active=false where tag_value in ('депрессия','тревожность')`,
    );
    let r = await flow.text("/tags_recommend профиль");
    r = await flow.remove(r, "#депрессия");
    expect((await flow.confirm(r)).text).toContain("набор тегов сохранён");
    expect((await flow.repeat()).duplicate).toBe(true);
    expect(
      (
        await database.db.execute<{ semantic_tags: string[] }>(
          sql`select semantic_tags from expert_card_drafts where id=${d.draftId}::uuid`,
        )
      ).rows[0]!.semantic_tags,
    ).toEqual(["ПА"]);
    expect(
      (
        await database.db.execute<{ tag_value: string }>(
          sql`select h.tag_value from expert_card_draft_tags t join hashtags_db h on h.id=t.tag_id where t.draft_id=${d.draftId}::uuid`,
        )
      ).rows.map((x) => x.tag_value),
    ).toEqual(["панические_атаки"]);
    r = await flow.text("/tags_recommend текущая");
    r = await flow.remove(r, "#тревожность");
    await flow.confirm(r);
  } finally {
    await database.db.execute(
      sql`update hashtags_db set is_active=true where tag_value in ('депрессия','тревожность')`,
    );
    await app.close();
  }
});

it.each(["текущая", "ожидающая 1"])(
  "R2b retained PA alias survives either obsolete-scope removal starting with %s",
  async (first) => {
    const f = await linked();
    await patch(f, {});
    const d = (await f.card.getWorkflow(f.work))!;
    await database.db.execute(
      sql`update expert_card_drafts set rich_guided='{"tags":["ПА","#тревожность"]}',rich_pending_services='[{"tags":["ПА","#фобии"]}]',revision=revision+1 where id=${d.draftId}::uuid`,
    );
    const { semanticTagOwnerFlow } =
      await import("../support/semantic-tag-owner-flow.js");
    const app = await workHttp(f.card);
    const flow = semanticTagOwnerFlow(
      (payload) =>
        app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram",
          headers: {
            "x-telegram-bot-api-secret-token":
              "synthetic-core-webhook-secret-12345678",
          },
          payload,
        }),
      { chatId: f.work.chatId, botId: workScope.botId },
      () => ++sequence,
    );
    await database.db.execute(
      sql`update hashtags_db set is_active=false where tag_value in ('тревожность','фобии')`,
    );
    try {
      for (const scope of [
        first,
        first === "текущая" ? "ожидающая 1" : "текущая",
      ]) {
        let r = await flow.text("/tags_recommend " + scope);
        expect(r.text).toContain("Прямое совпадение / синоним: 1");
        expect(r.text).not.toContain("Прямое совпадение / синоним: 0");
        expect(
          r
            .reply_markup!.inline_keyboard.flat()
            .filter((b) => b.callback_data.startsWith("ct2:t:"))
            .map((b) => b.text),
        ).toContain("1. ☑ ПА");
        r = await flow.remove(
          r,
          scope === "текущая" ? "#тревожность" : "#фобии",
        );
        await flow.confirm(r);
      }
      const row = (
        await database.db.execute<{
          rich_guided: { tags: string[] };
          rich_pending_services: { tags: string[] }[];
        }>(
          sql`select rich_guided,rich_pending_services from expert_card_drafts where id=${d.draftId}::uuid`,
        )
      ).rows[0]!;
      expect(row.rich_guided.tags).toEqual(["ПА"]);
      expect(row.rich_pending_services[0]!.tags).toEqual(["ПА"]);
    } finally {
      await database.db.execute(
        sql`update hashtags_db set is_active=true where tag_value in ('тревожность','фобии')`,
      );
      await app.close();
    }
  },
);

it.each(["combined", "active-semantic", "active-catalogue"])(
  "R2c strict %s removal remains possible while another scope is obsolete",
  async (mode) => {
    const f = await linked();
    await patch(f, { bio: "Сохранить описание" });
    const d = (await f.card.getWorkflow(f.work))!;
    await database.db.execute(
      sql`update expert_card_drafts set semantic_tags='["ПА"]',rich_guided='{"tags":["#тревожность"]}',revision=revision+1 where id=${d.draftId}::uuid`,
    );
    const { semanticTagOwnerFlow } =
      await import("../support/semantic-tag-owner-flow.js");
    const app = await workHttp(f.card);
    const flow = semanticTagOwnerFlow(
      (payload) =>
        app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram",
          headers: {
            "x-telegram-bot-api-secret-token":
              "synthetic-core-webhook-secret-12345678",
          },
          payload,
        }),
      { chatId: f.work.chatId, botId: workScope.botId },
      () => ++sequence,
    );
    try {
      await flow.catalogue("#депрессия");
      const unchanged = (
        await database.db.execute(
          sql`select resident_tag_nonselection_content(d) content from expert_card_drafts d where id=${d.draftId}::uuid`,
        )
      ).rows[0]!.content;
      await database.db.execute(
        sql`update hashtags_db set is_active=false where tag_value='тревожность' or (tag_value='депрессия' and ${mode !== "active-catalogue"})`,
      );
      let r = await flow.text("/tags_recommend профиль");
      expect((await flow.confirm(r)).text).toContain(
        "Не удалось изменить теги",
      );
      // Strict removal cannot hide a new identity, move an occurrence, or edit another answer.
      for (const statement of [
        sql`update expert_card_drafts set semantic_tags='["#КПТ"]',revision=revision+1 where id=${d.draftId}::uuid`,
        sql`update expert_card_drafts set semantic_tags='[]',rich_guided='{"tags":["#тревожность","ПА"]}',revision=revision+1 where id=${d.draftId}::uuid`,
        sql`update expert_card_drafts set semantic_tags='[]',rich_profile=jsonb_set(rich_profile,'{bio}','"Изменённый ответ"'),revision=revision+1 where id=${d.draftId}::uuid`,
      ])
        await expect(database.db.execute(statement)).rejects.toThrow();
      if (mode !== "active-catalogue") r = await flow.remove(r, "ПА");
      if (mode !== "active-semantic") r = await flow.remove(r, "#депрессия");
      expect((await flow.confirm(r)).text).toContain("набор тегов сохранён");
      expect((await flow.repeat()).duplicate).toBe(true);
      const current = (
        await database.db.execute<{
          semantic_tags: string[];
          rich_guided: { tags: string[] };
          content: unknown;
        }>(
          sql`select semantic_tags,rich_guided,resident_tag_nonselection_content(d) content from expert_card_drafts d where id=${d.draftId}::uuid`,
        )
      ).rows[0]!;
      expect(current.semantic_tags).toEqual(
        mode === "active-catalogue" ? ["ПА"] : [],
      );
      expect(current.rich_guided.tags).toEqual(["#тревожность"]);
      expect(current.content).toEqual(unchanged);
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_card_draft_tags where draft_id=${d.draftId}::uuid`,
          )
        ).rows[0]!.n,
      ).toBe(mode === "active-semantic" ? 1 : 0);
      await expect(
        database.db.execute(
          sql`update expert_card_drafts set owner_confirmed_digest=resident_rich_digest(expert_card_drafts) where id=${d.draftId}::uuid`,
        ),
      ).rejects.toThrow();
      r = await flow.text("/tags_recommend профиль");
      expect((await flow.confirm(r)).text).toContain(
        "Не удалось изменить теги",
      );
    } finally {
      await database.db.execute(
        sql`update hashtags_db set is_active=true where tag_value in ('депрессия','тревожность')`,
      );
      await app.close();
    }
  },
);
