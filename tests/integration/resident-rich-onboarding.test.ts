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
function cards() {
  return new PostgresExpertCardRepository(database.db, {
    richOnboarding: true,
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
it("real private photo adapter, complete owner confirmation, manager version and erasure obligations", async () => {
  const { createServer } = await import("node:http");
  const { createPrivateObjectStore, createTelegramDocumentReader } =
    await import("../../packages/integrations/src/documents/private-verification.js");
  const bytes = Buffer.from([255, 216, 255, 224, 1, 2, 3, 4]);
  const objects = new Map<
    string,
    { bytes: Buffer; headers: Record<string, string> }
  >();
  let base = "";
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
    for (let i = 0; i < 3; i++) {
      const entry = event(f.work),
        reference = "telegram:file:photo_" + i;
      const r = await repo.addEntry({
        ...entry,
        expectedRevision: revision,
        entry: { kind: "photo", reference },
      });
      const photo = await repo.ingestRichPhoto({
        ...entry,
        expectedRevision: r.revision,
        reference,
        size: bytes.length,
        mimeType: "image/jpeg",
      });
      expect(photo.state).toBe("verified");
      photos.push(photo.id);
      revision = r.revision + 1;
    }
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
            tags: ["#поддержка"],
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
    const renewalQuote = await financial.quoteMain({
      ...event(f.work),
      tariffVersionId: tariffId,
      termMonths: 1,
      revision,
    });
    await financial.acceptMain({
      ...event(f.work),
      quoteId: renewalQuote.id,
      revision,
    });
    revision = r.revision;
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
    const ownerApp = await workHttp(repo);
    try {
      const notice = await ownerApp.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token": "synthetic-core-webhook-secret",
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
});

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
it("authenticated real Telegram route delivers master checklist and guided/proposal commands with ownership fencing", async () => {
  const f = await linked(),
    app = await workHttp(f.card);
  const send = (
    text: string,
    secret = "synthetic-core-webhook-secret",
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
    const { createTelegramDocumentReader } =
      await import("../../packages/integrations/src/documents/private-verification.js");
    const { createIsolatedDocumentParser } =
      await import("../../packages/integrations/src/documents/isolated-document-parser.js");
    const parser = createIsolatedDocumentParser({
      socketPath: process.env.II_TONYA_PRIVATE_PARSER_TEST_SOCKET!,
      ocr: false,
    });
    const files = richDocumentFixtures();
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
    const reader = createTelegramDocumentReader({
      botId: workScope.botId,
      token: workScope.botId + ":synthetic",
      fetch: (url, init) => fetch(base + new URL(String(url)).pathname, init),
    });
    try {
      for (const type of ["pdf", "docx", "bad"] as const) {
        chosen = type;
        const f = await linked();
        const mimeType =
          type === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/pdf";
        const app = await workHttp(f.card, {
          read: (input) =>
            f.card.readOwnedDocument(input, async () => {
              const r = await reader.read({
                ...input,
                fileId: input.reference.slice(14),
                size: files[type].length,
                mimeType,
              });
              return r.kind === "read"
                ? { bytes: r.bytes, type: type === "docx" ? "docx" : "pdf" }
                : null;
            }),
          parser: {
            parse: async (input) => {
              const r = await parser.parse(input);
              return r?.coverage === "complete"
                ? { source: input.type, content: r.content }
                : null;
            },
          },
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
            const p = await f.card.richAction({
              ...event(f.work),
              expectedRevision: 1,
              action: "proposal_preview",
            });
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
        "x-telegram-bot-api-secret-token": "synthetic-core-webhook-secret",
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
