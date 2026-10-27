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

export interface ExpertCampaignPriceV2Input {
  /** Approved category rate. Space callers must provide an approved space rate. */
  readonly categoryRateMinor: bigint;
  readonly millionCity: boolean;
  readonly onlineOnly: boolean;
  readonly ticketMinor: bigint;
  readonly participantKind: "expert" | "space";
  readonly firstOfferAtMs: number;
  readonly quotedAtMs: number;
}

export interface ExpertCampaignPriceV2 {
  readonly ruleVersion: "expert_energy_start_v2";
  readonly currency: "RUB";
  readonly baseMonthlyMinor: bigint;
  readonly energyDiscountBps: 4000 | 3000 | 2000 | 0;
  readonly packageDiscountBps: 1500 | 1000 | 0;
  readonly monthlyPriceMinor: bigint;
  readonly packagePriceMinor: bigint | null;
  readonly monthlyFloorApplied: boolean;
  readonly packageFloorApplied: boolean;
  readonly nextStageAtMs: number | null;
  readonly monthlyDurationSeconds: 2592000;
  readonly packageDurationSeconds: 7776000;
}

/** Pure arithmetic. PostgreSQL supplies approved facts and the immutable first-offer clock. */
export function calculateExpertCampaignPriceV2(
  input: ExpertCampaignPriceV2Input,
): ExpertCampaignPriceV2 {
  const invalid = (): never => {
    throw new Error("expert_campaign_price_invalid");
  };
  const maximum = 9_223_372_036_854_775_807n;
  if (
    input === null ||
    typeof input !== "object" ||
    typeof input.categoryRateMinor !== "bigint" ||
    input.categoryRateMinor <= 0n ||
    input.categoryRateMinor > maximum ||
    typeof input.ticketMinor !== "bigint" ||
    input.ticketMinor < 0n ||
    input.ticketMinor > maximum ||
    typeof input.millionCity !== "boolean" ||
    typeof input.onlineOnly !== "boolean" ||
    (input.participantKind !== "expert" && input.participantKind !== "space") ||
    ![input.firstOfferAtMs, input.quotedAtMs].every(
      (value) =>
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= 8_640_000_000_000_000,
    ) ||
    input.quotedAtMs < input.firstOfferAtMs
  )
    invalid();
  const baseMonthlyMinor =
    input.categoryRateMinor +
    (input.millionCity ? 500_000n : 0n) +
    (input.onlineOnly ? 300_000n : 0n) -
    (input.ticketMinor < 300_000n ? 100_000n : 0n);
  if (baseMonthlyMinor < 0n || baseMonthlyMinor > maximum) invalid();
  const hour = 3_600_000;
  const elapsed = input.quotedAtMs - input.firstOfferAtMs;
  const energyDiscountBps =
    elapsed < 96 * hour
      ? 4000
      : elapsed < 168 * hour
        ? 3000
        : elapsed < 240 * hour
          ? 2000
          : 0;
  const nextStageHours =
    elapsed < 96 * hour
      ? 96
      : elapsed < 168 * hour
        ? 168
        : elapsed < 240 * hour
          ? 240
          : null;
  const nextStageAtMs =
    nextStageHours === null
      ? null
      : input.firstOfferAtMs + nextStageHours * hour;
  if (nextStageAtMs !== null && nextStageAtMs > 8_640_000_000_000_000)
    invalid();
  const packageAvailable = elapsed < 168 * hour;
  const packageDiscountBps = !packageAvailable
    ? 0
    : input.participantKind === "space"
      ? 1000
      : elapsed < 96 * hour
        ? 1500
        : 1000;
  const monthlyBeforeFloor =
    (baseMonthlyMinor * BigInt(10_000 - energyDiscountBps) + 5_000n) / 10_000n;
  const packageBeforeFloor = packageAvailable
    ? (baseMonthlyMinor *
        3n *
        BigInt(10_000 - energyDiscountBps) *
        BigInt(10_000 - packageDiscountBps) +
        50_000_000n) /
      100_000_000n
    : null;
  const monthlyPriceMinor =
    monthlyBeforeFloor < 500_000n ? 500_000n : monthlyBeforeFloor;
  const packagePriceMinor =
    packageBeforeFloor === null
      ? null
      : packageBeforeFloor < 1_500_000n
        ? 1_500_000n
        : packageBeforeFloor;
  if (
    monthlyPriceMinor > maximum ||
    (packagePriceMinor !== null && packagePriceMinor > maximum)
  )
    invalid();
  return Object.freeze({
    ruleVersion: "expert_energy_start_v2",
    currency: "RUB",
    baseMonthlyMinor,
    energyDiscountBps,
    packageDiscountBps,
    monthlyPriceMinor,
    packagePriceMinor,
    monthlyFloorApplied: monthlyPriceMinor !== monthlyBeforeFloor,
    packageFloorApplied:
      packageBeforeFloor !== null && packagePriceMinor !== packageBeforeFloor,
    nextStageAtMs,
    monthlyDurationSeconds: 2_592_000,
    packageDurationSeconds: 7_776_000,
  });
}
