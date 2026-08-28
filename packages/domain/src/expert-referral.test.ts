import { describe, expect, it } from "vitest";
import {
  allocateCreditFifo,
  applyRewardToDebt,
  nextResidencyInterval,
  quoteResidency,
  resolveRewardReversal,
  rewardExpiresAt,
  settlementBeforeDeadline,
} from "./expert-referral.js";

describe("expert referral residency rules", () => {
  it("quotes no more than half of a residency price as credit", () => {
    expect(quoteResidency(999n, 999n)).toEqual({
      creditMinor: 499n,
      cashMinor: 500n,
    });
  });

  it("quotes residency credit using the requested cap", () => {
    expect(quoteResidency(999n, 999n, 3000)).toEqual({
      creditMinor: 299n,
      cashMinor: 700n,
    });
  });

  it.each([-1, 10_001])("rejects an invalid credit cap: %s", (creditCapBps) => {
    expect(() => quoteResidency(100n, 100n, creditCapBps)).toThrow(
      "invalid_credit_cap",
    );
  });

  it("allocates the exact requested credit in expiry, grant, and id order", () => {
    expect(
      allocateCreditFifo(
        [
          {
            grantId: "later",
            availableMinor: 400n,
            grantedAt: new Date("2026-01-01T00:00:00.000Z"),
            expiresAt: new Date("2026-10-01T00:00:00.000Z"),
          },
          {
            grantId: "second",
            availableMinor: 400n,
            grantedAt: new Date("2026-01-02T00:00:00.000Z"),
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          },
          {
            grantId: "first",
            availableMinor: 400n,
            grantedAt: new Date("2026-01-01T00:00:00.000Z"),
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          },
        ],
        500n,
        new Date("2026-08-03T00:00:00.000Z"),
      ),
    ).toEqual([
      { grantId: "first", amountMinor: 400n },
      { grantId: "second", amountMinor: 100n },
    ]);
  });

  it("sets reward expiry exactly 365 UTC days after granting", () => {
    expect(rewardExpiresAt(new Date("2026-08-03T00:00:00.000Z"))).toEqual(
      new Date("2027-08-03T00:00:00.000Z"),
    );
  });

  it("removes active credit, cancels reservations, and records spent credit as debt once", () => {
    const reversal = {
      grantMinor: 1_000n,
      availableMinor: 300n,
      reservedMinor: 200n,
      spentMinor: 500n,
      expiresAt: new Date("2027-08-03T00:00:00.000Z"),
      reversedAt: new Date("2026-08-03T00:00:00.000Z"),
      alreadyReversed: false,
    } as const;

    expect(resolveRewardReversal(reversal)).toEqual({
      remove: 300n,
      cancelReservations: 200n,
      debt: 500n,
    });
    expect(
      resolveRewardReversal({ ...reversal, alreadyReversed: true }),
    ).toEqual({
      remove: 0n,
      cancelReservations: 0n,
      debt: 0n,
    });
  });

  it.each(["pending_feature_hold", "cancelled_by_refund"] as const)(
    "has no referral balance effect for %s",
    (rewardStatus) => {
      expect(
        resolveRewardReversal({
          grantMinor: 1_000n,
          availableMinor: 300n,
          reservedMinor: 200n,
          spentMinor: 500n,
          expiresAt: new Date("2027-08-03T00:00:00.000Z"),
          reversedAt: new Date("2026-08-03T00:00:00.000Z"),
          alreadyReversed: false,
          rewardStatus,
        }),
      ).toEqual({
        remove: 0n,
        cancelReservations: 0n,
        debt: 0n,
      });
    },
  );

  it("uses a future reward to repay debt before creating spendable credit", () => {
    expect(applyRewardToDebt(1_000n, 600n)).toEqual({
      debtRepaidMinor: 600n,
      creditMinor: 400n,
      remainingDebtMinor: 0n,
    });
  });

  it("extends residency from the later of its end and settlement time", () => {
    expect(
      nextResidencyInterval({
        currentEndsAt: new Date("2026-09-01T00:00:00.000Z"),
        settledAt: new Date("2026-08-03T00:00:00.000Z"),
        durationSeconds: 2_592_000,
      }),
    ).toEqual({
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-10-01T00:00:00.000Z"),
    });
  });

  it("rejects deadline equality", () => {
    const deadline = new Date("2026-08-03T00:00:00.000Z");
    expect(settlementBeforeDeadline(deadline, deadline)).toBe(false);
  });
});
