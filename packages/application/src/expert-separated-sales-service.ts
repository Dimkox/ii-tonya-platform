import { createHash } from "node:crypto";
import type { ResidentFormInput } from "./resident-verification-service.js";
import type {
  ExpertApplicantReply,
  ExpertApplicantScope,
} from "./expert-applicant-service.js";
export interface SeparatedSalesSnapshot {
  id: string;
  revision: number;
  baseMonthlyMinor: string;
  firstOfferAt: string;
  state: "qualification" | "base" | "promotion" | "period" | "form" | "locked";
  promotion: boolean | null;
  monthlyPriceMinor: string | null;
  packagePriceMinor: string | null;
  selectedTotalMinor: string | null;
  termMonths: 1 | 3 | null;
  expiresAt: string | null;
  remainingSeconds?: number;
  invoiceId?: string;
  operationId?: string;
  submitted?: boolean;
  standardOnly: boolean;
  replay: boolean;
  tariffs?: { id: string; name: string }[];
}
export interface SeparatedSalesRepository {
  transition(
    input: ExpertApplicantScope & {
      requestKey: string;
      requestDigest: string;
      tariffVersionId?: string;
      action?: "positive" | "promo" | "base" | "month" | "quarter";
      baseId?: string;
      revision?: number;
    },
  ): Promise<SeparatedSalesSnapshot | null>;
}
const rub = (value: string) =>
  `${BigInt(value) / 100n}${BigInt(value) % 100n ? "," + (BigInt(value) % 100n).toString().padStart(2, "0") : ""} ₽`;
