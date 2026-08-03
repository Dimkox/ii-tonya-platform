import { describe, expect, it } from "vitest";
import {
  minPaymentDeadline,
  parseMoneySnapshot,
  validateTariffVersionCommand,
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

  it.each([
    { priceMinor: 0n },
    { priceMinor: -1n },
    { priceMinor: 1_000_000_000_000n },
    { priceMinor: Number.NaN as unknown as bigint },
    { priceMinor: 1.5 as unknown as bigint },
    { priceMinor: Number.MAX_SAFE_INTEGER as unknown as bigint },
    { durationSeconds: Number.NaN },
    { durationSeconds: 86400.5 },
    { durationSeconds: Number.MAX_SAFE_INTEGER + 1 },
    { tariffKey: "" },
    { tariffKey: "x".repeat(129) },
    { displayName: "   " },
    { displayName: "x".repeat(257) },
  ])("rejects unstable tariff input %#", (override) => {
    expect(() =>
      validateTariffVersionCommand({
        tariffKey: "base",
        displayName: "Base",
        priceMinor: 100000n,
        durationSeconds: 86400,
        activeFrom: new Date("2026-08-03T10:00:00Z"),
        activeTo: new Date("2026-08-04T10:00:00Z"),
        approvalId: "00000000-0000-4000-8000-000000000001",
        adminSessionIdHash: "session",
        ...override,
      }),
    ).toThrowError(/Invalid tariff version/);
  });
});
