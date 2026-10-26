import { issueSeparatedSalesFeeAttempt } from "./expert-separated-sales-repository.js";
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
    for (const candidate of ids)
      await this.db.transaction(async (tx) => {
        await lockClientConsentSubject(tx, candidate.userId);
        const b = (
          await tx.execute<{
            amount: string;
            first: string;
            kind: "expert" | "space";
            positive: boolean;
            consent: string;
          }>(
            sql`select base_tariff_amount::text amount,base_offer_shown_at::text first,participant_kind kind,consent_version consent,exists(select 1 from expert_sales_choices where base_id=b.id and action='positive') positive from expert_sales_bases b where id=${candidate.id}::uuid and consent_version is not null and not exists(select 1 from expert_sales_paid_locks where user_id=b.user_id)`,
          )
        ).rows[0];
        if (!b) return;
        const tick = (
          await tx.execute(
            sql`insert into expert_sales_ticks(base_id,checked_at) values(${candidate.id}::uuid,clock_timestamp()) on conflict(base_id) do update set checked_at=excluded.checked_at where expert_sales_ticks.checked_at<=clock_timestamp()-interval '15 minutes' returning base_id`,
          )
        ).rows.length;
        if (!tick) return;
        const now = Number(
          (
            await tx.execute<{ ms: string }>(
              sql`select floor(extract(epoch from clock_timestamp())*1000)::text ms`,
            )
          ).rows[0]!.ms,
        );
        if (!b.positive) return; // Silence never becomes promotional disclosure or an invoice.
        const selected = (
          await tx.execute<{
            id: string;
            choiceId: string;
            promo: boolean;
            term: 1 | 3;
            expiry: string;
          }>(
            sql`select id,choice_id as "choiceId",promo_accepted_flag promo,term_months term,offer_expiry_date::text expiry from expert_sales_selections where base_id=${candidate.id}::uuid order by selected_at desc,id desc limit 1`,
          )
        ).rows[0];
        const terms = calculateSeparatedSalesTerms({
          baseMonthlyMinor: BigInt(b.amount),
          participantKind: b.kind,
          firstOfferAtMs: Date.parse(b.first),
          quotedAtMs: now,
          promotion: selected?.promo ?? true,
          termMonths: 1,
        });
        const checkoutExpired =
          (
            await tx.execute(
              sql`select 1 from expert_onboarding_invoices i join expert_sales_fee_attempts a on a.invoice_id=i.id where i.user_id=${candidate.userId}::uuid and a.expires_at<=clock_timestamp() and i.sales_attempt_number=(select max(sales_attempt_number) from expert_onboarding_invoices where user_id=i.user_id) and not exists(select 1 from expert_sales_provider_requests r join expert_onboarding_invoices prior on prior.id=r.invoice_id where prior.user_id=i.user_id and r.status='dispatched')`,
            )
          ).rows.length > 0;
        if (
          selected &&
          (Date.parse(selected.expiry) <= now || checkoutExpired)
        ) {
          await tx.execute(
            sql`update expert_onboarding_invoices i set status='cancelled' from expert_sales_fee_attempts a where a.invoice_id=i.id and a.user_id=${candidate.userId}::uuid and a.expires_at<=clock_timestamp() and i.status='pending'`,
          );
          const quarterGone =
            selected.term === 3 && terms.packagePriceMinor === null;
          await tx.execute(
            sql`insert into expert_sales_notices(base_id,stage_at,kind) values(${candidate.id}::uuid,${new Date(Math.min(Date.parse(selected.expiry), now)).toISOString()}::timestamptz,${quarterGone ? "reselect" : "refresh"}) on conflict do nothing`,
          );
          if (!quarterGone) {
            await tx.execute<{ id: string; expiry: string }>(
              sql`insert into expert_sales_selections(base_id,user_id,choice_id,promo_accepted_flag,term_months,monthly_price_minor,package_price_minor,selected_total_minor,energy_discount_bps,package_discount_bps,offer_expiry_date) values(${candidate.id}::uuid,${candidate.userId}::uuid,${selected.choiceId}::uuid,${selected.promo},${selected.term},${terms.monthlyPriceMinor.toString()}::bigint,${terms.packagePriceMinor?.toString() ?? null}::bigint,${(selected.term === 1 ? terms.monthlyPriceMinor : terms.packagePriceMinor!).toString()}::bigint,${terms.energyDiscountBps},${terms.packageDiscountBps},${new Date(terms.nextStageAtMs ?? now + 86400000).toISOString()}::timestamptz) returning id,offer_expiry_date::text expiry`,
            );
            await issueSeparatedSalesFeeAttempt(tx, candidate.userId);
          }
        }
        if (terms.nextStageAtMs) {
          const left = terms.nextStageAtMs - now;
          const kind =
            left <= 3 * 3600000 ? "3h" : left <= 24 * 3600000 ? "24h" : null;
          if (kind)
            await tx.execute(
              sql`insert into expert_sales_notices(base_id,stage_at,kind) values(${candidate.id}::uuid,${new Date(terms.nextStageAtMs).toISOString()}::timestamptz,${kind}) on conflict do nothing`,
            );
        }
      });
    return { examined: ids.length };
  }
  async deliver(signal: AbortSignal) {
    if (!this.transport) return { delivered: 0 };
    const rows = (
      await this.db.execute<{ id: string; userId: string }>(
        sql`select n.id,b.user_id as "userId" from expert_sales_notices n join expert_sales_bases b on b.id=n.base_id where n.status='pending' order by n.created_at limit 10`,
      )
    ).rows;
    let delivered = 0;
    for (const row of rows) {
      const attempt = randomUUID();
      const claimed = (
        await this.db.execute(
          sql`update expert_sales_notices set status='dispatched',attempt_id=${attempt}::uuid where id=${row.id}::uuid and status='pending' returning id`,
        )
      ).rows.length;
      if (!claimed) continue;
      try {
        const invoice = (
          await this.db.execute<{ id: string; operationId: string }>(
            sql`select i.id,o.id as "operationId" from expert_onboarding_invoices i join expert_sales_fee_attempts a on a.invoice_id=i.id join expert_onboarding_payment_operations o on o.invoice_id=i.id where i.user_id=${row.userId}::uuid and i.status='pending' and a.expires_at>clock_timestamp() order by i.sales_attempt_number desc limit 1`,
          )
        ).rows[0];
        const payment =
          invoice && this.checkout
            ? await this.checkout.recoverCheckout({
                invoiceId: invoice.id,
                operationId: invoice.operationId,
              })
            : null;
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
            }>(
              sql`select b.bot_id as "botId",b.bot_key as "botKey",b.chat_id as "chatId",b.consent_version consent,n.kind,b.base_tariff_amount::text amount,(b.consent_version is not null and not exists(select 1 from expert_sales_paid_locks where user_id=b.user_id) and exists(select 1 from expert_sales_choices where base_id=b.id and action='positive') and (n.kind in('refresh','reselect') or (n.stage_at>clock_timestamp() and (n.kind<>'24h' or n.stage_at>clock_timestamp()+interval '3 hours')))) current from expert_sales_notices n join expert_sales_bases b on b.id=n.base_id where n.id=${row.id}::uuid and n.attempt_id=${attempt}::uuid and n.status='dispatched' for update of n`,
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
          let text =
            n.kind === "reselect"
              ? "Пакет 3 месяца больше недоступен. Для продолжения выберите новый период: /my_tariff. Старый счёт не даёт права на прежнюю цену."
              : n.kind === "refresh"
                ? "Срок предложения изменился. Актуальные выбранные условия: /my_tariff. Не оплачивайте старую ссылку: её локальный срок истёк."
                : `До изменения предложения осталось не более ${n.kind === "3h" ? "3" : "24"} ч. Проверьте актуальный тариф: /my_tariff. Постоянные условия фиксируются только после подтверждённой оплаты онбординга в срок.`;
          if (
            payment?.kind === "ready" &&
            invoice &&
            (
              await tx.execute(
                sql`select 1 from expert_onboarding_invoices i join expert_sales_fee_attempts a on a.invoice_id=i.id where i.id=${invoice.id}::uuid and i.user_id=${row.userId}::uuid and i.status='pending' and a.expires_at>clock_timestamp() and i.sales_attempt_number=(select max(sales_attempt_number) from expert_onboarding_invoices where user_id=i.user_id)`,
              )
            ).rows.length
          )
            text += ` Новый счёт за онбординг 3000 ₽: ${payment.url}`;
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
            throw new Error("sales_notice_receipt_invalid");
          await tx.execute(
            sql`update expert_sales_notices set status='delivered',receipt=${JSON.stringify(receipt)}::jsonb where id=${row.id}::uuid and attempt_id=${attempt}::uuid`,
          );
          delivered++;
        });
      } catch {
        /* Persisted dispatched means unknown delivery; never blind resend. */
      }
    }
    return { delivered };
  }
}
