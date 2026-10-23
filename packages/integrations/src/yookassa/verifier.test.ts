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

const canonical = () => {
  const verifier = createCanonicalExpertResidencyPaymentEventVerifier();
  return { verifyCanonical: vi.fn(verifier.verifyCanonical) };
};

const client = (overrides: Partial<YooKassaClient>): YooKassaClient => ({
  createPayment: async () => {
    throw new Error("unused");
  },
  getPayment: async () => {
    throw new Error("unused");
  },
  createRefund: async () => {
    throw new Error("unused");
  },
  getRefund: async () => {
    throw new Error("unused");
  },
  ...overrides,
});

describe("YooKassaPaymentVerifier", () => {
  it("brands a deterministic settlement without resolving before durable delivery", async () => {
    const provider = client({ getPayment: async () => payment });
    const operations = operationPort();
    const eventVerifier = canonical();
    const verifier = new YooKassaPaymentVerifier(
      provider,
      operations,
      eventVerifier,
    );
    await expect(verifier.verifyPayment(operation)).resolves.toMatchObject({
      kind: "settled",
      provider: "yookassa",
      paymentId: payment.id,
      orderId: operation.orderId,
      amountMinor: "50000",
    });
    expect(eventVerifier.verifyCanonical).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: payment.capturedAt }),
      expect.any(Object),
    );
    expect(operations.resolve).not.toHaveBeenCalled();
  });

  it("re-verifies a succeeded operation into the same exact settlement", async () => {
    const verifier = new YooKassaPaymentVerifier(
      client({ getPayment: async () => payment }),
      operationPort(),
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    const first = await verifier.verifyPayment(operation);
    const retried = await verifier.verifyPayment({
      ...operation,
      status: "succeeded",
    });

    expect(retried).toEqual(first);
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
        client({ getPayment: async () => changed }),
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
      client({
        getPayment: async () => ({
          ...payment,
          status: "pending",
          paid: false,
        }),
      }),
      operations,
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    await expect(verifier.verifyPayment(operation)).resolves.toBeNull();
    expect(operations.resolve).not.toHaveBeenCalled();
  });

  it("resolves a verified canceled payment without minting a financial event", async () => {
    const operations = operationPort();
    const verifier = new YooKassaPaymentVerifier(
      client({
        getPayment: async () => ({
          ...payment,
          status: "canceled",
          paid: false,
        }),
      }),
      operations,
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    await expect(verifier.verifyPayment(operation)).resolves.toBeNull();
    expect(operations.resolve).toHaveBeenCalledWith(operation.id, "canceled");
  });

  it("idempotently re-verifies an already canceled payment", async () => {
    const operations = operationPort();
    const verifier = new YooKassaPaymentVerifier(
      client({
        getPayment: async () => ({
          ...payment,
          status: "canceled",
          paid: false,
        }),
      }),
      operations,
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    await expect(
      verifier.verifyPayment({ ...operation, status: "canceled" }),
    ).resolves.toBeNull();
    expect(operations.resolve).not.toHaveBeenCalled();
  });

  it("brands a deterministic refund without resolving before durable delivery", async () => {
    const operations = operationPort();
    const eventVerifier = canonical();
    const provider = client({
      getRefund: vi.fn(async () => refund),
      getPayment: vi.fn(async () => payment),
    });
    const verifier = new YooKassaPaymentVerifier(
      provider,
      operations,
      eventVerifier,
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
    expect(provider.getRefund).toHaveBeenCalledWith(
      refundOperation.providerObjectId,
    );
    expect(provider.getPayment).toHaveBeenCalledWith(
      refundOperation.parentPaymentId,
    );
    expect(eventVerifier.verifyCanonical).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: refund.createdAt }),
      expect.any(Object),
    );
    expect(operations.resolve).not.toHaveBeenCalled();
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
        client({
          getRefund: async () => changedRefund,
          getPayment: async () => changedPayment,
        }),
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
      client({
        getRefund: async () => ({ ...refund, status: "pending" }),
        getPayment: async () => payment,
      }),
      operations,
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    await expect(verifier.verifyRefund(refundOperation)).resolves.toBeNull();
    expect(operations.resolve).not.toHaveBeenCalled();
  });

  it("resolves a verified canceled refund without minting a financial event", async () => {
    const operations = operationPort();
    const verifier = new YooKassaPaymentVerifier(
      client({
        getRefund: async () => ({ ...refund, status: "canceled" }),
        getPayment: async () => payment,
      }),
      operations,
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    await expect(verifier.verifyRefund(refundOperation)).resolves.toBeNull();
    expect(operations.resolve).toHaveBeenCalledWith(
      refundOperation.id,
      "canceled",
    );
  });

  it("idempotently re-verifies an already canceled refund", async () => {
    const operations = operationPort();
    const verifier = new YooKassaPaymentVerifier(
      client({
        getRefund: async () => ({ ...refund, status: "canceled" }),
        getPayment: async () => payment,
      }),
      operations,
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );

    await expect(
      verifier.verifyRefund({ ...refundOperation, status: "canceled" }),
    ).resolves.toBeNull();
    expect(operations.resolve).not.toHaveBeenCalled();
  });
});

