import { expect, it } from "vitest";
import {
  YooKassaDeferredVerifier,
  assertVerifiedDeferredPayment,
  type DeferredSnapshot,
} from "./early-bird-deferred-verifier.js";

it("verifies both owner payment stages by fresh provider GET and rejects forged proofs or amounts", async () => {
  const id = () => crypto.randomUUID();
  const source: DeferredSnapshot = {
    invoiceId: id(),
    userId: id(),
    operationId: id(),
    grantId: id(),
    policy: "owner_test_10_20_v1",
    stage: "onboarding",
    amountMinor: "1000",
    mode: "live",
    launchAt: "2027-01-11T00:00:00+03:00",
  };
  let value = "10.00";
  let status: "pending" | "succeeded" = "pending";
  const verifier = new YooKassaDeferredVerifier(
    {
      getPayment: async () => ({
        id: "provider1",
        status,
        paid: status === "succeeded",
        test: false,
        amount: { value, currency: "RUB" },
        createdAt: "2026-12-01T00:00:00Z",
        ...(status === "succeeded"
          ? { capturedAt: "2026-12-01T00:01:00Z" }
          : {}),
        metadata: {
          order_id: source.invoiceId,
          operation_id: source.operationId,
          user_id: source.userId,
          purpose: "early_bird_deferred",
          stage: source.stage,
          pricing_policy: source.policy,
          pricing_grant_id: source.grantId!,
        },
      }),
    } as never,
    { findInvoice: async () => source },
  );
  const pending = await verifier.verify(source.invoiceId, "provider1");
  expect(() => assertVerifiedDeferredPayment(pending, verifier)).not.toThrow();
  expect(() =>
    assertVerifiedDeferredPayment({ ...pending }, verifier),
  ).toThrow();
  status = "succeeded";
  const succeeded = await verifier.verify(source.invoiceId, "provider1");
  expect(succeeded.evidenceDigest).toBe(pending.evidenceDigest);
  value = "20.00";
  await expect(
    verifier.verify(source.invoiceId, "provider1"),
  ).rejects.toThrow();
  source.stage = "subscription";
  source.amountMinor = "2000";
  expect(
    (await verifier.verify(source.invoiceId, "provider1")).amountMinor,
  ).toBe("2000");
});
