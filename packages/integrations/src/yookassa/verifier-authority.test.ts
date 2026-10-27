import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  assertVerifiedExpertResidencyPaymentEvent,
  createCanonicalExpertResidencyPaymentEventVerifier,
  verifiedEventFixture,
} from "../expert-residency/verified-event.js";
import type { YooKassaOperation } from "./operation-port.js";
import { YooKassaPaymentVerifier } from "./verifier.js";

const operation: YooKassaOperation = {
  id: "00000000-0000-4000-8000-000000000501",
  orderId: "00000000-0000-4000-8000-000000000502",
  paymentAttemptId: "00000000-0000-4000-8000-000000000503",
  kind: "create_payment",
  mode: "test",
  providerObjectId: "2f4b6d0d-000f-5000-9000-000000000501",
  amountMinor: "50000",
  currency: "RUB",
  requestDigest: `sha256:${"e".repeat(64)}`,
  idempotencyKey: "00000000-0000-4000-8000-000000000504",
  status: "pending",
};

const payment = {
  id: operation.providerObjectId!,
  status: "succeeded" as const,
  paid: true,
  amount: { value: "500.00", currency: "RUB" as const },
  test: true,
  createdAt: "2026-08-14T10:00:00.000Z",
  capturedAt: "2026-08-14T10:05:00.000Z",
  metadata: { order_id: operation.orderId },
  refundable: true,
};

const refundOperation: YooKassaOperation = {
  ...operation,
  id: "00000000-0000-4000-8000-000000000601",
  kind: "create_refund",
  providerObjectId: "2f4b6d0d-000f-5000-9000-000000000601",
  parentPaymentId: operation.providerObjectId!,
  amountMinor: "10000",
  status: "unknown_outcome",
};

const refund = {
  id: refundOperation.providerObjectId!,
  paymentId: refundOperation.parentPaymentId!,
  status: "succeeded" as const,
  amount: { value: "100.00", currency: "RUB" as const },
  createdAt: "2026-08-14T10:00:00.000Z",
};

const operationPort = () => ({
  resolve: vi.fn(async () => undefined),
});

describe("provider-owned mint authority", () => {
  it.each(["payment", "refund"] as const)(
    "mints frozen shared-brand %s facts using only bound GET authority",
    async (kind) => {
      const operations = operationPort();
      const getPayment = vi.fn(async () => payment);
      const getRefund = vi.fn(async () => refund);
      const verifier = new YooKassaPaymentVerifier(
        { getPayment, getRefund },
        operations,
      );
      const event =
        kind === "payment"
          ? await verifier.verifyPayment(operation)
          : await verifier.verifyRefund(refundOperation);
      expect(event).not.toBeNull();
      assertVerifiedExpertResidencyPaymentEvent(event);
      expect(Object.isFrozen(event)).toBe(true);
      const occurredAt =
        kind === "payment" ? payment.capturedAt : refund.createdAt;
      expect(event).toMatchObject({
        kind: kind === "payment" ? "settled" : "refunded",
        provider: "yookassa",
        paymentId: payment.id,
        orderId: operation.orderId,
        amountMinor:
          kind === "payment"
            ? operation.amountMinor
            : refundOperation.amountMinor,
        currency: "RUB",
        occurredAt,
        verifiedAt: occurredAt,
        verifierKeyVersion: "yookassa-api-v3",
      });
      expect(event.verificationId).toMatch(/^yookassa-read:[a-f0-9]{32}$/u);
      expect(event.payloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      const { verificationId, verifierKeyVersion, verifiedAt, ...facts } =
        event;
      const { payloadDigest, ...digestFacts } = facts;
      const digest = (value: unknown) =>
        `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
      expect(payloadDigest).toBe(digest(digestFacts));
      expect(verificationId).toBe(
        `yookassa-read:${digest(facts).slice(7, 39)}`,
      );
      const evidence = { verificationId, verifierKeyVersion, verifiedAt };
      const canonical =
        createCanonicalExpertResidencyPaymentEventVerifier().verifyCanonical(
          facts,
          evidence,
        );
      const fixture = verifiedEventFixture(facts, evidence);
      assertVerifiedExpertResidencyPaymentEvent(canonical);
      assertVerifiedExpertResidencyPaymentEvent(fixture);
      expect(canonical).toEqual(event);
      expect(fixture).toEqual(event);
      expect(() =>
        assertVerifiedExpertResidencyPaymentEvent({ ...event }),
      ).toThrow("verified_event_required");
      expect(getPayment).toHaveBeenCalledWith(payment.id);
      if (kind === "refund") expect(getRefund).toHaveBeenCalledWith(refund.id);
      expect(operations.resolve).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...payment, id: "foreign" },
    { ...payment, metadata: { order_id: "foreign" } },
    { ...payment, amount: { value: "500.01", currency: "RUB" as const } },
    { ...payment, amount: { value: "500.00", currency: "USD" as never } },
    { ...payment, test: false },
    { ...payment, paid: false },
  ])(
    "rejects mismatched or inconsistent payment facts without writes",
    async (changed) => {
      const operations = operationPort();
      const verifier = new YooKassaPaymentVerifier(
        { getPayment: async () => changed, getRefund: async () => refund },
        operations,
      );
      await expect(verifier.verifyPayment(operation)).rejects.toThrow(
        "yookassa_payment_binding_mismatch",
      );
      expect(operations.resolve).not.toHaveBeenCalled();
    },
  );
  it("returns no event for an authoritative hold", async () => {
    const operations = operationPort();
    const verifier = new YooKassaPaymentVerifier(
      {
        getPayment: async () => ({ ...payment, status: "waiting_for_capture" }),
        getRefund: async () => refund,
      },
      operations,
    );
    await expect(verifier.verifyPayment(operation)).resolves.toBeNull();
    await expect(
      verifier.verifyWaitingForCapture(operation),
    ).resolves.toBeUndefined();
    expect(operations.resolve).not.toHaveBeenCalled();
  });
  it("rejects a refund whose parent differs without writes", async () => {
    const operations = operationPort();
    const verifier = new YooKassaPaymentVerifier(
      {
        getPayment: async () => payment,
        getRefund: async () => ({ ...refund, paymentId: "foreign" }),
      },
      operations,
    );
    await expect(verifier.verifyRefund(refundOperation)).rejects.toThrow(
      "yookassa_refund_binding_mismatch",
    );
    expect(operations.resolve).not.toHaveBeenCalled();
  });
});
