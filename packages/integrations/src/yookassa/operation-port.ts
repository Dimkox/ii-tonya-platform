import type { YooKassaMode } from "./contracts.js";

export type YooKassaOperationKind = "create_payment" | "create_refund";
export type YooKassaOperationStatus =
  | "claimed"
  | "pending"
  | "unknown_outcome"
  | "succeeded"
  | "canceled"
  | "failed";

export interface YooKassaOperation {
  readonly id: string;
  readonly orderId: string;
  readonly paymentAttemptId: string;
  readonly kind: YooKassaOperationKind;
  readonly mode: YooKassaMode;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly requestDigest: string;
  readonly idempotencyKey: string;
  readonly providerObjectId?: string;
  readonly parentPaymentId?: string;
  readonly status: YooKassaOperationStatus;
}

export interface ClaimYooKassaOperationCommand {
  readonly commandId: string;
  readonly orderId: string;
  readonly paymentAttemptId?: string;
  readonly kind: YooKassaOperationKind;
  readonly mode: YooKassaMode;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly requestDigest: string;
  readonly parentPaymentId?: string;
}

export interface YooKassaOperationPort {
  claim(command: ClaimYooKassaOperationCommand): Promise<YooKassaOperation>;
  bindProviderObject(
    operationId: string,
    providerObjectId: string,
  ): Promise<YooKassaOperation>;
  markUnknown(operationId: string): Promise<void>;
  resolve(
    operationId: string,
    status: Exclude<
      YooKassaOperationStatus,
      "claimed" | "pending" | "unknown_outcome"
    >,
  ): Promise<void>;
  claimReconciliationBatch(
    limit: number,
  ): Promise<readonly YooKassaOperation[]>;
}

export interface YooKassaReceiptContact {
  readonly email?: string;
  readonly phone?: string;
}

export interface YooKassaReceiptContactPort {
  receiptContactForOrder(
    orderId: string,
  ): Promise<YooKassaReceiptContact | null>;
}
