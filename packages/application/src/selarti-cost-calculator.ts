export type SelartiWorstCaseCostInput = {
  readonly officialUsdRubQuoteMicros: bigint;
  readonly upliftBps: number;
  readonly usdMicrosPerRequest: bigint;
  readonly usdMicrosPerUnit: bigint;
  readonly worstCaseBillableUnits: bigint;
};

const MAX = 999_999_999_999n;
const ceilDiv = (value: bigint, divisor: bigint) =>
  (value + divisor - 1n) / divisor;

export function calculateSelartiWorstCaseCost(
  input: SelartiWorstCaseCostInput,
) {
  if (
    input.officialUsdRubQuoteMicros <= 0n ||
    input.officialUsdRubQuoteMicros > MAX ||
    input.upliftBps !== 1_000 ||
    input.usdMicrosPerRequest < 0n ||
    input.usdMicrosPerRequest > MAX ||
    input.usdMicrosPerUnit < 0n ||
    input.usdMicrosPerUnit > MAX ||
    input.worstCaseBillableUnits <= 0n ||
    input.worstCaseBillableUnits > 1_000_000n
  ) {
    throw new Error("selarti_cost_input_invalid");
  }
  const effectiveUsdRubQuoteMicros = ceilDiv(
    input.officialUsdRubQuoteMicros * BigInt(10_000 + input.upliftBps),
    10_000n,
  );
  const worstCaseUsdMicros =
    input.usdMicrosPerRequest +
    input.usdMicrosPerUnit * input.worstCaseBillableUnits;
  const worstCaseRubMinor = ceilDiv(
    worstCaseUsdMicros * effectiveUsdRubQuoteMicros * 100n,
    1_000_000_000_000n,
  );
  if (worstCaseRubMinor <= 0n || worstCaseRubMinor > MAX) {
    throw new Error("selarti_cost_result_out_of_bounds");
  }
  return {
    effectiveUsdRubQuoteMicros,
    worstCaseUsdMicros,
    worstCaseRubMinor,
  } as const;
}
