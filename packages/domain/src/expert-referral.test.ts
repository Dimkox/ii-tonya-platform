import { describe, expect, it } from "vitest";
import {
  allocateCreditFifo,
  applyRewardToDebt,
  nextResidencyInterval,
  quoteResidency,
  rewardExpiresAt,
  resolveRewardReversal,
  settlementBeforeDeadline,
} from "./expert-referral.js";

describe("expert referral financial rules", () => {
  it("rejects the mutation that rounds the 50% credit cap up", () => {
    expect(quoteResidency(999n, 999n)).toEqual({
      creditMinor: 499n,
      cashMinor: 500n,
    });
  });

  it("rejects the mutation that uses a calendar year instead of exactly 365 days", () => {
    expect(rewardExpiresAt(new Date("2026-08-03T00:00:00.000Z"))).toEqual(
      new Date("2027-08-03T00:00:00.000Z"),
    );
  });

  it("rejects the mutation that starts a settled renewal before the current interval ends", () => {
    expect(nextResidencyInterval({
      currentEndsAt: new Date("2026-09-01T00:00:00.000Z"),
      settledAt: new Date("2026-08-03T00:00:00.000Z"),
      durationSeconds: 2_592_000,
    })).toEqual({
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-10-01T00:00:00.000Z"),
    });
  });

  it("rejects the mutation that allocates credit in grant insertion order instead of FIFO order", () => {
    expect(allocateCreditFifo({
      at: new Date("2026-08-03T00:00:00.000Z"),
      allocationMinor: 80n,
      grants: [
        {
          grantId: "later-expiry",
          availableMinor: 70n,
          grantedAt: new Date("2026-07-02T00:00:00.000Z"),
          expiresAt: new Date("2026-10-01T00:00:00.000Z"),
        },
        {
          grantId: "first-by-id",
          availableMinor: 30n,
          grantedAt: new Date("2026-07-01T00:00:00.000Z"),
          expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        },
        {
          grantId: "second-by-id",
          availableMinor: 40n,
          grantedAt: new Date("2026-07-01T00:00:00.000Z"),
          expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        },
      ],
    })).toEqual([
      { grantId: "first-by-id", amountMinor: 30n },
      { grantId: "second-by-id", amountMinor: 40n },
      { grantId: "later-expiry", amountMinor: 10n },
    ]);
  });

  it("rejects the mutation that allocates expired credit or silently under-allocates", () => {
    expect(() => allocateCreditFifo({
      at: new Date("2026-08-03T00:00:00.000Z"),
      allocationMinor: 1n,
      grants: [{
        grantId: "expired",
        availableMinor: 1n,
        grantedAt: new Date("2026-07-01T00:00:00.000Z"),
        expiresAt: new Date("2026-08-03T00:00:00.000Z"),
      }],
    })).toThrow("insufficient_credit");
  });

  it("rejects the mutation that returns spent grant value as credit after a reversal", () => {
    expect(resolveRewardReversal({
      rewardStatus: "granted",
      unspentMinor: 20_000n,
      reservedMinor: 30_000n,
      spentMinor: 50_000n,
    })).toEqual({
      remove: 20_000n,
      cancelReservations: 30_000n,
      debt: 50_000n,
    });
  });

  it("rejects the mutation that grants credit after a held entitlement is cancelled by refund", () => {
    expect(resolveRewardReversal({
      rewardStatus: "pending_feature_hold",
      unspentMinor: 0n,
      reservedMinor: 0n,
      spentMinor: 0n,
    })).toEqual({ remove: 0n, cancelReservations: 0n, debt: 0n });
    expect(resolveRewardReversal({
      rewardStatus: "cancelled_by_refund",
      unspentMinor: 0n,
      reservedMinor: 0n,
      spentMinor: 0n,
    })).toEqual({ remove: 0n, cancelReservations: 0n, debt: 0n });
  });

  it("rejects the mutation that creates spendable reward credit before repaying debt", () => {
    expect(applyRewardToDebt(120_000n)).toEqual({
      debtRepaidMinor: 100_000n,
      creditMinor: 0n,
      remainingDebtMinor: 20_000n,
    });
    expect(applyRewardToDebt(25_000n)).toEqual({
      debtRepaidMinor: 25_000n,
      creditMinor: 75_000n,
      remainingDebtMinor: 0n,
    });
  });

  it("rejects the mutation that settles at the payment deadline", () => {
    const deadline = new Date("2026-08-03T00:00:00.000Z");
    expect(settlementBeforeDeadline(new Date("2026-08-02T23:59:59.999Z"), deadline)).toBe(true);
    expect(settlementBeforeDeadline(deadline, deadline)).toBe(false);
  });

  it("rejects invalid money, dates, overflow, and duration values", () => {
    expect(() => quoteResidency(0n, 0n)).toThrow("invalid_money");
    expect(() => quoteResidency(1n, -1n)).toThrow("invalid_money");
    expect(() => quoteResidency(9_223_372_036_854_775_808n, 0n)).toThrow("invalid_money");
    expect(() => rewardExpiresAt(new Date("invalid"))).toThrow("invalid_date");
    expect(() => nextResidencyInterval({
      currentEndsAt: new Date("2026-08-03T00:00:00.000Z"),
      settledAt: new Date("2026-08-03T00:00:00.000Z"),
      durationSeconds: 86_399,
    })).toThrow("invalid_duration");
    expect(() => nextResidencyInterval({
      currentEndsAt: new Date("2026-08-03T00:00:00.000Z"),
      settledAt: new Date("2026-08-03T00:00:00.000Z"),
      durationSeconds: 315_360_001,
    })).toThrow("invalid_duration");
  });
});
