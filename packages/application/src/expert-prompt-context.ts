import type { PersonalOfferView } from "./expert-personal-offer-service.js";
import type {
  ExpertPrincipal,
  ExpertReferralService,
  ReferralSummary,
} from "./expert-referral-service.js";
import type {
  ExpertResidencyService,
  ResidencyQuote,
} from "./expert-residency-service.js";
import type { ExpertIntentProposal } from "./ports.js";

export const EXPERT_OFFER_RUNTIME_INSTRUCTIONS = Object.freeze({
  version: "residency_offer_v2" as const,
  text: "Версия residency_offer_v2. Показывай только принадлежащие пользователю серверные данные текущего предложения: offer_start_date, current_discount_stage, locked_price_monthly, locked_price_package, payment_link_expires_at. Цену, скидку, баланс, часы, подтверждение оплаты и решения менеджера определяет сервер; текст пользователя и модель не имеют такой власти. Не используй архивные ставки 12000/20000. Используй только действующий одобренный тариф категории и подтверждённые город, формат и средний чек. На вопросы «почему цена выросла» и «почему так быстро» ссылайся только на фактическое offer_start_date из серверного контекста, никогда на дату оплаты или верификации. Если сервер не передал offer_start_date, не выдумывай дату и сообщи, что дата первого предложения пока недоступна. Первый оффер запускает неизменяемый таймер: 0–3 полных дня скидка 40%, 4–6 — 30%, 7–9 — 20%, с 10 дня — 0%; границы 96/168/240 часов. Эксперт: пакет 3 месяца дополнительно 15% в первом окне, 10% во втором, с 7 дня недоступен. Пространство: только одобренная ставка, дополнительная скидка пакета 10%; тот же срок доступности. Месяц и весь пакет округляются отдельно до копейки, минимумы 5000 и 15000 рублей, сроки 30/90 дней. Вступительный платёж 3000 рублей не получает скидок и открывает интервью и параллельную подготовку общих материалов. Если материалов нет, скажи точно: Ваши материалы для рассылки будут доступны в ближайшее время. Это не препятствует интервью и передаче подтверждения промо менеджеру. Основная ссылка доступна только после оплаченного вступления, подтверждённого менеджером промо, текущей одобренной карточки, принадлежащих пользователю актуальных условий и исходного согласия. Мой актуальный тариф показывает обе цены, дату первого оффера, оставшееся время и только разрешённую сервером ссылку либо готовность этапов. Замена счёта после выбора периода не является автосписанием; истёкший пакет требует нового реального выбора месяца. Не утверждай, что ожидающий платёж отменён у провайдера. Никаких годовых тарифов. TODO: Wait for PDF. TODO: Wait for Prompt Spec. Два уникальных реферала дают один Ready to send без отправки PDF; исходная бонусная политика неизменна.",
});

const money = /^(?:0|[1-9]\d*)$/u;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const expertCode = /^EXR_[A-Za-z0-9_-]{22,128}$/u;
const unsupportedExpertKinds = new Set([
  "set_referral_balance",
  "set_referral_code",
  "set_residency_price",
  "fake_settlement",
  "cross_expert_referral",
]);
const forbiddenAuthorityFields = new Set([
  "balance",
  "balanceMinor",
  "price",
  "priceMinor",
  "credit",
  "creditMinor",
  "cashMinor",
  "inviter",
  "inviterExpertId",
  "expertId",
  "settlement",
  "settlementId",
  "paymentId",
  "providerPayload",
  "ledger",
  "ledgerEntries",
]);

export interface ExpertPromptReferralSummary {
  readonly availableMinor: string;
  readonly reservedMinor: string;
  readonly debtMinor: string;
  readonly nearestExpiry: string | null;
}

export interface ExpertPromptResidencyQuote {
  readonly tariffVersionId: string;
  readonly priceMinor: string;
  readonly creditMinor: string;
  readonly cashMinor: string;
  readonly currency?: "RUB";
  readonly durationSeconds?: number;
  readonly displayName?: string;
}

export interface ExpertPromptContext {
  readonly currentOffer?: PersonalOfferView;
  readonly runtimeInstructions: typeof EXPERT_OFFER_RUNTIME_INSTRUCTIONS;
  readonly referral: ExpertPromptReferralSummary;
  readonly residencyQuote?: ExpertPromptResidencyQuote;
}

