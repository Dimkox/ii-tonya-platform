import {
  createExpertCardComposition,
  type ExpertCardCapability,
} from "../../apps/api/src/expert-card-composition.js";
import type { RuntimeConfig } from "../../packages/config/src/index.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { richDocumentFixtures } from "../support/resident-rich-document-fixtures.js";
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
it("new paid bot entry is rich and legacy submit/SQL cannot bypass completeness", async () => {
  const f = await linked();
  await f.card.addEntry({
    ...event(f.work),
    expectedRevision: 0,
    entry: { kind: "text", text: "Первый ответ" },
  });
  await expect(
    f.card.submitDraft({ ...event(f.work), expectedRevision: 1 }),
  ).rejects.toThrow("card_fields:");
  await expect(
    database.db.execute(
      sql`update expert_card_drafts set status='manager_review' where user_id=${f.userId}::uuid`,
    ),
  ).rejects.toThrow();
});
it("fee capture and leftover generic job cannot send materials before card approval", async () => {
  const f = await linked();
  const t = await database.db.execute(
    sql`insert into expert_card_material_templates(content_version,status,text_body) values(${randomUUID()},'approved','Материалы') returning id`,
  );
  expect(t.rows).toHaveLength(1);
  const { PostgresExpertApplicationMaterials } =
    await import("../../packages/db/src/repositories/expert-application-materials.js");
  const sent: string[] = [];
  const materials = new PostgresExpertApplicationMaterials(
    database.db,
    "client-messaging-v1",
    {
      send: async (i) => {
        sent.push(i.reviewId);
        return {
          messageIds: ["1"],
          botId: i.botId,
          chatId: i.chatId,
          contentVersion: i.contentVersion,
          payloadDigest: i.payloadDigest,
        };
      },
    },
  );
  const job = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_application_material_jobs where application_id=${f.applicationId}::uuid`,
    )
  ).rows[0]!;
  expect(await materials.deliver(job.id)).toEqual({ kind: "cancelled" });
  expect(sent).toEqual([]);
});
it("saves only validated partial values, blocks nested service unsafe text and preserves valid answers", async () => {
  const f = await linked();
  const a = await f.card.richAction({
    ...event(f.work),
    expectedRevision: 0,
    action: "patch",
    value: { fullName: "Анна" },
  });
  expect(a.revision).toBe(1);
  const b = await f.card.richAction({
    ...event(f.work),
    expectedRevision: 1,
    action: "patch",
    value: { bio: "вылечу рак" },
  });
  expect(b).toMatchObject({ safetyBlocked: true, revision: 1 });
  const unsafeService = {
    id: randomUUID(),
    title: "Консультация",
    format: "ONLINE",
    eventDelivery: null,
    durationMinutes: 60,
    price: { kind: "exact", minRub: "1000.00", maxRub: null },
    description:
      "Безопасное описание консультации, достаточно подробное для владельца.",
    audience: "Взрослые",
    result: "План шагов",
    expiryDate: null,
    detailsUrl: null,
    tags: ["#лечениерака"],
  };
  expect(
    await f.card.richAction({
      ...event(f.work),
      expectedRevision: 1,
      action: "service",
      value: unsafeService,
    }),
  ).toMatchObject({ safetyBlocked: true, revision: 1 });
  await expect(
    database.db.execute(
      sql`update expert_card_drafts set rich_profile=jsonb_set(rich_profile,'{bio}','"вылечу рак"'::jsonb) where application_id=${f.applicationId}::uuid`,
    ),
  ).rejects.toThrow();
  await f.card.richAction({
    ...event(f.work),
    expectedRevision: 1,
    action: "manager",
  });
  const request = (await f.card.readDraft(
    manager.sessionHash,
    f.applicationId,
  ))!.assistance;
  await f.card.richAction({
    ...event(f.work),
    expectedRevision: 1,
    action: "manager",
  });
  expect(
    (await f.card.readDraft(manager.sessionHash, f.applicationId))!.assistance,
  ).toEqual(request);
  expect((await f.card.listDrafts(manager.sessionHash))[0]).toMatchObject({
    applicationId: f.applicationId,
    assistanceRequested: true,
  });
  const detail = await f.card.readDraft(manager.sessionHash, f.applicationId);
  expect(detail?.rich).toMatchObject({
    profile: { fullName: "Анна", bio: "" },
  });
});
it("preview chain binds every page, proposals require exact review token and edits invalidate it", async () => {
  const f = await linked();
  await f.card.richAction({
    ...event(f.work),
    expectedRevision: 0,
    action: "propose",
    value: {
      fullName: "Анна",
      bio: "Я".repeat(1800),
      arrival: "А".repeat(1800),
    },
  });
  await expect(
    f.card.richAction({
      ...event(f.work),
      expectedRevision: 1,
      action: "accept_proposal",
    }),
  ).rejects.toThrow("card_preview_incomplete");
  const p = await f.card.richAction({
    ...event(f.work),
    expectedRevision: 1,
    action: "proposal_preview",
  });
  expect(p.pageText).toContain("Страница 1/2");
  await expect(
    f.card.richAction({
      ...event(f.work),
      expectedRevision: 1,
      action: "proposal_preview",
      page: 1,
      token: randomUUID(),
    }),
  ).rejects.toThrow("card_preview_incomplete");
  const command = p.pageText!.split("\n").at(-1)!.split(" ");
  const last = await f.card.richAction({
    ...event(f.work),
    expectedRevision: 1,
    action: "proposal_preview",
    page: 1,
    token: command.at(-1)!,
  });
  const token = last.pageText!.split(" ").at(-1)!;
  const accepted = await f.card.richAction({
    ...event(f.work),
    expectedRevision: 1,
    action: "accept_proposal",
    token,
  });
  expect(accepted.revision).toBe(2);
  await expect(
    f.card.richAction({
      ...event(f.work),
      expectedRevision: 2,
      action: "confirm",
      token,
    }),
  ).rejects.toThrow("card_preview_incomplete");
});
async function paidVersionWitness(
  nextDraft?: "collecting" | "changes_requested",
) {
  const { createServer } = await import("node:http");
  const { createPrivateObjectStore, createTelegramDocumentReader } =
    await import("../../packages/integrations/src/documents/private-verification.js");
  const bytes = Buffer.from([255, 216, 255, 224, 1, 2, 3, 4]);
  const objects = new Map<
    string,
    { bytes: Buffer; headers: Record<string, string> }
  >();
  let base = "";
  let objectWrites = 0;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, base).pathname;
    if (path.endsWith("/getFile")) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const fileId = JSON.parse(Buffer.concat(chunks).toString()).file_id;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          result: {
            file_id: fileId,
            file_size: bytes.length,
            file_path: "photos/" + fileId + ".jpg",
          },
        }),
      );
      return;
    }
    if (path.includes("/photos/")) {
      res.setHeader("content-length", bytes.length);
      res.end(bytes);
      return;
    }
    if (req.method === "PUT") {
      objectWrites++;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers))
        if (
          typeof v === "string" &&
          (k.startsWith("x-amz-meta-") ||
            k === "x-amz-checksum-sha256" ||
            k === "content-type")
        )
          headers[k] = v;
      objects.set(path, { bytes: Buffer.concat(chunks), headers });
      res.end();
      return;
    }
    const stored = objects.get(path);
    if (!stored) {
      res.writeHead(404);
      res.end();
      return;
    }
    for (const [k, v] of Object.entries(stored.headers)) res.setHeader(k, v);
    res.setHeader("content-length", stored.bytes.length);
    res.end(req.method === "HEAD" ? undefined : stored.bytes);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
    const store = createPrivateObjectStore({
      bucket: "rich-cards",
      region: "ru-local",
      endpoint: base,
      credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
      dedicatedNonVersionedVerified: true,
      localEvidence: true,
    });
    const reader = createTelegramDocumentReader({
      botId: workScope.botId,
      token: workScope.botId + ":synthetic",
      fetch: (url, options) =>
        fetch(base + new URL(String(url)).pathname, options),
    });
    const f = await linked(),
      repo = new PostgresExpertCardRepository(database.db, {
        ...workScope,
        workBotId: workScope.botId,
        workBotKey: workScope.botKey,
        messagingConsentPolicyVersion: "client-messaging-v1",
        richOnboarding: true,
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
          read: async (i) => {
            const r = await reader.read(i);
            return r.kind === "read" ? r.bytes : null;
          },
          put: async (i) => (await store.put(i)).kind === "verified",
          presign: store.presign.bind(store),
        },
      });
    let revision = 0;
    const photos: string[] = [];
    const photoApp = await workHttp(
      repo,
      undefined,
      undefined,
      normalComposition(base),
    );
    try {
      for (let i = 0; i < 3; i++) {
        const update = ++sequence;
        const response = await photoApp.inject({
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
              photo: [
                {
                  file_id: "photo_" + i,
                  file_unique_id: "unique_" + i,
                  width: 20,
                  height: 20,
                  file_size: bytes.length,
                },
              ],
            },
          },
        });
        expect(response.json().text).toContain("закрытом хранилище");
      }
    } finally {
      await photoApp.close();
    }
    const photoDraft = (await repo.readDraft(
      manager.sessionHash,
      f.applicationId,
    ))!;
    photos.push(...photoDraft.rich!.profile!.photos);
    revision = photoDraft.revision;
    expect(objects.size).toBe(3);
    const bio =
      "Помогаю разобраться в задачах и выбрать собственные следующие шаги без обещаний результата.";
    let r = await repo.richAction({
      ...event(f.work),
      expectedRevision: revision,
      action: "patch",
      value: {
        fullName: "Анна",
        specialization: "Консультант",
        bio,
        photos,
        socialLinks: ["https://example.com/profile"],
        onlineRoomType: "STATIC_LINK",
        staticRoomLink: "https://example.com/room",
        services: [
          {
            id: randomUUID(),
            title: "Консультация",
            format: "ONLINE",
            eventDelivery: null,
            durationMinutes: 60,
            price: { kind: "exact", minRub: "2500.00", maxRub: null },
            description: bio,
            audience: "Взрослые",
            result: "План шагов",
            expiryDate: null,
            detailsUrl: null,
            tags: ["#тревожность"],
          },
        ],
      },
    });
    revision = r.revision;
    const staffCommand = () => ({
      sessionHash: manager.sessionHash,
      applicationId: f.applicationId,
      expectedRevision: revision,
      idempotencyKey: randomUUID(),
    });
    revision = (
      await repo.editPublicCard({
        ...staffCommand(),
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
      expectedRevision: revision,
      action: "preview",
    });
    let ownerPhotos = 0;
    while (preview.pageText!.split("\n").at(-1)!.startsWith("/card_preview")) {
      const c = preview.pageText!.split("\n").at(-1)!.split(" ");
      preview = await repo.richAction({
        ...event(f.work),
        expectedRevision: revision,
        action: "preview",
        page: Number(c[2]),
        token: c[3]!,
      });
      const ownerLink = preview
        .pageText!.split("\n")
        .find((line) => line.startsWith(base));
      if (ownerLink) {
        ownerPhotos++;
        expect(new URL(ownerLink).searchParams.get("X-Amz-Expires")).toBe(
          "120",
        );
        expect(
          Buffer.from(await (await fetch(ownerLink)).arrayBuffer()),
        ).toEqual(bytes);
      }
    }
    expect(ownerPhotos).toBe(3);
    await expect(
      repo.richAction({
        ...event({ ...f.work, telegramUserId: "999999", chatId: "999999" }),
        expectedRevision: revision,
        action: "preview",
      }),
    ).rejects.toThrow("card_forbidden");
    const token = preview.pageText!.split(" ").at(-1)!;
    await repo.richAction({
      ...event(f.work),
      expectedRevision: revision,
      action: "confirm",
      token,
    });
    await repo.submitDraft({ ...event(f.work), expectedRevision: revision });
    const detail = await repo.readDraft(manager.sessionHash, f.applicationId);
    const approved = await repo.reviewCard({
      ...staffCommand(),
      action: "approve",
      warningAcknowledgment: detail!.safety.digest,
    });
    expect(approved.status).toBe("approved");
    expect(
      (
        await database.db.execute(
          sql`select profile from resident_card_versions where review_id=${approved.reviewId!}::uuid`,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await database.db.execute(
          sql`select id from expert_card_material_jobs where review_id=${approved.reviewId!}::uuid`,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await database.db.execute(
          sql`select * from experts_published where user_id=${f.userId}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
    const link = await repo.richMediaLink(
      manager.sessionHash,
      f.applicationId,
      photos[0]!,
    );
    expect(link.expiresIn).toBe(120);
    expect(link.url).toContain("X-Amz-Signature");
    await database.db.execute(
      sql`insert into expert_card_material_templates(content_version,status,text_body) values(${randomUUID()},'approved','Материалы для участника')`,
    );
    const job = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_card_material_jobs where review_id=${approved.reviewId!}::uuid`,
      )
    ).rows[0]!;
    expect(await repo.deliverMaterials(job.id)).toMatchObject({
      kind: "delivered",
    });
    await repo.submitPromoProof({
      ...event(f.work),
      expectedRevision: revision,
      proof: { kind: "link", reference: "https://example.com/promo" },
    });
    await repo.confirmPromo(staffCommand());
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
    await financial.acceptMain({
      ...event(f.work),
      quoteId: quote.id,
      revision,
    });
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
    const operation = await operations.bindProviderObject(
      claimed.id,
      paymentId,
    );
    const paymentProof = await new YooKassaPaymentVerifier(
      client(providerPayment(paymentId, order.orderId, order.cashMinor)),
      operations,
    ).verifyPayment(operation);
    if (!paymentProof) throw Error("fixture_main_proof_missing");
    expect(
      await new PostgresExpertResidencyProviderInboxRepository(
        database.db,
      ).settle(paymentProof),
    ).toMatchObject({ kind: "settled" });
    const paidBefore = (
      await database.db.execute<{
        reviewId: string;
        paidOrderId: string;
        expertId: string;
      }>(
        sql`select review_id as "reviewId",paid_order_id as "paidOrderId",expert_id as "expertId" from experts_published where user_id=${f.userId}::uuid and active`,
      )
    ).rows[0]!;
    expect(paidBefore.reviewId).toBe(approved.reviewId);
    const { PostgresCatalogRepository } =
      await import("../../packages/db/src/repositories/catalog-repository.js");
    const serviceId = (
      await database.db.execute<{ id: string }>(
        sql`insert into expert_services(expert_id,code,language,name,duration_minutes,active) values(${paidBefore.expertId}::uuid,'consultation','ru','Консультация',60,true) returning id`,
      )
    ).rows[0]!.id;
    const catalog = new PostgresCatalogRepository(database.db);
    const catalogName = async () =>
      (await catalog.listPublicServices({ limit: 20 })).find(
        (x) => x.sourceKey === serviceId,
      )?.displayName;
    expect(await catalogName()).toBe("Анна");

    r = await repo.richAction({
      ...event(f.work),
      expectedRevision: revision,
      action: "patch",
      value: { bio: bio + " Новая версия." },
    });
    expect(r.revision).toBe(revision + 1);
    expect(
      (await repo.readDraft(manager.sessionHash, f.applicationId))
        ?.previousVersion,
    ).toMatchObject({ revision, profile: { bio } });
    await expect(
      repo.reviewCard({ ...staffCommand(), action: "approve" }),
    ).rejects.toThrow();
    const removed = await repo.richAction({
      ...event(f.work),
      expectedRevision: r.revision,
      action: "remove_photo",
      value: 1,
    });
    const reselectEvent = event(f.work);
    const reselectedEntry = await repo.addEntry({
      ...reselectEvent,
      expectedRevision: removed.revision,
      entry: { kind: "photo", reference: "telegram:file:photo_0" },
    });
    expect(
      await repo.ingestRichPhoto({
        ...reselectEvent,
        expectedRevision: reselectedEntry.revision,
        reference: "telegram:file:photo_0",
        size: bytes.length,
        mimeType: "image/jpeg",
      }),
    ).toMatchObject({ id: photos[0], state: "verified" });
    expect(objectWrites).toBe(3);
    expect(
      (
        await database.db.execute<{ profile: { photos: string[] } }>(
          sql`select profile from resident_card_versions where review_id=${approved.reviewId!}::uuid`,
        )
      ).rows[0]!.profile.photos,
    ).toEqual(photos);
    expect(
      (await repo.readDraft(manager.sessionHash, f.applicationId))!.rich!
        .profile!.photos,
    ).toContain(photos[0]);
    r = { ...r, ...(await repo.getWorkflow(f.work))! };
    const { lockCardActivationGate } =
      await import("../../packages/db/src/repositories/expert-card-repository.js");
    expect(
      await database.db.transaction((tx) =>
        lockCardActivationGate(tx, {
          applicationId: f.applicationId,
          userId: f.userId,
        }),
      ),
    ).toMatchObject({ reviewId: approved.reviewId, revision });
    expect(
      (
        await database.db.execute(
          sql`select expert_card_activation_gate_valid(${f.userId}::uuid,${approved.reviewId!}::uuid) as ready`,
        )
      ).rows[0]?.ready,
    ).toBe(true);
    const { PostgresExpertResidencyLifecycleRepository } =
      await import("../../packages/db/src/repositories/expert-residency-lifecycle-repository.js");
    const { createExpertResidencyLifecycleService } =
      await import("../../packages/application/src/expert-residency-lifecycle-service.js");
    const lifecycle = new PostgresExpertResidencyLifecycleRepository(
      database.db,
      {
        workBotId: workScope.botId,
        workBotKey: workScope.botKey,
        messagingConsentPolicyVersion: "client-messaging-v1",
      },
    );
    // Synthetic calendar positioning only: retain the real settled order, duration, tariff, provider facts and admissions; all SQL constraints/triggers stay enabled.
    await database.db.execute(
      sql`update expert_residency_orders set settled_at=settled_at-interval '30 days'+interval '20 seconds',residency_starts_at=residency_starts_at-interval '30 days'+interval '20 seconds',residency_ends_at=residency_ends_at-interval '30 days'+interval '20 seconds' where id=${paidBefore.paidOrderId}::uuid`,
    );
    await database.db.execute(
      sql`update experts_published p set next_billing_date=o.residency_ends_at from expert_residency_orders o where p.paid_order_id=o.id and o.id=${paidBefore.paidOrderId}::uuid`,
    );
    await lifecycle.processLifecycleBatch(10);
    expect(await lifecycle.readLifecycle(f.work)).toMatchObject({
      revision,
      bill: { readiness: "ready" },
    });
    const renewal = createExpertResidencyLifecycleService({
      enabled: true,
      workBotId: workScope.botId,
      workBotKey: workScope.botKey,
      paymentMode: "test",
      repository: lifecycle,
      financial,
    });
    const renew = async (text: string) =>
      renewal.handleWork({
        ...f.work,
        updateId: String(++sequence),
        requestDigest: hash(sequence + text),
        content: { kind: "text", text },
      });
    expect((await renew("/renewal")).text).toContain("Счёт продления");
    expect((await renew(`/renewal_quote ${tariffId} 1`)).text).toContain(
      "Предложение продления",
    );
    const bill = (await lifecycle.readLifecycle(f.work))!.bill!;
    let renewalOrder = "";
    if (!nextDraft) {
      expect((await renew(`/renewal_accept ${bill.quoteId}`)).text).toContain(
        "Счёт продления",
      );
      if (!nextDraft)
        expect((await renew("/renewal_invoice")).text).toContain(
          "Счёт продления",
        );
      renewalOrder = (await lifecycle.readLifecycle(f.work))!.bill!.orderId!;
    }
    revision = r.revision;
    revision = (
      await repo.editPublicCard({
        ...staffCommand(),
        publicCard: {
          displayName: "Анна Обновлённая",
          profession: "Консультант",
          city: "Казань",
          summary: bio,
        },
      })
    ).revision;
    let second = await repo.richAction({
      ...event(f.work),
      expectedRevision: revision,
      action: "preview",
    });
    while (second.pageText!.split("\n").at(-1)!.startsWith("/card_preview")) {
      const c = second.pageText!.split("\n").at(-1)!.split(" ");
      second = await repo.richAction({
        ...event(f.work),
        expectedRevision: revision,
        action: "preview",
        page: Number(c[2]),
        token: c[3]!,
      });
    }
    await repo.richAction({
      ...event(f.work),
      expectedRevision: revision,
      action: "confirm",
      token: second.pageText!.split(" ").at(-1)!,
    });
    await repo.submitDraft({ ...event(f.work), expectedRevision: revision });
    await expect(
      repo.reviewCard({ ...staffCommand(), action: "return_changes" }),
    ).rejects.toThrow();
    await repo.reviewCard({
      ...staffCommand(),
      action: "return_changes",
      returnReason: "Уточните описание",
    });
    expect(await lifecycle.readLifecycle(f.work)).toMatchObject({
      revision: approved.revision,
      bill: {
        readiness: "ready",
        ...(nextDraft ? {} : { orderId: renewalOrder }),
      },
    });
    expect((await renew("/renewal")).text).toContain("Счёт продления");
    if (!nextDraft)
      expect((await renew("/renewal_invoice")).text).toContain(
        "Счёт продления",
      );
    const ownerApp = await workHttp(repo);
    try {
      const notice = await ownerApp.inject({
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
            text: "/card",
          },
        },
      });
      expect(notice.json().text).toContain("Уточните описание");
      expect(notice.json().text).toContain("нужны уточнения");
    } finally {
      await ownerApp.close();
    }

    expect(
      (
        await database.db.execute(
          sql`select review_id from experts_published where user_id=${f.userId}::uuid and active`,
        )
      ).rows[0]?.review_id,
    ).toBe(approved.reviewId);
    expect(
      await database.db.transaction((tx) =>
        lockCardActivationGate(tx, {
          applicationId: f.applicationId,
          userId: f.userId,
        }),
      ),
    ).toMatchObject({ reviewId: approved.reviewId });
    expect(await catalogName()).toBe("Анна");
    await repo.submitDraft({ ...event(f.work), expectedRevision: revision });
    const current = await repo.readDraft(manager.sessionHash, f.applicationId);
    const update = await repo.reviewCard({
      ...staffCommand(),
      action: "approve",
      warningAcknowledgment: current!.safety.digest,
    });
    const live = (
      await database.db.execute(
        sql`select review_id,paid_order_id from experts_published where user_id=${f.userId}::uuid and active`,
      )
    ).rows[0]!;
    expect(live).toEqual({
      review_id: update.reviewId,
      paid_order_id: paidBefore.paidOrderId,
    });
    expect(await catalogName()).toBe("Анна Обновлённая");
    const { restoreSettledMainCardProjection } =
      await import("../../packages/db/src/repositories/expert-residency-main-projection.js");
    expect(
      await database.db.transaction((tx) =>
        restoreSettledMainCardProjection(tx, {
          userId: f.userId,
          expertId: paidBefore.expertId,
        }),
      ),
    ).toBe(true);
    expect(
      (
        await database.db.execute(
          sql`select review_id from experts_published where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.review_id,
    ).toBe(update.reviewId);
    await database.db.execute(
      sql`select pg_sleep(least(21,greatest(0,extract(epoch from(residency_ends_at-clock_timestamp())))+0.03)) from expert_residency_orders where id=${paidBefore.paidOrderId}::uuid`,
    );
    revision = (
      await repo.editPublicCard({
        ...staffCommand(),
        publicCard: {
          displayName: "Анна После Продления",
          profession: "Консультант",
          city: "Казань",
          summary: bio,
        },
      })
    ).revision;
    let expiredPreview = await repo.richAction({
      ...event(f.work),
      expectedRevision: revision,
      action: "preview",
    });
    while (
      expiredPreview.pageText!.split("\n").at(-1)!.startsWith("/card_preview")
    ) {
      const c = expiredPreview.pageText!.split("\n").at(-1)!.split(" ");
      expiredPreview = await repo.richAction({
        ...event(f.work),
        expectedRevision: revision,
        action: "preview",
        page: Number(c[2]),
        token: c[3]!,
      });
    }
    await repo.richAction({
      ...event(f.work),
      expectedRevision: revision,
      action: "confirm",
      token: expiredPreview.pageText!.split(" ").at(-1)!,
    });
    await repo.submitDraft({ ...event(f.work), expectedRevision: revision });
    const privateApproval = await repo.reviewCard({
      ...staffCommand(),
      action: "approve",
      warningAcknowledgment: (await repo.readDraft(
        manager.sessionHash,
        f.applicationId,
      ))!.safety.digest,
    });
    expect(privateApproval.status).toBe("approved");
    expect(
      (
        await database.db.execute(
          sql`select active from experts_published where user_id=${f.userId}::uuid`,
        )
      ).rows[0]?.active,
    ).toBe(false);
    expect(await catalogName()).toBeUndefined();
    if (nextDraft) {
      const approvedRevision = revision;
      revision = (
        await repo.richAction({
          ...event(f.work),
          expectedRevision: revision,
          action: "patch",
          value: { bio: bio + " Черновик C, ещё не утверждён." },
        })
      ).revision;
      expect(await lifecycle.readLifecycle(f.work)).toMatchObject({
        revision: approvedRevision,
        bill: { readiness: "ready" },
      });
      if (nextDraft === "changes_requested") {
        let previewC = await repo.richAction({
          ...event(f.work),
          expectedRevision: revision,
          action: "preview",
        });
        while (
          previewC.pageText!.split("\n").at(-1)!.startsWith("/card_preview")
        ) {
          const c = previewC.pageText!.split("\n").at(-1)!.split(" ");
          previewC = await repo.richAction({
            ...event(f.work),
            expectedRevision: revision,
            action: "preview",
            page: Number(c[2]),
            token: c[3]!,
          });
        }
        await repo.richAction({
          ...event(f.work),
          expectedRevision: revision,
          action: "confirm",
          token: previewC.pageText!.split(" ").at(-1)!,
        });
        await repo.submitDraft({
          ...event(f.work),
          expectedRevision: revision,
        });
        await repo.reviewCard({
          ...staffCommand(),
          action: "return_changes",
          returnReason: "Уточните черновик C",
        });
      }
      expect(await lifecycle.readLifecycle(f.work)).toMatchObject({
        revision: approvedRevision,
        bill: { readiness: "ready" },
      });
      expect((await renew("/renewal")).text).toContain("Счёт продления");
      expect((await renew(`/renewal_quote ${tariffId} 1`)).text).toContain(
        "Предложение продления",
      );
      const currentBill = (await lifecycle.readLifecycle(f.work))!.bill!;
      expect(
        (await renew(`/renewal_accept ${currentBill.quoteId}`)).text,
      ).toContain("Счёт продления");
      expect((await renew("/renewal_invoice")).text).toContain(
        "Счёт продления",
      );
      renewalOrder = (await lifecycle.readLifecycle(f.work))!.bill!.orderId!;
      expect(
        (
          await database.db.execute(
            sql`select review_id from expert_card_main_orders where order_id=${renewalOrder}::uuid`,
          )
        ).rows[0]?.review_id,
      ).toBe(privateApproval.reviewId);
    }
    const renewalCash = (
      await database.db.execute<{ cash: string }>(
        sql`select cash_minor::text cash from expert_residency_orders where id=${renewalOrder}::uuid`,
      )
    ).rows[0]!.cash;
    const renewalClaim = await operations.claim({
      commandId: randomUUID(),
      orderId: renewalOrder,
      kind: "create_payment",
      mode: "test",
      amountMinor: renewalCash,
      currency: "RUB",
      requestDigest: "sha256:" + hash(renewalOrder),
    });
    const renewalPaymentId = "synthetic_" + randomUUID();
    const renewalOperation = await operations.bindProviderObject(
      renewalClaim.id,
      renewalPaymentId,
    );
    const renewalProof = await new YooKassaPaymentVerifier(
      client(providerPayment(renewalPaymentId, renewalOrder, renewalCash)),
      operations,
    ).verifyPayment(renewalOperation);
    if (!renewalProof) throw Error("renewal_proof_missing");
    expect(
      await new PostgresExpertResidencyProviderInboxRepository(
        database.db,
      ).settle(renewalProof),
    ).toMatchObject({ kind: "settled" });
    expect(
      (
        await database.db.execute(
          sql`select review_id,active,paid_order_id from experts_published where user_id=${f.userId}::uuid`,
        )
      ).rows[0],
    ).toEqual({
      review_id: privateApproval.reviewId,
      active: true,
      paid_order_id: renewalOrder,
    });
    expect(await catalogName()).toBe("Анна После Продления");
    if (nextDraft) {
      expect((await repo.getWorkflow(f.work))!.status).toBe(nextDraft);
      expect(
        (
          await database.db.execute(
            sql`select approved_review_id from expert_card_drafts where user_id=${f.userId}::uuid`,
          )
        ).rows[0]?.approved_review_id,
      ).toBeNull();
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from resident_card_versions where draft_id=${privateApproval.draftId!}::uuid and revision=${revision}`,
          )
        ).rows[0]?.n,
      ).toBe(0);
    }

    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_onboarding_invoices where application_id=${f.applicationId}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_card_material_jobs where draft_id=${approved.draftId!}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(1);

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
    await expect(
      repo.richMediaLink(manager.sessionHash, f.applicationId, photos[0]!),
    ).rejects.toThrow();
    await expect(
      repo.richAction({
        ...event(f.work),
        expectedRevision: revision,
        action: "preview",
      }),
    ).rejects.toThrow();
    await privacy.startErasureAtomically({
      targetUserId: f.userId,
      correlationId: "rich-erase:" + f.userId,
      idempotencyKey: "rich-erase:" + f.userId,
      pseudonym: "hmac:synthetic-rich-erasure",
    });
    expect(
      (
        await database.db.execute(
          sql`select * from resident_card_versions where draft_id=${approved.draftId!}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await database.db.execute(
          sql`select id from resident_card_media where id=any(${"{" + photos.join(",") + "}"}::uuid[])`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await database.db.execute(
          sql`select custody_id from resident_object_deletions where custody_id=any(${"{" + photos.join(",") + "}"}::uuid[]) and erased and delete_state='pending'`,
        )
      ).rows,
    ).toHaveLength(3);
    await expect(
      repo.richMediaLink(manager.sessionHash, f.applicationId, photos[0]!),
    ).rejects.toThrow();
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
}
it(
  "real private photo adapter, complete owner confirmation, manager version and erasure obligations",
  () => paidVersionWitness(),
  45000,
);
it.each(["collecting", "changes_requested"] as const)(
  "R6 second renewal restores private approved B while later C is %s",
  (status) => paidVersionWitness(status),
  45000,
);

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
it("authenticated real Telegram route delivers master checklist and guided/proposal commands with ownership fencing", async () => {
  const f = await linked(),
    app = await workHttp(f.card);
  const send = (
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
    expect((await send("/card_checklist", "wrong")).statusCode).toBe(401);
    const checklist = await send("/card_checklist");
    expect(checklist.json().text).toContain("мастер-чек-лист");
    expect(checklist.json().text.length).toBeLessThan(4000);
    expect((await send("/card_answer 0 fullName Анна")).json().text).toContain(
      "Ревизия 1",
    );
    expect((await send("/card_submit 1")).json().text).toContain(
      "Заполните поля:",
    );
    expect(
      (await send("/card_import 1 specialization: Консультант")).json().text,
    ).toContain("Предложение сохранено");
    expect((await send("/card_proposal 2")).json().text).toContain(
      "Консультант",
    );
    const foreign = await send("/card_preview 2", undefined, "999999");
    expect(JSON.stringify(foreign.json())).not.toContain("Анна");
  } finally {
    await app.close();
  }
});

