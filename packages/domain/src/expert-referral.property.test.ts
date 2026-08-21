import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  allocateCreditFifo,
  applyRewardToDebt,
  quoteResidency,
  resolveRewardReversal,
  rewardExpiresAt,
  type ReferralCreditGrant,
} from "./expert-referral.js";

const maxPostgresBigint = 9_223_372_036_854_775_807n;
const at = new Date("2026-08-03T00:00:00.000Z");
const fifoGrants: ReferralCreditGrant[] = [
  {
    grantId: "third",
    availableMinor: 10n,
    grantedAt: new Date("2026-07-03T00:00:00.000Z"),
    expiresAt: new Date("2026-09-03T00:00:00.000Z"),
  },
  {
    grantId: "second",
    availableMinor: 10n,
    grantedAt: new Date("2026-07-02T00:00:00.000Z"),
    expiresAt: new Date("2026-09-02T00:00:00.000Z"),
  },
  {
    grantId: "first",
    availableMinor: 10n,
    grantedAt: new Date("2026-07-01T00:00:00.000Z"),
    expiresAt: new Date("2026-09-01T00:00:00.000Z"),
  },
];

describe("expert referral financial properties", () => {
  it("rejects the mutation that lets a quote exceed half-credit or lose money", () => {
    fc.assert(fc.property(
      fc.bigInt({ min: 1n, max: maxPostgresBigint }),
      fc.bigInt({ min: 0n, max: maxPostgresBigint }),
      (price, available) => {
        const quote = quoteResidency(price, available);
        return quote.creditMinor * 2n <= price
          && quote.cashMinor + quote.creditMinor === price
          && quote.creditMinor >= 0n
          && quote.cashMinor >= 0n;
      },
    ), { numRuns: 500 });
  });

  it("rejects the mutation that makes FIFO allocation depend on input order", () => {
    fc.assert(fc.property(
      fc.shuffledSubarray(fifoGrants, { minLength: 3, maxLength: 3 }),
      (grants) => {
        expect(allocateCreditFifo({ at, allocationMinor: 25n, grants }).map(({ grantId }) => grantId))
          .toEqual(["first", "second", "third"]);
      },
    ), { numRuns: 100 });
  });

  it("rejects the mutation that creates a negative available balance from an exact allocation", () => {
    fc.assert(fc.property(
      fc.bigInt({ min: 0n, max: 100_000n }),
      (availableMinor) => {
        const allocation = allocateCreditFifo({
          at,
          allocationMinor: availableMinor,
          grants: [{
            grantId: "grant",
            availableMinor,
            grantedAt: new Date("2026-07-01T00:00:00.000Z"),
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          }],
        });
        const allocatedMinor = allocation.reduce((total, value) => total + value.amountMinor, 0n);
        expect(availableMinor - allocatedMinor).toBeGreaterThanOrEqual(0n);
        expect(allocatedMinor).toBe(availableMinor);
      },
    ), { numRuns: 200 });
  });

  it("rejects the mutation that shortens or lengthens the 365-day reward expiry", () => {
    fc.assert(fc.property(
      fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 11, 31) }),
      (grantedAtMilliseconds) => {
        const grantedAt = new Date(grantedAtMilliseconds);
        expect(rewardExpiresAt(grantedAt).getTime()).toBe(grantedAtMilliseconds + 31_536_000_000);
      },
    ), { numRuns: 200 });
  });

  it("rejects the mutation that re-applies a cancelled or held reward reversal", () => {
    fc.assert(fc.property(
      fc.constantFrom<"pending_feature_hold" | "cancelled_by_refund" | "reversed">(
        "pending_feature_hold",
        "cancelled_by_refund",
        "reversed",
      ),
      (rewardStatus) => {
        const reversal = resolveRewardReversal({
          rewardStatus,
          unspentMinor: 0n,
          reservedMinor: 0n,
          spentMinor: 0n,
        });
        expect(reversal).toEqual({ remove: 0n, cancelReservations: 0n, debt: 0n });
      },
    ), { numRuns: 100 });
  });

  it("rejects the mutation that loses reward value while debt-repaying", () => {
    fc.assert(fc.property(
      fc.bigInt({ min: 0n, max: maxPostgresBigint }),
      (debtMinor) => {
        const result = applyRewardToDebt(debtMinor);
        expect(result.debtRepaidMinor + result.creditMinor).toBe(100_000n);
        expect(result.remainingDebtMinor + result.debtRepaidMinor).toBe(debtMinor);
      },
    ), { numRuns: 500 });
  });
});
