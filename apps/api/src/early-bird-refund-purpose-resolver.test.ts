import { expect, it, vi } from "vitest";
import { resolveWithEarlyBirdBinding } from "./early-bird-payment-purpose-resolver.js";
const notice = { id: "r1", paymentId: "p1", status: "succeeded" as const };
it("preserves the legacy refund route only when refund and provider payment bind the same product", async () => {
  const legacy = vi.fn(async (_id: string, event: string) =>
    event === "refund.succeeded"
      ? ("MAIN_SUBSCRIPTION" as const)
      : ("MAIN_SUBSCRIPTION" as const),
  );
  const reader = vi.fn().mockResolvedValue(null),
    getRefund = vi.fn().mockResolvedValue(notice);
  const resolve = resolveWithEarlyBirdBinding(
    legacy,
    reader,
    getRefund,
    async () => true,
  );
  expect(await resolve("r1", "refund.succeeded")).toBe("MAIN_SUBSCRIPTION");
  expect(legacy).toHaveBeenCalledWith("r1", "refund.succeeded");
  expect(legacy).toHaveBeenCalledWith("p1", "payment.succeeded");
  expect(reader).toHaveBeenCalledWith("p1");
});
it("routes composite refunds only with fresh success and a matching composite payment binding", async () => {
  const resolve = resolveWithEarlyBirdBinding(
    async () => null,
    async (id) => (id === "p1" ? "invoice" : null),
    async () => notice,
  );
  expect(await resolve("r1", "refund.succeeded")).toBe("COMBINED_EARLY_BIRD");
});
it("rejects cross-product ambiguity, mismatched, pending, or inaccessible provider facts", async () => {
  const ambiguous = resolveWithEarlyBirdBinding(
    async () => "MAIN_SUBSCRIPTION",
    async () => "invoice",
    async () => notice,
  );
  await expect(ambiguous("r1", "refund.succeeded")).rejects.toThrow(
    "payment_purpose_ambiguous",
  );
  for (const bad of [
    { ...notice, id: "other" },
    { ...notice, status: "pending" as const },
    { ...notice, paymentId: "https://bad" },
  ]) {
    const resolve = resolveWithEarlyBirdBinding(
      async () => null,
      async () => "invoice",
      async () => bad,
    );
    await expect(resolve("r1", "refund.succeeded")).rejects.toThrow(
      "early_bird_refund_route_unverified",
    );
  }
  const missing = resolveWithEarlyBirdBinding(
    async () => null,
    async () => null,
    async () => {
      throw new Error("provider unavailable");
    },
  );
  await expect(missing("r1", "refund.succeeded")).rejects.toThrow(
    "provider unavailable",
  );
});
it("rejects an orphan refund binding when the parent payment belongs elsewhere", async () => {
  const legacy = async (_id: string, event: string) =>
    event === "refund.succeeded" ? ("MAIN_SUBSCRIPTION" as const) : null;
  const resolve = resolveWithEarlyBirdBinding(
    legacy,
    async () => null,
    async () => notice,
  );
  expect(await resolve("r1", "refund.succeeded")).toBeNull();
});