it.skipIf(!process.env.II_TONYA_PRIVATE_PARSER_TEST_SOCKET)(
  "original-bot PDF and DOCX pass the isolated parser into reviewed proposals, failed files retain raw entry",
  async () => {
    const { createServer } = await import("node:http");
    const files = richDocumentFixtures();
    files.docx = richDocumentFixtures(
      "fullName: Anna\nspecialization: Consultant\nНазвание услуги: Полная\nФормат: онлайн\nДлительность, минут: 45\nСтоимость, рублей: 1200,50\nОписание услуги: Помогаю разобраться в жизненных задачах и выбрать собственные следующие шаги.\nДля кого: Взрослые\nОжидаемый результат: План\nТемы и теги: поддержка\nДействует до: нет\nПодробнее об услуге: нет\nНазвание услуги: Дополнить\nФормат: очно\nСтоимость, рублей: 2100,25\nТемы и теги: развитие\nПолный адрес: Казань, улица Центральная, 1\nКак добраться: Главный вход",
    ).docx;
    let chosen: keyof typeof files = "pdf";
    const server = createServer((q, s) => {
      const bytes = files[chosen];
      if (q.url!.endsWith("/getFile"))
        s.end(
          JSON.stringify({
            ok: true,
            result: {
              file_id: "rich_" + chosen,
              file_size: bytes.length,
              file_path: "documents/rich." + chosen,
            },
          }),
        );
      else s.end(bytes);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base =
      "http://127.0.0.1:" + (server.address() as { port: number }).port;
    try {
      for (const type of ["pdf", "docx", "bad"] as const) {
        chosen = type;
        const f = await linked();
        const mimeType =
          type === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/pdf";
        const app = await workHttp(
          f.card,
          undefined,
          undefined,
          normalComposition(
            base,
            process.env.II_TONYA_PRIVATE_PARSER_TEST_SOCKET!,
          ),
        );
        try {
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
                document: {
                  file_id: "rich_" + type,
                  file_size: files[type].length,
                  mime_type: mimeType,
                },
              },
            },
          });
          expect(response.statusCode).toBe(200);
          const detail = await f.card.readDraft(
            manager.sessionHash,
            f.applicationId,
          );
          expect(detail!.entries).toHaveLength(1);
          expect(detail!.rich?.profile?.fullName).toBe("");
          if (type === "bad") {
            expect(response.json().text).toBe(
              "Не удалось прочитать файл автоматически. Давайте пройдемся по вопросам вручную.",
            );
          } else {
            expect(response.json().text).toContain("предложение");
            expect(detail!.rich?.proposal).toMatchObject({
              fullName: "Anna",
              specialization: "Consultant",
            });
            if (type === "docx")
              expect(detail!.rich?.proposal).toMatchObject({
                services: [
                  {
                    title: "Полная",
                    durationMinutes: 45,
                    price: { minRub: "1200.50" },
                    tags: ["поддержка"],
                  },
                ],
                partialServices: [
                  {
                    title: "Дополнить",
                    format: "OFFLINE",
                    price: { minRub: "2100.25" },
                    tags: ["развитие"],
                  },
                ],
                address: "Казань, улица Центральная, 1",
                arrival: "Главный вход",
              });
            const p = await f.card.richAction({
              ...event(f.work),
              expectedRevision: 1,
              action: "proposal_preview",
            });
            if (type === "docx") {
              expect(p.pageText).toContain("Дополнить");
              expect(p.pageText).toContain("1200.50");
              expect(p.pageText).toContain("2100.25");
            }
            await f.card.richAction({
              ...event(f.work),
              expectedRevision: 1,
              action: "accept_proposal",
              token: p.pageText!.split(" ").at(-1)!,
            });
            expect(
              (await f.card.readDraft(manager.sessionHash, f.applicationId))!
                .rich?.profile?.fullName,
            ).toBe("Anna");
          }
        } finally {
          await app.close();
        }
      }
    } finally {
      await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    }
  },
);
it("guided Russian bot questions complete a service without JSON, revision or UUID input", async () => {
  const f = await linked(),
    app = await workHttp(f.card);
  const send = (text: string) =>
    app.inject({
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
  try {
    expect((await send("/card_mode")).json().text).toContain("имя");
    const bio =
      "Помогаю разобраться в задачах и выбрать собственные следующие шаги без обещаний результата.";
    for (const answer of [
      "Анна",
      "Консультант",
      bio,
      "https://example.com/profile",
      "Консультация",
      "онлайн",
      "60",
      "2500,50",
      bio,
      "Взрослые",
      "План шагов",
      "поддержка, развитие",
      "нет",
      "нет",
      "https://example.com/room",
    ]) {
      const r = await send("/card_answer " + answer);
      expect(r.json().text).toContain("Сохранено");
    }
    const detail = await f.card.readDraft(manager.sessionHash, f.applicationId);
    expect(detail!.rich?.profile).toMatchObject({
      fullName: "Анна",
      staticRoomLink: "https://example.com/room",
      services: [
        {
          id: expect.any(String),
          title: "Консультация",
          durationMinutes: 60,
          price: { kind: "exact", minRub: "2500.50", maxRub: null },
        },
      ],
    });
    const page = await send("/card_preview");
    expect(page.json().text).toContain("Название услуги");
    expect(page.json().text).not.toContain('"minRub"');
    expect((await send("/card_mode")).json().text).toContain("три разных фото");
  } finally {
    await app.close();
  }
});
it("R1/R2 actual repeated automatic guided input and full service imports change revision only once", async () => {
  const f = await linked(),
    app = await workHttp(f.card);
  const send = (text: string, update = ++sequence) =>
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
    for (const text of ["/card_mode", "/card_answer Анна"]) {
      const update = ++sequence;
      const first = await send(text, update);
      expect(first.json().text).toContain("Сохранено");
      const before = (await f.card.getWorkflow(f.work))!.revision;
      expect((await send(text, update)).json().duplicate).toBe(true);
      expect((await f.card.getWorkflow(f.work))!.revision).toBe(before);
      expect(
        (await send(text + " изменено", update)).json().duplicate,
      ).not.toBe(true);
    }
    const rev = (await f.card.getWorkflow(f.work))!.revision;
    const text = `/card_import ${rev} Название услуги: Консультация\nФормат: онлайн\nДлительность, минут: 60\nСтоимость, рублей: 1000\nОписание услуги: Подробное описание консультации без обещаний и гарантированных результатов.\nДля кого: Взрослые\nОжидаемый результат: План\nТемы и теги: поддержка\nДействует до: нет\nПодробнее об услуге: нет`;
    const update = ++sequence;
    expect((await send(text, update)).json().text).toContain("Предложение");
    expect((await send(text, update)).json().duplicate).toBe(true);
    expect((await f.card.getWorkflow(f.work))!.revision).toBe(rev + 1);
  } finally {
    await app.close();
  }
});
it("R7 SQL rejects null price discriminators and R5 mixed-case identity aliases", async () => {
  const f = await linked();
  await f.card.richAction({
    ...event(f.work),
    expectedRevision: 0,
    action: "start",
  });
  expect(
    (
      await database.db.execute(
        sql`select resident_rich_digest(d)=encode(digest(jsonb_build_object('revision',d.revision,'profile',d.rich_profile,'public',d.public_payload,'proposal',d.rich_proposal,'guided',d.rich_guided)::text,'sha256'),'hex') as compatible from expert_card_drafts d where user_id=${f.userId}::uuid`,
      )
    ).rows[0]?.compatible,
  ).toBe(true);
  const { emptyRichProfile } =
    await import("../../packages/contracts/src/index.js");
  const a = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  const service = {
    id: a,
    title: "Услуга",
    format: "ONLINE",
    eventDelivery: null,
    durationMinutes: 60,
    price: { kind: null, minRub: "1000.00", maxRub: "2000.00" },
    description: "Описание",
    audience: "Все",
    result: "План",
    expiryDate: null,
    detailsUrl: null,
    tags: ["тема"],
  };
  const valid = async (p: unknown) =>
    (
      await database.db.execute(
        sql`select resident_rich_profile_valid(${JSON.stringify(p)}::jsonb,false) valid`,
      )
    ).rows[0]?.valid;
  expect(await valid({ ...emptyRichProfile(), services: [service] })).toBe(
    false,
  );
  expect(
    await valid({
      ...emptyRichProfile(),
      services: [
        { ...service, price: { kind: "exact", minRub: "1.00", maxRub: null } },
        {
          ...service,
          id: a.toUpperCase(),
          price: { kind: "exact", minRub: "1.00", maxRub: null },
        },
      ],
    }),
  ).toBe(false);
});

function normalComposition(
  base: string,
  parserSocket?: string,
  privateEnabled = true,
) {
  const config = {
    features: { expertCard: true, residentPrivateJobs: privateEnabled },
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
    privateVerification: {
      bucket: "rich-cards",
      region: "ru-local",
      endpoint: base,
      credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
      dedicatedNonVersionedVerified: true,
      localEvidence: true,
      ...(parserSocket ? { parserSocket, ocr: false } : {}),
    },
  } as unknown as RuntimeConfig;
  return createExpertCardComposition(database.db, config, {
    privateTelegramFetch: (url, init) =>
      fetch(base + new URL(String(url)).pathname, init),
  })!;
}

async function sendText(
  app: Awaited<ReturnType<typeof workHttp>>,
  work: { chatId: string },
  text: string,
) {
  const update = ++sequence;
  return app.inject({
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
        from: { id: Number(work.chatId) },
        chat: { id: Number(work.chatId), type: "private" },
        text,
      },
    },
  });
}
it("R3 legacy photos retain original input without private write, and erasure removes their reference", async () => {
  const f = await linked(false);
  let writes = 0;
  const repo = new PostgresExpertCardRepository(database.db, {
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
    photoCustody: {
      read: async () => new Uint8Array([1]),
      put: async () => {
        writes++;
        return true;
      },
      presign: async () => "https://example.com",
    },
  });
  const e = event(f.work),
    reference = "telegram:file:legacy_photo";
  const r = await repo.addEntry({
    ...e,
    expectedRevision: 0,
    entry: { kind: "photo", reference },
  });
  expect(
    await repo.ingestRichPhoto({
      ...e,
      expectedRevision: r.revision,
      reference,
      size: 1,
      mimeType: "image/jpeg",
    }),
  ).toMatchObject({ state: "legacy" });
  expect(writes).toBe(0);
  expect(
    (await repo.readDraft(manager.sessionHash, f.applicationId))!.entries[0],
  ).toMatchObject({ reference });
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from resident_card_media m join expert_card_drafts d on d.id=m.draft_id where d.user_id=${f.userId}::uuid`,
      )
    ).rows[0]?.n,
  ).toBe(0);
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
  await privacy.startErasureAtomically({
    targetUserId: f.userId,
    correlationId: randomUUID(),
    idempotencyKey: randomUUID(),
    pseudonym: "hmac:synthetic-legacy-photo",
  });
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_card_entries e join expert_card_drafts d on d.id=e.draft_id where d.user_id=${f.userId}::uuid`,
      )
    ).rows[0]?.n,
  ).toBe(0);
});
it("R4 numbered owner removal permits replacement beyond ten historical uploads and preserves unknown custody", async () => {
  const f = await linked();
  let unknown = false;
  const repo = new PostgresExpertCardRepository(database.db, {
    richOnboarding: true,
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
    photoCustody: {
      read: async () => new Uint8Array([1]),
      put: async () => !unknown,
      presign: async () => "https://example.com/photo",
    },
  });
  const app = await workHttp(repo);
  let revision = 0;
  const history: string[] = [];
  try {
    for (let i = 0; i < 12; i++) {
      const e = event(f.work),
        reference = "telegram:file:replace_" + i;
      const r = await repo.addEntry({
        ...e,
        expectedRevision: revision,
        entry: { kind: "photo", reference },
      });
      const photo = await repo.ingestRichPhoto({
        ...e,
        expectedRevision: r.revision,
        reference,
        size: 1,
        mimeType: "image/jpeg",
      });
      expect(photo.state).toBe("verified");
      history.push(photo.id);
      revision = r.revision + 1;
      if (i < 11) {
        expect(
          (
            await sendText(app, f.work, `/card_photo_remove ${revision} 1`)
          ).json().text,
        ).toContain("Сохранено");
        revision++;
      }
    }
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from resident_object_deletions where custody_id=any(${"{" + history.join(",") + "}"}::uuid[]) and erased and delete_state='pending'`,
        )
      ).rows[0]?.n,
    ).toBe(11);
    const before = revision;
    expect(
      (
        await sendText(app, f.work, `/card_photo_remove ${revision - 1} 1`)
      ).json().text ?? "",
    ).not.toContain("Сохранено");
    expect((await repo.getWorkflow(f.work))!.revision).toBe(before);
    unknown = true;
    const e = event(f.work),
      reference = "telegram:file:uncertain";
    const r = await repo.addEntry({
      ...e,
      expectedRevision: revision,
      entry: { kind: "photo", reference },
    });
    const photo = await repo.ingestRichPhoto({
      ...e,
      expectedRevision: r.revision,
      reference,
      size: 1,
      mimeType: "image/jpeg",
    });
    expect(photo.state).toBe("unknown");
    expect(
      (
        await database.db.execute(
          sql`select erased,write_state from resident_object_deletions where custody_id=${photo.id}::uuid`,
        )
      ).rows[0],
    ).toEqual({ erased: false, write_state: "unknown" });
  } finally {
    await app.close();
  }
});
it("R10 multiple partial Russian imports preview every field and guided completion asks only their gaps", async () => {
  const f = await linked(),
    app = await workHttp(f.card);
  const bio =
    "Помогаю разобраться в задачах и выбрать собственные следующие шаги без обещаний результата.";
  try {
    await f.card.richAction({
      ...event(f.work),
      expectedRevision: 0,
      action: "patch",
      value: {
        fullName: "Анна",
        specialization: "Консультант",
        bio,
        socialLinks: ["https://example.com/profile"],
      },
    });
    for (const source of [
      `Название услуги: Первая\nФормат: онлайн\nДлительность, минут: 45\nОписание услуги: ${bio}\nДля кого: Взрослые\nОжидаемый результат: План\nТемы и теги: поддержка\nДействует до: нет\nПодробнее об услуге: нет`,
      `Название услуги: Вторая\nФормат: очно\nСтоимость, рублей: 2100,25\nОписание услуги: ${bio}\nДля кого: Семьи\nОжидаемый результат: План\nТемы и теги: развитие\nДействует до: нет\nПодробнее об услуге: нет`,
    ]) {
      let rev = (await f.card.getWorkflow(f.work))!.revision;
      expect(
        (await sendText(app, f.work, `/card_import ${rev} ${source}`)).json()
          .text,
      ).toContain("Предложение");
      rev++;
      let page = (await sendText(app, f.work, `/card_proposal ${rev}`)).json()
        .text;
      let shown = page;
      while (page.split("\n").at(-1)!.startsWith("/card_proposal")) {
        page = (await sendText(app, f.work, page.split("\n").at(-1)!)).json()
          .text;
        shown += page;
      }
      expect(shown).toContain(source.includes("Первая") ? "45" : "2100.25");
      expect(shown).toContain(
        source.includes("Первая") ? "поддержка" : "развитие",
      );
      expect(shown).toContain(bio);
      expect(
        (await sendText(app, f.work, page.split("\n").at(-1)!)).json().text,
      ).toContain("Стоимость в рублях");
    }
    let detail = (await f.card.readDraft(
      manager.sessionHash,
      f.applicationId,
    ))!;
    expect(detail.rich!.guided).toMatchObject({
      title: "Первая",
      durationMinutes: 45,
    });
    expect(detail.rich!.pending).toMatchObject([
      { title: "Вторая", price: { minRub: "2100.25" } },
    ]);
    expect(
      (await sendText(app, f.work, "/card_answer 1000")).json().text,
    ).toContain("Сколько минут");
    expect(
      (await sendText(app, f.work, "/card_answer 90")).json().text,
    ).toContain("постоянной онлайн-комнаты");
    detail = (await f.card.readDraft(manager.sessionHash, f.applicationId))!;
    expect(detail.rich!.profile!.services).toMatchObject([
      { title: "Первая", durationMinutes: 45, price: { minRub: "1000.00" } },
      {
        title: "Вторая",
        durationMinutes: 90,
        price: { minRub: "2100.25" },
        audience: "Семьи",
      },
    ]);
    expect(detail.rich!.pending).toEqual([]);
  } finally {
    await app.close();
  }
});

it("R8 actual competing generic and card dispatch admits one delivery and retains its receipt", async () => {
  const f = await linked(false);
  let revision = (
    await f.card.addEntry({
      ...event(f.work),
      expectedRevision: 0,
      entry: {
        kind: "text",
        text: "Сведения об услуге и профессиональном опыте для проверки менеджером.",
      },
    })
  ).revision;
  const command = () => ({
    sessionHash: manager.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: revision,
    idempotencyKey: randomUUID(),
  });
  await f.card.submitDraft({ ...event(f.work), expectedRevision: revision });
  revision = (
    await f.card.editPublicCard({
      ...command(),
      publicCard: {
        displayName: "Анна",
        profession: "Консультант",
        city: "Казань",
        summary: "Индивидуальные консультации",
      },
    })
  ).revision;
  await f.card.reviewCard({ ...command(), action: "approve" });
  await database.db.execute(
    sql`insert into expert_card_material_templates(content_version,status,text_body) values(${randomUUID()},'approved','Материалы для владельца')`,
  );
  const genericId = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_application_material_jobs where application_id=${f.applicationId}::uuid`,
    )
  ).rows[0]!.id;
  const cardId = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_card_material_jobs where user_id=${f.userId}::uuid`,
    )
  ).rows[0]!.id;
  let sends = 0;
  const transport = {
    send: async (
      i: Parameters<
        NonNullable<
          ConstructorParameters<
            typeof PostgresExpertCardRepository
          >[1]["materialTransport"]
        >["send"]
      >[0],
    ) => {
      sends++;
      return {
        messageIds: ["123"],
        botId: i.botId,
        chatId: i.chatId,
        contentVersion: i.contentVersion,
        payloadDigest: i.payloadDigest,
      };
    },
  };
  const { PostgresExpertApplicationMaterials } =
    await import("../../packages/db/src/repositories/expert-application-materials.js");
  const generic = new PostgresExpertApplicationMaterials(
    database.db,
    "client-messaging-v1",
    transport,
  );
  const card = new PostgresExpertCardRepository(database.db, {
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
    materialTransport: transport,
  });
  const outcomes = await Promise.all([
    generic.deliver(genericId),
    card.deliverMaterials(cardId),
  ]);
  expect(outcomes).toEqual([{ kind: "cancelled" }, { kind: "delivered" }]);
  expect(sends).toBe(1);
  await generic.deliver(genericId);
  expect(await card.deliverMaterials(cardId)).toMatchObject({
    kind: "already_delivered",
  });
  expect(sends).toBe(1);
  expect(
    (
      await database.db.execute(
        sql`select delivery_receipt is not null as receipt from expert_card_material_jobs where id=${cardId}::uuid`,
      )
    ).rows[0]?.receipt,
  ).toBe(true);
});

it("R2 full Russian service import keeps the same server identity on exact original-input replay", async () => {
  const f = await linked(),
    app = await workHttp(f.card);
  const update = ++sequence;
  const text =
    "/card_import 0 Название услуги: Консультация\nФормат: онлайн\nДлительность, минут: 60\nСтоимость, рублей: 1000\nОписание услуги: Подробное описание консультации без обещаний и гарантированных результатов.\nДля кого: Взрослые\nОжидаемый результат: План\nТемы и теги: поддержка\nДействует до: нет\nПодробнее об услуге: нет";
  const request = {
    method: "POST" as const,
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
  };
  try {
    expect((await app.inject(request)).json().text).toContain("Предложение");
    const proposed = (await f.card.readDraft(
      manager.sessionHash,
      f.applicationId,
    ))!.rich!.proposal;
    expect((await app.inject(request)).json().duplicate).toBe(true);
    expect(
      (await f.card.readDraft(manager.sessionHash, f.applicationId))!.rich!
        .proposal,
    ).toEqual(proposed);
    expect((await f.card.getWorkflow(f.work))!.revision).toBe(1);
  } finally {
    await app.close();
  }
});
it("R11 disabled normal composition retains originals and truthfully declines private custody and parsing", async () => {
  const f = await linked(),
    app = await workHttp(
      f.card,
      undefined,
      undefined,
      normalComposition("http://127.0.0.1:1", undefined, false),
    );
  try {
    for (const content of [
      {
        photo: [
          {
            file_id: "disabled_photo",
            file_unique_id: "disabled_unique",
            width: 20,
            height: 20,
            file_size: 8,
          },
        ],
      },
      {
        document: {
          file_id: "disabled_pdf",
          file_size: 100,
          mime_type: "application/pdf",
        },
      },
    ]) {
      const update = ++sequence;
      const response = await app.inject({
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
            ...content,
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().text).toContain(
        "photo" in content
          ? "хранилище пока недоступно"
          : "Не удалось прочитать файл автоматически",
      );
    }
    const detail = (await f.card.readDraft(
      manager.sessionHash,
      f.applicationId,
    ))!;
    expect(detail.entries).toHaveLength(2);
    expect(detail.rich!.profile!.photos).toEqual([]);
    expect(detail.rich!.proposal).toBeNull();
  } finally {
    await app.close();
  }
});
async function secondRichFixture(tag = "#тревожность") {
  const f = await linked();
  const repo = new PostgresExpertCardRepository(database.db, {
    richOnboarding: true,
    workBotId: workScope.botId,
    workBotKey: workScope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
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
it("R4 second manager API exposes selected photos in order beyond ten retained historical rows", async () => {
  const f = await secondRichFixture();
  const all = [...f.initialPhotos];
  let prior = [...all];
  await f.approve();
  for (let i = 0; i < 3; i++) {
    await f.repo.richAction({
      ...event(f.work),
      expectedRevision: await f.revision(),
      action: "patch",
      value: { photos: [] },
    });
    prior = await f.photos();
    all.push(...prior);
    await f.approve();
  }
  const selected = [...all].sort().reverse().slice(0, 3);
  await f.repo.richAction({
    ...event(f.work),
    expectedRevision: await f.revision(),
    action: "patch",
    value: { photos: selected },
  });
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from resident_card_media m join expert_card_drafts d on d.id=m.draft_id where d.user_id=${f.userId}::uuid`,
      )
    ).rows[0]?.n,
  ).toBe(12);
  const { createExpertCardAdminService } =
    await import("../../packages/application/src/expert-card-admin-service.js");
  const { expertCardAdminRoutes } =
    await import("../../apps/api/src/routes/expert-cards.js");
  const app = Fastify({ logger: false });
  await app.register(expertCardAdminRoutes, {
    enabled: true,
    service: createExpertCardAdminService({
      enabled: true,
      repository: f.repo,
    }),
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/expert-cards/" + f.applicationId,
      headers: { authorization: "Bearer " + manager.token },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const detail = body.item;
    expect(detail.media.map((m: { id: string }) => m.id)).toEqual(selected);
    expect(detail.previousMedia.map((m: { id: string }) => m.id)).toEqual(
      prior,
    );
    const links: Record<string, unknown> = {};
    for (const mediaId of [...new Set([...selected, ...prior])]) {
      const link = await app.inject({
        method: "POST",
        url: `/v1/admin/expert-cards/${f.applicationId}/media/${mediaId}/link`,
        headers: { authorization: "Bearer " + manager.token },
        payload: {},
      });
      expect(link.statusCode).toBe(200);
      links[mediaId] = link.json();
    }
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(".superpowers/sdd/rich-onboarding-second-20261027", {
      recursive: true,
    });
    writeFileSync(
      ".superpowers/sdd/rich-onboarding-second-20261027/manager-api-fixture.json",
      JSON.stringify({
        detail: body,
        links,
        selected,
        prior,
        retainedRows: 12,
      }),
    );
  } finally {
    await app.close();
  }
}, 30000);
it("R5 second legacy uppercase service edit removal and aliases preserve immutable approved JSON", async () => {
  const f = await secondRichFixture();
  const upper = f.service.id.toUpperCase();
  const other = {
    ...f.service,
    id: randomUUID().toUpperCase(),
    title: "Вторая",
  };
  await database.db.execute(
    sql`update expert_card_drafts set rich_profile=jsonb_set(rich_profile,'{services}',${JSON.stringify([{ ...f.service, id: upper }, other])}::jsonb),revision=revision+1 where user_id=${f.userId}::uuid`,
  );
  const approved = await f.approve();
  const immutable = (
    await database.db.execute<{ profile: unknown }>(
      sql`select profile from resident_card_versions where review_id=${approved.reviewId!}::uuid`,
    )
  ).rows[0]!.profile;
  const edited = await f.repo.richAction({
    ...event(f.work),
    expectedRevision: await f.revision(),
    action: "service",
    value: { ...f.service, title: "Исправленная" },
  });
  expect(edited.revision).toBe(approved.revision + 1);
  expect(
    (await f.repo.readDraft(manager.sessionHash, f.applicationId))!.rich!
      .profile!.services,
  ).toHaveLength(2);
  await database.db.execute(
    sql`update expert_card_drafts set rich_profile=jsonb_set(rich_profile,'{services,0,id}',${JSON.stringify(other.id)}::jsonb),revision=revision+1 where user_id=${f.userId}::uuid`,
  );
  await f.repo.richAction({
    ...event(f.work),
    expectedRevision: await f.revision(),
    action: "remove_service",
    value: other.id.toLowerCase(),
  });
  const current = (await f.repo.readDraft(
    manager.sessionHash,
    f.applicationId,
  ))!.rich!.profile!;
  expect(current.services).toMatchObject([
    { id: f.service.id, title: "Исправленная" },
  ]);
  expect(current.services).toHaveLength(1);
  await expect(
    f.repo.richAction({
      ...event(f.work),
      expectedRevision: await f.revision(),
      action: "patch",
      value: { services: [{ ...f.service, id: upper }, f.service] },
    }),
  ).rejects.toThrow();
  expect(
    (
      await database.db.execute<{ profile: unknown }>(
        sql`select profile from resident_card_versions where review_id=${approved.reviewId!}::uuid`,
      )
    ).rows[0]!.profile,
  ).toEqual(immutable);
});

