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
        !hasExactKeys(value, ["kind", "orderId"]) ||
        typeof value.orderId !== "string" ||
        !uuid.test(value.orderId)
      ) {
        return { valid: false, reasonCode: "invalid_shape" };
      }
      return {
        valid: true,
        proposal: {
          kind: "start_residency_checkout",
          orderId: value.orderId,
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
  (Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

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

export async function buildExpertPromptContext(input: {
  readonly principal: ExpertPrincipal;
  readonly referrals: ExpertReferralService;
  readonly residency: ExpertResidencyService;
  readonly tariffVersionId?: string;
}): Promise<ExpertPromptContextResult> {
  const summary = await input.referrals.summary(input.principal);
  if ("kind" in summary && summary.kind === "forbidden") {
    return { kind: "forbidden" };
  }
  const referral = sanitizeSummary(summary);
  if (input.tariffVersionId === undefined) {
    return { kind: "ready", context: { referral } };
  }
  if (!uuid.test(input.tariffVersionId)) {
    throw new Error("expert_prompt_context_invalid");
  }
  const quote = await input.residency.quote(
    input.principal,
    input.tariffVersionId,
  );
  if ("kind" in quote) {
    if (quote.kind === "forbidden") return { kind: "forbidden" };
    if (quote.kind === "disabled") return { kind: "disabled" };
  }
  return {
    kind: "ready",
    context: {
      referral,
      residencyQuote: sanitizeQuote(input.tariffVersionId, quote),
    },
  };
}
