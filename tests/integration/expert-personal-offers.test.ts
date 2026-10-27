import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { PostgresExpertCampaignQuoteRepository } from "../../packages/db/src/repositories/expert-campaign-quote-repository.js";
import { PostgresExpertPersonalOfferRepository } from "../../packages/db/src/repositories/expert-personal-offer-repository.js";
let database: ExpertReferralTestDatabase;
let userId: string;
let tariffVersionId: string;
let sequence = 818180;
const policy = {
  workBotId: "717171",
  workBotKey: "personal-offer-test",
  messagingConsentPolicyVersion: "client-messaging-v1",
};
const repo = () =>
  new PostgresExpertPersonalOfferRepository(database.db, policy);
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);
beforeEach(async () => {
  await database.reset();
  sequence = 818180;
  userId = await database.createUser();
  tariffVersionId = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "Про",
    priceMinor: 900000,
    durationSeconds: 2592000,
  });
});
async function application(
  hours: number,
  termMonths: 1 | 3 = 1,
  createApplication = true,
) {
  const chatId = String(++sequence);
  await seedClientConsent(database.db, userId, "client_messaging");
  const identity = (
    await database.db.execute<{ id: string }>(
      sql`insert into channel_identities(user_id,provider,bot_key,external_id,external_chat_id,status) values(${userId}::uuid,'telegram',${policy.workBotKey},${chatId},${chatId},'active') returning id`,
    )
  ).rows[0]!;
  await database.db.execute(
    sql`insert into expert_promo_enrollments(user_id,channel_identity_id,bot_id,presentation_id,policy_version,status) select ${userId}::uuid,${identity.id}::uuid,${policy.workBotId},presentation_id,${policy.messagingConsentPolicyVersion},'granted' from consents where user_id=${userId}::uuid and consent_type='client_messaging'`,
  );
  const quotes = new PostgresExpertCampaignQuoteRepository(database.db);
  await quotes.saveProfile({
    userId,
    cityCode: "synthetic",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  await database.db.execute(
    sql`insert into expert_campaign_anchors(user_id,rule_version,calculation_timestamp) values(${userId}::uuid,'expert_energy_start_v1',date_trunc('milliseconds',clock_timestamp())-${hours}*interval '1 hour')`,
  );
  const q = await quotes.createCurrentQuote({
    userId,
    tariffVersionId,
    termMonths,
    idempotencyKey: randomUUID(),
  });
  if (createApplication)
    await database.db.execute(
      sql`insert into expert_onboarding_applications(user_id,campaign_quote_id) values(${userId}::uuid,${q.id}::uuid)`,
    );
  return q;
}
it("reprices pending applications independently verification and never creates an early invoice", async () => {
  await application(0);
  expect(await repo().refreshDue()).toEqual([]);
  const state = (
    await database.db.execute<{ monthly: string; orders: number }>(
      sql`select q.monthly_price_minor::text monthly,(select count(*)::int from expert_residency_orders) orders from expert_personal_offer_state st join expert_campaign_quotes q on q.id=st.quote_id where st.user_id=${userId}::uuid`,
    )
  ).rows[0];
  expect(state).toEqual({ monthly: "599400", orders: 0 });
  const view = await repo().read({
    botId: policy.workBotId,
    botKey: policy.workBotKey,
    telegramUserId: "818181",
    chatId: "818181",
  });
  expect(view).toMatchObject({
    locked_price_monthly: "599400",
    locked_price_package: "1528470",
    readiness: "pending_gates",
    payment_url: null,
    current_discount_stage: 1,
    discount_percent: 40,
  });
});
it("catches up only urgent reminder once, with no stale24hour notice", async () => {
  await application(94);
  await repo().refreshDue();
  await database.db.execute(
    sql`update expert_personal_offer_state set next_refresh_at=clock_timestamp()-interval '1 second'`,
  );
  await repo().refreshDue();
  expect(
    (
      await database.db.execute(
        sql`select lead_hours,status from expert_personal_offer_notices`,
      )
    ).rows,
  ).toEqual([{ lead_hours: 3, status: "pending" }]);
});
it("revoked original consent stops acquisition and suppresses pending notices", async () => {
  await application(94);
  await repo().refreshDue();
  await database.db.execute(
    sql`insert into consents(user_id,consent_type,decision,policy_version,channel,scope_fields,created_at) values(${userId}::uuid,'client_messaging','denied','client-messaging-v1','telegram','{}',clock_timestamp())`,
  );
  await database.db.execute(
    sql`update expert_personal_offer_state set next_refresh_at=clock_timestamp()-interval '1 second'`,
  );
  expect(await repo().refreshDue()).toEqual([]);
  expect(
    (
      await database.db.execute(
        sql`select status from expert_personal_offer_notices`,
      )
    ).rows,
  ).toEqual([{ status: "cancelled" }]);
  expect(
    await repo().read({
      botId: policy.workBotId,
      botKey: policy.workBotKey,
      telegramUserId: "818181",
      chatId: "818181",
    }),
  ).toBeNull();
});
it("reads a fresh bound stage and current prices at the boundary before cron runs", async () => {
  const q = await application(96 - 3 / 3600);
  expect(q.energyDiscountBps).toBe(4000);
  await repo().refreshDue();
  await database.db.execute(sql`select pg_sleep(3.2)`);
  const view = await repo().read({
    botId: policy.workBotId,
    botKey: policy.workBotKey,
    telegramUserId: "818181",
    chatId: "818181",
  });
  expect(view).toMatchObject({
    current_discount_stage: 2,
    discount_percent: 30,
    locked_price_monthly: "699300",
    locked_price_package: "1888110",
    payment_url: null,
  });
});

it("moves more than a full ineligible batch aside without starving the next owner", async () => {
  for (let i = 0; i < 10; i++) {
    if (i > 0) userId = await database.createUser();
    await application(0);
    await database.db.execute(
      sql`update users set active=false where id=${userId}::uuid`,
    );
  }
  userId = await database.createUser();
  await application(0);
  await repo().refreshDue(10);
  await repo().refreshDue(10);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int count from expert_personal_offer_state where user_id=${userId}::uuid`,
      )
    ).rows,
  ).toEqual([{ count: 1 }]);
});
it("delivers a current3hour reminder with real prices and exact expiry once", async () => {
  await application(94);
  await repo().refreshDue();
  const sent: string[] = [];
  const targetBots: string[] = [];
  const transport = {
    async send(input: {
      botId: string;
      chatId: string;
      contentVersion: string;
      payloadDigest: string;
      payload: { text: string };
    }) {
      sent.push(input.payload.text);
      targetBots.push(input.botId);
      return {
        botId: input.botId,
        chatId: input.chatId,
        contentVersion: input.contentVersion,
        payloadDigest: input.payloadDigest,
        messageIds: ["1"],
      };
    },
  };
  const delivery = new PostgresExpertPersonalOfferRepository(database.db, {
    ...policy,
    workBotId: "999999",
    workBotKey: "unpaired-work",
    promoBotId: policy.workBotId,
    promoBotKey: policy.workBotKey,
    promoConsentPolicyVersion: policy.messagingConsentPolicyVersion,
    messagingConsentPolicyVersion: "messaging-v1",
    noticeTransport: transport,
  });
  const notice = (await delivery.listDueNotices())[0]!;
  expect(await delivery.deliverNotice(notice.noticeId)).toEqual({
    kind: "delivered",
  });
  expect(sent).toHaveLength(1);
  expect(targetBots).toEqual([policy.workBotId]);
  expect(sent[0]).toContain("5 994 ₽");
  expect(sent[0]).toContain("15 284,70 ₽");
  expect(sent[0]).toMatch(/Действует до \d{4}-\d{2}-\d{2}T/u);
  expect(sent[0]).not.toContain("Оплатить:");
  await delivery.deliverNotice(notice.noticeId);
  expect(sent).toHaveLength(1);
});
it("refreshes a promo owner's changed profile within the same15minute slot without resetting first offer", async () => {
  await application(0);
  await repo().refreshDue();
  const promo = new PostgresExpertPersonalOfferRepository(database.db, {
    ...policy,
    workBotId: "999999",
    workBotKey: "unpaired-work",
    promoBotId: policy.workBotId,
    promoBotKey: policy.workBotKey,
    promoConsentPolicyVersion: policy.messagingConsentPolicyVersion,
    messagingConsentPolicyVersion: "messaging-v1",
  });
  const scope = {
    botId: policy.workBotId,
    botKey: policy.workBotKey,
    telegramUserId: "818181",
    chatId: "818181",
  };
  const before = await promo.readPromoIdentity(scope);
  expect(before).toMatchObject({
    locked_price_monthly: "599400",
    readiness: "pending_gates",
    payment_url: null,
  });
  await new PostgresExpertCampaignQuoteRepository(database.db).saveProfile({
    userId,
    cityCode: "synthetic-million",
    millionCity: true,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  await database.db.execute(
    sql`update expert_personal_offer_state set next_refresh_at=clock_timestamp()-interval '1 second' where user_id=${userId}::uuid`,
  );
  await repo().refreshDue();
  const after = await promo.readPromoIdentity(scope);
  expect(after).toMatchObject({
    locked_price_monthly: "899400",
    locked_price_package: "2293470",
    offer_start_date: before!.offer_start_date,
    payment_url: null,
    current_discount_stage: 1,
  });
  expect(
    (
      await database.db.execute(
        sql`select q.profile_revision from expert_personal_offer_state st join expert_campaign_quotes q on q.id=st.quote_id where st.user_id=${userId}::uuid`,
      )
    ).rows,
  ).toEqual([{ profile_revision: 2 }]);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int count from expert_residency_orders`,
      )
    ).rows,
  ).toEqual([{ count: 0 }]);
});

