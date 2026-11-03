import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

/**
 * Replay store for Telegram callback_query ids. Reuses webhook_inbox
 * (unique provider + external_event_id) under its own provider namespace,
 * so no schema change is needed. update_id dedupe stays in the route inbox.
 */
export const TELEGRAM_CALLBACK_PROVIDER = "telegram_callback";

export class PostgresTelegramCallbackReplayRepository {
  constructor(private readonly db: Pick<DrizzleDb, "execute">) {}

  /** True when this callback id was already recorded as processed. */
  async isProcessed(callbackQueryId: string): Promise<boolean> {
    const result = await this.db.execute<{ found: number }>(sql`
      select 1 as found from webhook_inbox
      where provider = ${TELEGRAM_CALLBACK_PROVIDER}
        and external_event_id = ${callbackQueryId}
    `);
    return result.rows.length > 0;
  }

  /** Atomic first-writer-wins record. False means a replay. */
  async recordProcessed(callbackQueryId: string): Promise<boolean> {
    const result = await this.db.execute<{ id: string }>(sql`
      insert into webhook_inbox (provider, external_event_id, status, claim_id, lease_until)
      values (${TELEGRAM_CALLBACK_PROVIDER}, ${callbackQueryId}, 'complete', gen_random_uuid(), null)
      on conflict (provider, external_event_id) do nothing
      returning id
    `);
    return result.rows.length === 1;
  }

  /** Active Telegram channel identity bound to an active expert. */
  async isActiveExpertTelegramUser(telegramUserId: string): Promise<boolean> {
    const result = await this.db.execute<{ found: number }>(sql`
      select 1 as found
      from channel_identities ci
      join experts e on e.user_id = ci.user_id
      where ci.provider = 'telegram'
        and ci.external_id = ${telegramUserId}
        and ci.status = 'active'
        and e.active = true
      limit 1
    `);
    return result.rows.length > 0;
  }
}