it("S3b R4 complete review rejects pending rejected stale custom decisions and preserves immutable approval association", async () => {
  const f = await secondRichFixture("Личная практика");
  let { rev } = await f.prepareReview();
  const command = () => ({
    sessionHash: manager.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: rev,
    idempotencyKey: randomUUID(),
  });
  const review = async () =>
    f.repo.reviewCard({
      ...command(),
      action: "approve",
      warningAcknowledgment: (await f.repo.readDraft(
        manager.sessionHash,
        f.applicationId,
      ))!.safety.digest,
    });
  const decide = (decision: "approve" | "reject") =>
    f.repo.decideCustomTag({
      ...command(),
      identity: "custom:личная практика",
      decision,
      reason: "Решение по точной текущей версии",
    });
  await expect(review()).rejects.toThrow(
    "card_fields:Собственные теги ждут текущего решения менеджера.",
  );
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from resident_card_versions where draft_id=(select id from expert_card_drafts where application_id=${f.applicationId}::uuid)`,
      )
    ).rows[0]!.n,
  ).toBe(0);
  await decide("reject");
  await f.repo.submitDraft({ ...event(f.work), expectedRevision: rev });
  await expect(review()).rejects.toThrow(
    "card_fields:Собственные теги ждут текущего решения менеджера.",
  );
  ({ rev } = await f.prepareReview());
  await decide("approve");
  const staleRev = rev;
  ({ rev } = await f.prepareReview());
  expect(rev).toBeGreaterThan(staleRev);
  await expect(review()).rejects.toThrow(
    "card_fields:Собственные теги ждут текущего решения менеджера.",
  );
  await decide("approve");
  const approved = await review();
  expect(approved.status).toBe("approved");
  const proof = async () =>
    (
      await database.db.execute(
        sql`select to_jsonb(v) as version,jsonb_agg(to_jsonb(c) order by c.identity) as decisions from resident_card_versions v join resident_tag_decisions c on c.draft_id=v.draft_id and c.revision=v.revision where v.review_id=${approved.reviewId!}::uuid group by v.review_id,v.draft_id,v.revision,v.profile,v.public_payload,v.safety_fields,v.safety_proof,v.created_at`,
      )
    ).rows[0]!;
  const before = await proof();
  expect(JSON.stringify(before)).toContain("Личная практика");
  expect(JSON.stringify(before.decisions)).toContain('"decision":"approve"');
  await expect(
    database.db.execute(
      sql`update resident_tag_decisions set decision='reject' where draft_id=${approved.draftId!}::uuid and revision=${rev}`,
    ),
  ).rejects.toMatchObject({
    cause: expect.objectContaining({ message: "tag_decision_immutable" }),
  });
  ({ rev } = await f.prepareReview());
  await decide("reject");
  expect(await proof()).toEqual(before);
  console.log(
    JSON.stringify({
      completeCardPendingDenied: true,
      rejectedDenied: true,
      staleDenied: true,
      currentApproved: true,
      immutableVersionDecisionAssociation: true,
    }),
  );
}, 30000);
