import { expect, it } from "vitest";
import {
  calculateExpertCampaignPrice,
  type ExpertCampaignPriceInput,
} from "./expert-campaign-price.js";

const anchor = Date.parse("2026-10-12T00:00:00Z");
const hour = 3_600_000;
const input = (
  overrides: Partial<ExpertCampaignPriceInput> = {},
): ExpertCampaignPriceInput => ({
  baseMonthlyMinor: 2_000_000n,
  calculationTimestampMs: anchor,
  quotedAtMs: anchor,
  termMonths: 1,
  ...overrides,
});

it.each([
  [0, 4000, 1_200_000n],
  [72 * hour - 1, 4000, 1_200_000n],
  [72 * hour, 3000, 1_400_000n],
  [144 * hour - 1, 3000, 1_400_000n],
  [144 * hour, 2000, 1_600_000n],
  [216 * hour - 1, 2000, 1_600_000n],
  [216 * hour, 0, 2_000_000n],
] as const)(
  "uses the exact Energy boundary at elapsed %s ms",
  (elapsed, bps, price) => {
    expect(
      calculateExpertCampaignPrice(input({ quotedAtMs: anchor + elapsed })),
    ).toMatchObject({
      energyDiscountBps: bps,
      startDiscountBps: 0,
      priceMinor: price,
      monthlyPriceMinor: price,
      floorApplied: false,
      durationSeconds: 2_592_000,
    });
  },
);

it.each([
  [0, 1500, 1_020_000n, 3_060_000n],
  [72 * hour - 1, 1500, 1_020_000n, 3_060_000n],
  [72 * hour, 1000, 1_260_000n, 3_780_000n],
  [144 * hour - 1, 1000, 1_260_000n, 3_780_000n],
] as const)(
  "applies eligible three-month Start at elapsed %s ms",
  (elapsed, bps, monthly, total) => {
    expect(
      calculateExpertCampaignPrice(
        input({ termMonths: 3, quotedAtMs: anchor + elapsed }),
      ),
    ).toMatchObject({
      startDiscountBps: bps,
      monthlyPriceMinor: monthly,
      priceMinor: total,
      durationSeconds: 7_776_000,
      termMonths: 3,
    });
  },
);

it.each([144 * hour, 216 * hour, 300 * hour])(
  "rejects three-month Start after eligibility expires at %s",
  (elapsed) => {
    expect(() =>
      calculateExpertCampaignPrice(
        input({ termMonths: 3, quotedAtMs: anchor + elapsed }),
      ),
    ).toThrow("expert_campaign_term_unavailable");
  },
);

it.each([390_000n, 500_000n, 590_000n])(
  "keeps the three-month floor and duration for base %s",
  (baseMonthlyMinor) => {
    expect(
      calculateExpertCampaignPrice(input({ baseMonthlyMinor, termMonths: 3 })),
    ).toMatchObject({
      monthlyPriceMinor: 500_000n,
      priceMinor: 1_500_000n,
      floorApplied: true,
      termMonths: 3,
      durationSeconds: 7_776_000,
    });
  },
);

it("applies the floor to one month after the Energy discount", () => {
  expect(
    calculateExpertCampaignPrice(
      input({ baseMonthlyMinor: 590_000n, quotedAtMs: anchor + 144 * hour }),
    ),
  ).toMatchObject({
    discountedMonthlyMinor: 472_000n,
    monthlyPriceMinor: 500_000n,
    priceMinor: 500_000n,
    floorApplied: true,
  });
});

it.each([
  [1_000_007n, 510_004n, 1_530_012n],
  [1_000_050n, 510_026n, 1_530_078n],
  [999_000n, 509_490n, 1_528_470n],
] as const)(
  "rounds once, half up, after both discounts for %s",
  (baseMonthlyMinor, monthly, total) => {
    expect(
      calculateExpertCampaignPrice(input({ baseMonthlyMinor, termMonths: 3 })),
    ).toMatchObject({
      discountedMonthlyMinor: monthly,
      monthlyPriceMinor: monthly,
      priceMinor: total,
    });
  },
);

it.each([
  [980_391n, 499_999n, true],
  [980_392n, 500_000n, false],
] as const)(
  "applies the floor after rounding at base %s",
  (baseMonthlyMinor, discountedMonthlyMinor, floorApplied) => {
    expect(
      calculateExpertCampaignPrice(input({ baseMonthlyMinor, termMonths: 3 })),
    ).toMatchObject({
      discountedMonthlyMinor,
      floorApplied,
      monthlyPriceMinor: 500_000n,
      priceMinor: 1_500_000n,
    });
  },
);

it("preserves signed-bigint precision and rejects overflowing totals", () => {
  const maximum = 9_223_372_036_854_775_807n;
  expect(
    calculateExpertCampaignPrice(
      input({ baseMonthlyMinor: maximum, quotedAtMs: anchor + 216 * hour }),
    ).priceMinor,
  ).toBe(maximum);
  expect(() =>
    calculateExpertCampaignPrice(
      input({ baseMonthlyMinor: maximum, termMonths: 3 }),
    ),
  ).toThrow("expert_campaign_price_invalid");
});

it.each([
  { baseMonthlyMinor: 0n },
  { baseMonthlyMinor: -1n },
  { baseMonthlyMinor: 9_223_372_036_854_775_808n },
  { baseMonthlyMinor: 500_000 as unknown as bigint },
  { quotedAtMs: anchor - 1 },
  { quotedAtMs: NaN },
  { quotedAtMs: Infinity },
  { quotedAtMs: anchor + 0.5 },
  { quotedAtMs: 8_640_000_000_000_001 },
  { calculationTimestampMs: -1 },
  { calculationTimestampMs: NaN },
  { termMonths: 2 as 1 },
])("rejects invalid authoritative input %#", (overrides) => {
  expect(() => calculateExpertCampaignPrice(input(overrides))).toThrow(
    "expert_campaign_price_invalid",
  );
});

it("returns immutable versioned RUB terms without modifying input", () => {
  const original = Object.freeze(input());
  const result = calculateExpertCampaignPrice(original);
  expect(result).toMatchObject({
    ruleVersion: "expert_energy_start_v1",
    currency: "RUB",
    termMonths: 1,
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(original.baseMonthlyMinor).toBe(2_000_000n);
});
