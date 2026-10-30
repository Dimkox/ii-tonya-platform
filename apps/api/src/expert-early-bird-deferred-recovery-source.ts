import { sql } from "@ii-tonya/db";
import type { DrizzleDb, DeferredReceiptScope } from "@ii-tonya/db";
/** Trusted API primary connection, used only for SELECT discovery metadata. This
 * does not grant send, binding or settlement authority and never reads ciphertext. */
export class PostgresDeferredRecoverySource {
  constructor(private readonly db: DrizzleDb) {}
  async read(
    scope: DeferredReceiptScope,
    invoiceId: string,
    userId: string,
  ): Promise<
    | { kind: "unavailable" | "not_dispatched" }
    | { kind: "unknown"; createdFrom: string; createdBefore: string }
  > {
    if (
      ![
        invoiceId,
        userId,
        scope.accountId,
        scope.offerId,
        scope.choiceId,
      ].every((id) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
          id,
        ),
      )
    )
      return { kind: "unavailable" };
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`,
      );
      const row = (
        await tx.execute<{ marked: string | null }>(
          sql`select i.dispatch_started_at::text as marked from early_bird_deferred_invoices i join early_bird_deferred_accounts a on a.id=i.account_id and a.user_id=i.user_id join users u on u.id=i.user_id and u.active join expert_sales_bases b on b.id=a.base_id and b.user_id=a.user_id join early_bird_choices c on c.id=a.choice_id and c.user_id=a.user_id where i.id=${invoiceId}::uuid and i.user_id=${userId}::uuid and a.id=${scope.accountId}::uuid and b.id=${scope.offerId}::uuid and c.id=${scope.choiceId}::uuid and b.bot_id=${scope.botId} and b.bot_key=${scope.botKey} and b.chat_id=${scope.chatId} and c.choice='later' and c.id=(select id from early_bird_choices where base_id=b.id order by decision_no desc limit 1) and expert_card_current_messaging_authority(i.user_id,b.consent_version) and not exists(select 1 from expert_sales_erased_cohorts where user_id=i.user_id) and exists(select 1 from channel_identities ci where ci.user_id=i.user_id and ci.provider='telegram' and ci.status='active' and ci.bot_key=${scope.botKey} and ci.external_id=${scope.telegramUserId} and ci.external_chat_id=${scope.chatId}) for share of i,a,u,b,c`,
        )
      ).rows[0];
      if (!row) return { kind: "unavailable" };
      if (row.marked === null) return { kind: "not_dispatched" };
      const marked = Date.parse(row.marked);
      if (!Number.isFinite(marked)) return { kind: "unavailable" };
      return {
        kind: "unknown",
        createdFrom: new Date(marked - 300000).toISOString(),
        createdBefore: new Date(marked + 86400000 - 300000).toISOString(),
      };
    });
  }
}