it.each([
  [74, 24],
  [94, 3],
] as const)(
  "serves the preapplication promo offer and %s-hour clock reminder without fee or work identity",
  async (hours, leadHours) => {
    const initial = await application(hours, 1, false);
    const personal = new PostgresExpertPersonalOfferRepository(database.db, {
      ...policy,
      workBotId: "999999",
      workBotKey: "unpaired-work",
      promoBotId: policy.workBotId,
      promoBotKey: policy.workBotKey,
      promoConsentPolicyVersion: policy.messagingConsentPolicyVersion,
      messagingConsentPolicyVersion: "messaging-v1",
    });
    expect(await personal.refreshDue()).toEqual([]);
    const before = (
      await database.db.execute<{
        quoteId: string;
        refreshedAt: string;
        intervalValid: boolean;
      }>(
        sql`select quote_id as "quoteId",refreshed_at::text as "refreshedAt",next_refresh_at-refreshed_at between interval '14 minutes 59 seconds' and interval '15 minutes 1 second' as "intervalValid" from expert_personal_offer_state where user_id=${userId}::uuid`,
      )
    ).rows[0]!;
    expect(before.intervalValid).toBe(true);
    const view = await personal.readPromoIdentity({
      botId: policy.workBotId,
      botKey: policy.workBotKey,
      telegramUserId: "818181",
      chatId: "818181",
    });
    expect(view).toMatchObject({
      locked_price_monthly: "599400",
      locked_price_package: "1528470",
      offer_start_date: initial.calculationTimestamp,
      readiness: "pending_gates",
      payment_url: null,
    });
    await personal.refreshDue();
    const after = (
      await database.db.execute(
        sql`select quote_id as "quoteId",refreshed_at::text as "refreshedAt" from expert_personal_offer_state where user_id=${userId}::uuid`,
      )
    ).rows[0]!;
    expect(after).toEqual({
      quoteId: before.quoteId,
      refreshedAt: before.refreshedAt,
    });
    expect(
      (
        await database.db.execute(
          sql`select lead_hours from expert_personal_offer_notices where user_id=${userId}::uuid`,
        )
      ).rows,
    ).toEqual([{ lead_hours: leadHours }]);
    expect(
      (
        await database.db.execute(
          sql`select (select count(*)::int from expert_onboarding_applications) applications,(select count(*)::int from expert_onboarding_invoices) fee_invoices,(select count(*)::int from expert_residency_orders) main_orders`,
        )
      ).rows,
    ).toEqual([{ applications: 0, fee_invoices: 0, main_orders: 0 }]);
  },
);

