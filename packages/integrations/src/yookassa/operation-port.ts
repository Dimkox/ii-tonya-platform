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
  /** Preallocated delivery identity only; canonical financial claim validation remains authoritative. */
  readonly deliveryOperationId?: string;
  readonly commandId: string;
  readonly orderId: string;
  readonly paymentAttemptId?: string;
  readonly kind: YooKassaOperationKind;
  readonly mode: YooKassaMode;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly requestDigest: string;
  readonly parentPaymentId?: string;
  /** Produced only by an injected protector; never plaintext request material. */
  readonly replaySnapshot?: {
    readonly ciphertext: string;
    readonly keyReference: string;
    readonly bodyVersion: number;
    readonly expiresAt: string;
  };
}

export interface YooKassaOperationPort {
  findByProviderObject(
    providerObjectId: string,
    kind: YooKassaOperationKind,
  ): Promise<YooKassaOperation | null>;
  claim(command: ClaimYooKassaOperationCommand): Promise<YooKassaOperation>;
  /** One invocation owns the send only after its insertion transaction commits.
   * Optional for legacy consumers; checkout fails closed when unavailable.
   */
  claimInitialPayment?(command: ClaimYooKassaOperationCommand): Promise<
    | {
        readonly kind: "initial_send_admitted";
        readonly operation: YooKassaOperation;
      }
    | { readonly kind: "existing"; readonly operation: YooKassaOperation }
  >;
  attachReplaySnapshot?(
    operationId: string,
    snapshot: NonNullable<ClaimYooKassaOperationCommand["replaySnapshot"]>,
  ): Promise<void>;
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
    mode?: YooKassaMode,
  ): Promise<readonly YooKassaOperation[]>;
}

export interface YooKassaReceiptContact {
  readonly email?: string;
  readonly phone?: string;
  /** Opaque, server-owned consent/contact authority reference; never raw PII. */
  readonly authorityReference: string;
}

/** Retained purchase identity; not consent or permission to disclose contact data. */
export interface YooKassaReceiptAuthority {
  readonly contactKind: "email" | "phone";
  readonly authorityReference: string;
}

export interface YooKassaReceiptContactPort {
  /** Payer sources expose this even when metadata is unavailable. Only legacy
   * contact-only sources may omit the capability. Never fall back on failure. */
  receiptAuthorityForOrder?(
    orderId: string,
  ): Promise<YooKassaReceiptAuthority | null>;
  receiptContactForOrder(
    orderId: string,
  ): Promise<YooKassaReceiptContact | null>;
}
