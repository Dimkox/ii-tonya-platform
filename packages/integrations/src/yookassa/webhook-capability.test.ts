import { describe, expect, it, vi } from "vitest";
import type {
  YooKassaOperation,
  YooKassaOperationPort,
} from "./operation-port.js";
import { YooKassaWebhookCapability } from "./webhook-capability.js";

const operation = (kind: YooKassaOperation["kind"]): YooKassaOperation => ({
  id: "op-1",
  orderId: "order-1",
  paymentAttemptId: "attempt-1",
  kind,
  mode: "test",
  amountMinor: "50000",
  currency: "RUB",
  requestDigest: `sha256:${"a".repeat(64)}`,
  idempotencyKey: "key-1",
  providerObjectId: kind === "create_payment" ? "payment-1" : "refund-1",
  ...(kind === "create_refund" ? { parentPaymentId: "payment-1" } : {}),
  status: "pending",
});

describe("YooKassa webhook capability", () => {
  it("looks up the bound payment and returns its authoritative settled event", async () => {
    const stored = operation("create_payment");
    const operations = { findByProviderObject: vi.fn(async () => stored) };
    const expected = { proof: "verified" } as never;
    const verifier = {
      verifyPayment: vi.fn(async () => expected),
      verifyRefund: vi.fn(),
    };
    const capability = new YooKassaWebhookCapability(
      operations as never,
      verifier as never,
    );
    await expect(
      capability.verify({
        type: "notification",
        event: "payment.succeeded",
        object: { id: "payment-1" },
      }),
    ).resolves.toBe(expected);
    expect(operations.findByProviderObject).toHaveBeenCalledWith(
      "payment-1",
      "create_payment",
    );
  });

  it("rejects a succeeded signal while the authoritative object remains pending", async () => {
    const operations = {
      findByProviderObject: vi.fn(async () => operation("create_payment")),
    };
    const verifier = {
      verifyPayment: vi.fn(async () => null),
      verifyRefund: vi.fn(),
    };
    const capability = new YooKassaWebhookCapability(
      operations as never,
      verifier as never,
    );
    await expect(
      capability.verify({
        type: "notification",
        event: "payment.succeeded",
        object: { id: "payment-1" },
      }),
    ).rejects.toThrow("yookassa_webhook_pending");
  });

  it("accepts payment.canceled only after GET verification refreshed durable status", async () => {
    const stored = operation("create_payment");
    const find = vi
      .fn<YooKassaOperationPort["findByProviderObject"]>()
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce({ ...stored, status: "canceled" });
    const verifier = {
      verifyPayment: vi.fn(async () => null),
      verifyRefund: vi.fn(),
    };
    const capability = new YooKassaWebhookCapability(
      { findByProviderObject: find } as never,
      verifier as never,
    );
    await expect(
      capability.verify({
        type: "notification",
        event: "payment.canceled",
        object: { id: "payment-1" },
      }),
    ).resolves.toBeNull();
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("maps refund.succeeded to the authoritative refund verifier", async () => {
    const stored = operation("create_refund");
    const operations = { findByProviderObject: vi.fn(async () => stored) };
    const expected = { proof: "refund" } as never;
    const verifier = {
      verifyPayment: vi.fn(),
      verifyRefund: vi.fn(async () => expected),
    };
    const capability = new YooKassaWebhookCapability(
      operations as never,
      verifier as never,
    );
    await expect(
      capability.verify({
        type: "notification",
        event: "refund.succeeded",
        object: { id: "refund-1" },
      }),
    ).resolves.toBe(expected);
  });
});
