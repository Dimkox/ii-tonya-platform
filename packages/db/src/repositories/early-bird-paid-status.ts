import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";

type Scope = {
  botId: string;
  botKey: string;
  telegramUserId: string;
  chatId: string;
};
export type EarlyBirdPaidStatus = {
  id: string;
  revision: number;
  status: "FULLY_PREPAID_WITH_DISCOUNT" | "FULLY_PREPAID_NO_DISCOUNT";
  baseMonthlyMinor: string;
  lockedMonthlyMinor: string;
  clientStart: string;
  effectiveStart: string;
  residentStatus: "ACTIVE_PAID_WAITING_START" | "ACTIVE";
};
/** Read-only scoped projection; verified coverage, not an invoice status, establishes payment. */
export class PostgresEarlyBirdPaidStatus {
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: {
      botId: string;
      botKey: string;
      messagingConsentPolicyVersion: string;
    },
  ) {}
  async find(input: Scope): Promise<EarlyBirdPaidStatus | null> {
    if (
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.telegramUserId !== input.chatId ||
      !/^[1-9][0-9]{0,19}$/u.test(input.chatId)
    )
      return null;
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout','4000ms',true)`,
      );
      const identities = (
        await tx.execute<{ id: string }>(
          sql`select u.id from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.provider='telegram' and ci.status='active' and ci.bot_key=${input.botKey} and ci.external_id=${input.telegramUserId} and ci.external_chat_id=${input.chatId} limit 2`,
        )
      ).rows;
      if (identities.length !== 1) return null;
      const userId = identities[0]!.id;
      await lockClientConsentSubject(tx, userId);
      if (
        !(await captureClientConsentAuthority(tx, {
          subjectId: userId,
          botKey: input.botKey,
          chatId: input.chatId,
          externalUserId: input.telegramUserId,
          messagingPolicyVersion: this.policy.messagingConsentPolicyVersion,
        }))
      )
        return null;
      const rows = (
        await tx.execute<EarlyBirdPaidStatus>(sql`
    select base.id::text as id,choice.revision,
      case when intent.price_kind='discounted' then 'FULLY_PREPAID_WITH_DISCOUNT' else 'FULLY_PREPAID_NO_DISCOUNT' end as status,
      intent.base_monthly_minor::text as "baseMonthlyMinor",intent.subscription_minor::text as "lockedMonthlyMinor",
      to_char(intent.launch_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "clientStart",
      to_char(coverage.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "effectiveStart",
      case when early_bird_current_time()<coverage.starts_at then 'ACTIVE_PAID_WAITING_START' else 'ACTIVE' end as "residentStatus"
    from early_bird_composite_intents intent
    join expert_sales_bases base on base.id=intent.base_id and base.user_id=intent.user_id
    join early_bird_choices choice on choice.id=intent.choice_id and choice.user_id=intent.user_id
    join early_bird_payment_successes fact on fact.intent_id=intent.id and fact.user_id=intent.user_id and fact.disposition='eligible'
    join early_bird_verified_bindings proof on proof.intent_id=intent.id and proof.user_id=intent.user_id and proof.provider_object_id=fact.provider_object_id
    join early_bird_effective_coverages coverage on coverage.intent_id=intent.id and coverage.user_id=intent.user_id
    where intent.user_id=${userId}::uuid and intent.status='settled' and base.bot_id=${input.botId} and base.bot_key=${input.botKey} and base.chat_id=${input.chatId}
      and choice.id=(select c.id from early_bird_choices c where c.base_id=base.id order by c.decision_no desc limit 1)
      and expert_card_current_messaging_authority(intent.user_id,base.consent_version)
      and not exists(select 1 from expert_sales_erased_cohorts e where e.user_id=intent.user_id)
      and not exists(select 1 from early_bird_verified_refund_bindings r where r.intent_id=intent.id and r.user_id=intent.user_id)
      and early_bird_current_time()<coverage.ends_at
    union all
    select base.id::text as id,choice.revision,'FULLY_PREPAID_NO_DISCOUNT' as status,
      account.subscription_minor::text as "baseMonthlyMinor",account.subscription_minor::text as "lockedMonthlyMinor",
      to_char(account.launch_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "clientStart",
      to_char(coverage.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "effectiveStart",
      case when early_bird_current_time()<coverage.starts_at then 'ACTIVE_PAID_WAITING_START' else 'ACTIVE' end as "residentStatus"
    from early_bird_deferred_accounts account
    join expert_sales_bases base on base.id=account.base_id and base.user_id=account.user_id
    join early_bird_choices choice on choice.id=account.choice_id and choice.user_id=account.user_id
    join early_bird_deferred_effective_coverages coverage on coverage.intent_id=account.id and coverage.user_id=account.user_id
    where account.user_id=${userId}::uuid and base.bot_id=${input.botId} and base.bot_key=${input.botKey} and base.chat_id=${input.chatId}
      and choice.id=(select c.id from early_bird_choices c where c.base_id=base.id order by c.decision_no desc limit 1)
      and expert_card_current_messaging_authority(account.user_id,base.consent_version)
      and not exists(select 1 from expert_sales_erased_cohorts e where e.user_id=account.user_id)
      and early_bird_current_time()<coverage.ends_at
    limit 2`)
      ).rows;
      return rows.length === 1 ? rows[0]! : null;
    });
  }
}
