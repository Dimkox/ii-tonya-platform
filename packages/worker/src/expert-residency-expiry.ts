import {
  safelyObserveExpertReferralDuration,
  safelyRecordExpertReferralLifecycle,
} from "@ii-tonya/observability";

export interface ExpertResidencyExpiryResult {
  readonly examined: number;
  readonly changed: number;
  readonly failed: number;
}

export interface ExpertResidencyExpiryRepository {
  expireDueBatch(command: {
    readonly now: Date;
    readonly batchSize: number;
  }): Promise<ExpertResidencyExpiryResult>;
}

function assertBatchInput(now: Date, batchSize: number): void {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1_000
  ) {
    throw new Error("invalid_batch_size");
  }
}

export async function expireExpertResidencyOrders(
  repository: ExpertResidencyExpiryRepository,
  now: Date,
  batchSize: number,
): Promise<ExpertResidencyExpiryResult> {
  assertBatchInput(now, batchSize);
  const startedAt = performance.now();
  try {
    const result = await repository.expireDueBatch({
      now: new Date(now.getTime()),
      batchSize,
    });
    if (result.changed > 0) {
      safelyRecordExpertReferralLifecycle(
        {
          module: "expert_residency",
          operation: "credit_expiry",
          outcome: "expired",
          errorCode: "none",
        },
        result.changed,
      );
    }
    if (result.failed > 0) {
      safelyRecordExpertReferralLifecycle(
        {
          module: "expert_residency",
          operation: "credit_expiry",
          outcome: "failed",
          errorCode: "unknown",
        },
        result.failed,
      );
    }
    safelyObserveExpertReferralDuration(
      {
        module: "expert_residency",
        operation: "credit_expiry",
        outcome:
          result.changed > 0
            ? "expired"
            : result.failed > 0
              ? "failed"
              : "unchanged",
        errorCode: result.failed > 0 ? "unknown" : "none",
      },
      Math.min(performance.now() - startedAt, 3_600_000),
    );
    return result;
  } catch (error) {
    safelyRecordExpertReferralLifecycle({
      module: "expert_residency",
      operation: "credit_expiry",
      outcome: "failed",
      errorCode: "unknown",
    });
    safelyObserveExpertReferralDuration(
      {
        module: "expert_residency",
        operation: "credit_expiry",
        outcome: "failed",
        errorCode: "unknown",
      },
      Math.min(performance.now() - startedAt, 3_600_000),
    );
    throw error;
  }
}
