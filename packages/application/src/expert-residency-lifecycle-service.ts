import type {
  ResidencyLifecycle,
  ResidencyOwnerEvent,
  ResidencyOwnerScope,
  ResidencyLifecycleRepository,
} from "@ii-tonya/contracts";
import type {
  ExpertCardService,
  ExpertCardReply,
  ExpertCardMainCheckout,
  ExpertCardMainCheckoutBinding,
} from "./expert-card-service.js";
export type RenewalOwnerFrame = ResidencyOwnerEvent & {
  revision: number;
  renewalBillId: string;
  renewalAcceptedQuoteId?: string;
};
export interface RenewalInvoice {
  orderId: string;
  quoteId: string;
  revision: number;
  priceMinor: string;
  cashMinor: string;
  currency: "RUB";
  status: string;
  paymentDeadline: string;
  replay: boolean;
}
export interface ExpertResidencyRenewalFinancial {
  quoteMain(
    input: RenewalOwnerFrame & { tariffVersionId: string; termMonths: 1 | 3 },
  ): Promise<{
    id: string;
    priceMinor: string;
    termMonths: 1 | 3;
    expiresAt: string;
    revision: number;
    replay: boolean;
  }>;
  acceptRenewalAndCreateInvoice(
    input: RenewalOwnerFrame & { quoteId: string },
  ): Promise<RenewalInvoice>;
  createMainInvoice(input: RenewalOwnerFrame): Promise<RenewalInvoice>;
  checkoutBindingForOwner(
    input: RenewalOwnerFrame,
    orderId: string,
  ): Promise<ExpertCardMainCheckoutBinding>;
  verifyMainCheckoutForOwner(
    input: RenewalOwnerFrame,
    orderId: string,
    paymentId: string,
  ): Promise<boolean>;
}
export const isExpertResidencyLifecycleCommand = (text: string) =>
  /^\/(?:residency|renewal|renewal_quote|renewal_accept|renewal_invoice|pause|resume)(?:\s|$)/u.test(
    text.trim(),
  );
const uuid =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const quoteCommand = new RegExp(`^/renewal_quote (${uuid}) (1|3)$`, "u"),
  acceptCommand = new RegExp(`^/renewal_accept (${uuid})$`, "u");
