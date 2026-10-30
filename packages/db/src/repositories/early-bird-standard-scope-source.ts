import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";
import { deriveEarlyBirdStandardOperationIds } from "./early-bird-standard-operation-id.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
type Scope = {
  botId: string;
  botKey: string;
  telegramUserId: string;
  chatId: string;
  offerId: string;
  choiceId: string;
};
/** Draft-only scoped resolution; provides no receipt access or send authority. */
export class PostgresEarlyBirdStandardScopeSource {
  private readonly key: Buffer;
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: {
      botId: string;
      botKey: string;
      messagingConsentPolicyVersion: string;
    },
    identityKey: Buffer,
  ) {
    if (!Buffer.isBuffer(identityKey) || identityKey.length !== 32)
      throw new Error("early_bird_identity_invalid");
    this.key = Buffer.from(identityKey);
  }
  async resolveCurrent(
    input: Pick<Scope, "botId" | "botKey" | "telegramUserId" | "chatId">,
  ): Promise<Scope | null> {
    if (
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.telegramUserId !== input.chatId ||
      !/^[1-9][0-9]{0,19}$/u.test(input.chatId)
    )
      return null;
    const candidates = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout','4000ms',true)`,
      );
      return (
        await tx.execute<{ offerId: string; choiceId: string }>(sql`
        select b.id as "offerId",c.id as "choiceId" from channel_identities ci
        join users u on u.id=ci.user_id and u.active
        join expert_sales_bases b on b.user_id=u.id and b.bot_id=${input.botId} and b.bot_key=${input.botKey} and b.chat_id=${input.chatId}
        join early_bird_choices c on c.user_id=u.id and c.base_id=b.id and c.choice='now'
        where ci.provider='telegram' and ci.status='active' and ci.bot_key=${input.botKey} and ci.external_id=${input.telegramUserId} and ci.external_chat_id=${input.chatId}
          and c.id=(select latest.id from early_bird_choices latest where latest.user_id=u.id and latest.base_id=b.id order by latest.decision_no desc limit 1)
          and early_bird_composite_qualification(u.id,c.id) limit 2`)
      ).rows;
    });
    if (candidates.length !== 1) return null;
    const scope = { ...input, ...candidates[0]! };
    return (await this.resolve(scope)) ? scope : null;
  }
  async resolve(input: Scope): Promise<{
    userId: string;
    baseId: string;
    choiceId: string;
    operationId: string;
    invoiceId: string;
    idempotencyKey: string;
  } | null> {
    if (
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.telegramUserId !== input.chatId ||
      !/^[1-9][0-9]{0,19}$/u.test(input.chatId) ||
      !uuid.test(input.offerId) ||
      !uuid.test(input.choiceId)
    )
      return null;
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout','4000ms',true)`,
      );
      const identity = (
        await tx.execute<{ id: string }>(
          sql`select u.id from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.provider='telegram' and ci.bot_key=${input.botKey} and ci.external_id=${input.telegramUserId} and ci.external_chat_id=${input.chatId} and ci.status='active' limit 2`,
        )
      ).rows;
      if (identity.length !== 1) return null;
      const userId = identity[0]!.id;
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
        await tx.execute<{ present: boolean }>(sql`
        select true as present from expert_sales_bases b
        join early_bird_choices c on c.base_id=b.id and c.user_id=b.user_id
        join early_bird_positive_price_snapshots s on s.positive_choice_id=c.positive_choice_id and s.base_id=b.id and s.user_id=b.user_id
        where b.id=${input.offerId}::uuid and b.user_id=${userId}::uuid and c.id=${input.choiceId}::uuid and c.choice='now'
          and b.bot_id=${input.botId} and b.bot_key=${input.botKey} and b.chat_id=${input.chatId}
          and c.id=(select current_choice.id from early_bird_choices current_choice where current_choice.user_id=b.user_id and current_choice.base_id=b.id order by current_choice.decision_no desc limit 1)
          and s.policy_version='wave1_standard_v1' and s.grant_id is null and s.onboarding_minor=300000
          and not exists(select 1 from owner_test_pricing_grants g where g.user_id=b.user_id and g.revoked_at is null and g.provider_mode='live')
          and early_bird_wave_active(early_bird_current_time()) and early_bird_composite_qualification(b.user_id,c.id)
          and expert_card_current_messaging_authority(b.user_id,b.consent_version)
        for share of b,c,s`)
      ).rows;
      if (rows.length !== 1) return null;
      const prior = (
        await tx.execute<{
          operationId: string;
          invoiceId: string;
          idempotencyKey: string;
          matches: boolean;
        }>(sql`
        select id as "operationId", invoice_id as "invoiceId", idempotency_key as "idempotencyKey",
          (base_id=${input.offerId}::uuid and choice_id=${input.choiceId}::uuid and grant_id is null and pricing_policy='wave1_standard_v1') as matches
        from early_bird_composite_intents where user_id=${userId}::uuid and status in ('prepared','unknown','settled') for share`)
      ).rows;
      if (
        prior.length > 1 ||
        (prior.length === 1 && prior[0]!.matches !== true)
      )
        return null;
      const previous =
        prior.length === 0
          ? (
              await tx.execute<{ generation: number }>(
                sql`select count(*)::int as generation from early_bird_composite_intents where user_id=${userId}::uuid and choice_id=${input.choiceId}::uuid and status='abandoned'`,
              )
            ).rows[0]
          : undefined;
      const ids =
        prior.length === 1
          ? {
              operationId: prior[0]!.operationId,
              invoiceId: prior[0]!.invoiceId,
              idempotencyKey: prior[0]!.idempotencyKey,
            }
          : deriveEarlyBirdStandardOperationIds(this.key, {
              userId,
              choiceId: input.choiceId,
              generation: previous?.generation ?? 0,
            });
      return {
        userId,
        baseId: input.offerId,
        choiceId: input.choiceId,
        ...ids,
      };
    });
  }
}
