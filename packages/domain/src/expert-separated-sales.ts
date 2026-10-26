/** Pure arithmetic; persistence, owner choices and clocks are PostgreSQL authority. */
export function calculateExpertBasePrice(input: {
  categoryRateMinor: bigint;
  millionCity: boolean;
  onlineOnly: boolean;
  ticketMinor: bigint;
}): bigint {
  if (
    !input ||
    typeof input.categoryRateMinor !== "bigint" ||
    input.categoryRateMinor <= 0n ||
    typeof input.ticketMinor !== "bigint" ||
    input.ticketMinor < 0n ||
    typeof input.millionCity !== "boolean" ||
    typeof input.onlineOnly !== "boolean"
  )
    throw new Error("expert_sales_invalid");
  const result =
    input.categoryRateMinor +
    (input.millionCity ? 500000n : 0n) +
    (input.onlineOnly ? 300000n : 0n) -
    (input.ticketMinor < 300000n ? 100000n : 0n);
  if (result < 0n || result > 999999999999n)
    throw new Error("expert_sales_invalid");
  return result < 500000n ? 500000n : result;
}
export function calculateSeparatedSalesTerms(input: {
  baseMonthlyMinor: bigint;
  participantKind: "expert" | "space";
  firstOfferAtMs: number;
  quotedAtMs: number;
  promotion: boolean;
  termMonths: 1 | 3;
}) {
  if (
    !input ||
    typeof input.baseMonthlyMinor !== "bigint" ||
    input.baseMonthlyMinor < 0n ||
    input.baseMonthlyMinor > 999999999999n ||
    !["expert", "space"].includes(input.participantKind) ||
    typeof input.promotion !== "boolean" ||
    ![1, 3].includes(input.termMonths) ||
    ![input.firstOfferAtMs, input.quotedAtMs].every(
      (v) => Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000,
    ) ||
    input.quotedAtMs < input.firstOfferAtMs
  )
    throw new Error("expert_sales_invalid");
  const hours = (input.quotedAtMs - input.firstOfferAtMs) / 3600000;
  if (input.termMonths === 3 && hours >= 168)
    throw new Error("expert_sales_period_unavailable");
  const energyDiscountBps = !input.promotion
    ? 0
    : hours < 96
      ? 4000
      : hours < 168
        ? 3000
        : hours < 240
          ? 2000
          : 0;
  const packageDiscountBps =
    !input.promotion || hours >= 168
      ? 0
      : input.participantKind === "space"
        ? 1000
        : hours < 96
          ? 1500
          : 1000;
  const monthlyRaw =
    (input.baseMonthlyMinor * BigInt(10000 - energyDiscountBps) + 5000n) /
    10000n;
  const packageRaw =
    hours >= 168
      ? null
      : (input.baseMonthlyMinor *
          3n *
          BigInt(10000 - energyDiscountBps) *
          BigInt(10000 - packageDiscountBps) +
          50000000n) /
        100000000n;
  const monthlyPriceMinor = monthlyRaw < 500000n ? 500000n : monthlyRaw;
  const packagePriceMinor =
    packageRaw === null ? null : packageRaw < 1500000n ? 1500000n : packageRaw;
  const selectedTotalMinor =
    input.termMonths === 1 ? monthlyPriceMinor : packagePriceMinor!;
  if (selectedTotalMinor > 999999999999n)
    throw new Error("expert_sales_invalid");
  const stage = hours < 96 ? 96 : hours < 168 ? 168 : hours < 240 ? 240 : null;
  return Object.freeze({
    ruleVersion: "expert_separated_sales_v3" as const,
    energyDiscountBps,
    packageDiscountBps,
    monthlyPriceMinor,
    packagePriceMinor,
    selectedTotalMinor,
    termMonths: input.termMonths,
    durationSeconds: 2592000 * input.termMonths,
    nextStageAtMs:
      stage === null ? null : input.firstOfferAtMs + stage * 3600000,
  });
}
