import { expect, it, vi } from "vitest";
import { YooKassaDeferredVerifier } from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { PostgresDeferredVerifiedStore } from "./early-bird-deferred-verified-store.js";

it("requires the issuing verifier and refuses a broad principal before writing", async () => {
  const userId = crypto.randomUUID(),
    invoiceId = crypto.randomUUID(),
    grantId = crypto.randomUUID();
  const snapshot = {
    userId,
    invoiceId,
    operationId: invoiceId,
    grantId,
    policy: "owner_test_10_20_v1" as const,
    stage: "onboarding" as const,
    amountMinor: "1000",
    mode: "live" as const,
    launchAt: "2027-01-11T00:00:00+03:00",
  };
  const verifier = new YooKassaDeferredVerifier(
    {
      getPayment: async () => ({
        id: "provider1",
        status: "succeeded",
        paid: true,
        test: false,
        amount: { value: "10.00", currency: "RUB" },
        createdAt: "2026-12-01T00:00:00Z",
        capturedAt: "2026-12-01T00:01:00Z",
        metadata: {
          order_id: invoiceId,
          operation_id: invoiceId,
          user_id: userId,
          purpose: "early_bird_deferred",
          stage: "onboarding",
          pricing_policy: snapshot.policy,
          pricing_grant_id: grantId,
        },
      }),
    } as never,
    { findInvoice: async () => snapshot },
  );
  const proof = await verifier.verify(invoiceId, "provider1");
  const execute = vi.fn().mockResolvedValue({ rows: [{ safe: false }] });
  const db = {
    transaction: async (cb: (tx: unknown) => unknown) => cb({ execute }),
  } as unknown as DrizzleDb;
  const store = new PostgresDeferredVerifiedStore(
    db,
    db,
    verifier,
    "binding_login",
    "settlement_login",
  );
  await expect(store.bind({ ...proof })).rejects.toThrow(
    "early_bird_deferred_proof_required",
  );
  expect(execute).not.toHaveBeenCalled();
  await expect(store.commit(proof)).rejects.toThrow(
    "early_bird_deferred_principal_unsafe",
  );
  expect(execute).toHaveBeenCalledOnce();
});