export function createExpertSeparatedSalesService(deps: {
  repository: SeparatedSalesRepository;
  captureReceipt?: (
    input: Parameters<SeparatedSalesRepository["transition"]>[0] & {
      email: string;
    },
  ) => Promise<unknown>;
  checkout?: {
    recoverCheckout(input: {
      invoiceId: string;
      operationId: string;
    }): Promise<
      | { kind: "ready"; url: string; paymentId: string }
      | { kind: "pending" | "unavailable" }
    >;
  };
  form: {
    handle(input: ResidentFormInput): Promise<ExpertApplicantReply | null>;
  };
}) {
  return {
    async handle(
      input: ResidentFormInput,
    ): Promise<ExpertApplicantReply | null> {
      if (/^\/(?:profile|consent)(?: |$)/u.test(input.text)) return null;
      const tariff = /^sb:([0-9a-f-]{36})$/u.exec(input.callbackData ?? "");
      const choice =
        /^ss:([0-9a-f-]{36}):(\d{1,6}):(positive|promo|base|month|quarter)$/u.exec(
          input.callbackData ?? "",
        );
      if (
        input.callbackData &&
        !tariff &&
        !choice &&
        !input.callbackData.startsWith("rv:") &&
        input.callbackData !== "st:current"
      )
        return { status: "rejected" };
      const command = {
        ...input,
        requestKey: `${input.botId}:${input.updateId}`,
        requestDigest: createHash("sha256")
          .update(
            JSON.stringify({
              text: input.text,
              callback: input.callbackData,
              media: input.media,
            }),
          )
          .digest("hex"),
        ...(tariff ? { tariffVersionId: tariff[1]! } : {}),
        ...(choice
          ? {
              baseId: choice[1]!,
              revision: Number(choice[2]),
              action: choice[3] as
                "positive" | "promo" | "base" | "month" | "quarter",
            }
          : {}),
      };
      const snapshot = await deps.repository.transition(command);
      if (!snapshot) return null;
      if (snapshot.replay) return { status: "duplicate" };
      const button = (text: string, action: string) => ({
        text,
        callback_data: `ss:${snapshot.id}:${snapshot.revision}:${action}`,
      });
      const reply = (
        text: string,
        buttons: { text: string; callback_data: string }[][] = [],
      ): ExpertApplicantReply => ({
        status: "handled",
        text,
        replyMarkup: buttons.length
          ? { inline_keyboard: buttons }
          : { remove_keyboard: true },
      });
      if (snapshot.state === "qualification")
        return reply(
          "Для расчёта базовой цены укажите город, формат работы и средний чек: /profile CITY 0 offline 300000 expert. Затем выберите категорию.",
          (snapshot.tariffs ?? []).map((t) => [
            { text: t.name, callback_data: `sb:${t.id}` },
          ]),
        );
      if (snapshot.state === "base")
        return reply(
          `Ваш персональный базовый тариф — ${rub(snapshot.baseMonthlyMinor)} в месяц. Он включает размещение и автоматизацию записей. Как вам такие условия? Вопросы по стоимости можно обсудить до выбора.`,
          [[button("Условия подходят", "positive")]],
        );
      if (snapshot.state === "locked")
        return reply(
          `Оплата онбординга подтверждена. Постоянная стоимость выбранного периода: ${rub(snapshot.selectedTotalMinor!)} за ${snapshot.termMonths} мес. Основная оплата и полный доступ — отдельные этапы.`,
        );
      if (snapshot.state === "promotion")
        return snapshot.standardOnly
          ? reply(
              `Период акции завершён. Базовый тариф — ${rub(snapshot.baseMonthlyMinor)} в месяц.`,
              [[button("Выбрать базовый тариф", "base")]],
            )
          : reply(
              `Отдельное предложение «Энергия начала»: ${rub(snapshot.monthlyPriceMinor!)} в месяц. Действует до ${snapshot.expiresAt}. Выбор условий не является оплатой.`,
              [
                [button("Выбрать акцию", "promo")],
                [button("Оставить базовую цену", "base")],
              ],
            );
      if (snapshot.state === "period")
        return reply(
          "Выберите период будущего основного платежа. После анкеты и решения менеджера отдельно выставляется взнос за онбординг 3000 ₽.",
          [
            [button(`1 месяц — ${rub(snapshot.monthlyPriceMinor!)}`, "month")],
            ...(snapshot.promotion && snapshot.packagePriceMinor
              ? [
                  [
                    button(
                      `3 месяца — ${rub(snapshot.packagePriceMinor)}`,
                      "quarter",
                    ),
                  ],
                ]
              : []),
          ],
        );
      if (/^\/receipt(?: |$)/u.test(input.text)) {
        if (!snapshot.submitted)
          return reply("Сначала отправьте анкету: /verification.");
        const email = /^\/receipt ([^\s]+)$/u.exec(input.text)?.[1];
        if (!email || !deps.captureReceipt)
          return reply(
            "Для электронного чека нужен email: /receipt адрес. Сохранение адреса сейчас недоступно либо адрес не указан.",
          );
        try {
          await deps.captureReceipt({ ...command, email });
          return reply(
            "Адрес для чека сохранён. Мой актуальный тариф: /my_tariff.",
            [[{ text: "Мой актуальный тариф", callback_data: "st:current" }]],
          );
        } catch {
          return reply(
            "Адрес для чека не сохранён. Проверьте адрес и повторите /receipt.",
          );
        }
      }
      if (
        input.text === "/my_tariff" ||
        input.text === "Мой актуальный тариф" ||
        input.callbackData === "st:current"
      ) {
        let text = `Актуальные условия: ${rub(snapshot.selectedTotalMinor!)} за ${snapshot.termMonths} мес. Срок: ${snapshot.expiresAt}; осталось ${snapshot.remainingSeconds ?? 0} с. Постоянная цена фиксируется подтверждённой оплатой онбординга в срок.`;
        if (snapshot.invoiceId && snapshot.operationId && deps.checkout) {
          try {
            const payment = await deps.checkout.recoverCheckout({
              invoiceId: snapshot.invoiceId,
              operationId: snapshot.operationId,
            });
            const current = await deps.repository.transition(command);
            if (
              payment.kind === "ready" &&
              current?.invoiceId === snapshot.invoiceId &&
              (current.remainingSeconds ?? 0) > 0
            )
              text += ` Отдельный взнос за онбординг 3000 ₽: ${payment.url}`;
            else text += " Ссылка на оплату пока недоступна.";
          } catch {
            text +=
              " Для подготовки оплаты укажите адрес чека: /receipt адрес.";
          }
        } else text += " Счёт за онбординг появится после одобрения менеджера.";
        return reply(text, [
          [{ text: "Мой актуальный тариф", callback_data: "st:current" }],
        ]);
      }
      if (choice) {
        const next = { ...input, text: "/verification" };
        delete next.callbackData;
        return deps.form.handle(next);
      }
      return deps.form.handle(input);
    },
  };
}
