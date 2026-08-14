import { describe, expect, it, vi } from "vitest";
import { createCanonicalExpertResidencyPaymentEventVerifier } from "../expert-residency/verified-event.js";
import type { YooKassaClient } from "./client.js";
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
  metadata: { order_id: operation.orderId },
  refundable: true,
};

const refundOperation: YooKassaOperation = {
  ...operation,
  id: "00000000-0000-4000-8000-000000000601",
  kind: "create_refund",
  providerObjectId: "2f4b6d0d-000f-5000-9000-000000000601",
  parentPaymentId: operation.providerObjectId,
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

const canonical = () => {
  const verifier = createCanonicalExpertResidencyPaymentEventVerifier();
  return { verifyCanonical: vi.fn(verifier.verifyCanonical) };
};

describe("YooKassaPaymentVerifier", () => {
  it("brands and durably resolves a settlement only after an exact authenticated read", async () => {
    const client = { getPayment: async () => payment } as YooKassaClient;
    const operations = operationPort();
    const eventVerifier = canonical();
    const verifier = new YooKassaPaymentVerifier(
      client,
      operations,
      eventVerifier,
      () => new Date("2026-08-14T11:00:00.000Z"),
    );
    await expect(verifier.verifyPayment(operation)).resolves.toMatchObject({
      kind: "settled",
      provider: "yookassa",
      paymentId: payment.id,
      orderId: operation.orderId,
      amountMinor: "50000",
    });
    expect(eventVerifier.verifyCanonical).toHaveBeenCalledBefore(
      operations.resolve,
    );
    expect(operations.resolve).toHaveBeenCalledWith(operation.id, "succeeded");
  });

  it("rejects any order, amount, currency, ID, or mode mismatch", async () => {
    for (const changed of [
      { ...payment, id: "foreign" },
      {
        ...payment,
        metadata: { order_id: "00000000-0000-4000-8000-000000000599" },
      },
      { ...payment, amount: { value: "500.01", currency: "RUB" as const } },
      { ...payment, amount: { value: "500.00", currency: "USD" as never } },
      { ...payment, test: false },
    ]) {
      const verifier = new YooKassaPaymentVerifier(
        { getPayment: async () => changed } as YooKassaClient,
        operationPort(),
        createCanonicalExpertResidencyPaymentEventVerifier(),
      );
      await expect(verifier.verifyPayment(operation)).rejects.toThrow(
        "yookassa_payment_binding_mismatch",
      );
    }
  });

  it("leaves pending payments unresolved", async () => {
    const operations = operationPort();
    const verifier = new YooKassaPaymentVerifier(
      {
        getPayment: async () => ({
          ...payment,
          status: "pending",
          paid: false,
        }),
      } as YooKassaClient,
      operations,
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    await expect(verifier.verifyPayment(operation)).resolves.toBeNull();
    expect(operations.resolve).not.toHaveBeenCalled();
  });

  it("resolves a verified canceled payment without minting a financial event", async () => {
    const operations = operationPort();
    const verifier = new YooKassaPaymentVerifier(
      {
        getPayment: async () => ({
          ...payment,
          status: "canceled",
          paid: false,
        }),
      } as YooKassaClient,
      operations,
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    await expect(verifier.verifyPayment(operation)).resolves.toBeNull();
    expect(operations.resolve).toHaveBeenCalledWith(operation.id, "canceled");
  });

  it("brands and durably resolves a refund only after reading both refund and parent payment", async () => {
    const operations = operationPort();
    const eventVerifier = canonical();
    const client = {
      getRefund: vi.fn(async () => refund),
      getPayment: vi.fn(async () => payment),
    } as YooKassaClient;
    const verifier = new YooKassaPaymentVerifier(
      client,
      operations,
      eventVerifier,
      () => new Date("2026-08-14T11:00:00.000Z"),
    );

    await expect(verifier.verifyRefund(refundOperation)).resolves.toMatchObject(
      {
        kind: "refunded",
        provider: "yookassa",
        paymentId: refundOperation.parentPaymentId,
        orderId: refundOperation.orderId,
        amountMinor: refundOperation.amountMinor,
      },
    );
    expect(client.getRefund).toHaveBeenCalledWith(
      refundOperation.providerObjectId,
    );
    expect(client.getPayment).toHaveBeenCalledWith(
      refundOperation.parentPaymentId,
    );
    expect(eventVerifier.verifyCanonical).toHaveBeenCalledBefore(
      operations.resolve,
    );
    expect(operations.resolve).toHaveBeenCalledWith(
      refundOperation.id,
      "succeeded",
    );
  });

  it("rejects refund ID, payment ID, order, amount, currency, mode, and over-refund mismatches without resolving", async () => {
    for (const [changedRefund, changedPayment] of [
      [{ ...refund, id: "foreign" }, payment],
      [{ ...refund, paymentId: "foreign" }, payment],
      [
        { ...refund, amount: { value: "100.01", currency: "RUB" as const } },
        payment,
      ],
      [
        { ...refund, amount: { value: "100.00", currency: "USD" as never } },
        payment,
      ],
      [refund, { ...payment, id: "foreign" }],
      [
        refund,
        {
          ...payment,
          metadata: { order_id: "00000000-0000-4000-8000-000000000699" },
        },
      ],
      [refund, { ...payment, test: false }],
      [
        refund,
        { ...payment, amount: { value: "99.99", currency: "RUB" as const } },
      ],
    ] as const) {
      const operations = operationPort();
      const verifier = new YooKassaPaymentVerifier(
        {
          getRefund: async () => changedRefund,
          getPayment: async () => changedPayment,
        } as YooKassaClient,
        operations,
        createCanonicalExpertResidencyPaymentEventVerifier(),
      );
      await expect(verifier.verifyRefund(refundOperation)).rejects.toThrow(
        "yookassa_refund_binding_mismatch",
      );
      expect(operations.resolve).not.toHaveBeenCalled();
    }
  });

  it("leaves pending refunds unresolved", async () => {
    const operations = operationPort();
    const verifier = new YooKassaPaymentVerifier(
      {
        getRefund: async () => ({ ...refund, status: "pending" }),
        getPayment: async () => payment,
      } as YooKassaClient,
      operations,
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    await expect(verifier.verifyRefund(refundOperation)).resolves.toBeNull();
    expect(operations.resolve).not.toHaveBeenCalled();
  });

  it("resolves a verified canceled refund without minting a financial event", async () => {
    const operations = operationPort();
    const verifier = new YooKassaPaymentVerifier(
      {
        getRefund: async () => ({ ...refund, status: "canceled" }),
        getPayment: async () => payment,
      } as YooKassaClient,
      operations,
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    await expect(verifier.verifyRefund(refundOperation)).resolves.toBeNull();
    expect(operations.resolve).toHaveBeenCalledWith(
      refundOperation.id,
      "canceled",
    );
  });
});
