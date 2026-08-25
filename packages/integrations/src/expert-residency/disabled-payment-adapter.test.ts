import { describe, expect, it } from "vitest";
import { DisabledExpertResidencyPaymentAdapter } from "./disabled-payment-adapter.js";

describe("disabled expert residency payment adapter", () => {
  it("fails checkout closed and reconciles to no verified event without reading input", async () => {
    let reads = 0;
    const command = new Proxy(
      {
        orderId: "00000000-0000-4000-8000-000000000601",
        idempotencyKey: "checkout_00000001",
        amountMinor: "50000",
        currency: "RUB" as const,
        expiresAt: "2026-08-03T00:30:00.000Z",
      },
      {
        get() {
          reads += 1;
          throw new Error("disabled adapter inspected input");
        },
      },
    );

    await expect(
      new DisabledExpertResidencyPaymentAdapter().createCheckout(command),
    ).rejects.toThrow("expert_residency_payments_disabled");
    await expect(
      new DisabledExpertResidencyPaymentAdapter().reconcile("pay_00000001"),
    ).resolves.toBeNull();
    expect(reads).toBe(0);
  });
});
