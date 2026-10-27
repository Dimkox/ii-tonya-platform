export interface ExpertCampaignPriceInput {
  readonly baseMonthlyMinor: bigint;
  readonly calculationTimestampMs: number;
  readonly quotedAtMs: number;
  readonly termMonths: 1 | 3;
}

export interface ExpertCampaignPrice {
  readonly ruleVersion: "expert_energy_start_v1";
  readonly currency: "RUB";
  readonly energyDiscountBps: 4000 | 3000 | 2000 | 0;
  readonly startDiscountBps: 1500 | 1000 | 0;
  readonly discountedMonthlyMinor: bigint;
  readonly monthlyPriceMinor: bigint;
  readonly priceMinor: bigint;
  readonly floorApplied: boolean;
  readonly termMonths: 1 | 3;
  readonly durationSeconds: number;
}

/** Pure arithmetic only. The caller must establish quote/clock authority. */
export function calculateExpertCampaignPrice(
  input: ExpertCampaignPriceInput,
): ExpertCampaignPrice {
  const invalid = (): never => {
    throw new Error("expert_campaign_price_invalid");
  };
  const maximum = 9_223_372_036_854_775_807n;
  if (
    input === null ||
    typeof input !== "object" ||
    typeof input.baseMonthlyMinor !== "bigint" ||
    input.baseMonthlyMinor <= 0n ||
    input.baseMonthlyMinor > maximum ||
    (input.termMonths !== 1 && input.termMonths !== 3) ||
    ![input.calculationTimestampMs, input.quotedAtMs].every(
      (value) =>
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= 8_640_000_000_000_000,
    ) ||
    input.quotedAtMs < input.calculationTimestampMs
  )
    invalid();

  const elapsed = input.quotedAtMs - input.calculationTimestampMs;
  const hour = 3_600_000;
  const energyDiscountBps: ExpertCampaignPrice["energyDiscountBps"] =
    elapsed < 72 * hour
      ? 4000
      : elapsed < 144 * hour
        ? 3000
        : elapsed < 216 * hour
          ? 2000
          : 0;
  if (input.termMonths === 3 && elapsed >= 144 * hour)
    throw new Error("expert_campaign_term_unavailable");
  const startDiscountBps: ExpertCampaignPrice["startDiscountBps"] =
    input.termMonths === 1 ? 0 : elapsed < 72 * hour ? 1500 : 1000;

  // Round only once after both factors. Money never passes through Number.
  const numerator =
    input.baseMonthlyMinor *
    BigInt(10_000 - energyDiscountBps) *
    BigInt(10_000 - startDiscountBps);
  const discountedMonthlyMinor = (numerator + 50_000_000n) / 100_000_000n;
  const monthlyPriceMinor =
    discountedMonthlyMinor < 500_000n ? 500_000n : discountedMonthlyMinor;
  const priceMinor = monthlyPriceMinor * BigInt(input.termMonths);
  if (priceMinor > maximum) invalid();
  return Object.freeze({
    ruleVersion: "expert_energy_start_v1",
    currency: "RUB",
    energyDiscountBps,
    startDiscountBps,
    discountedMonthlyMinor,
    monthlyPriceMinor,
    priceMinor,
    floorApplied: monthlyPriceMinor !== discountedMonthlyMinor,
    termMonths: input.termMonths,
    durationSeconds: 2_592_000 * input.termMonths,
  });
}
