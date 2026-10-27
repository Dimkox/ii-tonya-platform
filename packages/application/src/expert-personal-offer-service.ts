import type {
  ExpertCardMainCheckout,
  ExpertCardMainCheckoutBinding,
} from "./expert-card-service.js";
export interface PersonalOfferView {
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
export function formatPersonalOfferMoney(minor: string): string {
  if (!/^[0-9]+$/u.test(minor)) throw new Error("personal_offer_money_invalid");
  const amount = BigInt(minor);
  const rubles = (amount / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
  const kopecks = amount % 100n;
  return `${rubles}${kopecks === 0n ? "" : "," + kopecks.toString().padStart(2, "0")} ₽`;
}
export function renderPersonalOffer(view: PersonalOfferView): string {
  if (view.selected_locked_total && view.selected_locked_term)
    return `Мой актуальный тариф. Постоянная стоимость выбранного периода: ${formatPersonalOfferMoney(view.selected_locked_total)} за ${view.selected_locked_term} мес. Эти условия сохраняются для первого основного платежа и продлений. Основная оплата и доступ зависят от подтверждения карточки, промо и отдельного платежа.`;
  return `Мой актуальный тариф. Месяц: ${formatPersonalOfferMoney(view.locked_price_monthly)}; пакет 3 месяца: ${view.locked_price_package === null ? "недоступен" : formatPersonalOfferMoney(view.locked_price_package)}. Первое предложение: ${view.offer_start_date}. Скидка: ${view.discount_percent}%. Осталось: ${Math.max(0, view.remaining_seconds)} сек.; срок ссылки: ${view.payment_link_expires_at}. ${view.readiness === "select_one_month" ? "Пакет истёк. Выберите один месяц явно." : view.readiness === "ready" && view.payment_url ? "Оплатить: " + view.payment_url : "Основная оплата станет доступна после подтверждения онбординга, промо и карточки."}`;
}
export interface ScheduledOfferFinancial {
  createScheduledMainInvoice(
    scheduleId: string,
    quoteId: string,
  ): Promise<{
    orderId: string;
    cashMinor: string;
    currency: "RUB";
    status: string;
  }>;
  checkoutBindingForSchedule(
    scheduleId: string,
    orderId: string,
  ): Promise<ExpertCardMainCheckoutBinding>;
  verifyMainCheckoutForSchedule(
    scheduleId: string,
    orderId: string,
    paymentId: string,
  ): Promise<boolean>;
}
/** Orchestration never creates acceptances, clocks or automatic debits. */
export function createExpertPersonalOfferRunner(deps: {
  enabled: boolean;
  repository: {
    refreshDue(
      limit: number,
    ): Promise<readonly { scheduleId: string; quoteId: string }[]>;
    recordLink(input: {
      scheduleId: string;
      quoteId: string;
      orderId: string;
      paymentId: string;
      url: string;
    }): Promise<boolean>;
  };
  financial?: ScheduledOfferFinancial;
  mainCheckout?: ExpertCardMainCheckout;
  batchSize?: number;
}) {
  const limit = deps.batchSize ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error("personal_offer_batch_invalid");
  let accepting = true,
    active = false;
  return {
    async runOnce() {
      if (!deps.enabled || !accepting)
        return {
          refreshed: 0,
          links: 0,
          reason: accepting ? "disabled" : "closing",
        };
      if (active) throw new Error("personal_offer_cycle_busy");
      active = true;
      try {
        const due = await deps.repository.refreshDue(limit);
        if (!Array.isArray(due) || due.length > limit)
          throw new Error("personal_offer_batch_invalid");
        let links = 0;
        for (const row of due) {
          if (!accepting) break;
          if (
            !deps.financial ||
            deps.mainCheckout?.strictFirstSendCancellation !== true
          )
            continue;
          try {
            const order = await deps.financial.createScheduledMainInvoice(
              row.scheduleId,
              row.quoteId,
            );
            if (order.status !== "payment_pending") continue;
            const binding = await deps.financial.checkoutBindingForSchedule(
              row.scheduleId,
              order.orderId,
            );
            if (
              binding.orderId !== order.orderId ||
              binding.purpose !== "main_residency" ||
              binding.amountMinor !== order.cashMinor ||
              binding.currency !== order.currency
            )
              continue;
            const payment = await deps.mainCheckout.createOrRecover(binding);
            if (payment.kind !== "ready" || payment.orderId !== order.orderId)
              continue;
            if (
              !(await deps.financial.verifyMainCheckoutForSchedule(
                row.scheduleId,
                order.orderId,
                payment.paymentId,
              ))
            )
              continue;
            if (
              await deps.repository.recordLink({
                ...row,
                orderId: order.orderId,
                paymentId: payment.paymentId,
                url: payment.url,
              })
            )
              links++;
          } catch {
            /* Gate or provider unavailable: retain current offer and retry safely. */
          }
        }
        return { refreshed: due.length, links };
      } finally {
        active = false;
      }
    },
    stopAccepting() {
      accepting = false;
    },
  };
}
