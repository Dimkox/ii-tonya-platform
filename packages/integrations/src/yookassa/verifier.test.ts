import { expect, it } from "vitest";
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

it("brands a settlement only after an exact authenticated read", async () => {
  const client = { getPayment: async () => payment } as YooKassaClient;
  const verifier = new YooKassaPaymentVerifier(
    client,
    createCanonicalExpertResidencyPaymentEventVerifier(),
    () => new Date("2026-08-14T11:00:00.000Z"),
  );
  await expect(verifier.verifyPayment(operation)).resolves.toMatchObject({
    kind: "settled",
    provider: "yookassa",
    paymentId: payment.id,
    orderId: operation.orderId,
    amountMinor: "50000",
  });
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
      createCanonicalExpertResidencyPaymentEventVerifier(),
    );
    await expect(verifier.verifyPayment(operation)).rejects.toThrow(
      "yookassa_payment_binding_mismatch",
    );
  }
});
