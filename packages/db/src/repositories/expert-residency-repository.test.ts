import { describe, expect, it } from "vitest";
import {
  minPaymentDeadline,
  parseMoneySnapshot,
} from "./expert-residency-repository.js";

describe("expert residency repository boundaries", () => {
  it("serializes money and uses the earliest deadline", () => {
    expect(
      parseMoneySnapshot({
        priceMinor: 250001n,
        creditMinor: 125000n,
        cashMinor: 125001n,
      }),
    ).toEqual({
      priceMinor: "250001",
      creditMinor: "125000",
      cashMinor: "125001",
    });
    expect(
      minPaymentDeadline(
        new Date("2026-08-03T12:00:00Z"),
        new Date("2026-08-03T11:00:00Z"),
      ),
    ).toEqual(new Date("2026-08-03T11:00:00Z"));
  });
});
