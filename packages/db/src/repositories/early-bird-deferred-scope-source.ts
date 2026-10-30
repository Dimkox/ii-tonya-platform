import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";

type Scope = Readonly<{
  botId: string;
  botKey: string;
  telegramUserId: string;
  chatId: string;
  offerId: string;
  choiceId: string;
  accountId: string;
}>;
/** Resolves an authenticated expert Telegram identity to its current deferred account. */
export class PostgresDeferredScopeSource {
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: {
      botId: string;
      botKey: string;
      messagingConsentPolicyVersion: string;
    },
  ) {}
  async resolveQualified(
    input: Pick<
      Scope,
      "botId" | "botKey" | "telegramUserId" | "chatId" | "offerId" | "choiceId"
    > & { revision: number },
  ): Promise<{
    userId: string;
    baseId: string;
    choiceId: string;
    configId: string;
  } | null> {
    if (
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.telegramUserId !== input.chatId ||
      !/^[1-9][0-9]{0,19}$/u.test(input.chatId) ||
      !Number.isSafeInteger(input.revision) ||
      input.revision < 1 ||
      ![input.offerId, input.choiceId].every((id) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
          id,
        ),
      )
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
      const rows = (
        await tx.execute<{
          baseId: string;
          choiceId: string;
          configId: string;
        }>(
          sql`select b.id as "baseId",c.id as "choiceId",cfg.id as "configId" from expert_sales_bases b join early_bird_choices c on c.base_id=b.id and c.user_id=b.user_id join early_bird_launch_configs cfg on cfg.active and cfg.phase='WAVE_1_EARLY_BIRD' where b.id=${input.offerId}::uuid and b.user_id=${userId}::uuid and c.id=${input.choiceId}::uuid and c.revision=${input.revision} and c.choice='later' and c.id=(select id from early_bird_choices where base_id=b.id order by decision_no desc limit 1) and b.bot_id=${input.botId} and b.bot_key=${input.botKey} and b.chat_id=${input.chatId} and early_bird_wave_active(early_bird_current_time()) and early_bird_composite_qualification(b.user_id,c.id) and expert_card_current_messaging_authority(b.user_id,b.consent_version) limit 2 for share of b,c,cfg`,
        )
      ).rows;
      return rows.length === 1 ? { userId, ...rows[0]! } : null;
    });
  }
  async resolveCurrent(
    input: Pick<Scope, "botId" | "botKey" | "telegramUserId" | "chatId">,
  ): Promise<(Scope & { revision: number }) | null> {
    if (
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.telegramUserId !== input.chatId ||
      !/^[1-9][0-9]{0,19}$/u.test(input.chatId)
    )
      return null;
    const candidates = (
      await this.db.execute<{
        offerId: string;
        choiceId: string;
        accountId: string;
        revision: number;
      }>(
        sql`select a.base_id as "offerId",a.choice_id as "choiceId",a.id as "accountId",c.revision from early_bird_deferred_accounts a join expert_sales_bases b on b.id=a.base_id and b.user_id=a.user_id join early_bird_choices c on c.id=a.choice_id and c.user_id=a.user_id join users u on u.id=a.user_id and u.active join channel_identities ci on ci.user_id=u.id and ci.provider='telegram' and ci.status='active' where b.bot_id=${input.botId} and b.bot_key=${input.botKey} and b.chat_id=${input.chatId} and ci.bot_key=${input.botKey} and ci.external_id=${input.telegramUserId} and ci.external_chat_id=${input.chatId} and c.choice='later' and c.id=(select id from early_bird_choices where base_id=a.base_id order by decision_no desc limit 1) limit 2`,
      )
    ).rows;
    if (candidates.length !== 1) return null;
    const scope = { ...input, ...candidates[0]! };
    return (await this.resolve(scope)) ? scope : null;
  }
  async resolve(scope: Scope): Promise<{ userId: string } | null> {
    if (
      scope.botId !== this.policy.botId ||
      scope.botKey !== this.policy.botKey ||
      scope.telegramUserId !== scope.chatId ||
      !/^[1-9][0-9]{0,19}$/u.test(scope.chatId) ||
      ![scope.offerId, scope.choiceId, scope.accountId].every((id) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
          id,
        ),
      )
    )
      return null;
    return this.db.transaction(async (tx) => {
      const identity = (
        await tx.execute<{ id: string }>(
          sql`select u.id from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.provider='telegram' and ci.bot_key=${scope.botKey} and ci.external_id=${scope.telegramUserId} and ci.external_chat_id=${scope.chatId} and ci.status='active' limit 2`,
        )
      ).rows;
      if (identity.length !== 1) return null;
      const userId = identity[0]!.id;
      await lockClientConsentSubject(tx, userId);
      if (
        !(await captureClientConsentAuthority(tx, {
          subjectId: userId,
          botKey: scope.botKey,
          chatId: scope.chatId,
          externalUserId: scope.telegramUserId,
          messagingPolicyVersion: this.policy.messagingConsentPolicyVersion,
        }))
      )
        return null;
      const rows = (
        await tx.execute<{ id: string }>(
          sql`select a.id from early_bird_deferred_accounts a join expert_sales_bases b on b.id=a.base_id and b.user_id=a.user_id join early_bird_choices c on c.id=a.choice_id and c.user_id=a.user_id where a.id=${scope.accountId}::uuid and a.user_id=${userId}::uuid and b.id=${scope.offerId}::uuid and c.id=${scope.choiceId}::uuid and b.bot_id=${scope.botId} and b.bot_key=${scope.botKey} and b.chat_id=${scope.chatId} and c.choice='later' and c.id=(select id from early_bird_choices where base_id=b.id order by decision_no desc limit 1) and early_bird_wave_active(early_bird_current_time()) and expert_card_current_messaging_authority(a.user_id,b.consent_version) limit 2 for share of a,b,c`,
        )
      ).rows;
      return rows.length === 1 ? { userId } : null;
    });
  }
}
