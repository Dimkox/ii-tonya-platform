import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";

/** Telegram target resolved only from the promo bot's own active private chat. */
export interface ExpertPromoFunnelTarget {
  userId: string;
  chatId: string;
}

/**
 * WAIT-T03..T06 funnel authority. Every send is claimed before transport
 * (at-most-once): a crash after claim leaves the row claimed, never resent.
 */
export class PostgresExpertPromoFunnelRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly options: {
      botKey: string;
      messagingConsentPolicyVersion: string;
    },
  ) {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(options.botKey))
      throw new Error("expert_promo_funnel_configuration_required");
  }

  private chat(userId: ReturnType<typeof sql>) {
    return sql`(select c.external_chat_id from channel_identities c where c.user_id=${userId} and c.provider='telegram' and c.bot_key=${this.options.botKey} and c.status='active' and c.external_chat_id=c.external_id order by c.id limit 1)`;
  }

  private async consented(
    tx: Pick<DrizzleDb, "execute">,
    userId: string,
    chatId: string,
  ) {
    await lockClientConsentSubject(tx, userId);
    return (
      (await captureClientConsentAuthority(tx, {
        subjectId: userId,
        botKey: this.options.botKey,
        chatId,
        externalUserId: chatId,
        messagingPolicyVersion: this.options.messagingConsentPolicyVersion,
      })) !== undefined
    );
  }

  /** T03: claim earned guides (count>=2 already inserted the work row). */
  async claimGuideDeliveries(input: {
    contentSlot: string;
    limit: number;
  }): Promise<ExpertPromoFunnelTarget[]> {
    if (!/^[A-Za-z0-9:_./-]{1,200}$/u.test(input.contentSlot))
      throw new Error("expert_promo_guide_content_invalid");
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit)));
    return this.db.transaction(async (tx) => {
      const rows = (
        await tx.execute<{ userId: string; chatId: string | null }>(
          sql`select w.user_id "userId",${this.chat(sql`w.user_id`)} "chatId" from expert_promo_guide_work w join users u on u.id=w.user_id and u.active where w.status='waiting_content' order by w.created_at,w.user_id limit ${limit} for update of w skip locked`,
        )
      ).rows;
      const claimed: ExpertPromoFunnelTarget[] = [];
      for (const row of rows) {
        if (!row.chatId || !(await this.consented(tx, row.userId, row.chatId)))
          continue;
        await tx.execute(
          sql`update expert_promo_guide_work set status='pending',content_slot=${input.contentSlot} where user_id=${row.userId}::uuid and status='waiting_content'`,
        );
        claimed.push({ userId: row.userId, chatId: row.chatId });
      }
      return claimed;
    });
  }

  /** T03: pdf_sent marker is guide_work.status='delivered'; funnel moves to WAITING_FOR_LAUNCH. */
  async markGuideDelivered(input: {
    userId: string;
    receipt: string;
  }): Promise<boolean> {
    if (!/^[A-Za-z0-9:_,.-]{1,200}$/u.test(input.receipt))
      throw new Error("expert_promo_guide_receipt_invalid");
    return this.db.transaction(async (tx) => {
      const done = (
        await tx.execute(
          sql`update expert_promo_guide_work set status='delivered',delivered_at=clock_timestamp(),delivery_receipt=${input.receipt} where user_id=${input.userId}::uuid and status='pending' returning user_id`,
        )
      ).rows.length;
      if (done)
        await tx.execute(
          sql`insert into expert_promo_funnel_state(user_id,status) values(${input.userId}::uuid,'WAITING_FOR_LAUNCH') on conflict(user_id) do update set status='WAITING_FOR_LAUNCH',last_interaction_at=clock_timestamp()`,
        );
      return done === 1;
    });
  }

  async pdfSent(userId: string): Promise<boolean> {
    const r = await this.db.execute<{ sent: boolean }>(
      sql`select exists(select 1 from expert_promo_guide_work where user_id=${userId}::uuid and status='delivered') sent`,
    );
    return r.rows[0]?.sent === true;
  }
}
