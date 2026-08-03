const transactions = new WeakMap<object, object>();

export type TrustedExpertReferralTransaction = object & {
  readonly __expertReferralTransactionCapability: never;
};

export function createTrustedExpertReferralTransaction(
  candidate: object,
): TrustedExpertReferralTransaction {
  const handle = candidate as Record<string, unknown>;
  if (
    "$client" in handle ||
    typeof handle.execute !== "function" ||
    typeof handle.transaction !== "function"
  ) {
    throw new Error("transaction_handle_required");
  }
  const capability = Object.freeze({}) as TrustedExpertReferralTransaction;
  transactions.set(capability, candidate);
  return capability;
}

export function assertTrustedExpertReferralTransaction(
  capability: object,
  candidate: object,
): asserts capability is TrustedExpertReferralTransaction {
  if (transactions.get(capability) !== candidate) {
    throw new Error("transaction_capability_mismatch");
  }
}
