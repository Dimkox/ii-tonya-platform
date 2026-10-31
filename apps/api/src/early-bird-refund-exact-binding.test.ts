import { expect, it, vi } from "vitest";
import { resolveWithEarlyBirdBinding } from "./early-bird-payment-purpose-resolver.js";
it("requires an exact legacy refund/payment/order binding before routing a refund", async () => {
  const legacy = async () => "MAIN_SUBSCRIPTION" as const;
  const exact = vi.fn().mockResolvedValue(false);
  const resolve = resolveWithEarlyBirdBinding(
    legacy,
    async () => null,
    async () => ({ id: "r1", paymentId: "p1", status: "succeeded" as const }),
    exact,
  );
  expect(await resolve("r1", "refund.succeeded")).toBeNull();
  expect(exact).toHaveBeenCalledWith("r1", "p1");
  exact.mockResolvedValue(true);
  expect(await resolve("r1", "refund.succeeded")).toBe("MAIN_SUBSCRIPTION");
});
