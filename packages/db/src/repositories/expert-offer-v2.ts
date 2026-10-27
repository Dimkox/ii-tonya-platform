import { sql } from "drizzle-orm";
import { calculateExpertCampaignPriceV2 } from "@ii-tonya/domain";
import type { DrizzleDb } from "../client.js";
import { expertCampaignQuotes } from "../schema/expert-campaign-quotes.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";
import { lockExpertManagerAuthority } from "./expert-manager-authority.js";
import {
  ExpertCampaignQuoteError,
  type CreateExpertCampaignQuote,
} from "./expert-campaign-quote-repository.js";
type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
export interface ExpertOfferProfileInput {
  userId: string;
  cityCode: string;
  millionCity: boolean;
  serviceFormat: "online_only" | "offline" | "hybrid";
  ticketMinor: string;
  participantKind: "expert" | "space";
  idempotencyKey: string;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const fail = (
  code: ConstructorParameters<typeof ExpertCampaignQuoteError>[0],
): never => {
  throw new ExpertCampaignQuoteError(code);
};
export async function saveExpertOfferProfile(
  db: DrizzleDb,
  input: ExpertOfferProfileInput,
) {
  return db.transaction((tx) => saveExpertOfferProfileInTransaction(tx, input));
}
export async function saveExpertOfferProfileInTransaction(
  tx: Tx,
  input: ExpertOfferProfileInput,
) {
  if (
    !input ||
    Object.keys(input).length !== 7 ||
    Object.keys(input).some(
      (key) =>
        ![
          "userId",
          "cityCode",
          "millionCity",
          "serviceFormat",
          "ticketMinor",
          "participantKind",
          "idempotencyKey",
        ].includes(key),
    ) ||
    typeof input.userId !== "string" ||
    !uuid.test(input.userId) ||
    typeof input.cityCode !== "string" ||
    input.cityCode.length < 1 ||
    input.cityCode.length > 100 ||
    input.cityCode.trim() !== input.cityCode ||
    /[\p{C}]/u.test(input.cityCode) ||
    typeof input.millionCity !== "boolean" ||
    !["online_only", "offline", "hybrid"].includes(input.serviceFormat) ||
    !["expert", "space"].includes(input.participantKind) ||
    typeof input.ticketMinor !== "string" ||
    !/^\d{1,18}$/u.test(input.ticketMinor) ||
    typeof input.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.idempotencyKey)
  )
    return fail("EXPERT_CAMPAIGN_INVALID_INPUT");
  await lockClientConsentSubject(tx, input.userId);
  const owner = (
    await tx.execute<{ active: boolean }>(
      sql`select active from users where id=${input.userId}::uuid for share`,
    )
  ).rows[0];
  if (!owner?.active) return fail("EXPERT_CAMPAIGN_USER_INACTIVE");
  const prior = (
    await tx.execute<Record<string, unknown>>(
      sql`select * from expert_offer_profiles where user_id=${input.userId}::uuid and idempotency_key=${input.idempotencyKey}`,
    )
  ).rows[0];
  if (prior) {
    if (
      prior.city_code !== input.cityCode ||
      prior.million_city !== input.millionCity ||
      prior.service_format !== input.serviceFormat ||
      String(prior.ticket_minor) !== BigInt(input.ticketMinor).toString() ||
      prior.participant_kind !== input.participantKind
    )
      return fail("EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT");
    return { revision: Number(prior.revision) };
  }
  const row = (
    await tx.execute<{ revision: number }>(
      sql`insert into expert_offer_profiles(user_id,revision,city_code,million_city,service_format,ticket_minor,participant_kind,idempotency_key) select ${input.userId}::uuid,coalesce(max(revision),0)+1,${input.cityCode},${input.millionCity},${input.serviceFormat},${input.ticketMinor}::bigint,${input.participantKind},${input.idempotencyKey} from expert_offer_profiles where user_id=${input.userId}::uuid returning revision`,
    )
  ).rows[0];
  if (!row) return fail("EXPERT_CAMPAIGN_STORAGE");
  return row;
}
export async function verifyExpertOfferProfile(
  db: DrizzleDb,
  input: { sessionHash: string; userId: string; revision: number },
) {
  if (
    !uuid.test(input.userId) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1
  )
    return fail("EXPERT_CAMPAIGN_INVALID_INPUT");
  return db.transaction(async (tx) => {
    await lockClientConsentSubject(tx, input.userId);
    const managerId = await lockExpertManagerAuthority(tx, input.sessionHash);
    const current = (
      await tx.execute<{ revision: number }>(
        sql`select revision from expert_offer_profiles where user_id=${input.userId}::uuid order by revision desc limit 1`,
      )
    ).rows[0];
    if (current?.revision !== input.revision)
      return fail("EXPERT_CAMPAIGN_PROFILE_REQUIRED");
    await tx.execute(
      sql`insert into expert_offer_profile_verifications(user_id,profile_revision,manager_id,session_hash) values(${input.userId}::uuid,${input.revision},${managerId}::uuid,${input.sessionHash}) on conflict do nothing`,
    );
    return { revision: input.revision };
  });
}
export async function createCurrentExpertOffer(
  tx: Tx,
  input: CreateExpertCampaignQuote,
) {
  await lockClientConsentSubject(tx, input.userId);
  const owner = (
    await tx.execute<{ active: boolean }>(
      sql`select active from users where id=${input.userId}::uuid for share`,
    )
  ).rows[0];
  if (!owner?.active) return fail("EXPERT_CAMPAIGN_USER_INACTIVE");
  const prior = (
    await tx
      .select()
      .from(expertCampaignQuotes)
      .where(
        sql`user_id=${input.userId}::uuid and idempotency_key=${input.idempotencyKey}`,
      )
  )[0];
  if (prior) {
    if (
      prior.tariffVersionId !== input.tariffVersionId ||
      prior.termMonths !== input.termMonths
    )
      return fail("EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT");
    return prior;
  }
  const p = (
    await tx.execute<{
      revision: number;
      millionCity: boolean;
      serviceFormat: string;
      ticketMinor: string;
      participantKind: "expert" | "space";
    }>(
      sql`select revision,million_city as "millionCity",service_format as "serviceFormat",ticket_minor::text as "ticketMinor",participant_kind as "participantKind" from expert_offer_profiles where user_id=${input.userId}::uuid order by revision desc limit 1`,
    )
  ).rows[0];
  if (!p) return fail("EXPERT_CAMPAIGN_PROFILE_REQUIRED");
  const t = (
    await tx.execute<{
      priceMinor: string;
      activeFromMs: string;
      activeToMs: string;
      policy: string;
      currency: string;
      durationSeconds: number;
      displayName: string;
      creditCapBps: number;
      individualServicesEnabled: boolean;
      groupEventLimit: number;
      statisticsLevel: "basic" | "expanded";
      supportPriority: "standard" | "priority";
    }>(
      sql`select price_minor::text as "priceMinor",ceil(extract(epoch from active_from)*1000)::text as "activeFromMs",floor(extract(epoch from active_to)*1000)::text as "activeToMs",commercial_policy_version as policy,currency,duration_seconds as "durationSeconds",display_name as "displayName",credit_cap_bps as "creditCapBps",individual_services_enabled as "individualServicesEnabled",group_event_limit as "groupEventLimit",statistics_level as "statisticsLevel",support_priority as "supportPriority" from expert_residency_tariff_versions where id=${input.tariffVersionId}::uuid for share`,
    )
  ).rows[0];
  if (
    p.participantKind === "space" &&
    !(
      await tx.execute(
        sql`select 1 from expert_space_tariff_approvals where tariff_version_id=${input.tariffVersionId}::uuid`,
      )
    ).rows[0]
  )
    return fail("EXPERT_CAMPAIGN_TARIFF_INACTIVE");
  const now = Number(
    (
      await tx.execute<{ ms: string }>(
        sql`select floor(extract(epoch from clock_timestamp())*1000)::text ms`,
      )
    ).rows[0]?.ms,
  );
  if (
    !t ||
    t.policy !== "expert_residency_v2" ||
    t.currency !== "RUB" ||
    t.durationSeconds !== 2592000 ||
    now < Number(t.activeFromMs) ||
    now >= Number(t.activeToMs)
  )
    return fail("EXPERT_CAMPAIGN_TARIFF_INACTIVE");
  const first = Number(
    (
      await tx.execute<{ ms: string | null }>(
        sql`select floor(extract(epoch from min(calculation_timestamp))*1000)::text ms from expert_campaign_anchors where user_id=${input.userId}::uuid`,
      )
    ).rows[0]?.ms ?? now,
  );
  const price = calculateExpertCampaignPriceV2({
    categoryRateMinor: BigInt(t.priceMinor),
    millionCity: p.millionCity,
    onlineOnly: p.serviceFormat === "online_only",
    ticketMinor: BigInt(p.ticketMinor),
    participantKind: p.participantKind,
    firstOfferAtMs: first,
    quotedAtMs: now,
  });
  if (input.termMonths === 3 && price.packagePriceMinor === null)
    return fail("EXPERT_CAMPAIGN_TERM_UNAVAILABLE");
  const selected =
    input.termMonths === 1 ? price.monthlyPriceMinor : price.packagePriceMinor!;
  if (selected > 999999999999n) return fail("EXPERT_CAMPAIGN_TARIFF_INACTIVE");
  const expires = Math.min(
    price.nextStageAtMs ?? now + 86400000,
    Number(t.activeToMs),
  );
  if (expires <= now) return fail("EXPERT_CAMPAIGN_EXPIRY_BOUNDARY");
  await tx.execute(
    sql`insert into expert_campaign_anchors(user_id,rule_version,calculation_timestamp) values(${input.userId}::uuid,'expert_energy_start_v2',${new Date(first).toISOString()}::timestamptz) on conflict do nothing`,
  );
  const [saved] = await tx
    .insert(expertCampaignQuotes)
    .values({
      ...input,
      ruleVersion: "expert_energy_start_v2",
      profileRevision: p.revision,
      packagePriceMinor: price.packagePriceMinor,
      calculationTimestamp: new Date(first),
      quotedAt: new Date(now),
      expiresAt: new Date(expires),
      durationSeconds: 2592000 * input.termMonths,
      baseMonthlyMinor: price.baseMonthlyMinor,
      discountedMonthlyMinor:
        (price.baseMonthlyMinor * BigInt(10000 - price.energyDiscountBps) +
          5000n) /
        10000n,
      monthlyPriceMinor: price.monthlyPriceMinor,
      priceMinor: selected,
      currency: "RUB",
      energyDiscountBps: price.energyDiscountBps,
      startDiscountBps: price.packageDiscountBps,
      floorApplied:
        input.termMonths === 1
          ? price.monthlyFloorApplied
          : price.packageFloorApplied,
      displayName: t.displayName,
      creditCapBps: t.creditCapBps,
      individualServicesEnabled: t.individualServicesEnabled,
      groupEventLimit: t.groupEventLimit,
      statisticsLevel: t.statisticsLevel,
      supportPriority: t.supportPriority,
    })
    .returning();
  if (!saved) return fail("EXPERT_CAMPAIGN_STORAGE");
  return saved;
}

export async function approveSpaceOfferTariff(
  db: DrizzleDb,
  input: { sessionHash: string; tariffVersionId: string },
) {
  if (!uuid.test(input.tariffVersionId))
    return fail("EXPERT_CAMPAIGN_INVALID_INPUT");
  return db.transaction(async (tx) => {
    const managerId = await lockExpertManagerAuthority(tx, input.sessionHash);
    await tx.execute(
      sql`insert into expert_space_tariff_approvals(tariff_version_id,manager_id,session_hash) values(${input.tariffVersionId}::uuid,${managerId}::uuid,${input.sessionHash}) on conflict do nothing`,
    );
    return { tariffVersionId: input.tariffVersionId };
  });
}