const civilDate = (value: string) => {
  if (!/^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const summary = (s: ResidencyLifecycle) =>
  `Статус резидентства: ${s.status === "active" ? "активно" : s.status === "paused" ? "на паузе" : "требуется оплата"}. Оплаченный срок: ${s.paidUntil ?? "нет действующего периода"}.${s.pausedUntil ? ` Дата возврата: ${s.pausedUntil}.` : ""}`;
const reply = (text: string): ExpertCardReply => ({ status: "handled", text });
export function createExpertResidencyLifecycleService(deps: {
  enabled: boolean;
  workBotId: string;
  workBotKey: string;
  paymentMode: "test" | "live";
  repository: Pick<
    ResidencyLifecycleRepository,
    "readLifecycle" | "requestPause" | "resume"
  >;
  financial: ExpertResidencyRenewalFinancial;
  mainCheckout?: ExpertCardMainCheckout;
}) {
  async function invoiceReply(
    frame: RenewalOwnerFrame,
    result: RenewalInvoice,
  ): Promise<ExpertCardReply> {
    if (result.replay) return { status: "duplicate" };
    const pending = (
      status: "waiting_configuration" | "pending" | "unavailable",
    ): ExpertCardReply => ({
      status: "handled",
      text: `Счёт продления ${result.orderId}: ${result.cashMinor} коп.; срок ${result.paymentDeadline}. ${status === "waiting_configuration" ? "Платёжное подключение пока не настроено." : "Платёжная ссылка уточняется; счёт сохранён."}`,
      payment: { status, orderId: result.orderId },
    });
    if (deps.mainCheckout?.strictFirstSendCancellation !== true)
      return pending("waiting_configuration");
    try {
      const binding = Object.freeze({
        ...(await deps.financial.checkoutBindingForOwner(
          frame,
          result.orderId,
        )),
      });
      if (
        binding.orderId !== result.orderId ||
        binding.purpose !== "main_residency" ||
        binding.amountMinor !== result.cashMinor ||
        binding.currency !== result.currency ||
        binding.providerMode !== deps.paymentMode
      )
        return pending("unavailable");
      const payment = await deps.mainCheckout.createOrRecover(binding);
      if (payment.kind !== "ready")
        return pending(payment.kind === "pending" ? "pending" : "unavailable");
      const url = new URL(payment.url);
      if (
        payment.orderId !== result.orderId ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(payment.paymentId) ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(
          url.hostname,
        )
      )
        return pending("unavailable");
      if (
        (await deps.financial.verifyMainCheckoutForOwner(
          frame,
          result.orderId,
          payment.paymentId,
        )) !== true
      )
        return pending("unavailable");
      return {
        status: "handled",
        text: `Счёт продления ${result.orderId}: ${result.cashMinor} коп. Оплатить: ${url.toString()}`,
        payment: {
          status: "ready",
          orderId: result.orderId,
          paymentId: payment.paymentId,
          url: url.toString(),
        },
      };
    } catch {
      return pending("unavailable");
    }
  }
  return {
    async handleWork(
      input: Parameters<ExpertCardService["handleWork"]>[0],
    ): Promise<ExpertCardReply> {
      if (!deps.enabled) return { status: "disabled" };
      if (input.content?.kind !== "text") return { status: "unhandled" };
      if (typeof input.content.text !== "string") return { status: "rejected" };
      if (!isExpertResidencyLifecycleCommand(input.content.text))
        return { status: "unhandled" };
      const text = input.content.text.trim();
      if (
        input.botId !== deps.workBotId ||
        input.botKey !== deps.workBotKey ||
        !/^[1-9][0-9]{0,19}$/u.test(input.telegramUserId) ||
        input.chatId !== input.telegramUserId ||
        !/^(0|[1-9][0-9]{0,15})$/u.test(input.updateId) ||
        !Number.isSafeInteger(Number(input.updateId)) ||
        !/^[0-9a-f]{64}$/u.test(input.requestDigest) ||
        text.length > 256
      )
        return { status: "rejected" };
      const scope: ResidencyOwnerScope = {
        botId: input.botId,
        botKey: input.botKey,
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
      };
      const event: ResidencyOwnerEvent = {
        ...scope,
        requestKey: `${scope.botId}:${input.updateId}`,
        requestDigest: input.requestDigest,
      };
      try {
        if (text.startsWith("/pause")) {
          const match = /^\/pause ([0-9]{4}-[0-9]{2}-[0-9]{2})$/u.exec(text);
          if (!match || !civilDate(match[1]!)) return { status: "rejected" };
          const result = await deps.repository.requestPause({
            ...event,
            returnDate: match[1]!,
          });
          return result.replay
            ? { status: "duplicate" }
            : reply(
                `${summary(result)} Пауза не продлевает оплаченный календарный срок.`,
              );
        }
        if (text === "/resume") {
          const result = await deps.repository.resume(event);
          return result.replay
            ? { status: "duplicate" }
            : reply(summary(result));
        }
        const current = await deps.repository.readLifecycle(scope);
        if (!current) return { status: "unavailable" };
        if (text === "/residency")
          return reply(
            `${summary(current)} /renewal — продление; /pause YYYY-MM-DD — пауза; /resume — проверить возврат.`,
          );
        const bill = current.bill;
        if (!bill)
          return reply(
            "Счёт продления пока не подготовлен. Текущий оплаченный календарный срок сохраняется без изменений.",
          );
        if (bill.readiness !== "ready")
          return reply(
            "Для нового автоматического продления требуется завершённая и утверждённая карточка эксперта и реальный онбординг. Карточка и оплаченный календарный срок не создаются и не продлеваются этой командой.",
          );
        if (text === "/renewal")
          return reply(
            `${summary(current)} Счёт продления ${bill.id}.${bill.quote ? ` Предложение ${bill.quote.id}: ${bill.quote.priceMinor} коп., ${bill.quote.termMonths} мес.; действует до ${bill.quote.expiresAt}. Принять: /renewal_accept ${bill.quote.id}.` : " Требуется новый явный выбор срока."} Новый расчёт: /renewal_quote ${bill.tariffVersionId} 1 или /renewal_quote ${bill.tariffVersionId} 3.${bill.orderId ? " Получить сохранённый счёт: /renewal_invoice." : ""}`,
          );
        const frame: RenewalOwnerFrame = Object.freeze({
          ...event,
          revision: current.revision,
          renewalBillId: bill.id,
        });
        const quote = quoteCommand.exec(text);
        if (quote) {
          try {
            const result = await deps.financial.quoteMain({
              ...frame,
              tariffVersionId: quote[1]!,
              termMonths: Number(quote[2]) as 1 | 3,
            });
            return result.replay
              ? { status: "duplicate" }
              : reply(
                  `Предложение продления ${result.id}: ${result.priceMinor} коп., ${result.termMonths} мес.; действует до ${result.expiresAt}. Принять: /renewal_accept ${result.id}`,
                );
          } catch (error) {
            if (
              error instanceof Error &&
              ("code" in error ? error.code : error.message) ===
                "card_main_term_unavailable"
            )
              return reply(
                `Выбранный срок недоступен. Выберите другой срок явно: /renewal_quote ${quote[1]} 1`,
              );
            throw error;
          }
        }
        const accept = acceptCommand.exec(text);
        if (accept) {
          const result = await deps.financial.acceptRenewalAndCreateInvoice({
            ...frame,
            quoteId: accept[1]!,
          });
          return invoiceReply(
            { ...frame, renewalAcceptedQuoteId: accept[1]! },
            result,
          );
        }
        if (text === "/renewal_invoice")
          return invoiceReply(
            frame,
            await deps.financial.createMainInvoice(frame),
          );
        return { status: "rejected" };
      } catch (error) {
        const code =
          error instanceof Error
            ? "code" in error
              ? error.code
              : error.message
            : undefined;
        if (code === "residency_invalid_return_date")
          return reply(
            "Выберите будущую дату возврата в пределах трёх календарных месяцев. Пауза не продлевает оплаченный срок.",
          );
        if (code === "card_main_quote_expired_or_unavailable")
          return reply(
            "Предложение истекло или недоступно. Откройте /renewal и явно запросите новый расчёт перед принятием.",
          );
        return { status: "unavailable" };
      }
    },
  };
}
export type ExpertResidencyLifecycleService = ReturnType<
  typeof createExpertResidencyLifecycleService
>;
