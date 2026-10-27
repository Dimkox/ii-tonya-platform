import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { PostgresExpertCampaignQuoteRepository } from "../../packages/db/src/repositories/expert-campaign-quote-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
let database: ExpertReferralTestDatabase;
let userId: string;
let tariffVersionId: string;
const repository = () => new PostgresExpertCampaignQuoteRepository(database.db);
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
});
afterAll(async () => {
  await database?.stop();
});
beforeEach(async () => {
  await database.reset();
  userId = await database.createUser();
  tariffVersionId = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "Про",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
});
const profile = () =>
  repository().saveProfile({
    userId,
    cityCode: "synthetic-city",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
const quote = () =>
  repository().createCurrentQuote({
    userId,
    tariffVersionId,
    termMonths: 1,
    idempotencyKey: randomUUID(),
  });
it("requires stored facts, binds their revision and upgrades the earliest original anchor", async () => {
  await expect(quote()).rejects.toMatchObject({
    code: "EXPERT_CAMPAIGN_PROFILE_REQUIRED",
  });
  await profile();
  await database.db.execute(
    sql`insert into expert_campaign_anchors(user_id,rule_version,calculation_timestamp) values(${userId}::uuid,'expert_energy_start_v1',date_trunc('milliseconds',clock_timestamp())-interval '100 hours')`,
  );
  const result = await quote();
  expect(result).toMatchObject({
    ruleVersion: "expert_energy_start_v2",
    energyDiscountBps: 3000,
    monthlyPriceMinor: "699300",
    packagePriceMinor: "1888110",
    profileRevision: 1,
  });
  const old = await database.db.execute<{ anchor: string }>(
    sql`select calculation_timestamp::text anchor from expert_campaign_anchors where user_id=${userId}::uuid order by calculation_timestamp`,
  );
  expect(old.rows[0]!.anchor).toBe(old.rows[1]!.anchor);
  await profile();
  const next = await quote();
  expect(next.calculationTimestamp).toBe(result.calculationTimestamp);
  expect(next.profileRevision).toBe(2);
});
it("computes modifiers on server and independently floors package while showing monthly", async () => {
  await repository().saveProfile({
    userId,
    cityCode: "synthetic-city",
    millionCity: true,
    serviceFormat: "online_only",
    ticketMinor: "299999",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  const result = await quote();
  expect(result).toMatchObject({
    baseMonthlyMinor: "1699000",
    monthlyPriceMinor: "1019400",
    packagePriceMinor: "2599470",
  });
});
it("uses a bounded operational TTL at day10 and refuses three-month downgrade", async () => {
  await profile();
  await database.db.execute(
    sql`insert into expert_campaign_anchors(user_id,rule_version,calculation_timestamp) values(${userId}::uuid,'expert_energy_start_v1',date_trunc('milliseconds',clock_timestamp())-interval '241 hours')`,
  );
  await database.db.execute(
    sql`update expert_residency_tariff_versions set active_to=clock_timestamp()+interval '2 days' where id=${tariffVersionId}::uuid`,
  );
  const result = await quote();
  expect(result.packagePriceMinor).toBeNull();
  expect(Date.parse(result.expiresAt) - Date.parse(result.quotedAt)).toBe(
    86400000,
  );
  await expect(
    repository().createCurrentQuote({
      userId,
      tariffVersionId,
      termMonths: 3,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "EXPERT_CAMPAIGN_TERM_UNAVAILABLE" });
});

it("preserves the current stage window before day10 when approved tariff validity exceeds24h", async () => {
  await profile();
  const end = Date.now() + 2 * 86_400_000;
  await database.db.execute(
    sql`update expert_residency_tariff_versions set active_to=${new Date(end).toISOString()}::timestamptz where id=${tariffVersionId}::uuid`,
  );
  const result = await quote();
  expect(Date.parse(result.expiresAt)).toBe(end);
  expect(
    Date.parse(result.expiresAt) - Date.parse(result.quotedAt),
  ).toBeGreaterThan(86_400_000);
});
