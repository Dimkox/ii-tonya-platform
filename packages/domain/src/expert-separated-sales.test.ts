import { describe, expect, it } from "vitest";
import {
  calculateExpertBasePrice,
  calculateSeparatedSalesTerms,
} from "./expert-separated-sales.js";
const base = {
  categoryRateMinor: 1000000n,
  millionCity: true,
  onlineOnly: true,
  ticketMinor: 200000n,
};
describe("separated sales immutable-base arithmetic", () => {
  it("calculates base without campaign discounts", () => {
    expect(calculateExpertBasePrice(base)).toBe(1700000n);
  });
  it.each([
    [0, 4000, 1500],
    [96, 3000, 1000],
    [168, 2000, 0],
    [240, 0, 0],
  ])("retains full-day stage %s", (hours, energy, pack) => {
    const t = calculateSeparatedSalesTerms({
      baseMonthlyMinor: 1700000n,
      participantKind: "expert",
      firstOfferAtMs: 0,
      quotedAtMs: hours * 3600000,
      promotion: true,
      termMonths: 1,
    });
    expect(t.energyDiscountBps).toBe(energy);
    expect(t.packageDiscountBps).toBe(pack);
  });
  it("distinguishes package total from monthly and applies final floors", () => {
    expect(
      calculateSeparatedSalesTerms({
        baseMonthlyMinor: 1000000n,
        participantKind: "expert",
        firstOfferAtMs: 0,
        quotedAtMs: 0,
        promotion: true,
        termMonths: 3,
      }),
    ).toMatchObject({
      monthlyPriceMinor: 600000n,
      packagePriceMinor: 1530000n,
      selectedTotalMinor: 1530000n,
    });
    expect(
      calculateSeparatedSalesTerms({
        baseMonthlyMinor: 100000n,
        participantKind: "space",
        firstOfferAtMs: 0,
        quotedAtMs: 0,
        promotion: true,
        termMonths: 3,
      }).selectedTotalMinor,
    ).toBe(1500000n);
  });
  it("shows the same floored base that an explicit monthly refusal accepts", () => {
    const displayed = calculateExpertBasePrice({
      categoryRateMinor: 499000n,
      millionCity: false,
      onlineOnly: false,
      ticketMinor: 100000n,
    });
    expect(displayed).toBe(500000n);
    expect(
      calculateSeparatedSalesTerms({
        baseMonthlyMinor: displayed,
        participantKind: "expert",
        firstOfferAtMs: 0,
        quotedAtMs: 0,
        promotion: false,
        termMonths: 1,
      }).selectedTotalMinor,
    ).toBe(displayed);
  });
  it("does not discount a declined promotion", () => {
    expect(
      calculateSeparatedSalesTerms({
        baseMonthlyMinor: 1700000n,
        participantKind: "expert",
        firstOfferAtMs: 0,
        quotedAtMs: 0,
        promotion: false,
        termMonths: 3,
      }),
    ).toMatchObject({
      energyDiscountBps: 0,
      packageDiscountBps: 0,
      selectedTotalMinor: 5100000n,
    });
  });
  it("requires fresh owner choice when a package disappears", () => {
    expect(() =>
      calculateSeparatedSalesTerms({
        baseMonthlyMinor: 1700000n,
        participantKind: "expert",
        firstOfferAtMs: 0,
        quotedAtMs: 168 * 3600000,
        promotion: true,
        termMonths: 3,
      }),
    ).toThrow("expert_sales_period_unavailable");
  });
  it("does not trust invalid money, periods or clocks", () => {
    expect(() =>
      calculateExpertBasePrice({ ...base, categoryRateMinor: -1n }),
    ).toThrow();
    expect(() =>
      calculateSeparatedSalesTerms({
        baseMonthlyMinor: 1700000n,
        participantKind: "expert",
        firstOfferAtMs: 1,
        quotedAtMs: 0,
        promotion: true,
        termMonths: 1,
      }),
    ).toThrow();
  });
});
