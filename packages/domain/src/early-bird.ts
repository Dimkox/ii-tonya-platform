import { calculateSeparatedSalesTerms } from "./expert-separated-sales.js";

/** Wave one opens at midnight Moscow time. Persisted configuration remains authoritative. */
export const EARLY_BIRD_CLIENT_START_MS = Date.parse(
  "2027-01-11T00:00:00+03:00",
);
const ONBOARDING_MINOR = 300000n;
const PROMO_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

/** Quote only; payment authority must persist the components and verify provider settlement. */
export function calculateEarlyBirdQuote(input: {
  baseMonthlyMinor: bigint;
  firstOfferAtMs: number;
  quotedAtMs: number;
  onboardingPaid: boolean;
}): {
  onboardingMinor: bigint;
  monthlyMinor: bigint;
  totalMinor: bigint;
  discountBps: number;
  discounted: boolean;
  promotionEligible: boolean;
} {
  if (!input || typeof input.onboardingPaid !== "boolean")
    throw new Error("expert_sales_invalid");
  const promotion =
    !input.onboardingPaid &&
    input.quotedAtMs - input.firstOfferAtMs < PROMO_WINDOW_MS;
  const terms = calculateSeparatedSalesTerms({
    baseMonthlyMinor: input.baseMonthlyMinor,
    participantKind: "expert",
    firstOfferAtMs: input.firstOfferAtMs,
    quotedAtMs: input.quotedAtMs,
    promotion,
    termMonths: 1,
  });
  const onboardingMinor = input.onboardingPaid ? 0n : ONBOARDING_MINOR;
  const totalMinor = onboardingMinor + terms.monthlyPriceMinor;
  if (totalMinor > 999999999999n) throw new Error("expert_sales_invalid");
  return Object.freeze({
    onboardingMinor,
    monthlyMinor: terms.monthlyPriceMinor,
    totalMinor,
    discountBps: terms.energyDiscountBps,
    discounted:
      terms.monthlyPriceMinor <
      (input.baseMonthlyMinor < 500000n ? 500000n : input.baseMonthlyMinor),
    promotionEligible: promotion,
  });
}
