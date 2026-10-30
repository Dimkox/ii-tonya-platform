import type {
  ExpertApplicantReply,
  ResidentFormInput,
} from "@ii-tonya/application";
import {
  earlyBirdChoiceButtons,
  earlyBirdPositiveButton,
  parseEarlyBirdPositive,
  earlyBirdTermsMessage,
  parseEarlyBirdChoice,
} from "./routes/early-bird-message.js";

type WaveCommand = ResidentFormInput & {
  offerId: string;
  revision: number;
  expectedGrantId: string | null;
};
type WaveChoice = ResidentFormInput & {
  offerId: string;
  revision: number;
  choice: "now" | "later" | "subscription";
};
type WaveOffer = {
  id: string;
  revision: number;
  name: string;
  clientStart: string;
  discountEligible: boolean;
};
export type WaveInvoice = {
  kind: "invoice";
  purpose: "combined" | "onboarding" | "subscription";
  url: string;
  totalMinor: string;
  onboardingMinor: string;
  subscriptionMinor: string;
  clientStart: string;
};
/** Database authority must validate ownership, current offer revision, choice and idempotency. */
export interface EarlyBirdSalesAuthority {
  quote?(input: ResidentFormInput & { tariffVersionId: string }): Promise<{
    id: string;
    revision: number;
    monthlyMinor: string;
    onboardingMinor: string;
    grantId: string | null;
  } | null>;
  present(command: WaveCommand): Promise<WaveOffer | null>;
  captureReceipt?(
    input: ResidentFormInput,
    email: string,
  ): Promise<boolean | WaveInvoice>;
  /** Must verify the caller's current scoped wave form admission in PostgreSQL. */
  formEligible?(input: ResidentFormInput): Promise<boolean>;
  legacyEligible?(input: ResidentFormInput): Promise<boolean>;
  formContinuationEligible?(input: ResidentFormInput): Promise<boolean>;
  current?(input: ResidentFormInput): Promise<{
    id: string;
    revision: number;
    status:
      | "ONBOARDING_ONLY"
      | "FULLY_PREPAID_WITH_DISCOUNT"
      | "FULLY_PREPAID_NO_DISCOUNT";
    baseMonthlyMinor: string;
    lockedMonthlyMinor?: string;
    clientStart?: string;
    effectiveStart?: string;
    residentStatus?: "ACTIVE_PAID_WAITING_START" | "ACTIVE";
  } | null>;
  choose(
    command: WaveChoice,
  ): Promise<WaveInvoice | { kind: "pending" } | { kind: "form" } | null>;
}
const minor = /^(?:0|[1-9]\d{0,11})$/u;
function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
const rub = (value: string) =>
  `${BigInt(value) / 100n}${BigInt(value) % 100n ? `,${(BigInt(value) % 100n).toString().padStart(2, "0")}` : ""} ₽`;
