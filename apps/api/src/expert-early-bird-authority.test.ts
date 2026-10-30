import { expect, it } from "vitest";
import { hasEarlyBirdSavings } from "./expert-early-bird-authority.js";

it("only advertises a discount when the authoritative monthly amount is lower than base", () => {
  expect(
    hasEarlyBirdSavings({
      standardOnly: false,
      baseMonthlyMinor: "500000",
      monthlyPriceMinor: "500000",
    }),
  ).toBe(false);
  expect(
    hasEarlyBirdSavings({
      standardOnly: false,
      baseMonthlyMinor: "800000",
      monthlyPriceMinor: "500000",
    }),
  ).toBe(true);
  expect(
    hasEarlyBirdSavings({
      standardOnly: true,
      baseMonthlyMinor: "800000",
      monthlyPriceMinor: "500000",
    }),
  ).toBe(false);
  expect(
    hasEarlyBirdSavings({
      standardOnly: false,
      baseMonthlyMinor: "800000",
      monthlyPriceMinor: null,
    }),
  ).toBe(false);
});