describe("authoritative capture-wait acknowledgment", () => {
  it.each(["waiting_for_capture", "succeeded", "canceled"] as const)(
    "acknowledges %s repeatedly without financial events or writes",
    async (status) => {
      const operations = operationPort();
      const eventVerifier = canonical();
      const verifier = new YooKassaPaymentVerifier(
        client({
          getPayment: async () => ({
            ...payment,
            status,
            paid: status !== "canceled",
          }),
        }),
        operations,
        eventVerifier,
      );
      await verifier.verifyWaitingForCapture(operation);
      await verifier.verifyWaitingForCapture({
        ...operation,
        status: "canceled",
      });
      expect(operations.resolve).not.toHaveBeenCalled();
      expect(eventVerifier.verifyCanonical).not.toHaveBeenCalled();
    },
  );
  it("rejects pending, unpaid holds, binding mismatches and provider failures without effects", async () => {
    for (const changed of [
      { ...payment, status: "pending" as const, paid: false },
      { ...payment, status: "waiting_for_capture" as const, paid: false },
      { ...payment, id: "foreign" },
      { ...payment, metadata: { order_id: "foreign" } },
      { ...payment, amount: { value: "500.01", currency: "RUB" as const } },
      { ...payment, amount: { value: "500.00", currency: "USD" as never } },
      { ...payment, test: false },
      null,
    ]) {
      const operations = operationPort();
      const eventVerifier = canonical();
      const verifier = new YooKassaPaymentVerifier(
        client({
          getPayment: async () => {
            if (changed === null) throw new Error("provider_unavailable");
            return changed;
          },
        }),
        operations,
        eventVerifier,
      );
      await expect(
        verifier.verifyWaitingForCapture(operation),
      ).rejects.toThrow();
      expect(operations.resolve).not.toHaveBeenCalled();
      expect(eventVerifier.verifyCanonical).not.toHaveBeenCalled();
    }
  });
});

describe("capture-wait terminal consistency", () => {
  it("rejects inconsistent terminal facts without canonical verification or writes", async () => {
    const { capturedAt, ...uncaptured } = payment;
    expect(capturedAt).toBeDefined();
    for (const changed of [
      { ...payment, status: "canceled" as const, paid: true },
      { ...payment, status: "succeeded" as const, paid: false },
      uncaptured,
    ]) {
      const operations = operationPort();
      const eventVerifier = canonical();
      const verifier = new YooKassaPaymentVerifier(
        client({ getPayment: async () => changed }),
        operations,
        eventVerifier,
      );
      await expect(verifier.verifyWaitingForCapture(operation)).rejects.toThrow(
        "yookassa_payment_binding_mismatch",
      );
      expect(eventVerifier.verifyCanonical).not.toHaveBeenCalled();
      expect(operations.resolve).not.toHaveBeenCalled();
    }
  });
});
