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

// V2 preserves the historical v1 contract above.
import { calculateExpertCampaignPriceV2 } from "./expert-campaign-price.js";
const v2Input = (overrides = {}) => ({
  categoryRateMinor: 900_000n,
  millionCity: false,
  onlineOnly: false,
  ticketMinor: 300_000n,
  participantKind: "expert" as const,
  firstOfferAtMs: anchor,
  quotedAtMs: anchor,
  ...overrides,
});

it.each([
  [0, 4000, 540_000n, 1_500_000n, 96],
  [96 * hour - 1, 4000, 540_000n, 1_500_000n, 96],
  [96 * hour, 3000, 630_000n, 1_701_000n, 168],
  [168 * hour - 1, 3000, 630_000n, 1_701_000n, 168],
  [168 * hour, 2000, 720_000n, null, 240],
  [240 * hour - 1, 2000, 720_000n, null, 240],
  [240 * hour, 0, 900_000n, null, null],
] as const)(
  "v2 exact elapsed boundary %s",
  (elapsed, discount, monthly, pack, next) => {
    expect(
      calculateExpertCampaignPriceV2(v2Input({ quotedAtMs: anchor + elapsed })),
    ).toMatchObject({
      ruleVersion: "expert_energy_start_v2",
      energyDiscountBps: discount,
      monthlyPriceMinor: monthly,
      packagePriceMinor: pack,
      nextStageAtMs: next === null ? null : anchor + next * hour,
      monthlyDurationSeconds: 2_592_000,
      packageDurationSeconds: 7_776_000,
    });
  },
);
it("v2 computes base from structured qualifications at the exact ticket threshold", () => {
  expect(
    calculateExpertCampaignPriceV2(
      v2Input({ millionCity: true, onlineOnly: true, ticketMinor: 299_999n }),
    ),
  ).toMatchObject({
    baseMonthlyMinor: 1_600_000n,
    monthlyPriceMinor: 960_000n,
    packagePriceMinor: 2_448_000n,
  });
  expect(
    calculateExpertCampaignPriceV2(v2Input({ ticketMinor: 300_000n }))
      .baseMonthlyMinor,
  ).toBe(900_000n);
});
it("v2 rounds the whole package once rather than multiplying rounded months", () => {
  expect(
    calculateExpertCampaignPriceV2(v2Input({ categoryRateMinor: 1_000_007n })),
  ).toMatchObject({
    monthlyPriceMinor: 600_004n,
    packagePriceMinor: 1_530_011n,
  });
  expect(
    calculateExpertCampaignPriceV2(v2Input({ categoryRateMinor: 1_000_050n }))
      .packagePriceMinor,
  ).toBe(1_530_077n);
});
it("v2 space pricing requires an explicit rate and uses ten percent package discount", () => {
  expect(
    calculateExpertCampaignPriceV2(
      v2Input({ participantKind: "space", categoryRateMinor: 2_000_000n }),
    ),
  ).toMatchObject({
    packageDiscountBps: 1000,
    monthlyPriceMinor: 1_200_000n,
    packagePriceMinor: 3_240_000n,
  });
});
it("v2 floors monthly and package independently", () => {
  expect(
    calculateExpertCampaignPriceV2(v2Input({ categoryRateMinor: 100_000n })),
  ).toMatchObject({
    monthlyPriceMinor: 500_000n,
    packagePriceMinor: 1_500_000n,
    monthlyFloorApplied: true,
    packageFloorApplied: true,
  });
});
it.each([
  { categoryRateMinor: 0n },
  { categoryRateMinor: -1n },
  { categoryRateMinor: 9_223_372_036_854_775_808n },
  { categoryRateMinor: undefined },
  { millionCity: "yes" },
  { onlineOnly: null },
  { ticketMinor: -1n },
  { participantKind: "partner" },
  { quotedAtMs: anchor - 1 },
  { firstOfferAtMs: NaN },
  { quotedAtMs: anchor + 0.5 },
  { quotedAtMs: Infinity },
  { firstOfferAtMs: -1 },
  { categoryRateMinor: 9_223_372_036_854_775_807n, millionCity: true },
])("v2 rejects invalid or overflowing input %#", (overrides) => {
  expect(() => calculateExpertCampaignPriceV2(v2Input(overrides))).toThrow(
    "expert_campaign_price_invalid",
  );
});
it("v2 returns frozen values without mutating the offer anchor", () => {
  const original = Object.freeze(v2Input());
  const result = calculateExpertCampaignPriceV2(original);
  expect(Object.isFrozen(result)).toBe(true);
  expect(original.firstOfferAtMs).toBe(anchor);
});
