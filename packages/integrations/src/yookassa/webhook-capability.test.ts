import { describe, expect, it, vi } from "vitest";
import type {
  YooKassaOperation,
  YooKassaOperationPort,
} from "./operation-port.js";
import { createCanonicalExpertResidencyPaymentEventVerifier } from "../expert-residency/verified-event.js";
import { YooKassaPaymentVerifier } from "./verifier.js";
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
  it.each([
    ["payment.succeeded", "create_payment", "settled"],
    ["refund.succeeded", "create_refund", "refunded"],
  ] as const)(
    "rejects %s for an already canceled durable operation",
    async (notificationEvent, operationKind, canonicalKind) => {
      const stored = {
        ...operation(operationKind),
        status: "canceled" as const,
      };
      const verifier = {
        verifyPayment: vi.fn(async () => ({ kind: canonicalKind }) as never),
        verifyRefund: vi.fn(async () => ({ kind: canonicalKind }) as never),
      };
      const capability = new YooKassaWebhookCapability(
        { findByProviderObject: vi.fn(async () => stored) } as never,
        verifier as never,
      );

      await expect(
        capability.verify({
          type: "notification",
          event: notificationEvent,
          object: { id: stored.providerObjectId! },
        }),
      ).rejects.toThrow("yookassa_webhook_binding_mismatch");
      expect(verifier.verifyPayment).not.toHaveBeenCalled();
      expect(verifier.verifyRefund).not.toHaveBeenCalled();
    },
  );

  it("never returns a settlement event for payment.canceled", async () => {
    const stored = operation("create_payment");
    const verifier = {
      verifyPayment: vi.fn(async () => ({ kind: "settled" }) as never),
      verifyRefund: vi.fn(),
    };
    const capability = new YooKassaWebhookCapability(
      { findByProviderObject: vi.fn(async () => stored) } as never,
      verifier as never,
    );

    await expect(
      capability.verify({
        type: "notification",
        event: "payment.canceled",
        object: { id: "payment-1" },
      }),
    ).rejects.toThrow("yookassa_webhook_binding_mismatch");
  });

  it("looks up the bound payment and returns its authoritative settled event", async () => {
    const stored = operation("create_payment");
    const operations = { findByProviderObject: vi.fn(async () => stored) };
    const expected = { kind: "settled", proof: "verified" } as never;
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
    const expected = { kind: "refunded", proof: "refund" } as never;
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

  it("resolves success only when explicitly acknowledged after delivery", async () => {
    const stored = operation("create_payment");
    const operations = {
      findByProviderObject: vi.fn(async () => stored),
      resolve: vi.fn(async () => undefined),
    };
    const capability = new YooKassaWebhookCapability(
      operations as never,
      { verifyPayment: vi.fn(), verifyRefund: vi.fn() } as never,
    );

    await capability.resolveSucceeded({
      type: "notification",
      event: "payment.succeeded",
      object: { id: "payment-1" },
    });

    expect(operations.resolve).toHaveBeenCalledWith(stored.id, "succeeded");
  });

  it("treats an already succeeded operation as an idempotent acknowledgment", async () => {
    const stored = {
      ...operation("create_payment"),
      status: "succeeded" as const,
    };
    const operations = {
      findByProviderObject: vi.fn(async () => stored),
      resolve: vi.fn(async () => {
        throw new Error("must not resolve a terminal row again");
      }),
    };
    const capability = new YooKassaWebhookCapability(
      operations as never,
      { verifyPayment: vi.fn(), verifyRefund: vi.fn() } as never,
    );

    await expect(
      capability.resolveSucceeded({
        type: "notification",
        event: "payment.succeeded",
        object: { id: "payment-1" },
      }),
    ).resolves.toBeUndefined();
    expect(operations.resolve).not.toHaveBeenCalled();
  });
});

describe("capture-wait webhook", () => {
  it.each(["pending", "succeeded", "canceled"] as const)(
    "acknowledges replay for %s without settlement verification or resolution",
    async (status) => {
      const operations = {
        findByProviderObject: vi.fn(async () => ({
          ...operation("create_payment"),
          status,
        })),
        resolve: vi.fn(),
      };
      const verifier = {
        verifyWaitingForCapture: vi.fn(async () => undefined),
        verifyPayment: vi.fn(),
        verifyRefund: vi.fn(),
      };
      const capability = new YooKassaWebhookCapability(operations, verifier);
      const notification = {
        type: "notification",
        event: "payment.waiting_for_capture",
        object: { id: "payment-1" },
      } as const;
      await expect(capability.verify(notification)).resolves.toBeNull();
      await expect(capability.verify(notification)).resolves.toBeNull();
      expect(verifier.verifyWaitingForCapture).toHaveBeenCalledTimes(2);
      expect(verifier.verifyPayment).not.toHaveBeenCalled();
      expect(operations.resolve).not.toHaveBeenCalled();
      await expect(capability.resolveSucceeded(notification)).rejects.toThrow(
        "yookassa_webhook_binding_mismatch",
      );
    },
  );
  it("propagates unavailable or mismatched authoritative verification", async () => {
    const verifier = {
      verifyWaitingForCapture: vi.fn(async () => {
        throw new Error("yookassa_payment_binding_mismatch");
      }),
      verifyPayment: vi.fn(),
      verifyRefund: vi.fn(),
    };
    const capability = new YooKassaWebhookCapability(
      {
        findByProviderObject: vi.fn(async () => operation("create_payment")),
        resolve: vi.fn(),
      },
      verifier,
    );
    await expect(
      capability.verify({
        type: "notification",
        event: "payment.waiting_for_capture",
        object: { id: "payment-1" },
      }),
    ).rejects.toThrow("yookassa_payment_binding_mismatch");
  });
});

describe("capture-wait real verifier boundary", () => {
  it.each([null, "failed", "claimed"] as const)(
    "fails closed for missing or non-reconcilable operation %s before any provider read",
    async (status) => {
      const stored =
        status === null ? null : { ...operation("create_payment"), status };
      const operations = {
        findByProviderObject: vi.fn(async () => stored),
        resolve: vi.fn(async () => undefined),
      };
      const provider = {
        getPayment: vi.fn(async () => {
          throw new Error("unexpected_provider_read");
        }),
        getRefund: vi.fn(async () => {
          throw new Error("unexpected_provider_read");
        }),
      };
      const canonical = {
        verifyCanonical: vi.fn(
          createCanonicalExpertResidencyPaymentEventVerifier().verifyCanonical,
        ),
      };
      const verifier = new YooKassaPaymentVerifier(
        provider,
        operations,
        canonical,
      );
      const capability = new YooKassaWebhookCapability(operations, verifier);
      await expect(
        capability.verify({
          type: "notification",
          event: "payment.waiting_for_capture",
          object: { id: status === null ? "unknown-payment" : "payment-1" },
        }),
      ).rejects.toThrow(
        status === null
          ? "yookassa_webhook_binding_not_found"
          : "yookassa_payment_binding_mismatch",
      );
      expect(provider.getPayment).not.toHaveBeenCalled();
      expect(provider.getRefund).not.toHaveBeenCalled();
      expect(canonical.verifyCanonical).not.toHaveBeenCalled();
      expect(operations.resolve).not.toHaveBeenCalled();
    },
  );
});
