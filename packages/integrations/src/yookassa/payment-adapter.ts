import { createHash } from "node:crypto";
import type {
  ExpertResidencyCheckoutCommand,
  ExpertResidencyCheckoutOutcome,
} from "@ii-tonya/contracts";
import type {
  ExpertResidencyPaymentPort,
  ExpertResidencyRefundCommand,
} from "../expert-residency/payment-port.js";
import { YooKassaUnknownOutcomeError, type YooKassaClient } from "./client.js";
import type { YooKassaMode, YooKassaVatCode } from "./contracts.js";
import type {
  YooKassaOperationPort,
  YooKassaReceiptContactPort,
} from "./operation-port.js";

const stableUuid = (namespace: string, value: string): string => {
  const hex = createHash("sha256")
    .update(`${namespace}\0${value}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const digest = (value: unknown): string =>
  `sha256:${createHash("sha256")
    .update(
      JSON.stringify(value, (_key, candidate: unknown) =>
        typeof candidate === "bigint" ? candidate.toString() : candidate,
      ),
      "utf8",
    )
    .digest("hex")}`;

export interface YooKassaPaymentAdapterDependencies {
  readonly client: YooKassaClient;
  readonly operations: YooKassaOperationPort;
  readonly contacts: YooKassaReceiptContactPort;
  readonly mode: YooKassaMode;
  readonly returnUrl: string;
  readonly receipt: {
    readonly vatCode: YooKassaVatCode;
    readonly paymentSubject: string;
    readonly paymentMode: string;
  };
}

export class YooKassaExpertResidencyPaymentAdapter implements ExpertResidencyPaymentPort {
  constructor(private readonly deps: YooKassaPaymentAdapterDependencies) {}

  async createCheckout(
    command: ExpertResidencyCheckoutCommand,
  ): Promise<ExpertResidencyCheckoutOutcome> {
    const contact = await this.deps.contacts.receiptContactForOrder(
      command.orderId,
    );
    if (
      contact === null ||
      (contact.email === undefined) === (contact.phone === undefined)
    ) {
      throw new Error("yookassa_receipt_contact_unavailable");
    }
    const request = {
      amountMinor: BigInt(command.amountMinor),
      description: "Expert residency",
      returnUrl: this.deps.returnUrl,
      metadata: { order_id: command.orderId },
      receipt: {
        customer: contact,
        item: {
          description: "Expert residency",
          ...this.deps.receipt,
        },
      },
    } as const;
    const commandIdentity = `${command.orderId}:${command.idempotencyKey}`;
    const operation = await this.deps.operations.claim({
      commandId: stableUuid("yookassa-command", commandIdentity),
      orderId: command.orderId,
      paymentAttemptId: stableUuid("yookassa-attempt", commandIdentity),
      kind: "create_payment",
      mode: this.deps.mode,
      amountMinor: command.amountMinor,
      currency: "RUB",
      requestDigest: digest(request),
    });
    try {
      const payment = await this.deps.client.createPayment({
        ...request,
        idempotencyKey: operation.idempotencyKey,
      });
      if (
        payment.metadata.order_id !== command.orderId ||
        payment.confirmation === undefined ||
        new URL(payment.confirmation.url).protocol !== "https:"
      ) {
        throw new Error("yookassa_payment_binding_mismatch");
      }
      await this.deps.operations.bindProviderObject(operation.id, payment.id);
      return {
        kind: "created",
        paymentId: payment.id,
        checkoutUrl: payment.confirmation.url,
      };
    } catch (error: unknown) {
      if (error instanceof YooKassaUnknownOutcomeError) {
        await this.deps.operations.markUnknown(operation.id);
      }
      throw error;
    }
  }

  async refund(command: ExpertResidencyRefundCommand): Promise<{
    readonly kind: "pending";
    readonly refundId: string;
  }> {
    const contact = await this.deps.contacts.receiptContactForOrder(
      command.orderId,
    );
    if (
      contact === null ||
      (contact.email === undefined) === (contact.phone === undefined)
    ) {
      throw new Error("yookassa_receipt_contact_unavailable");
    }
    const request = {
      paymentId: command.paymentId,
      amountMinor: BigInt(command.amountMinor),
      description: "Expert residency refund",
      receipt: {
        customer: contact,
        item: {
          description: "Expert residency refund",
          ...this.deps.receipt,
        },
      },
    } as const;
    const identity = `${command.orderId}:${command.idempotencyKey}`;
    const operation = await this.deps.operations.claim({
      commandId: stableUuid("yookassa-refund-command", identity),
      orderId: command.orderId,
      paymentAttemptId: stableUuid("yookassa-attempt", command.orderId),
      kind: "create_refund",
      mode: this.deps.mode,
      amountMinor: command.amountMinor,
      currency: "RUB",
      requestDigest: digest(request),
      parentPaymentId: command.paymentId,
    });
    try {
      const refund = await this.deps.client.createRefund({
        ...request,
        idempotencyKey: operation.idempotencyKey,
      });
      await this.deps.operations.bindProviderObject(operation.id, refund.id);
      return { kind: "pending", refundId: refund.id };
    } catch (error: unknown) {
      if (error instanceof YooKassaUnknownOutcomeError) {
        await this.deps.operations.markUnknown(operation.id);
      }
      throw error;
    }
  }

  async reconcile(): Promise<null> {
    return null;
  }
}
