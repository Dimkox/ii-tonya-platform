import { createHash } from "node:crypto";
import type {
  CanonicalExpertResidencyPaymentEventVerifier,
  VerifiedExpertResidencyPaymentEvent,
} from "../expert-residency/verified-event.js";
import type { YooKassaClient } from "./client.js";
import type { YooKassaOperation } from "./operation-port.js";

const minorFromRub = (value: string): string => {
  const match = /^(0|[1-9]\d*)\.(\d{2})$/u.exec(value);
  if (!match) throw new Error("yookassa_payment_binding_mismatch");
  return (BigInt(match[1]!) * 100n + BigInt(match[2]!)).toString();
};

const payloadDigest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;

export class YooKassaPaymentVerifier {
  constructor(
    private readonly client: Pick<YooKassaClient, "getPayment">,
    private readonly canonical: CanonicalExpertResidencyPaymentEventVerifier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verifyPayment(
    operation: YooKassaOperation,
  ): Promise<VerifiedExpertResidencyPaymentEvent | null> {
    if (
      operation.kind !== "create_payment" ||
      operation.providerObjectId === undefined
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
    if (
      payment.status === "pending" ||
      payment.status === "waiting_for_capture"
    ) {
      return null;
    }
    if (payment.status === "canceled") return null;
    if (!payment.paid || payment.status !== "succeeded") {
      throw new Error("yookassa_payment_binding_mismatch");
    }
    const occurredAt = this.now().toISOString();
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
    return this.canonical.verifyCanonical(event, {
      verificationId: `yookassa-read:${payloadDigest(event).slice(7, 39)}`,
      verifierKeyVersion: "yookassa-api-v3",
      verifiedAt: occurredAt,
    });
  }
}
