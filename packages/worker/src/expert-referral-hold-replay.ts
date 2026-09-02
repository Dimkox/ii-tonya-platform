import { recordExpertReferralLifecycle } from "@ii-tonya/observability";

export interface HeldRewardReplayBatchResult {
  readonly examined: number;
  readonly granted: number;
  readonly debtRepaid: number;
  readonly ineligible: number;
  readonly cancelled: number;
  readonly stillHeld: number;
  readonly failed: number;
}

export interface HeldRewardReplayRepository {
  replayDueBatch(command: {
    readonly now: Date;
    readonly batchSize: number;
  }): Promise<HeldRewardReplayBatchResult>;
}

export async function replayHeldRewards(
  repository: HeldRewardReplayRepository,
  now: Date,
  batchSize: number,
): Promise<HeldRewardReplayBatchResult> {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1_000
  ) {
    throw new Error("invalid_batch_size");
  }
  try {
    const result = await repository.replayDueBatch({
      now: new Date(now.getTime()),
      batchSize,
    });
    const emit = (
      count: number,
      operation: "held_replay" | "reward_grant" | "debt",
      outcome:
        | "granted"
        | "debt_repaid"
        | "ineligible"
        | "cancelled"
        | "still_held"
        | "failed",
      errorCode: "none" | "unknown" = "none",
    ): void => {
      if (count < 1) return;
      recordExpertReferralLifecycle(
        {
          module: "expert_referral",
          operation,
          outcome,
          errorCode,
        },
        count,
      );
    };
    emit(result.granted, "held_replay", "granted");
    emit(result.granted, "reward_grant", "granted");
    emit(result.debtRepaid, "held_replay", "debt_repaid");
    emit(result.debtRepaid, "reward_grant", "debt_repaid");
    emit(result.debtRepaid, "debt", "debt_repaid");
    emit(result.ineligible, "held_replay", "ineligible");
    emit(result.cancelled, "held_replay", "cancelled");
    emit(result.stillHeld, "held_replay", "still_held");
    emit(result.failed, "held_replay", "failed", "unknown");
    return result;
  } catch (error) {
    recordExpertReferralLifecycle({
      module: "expert_referral",
      operation: "held_replay",
      outcome: "failed",
      errorCode: "unknown",
    });
    throw error;
  }
}
