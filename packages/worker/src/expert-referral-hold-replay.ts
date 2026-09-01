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
  return repository.replayDueBatch({
    now: new Date(now.getTime()),
    batchSize,
  });
}
