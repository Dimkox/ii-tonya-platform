import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { earlyBirdFormEligible } from "./early-bird-form-eligibility.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";

export type EarlyBirdChoiceCommand = {
  botId: string;
  botKey: string;
  telegramUserId: string;
  chatId: string;
  updateId: number;
  offerId: string;
  revision: number;
  choice: "now" | "later";
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Stores nonfinancial choices only. This class cannot create or settle a payment. */
export class PostgresEarlyBirdChoiceRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: {
      botId: string;
      botKey: string;
      messagingConsentPolicyVersion: string;
    },
  ) {}
  /** Read the authenticated current decision; never records/reprices a choice. */
  async currentPayment(
    input: Pick<
      EarlyBirdChoiceCommand,
      "botId" | "botKey" | "telegramUserId" | "chatId"
    >,
  ): Promise<{
    id: string;
    revision: number;
    choiceId: string;
    choice: "now" | "later";
    baseMonthlyMinor: string;
    qualified: boolean;
  } | null> {
    if (
      !input ||
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.telegramUserId !== input.chatId ||
      !/^[1-9][0-9]{0,19}$/u.test(input.chatId)
    )
      return null;
    return this.db.transaction(async (tx) => {
      const identities = (
        await tx.execute<{ id: string }>(
          sql`select u.id from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.provider='telegram' and ci.bot_key=${input.botKey} and ci.external_id=${input.telegramUserId} and ci.external_chat_id=${input.chatId} and ci.status='active' limit 2`,
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
      if (
        !(await earlyBirdFormEligible(tx, {
          userId,
          botId: input.botId,
          botKey: input.botKey,
          chatId: input.chatId,
        }))
      )
        return null;
      const rows = (
        await tx.execute<{
          id: string;
          revision: number;
          choiceId: string;
          choice: "now" | "later";
          baseMonthlyMinor: string;
          qualified: boolean;
        }>(
          sql`select b.id,c.revision,c.id as "choiceId",c.choice,b.base_tariff_amount::text as "baseMonthlyMinor",early_bird_composite_qualification(b.user_id,c.id) as qualified from expert_sales_bases b join early_bird_choices c on c.base_id=b.id and c.user_id=b.user_id where b.user_id=${userId}::uuid and b.bot_id=${input.botId} and b.bot_key=${input.botKey} and b.chat_id=${input.chatId} and c.id=(select id from early_bird_choices where base_id=b.id order by decision_no desc limit 1) and c.positive_choice_id=(select id from expert_sales_choices where base_id=b.id order by revision desc limit 1) for share of b,c`,
        )
      ).rows;
      return rows.length === 1 ? rows[0]! : null;
    });
  }
  async formEligible(
    input: Pick<
      EarlyBirdChoiceCommand,
      "botId" | "botKey" | "telegramUserId" | "chatId"
    >,
  ): Promise<boolean> {
    if (
      !input ||
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.telegramUserId !== input.chatId ||
      !/^[1-9][0-9]{0,19}$/u.test(input.chatId)
    )
      return false;
    return this.db.transaction(async (tx) => {
      const identities = (
        await tx.execute<{ id: string }>(
          sql`select u.id from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.provider='telegram' and ci.bot_key=${input.botKey} and ci.external_id=${input.telegramUserId} and ci.external_chat_id=${input.chatId} and ci.status='active' limit 2`,
        )
      ).rows;
      if (identities.length !== 1) return false;
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
        return false;
      return earlyBirdFormEligible(tx, {
        userId,
        botId: input.botId,
        botKey: input.botKey,
        chatId: input.chatId,
      });
    });
  }
  async formContinuationEligible(
    input: Pick<
      EarlyBirdChoiceCommand,
      "botId" | "botKey" | "telegramUserId" | "chatId"
    >,
  ): Promise<boolean> {
    if (
      !input ||
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.telegramUserId !== input.chatId ||
      !/^[1-9][0-9]{0,19}$/u.test(input.chatId)
    )
      return false;
    return this.db.transaction(async (tx) => {
      const identities = (
        await tx.execute<{ id: string }>(
          sql`select u.id from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.provider='telegram' and ci.bot_key=${input.botKey} and ci.external_id=${input.telegramUserId} and ci.external_chat_id=${input.chatId} and ci.status='active' limit 2`,
        )
      ).rows;
      if (identities.length !== 1) return false;
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
        return false;
      const config = await tx.execute(
        sql`select id from early_bird_launch_configs where active for share`,
      );
      if (config.rows.length !== 1) return false;
      const forms = await tx.execute(
        sql`select f.id from early_bird_form_enrollments e join residents_applications f on f.id=e.form_id and f.user_id=e.user_id join early_bird_choices c on c.id=e.choice_id and c.user_id=e.user_id join expert_sales_bases b on b.id=c.base_id and b.user_id=c.user_id where e.user_id=${userId}::uuid and f.is_current and f.bot_id=${input.botId} and f.bot_key=${input.botKey} and f.chat_id=${input.chatId} and (f.status in('PENDING_DOCS','UNDER_REVIEW','INFO_REQUESTED') or (f.status='REJECTED' and exists(select 1 from resident_review_events ev where ev.attempt_id=f.id and ev.action='REJECT_SOFT' and resident_reapply_eligible(ev.reapply_at,clock_timestamp())) and not exists(select 1 from expert_onboarding_payment_facts where user_id=e.user_id) and not exists(select 1 from expert_sales_paid_locks where user_id=e.user_id))) and expert_card_current_messaging_authority(e.user_id,b.consent_version) for share of e,f,b`,
      );
      return forms.rows.length === 1;
    });
  }
  async record(
    input: EarlyBirdChoiceCommand,
  ): Promise<{ id: string; choice: "now" | "later"; replay: boolean } | null> {
    if (
      !input ||
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.telegramUserId !== input.chatId ||
      !/^[1-9][0-9]{0,19}$/u.test(input.chatId) ||
      !uuid.test(input.offerId) ||
      !Number.isSafeInteger(input.updateId) ||
      input.updateId < 0 ||
      !Number.isSafeInteger(input.revision) ||
      input.revision < 1 ||
      input.revision > 999999 ||
      (input.choice !== "now" && input.choice !== "later")
    )
      throw new Error("early_bird_choice_identity");
    const requestKey = `early-bird:${input.botId}:${input.updateId}`;
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          botId: input.botId,
          botKey: input.botKey,
          telegramUserId: input.telegramUserId,
          chatId: input.chatId,
          offerId: input.offerId,
          revision: input.revision,
          choice: input.choice,
        }),
      )
      .digest("hex");
    return this.db.transaction(async (tx) => {
      const identities = (
        await tx.execute<{ id: string }>(
          sql`select u.id from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.provider='telegram' and ci.bot_key=${input.botKey} and ci.external_id=${input.telegramUserId} and ci.external_chat_id=${input.chatId} and ci.status='active' limit 2`,
        )
      ).rows;
      if (identities.length !== 1)
        throw new Error("early_bird_choice_identity");
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
        throw new Error("early_bird_choice_identity");
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${userId}::text,0))`,
      );
      const config = (
        await tx.execute<{ id: string }>(
          sql`select id from early_bird_launch_configs where active and phase='WAVE_1_EARLY_BIRD' and early_bird_current_time()>=enrollment_start_at and early_bird_current_time()<client_start_at for share`,
        )
      ).rows;
      if (config.length !== 1) return null;
      const prior = (
        await tx.execute<{
          id: string;
          choice: "now" | "later";
          request_digest: string;
        }>(
          sql`select id,choice,request_digest from early_bird_choices where base_id=${input.offerId}::uuid and user_id=${userId}::uuid and request_key=${requestKey}`,
        )
      ).rows[0];
      if (prior) {
        if (prior.request_digest !== digest || prior.choice !== input.choice)
          throw new Error("early_bird_choice_replay_conflict");
        const snapshot = (
          await tx.execute<{ grantId: string | null }>(
            sql`select s.grant_id as "grantId" from early_bird_choices c join early_bird_positive_price_snapshots s on s.positive_choice_id=c.positive_choice_id and s.user_id=c.user_id and s.base_id=c.base_id where c.id=${prior.id}::uuid and c.user_id=${userId}::uuid for share of s`,
          )
        ).rows[0];
        if (!snapshot) return null;
        const grants = (
          await tx.execute<{ id: string }>(
            sql`select id from owner_test_pricing_grants where user_id=${userId}::uuid and revoked_at is null and provider_mode='live' for share`,
          )
        ).rows;
        if (grants.length > 1 || (grants[0]?.id ?? null) !== snapshot.grantId)
          return null;
        const current = (
          await tx.execute<{ valid: boolean }>(
            sql`select early_bird_wave_active(early_bird_current_time()) and id=${prior.id}::uuid and positive_choice_id=(select id from expert_sales_choices where base_id=${input.offerId}::uuid order by revision desc limit 1) and not exists(select 1 from expert_onboarding_invoices where user_id=${userId}::uuid) as valid from early_bird_choices where base_id=${input.offerId}::uuid and user_id=${userId}::uuid order by decision_no desc limit 1`,
          )
        ).rows[0];
        return current?.valid
          ? { id: prior.id, choice: prior.choice, replay: true }
          : null;
      }
      const inserted = (
        await tx.execute<{ id: string; choice: "now" | "later" }>(
          sql`insert into early_bird_choices(user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) select b.user_id,b.id,c.id,c.revision,${input.choice},${requestKey},${digest} from expert_sales_bases b join expert_sales_choices c on c.base_id=b.id and c.user_id=b.user_id where b.id=${input.offerId}::uuid and b.user_id=${userId}::uuid and b.bot_id=${input.botId} and b.bot_key=${input.botKey} and b.chat_id=${input.chatId} and c.revision=${input.revision} and c.action='positive' returning id,choice`,
        )
      ).rows[0];
      return inserted ? { ...inserted, replay: false } : null;
    });
  }
}
