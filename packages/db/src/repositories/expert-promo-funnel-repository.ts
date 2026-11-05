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
  refCode?: string;
  referralCount?: number;
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

  /**
   * T04 timers: message 6 at 48h, gift at 5d after code issue. Each claim
   * rechecks status, opt-out, pdf_sent, count<2 and consent, then stamps the
   * marker before transport (at-most-once).
   */
  async claimTimer(input: {
    kind: "message6" | "gift";
    limit: number;
  }): Promise<ExpertPromoFunnelTarget[]> {
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit)));
    const marker = sql.raw(
      input.kind === "message6" ? "message6_sent_at" : "gift_sent_at",
    );
    const age = sql.raw(
      input.kind === "message6"
        ? "interval '48 hours'"
        : "interval '0 seconds'",
    );
    return this.db.transaction(async (tx) => {
      const rows = (
        await tx.execute<{
          userId: string;
          chatId: string | null;
          refCode: string;
          referralCount: number;
        }>(
          sql`select f.user_id "userId",${this.chat(sql`f.user_id`)} "chatId",i.ref_code "refCode",(select count(*)::int from expert_promo_registrations r join users ru on ru.id=r.user_id and ru.active where r.referrer_user_id=f.user_id) "referralCount" from expert_promo_funnel_state f join users u on u.id=f.user_id and u.active where f.status='REFERRAL_ACTIVE' and not f.opt_out_ref and f.${marker} is null and (${sql.raw(input.kind === "message6" ? "f.code_issued_at" : "f.message6_sent_at")})<=clock_timestamp()-${age} and not exists(select 1 from expert_promo_guide_work w where w.user_id=f.user_id and w.status='delivered') and (select count(*) from expert_promo_registrations r join users ru on ru.id=r.user_id and ru.active where r.referrer_user_id=f.user_id)<2 order by f.code_issued_at,f.user_id limit ${limit} for update of f skip locked`,
        )
      ).rows;
      const claimed: ExpertPromoFunnelTarget[] = [];
      for (const row of rows) {
        if (!row.chatId || !(await this.consented(tx, row.userId, row.chatId)))
          continue;
        await tx.execute(
          sql`update expert_promo_funnel_state set ${marker}=clock_timestamp() where user_id=${row.userId}::uuid and ${marker} is null`,
        );
        claimed.push({ userId: row.userId, chatId: row.chatId });
      }
      return claimed;
    });
  }

  /** T06: rows whose referral count changed since the last CRM sync. */
  async listCrmDue(limit: number) {
    const n = Math.max(1, Math.min(100, Math.trunc(limit)));
    return (
      await this.db.execute<{
        userId: string;
        firstName: string | null;
        gender: "female" | "male" | null;
        status: string;
        referralCount: number;
      }>(
        sql`select * from (select f.user_id "userId",f.first_name "firstName",f.gender,f.status,(select count(*)::int from expert_promo_registrations r join users ru on ru.id=r.user_id and ru.active where r.referrer_user_id=f.user_id) "referralCount",f.crm_synced_referral_count synced from expert_promo_funnel_state f join users u on u.id=f.user_id and u.active) x where x.synced is distinct from x."referralCount" order by x."userId" limit ${n}`,
      )
    ).rows.map(({ userId, firstName, gender, status, referralCount }) => ({
      userId,
      firstName,
      gender,
      status,
      referralCount,
    }));
  }

  /** Idempotent: re-marking the same count is a no-op. */
  async markCrmSynced(input: { userId: string; referralCount: number }) {
    if (!Number.isSafeInteger(input.referralCount) || input.referralCount < 0)
      throw new Error("expert_promo_crm_count_invalid");
    const r = await this.db.execute(
      sql`update expert_promo_funnel_state set crm_synced_referral_count=${input.referralCount},crm_synced_at=clock_timestamp() where user_id=${input.userId}::uuid and crm_synced_referral_count is distinct from ${input.referralCount}::int returning user_id`,
    );
    return r.rows.length === 1;
  }
}
