import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js";
import { PostgresExpertCampaignQuoteRepository } from "../../packages/db/src/repositories/expert-campaign-quote-repository.js";
import {
  createCorrectionOnboardingFixture,
  correctionEvent,
} from "../support/residency-correction-fixture.js";
let database: ExpertReferralTestDatabase;
let f: Awaited<ReturnType<typeof createCorrectionOnboardingFixture>>;
let financial: PostgresExpertOnboardingMainPaymentRepository;
let quoteId: string;
let scheduleId: string;
let revision: number;
let pendingOrderId: string;
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
  await database.enableExpertReferralCommands();
  f = await createCorrectionOnboardingFixture(database);
  await f.cards.submitPromoProof({
    ...correctionEvent(f.scope),
    expectedRevision: 0,
    proof: { kind: "link", reference: "https://example.com/promo" },
  });
  await f.cards.confirmPromo({
    sessionHash: f.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
  });
  revision = (await f.approveCard()).revision;
  financial = new PostgresExpertOnboardingMainPaymentRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);
it("genuine initial selection records immutable schedule and a replacement invoice adds no Telegram request or explicit acceptance", async () => {
  const quote = await financial.quoteMain({
    ...correctionEvent(f.workScope),
    tariffVersionId: f.tariffId,
    termMonths: 1,
    revision,
  });
  const selection = correctionEvent(f.workScope);
  await financial.acceptMain({ ...selection, quoteId: quote.id, revision });
  const schedule = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_offer_schedules where user_id=${f.userId}::uuid and source_update_id=${selection.requestKey}`,
    )
  ).rows[0];
  expect(schedule).toBeDefined();
  scheduleId = schedule!.id;
  const replacement = await new PostgresExpertCampaignQuoteRepository(
    database.db,
  ).createCurrentQuote({
    userId: f.userId,
    tariffVersionId: f.tariffId,
    termMonths: 1,
    idempotencyKey: randomUUID(),
  });
  quoteId = replacement.id;
  const before = (
    await database.db.execute<{ requests: number; explicit: number }>(
      sql`select (select count(*)::integer from expert_card_requests) requests,(select count(*)::integer from expert_card_main_acceptances where acceptance_source='explicit') explicit`,
    )
  ).rows[0];
  const order = await financial.createScheduledMainInvoice(scheduleId, quoteId);
  pendingOrderId = order.orderId;
  expect(order).toMatchObject({
    quoteId,
    status: "payment_pending",
    priceMinor: replacement.priceMinor,
  });
  expect(
    await financial.checkoutBindingForSchedule(scheduleId, order.orderId),
  ).toMatchObject({
    orderId: order.orderId,
    purpose: "main_residency",
    userId: f.userId,
    amountMinor: order.cashMinor,
  });
  const after = (
    await database.db.execute<{ requests: number; explicit: number }>(
      sql`select (select count(*)::integer from expert_card_requests) requests,(select count(*)::integer from expert_card_main_acceptances where acceptance_source='explicit') explicit`,
    )
  ).rows[0];
  expect(after).toEqual(before);
  expect(
    (
      await database.db.execute(
        sql`select acceptance_source from expert_card_main_acceptances where quote_id=${quoteId}::uuid`,
      )
    ).rows,
  ).toEqual([{ acceptance_source: "schedule" }]);
  expect(
    await financial.createScheduledMainInvoice(scheduleId, quoteId),
  ).toMatchObject({ orderId: order.orderId, replay: true });
});
it("an active legacy expert cannot use alternate campaign checkout to bypass v2 onboarding gates", async () => {
  const expert = (
    await database.db.execute<{ id: string }>(
      sql`update experts set active=true,verified=true where user_id=${f.userId}::uuid returning id`,
    )
  ).rows[0]!;
  const q = await new PostgresExpertCampaignQuoteRepository(
    database.db,
  ).createCurrentQuote({
    userId: f.userId,
    tariffVersionId: f.tariffId,
    termMonths: 1,
    idempotencyKey: randomUUID(),
  });
  const { PostgresExpertCampaignOrderRepository } =
    await import("../../packages/db/src/repositories/expert-campaign-order-repository.js");
  await expect(
    new PostgresExpertCampaignOrderRepository(database.db).createCheckoutOrder({
      userId: f.userId,
      expertId: expert.id,
      quoteId: q.id,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_OWNER_INELIGIBLE" });
  await expect(
    database.db
      .execute(sql`insert into expert_residency_orders(expert_id,tariff_version_id,campaign_quote_id,campaign_term_months,snapshot_display_name,price_minor,currency,duration_seconds,credit_minor,cash_minor,commercial_policy_version,credit_cap_bps,individual_services_enabled,group_event_limit,statistics_level,support_priority,payment_deadline,provider_deadline,status,idempotency_key,created_at,updated_at)
    select ${expert.id}::uuid,tariff_version_id,id,term_months,display_name,price_minor,currency,duration_seconds,0,price_minor,'expert_campaign_v1',credit_cap_bps,individual_services_enabled,group_event_limit,statistics_level,support_priority,expires_at,expires_at,'payment_pending',${randomUUID()},clock_timestamp(),clock_timestamp() from expert_campaign_quotes where id=${q.id}::uuid`),
  ).rejects.toMatchObject({ cause: { code: "23514" } });
});
it("a newer genuine owner selection supersedes earlier schedules at issue and recovery", async () => {
  const oldScheduleId = scheduleId;
  const q = await financial.quoteMain({
    ...correctionEvent(f.workScope),
    tariffVersionId: f.tariffId,
    termMonths: 1,
    revision,
  });
  await financial.acceptMain({
    ...correctionEvent(f.workScope),
    quoteId: q.id,
    revision,
  });
  scheduleId = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_offer_schedules where user_id=${f.userId}::uuid order by created_at desc,id desc limit 1`,
    )
  ).rows[0]!.id;
  expect(scheduleId).not.toBe(oldScheduleId);
  await expect(
    financial.createScheduledMainInvoice(oldScheduleId, quoteId),
  ).rejects.toMatchObject({ code: "card_main_schedule_not_ready" });
  await expect(
    financial.checkoutBindingForSchedule(oldScheduleId, pendingOrderId),
  ).rejects.toMatchObject({ code: "card_main_schedule_not_ready" });
  const replacement = await new PostgresExpertCampaignQuoteRepository(
    database.db,
  ).createCurrentQuote({
    userId: f.userId,
    tariffVersionId: f.tariffId,
    termMonths: 1,
    idempotencyKey: randomUUID(),
  });
  quoteId = replacement.id;
  const next = await financial.createScheduledMainInvoice(scheduleId, quoteId);
  pendingOrderId = next.orderId;
});
it("wrong schedule and current facts changed cannot issue replacement invoices", async () => {
  await expect(
    financial.createScheduledMainInvoice(randomUUID(), quoteId),
  ).rejects.toMatchObject({ code: "card_main_schedule_not_ready" });
  await new PostgresExpertCampaignQuoteRepository(database.db).saveProfile({
    userId: f.userId,
    cityCode: "other",
    millionCity: true,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  await new PostgresExpertCampaignQuoteRepository(database.db).verifyProfile({
    sessionHash: f.sessionHash,
    userId: f.userId,
    revision: 2,
  });
  await expect(
    financial.createScheduledMainInvoice(scheduleId, quoteId),
  ).rejects.toMatchObject({ code: "card_main_schedule_not_ready" });
  await expect(
    financial.checkoutBindingForSchedule(scheduleId, pendingOrderId),
  ).rejects.toMatchObject({ code: "card_main_schedule_not_ready" });
  const replacement = await new PostgresExpertCampaignQuoteRepository(
    database.db,
  ).createCurrentQuote({
    userId: f.userId,
    tariffVersionId: f.tariffId,
    termMonths: 1,
    idempotencyKey: randomUUID(),
  });
  await expect(
    financial.createScheduledMainInvoice(scheduleId, replacement.id),
  ).rejects.toMatchObject({ code: "card_main_schedule_not_ready" });
});
