import { createHash } from "node:crypto";
import type {
  ExpertResidencyCheckoutCommand,
  ExpertResidencyCheckoutOutcome,
} from "@ii-tonya/contracts";
import type {
  ExpertResidencyPaymentPort,
  ExpertResidencyRefundCommand,
} from "../expert-residency/payment-port.js";
import {
  YooKassaTerminalError,
  serializeYooKassaPaymentRequest,
  serializeYooKassaRefundRequest,
  type YooKassaClient,
} from "./client.js";
import type { YooKassaMode, YooKassaVatCode } from "./contracts.js";
import type {
  YooKassaOperationPort,
  YooKassaReceiptContactPort,
} from "./operation-port.js";
import type { YooKassaReplayProtector } from "./exact-body-recovery.js";

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

const minorFromRub = (value: string): string | null => {
  const match = /^(0|[1-9]\d*)\.(\d{2})$/u.exec(value);
  return match === null
    ? null
    : (BigInt(match[1]!) * 100n + BigInt(match[2]!)).toString();
};

const AUTHORITY_REFERENCE = /^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$/u;
const PRE_REQUEST_TERMINAL_CODES = new Set([
  "yookassa_amount_invalid",
  "yookassa_idempotency_key_invalid",
  "yookassa_provider_id_invalid",
  "yookassa_receipt_contact_invalid",
]);
const REJECTED_HTTP_CODES = new Set([
  "yookassa_http_400",
  "yookassa_http_401",
  "yookassa_http_403",
  "yookassa_http_404",
  "yookassa_http_405",
  "yookassa_http_406",
  "yookassa_http_409",
  "yookassa_http_410",
  "yookassa_http_411",
  "yookassa_http_413",
  "yookassa_http_414",
  "yookassa_http_415",
  "yookassa_http_422",
]);

const receiptAuthority = (contact: {
  readonly email?: string;
  readonly phone?: string;
  readonly authorityReference?: string;
}) => {
  if (
    contact.authorityReference === undefined ||
    !AUTHORITY_REFERENCE.test(contact.authorityReference)
  ) {
    throw new Error("yookassa_receipt_authority_reference_invalid");
  }
  return {
    contactKind: contact.email === undefined ? "phone" : "email",
    authorityReference: contact.authorityReference,
  } as const;
};

