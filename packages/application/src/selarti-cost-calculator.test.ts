import { describe, expect, it } from "vitest";
import { calculateSelartiWorstCaseCost } from "./selarti-cost-calculator.js";

describe("Selarti fixed-point cost calculator", () => {
  it("applies the exact 10% uplift and rounds RUB minor upward", () => {
    expect(
      calculateSelartiWorstCaseCost({
        officialUsdRubQuoteMicros: 85_954_100n,
        upliftBps: 1_000,
        usdMicrosPerRequest: 0n,
        usdMicrosPerUnit: 30_000n,
        worstCaseBillableUnits: 2n,
      }),
    ).toEqual({
      effectiveUsdRubQuoteMicros: 94_549_510n,
      worstCaseUsdMicros: 60_000n,
      worstCaseRubMinor: 568n,
    });
  });

  it("uses integer ceilings and never folds the 60% stress fixture into live cost", () => {
    const live = calculateSelartiWorstCaseCost({
      officialUsdRubQuoteMicros: 100_000_001n,
      upliftBps: 1_000,
      usdMicrosPerRequest: 1n,
      usdMicrosPerUnit: 1n,
      worstCaseBillableUnits: 1n,
    });
    expect(live).toEqual({
      effectiveUsdRubQuoteMicros: 110_000_002n,
      worstCaseUsdMicros: 2n,
      worstCaseRubMinor: 1n,
    });
  });

  it.each([
    { officialUsdRubQuoteMicros: 0n },
    { officialUsdRubQuoteMicros: -1n },
  ])("rejects invalid bounded money inputs", (override) => {
    expect(() =>
      calculateSelartiWorstCaseCost({
        officialUsdRubQuoteMicros: override.officialUsdRubQuoteMicros,
        upliftBps: 1_000,
        usdMicrosPerRequest: 0n,
        usdMicrosPerUnit: 30_000n,
        worstCaseBillableUnits: 1n,
      }),
    ).toThrow("selarti_cost_input_invalid");
  });

  it("accepts the exact derived RUB business cap and rejects one micro-dollar above it", () => {
    const base = {
      officialUsdRubQuoteMicros: 10_000_000n,
      upliftBps: 1_000,
      usdMicrosPerUnit: 90_909_090_909n,
      worstCaseBillableUnits: 10_000n,
    } as const;
    expect(
      calculateSelartiWorstCaseCost({
        ...base,
        usdMicrosPerRequest: 0n,
      }).worstCaseRubMinor,
    ).toBe(999_999_999_999n);
    expect(() =>
      calculateSelartiWorstCaseCost({
        ...base,
        usdMicrosPerRequest: 1n,
      }),
    ).toThrow("selarti_cost_result_out_of_bounds");
  });

  it("rejects a zero derived cost", () => {
    expect(() =>
      calculateSelartiWorstCaseCost({
        officialUsdRubQuoteMicros: 85_954_100n,
        upliftBps: 1_000,
        usdMicrosPerRequest: 0n,
        usdMicrosPerUnit: 0n,
        worstCaseBillableUnits: 1n,
      }),
    ).toThrow("selarti_cost_result_out_of_bounds");
  });
});
