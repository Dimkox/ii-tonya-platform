import { expect, it, vi } from "vitest";
import { resolveWithEarlyBirdBinding } from "./early-bird-payment-purpose-resolver.js";
it("routes a verified composite payment and rejects cross-product ambiguity", async () => {
  const legacy = vi.fn().mockResolvedValue(null),
    findInvoice = vi.fn().mockResolvedValue("invoice");
  const resolve = resolveWithEarlyBirdBinding(legacy, findInvoice);
  expect(await resolve("payment", "payment.succeeded")).toBe(
    "COMBINED_EARLY_BIRD",
  );
  legacy.mockResolvedValue("MAIN_SUBSCRIPTION");
  await expect(resolve("payment", "payment.succeeded")).rejects.toThrow(
    "payment_purpose_ambiguous",
  );
});
it("does not infer a refund purpose from the refund ID and fails closed on reader failure", async () => {
  const legacy = vi.fn().mockResolvedValue(null),
    findInvoice = vi.fn().mockRejectedValue(new Error("unavailable"));
  const resolve = resolveWithEarlyBirdBinding(legacy, findInvoice);
  expect(await resolve("refund", "refund.succeeded")).toBeNull();
  expect(findInvoice).not.toHaveBeenCalled();
  await expect(resolve("payment", "payment.succeeded")).rejects.toThrow(
    "unavailable",
  );
});