const markPostFailure = async (
  operations: YooKassaOperationPort,
  operationId: string,
  error: unknown,
): Promise<void> => {
  if (
    error instanceof YooKassaTerminalError &&
    (REJECTED_HTTP_CODES.has(error.code) ||
      PRE_REQUEST_TERMINAL_CODES.has(error.code))
  ) {
    await operations.resolve(operationId, "failed");
    return;
  }
  await operations.markUnknown(operationId);
};

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
  /** Absent means exact-body recovery is disabled and performs zero crypto. */
  readonly replayProtector?: YooKassaReplayProtector;
  readonly recoveryExpiresAt?: () => string;
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
    const receiptCustomer =
      contact.email === undefined
        ? { phone: contact.phone! }
        : { email: contact.email };
    const request = {
      amountMinor: BigInt(command.amountMinor),
      description: "Expert residency",
      returnUrl: this.deps.returnUrl,
      metadata: { order_id: command.orderId },
      receipt: {
        customer: receiptCustomer,
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
      kind: "create_payment",
      mode: this.deps.mode,
      amountMinor: command.amountMinor,
      currency: "RUB",
      requestDigest: digest({
        version: "yookassa-request-authority-v1",
        operationKind: "create_payment",
        orderId: command.orderId,
        mode: this.deps.mode,
        amountMinor: command.amountMinor,
        currency: command.currency,
        returnUrl: this.deps.returnUrl,
        receiptPolicy: this.deps.receipt,
        receiptAuthority: receiptAuthority(contact),
      }),
    });
    if (operation.status === "failed" || operation.status === "canceled") {
      throw new Error("yookassa_operation_terminal");
    }
    if (operation.providerObjectId !== undefined) {
      const existing = await this.deps.client.getPayment(
        operation.providerObjectId,
      );
      if (
        existing.id !== operation.providerObjectId ||
        existing.metadata.order_id !== command.orderId ||
        existing.amount.currency !== command.currency ||
        minorFromRub(existing.amount.value) !== command.amountMinor ||
        existing.test !== (this.deps.mode === "test") ||
        existing.confirmation === undefined ||
        new URL(existing.confirmation.url).protocol !== "https:"
      ) {
        throw new Error("yookassa_payment_binding_mismatch");
      }
      return {
        kind: "created",
        paymentId: existing.id,
        checkoutUrl: existing.confirmation.url,
      };
    }
    if (operation.status === "succeeded") {
      throw new Error("yookassa_operation_terminal");
    }
    const providerCommand = {
      ...request,
      idempotencyKey: operation.idempotencyKey,
    };
    await this.attachRecoverySnapshot(
      operation,
      serializeYooKassaPaymentRequest(providerCommand),
    );
    try {
      const payment = await this.deps.client.createPayment(providerCommand);
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
      await markPostFailure(this.deps.operations, operation.id, error);
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
    const receiptCustomer =
      contact.email === undefined
        ? { phone: contact.phone! }
        : { email: contact.email };
    const request = {
      paymentId: command.paymentId,
      amountMinor: BigInt(command.amountMinor),
      description: "Expert residency refund",
      receipt: {
        customer: receiptCustomer,
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
      kind: "create_refund",
      mode: this.deps.mode,
      amountMinor: command.amountMinor,
      currency: "RUB",
      requestDigest: digest({
        version: "yookassa-request-authority-v1",
        operationKind: "create_refund",
        orderId: command.orderId,
        parentPaymentId: command.paymentId,
        mode: this.deps.mode,
        amountMinor: command.amountMinor,
        currency: command.currency,
        receiptPolicy: this.deps.receipt,
        receiptAuthority: receiptAuthority(contact),
      }),
      parentPaymentId: command.paymentId,
    });
    if (operation.status === "failed" || operation.status === "canceled") {
      throw new Error("yookassa_operation_terminal");
    }
    if (operation.providerObjectId !== undefined) {
      return { kind: "pending", refundId: operation.providerObjectId };
    }
    if (operation.status === "succeeded") {
      throw new Error("yookassa_operation_terminal");
    }
    const providerCommand = {
      ...request,
      idempotencyKey: operation.idempotencyKey,
    };
    await this.attachRecoverySnapshot(
      operation,
      serializeYooKassaRefundRequest(providerCommand),
    );
    try {
      const refund = await this.deps.client.createRefund(providerCommand);
      await this.deps.operations.bindProviderObject(operation.id, refund.id);
      return { kind: "pending", refundId: refund.id };
    } catch (error: unknown) {
      await markPostFailure(this.deps.operations, operation.id, error);
      throw error;
    }
  }

  async reconcile(): Promise<null> {
    return null;
  }

  private async attachRecoverySnapshot(
    operation: Awaited<ReturnType<YooKassaOperationPort["claim"]>>,
    body: string,
  ): Promise<void> {
    if (this.deps.replayProtector === undefined) return;
    if (
      this.deps.operations.attachReplaySnapshot === undefined ||
      this.deps.recoveryExpiresAt === undefined
    ) {
      throw new Error("yookassa_recovery_capability_incomplete");
    }
    const bodyVersion = 1;
    const snapshot = await this.deps.replayProtector.protect({
      body,
      bodyVersion,
      associatedData: {
        operationId: operation.id,
        operationKind: operation.kind,
        idempotencyKey: operation.idempotencyKey,
        requestDigest: operation.requestDigest,
        bodyVersion,
      },
    });
    if (snapshot.expiresAt !== this.deps.recoveryExpiresAt()) {
      throw new Error("yookassa_recovery_expiry_mismatch");
    }
    await this.deps.operations.attachReplaySnapshot(operation.id, snapshot);
  }
}
