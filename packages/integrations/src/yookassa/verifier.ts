import { mintVerifiedExpertResidencyPaymentEvent } from "../expert-residency/verified-event-internal.js";
import { createHash } from "node:crypto";
import type { VerifiedExpertResidencyPaymentEvent } from "../expert-residency/verified-event.js";
import type { YooKassaClient } from "./client.js";
import type {
  YooKassaOperation,
  YooKassaOperationPort,
} from "./operation-port.js";

const minorFromRub = (value: string): string => {
  const match = /^(0|[1-9]\d*)\.(\d{2})$/u.exec(value);
  if (!match) throw new Error("yookassa_payment_binding_mismatch");
  return (BigInt(match[1]!) * 100n + BigInt(match[2]!)).toString();
};

const payloadDigest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;

const isReconciliationCandidate = (operation: YooKassaOperation): boolean =>
  operation.status === "pending" ||
  operation.status === "unknown_outcome" ||
  operation.status === "succeeded" ||
  operation.status === "canceled";

export class YooKassaPaymentVerifier {
  constructor(
    private readonly client: Pick<YooKassaClient, "getPayment" | "getRefund">,
    private readonly operations: Pick<YooKassaOperationPort, "resolve">,
  ) {}

  private async readBoundPayment(operation: YooKassaOperation) {
    if (
      operation.kind !== "create_payment" ||
      operation.providerObjectId === undefined ||
      !isReconciliationCandidate(operation)
    ) {
      throw new Error("yookassa_payment_binding_mismatch");
    }
    const payment = await this.client.getPayment(operation.providerObjectId);
    if (
      payment.id !== operation.providerObjectId ||
      payment.metadata.order_id !== operation.orderId ||
      payment.amount.currency !== operation.currency ||
      minorFromRub(payment.amount.value) !== operation.amountMinor ||
      payment.test !== (operation.mode === "test")
    ) {
      throw new Error("yookassa_payment_binding_mismatch");
    }
    return payment;
  }

  // A delayed hold notification may observe a terminal GET result. Acknowledge
  // it without minting settlement facts or changing durable operation state.
  async verifyWaitingForCapture(operation: YooKassaOperation): Promise<void> {
    const payment = await this.readBoundPayment(operation);
    if (
      payment.status === "pending" ||
      (payment.status === "waiting_for_capture" && !payment.paid) ||
      (payment.status === "canceled" && payment.paid) ||
      (payment.status === "succeeded" &&
        (!payment.paid || payment.capturedAt === undefined))
    ) {
      throw new Error("yookassa_payment_binding_mismatch");
    }
  }

  async verifyPayment(
    operation: YooKassaOperation,
  ): Promise<VerifiedExpertResidencyPaymentEvent | null> {
    const payment = await this.readBoundPayment(operation);
    if (
      payment.status === "pending" ||
      payment.status === "waiting_for_capture"
    ) {
      return null;
    }
    if (payment.status === "canceled") {
      if (payment.paid) {
        throw new Error("yookassa_payment_binding_mismatch");
      }
      if (operation.status !== "canceled") {
        await this.operations.resolve(operation.id, "canceled");
      }
      return null;
    }
    if (
      !payment.paid ||
      payment.status !== "succeeded" ||
      payment.capturedAt === undefined
    ) {
      throw new Error("yookassa_payment_binding_mismatch");
    }
    const occurredAt = payment.capturedAt;
    const facts = {
      kind: "settled" as const,
      provider: "yookassa",
      eventId: `yookassa:${payment.id}:succeeded`,
      paymentId: payment.id,
      orderId: operation.orderId,
      amountMinor: operation.amountMinor,
      currency: "RUB" as const,
      occurredAt,
    };
    const event = { ...facts, payloadDigest: payloadDigest(facts) };
    const verified = mintVerifiedExpertResidencyPaymentEvent(event, {
      verificationId: `yookassa-read:${payloadDigest(event).slice(7, 39)}`,
      verifierKeyVersion: "yookassa-api-v3",
      verifiedAt: occurredAt,
    });
    return verified;
  }

  async verifyRefund(
    operation: YooKassaOperation,
  ): Promise<VerifiedExpertResidencyPaymentEvent | null> {
    if (
      operation.kind !== "create_refund" ||
      operation.providerObjectId === undefined ||
      operation.parentPaymentId === undefined ||
      !isReconciliationCandidate(operation)
    ) {
      throw new Error("yookassa_refund_binding_mismatch");
    }

    const refund = await this.client.getRefund(operation.providerObjectId);
    const payment = await this.client.getPayment(operation.parentPaymentId);
    if (
      refund.id !== operation.providerObjectId ||
      refund.paymentId !== operation.parentPaymentId ||
      refund.amount.currency !== operation.currency ||
      minorFromRub(refund.amount.value) !== operation.amountMinor ||
      payment.id !== operation.parentPaymentId ||
      payment.metadata.order_id !== operation.orderId ||
      payment.amount.currency !== operation.currency ||
      BigInt(minorFromRub(payment.amount.value)) <
        BigInt(operation.amountMinor) ||
      payment.test !== (operation.mode === "test") ||
      !payment.paid ||
      payment.status !== "succeeded"
    ) {
      throw new Error("yookassa_refund_binding_mismatch");
    }

    if (refund.status === "pending") return null;
    if (refund.status === "canceled") {
      if (operation.status !== "canceled") {
        await this.operations.resolve(operation.id, "canceled");
      }
      return null;
    }

    const occurredAt = refund.createdAt;
    const facts = {
      kind: "refunded" as const,
      provider: "yookassa",
      eventId: `yookassa:${refund.id}:succeeded`,
      paymentId: operation.parentPaymentId,
      orderId: operation.orderId,
      amountMinor: operation.amountMinor,
      currency: "RUB" as const,
      occurredAt,
    };
    const event = { ...facts, payloadDigest: payloadDigest(facts) };
    const verified = mintVerifiedExpertResidencyPaymentEvent(event, {
      verificationId: `yookassa-read:${payloadDigest(event).slice(7, 39)}`,
      verifierKeyVersion: "yookassa-api-v3",
      verifiedAt: occurredAt,
    });
    return verified;
  }
}
