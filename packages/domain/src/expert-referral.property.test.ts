import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  allocateCreditFifo,
  applyRewardToDebt,
  quoteResidency,
  resolveRewardReversal,
  rewardExpiresAt,
  spendableReferralCredit,
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

  it("rejects the mutation that makes positive debt leave referral credit spendable", () => {
    fc.assert(fc.property(
      fc.bigInt({ min: 0n, max: maxPostgresBigint }),
      fc.bigInt({ min: 1n, max: maxPostgresBigint }),
      (availableMinor, debtMinor) => {
        expect(spendableReferralCredit(availableMinor, debtMinor)).toBe(0n);
      },
    ), { numRuns: 500 });
  });

  it("rejects the mutation that re-applies a cancelled reward reversal with nonzero allocations", () => {
    fc.assert(fc.property(
      fc.constantFrom<"cancelled_by_refund" | "reversed">(
        "cancelled_by_refund",
        "reversed",
      ),
      fc.integer({ min: 1, max: 99_998 }),
      (rewardStatus, activeMinorNumber) => {
        const activeMinor = BigInt(activeMinorNumber);
        const reservedMinor = BigInt(99_999 - activeMinorNumber);
        const reversal = resolveRewardReversal({
          rewardStatus,
          reversedAt: at,
          allocations: [
            {
              state: "active",
              amountMinor: activeMinor,
              expiresAt: new Date("2026-09-01T00:00:00.000Z"),
            },
            {
              state: "reserved",
              amountMinor: reservedMinor,
              expiresAt: new Date("2026-09-01T00:00:00.000Z"),
            },
            {
              state: "spent",
              amountMinor: 1n,
              expiresAt: new Date("2026-09-01T00:00:00.000Z"),
            },
          ],
        });
        expect(reversal).toEqual({ remove: 0n, cancelReservations: 0n, debt: 0n });
      },
    ), { numRuns: 100 });
  });

  it("rejects the mutation that requires a cancelled held reward to have grant allocations", () => {
    fc.assert(fc.property(
      fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 11, 31) }),
      (reversedAtMilliseconds) => {
        expect(resolveRewardReversal({
          rewardStatus: "cancelled_by_refund",
          reversedAt: new Date(reversedAtMilliseconds),
          allocations: [],
        })).toEqual({ remove: 0n, cancelReservations: 0n, debt: 0n });
      },
    ), { numRuns: 200 });
  });

  it("rejects the mutation that repeats financial effects after a granted reward is reversed", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 99_998 }),
      (activeMinorNumber) => {
        const activeMinor = BigInt(activeMinorNumber);
        const reservedMinor = BigInt(99_999 - activeMinorNumber);
        const allocations = [
          {
            state: "active" as const,
            amountMinor: activeMinor,
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          },
          {
            state: "reserved" as const,
            amountMinor: reservedMinor,
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          },
          {
            state: "spent" as const,
            amountMinor: 1n,
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          },
        ];
        expect(resolveRewardReversal({
          rewardStatus: "granted",
          reversedAt: at,
          allocations,
        })).toEqual({
          remove: activeMinor,
          cancelReservations: reservedMinor,
          debt: 1n,
        });
        expect(resolveRewardReversal({
          rewardStatus: "reversed",
          reversedAt: at,
          allocations,
        })).toEqual({ remove: 0n, cancelReservations: 0n, debt: 0n });
      },
    ), { numRuns: 200 });
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
