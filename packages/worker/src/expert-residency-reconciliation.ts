import { safelyRecordExpertReferralLifecycle } from "@ii-tonya/observability";

export interface ExpertResidencyReconciliationCandidate {
  readonly attemptId: string;
  readonly providerPaymentId: string;
  readonly claimedAt: string;
}

export interface ExpertResidencyReconciliationRepository {
  claimReconciliationBatch(command: {
    readonly now: Date;
    readonly batchSize: number;
  }): Promise<readonly ExpertResidencyReconciliationCandidate[]>;
  compareAndRecordReconciliation(
    candidate: ExpertResidencyReconciliationCandidate,
    verifiedEvent: unknown,
  ): Promise<"matched" | "mismatch">;
}

export interface ExpertResidencyReconciliationProvider {
  reconcile(paymentId: string): Promise<unknown | null>;
}

export interface ExpertResidencyReconciliationResult {
  readonly examined: number;
  readonly matched: number;
  readonly mismatches: number;
  readonly providerDisabled: number;
  readonly failed: number;
}

export async function reconcileExpertResidencyPayments(
  repository: ExpertResidencyReconciliationRepository,
  provider: ExpertResidencyReconciliationProvider,
  now: Date,
  batchSize: number,
): Promise<ExpertResidencyReconciliationResult> {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1_000
  ) {
    throw new Error("invalid_batch_size");
  }
  const candidates = await repository.claimReconciliationBatch({
    now: new Date(now.getTime()),
    batchSize,
  });
  if (candidates.length > batchSize) {
    throw new Error("reconciliation_claim_exceeded_batch");
  }
  let matched = 0;
  let mismatches = 0;
  let providerDisabled = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const event = await provider.reconcile(candidate.providerPaymentId);
      if (event === null) {
        providerDisabled += 1;
        continue;
      }
      const result = await repository.compareAndRecordReconciliation(
        candidate,
        event,
      );
      if (result === "matched") {
        matched += 1;
      } else {
        mismatches += 1;
        safelyRecordExpertReferralLifecycle({
          module: "expert_residency",
          operation: "reconciliation_mismatch",
          outcome: "mismatch",
          errorCode: "conflicting_fact",
        });
      }
    } catch {
      failed += 1;
    }
  }
  return {
    examined: candidates.length,
    matched,
    mismatches,
    providerDisabled,
    failed,
  };
}
