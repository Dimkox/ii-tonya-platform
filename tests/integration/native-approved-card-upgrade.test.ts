import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { migrateDb } from "../../packages/db/src/client.js";
import {
  constraintStateSql,
  indexStateSql,
} from "../../packages/db/src/testkit/migration-state.js";
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

it("normal migrateDb backfills a genuinely approved main73 rich service and preserves its review on replay", async () => {
  const source = "packages/db/migrations",
    folder = await mkdtemp(join(tmpdir(), "approved-main73-upgrade-"));
  try {
    const journal = JSON.parse(
      await readFile(join(source, "meta/_journal.json"), "utf8"),
    );
    const entries = journal.entries.filter((e: { idx: number }) => e.idx < 74);
    await mkdir(join(folder, "meta"));
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    for (const e of entries)
      await copyFile(
        join(source, e.tag + ".sql"),
        join(folder, e.tag + ".sql"),
      );
    database = await startExpertReferralTestDatabase((db) =>
      migrateDb(db, folder),
    );
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
    // The current read model expects nullable schedule projections. They carry no
    // native facts and are removed before asserting the exact main73 boundary.
    await database.db.execute(
      sql`alter table expert_card_drafts add column initial_schedule jsonb; alter table resident_card_versions add column initial_schedule jsonb`,
    );
    const f = await secondRichFixture(),
      approved = await f.approve();
    expect(approved.reviewId).toBeTruthy();
    await database.db.execute(
      sql`alter table expert_card_drafts drop column initial_schedule; alter table resident_card_versions drop column initial_schedule`,
    );
    const mainState = JSON.parse(
      await readFile(join(source, "state/0073_sql_objects.json"), "utf8"),
    );
    expect(
      (await database.db.execute(sql.raw(constraintStateSql))).rows,
    ).toEqual(mainState.constraints);
    expect((await database.db.execute(sql.raw(indexStateSql))).rows).toEqual(
      mainState.indexes,
    );
    expect(
      (
        await database.db.execute(
          sql`select column_name from information_schema.columns where table_schema='public' and table_name in ('expert_card_drafts','resident_card_versions') and column_name='initial_schedule'`,
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from drizzle.__drizzle_migrations`,
        )
      ).rows[0]?.n,
    ).toBe(74);
    const review = () =>
      database.db.execute(
        sql`select to_jsonb(v)-'initial_schedule' row from resident_card_versions v where review_id=${approved.reviewId!}::uuid`,
      );
    const before = (await review()).rows;
    await migrateDb(database.db, source);
    expect((await review()).rows).toEqual(before);
    const mappings = () =>
      database.db.execute(
        sql`select m.expert_service_id,v.id,v.review_id,v.title,v.duration_minutes from resident_service_mappings m join resident_service_versions v on v.expert_service_id=m.expert_service_id where v.review_id=${approved.reviewId!}::uuid`,
      );
    const after = (await mappings()).rows;
    expect(after).toEqual([
      expect.objectContaining({
        review_id: approved.reviewId,
        title: "Консультация",
        duration_minutes: 60,
      }),
    ]);
    await migrateDb(database.db, source);
    expect((await mappings()).rows).toEqual(after);
    expect((await review()).rows).toEqual(before);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from drizzle.__drizzle_migrations`,
        )
      ).rows[0]?.n,
    ).toBe(75);
  } finally {
    await database?.stop();
    await rm(folder, { recursive: true, force: true });
  }
}, 120000);
