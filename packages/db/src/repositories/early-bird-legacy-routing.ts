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
/** Selects only an existing scoped legacy cohort; an unclassified caller stays fail-closed. */
export class PostgresEarlyBirdLegacyRouting {
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: {
      botId: string;
      botKey: string;
      messagingConsentPolicyVersion: string;
    },
  ) {}
  async eligible(input: Scope): Promise<boolean> {
    if (
      !input ||
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.chatId !== input.telegramUserId ||
      !/^[1-9][0-9]{0,19}$/u.test(input.chatId)
    )
      return false;
    return this.db.transaction(async (tx) => {
      const users = (
        await tx.execute<{ id: string }>(
          sql`select u.id from channel_identities c join users u on u.id=c.user_id and u.active where c.provider='telegram' and c.bot_key=${input.botKey} and c.external_id=${input.telegramUserId} and c.external_chat_id=${input.chatId} and c.status='active' limit 2`,
        )
      ).rows;
      if (users.length !== 1) return false;
      const userId = users[0]!.id;
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
        sql`select id from early_bird_launch_configs where active and phase='WAVE_1_EARLY_BIRD' for share`,
      );
      if (config.rows.length !== 1) return false;
      const result = await tx.execute<{ eligible: boolean }>(
        sql`select early_bird_wave_active(early_bird_current_time()) and (exists(select 1 from residents_applications f where f.user_id=${userId}::uuid and f.bot_id=${input.botId} and f.bot_key=${input.botKey} and f.chat_id=${input.chatId} and f.is_current) or exists(select 1 from expert_sales_selections s join expert_sales_bases b on b.id=s.base_id and b.user_id=s.user_id where s.user_id=${userId}::uuid and b.bot_id=${input.botId} and b.bot_key=${input.botKey} and b.chat_id=${input.chatId})) and not exists(select 1 from early_bird_positive_price_snapshots p where p.user_id=${userId}::uuid) and not exists(select 1 from early_bird_choices c where c.user_id=${userId}::uuid) as eligible`,
      );
      return result.rows[0]?.eligible === true;
    });
  }
}
