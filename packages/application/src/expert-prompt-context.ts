import type {
  ExpertPrincipal,
  ExpertReferralService,
} from "./expert-referral-service.js";
import type {
  ExpertResidencyService,
  ResidencyQuote,
} from "./expert-residency-service.js";

export interface ExpertPromptTariffVersionBinding {
  tariffKeyFor(tariffVersionId: string): Promise<string | null>;
}

export interface ExpertPromptContextDependencies {
  readonly referrals: ExpertReferralService;
  readonly residency: ExpertResidencyService;
  readonly tariffVersions: ExpertPromptTariffVersionBinding;
}

export interface ExpertPromptContextValue {
  readonly referralSummary: {
    readonly spendableBalanceMinor: string;
    readonly reservedBalanceMinor: string;
    readonly debtMinor: string;
    readonly nearestExpiryAt: string | null;
  };
  readonly residencyQuote: ResidencyQuote;
}

export class ExpertPromptContextError extends Error {
  constructor(readonly code: "forbidden" | "unavailable") {
    super("Expert prompt context unavailable");
    this.name = "ExpertPromptContextError";
  }
}

export interface ExpertPromptContext {
  read(
    principal: ExpertPrincipal,
    input: { readonly tariffVersionId: string },
  ): Promise<ExpertPromptContextValue>;
}

const denied = (
  value: unknown,
): value is { readonly kind: "forbidden" | "disabled" } =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  ((value as { kind?: unknown }).kind === "forbidden" ||
    (value as { kind?: unknown }).kind === "disabled");
const decimalMinor = /^(?:0|[1-9][0-9]{0,18})$/u;
const validQuote = (quote: ResidencyQuote): boolean =>
  typeof quote.displayName === "string" &&
  quote.displayName.length > 0 &&
  quote.displayName.length <= 256 &&
  typeof quote.description === "string" &&
  quote.description.length > 0 &&
  quote.description.length <= 256 &&
  decimalMinor.test(quote.priceMinor) &&
  quote.currency === "RUB" &&
  Number.isSafeInteger(quote.durationSeconds) &&
  quote.durationSeconds >= 86_400 &&
  quote.durationSeconds <= 315_360_000 &&
  decimalMinor.test(quote.creditMinor) &&
  decimalMinor.test(quote.cashMinor);

export const createExpertPromptContext = (
  dependencies: ExpertPromptContextDependencies,
): ExpertPromptContext => ({
  async read(principal, input) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        input.tariffVersionId,
      )
    ) {
      throw new ExpertPromptContextError("forbidden");
    }
    try {
      const tariffKey = await dependencies.tariffVersions.tariffKeyFor(
        input.tariffVersionId,
      );
      if (tariffKey === null) throw new ExpertPromptContextError("forbidden");
      const [summary, quote] = await Promise.all([
        dependencies.referrals.summary(principal),
        dependencies.residency.quote(principal, tariffKey),
      ]);
      if (
        denied(summary) ||
        denied(quote) ||
        summary.expertId !== principal.expertId ||
        quote.tariffVersionId !== input.tariffVersionId
      ) {
        throw new ExpertPromptContextError("forbidden");
      }
      if (
        !decimalMinor.test(summary.spendableBalanceMinor) ||
        !decimalMinor.test(summary.reservedBalanceMinor) ||
        !decimalMinor.test(summary.debtMinor) ||
        (summary.nearestExpiryAt !== null &&
          (!(summary.nearestExpiryAt instanceof Date) ||
            !Number.isFinite(summary.nearestExpiryAt.getTime()))) ||
        !validQuote(quote)
      ) {
        throw new ExpertPromptContextError("unavailable");
      }
      return {
        referralSummary: {
          spendableBalanceMinor: summary.spendableBalanceMinor,
          reservedBalanceMinor: summary.reservedBalanceMinor,
          debtMinor: summary.debtMinor,
          nearestExpiryAt: summary.nearestExpiryAt?.toISOString() ?? null,
        },
        residencyQuote: {
          tariffVersionId: quote.tariffVersionId,
          displayName: quote.displayName,
          description: quote.description,
          priceMinor: quote.priceMinor,
          currency: quote.currency,
          durationSeconds: quote.durationSeconds,
          creditMinor: quote.creditMinor,
          cashMinor: quote.cashMinor,
        },
      };
    } catch (error) {
      if (error instanceof ExpertPromptContextError) throw error;
      throw new ExpertPromptContextError("unavailable");
    }
  },
});
