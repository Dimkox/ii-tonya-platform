import { recordResidentMainInvoice } from "./resident-lifecycle-completion-repository.js";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expireLockedExpertResidencyOrder } from "./expert-residency-repository.js";
import type { DrizzleDb } from "../client.js";
import { PostgresExpertCampaignQuoteRepository } from "./expert-campaign-quote-repository.js";
import {
  lockClientConsentSubject,
  captureClientConsentAuthority,
} from "./client-consent-authority.js";
import { originalClientConsentSql } from "./consent-current.js";
import {
  normalizeCardEvent,
  type ExpertCardMaterialTransport,
} from "./expert-card-repository.js";

export interface PersonalOfferProjection extends Record<string, unknown> {
  selected_locked_total?: string;
  selected_locked_term?: 1 | 3;
  offer_start_date: string;
  current_discount_stage: number;
  discount_percent: number;
  locked_price_monthly: string;
  locked_price_package: string | null;
  payment_link_expires_at: string;
  remaining_seconds: number;
  readiness: "ready" | "pending_gates" | "select_one_month";
  payment_url: string | null;
}
interface Policy {
  workBotId: string;
  workBotKey: string;
  messagingConsentPolicyVersion: string;
  noticeTransport?: ExpertCardMaterialTransport;
  promoBotId?: string;
  promoBotKey?: string;
  promoConsentPolicyVersion?: string;
}
const rubles = (minor: string) => {
  const money = BigInt(minor);
  const fraction = money % 100n;
  return (
    (money / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, " ") +
    (fraction === 0n ? "" : "," + fraction.toString().padStart(2, "0")) +
    " ₽"
  );
};
const iso = (v: Date | string) => new Date(v).toISOString();
const limitOf = (v: number) => {
  if (!Number.isSafeInteger(v) || v < 1 || v > 50)
    throw new Error("personal_offer_batch_invalid");
  return v;
};
/** Prices are projections of immutable quotes; PostgreSQL is the only clock. */
export class PostgresExpertPersonalOfferRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: Policy,
  ) {}
  private eligible(userId: string) {
    return sql`not exists(select 1 from expert_sales_bases where user_id=${userId}::uuid) and resident_verification_price_allowed(${userId}::uuid) and exists(select 1 from users u join expert_promo_enrollments p on p.user_id=u.id where u.id=${userId}::uuid and u.active and p.status='granted' and p.policy_version=${this.policy.promoConsentPolicyVersion ?? this.policy.messagingConsentPolicyVersion} and exists(select 1 from (${originalClientConsentSql(userId, "client_messaging")}) original join consents c on c.id=original."decisionId"::uuid and c.presentation_id=p.presentation_id)) and not exists(select 1 from experts e join expert_residency_orders o on o.expert_id=e.id where e.user_id=${userId}::uuid and o.status='settled')`;
  }
  async refreshDue(
    rawLimit = 10,
  ): Promise<readonly { scheduleId: string; quoteId: string }[]> {
    const limit = limitOf(rawLimit);
    const candidates = (
      await this.db.execute<{
        userId: string;
        tariffVersionId: string;
        termMonths: 1 | 3;
        scheduleId: string | null;
      }>(
        sql`select a.user_id as "userId",coalesce(s.tariff_version_id,q.tariff_version_id) as "tariffVersionId",coalesce(s.term_months,q.term_months) as "termMonths",s.id as "scheduleId" from expert_promo_enrollments a join lateral(select owned.* from expert_campaign_quotes owned where owned.user_id=a.user_id order by owned.quoted_at desc,owned.id desc limit 1) q on true left join lateral(select * from expert_offer_schedules where user_id=a.user_id order by created_at desc,id desc limit 1)s on true left join expert_personal_offer_state st on st.user_id=a.user_id where coalesce(st.next_refresh_at,'epoch'::timestamptz)<=clock_timestamp() and exists(select 1 from expert_offer_profiles profile where profile.user_id=a.user_id) order by coalesce(st.next_refresh_at,'epoch'::timestamptz),a.created_at,a.user_id limit ${limit}`,
      )
    ).rows;
    const result: { scheduleId: string; quoteId: string }[] = [];
    for (const c of candidates)
      await this.db.transaction(async (tx) => {
        await lockClientConsentSubject(tx, c.userId);
        // Lifetime sales own their verified checkout. The legacy campaign scheduler
        // must not erase it merely because the resident is outside that campaign.
        if (
          (
            await tx.execute(
              sql`select 1 from expert_sales_bases where user_id=${c.userId}::uuid`,
            )
          ).rows.length
        ) {
          await tx.execute(
            sql`update expert_personal_offer_notices set status='cancelled' where user_id=${c.userId}::uuid and status='pending'`,
          );
          await tx.execute(
            sql`update expert_personal_offer_state set next_refresh_at=clock_timestamp()+interval '15 minutes' where user_id=${c.userId}::uuid`,
          );
          return;
        }
        if (
          !(
            await tx.execute<{ ok: boolean }>(
              sql`select ${this.eligible(c.userId)} as ok`,
            )
          ).rows[0]?.ok
        ) {
          await tx.execute(
            sql`update expert_personal_offer_notices set status='cancelled' where user_id=${c.userId}::uuid and status='pending'`,
          );
          await tx.execute(
            sql`insert into expert_personal_offer_state(user_id,quote_id,next_refresh_at) select user_id,id,clock_timestamp()+interval '15 minutes' from expert_campaign_quotes where user_id=${c.userId}::uuid order by quoted_at desc,id desc limit 1 on conflict(user_id) do update set payment_id=null,payment_url=null,order_id=null,next_refresh_at=excluded.next_refresh_at`,
          );
          return;
        }
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${"personal-offer:" + c.userId},0))`,
        );
        const due = (
          await tx.execute<{ due: boolean }>(
            sql`select next_refresh_at<=clock_timestamp() as due from expert_personal_offer_state where user_id=${c.userId}::uuid for update`,
          )
        ).rows[0];
        if (due?.due === false) return;
        const orders = (
          await tx.execute<{ id: string; expertId: string }>(
            sql`select o.id,o.expert_id as "expertId" from expert_residency_orders o join expert_card_main_orders m on m.order_id=o.id where m.user_id=${c.userId}::uuid and o.status='payment_pending' and o.payment_deadline<=clock_timestamp() for update of o`,
          )
        ).rows;
        for (const order of orders)
          await expireLockedExpertResidencyOrder(
            tx,
            order,
            sql`clock_timestamp()`,
          );
        // The selection is retained. An expired package never silently becomes monthly.
        const available = (
          await tx.execute<{ available: boolean }>(
            sql`select ${c.termMonths}<>3 or clock_timestamp()<min(calculation_timestamp)+interval '168 hours' as available from expert_campaign_anchors where user_id=${c.userId}::uuid`,
          )
        ).rows[0]?.available;
        const displayTerm = available === false ? 1 : c.termMonths;
        const existing = (
          await tx.execute<{ quoteId: string }>(
            sql`select st.quote_id as "quoteId" from expert_personal_offer_state st join expert_campaign_quotes q on q.id=st.quote_id where st.user_id=${c.userId}::uuid and q.expires_at>clock_timestamp() and q.tariff_version_id=${c.tariffVersionId}::uuid and q.term_months=${displayTerm} and q.profile_revision=(select max(revision) from expert_offer_profiles where user_id=st.user_id)`,
          )
        ).rows[0];
        if (existing) {
          await tx.execute(
            sql`update expert_personal_offer_state set next_refresh_at=clock_timestamp()+interval '15 minutes',refreshed_at=clock_timestamp() where user_id=${c.userId}::uuid`,
          );
          await this.enqueueReminders(tx, existing.quoteId);
          if (c.scheduleId && available !== false)
            result.push({
              scheduleId: c.scheduleId,
              quoteId: existing.quoteId,
            });
          return;
        }
        const profileRevision = (
          await tx.execute<{ revision: number }>(
            sql`select max(revision) as revision from expert_offer_profiles where user_id=${c.userId}::uuid`,
          )
        ).rows[0]!.revision;
        const slot = (
          await tx.execute<{ slot: string }>(
            sql`select floor(extract(epoch from clock_timestamp())/900)::text slot`,
          )
        ).rows[0]!.slot;
        const quote = await new PostgresExpertCampaignQuoteRepository(
          this.db,
        ).createCurrentQuoteInTransaction(tx, {
          userId: c.userId,
          tariffVersionId: c.tariffVersionId,
          termMonths: displayTerm,
          idempotencyKey: `personal-offer:${c.userId}:${c.tariffVersionId}:${profileRevision}:${displayTerm}:${slot}`,
        });
        await tx.execute(
          sql`insert into expert_personal_offer_state(user_id,quote_id,schedule_id,refreshed_at,next_refresh_at) values(${c.userId}::uuid,${quote.id}::uuid,${c.scheduleId}::uuid,clock_timestamp(),clock_timestamp()+interval '15 minutes') on conflict(user_id) do update set quote_id=excluded.quote_id,schedule_id=excluded.schedule_id,payment_id=null,payment_url=null,order_id=null,refreshed_at=excluded.refreshed_at,next_refresh_at=excluded.next_refresh_at`,
        );
        await tx.execute(
          sql`update expert_personal_offer_notices set status='cancelled' where user_id=${c.userId}::uuid and status='pending' and stage_deadline<=clock_timestamp()`,
        );
        // Catch up only the most urgent threshold still inside the current stage.
        await this.enqueueReminders(tx, quote.id);
        if (c.scheduleId && available !== false)
          result.push({ scheduleId: c.scheduleId, quoteId: quote.id });
      });
    return result;
  }
  private async enqueueReminders(
    tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0],
    quoteId: string,
  ) {
    await tx.execute(
      sql`with q as(select *,case when quoted_at<calculation_timestamp+interval '96 hours' then calculation_timestamp+interval '96 hours' when quoted_at<calculation_timestamp+interval '168 hours' then calculation_timestamp+interval '168 hours' when quoted_at<calculation_timestamp+interval '240 hours' then calculation_timestamp+interval '240 hours' end deadline from expert_campaign_quotes where id=${quoteId}::uuid),due as(select q.*,case when deadline-clock_timestamp()<=interval '3 hours' then 3 else 24 end lead from q where deadline>clock_timestamp() and deadline-clock_timestamp()<=interval '24 hours') insert into expert_personal_offer_notices(user_id,quote_id,stage_deadline,lead_hours) select user_id,id,deadline,lead from due on conflict(user_id,stage_deadline,lead_hours) do nothing`,
    );
  }
  async recordLink(input: {
    scheduleId: string;
    quoteId: string;
    orderId: string;
    paymentId: string;
    url: string;
  }): Promise<boolean> {
    const url = new URL(input.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(url.hostname)
    )
      return false;
    return this.db.transaction(async (tx) => {
      const owner = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from expert_offer_schedules where id=${input.scheduleId}::uuid`,
        )
      ).rows[0];
      if (!owner) return false;
      await lockClientConsentSubject(tx, owner.userId);
      const saved = await tx.execute(
        sql`update expert_personal_offer_state st set order_id=${input.orderId}::uuid,payment_id=${input.paymentId},payment_url=${url.toString()} where st.user_id=${owner.userId}::uuid and st.schedule_id=${input.scheduleId}::uuid and st.quote_id=${input.quoteId}::uuid and ${this.eligible(owner.userId)} and exists(select 1 from expert_residency_orders o join expert_card_main_orders m on m.order_id=o.id where o.id=${input.orderId}::uuid and m.user_id=st.user_id and o.campaign_quote_id=st.quote_id and o.status='payment_pending' and o.payment_deadline>clock_timestamp() and exists(select 1 from expert_card_main_orders gate_binding where gate_binding.order_id=o.id and gate_binding.user_id=st.user_id and expert_card_activation_gate_valid(gate_binding.user_id,gate_binding.review_id) and expert_campaign_current_profile_valid(gate_binding.user_id,o.campaign_quote_id) and st.schedule_id is not distinct from (select latest.id from expert_offer_schedules latest where latest.user_id=st.user_id order by latest.created_at desc,latest.id desc limit 1))) returning st.user_id`,
      );
      if (saved.rows.length === 1)
        await tx.execute(
          sql`insert into expert_personal_offer_notices(user_id,quote_id,stage_deadline,lead_hours) select st.user_id,st.quote_id,q.expires_at,0 from expert_personal_offer_state st join expert_campaign_quotes q on q.id=st.quote_id where st.user_id=${owner.userId}::uuid on conflict(user_id,stage_deadline,lead_hours) do nothing`,
        );
      if (saved.rows.length === 1)
        await recordResidentMainInvoice(tx, owner.userId, input.orderId);
      return saved.rows.length === 1;
    });
  }
  private async refreshOwnedQuote(
    tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0],
    userId: string,
  ): Promise<void> {
    const source = (
      await tx.execute<{
        tariffVersionId: string;
        termMonths: 1 | 3;
        scheduleId: string | null;
        fresh: boolean;
        profileRevision: number;
      }>(
        sql`select coalesce(s.tariff_version_id,q.tariff_version_id) as "tariffVersionId",coalesce(s.term_months,q.term_months) as "termMonths",s.id as "scheduleId",coalesce(stq.expires_at>clock_timestamp() and stq.profile_revision=(select max(revision) from expert_offer_profiles where user_id=a.user_id),false) as fresh,(select max(revision) from expert_offer_profiles where user_id=a.user_id) as "profileRevision" from expert_promo_enrollments a join lateral(select owned.* from expert_campaign_quotes owned where owned.user_id=a.user_id order by owned.quoted_at desc,owned.id desc limit 1) q on true left join lateral(select * from expert_offer_schedules where user_id=a.user_id order by created_at desc,id desc limit 1)s on true left join expert_personal_offer_state st on st.user_id=a.user_id left join expert_campaign_quotes stq on stq.id=st.quote_id where a.user_id=${userId}::uuid and ${this.eligible(userId)}`,
      )
    ).rows[0];
    if (!source || source.fresh) return;
    const clock = (
      await tx.execute<{ slot: string; packageAvailable: boolean }>(
        sql`select floor(extract(epoch from clock_timestamp())/900)::text slot,clock_timestamp()<min(calculation_timestamp)+interval '168 hours' as "packageAvailable" from expert_campaign_anchors where user_id=${userId}::uuid`,
      )
    ).rows[0]!;
    const termMonths =
      source.termMonths === 3 && clock.packageAvailable === false
        ? 1
        : source.termMonths;
    const quote = await new PostgresExpertCampaignQuoteRepository(
      this.db,
    ).createCurrentQuoteInTransaction(tx, {
      userId,
      tariffVersionId: source.tariffVersionId,
      termMonths,
      idempotencyKey: `personal-read:${userId}:${source.tariffVersionId}:${source.profileRevision}:${termMonths}:${clock.slot}`,
    });
    await tx.execute(
      sql`insert into expert_personal_offer_state(user_id,quote_id,schedule_id,refreshed_at,next_refresh_at) values(${userId}::uuid,${quote.id}::uuid,${source.scheduleId}::uuid,clock_timestamp(),clock_timestamp()) on conflict(user_id) do update set quote_id=excluded.quote_id,schedule_id=excluded.schedule_id,payment_id=null,payment_url=null,order_id=null,refreshed_at=excluded.refreshed_at,next_refresh_at=excluded.next_refresh_at`,
    );
  }
  private async readPaidSales(
    tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0],
    userId: string,
  ): Promise<PersonalOfferProjection | null> {
    const row = (
      await tx.execute<PersonalOfferProjection>(
        sql`select l.final_locked_price::text selected_locked_total,l.term_months selected_locked_term,b.base_offer_shown_at::text offer_start_date,4 current_discount_stage,s.energy_discount_bps/100 discount_percent,s.monthly_price_minor::text locked_price_monthly,case when l.term_months=3 then l.final_locked_price::text end locked_price_package,coalesce(link.deadline,l.locked_at)::text payment_link_expires_at,0 remaining_seconds,case when link.url is not null then 'ready' else 'pending_gates' end readiness,link.url payment_url from expert_sales_paid_locks l join expert_sales_selections s on s.id=l.selection_id join expert_sales_bases b on b.id=s.base_id join users u on u.id=l.user_id and u.active left join lateral (
          select st.payment_url as url,o.payment_deadline as deadline from expert_personal_offer_state st
          join expert_residency_orders o on o.id=st.order_id and o.status='payment_pending' and o.payment_deadline>clock_timestamp()
          join expert_card_main_orders m on m.order_id=o.id and m.user_id=l.user_id
          join expert_residency_provider_operations op on op.order_id=o.id and op.operation_kind='create_payment' and op.provider_object_id=st.payment_id and op.amount_minor=o.cash_minor and op.currency=o.currency and op.status in('pending','unknown_outcome','succeeded')
          where st.user_id=l.user_id and st.quote_id=o.campaign_quote_id and st.payment_url is not null
          and expert_card_activation_gate_valid(m.user_id,m.review_id) and expert_campaign_current_profile_valid(m.user_id,o.campaign_quote_id)
          order by op.created_at desc limit 1
        ) link on true where l.user_id=${userId}::uuid and b.consent_version is not null and expert_card_current_messaging_authority(l.user_id,b.consent_version)`,
      )
    ).rows[0];
    return row ?? null;
  }
  async read(scope: {
    botId: string;
    botKey: string;
    telegramUserId: string;
    chatId: string;
  }): Promise<PersonalOfferProjection | null> {
    const s = normalizeCardEvent({
      ...scope,
      requestKey: scope.botId + ":0",
      requestDigest: "0".repeat(64),
    });
    if (
      (s.botId !== this.policy.workBotId ||
        s.botKey !== this.policy.workBotKey) &&
      (s.botId !== this.policy.promoBotId ||
        s.botKey !== this.policy.promoBotKey)
    )
      return null;
    return this.db.transaction(async (tx) => {
      const rows = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from channel_identities where provider='telegram' and bot_key=${s.botKey} and external_id=${s.telegramUserId} and external_chat_id=${s.chatId} and status='active' limit 2`,
        )
      ).rows;
      if (rows.length !== 1) return null;
      const userId = rows[0]!.userId;
      await lockClientConsentSubject(tx, userId);
      if (
        !(await captureClientConsentAuthority(tx, {
          subjectId: userId,
          botKey: s.botKey,
          chatId: s.chatId,
          externalUserId: s.telegramUserId,
          messagingPolicyVersion:
            s.botKey === this.policy.promoBotKey
              ? (this.policy.promoConsentPolicyVersion ??
                this.policy.messagingConsentPolicyVersion)
              : this.policy.messagingConsentPolicyVersion,
        }))
      )
        return null;
      const paidSales = await this.readPaidSales(tx, userId);
      if (paidSales) return paidSales;
      await this.refreshOwnedQuote(tx, userId);
      const row = (
        await tx.execute<
          PersonalOfferProjection & {
            offer_start_date: string | Date;
            payment_link_expires_at: string | Date;
          }
        >(
          sql`select q.calculation_timestamp as offer_start_date,case q.energy_discount_bps when 4000 then 1 when 3000 then 2 when 2000 then 3 else 4 end as current_discount_stage,q.energy_discount_bps/100 as discount_percent,q.monthly_price_minor::text as locked_price_monthly,case when clock_timestamp()<q.calculation_timestamp+interval '168 hours' then q.package_price_minor::text end as locked_price_package,case when st.payment_url is not null and o.status='payment_pending' and o.payment_deadline>clock_timestamp() then least(q.expires_at,o.payment_deadline) else q.expires_at end as payment_link_expires_at,greatest(0,floor(extract(epoch from q.expires_at-clock_timestamp())))::integer as remaining_seconds,case when s.term_months=3 and clock_timestamp()>=q.calculation_timestamp+interval '168 hours' then 'select_one_month' when st.payment_url is not null and o.status='payment_pending' and o.payment_deadline>clock_timestamp() and exists(select 1 from expert_card_main_orders gate_binding where gate_binding.order_id=o.id and gate_binding.user_id=st.user_id and expert_card_activation_gate_valid(gate_binding.user_id,gate_binding.review_id) and expert_campaign_current_profile_valid(gate_binding.user_id,o.campaign_quote_id) and st.schedule_id is not distinct from (select latest.id from expert_offer_schedules latest where latest.user_id=st.user_id order by latest.created_at desc,latest.id desc limit 1)) then 'ready' else 'pending_gates' end as readiness,case when o.status='payment_pending' and o.payment_deadline>clock_timestamp() and exists(select 1 from expert_card_main_orders gate_binding where gate_binding.order_id=o.id and gate_binding.user_id=st.user_id and expert_card_activation_gate_valid(gate_binding.user_id,gate_binding.review_id) and expert_campaign_current_profile_valid(gate_binding.user_id,o.campaign_quote_id) and st.schedule_id is not distinct from (select latest.id from expert_offer_schedules latest where latest.user_id=st.user_id order by latest.created_at desc,latest.id desc limit 1)) then st.payment_url end as payment_url from expert_personal_offer_state st join expert_campaign_quotes q on q.id=st.quote_id left join expert_offer_schedules s on s.id=st.schedule_id left join expert_residency_orders o on o.id=st.order_id where st.user_id=${userId}::uuid and q.expires_at>clock_timestamp() and ${this.eligible(userId)}`,
        )
      ).rows[0];
      return row
        ? {
            ...row,
            offer_start_date: iso(row.offer_start_date),
            payment_link_expires_at: iso(row.payment_link_expires_at),
          }
        : null;
    });
  }
  async readPromoIdentity(scope: {
    botId: string;
    botKey: string;
    telegramUserId: string;
    chatId: string;
  }): Promise<PersonalOfferProjection | null> {
    if (
      scope.botId !== this.policy.promoBotId ||
      scope.botKey !== this.policy.promoBotKey
    )
      return null;
    return this.read(scope);
  }
  async readOwned(
    userId: string,
    expertId: string,
  ): Promise<PersonalOfferProjection | null> {
    if (
      !/^[0-9a-f-]{36}$/iu.test(userId) ||
      !/^[0-9a-f-]{36}$/iu.test(expertId)
    )
      return null;
    return this.db.transaction(async (tx) => {
      await lockClientConsentSubject(tx, userId);
      const owned = (
        await tx.execute<{ id: string }>(
          sql`select e.id from experts e join users u on u.id=e.user_id and u.active where e.id=${expertId}::uuid and e.user_id=${userId}::uuid for share of e,u`,
        )
      ).rows[0];
      if (!owned) return null;
      const paidSales = await this.readPaidSales(tx, userId);
      if (paidSales) return paidSales;
      await this.refreshOwnedQuote(tx, userId);
      const row = (
        await tx.execute<
          PersonalOfferProjection & {
            offer_start_date: string | Date;
            payment_link_expires_at: string | Date;
          }
        >(
          sql`select q.calculation_timestamp as offer_start_date,case q.energy_discount_bps when 4000 then 1 when 3000 then 2 when 2000 then 3 else 4 end as current_discount_stage,q.energy_discount_bps/100 as discount_percent,q.monthly_price_minor::text as locked_price_monthly,case when clock_timestamp()<q.calculation_timestamp+interval '168 hours' then q.package_price_minor::text end as locked_price_package,case when st.payment_url is not null and o.status='payment_pending' and o.payment_deadline>clock_timestamp() then least(q.expires_at,o.payment_deadline) else q.expires_at end as payment_link_expires_at,greatest(0,floor(extract(epoch from q.expires_at-clock_timestamp())))::integer as remaining_seconds,case when s.term_months=3 and clock_timestamp()>=q.calculation_timestamp+interval '168 hours' then 'select_one_month' when st.payment_url is not null and o.status='payment_pending' and o.payment_deadline>clock_timestamp() and exists(select 1 from expert_card_main_orders gate_binding where gate_binding.order_id=o.id and gate_binding.user_id=st.user_id and expert_card_activation_gate_valid(gate_binding.user_id,gate_binding.review_id) and expert_campaign_current_profile_valid(gate_binding.user_id,o.campaign_quote_id) and st.schedule_id is not distinct from (select latest.id from expert_offer_schedules latest where latest.user_id=st.user_id order by latest.created_at desc,latest.id desc limit 1)) then 'ready' else 'pending_gates' end as readiness,case when o.status='payment_pending' and o.payment_deadline>clock_timestamp() and exists(select 1 from expert_card_main_orders gate_binding where gate_binding.order_id=o.id and gate_binding.user_id=st.user_id and expert_card_activation_gate_valid(gate_binding.user_id,gate_binding.review_id) and expert_campaign_current_profile_valid(gate_binding.user_id,o.campaign_quote_id) and st.schedule_id is not distinct from (select latest.id from expert_offer_schedules latest where latest.user_id=st.user_id order by latest.created_at desc,latest.id desc limit 1)) then st.payment_url end as payment_url from expert_personal_offer_state st join expert_campaign_quotes q on q.id=st.quote_id left join expert_offer_schedules s on s.id=st.schedule_id left join expert_residency_orders o on o.id=st.order_id where st.user_id=${userId}::uuid and q.expires_at>clock_timestamp() and ${this.eligible(userId)}`,
        )
      ).rows[0];
      return row
        ? {
            ...row,
            offer_start_date: iso(row.offer_start_date),
            payment_link_expires_at: iso(row.payment_link_expires_at),
          }
        : null;
    });
  }
  async listDueNotices(
    rawLimit = 10,
  ): Promise<readonly { noticeId: string }[]> {
    const limit = limitOf(rawLimit);
    return (
      await this.db.execute<{ noticeId: string }>(
        sql`select id as "noticeId" from expert_personal_offer_notices where status='pending' and attempt_id is null and stage_deadline>clock_timestamp() order by created_at,id limit ${limit}`,
      )
    ).rows;
  }
  async deliverNotice(
    noticeId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<{
    kind: "delivered" | "cancelled" | "unknown_outcome" | "unavailable";
  }> {
    if (!this.policy.noticeTransport || options.signal?.aborted)
      return { kind: "unavailable" };
    const claimed = await this.db.transaction(async (tx) => {
      const n = (
        await tx.execute<{
          userId: string;
          quoteId: string;
          leadHours: number;
          status: string;
        }>(
          sql`select user_id as "userId",quote_id as "quoteId",lead_hours as "leadHours",status from expert_personal_offer_notices where id=${noticeId}::uuid`,
        )
      ).rows[0];
      if (!n) return null;
      await lockClientConsentSubject(tx, n.userId);
      const current = (
        await tx.execute<{
          messagingPolicyVersion: string;
          botId: string;
          botKey: string;
          chatId: string;
          url: string | null;
          monthlyMinor: string;
          packageMinor: string | null;
          expiresAt: string | Date;
          discountPercent: number;
        }>(
          sql`select case when ci.bot_key=${this.policy.promoBotKey ?? null} then ${this.policy.promoConsentPolicyVersion ?? this.policy.messagingConsentPolicyVersion} else ${this.policy.messagingConsentPolicyVersion} end as "messagingPolicyVersion",case when ci.bot_key=${this.policy.promoBotKey ?? null} then ${this.policy.promoBotId ?? null} else ${this.policy.workBotId} end as "botId",ci.bot_key as "botKey",ci.external_chat_id as "chatId",q.monthly_price_minor::text as "monthlyMinor",q.package_price_minor::text as "packageMinor",case when st.payment_url is not null and o.status='payment_pending' and o.payment_deadline>clock_timestamp() then least(q.expires_at,o.payment_deadline) else q.expires_at end as "expiresAt",q.energy_discount_bps/100 as "discountPercent",case when o.status='payment_pending' and o.payment_deadline>clock_timestamp() and exists(select 1 from expert_card_main_orders gate_binding where gate_binding.order_id=o.id and gate_binding.user_id=st.user_id and expert_card_activation_gate_valid(gate_binding.user_id,gate_binding.review_id) and expert_campaign_current_profile_valid(gate_binding.user_id,o.campaign_quote_id) and st.schedule_id is not distinct from (select latest.id from expert_offer_schedules latest where latest.user_id=st.user_id order by latest.created_at desc,latest.id desc limit 1)) then st.payment_url end as url from expert_personal_offer_notices n join expert_personal_offer_state st on st.user_id=n.user_id join expert_campaign_quotes q on q.id=st.quote_id join lateral(select ci.* from channel_identities ci where ci.user_id=n.user_id and ci.provider='telegram' and ci.status='active' and ci.external_id=ci.external_chat_id and (ci.bot_key=${this.policy.workBotKey} or (ci.bot_key=${this.policy.promoBotKey ?? null} and exists(select 1 from expert_promo_enrollments en where en.user_id=n.user_id and en.channel_identity_id=ci.id and en.bot_id=${this.policy.promoBotId ?? null} and en.status='granted'))) order by case when ci.bot_key=${this.policy.promoBotKey ?? null} then 0 else 1 end,ci.id limit 1) ci on true left join expert_residency_orders o on o.id=st.order_id where n.id=${noticeId}::uuid and n.status='pending' and n.attempt_id is null and n.stage_deadline>clock_timestamp() and q.expires_at>clock_timestamp() and q.profile_revision=(select max(revision) from expert_offer_profiles where user_id=st.user_id) and exists(select 1 from expert_residency_tariff_versions current_tariff where current_tariff.id=q.tariff_version_id and current_tariff.active_from<=clock_timestamp() and current_tariff.active_to>clock_timestamp()) and ${this.eligible(n.userId)} and (n.lead_hours<>0 or n.quote_id=st.quote_id) and (n.lead_hours<>24 or n.stage_deadline-clock_timestamp()>interval '3 hours') for update of n`,
        )
      ).rows;
      if (current.length !== 1 || (n.leadHours === 0 && !current[0]!.url)) {
        await tx.execute(
          sql`update expert_personal_offer_notices set status='cancelled' where id=${noticeId}::uuid and status='pending'`,
        );
        return null;
      }
      const target = current[0]!;
      if (
        !(await captureClientConsentAuthority(tx, {
          subjectId: n.userId,
          botKey: target.botKey,
          chatId: target.chatId,
          externalUserId: target.chatId,
          messagingPolicyVersion: target.messagingPolicyVersion,
        }))
      )
        return null;
      const prices = `Месяц: ${rubles(target.monthlyMinor)}; пакет 3 месяца: ${target.packageMinor === null ? "недоступен" : rubles(target.packageMinor)}. Действует до ${iso(target.expiresAt)}.`;
      const text =
        n.leadHours === 0
          ? `${target.discountPercent === 0 ? "Платёжная ссылка обновлена в рамках срока действия тарифа." : "Актуальное предложение обновлено по персональному графику скидки."} ${prices} Оплатить: ${target.url}`
          : `До изменения персонального тарифа осталось не более ${n.leadHours} ч. ${prices} Мой актуальный тариф: /my_tariff.${target.url ? " Оплатить: " + target.url : " Основная оплата ожидает завершения проверок."}`;

      const payload = { text, assets: [] };
      const payloadDigest =
        "sha256:" +
        createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      const attemptId = randomUUID();
      await tx.execute(
        sql`update expert_personal_offer_notices set status='unknown_outcome',attempt_id=${attemptId}::uuid,attempted_at=clock_timestamp() where id=${noticeId}::uuid and status='pending'`,
      );
      return { ...n, ...target, payload, payloadDigest, attemptId };
    });
    if (!claimed) return { kind: "cancelled" };
    try {
      return await this.db.transaction(async (tx) => {
        await lockClientConsentSubject(tx, claimed.userId);
        const current = (
          await tx.execute<{ ok: boolean }>(
            sql`select n.stage_deadline>clock_timestamp() and q.expires_at>clock_timestamp() and q.profile_revision=(select max(revision) from expert_offer_profiles where user_id=st.user_id) and exists(select 1 from expert_residency_tariff_versions current_tariff where current_tariff.id=q.tariff_version_id and current_tariff.active_from<=clock_timestamp() and current_tariff.active_to>clock_timestamp()) and ${this.eligible(claimed.userId)} and (n.lead_hours<>0 or n.quote_id=st.quote_id and st.payment_url=${claimed.url} and exists(select 1 from expert_residency_orders o where o.id=st.order_id and o.status='payment_pending' and o.payment_deadline>clock_timestamp() and exists(select 1 from expert_card_main_orders gate_binding where gate_binding.order_id=o.id and gate_binding.user_id=st.user_id and expert_card_activation_gate_valid(gate_binding.user_id,gate_binding.review_id) and expert_campaign_current_profile_valid(gate_binding.user_id,o.campaign_quote_id) and st.schedule_id is not distinct from (select latest.id from expert_offer_schedules latest where latest.user_id=st.user_id order by latest.created_at desc,latest.id desc limit 1)))) and (n.lead_hours<>24 or n.stage_deadline-clock_timestamp()>interval '3 hours') as ok from expert_personal_offer_notices n join expert_personal_offer_state st on st.user_id=n.user_id join expert_campaign_quotes q on q.id=st.quote_id where n.id=${noticeId}::uuid and n.attempt_id=${claimed.attemptId}::uuid and n.status='unknown_outcome' for update of n`,
          )
        ).rows[0];
        if (
          current?.ok !== true ||
          options.signal?.aborted ||
          !(await captureClientConsentAuthority(tx, {
            subjectId: claimed.userId,
            botKey: claimed.botKey,
            chatId: claimed.chatId,
            externalUserId: claimed.chatId,
            messagingPolicyVersion: claimed.messagingPolicyVersion,
          }))
        )
          return { kind: "unknown_outcome" as const };
        const contentVersion = "personal-offer.v2";
        const receipt = await this.policy.noticeTransport!.send({
          botId: claimed.botId,
          botKey: claimed.botKey,
          userId: claimed.userId,
          chatId: claimed.chatId,
          reviewId: noticeId,
          revision: 1,
          contentVersion,
          payloadDigest: claimed.payloadDigest,
          payload: claimed.payload,
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)])
            : AbortSignal.timeout(8000),
        });
        if (
          receipt.botId !== claimed.botId ||
          receipt.chatId !== claimed.chatId ||
          receipt.contentVersion !== contentVersion ||
          receipt.payloadDigest !== claimed.payloadDigest ||
          receipt.messageIds.length !== 1 ||
          !/^[1-9]\d{0,19}$/u.test(receipt.messageIds[0]!)
        )
          return { kind: "unknown_outcome" as const };
        await tx.execute(
          sql`update expert_personal_offer_notices set status='delivered',receipt=${JSON.stringify(receipt)}::jsonb where id=${noticeId}::uuid and attempt_id=${claimed.attemptId}::uuid`,
        );
        return { kind: "delivered" as const };
      });
    } catch {
      return { kind: "unknown_outcome" };
    }
  }
}
