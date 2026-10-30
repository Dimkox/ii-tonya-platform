import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  scanEarlyBirdUnknown,
  type EarlyBirdListRecoveryClient,
  type EarlyBirdRecoveryFingerprint,
} from "./early-bird-list-recovery.js";
import type { YooKassaPayment } from "./contracts.js";
import { createYooKassaClient } from "./client.js";
const userId = "11111111-1111-4111-8111-111111111111",
  grantId = "22222222-2222-4222-8222-222222222222",
  operationId = "33333333-3333-4333-8333-333333333333",
  invoiceId = "44444444-4444-4444-8444-444444444444";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const fingerprint: EarlyBirdRecoveryFingerprint = {
  operationId,
  invoiceId,
  userIdSha256: hash(userId),
  grantIdSha256: hash(grantId),
  pricingPolicy: "owner_test_10_20_v1",
  priceKind: "fixed_test",
  totalMinor: "3000",
  mode: "live",
  createdFrom: "2026-11-01T00:00:00Z",
  createdBefore: "2026-11-02T00:00:00Z",
};
const payment: YooKassaPayment = {
  id: "payment_1",
  status: "pending",
  paid: false,
  test: false,
  amount: { value: "30.00", currency: "RUB" },
  createdAt: "2026-11-01T01:00:00Z",
  metadata: {
    purpose: "combined_early_bird",
    operation_id: operationId,
    order_id: invoiceId,
    user_id: userId,
    pricing_grant_id: grantId,
    pricing_policy: "owner_test_10_20_v1",
    price_kind: "fixed_test",
  },
  refundable: false,
};
const summary = {
  id: payment.id,
  createdAt: payment.createdAt,
  test: false,
  metadata: { operation_id: operationId, order_id: invoiceId },
};
describe("unknown-payment list recovery", () => {
  it("scans bounded pages and verifies a unique match with a fresh GET", async () => {
    const getPayment = vi.fn(async () => payment);
    const client: EarlyBirdListRecoveryClient = {
      listPayments: vi.fn(async ({ cursor }) =>
        cursor ? { items: [summary] } : { items: [], nextCursor: "next" },
      ),
      getPayment,
    };
    expect(await scanEarlyBirdUnknown(client, fingerprint)).toEqual({
      kind: "candidate",
      providerObjectId: payment.id,
      status: "pending",
    });
    expect(getPayment).toHaveBeenCalledOnce();
  });
  it("does not infer failure from an empty or incomplete listing", async () => {
    const getPayment = vi.fn(async () => payment);
    const empty: EarlyBirdListRecoveryClient = {
      listPayments: vi.fn(async () => ({ items: [] })),
      getPayment,
    };
    expect(await scanEarlyBirdUnknown(empty, fingerprint)).toEqual({
      kind: "manual_review",
    });
    const incomplete: EarlyBirdListRecoveryClient = {
      listPayments: vi.fn(async ({ cursor }) => ({
        items: cursor ? [] : [summary],
        nextCursor: cursor ? `${cursor}x` : "next",
      })),
      getPayment,
    };
    expect(await scanEarlyBirdUnknown(incomplete, fingerprint)).toEqual({
      kind: "manual_review",
    });
    expect(getPayment).not.toHaveBeenCalled();
  });
  it("rejects ambiguous candidates and a mismatched fresh provider GET", async () => {
    const duplicate: EarlyBirdListRecoveryClient = {
      listPayments: vi.fn(async () => ({
        items: [summary, { ...summary, id: "payment_2" }],
      })),
      getPayment: vi.fn(async () => payment),
    };
    expect(await scanEarlyBirdUnknown(duplicate, fingerprint)).toEqual({
      kind: "manual_review",
    });
    const mismatch: EarlyBirdListRecoveryClient = {
      listPayments: vi.fn(async () => ({ items: [summary] })),
      getPayment: vi.fn(async () => ({
        ...payment,
        amount: { value: "31.00", currency: "RUB" as const },
      })),
    };
    expect(await scanEarlyBirdUnknown(mismatch, fingerprint)).toEqual({
      kind: "manual_review",
    });
  });
  it("keeps provider failures and customer data out of the result", async () => {
    const client: EarlyBirdListRecoveryClient = {
      listPayments: vi.fn(async () => {
        throw new Error("synthetic-private-contact@example.test");
      }),
      getPayment: vi.fn(async () => payment),
    };
    const result = await scanEarlyBirdUnknown(client, fingerprint);
    expect(result).toEqual({ kind: "manual_review" });
    expect(JSON.stringify(result)).not.toContain("synthetic-private-contact");
  });
  it("rejects a partial metadata collision and wrong subject hash without binding", async () => {
    const getPayment = vi.fn(async () => payment);
    const collision: EarlyBirdListRecoveryClient = {
      listPayments: vi.fn(async () => ({
        items: [
          {
            ...summary,
            metadata: { operation_id: operationId, order_id: "different" },
          },
        ],
      })),
      getPayment,
    };
    expect(await scanEarlyBirdUnknown(collision, fingerprint)).toEqual({
      kind: "manual_review",
    });
    const wrong: EarlyBirdListRecoveryClient = {
      listPayments: vi.fn(async () => ({ items: [summary] })),
      getPayment: vi.fn(async () => ({
        ...payment,
        metadata: {
          ...payment.metadata,
          user_id: "55555555-5555-4555-8555-555555555555",
        },
      })),
    };
    expect(await scanEarlyBirdUnknown(wrong, fingerprint)).toEqual({
      kind: "manual_review",
    });
    expect(getPayment).not.toHaveBeenCalled();
  });
  it("requires an actual successful capture timestamp for a succeeded payment", async () => {
    const client: EarlyBirdListRecoveryClient = {
      listPayments: vi.fn(async () => ({ items: [summary] })),
      getPayment: vi.fn(async () => ({
        ...payment,
        status: "succeeded" as const,
        paid: true,
      })),
    };
    expect(await scanEarlyBirdUnknown(client, fingerprint)).toEqual({
      kind: "manual_review",
    });
  });
  it("does not use a matching list object from a different provider mode", async () => {
    const getPayment = vi.fn(async () => payment);
    const client: EarlyBirdListRecoveryClient = {
      listPayments: vi.fn(async () => ({
        items: [{ ...summary, test: true }],
      })),
      getPayment,
    };
    expect(await scanEarlyBirdUnknown(client, fingerprint)).toEqual({
      kind: "manual_review",
    });
    expect(getPayment).not.toHaveBeenCalled();
  });
  it("uses the real client to scan summaries and verify with a separate GET", async () => {
    const transport = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method).toBe("GET");
      const parsed = new URL(url);
      if (parsed.pathname === "/v3/payments")
        return new Response(
          JSON.stringify({
            type: "list",
            items: [
              { id: "unrelated", created_at: payment.createdAt, test: true },
              {
                id: payment.id,
                created_at: payment.createdAt,
                test: false,
                metadata: {
                  operation_id: operationId,
                  order_id: invoiceId,
                  private_email: "fixture@example.invalid",
                },
              },
            ],
          }),
          { status: 200 },
        );
      expect(parsed.pathname).toBe(`/v3/payments/${payment.id}`);
      return new Response(
        JSON.stringify({
          id: payment.id,
          status: payment.status,
          paid: payment.paid,
          test: payment.test,
          amount: payment.amount,
          created_at: payment.createdAt,
          metadata: payment.metadata,
          refundable: false,
        }),
        { status: 200 },
      );
    });
    const client = createYooKassaClient(
      { mode: "live", shopId: "123", secretKey: "synthetic-test-key" },
      transport,
    );
    const result = await scanEarlyBirdUnknown(client, fingerprint);
    expect(result).toEqual({
      kind: "candidate",
      providerObjectId: payment.id,
      status: "pending",
    });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("fixture@example.invalid");
  });
});
