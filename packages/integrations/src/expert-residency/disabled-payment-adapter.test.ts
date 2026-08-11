import { describe, expect, it } from "vitest";
import { DisabledExpertResidencyPaymentAdapter } from "./disabled-payment-adapter.js";
describe("disabled expert residency payments", () => {
  it("fails checkout closed and reports no reconciliation", async () => {
    const adapter = new DisabledExpertResidencyPaymentAdapter();
    await expect(adapter.createCheckout({ orderId: "00000000-0000-4000-8000-000000000001", amountMinor: "1", currency: "RUB", idempotencyKey: "checkout-1" })).rejects.toThrow("expert_residency_payments_disabled");
    await expect(adapter.reconcile("pay_1")).resolves.toBeNull();
  });
});