it("erases preapplication notice receipts through actual privacy processing", async () => {
  await application(94, 1, false);
  const personal = new PostgresExpertPersonalOfferRepository(database.db, {
    ...policy,
    promoBotId: policy.workBotId,
    promoBotKey: policy.workBotKey,
    promoConsentPolicyVersion: policy.messagingConsentPolicyVersion,
    noticeTransport: {
      async send(input) {
        return {
          botId: input.botId,
          chatId: input.chatId,
          contentVersion: input.contentVersion,
          payloadDigest: input.payloadDigest,
          messageIds: ["1"],
        };
      },
    },
  });
  await personal.refreshDue();
  const notice = (await personal.listDueNotices())[0]!;
  expect(await personal.deliverNotice(notice.noticeId)).toEqual({
    kind: "delivered",
  });
  const pending = (
    await database.db.execute<{ id: string }>(
      sql`insert into expert_personal_offer_notices(user_id,quote_id,stage_deadline,lead_hours) select user_id,quote_id,stage_deadline,24 from expert_personal_offer_notices where id=${notice.noticeId}::uuid returning id`,
    )
  ).rows[0]!;
  const privacy = new PostgresPrivacyRepository(database.db, {
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
  await privacy.startErasureAtomically({
    targetUserId: userId,
    correlationId: `preapplication:${userId}`,
    idempotencyKey: `preapplication:${userId}`,
    pseudonym: "hmac:synthetic-preapplication-erasure",
  });
  expect(
    (
      await database.db.execute(
        sql`select status,receipt from expert_personal_offer_notices where id=${notice.noticeId}::uuid`,
      )
    ).rows,
  ).toEqual([{ status: "delivered", receipt: null }]);
  expect(
    (
      await database.db.execute(
        sql`select status,receipt from expert_personal_offer_notices where id=${pending.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ status: "cancelled", receipt: null }]);
  expect(
    (
      await database.db.execute(
        sql`select payment_url,payment_id from expert_personal_offer_state where user_id=${userId}::uuid`,
      )
    ).rows,
  ).toEqual([{ payment_url: null, payment_id: null }]);
  expect(
    await personal.readPromoIdentity({
      botId: policy.workBotId,
      botKey: policy.workBotKey,
      telegramUserId: "818181",
      chatId: "818181",
    }),
  ).toBeNull();
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int count from expert_onboarding_applications`,
      )
    ).rows,
  ).toEqual([{ count: 0 }]);
});