export function createExpertEarlyBirdService(
  authority: EarlyBirdSalesAuthority,
  options: {
    phase?: "WAVE_1_EARLY_BIRD" | "PUBLIC_LAUNCH";
    enrollmentStartMs?: number;
    clientStartMs: number;
    now: () => number;
  } = {
    phase: "PUBLIC_LAUNCH",
    enrollmentStartMs: Date.parse("2026-11-01T00:00:00+03:00"),
    clientStartMs: Date.parse("2027-01-11T00:00:00+03:00"),
    now: () => Date.now(),
  },
) {
  const enrollmentStartMs =
    options.enrollmentStartMs ?? Date.parse("2026-11-01T00:00:00+03:00");
  if (
    !Number.isSafeInteger(options.clientStartMs) ||
    !Number.isSafeInteger(enrollmentStartMs) ||
    enrollmentStartMs >= options.clientStartMs ||
    (options.phase !== undefined &&
      options.phase !== "WAVE_1_EARLY_BIRD" &&
      options.phase !== "PUBLIC_LAUNCH")
  )
    throw new Error("early_bird_invalid_start");
  const isActive = (): boolean => {
    const now = options.now();
    if (!Number.isSafeInteger(now)) throw new Error("early_bird_invalid_clock");
    return (
      options.phase === "WAVE_1_EARLY_BIRD" &&
      now >= enrollmentStartMs &&
      now < options.clientStartMs
    );
  };
  return {
    isActive,
    async continueForm(input: ResidentFormInput): Promise<boolean> {
      return (await authority.formContinuationEligible?.(input)) === true;
    },
    async handle(
      input: ResidentFormInput,
    ): Promise<
      | ExpertApplicantReply
      | { status: "wave_form"; start: boolean }
      | { status: "wave_legacy" }
      | null
    > {
      const callback = input.callbackData ?? "";
      const active = isActive();
      const isCurrent =
        input.text === "/my_tariff" ||
        input.text === "Мой актуальный тариф" ||
        callback === "st:current";
      if (!active && !isCurrent)
        return /^(?:eb|ep):/u.test(callback) ? { status: "rejected" } : null;
      if (!/^(?:eb|ep):/u.test(callback)) {
        try {
          if ((await authority.legacyEligible?.(input)) === true)
            return { status: "wave_legacy" };
        } catch {
          return { status: "unavailable" };
        }
      }
      if (input.text === "/start") return null;
      if (
        input.text === "/my_tariff" ||
        input.text === "Мой актуальный тариф" ||
        callback === "st:current"
      ) {
        try {
          const state = await authority.current?.(input);
          if (!state) return active ? { status: "unavailable" } : null;
          if (
            state.status === "FULLY_PREPAID_WITH_DISCOUNT" ||
            state.status === "FULLY_PREPAID_NO_DISCOUNT"
          ) {
            if (
              !state.lockedMonthlyMinor ||
              !minor.test(state.lockedMonthlyMinor) ||
              BigInt(state.lockedMonthlyMinor) <= 0n ||
              !state.clientStart ||
              Date.parse(state.clientStart) !== options.clientStartMs
            )
              return { status: "unavailable" };
            const effectiveStartMs = state.effectiveStart
              ? Date.parse(state.effectiveStart)
              : options.clientStartMs;
            if (
              !Number.isFinite(effectiveStartMs) ||
              effectiveStartMs < options.clientStartMs
            )
              return { status: "unavailable" };
            const date = new Intl.DateTimeFormat("ru-RU", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Europe/Moscow",
            })
              .format(new Date(effectiveStartMs))
              .replace(/\s*г\.$/u, " года");
            return {
              status: "handled",
              text:
                state.residentStatus === "ACTIVE"
                  ? `Тариф оплачен: ${rub(state.lockedMonthlyMinor)} в месяц. Вы — активный резидент. Оплаченный период начался ${date}.`
                  : `Тариф оплачен: ${rub(state.lockedMonthlyMinor)} в месяц. Вы — активный резидент в ожидании старта. Оплаченный период начинается ${date}.`,
              replyMarkup: { remove_keyboard: true },
            };
          }
          if (!active) return null;
          if (
            state.status !== "ONBOARDING_ONLY" ||
            !minor.test(state.baseMonthlyMinor) ||
            BigInt(state.baseMonthlyMinor) <= 0n
          )
            return { status: "unavailable" };
          // Reuse the strict callback validation, including Telegram length constraints.
          earlyBirdChoiceButtons(state.id, state.revision, false);
          const data = `eb:${state.id}:${state.revision}:subscription`;
          if (!parseEarlyBirdChoice(data)) return { status: "unavailable" };
          return {
            status: "handled",
            text: `Онбординг оплачен. Тариф по базовой цене: ${rub(state.baseMonthlyMinor)} в месяц.`,
            replyMarkup: {
              inline_keyboard: [
                [{ text: "Оплатить тариф", callback_data: data }],
              ],
            },
          };
        } catch {
          return { status: "unavailable" };
        }
      }
      const tariff =
        /^sb:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.exec(
          callback,
        );
      if (tariff && authority.quote) {
        try {
          const quote = await authority.quote({
            ...input,
            tariffVersionId: tariff[1]!,
          });
          if (
            !quote ||
            !minor.test(quote.monthlyMinor) ||
            !minor.test(quote.onboardingMinor) ||
            BigInt(quote.monthlyMinor) <= 0n ||
            BigInt(quote.onboardingMinor) <= 0n ||
            !Number.isSafeInteger(quote.revision) ||
            quote.revision < 0 ||
            quote.revision >= 999999 ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
              quote.id,
            )
          )
            return { status: "unavailable" };
          return {
            status: "handled",
            text: `Ваш персональный базовый тариф — ${rub(quote.monthlyMinor)} в месяц. Онбординг — ${rub(quote.onboardingMinor)}. Как вам такие условия?`,
            replyMarkup: {
              inline_keyboard: [
                [
                  earlyBirdPositiveButton(
                    quote.id,
                    quote.revision,
                    quote.grantId,
                  ),
                ],
              ],
            },
          };
        } catch {
          return { status: "unavailable" };
        }
      }
      const first = parseEarlyBirdPositive(callback);
      const choice = parseEarlyBirdChoice(callback);
      if (!first && !choice) {
        if (/^\/receipt(?: |$)/u.test(input.text)) {
          if (!authority.captureReceipt) return null;
          const email = /^\/receipt ([^\s]+)$/u.exec(input.text)?.[1];
          if (!email)
            return {
              status: "handled",
              text: "Для электронного чека укажите адрес: /receipt адрес.",
              replyMarkup: { remove_keyboard: true },
            };
          try {
            const captured = await authority.captureReceipt(
              { ...input, text: "" },
              email,
            );
            if (typeof captured === "object" && captured !== null) {
              if (
                captured.kind !== "invoice" ||
                !minor.test(captured.totalMinor) ||
                !minor.test(captured.onboardingMinor) ||
                !minor.test(captured.subscriptionMinor) ||
                !validUrl(captured.url) ||
                Date.parse(captured.clientStart) !== options.clientStartMs
              )
                return { status: "unavailable" };
              const total = BigInt(captured.totalMinor),
                onboarding = BigInt(captured.onboardingMinor),
                subscription = BigInt(captured.subscriptionMinor);
              if (
                total !== onboarding + subscription ||
                total <= 0n ||
                (captured.purpose === "combined" &&
                  (onboarding <= 0n || subscription <= 0n)) ||
                (captured.purpose === "onboarding" &&
                  (onboarding <= 0n || subscription !== 0n)) ||
                (captured.purpose === "subscription" &&
                  (onboarding !== 0n || subscription <= 0n)) ||
                !["combined", "onboarding", "subscription"].includes(
                  captured.purpose,
                )
              )
                return { status: "unavailable" };
              const text =
                captured.purpose === "combined"
                  ? `Единый счёт: онбординг ${rub(captured.onboardingMinor)} + тариф ${rub(captured.subscriptionMinor)} = ${rub(captured.totalMinor)}. Оплаченный период тарифа начинается 11 января 2027 года. ${captured.url}`
                  : captured.purpose === "onboarding"
                    ? `Счёт за онбординг: ${rub(captured.totalMinor)}. Тариф оплачивается отдельно по базовой цене до старта. ${captured.url}`
                    : `Счёт за тариф по базовой цене: ${rub(captured.totalMinor)}. Оплаченный период тарифа начинается 11 января 2027 года. ${captured.url}`;
              return {
                status: "handled",
                text,
                replyMarkup: { remove_keyboard: true },
              };
            }
            return {
              status: "handled",
              text: captured
                ? "Адрес для чека сохранён. Счёт готовится."
                : "Адрес для чека не сохранён. Попробуйте позже.",
              replyMarkup: { remove_keyboard: true },
            };
          } catch {
            return {
              status: "handled",
              text: "Адрес для чека не сохранён. Попробуйте позже.",
              replyMarkup: { remove_keyboard: true },
            };
          }
        }
        if (/^(?:eb|ep):/u.test(callback)) return { status: "rejected" };
        try {
          return (await authority.formEligible?.(input)) === true
            ? { status: "wave_form", start: false }
            : null;
        } catch {
          return { status: "unavailable" };
        }
      }
      try {
        if (first) {
          const offerId = first.offerId;
          const revision = first.revision;
          if (revision >= 999999) return { status: "rejected" };
          const offer = await authority.present({
            ...input,
            offerId,
            revision,
            expectedGrantId: first.grantId,
          });
          if (!offer || offer.id !== offerId || offer.revision !== revision + 1)
            return { status: "rejected" };
          const date = new Date(offer.clientStart);
          if (date.getTime() !== options.clientStartMs)
            return { status: "unavailable" };
          return {
            status: "handled",
            text: earlyBirdTermsMessage(
              offer.name,
              date,
              offer.discountEligible,
            ),
            replyMarkup: {
              inline_keyboard: earlyBirdChoiceButtons(
                offer.id,
                offer.revision,
                offer.discountEligible,
              ),
            },
          };
        }
        const invoice = await authority.choose({
          ...input,
          offerId: choice!.offerId,
          revision: choice!.revision,
          choice: choice!.choice,
        });
        if (!invoice) return { status: "rejected" };
        if (invoice.kind === "form")
          return { status: "wave_form", start: true };
        if (invoice.kind === "pending")
          return {
            status: "handled",
            text: "Счёт готовится. Если ещё не указали адрес электронного чека, отправьте /receipt адрес. Затем повторите выбор оплаты.",
            replyMarkup: { remove_keyboard: true },
          };
        if (
          !minor.test(invoice.totalMinor) ||
          !minor.test(invoice.onboardingMinor) ||
          !minor.test(invoice.subscriptionMinor) ||
          !validUrl(invoice.url) ||
          Date.parse(invoice.clientStart) !== options.clientStartMs
        )
          return { status: "unavailable" };
        const onboarding = BigInt(invoice.onboardingMinor),
          subscription = BigInt(invoice.subscriptionMinor),
          total = BigInt(invoice.totalMinor);
        if (
          total !== onboarding + subscription ||
          (choice!.choice === "now" &&
            (invoice.purpose !== "combined" ||
              onboarding <= 0n ||
              subscription <= 0n)) ||
          (choice!.choice === "later" &&
            (invoice.purpose !== "onboarding" ||
              onboarding <= 0n ||
              subscription !== 0n)) ||
          (choice!.choice === "subscription" &&
            (invoice.purpose !== "subscription" ||
              onboarding !== 0n ||
              subscription <= 0n))
        )
          return { status: "unavailable" };
        const date = new Intl.DateTimeFormat("ru-RU", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Europe/Moscow",
        })
          .format(new Date(invoice.clientStart))
          .replace(/\s*г\.$/u, " года");
        return {
          status: "handled",
          text:
            choice!.choice === "now"
              ? `Единый счёт: онбординг ${rub(invoice.onboardingMinor)} + тариф ${rub(invoice.subscriptionMinor)} = ${rub(invoice.totalMinor)}. Оплаченный период тарифа начинается ${date}. ${invoice.url}`
              : choice!.choice === "later"
                ? `Счёт за онбординг: ${rub(invoice.totalMinor)}. Тариф оплачивается отдельно по базовой цене до старта. ${invoice.url}`
                : `Счёт за тариф по базовой цене: ${rub(invoice.totalMinor)}. Оплаченный период тарифа начинается ${date}. ${invoice.url}`,
          replyMarkup: { remove_keyboard: true },
        };
      } catch (error) {
        if (
          first &&
          error instanceof Error &&
          error.message === "early_bird_price_changed"
        )
          return {
            status: "handled",
            text: "Цена изменилась. Пожалуйста, повторите расчёт и подтвердите новые условия.",
            replyMarkup: { remove_keyboard: true },
          };
        return { status: "unavailable" };
      }
    },
  };
}
