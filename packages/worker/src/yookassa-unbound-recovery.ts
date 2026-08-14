export interface YooKassaRecoveryJobClaim {
  readonly operationId: string;
}

export async function runYooKassaUnboundRecoveryBatch<T extends YooKassaRecoveryJobClaim>(input: {
  readonly enabled: boolean;
  readonly limit: number;
  readonly claimBatch: (input: { readonly limit: number }) => Promise<readonly T[]>;
  readonly recover: (claim: T) => Promise<{ readonly kind: string }>;
}): Promise<
  | { readonly kind: "disabled"; readonly examined: 0 }
  | { readonly kind: "completed"; readonly examined: number; readonly bound: number; readonly rescheduled: number; readonly manualReview: number }
> {
  if (!input.enabled) return { kind: "disabled", examined: 0 };
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 25)
    throw new Error("yookassa_recovery_batch_invalid");
  const claims = await input.claimBatch({ limit: input.limit });
  if (claims.length > input.limit) throw new Error("yookassa_recovery_batch_unbounded");
  let bound = 0;
  let rescheduled = 0;
  let manualReview = 0;
  for (const claim of claims) {
    const outcome = await input.recover(claim);
    if (outcome.kind === "bound") bound += 1;
    else if (outcome.kind === "rescheduled") rescheduled += 1;
    else if (outcome.kind === "manual_review") manualReview += 1;
  }
  return { kind: "completed", examined: claims.length, bound, rescheduled, manualReview };
}
