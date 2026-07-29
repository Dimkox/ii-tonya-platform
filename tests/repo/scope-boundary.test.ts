import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MVP scope boundary", () => {
  it("contains no live or deferred commercial and scheduling modules", () => {
    const forbidden = [
      "packages/integrations/src/payment/live-payment-adapter.ts",
      "packages/domain/src/coupon.ts",
      "packages/domain/src/referral.ts",
      "packages/domain/src/reschedule.ts",
      "packages/domain/src/waitlist.ts",
    ];

    expect(forbidden.filter(existsSync)).toEqual([]);
  });

  it("keeps the payment integration directory limited to the disabled boundary", () => {
    const paymentDirectory = "packages/integrations/src/payment";
    if (!existsSync(paymentDirectory)) return;

    expect(readdirSync(paymentDirectory).sort()).toEqual([
      "disabled-payment-adapter.test.ts",
      "disabled-payment-adapter.ts",
      "payment-port.ts",
    ]);
  });
});
