export type YooKassaExactRecoveryOperationKind = "create_payment" | "create_refund";

export interface YooKassaExactRecoveryClaim {
  readonly operationId: string;
  readonly operationKind: YooKassaExactRecoveryOperationKind;
  readonly encryptedBody: string;
  readonly bodyVersion: number;
  readonly keyReference: string;
  readonly idempotencyKey: string;
  readonly leaseToken: string;
  readonly status: "unknown_outcome" | "succeeded" | "canceled" | "failed";
  readonly providerObjectId: string | null;
}

export interface YooKassaReplayDecryptor {
  decrypt(input: Pick<YooKassaExactRecoveryClaim, "encryptedBody" | "keyReference">): Promise<{
    readonly body: string;
    readonly bodyVersion: number;
  }>;
}

export interface YooKassaReplayProtector {
  /** Returns only opaque encrypted material and a key reference; implementations own key resolution. */
  protect(input: { readonly body: string; readonly bodyVersion: number }): Promise<{
    readonly ciphertext: string;
    readonly keyReference: string;
    readonly bodyVersion: number;
    readonly expiresAt: string;
  }>;
}

export interface YooKassaExactRecoveryTransport {
  postExact(input: {
    readonly operationKind: YooKassaExactRecoveryOperationKind;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly providerObjectId: string }>;
}

export interface YooKassaExactRecoveryCompletion {
  /** Must fence by leaseToken and bind provider ID in one database transaction. */
  bind(operationId: string, leaseToken: string, providerObjectId: string): Promise<void>;
  manualReview(operationId: string, leaseToken: string, reason: string): Promise<void>;
}

export async function recoverExactYooKassaOperation(input: {
  readonly enabled: boolean;
  readonly claim: YooKassaExactRecoveryClaim;
  readonly decryptor: YooKassaReplayDecryptor;
  readonly transport: YooKassaExactRecoveryTransport;
  readonly completion: YooKassaExactRecoveryCompletion;
}): Promise<{ readonly kind: "disabled" | "manual_review" | "ineligible" } | { readonly kind: "bound"; readonly providerObjectId: string }> {
  if (!input.enabled) return { kind: "disabled" };
  if (input.claim.status !== "unknown_outcome" || input.claim.providerObjectId !== null) {
    return { kind: "ineligible" };
  }
  const decrypted = await input.decryptor.decrypt({
    encryptedBody: input.claim.encryptedBody,
    keyReference: input.claim.keyReference,
  });
  if (decrypted.bodyVersion !== input.claim.bodyVersion) {
    await input.completion.manualReview(input.claim.operationId, input.claim.leaseToken, "snapshot_version_mismatch");
    return { kind: "manual_review" };
  }
  const response = await input.transport.postExact({
    operationKind: input.claim.operationKind,
    body: decrypted.body,
    idempotencyKey: input.claim.idempotencyKey,
  });
  await input.completion.bind(input.claim.operationId, input.claim.leaseToken, response.providerObjectId);
  return { kind: "bound", providerObjectId: response.providerObjectId };
}
