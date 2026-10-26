import {
  refreshSeparatedSalesSelection,
  hasUnresolvedSalesRequest,
  queueSalesNotice,
  cancelSupersededSalesNotices,
} from "./expert-separated-sales-repository.js";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { calculateSeparatedSalesTerms } from "@ii-tonya/domain";
import type { DrizzleDb } from "../client.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";
export interface SalesNoticeTransport {
  send(input: {
    botId: string;
    botKey: string;
    chatId: string;
    text: string;
    digest: string;
    signal: AbortSignal;
  }): Promise<{
    botId: string;
    chatId: string;
    messageId: string;
    digest: string;
  }>;
}
const rub = (minor: string) => `${Number(BigInt(minor)) / 100} ₽`;
export class PostgresExpertSalesScheduler {
  constructor(
    private readonly db: DrizzleDb,
    private readonly transport?: SalesNoticeTransport,
    private readonly checkout?: {
      recoverCheckout(input: {
        invoiceId: string;
        operationId: string;
      }): Promise<
        | { kind: "ready"; url: string; paymentId: string }
        | { kind: "pending" | "unavailable" }
      >;
    },
  ) {}
  async refresh(limit = 20) {
    const ids = (
      await this.db.execute<{ id: string; userId: string }>(
        sql`select b.id,b.user_id as "userId" from expert_sales_bases b left join expert_sales_ticks t on t.base_id=b.id where b.consent_version is not null and not exists(select 1 from expert_sales_paid_locks where user_id=b.user_id) and (t.checked_at is null or t.checked_at<=clock_timestamp()-interval '15 minutes') order by b.base_offer_shown_at limit ${Math.min(50, Math.max(1, limit))}`,
      )
    ).rows;
    let failed = 0;
    for (const candidate of ids) {
      try {
        await this.db.transaction(async (tx) => {
          await lockClientConsentSubject(tx, candidate.userId);
          const b = (
            await tx.execute<{
              amount: string;
              first: string;
              kind: "expert" | "space";
              positive: boolean;
            }>(
              sql`select base_tariff_amount::text amount,base_offer_shown_at::text first,participant_kind kind,exists(select 1 from expert_sales_choices where base_id=b.id and action='positive') positive from expert_sales_bases b where id=${candidate.id}::uuid and consent_version is not null and not exists(select 1 from expert_sales_paid_locks where user_id=b.user_id)`,
            )
          ).rows[0];
          if (!b) return;
          if (
            !(
              await tx.execute(
                sql`insert into expert_sales_ticks(base_id,checked_at) values(${candidate.id}::uuid,clock_timestamp()) on conflict(base_id) do update set checked_at=excluded.checked_at where expert_sales_ticks.checked_at<=clock_timestamp()-interval '15 minutes' returning base_id`,
              )
            ).rows.length
          )
            return;
          if (
            !b.positive ||
            (await hasUnresolvedSalesRequest(tx, candidate.userId))
          )
            return;
          const expired =
            (
              await tx.execute(
                sql`select 1 from expert_sales_fee_attempts a join expert_onboarding_invoices i on i.id=a.invoice_id where i.user_id=${candidate.userId}::uuid and a.expires_at<=clock_timestamp() and i.sales_attempt_number=(select max(sales_attempt_number) from expert_onboarding_invoices where user_id=i.user_id)`,
              )
            ).rows.length > 0;
          await refreshSeparatedSalesSelection(tx, candidate.userId, expired);
          await cancelSupersededSalesNotices(tx, candidate.userId);
          const selected = (
            await tx.execute<{ id: string; promo: boolean }>(
              sql`select id,promo_accepted_flag promo from expert_sales_selections where base_id=${candidate.id}::uuid order by selected_at desc,id desc limit 1`,
            )
          ).rows[0];
          if (selected && !selected.promo) return;
          const now = Number(
            (
              await tx.execute<{ ms: string }>(
                sql`select floor(extract(epoch from clock_timestamp())*1000)::text ms`,
              )
            ).rows[0]!.ms,
          );
          const terms = calculateSeparatedSalesTerms({
            baseMonthlyMinor: BigInt(b.amount),
            participantKind: b.kind,
            firstOfferAtMs: Date.parse(b.first),
            quotedAtMs: now,
            promotion: true,
            termMonths: 1,
          });
          if (terms.nextStageAtMs) {
            const left = terms.nextStageAtMs - now,
              kind = left <= 10800000 ? "3h" : left <= 86400000 ? "24h" : null;
            if (kind)
              await queueSalesNotice(
                tx,
                candidate.userId,
                kind,
                selected?.id ?? null,
                new Date(terms.nextStageAtMs).toISOString(),
              );
          }
        });
      } catch {
        failed++;
      }
    }
    return { examined: ids.length, failed };
  }
  async deliver(signal: AbortSignal) {
    if (!this.transport) return { delivered: 0 };
    const rows = (
      await this.db.execute<{ id: string; userId: string }>(
        sql`select n.id,b.user_id as "userId" from expert_sales_notices n join expert_sales_bases b on b.id=n.base_id where n.status='pending' or (n.status='preparing' and n.prepared_until<=clock_timestamp()) order by n.created_at limit 10`,
      )
    ).rows;
    let delivered = 0;
    for (const row of rows) {
      const attempt = randomUUID();
      if (
        !(
          await this.db.execute(
            sql`update expert_sales_notices set status='preparing',attempt_id=${attempt}::uuid,prepared_until=clock_timestamp()+interval '60 seconds' where id=${row.id}::uuid and (status='pending' or (status='preparing' and prepared_until<=clock_timestamp())) returning id`,
          )
        ).rows.length
      )
        continue;
      let dispatched = false;
      try {
        const invoice = (
          await this.db.execute<{ id: string; operationId: string }>(
            sql`select i.id,o.id as "operationId" from expert_onboarding_invoices i join expert_sales_fee_attempts a on a.invoice_id=i.id join expert_onboarding_payment_operations o on o.invoice_id=i.id join expert_sales_notices n on n.id=${row.id}::uuid where i.user_id=${row.userId}::uuid and i.status='pending' and a.expires_at>clock_timestamp() and (n.invoice_id is null or n.invoice_id=i.id) order by i.sales_attempt_number desc limit 1`,
          )
        ).rows[0];
        const payment =
          invoice && this.checkout
            ? await this.checkout.recoverCheckout({
                invoiceId: invoice.id,
                operationId: invoice.operationId,
              })
            : null;
        // Preparation has not sent Telegram bytes. Only this committed marker makes delivery uncertain.
        if (
          !(
            await this.db.execute(
              sql`update expert_sales_notices set status='dispatched',prepared_until=null where id=${row.id}::uuid and attempt_id=${attempt}::uuid and status='preparing' and prepared_until>clock_timestamp() returning id`,
            )
          ).rows.length
        )
          continue;
        dispatched = true;
        await this.db.transaction(async (tx) => {
          await lockClientConsentSubject(tx, row.userId);
          const n = (
            await tx.execute<{
              botId: string;
              botKey: string;
              chatId: string;
              consent: string;
              kind: string;
              current: boolean;
              amount: string;
              first: string;
              participant: "expert" | "space";
              total: string | null;
              term: 1 | 3 | null;
              promo: boolean | null;
              stage: string;
              now: string;
            }>(
              sql`select b.bot_id as "botId",b.bot_key as "botKey",b.chat_id as "chatId",b.consent_version consent,n.kind,b.base_tariff_amount::text amount,b.base_offer_shown_at::text first,b.participant_kind participant,s.selected_total_minor::text total,s.term_months term,s.promo_accepted_flag promo,n.stage_at::text stage,floor(extract(epoch from clock_timestamp())*1000)::text now,(b.consent_version is not null and not exists(select 1 from expert_sales_paid_locks where user_id=b.user_id) and exists(select 1 from expert_sales_choices where base_id=b.id and action='positive') and n.choice_revision=(select max(revision) from expert_sales_choices where base_id=b.id) and n.selection_id is not distinct from (select id from expert_sales_selections where base_id=b.id order by selected_at desc,id desc limit 1) and (n.kind in('refresh','reselect') or (n.stage_at>clock_timestamp() and (n.kind<>'24h' or n.stage_at>clock_timestamp()+interval '3 hours')))) current from expert_sales_notices n join expert_sales_bases b on b.id=n.base_id left join expert_sales_selections s on s.id=n.selection_id where n.id=${row.id}::uuid and n.attempt_id=${attempt}::uuid and n.status='dispatched' for update of n`,
            )
          ).rows[0];
          if (
            !n?.current ||
            signal.aborted ||
            !(await captureClientConsentAuthority(tx, {
              subjectId: row.userId,
              botKey: n.botKey,
              chatId: n.chatId,
              externalUserId: n.chatId,
              messagingPolicyVersion: n.consent,
            }))
          ) {
            await tx.execute(
              sql`update expert_sales_notices set status='cancelled' where id=${row.id}::uuid`,
            );
            return;
          }
          const terms = (at: number) =>
            calculateSeparatedSalesTerms({
              baseMonthlyMinor: BigInt(n.amount),
              participantKind: n.participant,
              firstOfferAtMs: Date.parse(n.first),
              quotedAtMs: at,
              promotion: n.promo !== false,
              termMonths: 1,
            });
          const current = terms(Number(n.now)),
            next = terms(Date.parse(n.stage));
          const currentTotal =
            n.term === 3
              ? current.packagePriceMinor
              : current.monthlyPriceMinor;
          const nextTotal =
            n.term === 3 ? next.packagePriceMinor : next.monthlyPriceMinor;
          let text =
            n.kind === "reselect"
              ? `Пакет 3 месяца больше недоступен. Новый выбор периода: /my_tariff. Актуальный месяц — ${rub(current.monthlyPriceMinor.toString())}.`
              : `Актуальный основной платёж — ${rub((currentTotal ?? current.monthlyPriceMinor).toString())} за ${n.term ?? 1} мес. Срок: ${new Date(n.stage).toISOString()}; осталось ${Math.max(0, Math.floor((Date.parse(n.stage) - Number(n.now)) / 1000))} с.`;
          if (n.kind === "24h" || n.kind === "3h")
            text +=
              nextTotal === null
                ? " После этого срока пакет 3 месяца недоступен; нужен новый выбор периода."
                : ` После этого срока — ${rub(nextTotal.toString())} за ${n.term ?? 1} мес.`;
          text +=
            " Постоянная цена фиксируется подтверждённой оплатой онбординга в срок. Мой актуальный тариф: /my_tariff.";
          if (
            payment?.kind === "ready" &&
            invoice &&
            (
              await tx.execute(
                sql`select 1 from expert_onboarding_invoices i join expert_sales_fee_attempts a on a.invoice_id=i.id where i.id=${invoice.id}::uuid and i.user_id=${row.userId}::uuid and i.status='pending' and a.expires_at>clock_timestamp() and expert_sales_form_valid(i.application_id,i.user_id) and i.sales_attempt_number=(select max(sales_attempt_number) from expert_onboarding_invoices where user_id=i.user_id)`,
              )
            ).rows.length
          )
            text += ` Отдельный взнос за онбординг 3000 ₽: ${payment.url}`;
          const digest = `sha256:${createHash("sha256").update(text).digest("hex")}`;
          const receipt = await this.transport!.send({
            botId: n.botId,
            botKey: n.botKey,
            chatId: n.chatId,
            text,
            digest,
            signal,
          });
          if (
            receipt.botId !== n.botId ||
            receipt.chatId !== n.chatId ||
            receipt.digest !== digest ||
            !/^[1-9][0-9]{0,19}$/u.test(receipt.messageId)
          )
            throw Error("sales_notice_receipt_invalid");
          await tx.execute(
            sql`update expert_sales_notices set status='delivered',receipt=${JSON.stringify(receipt)}::jsonb where id=${row.id}::uuid and attempt_id=${attempt}::uuid`,
          );
          delivered++;
        });
      } catch {
        if (!dispatched)
          await this.db.execute(
            sql`update expert_sales_notices set status='pending',prepared_until=null where id=${row.id}::uuid and attempt_id=${attempt}::uuid and status='preparing'`,
          );
      }
    }
    return { delivered };
  }
}
