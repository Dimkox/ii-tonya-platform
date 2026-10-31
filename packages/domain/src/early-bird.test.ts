import { describe, expect, it } from "vitest";
import {
  calculateEarlyBirdQuote,
  EARLY_BIRD_CLIENT_START_MS,
} from "./early-bird.js";

const offer = Date.parse("2026-11-01T12:00:00Z");
const input = {
  baseMonthlyMinor: 1000000n,
  firstOfferAtMs: offer,
  quotedAtMs: offer,
  onboardingPaid: false,
};

describe("early bird quote", () => {
  it("combines onboarding and the discounted monthly fee in one amount", () => {
    expect(calculateEarlyBirdQuote(input)).toMatchObject({
      onboardingMinor: 300000n,
      monthlyMinor: 600000n,
      totalMinor: 900000n,
      discountBps: 4000,
      discounted: true,
    });
    expect(new Date(EARLY_BIRD_CLIENT_START_MS).toISOString()).toBe(
      "2027-01-10T21:00:00.000Z",
    );
  });
  it.each([
    [96, 3000, 700000n],
    [168, 2000, 800000n],
    [240, 0, 1000000n],
  ])(
    "applies the existing stage at hour %s",
    (hours, discountBps, monthlyMinor) => {
      expect(
        calculateEarlyBirdQuote({
          ...input,
          quotedAtMs: offer + hours * 3600000,
        }),
      ).toMatchObject({ discountBps, monthlyMinor });
    },
  );
  it("ends eligibility exactly ten days after the offer", () => {
    expect(
      calculateEarlyBirdQuote({
        ...input,
        quotedAtMs: offer + 240 * 3600000 - 1,
      }).discounted,
    ).toBe(true);
    expect(
      calculateEarlyBirdQuote({ ...input, quotedAtMs: offer + 240 * 3600000 })
        .discounted,
    ).toBe(false);
  });
  it("removes the promotion when onboarding is already paid", () => {
    expect(
      calculateEarlyBirdQuote({ ...input, onboardingPaid: true }),
    ).toMatchObject({
      onboardingMinor: 0n,
      monthlyMinor: 1000000n,
      totalMinor: 1000000n,
      discountBps: 0,
      discounted: false,
    });
  });
  it("retains promotion eligibility without claiming a discount absorbed by the price floor", () => {
    expect(
      calculateEarlyBirdQuote({ ...input, baseMonthlyMinor: 500000n }),
    ).toMatchObject({
      promotionEligible: true,
      discounted: false,
      monthlyMinor: 500000n,
    });
  });
  it("rejects a quote before the offer", () => {
    expect(() =>
      calculateEarlyBirdQuote({ ...input, quotedAtMs: offer - 1 }),
    ).toThrow();
  });
});
