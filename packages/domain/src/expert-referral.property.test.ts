import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  allocateCreditFifo,
  applyRewardToDebt,
  POSTGRES_BIGINT_MAX,
  quoteResidency,
  resolveRewardReversal,
} from "./expert-referral.js";

describe("expert referral residency properties", () => {
  it("conserves every valid residency quote within the fifty-percent credit cap", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: POSTGRES_BIGINT_MAX }),
        fc.bigInt({ min: 0n, max: POSTGRES_BIGINT_MAX }),
        (price, available) => {
          const quote = quoteResidency(price, available);
          return (
            quote.creditMinor * 2n <= price &&
            quote.cashMinor + quote.creditMinor === price
          );
        },
      ),
    );
  });

  it("conserves every valid residency quote within its configured credit cap", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: POSTGRES_BIGINT_MAX }),
        fc.bigInt({ min: 0n, max: POSTGRES_BIGINT_MAX }),
        fc.integer({ min: 0, max: 10_000 }),
        (price, available, capBps) => {
          const quote = quoteResidency(price, available, capBps);
          return (
            quote.creditMinor * 10_000n <= price * BigInt(capBps) &&
            quote.cashMinor + quote.creditMinor === price
          );
        },
      ),
    );
  });

  it("allocates FIFO stably regardless of input ordering", () => {
    const grantedAt = new Date("2026-01-01T00:00:00.000Z");
    const grants = [
      {
        grantId: "a",
        availableMinor: 1n,
        grantedAt,
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      {
        grantId: "b",
        availableMinor: 1n,
        grantedAt,
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      {
        grantId: "c",
        availableMinor: 1n,
        grantedAt,
        expiresAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    ] as const;

    fc.assert(
      fc.property(fc.boolean(), (reverse) => {
        const input = reverse ? [...grants].reverse() : [...grants];
        expect(
          allocateCreditFifo(input, 2n, new Date("2026-08-03T00:00:00.000Z")),
        ).toEqual([
          { grantId: "a", amountMinor: 1n },
          { grantId: "b", amountMinor: 1n },
        ]);
      }),
    );
  });

  it("never makes a reward application create a negative balance", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: POSTGRES_BIGINT_MAX }),
        fc.bigInt({ min: 0n, max: POSTGRES_BIGINT_MAX }),
        (reward, debt) => {
          const applied = applyRewardToDebt(reward, debt);
          return (
            applied.creditMinor >= 0n &&
            applied.remainingDebtMinor >= 0n &&
            applied.debtRepaidMinor <= reward &&
            applied.debtRepaidMinor <= debt
          );
        },
      ),
    );
  });

  it("treats expiry equality as unavailable credit", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: POSTGRES_BIGINT_MAX }),
        (amountMinor) => {
          const at = new Date("2026-08-03T00:00:00.000Z");
          expect(() =>
            allocateCreditFifo(
              [
                {
                  grantId: "expires-now",
                  availableMinor: amountMinor,
                  grantedAt: new Date("2026-01-01T00:00:00.000Z"),
                  expiresAt: at,
                },
              ],
              amountMinor,
              at,
            ),
          ).toThrow("insufficient_credit");
        },
      ),
    );
  });

  it("keeps reversals replay-stable and inert for held or cancelled rewards", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 3_000_000_000_000_000_000n }),
        fc.bigInt({ min: 0n, max: 3_000_000_000_000_000_000n }),
        fc.bigInt({ min: 0n, max: 3_000_000_000_000_000_000n }),
        (availableMinor, reservedMinor, spentMinor) => {
          const input = {
            grantMinor: availableMinor + reservedMinor + spentMinor,
            availableMinor,
            reservedMinor,
            spentMinor,
            expiresAt: new Date("2027-08-03T00:00:00.000Z"),
            reversedAt: new Date("2026-08-03T00:00:00.000Z"),
            alreadyReversed: true,
          } as const;
          const empty = { remove: 0n, cancelReservations: 0n, debt: 0n };

          expect(resolveRewardReversal(input)).toEqual(empty);
          expect(
            resolveRewardReversal({
              ...input,
              alreadyReversed: false,
              rewardStatus: "pending_feature_hold",
            }),
          ).toEqual(empty);
          expect(
            resolveRewardReversal({
              ...input,
              alreadyReversed: false,
              rewardStatus: "cancelled_by_refund",
            }),
          ).toEqual(empty);
        },
      ),
    );
  });
});
