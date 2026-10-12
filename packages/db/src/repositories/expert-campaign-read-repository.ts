import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { PostgresExpertReferralControlRepository } from "./expert-referral-control-repository.js";
import { ExpertCampaignQuoteError } from "./expert-campaign-quote-repository.js";
import { ExpertCampaignOrderError } from "./expert-campaign-order-repository.js";
import type { PostgresExpertResidencyRepository } from "./expert-residency-repository.js";

type CampaignTariff = Awaited<
  ReturnType<PostgresExpertResidencyRepository["listActiveTariffs"]>
>[number];

/** Read-only active ownership and server-resolved referral identity. */
export class PostgresExpertCampaignReadRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly botKey: string,
  ) {}
  async listActiveTariffs(input: {
    expertId: string;
    limit: 20;
  }): Promise<readonly CampaignTariff[]> {
    if (input.limit !== 20)
      throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_INVALID_INPUT");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read`);
      const control = await new PostgresExpertReferralControlRepository(
        this.db,
      ).lockFeatureControl(tx);
      if (!control.newCommandsEnabled)
        throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_DISABLED");
      const owner = (
        await tx.execute<{ id: string }>(sql`
        select e.id from experts e join users u on u.id=e.user_id
        where e.id=${input.expertId}::uuid and e.active and e.verified and u.active
      `)
      ).rows[0];
      if (!owner)
        throw new ExpertCampaignOrderError("EXPERT_CAMPAIGN_OWNER_INELIGIBLE");
      // Match createQuote eligibility before limiting, so legacy rows cannot
      // hide available campaign tariffs or become misleading monthly offers.
      return (
        await tx.execute<CampaignTariff & Record<string, unknown>>(sql`
        select id as "tariffVersionId", display_name as "displayName",
          price_minor::text as "priceMinor", currency, duration_seconds as "durationSeconds",
          commercial_policy_version as "commercialPolicyVersion", credit_cap_bps as "creditCapBps",
          individual_services_enabled as "individualServicesEnabled", group_event_limit as "groupEventLimit",
          statistics_level as "statisticsLevel", support_priority as "supportPriority"
        from expert_residency_tariff_versions
        where commercial_policy_version='expert_residency_v2' and currency='RUB'
          and duration_seconds=2592000
          and active_from <= transaction_timestamp() and transaction_timestamp() < active_to
        order by active_from,id limit ${input.limit}
      `)
      ).rows;
    });
  }
  async ownerUserId(expertId: string): Promise<string | undefined> {
    return (
      await this.db.execute<{ userId: string }>(sql`
      select e.user_id as "userId" from experts e join users u on u.id=e.user_id
      where e.id=${expertId}::uuid and e.active and e.verified and u.active
    `)
    ).rows[0]?.userId;
  }
  async referralIdentity(userId: string): Promise<string | undefined> {
    const rows = (
      await this.db.execute<{ externalId: string }>(sql`
      select ci.external_id as "externalId" from channel_identities ci
      where ci.user_id=${userId}::uuid and ci.provider='telegram' and ci.status='active'
        and (ci.bot_key=${this.botKey} or ci.bot_key is null)
        and (ci.external_chat_id=ci.external_id or ci.external_chat_id is null)
        and not exists (select 1 from channel_identities other
          where other.provider='telegram' and other.external_id=ci.external_id and other.id<>ci.id)
      limit 2
    `)
    ).rows;
    return rows.length === 1 ? rows[0]?.externalId : undefined;
  }
}