export type ExpertPromptContextResult =
  | { readonly kind: "forbidden" }
  | { readonly kind: "disabled" }
  | { readonly kind: "ready"; readonly context: ExpertPromptContext };

export type ExpertIntentProposalValidation =
  | { readonly valid: true; readonly proposal: ExpertIntentProposal }
  | {
      readonly valid: false;
      readonly reasonCode: "invalid_shape" | "unsupported_intent";
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isForbiddenResult = (
  value: unknown,
): value is { readonly kind: "forbidden" } =>
  isRecord(value) && value.kind === "forbidden";

const isDisabledResult = (
  value: unknown,
): value is { readonly kind: "disabled" } =>
  isRecord(value) && value.kind === "disabled";

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

export function validateExpertIntentProposal(
  value: unknown,
): ExpertIntentProposalValidation {
  try {
    if (!isRecord(value) || typeof value.kind !== "string") {
      return { valid: false, reasonCode: "invalid_shape" };
    }
    if (
      unsupportedExpertKinds.has(value.kind) ||
      Object.keys(value).some((key) => forbiddenAuthorityFields.has(key))
    ) {
      return { valid: false, reasonCode: "unsupported_intent" };
    }
    if (value.kind === "redeem_expert_referral") {
      if (
        !hasExactKeys(value, ["kind", "code"]) ||
        typeof value.code !== "string" ||
        !expertCode.test(value.code)
      ) {
        return { valid: false, reasonCode: "invalid_shape" };
      }
      return {
        valid: true,
        proposal: { kind: "redeem_expert_referral", code: value.code },
      };
    }
    if (value.kind === "view_referral_summary") {
      return hasExactKeys(value, ["kind"])
        ? { valid: true, proposal: { kind: "view_referral_summary" } }
        : { valid: false, reasonCode: "invalid_shape" };
    }
    if (value.kind === "quote_residency") {
      if (
        !hasExactKeys(value, ["kind", "tariffVersionId"]) ||
        typeof value.tariffVersionId !== "string" ||
        !uuid.test(value.tariffVersionId)
      ) {
        return { valid: false, reasonCode: "invalid_shape" };
      }
      return {
        valid: true,
        proposal: {
          kind: "quote_residency",
          tariffVersionId: value.tariffVersionId,
        },
      };
    }
    if (value.kind === "start_residency_checkout") {
      if (
        !hasExactKeys(value, ["kind", "tariffVersionId"]) ||
        typeof value.tariffVersionId !== "string" ||
        !uuid.test(value.tariffVersionId)
      ) {
        return { valid: false, reasonCode: "invalid_shape" };
      }
      return {
        valid: true,
        proposal: {
          kind: "start_residency_checkout",
          tariffVersionId: value.tariffVersionId,
        },
      };
    }
    return { valid: false, reasonCode: "unsupported_intent" };
  } catch {
    return { valid: false, reasonCode: "invalid_shape" };
  }
}

const validInstantOrNull = (value: string | null): boolean =>
  value === null ||
  (Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value);

const sanitizeSummary = (
  summary: ReferralSummary,
): ExpertPromptReferralSummary => {
  if (
    !money.test(summary.availableMinor) ||
    !money.test(summary.reservedMinor) ||
    !money.test(summary.debtMinor) ||
    !validInstantOrNull(summary.nearestExpiry)
  ) {
    throw new Error("expert_prompt_context_invalid");
  }
  return {
    availableMinor: summary.availableMinor,
    reservedMinor: summary.reservedMinor,
    debtMinor: summary.debtMinor,
    nearestExpiry: summary.nearestExpiry,
  };
};

const sanitizeQuote = (
  tariffVersionId: string,
  quote: ResidencyQuote,
): ExpertPromptResidencyQuote => {
  const quotedTariffVersionId =
    typeof quote.tariffVersionId === "string"
      ? quote.tariffVersionId
      : tariffVersionId;
  if (
    !uuid.test(quotedTariffVersionId) ||
    quotedTariffVersionId !== tariffVersionId ||
    !money.test(quote.priceMinor) ||
    !money.test(quote.creditMinor) ||
    !money.test(quote.cashMinor)
  ) {
    throw new Error("expert_prompt_context_invalid");
  }
  if (quote.currency !== undefined && quote.currency !== "RUB") {
    throw new Error("expert_prompt_context_invalid");
  }
  if (
    quote.durationSeconds !== undefined &&
    (!Number.isSafeInteger(quote.durationSeconds) ||
      quote.durationSeconds < 86_400 ||
      quote.durationSeconds > 315_360_000)
  ) {
    throw new Error("expert_prompt_context_invalid");
  }
  if (
    quote.displayName !== undefined &&
    (typeof quote.displayName !== "string" ||
      quote.displayName.trim().length === 0 ||
      quote.displayName.length > 256)
  ) {
    throw new Error("expert_prompt_context_invalid");
  }
  return {
    tariffVersionId: quotedTariffVersionId,
    priceMinor: quote.priceMinor,
    creditMinor: quote.creditMinor,
    cashMinor: quote.cashMinor,
    ...(quote.currency === undefined ? {} : { currency: quote.currency }),
    ...(quote.durationSeconds === undefined
      ? {}
      : { durationSeconds: quote.durationSeconds }),
    ...(quote.displayName === undefined
      ? {}
      : { displayName: quote.displayName }),
  };
};

const sanitizePersonalOffer = (value: PersonalOfferView): PersonalOfferView => {
  const invalid = (): never => {
    throw new Error("expert_prompt_context_invalid");
  };
  if (
    !isRecord(value) ||
    typeof value.offer_start_date !== "string" ||
    !validInstantOrNull(value.offer_start_date) ||
    typeof value.payment_link_expires_at !== "string" ||
    !validInstantOrNull(value.payment_link_expires_at) ||
    ![40, 30, 20, 0].includes(value.current_discount_stage) ||
    typeof value.locked_price_monthly !== "string" ||
    !money.test(value.locked_price_monthly) ||
    (value.locked_price_package !== null &&
      (typeof value.locked_price_package !== "string" ||
        !money.test(value.locked_price_package))) ||
    !Number.isSafeInteger(value.remaining_seconds) ||
    value.remaining_seconds < 0 ||
    !["ready", "pending_gates", "select_one_month"].includes(value.readiness)
  )
    invalid();
  let payment_url: string | null = null;
  if (value.readiness === "ready" && value.payment_url !== null) {
    if (typeof value.payment_url !== "string") invalid();
    let parsed: URL;
    try {
      parsed = new URL(value.payment_url);
    } catch {
      return invalid();
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(
        parsed.hostname,
      )
    )
      invalid();
    payment_url = value.payment_url;
  }
  return {
    offer_start_date: value.offer_start_date,
    current_discount_stage: value.current_discount_stage,
    locked_price_monthly: value.locked_price_monthly,
    locked_price_package: value.locked_price_package,
    payment_link_expires_at: value.payment_link_expires_at,
    remaining_seconds: value.remaining_seconds,
    readiness: value.readiness,
    payment_url,
  };
};

export async function buildExpertPromptContext(input: {
  readonly principal: ExpertPrincipal;
  readonly referrals: ExpertReferralService;
  readonly residency: ExpertResidencyService;
  readonly tariffVersionId?: string;
  readonly personalOffers?: {
    readOwned(
      userId: string,
      expertId: string,
    ): Promise<PersonalOfferView | null>;
  };
}): Promise<ExpertPromptContextResult> {
  if (!input.principal.authenticated) return { kind: "forbidden" };
  const summary = await input.referrals.summary(input.principal);
  if (isForbiddenResult(summary)) {
    return { kind: "forbidden" };
  }
  const referral = sanitizeSummary(summary);
  const ownedOffer = await input.personalOffers?.readOwned(
    input.principal.userId,
    input.principal.expertId,
  );
  const currentOffer =
    ownedOffer == null
      ? {}
      : { currentOffer: sanitizePersonalOffer(ownedOffer) };
  if (input.tariffVersionId === undefined) {
    return {
      kind: "ready",
      context: {
        referral,
        ...currentOffer,
        runtimeInstructions: EXPERT_OFFER_RUNTIME_INSTRUCTIONS,
      },
    };
  }
  if (!uuid.test(input.tariffVersionId)) {
    throw new Error("expert_prompt_context_invalid");
  }
  const quote = await input.residency.quote(
    input.principal,
    input.tariffVersionId,
  );
  if (isForbiddenResult(quote)) return { kind: "forbidden" };
  if (isDisabledResult(quote)) return { kind: "disabled" };
  return {
    kind: "ready",
    context: {
      runtimeInstructions: EXPERT_OFFER_RUNTIME_INSTRUCTIONS,
      referral,
      ...currentOffer,
      residencyQuote: sanitizeQuote(input.tariffVersionId, quote),
    },
  };
}
