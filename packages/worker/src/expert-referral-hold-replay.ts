export interface ExpertReferralHoldReplayResult {
  readonly examined: number;
  readonly granted: number;
  readonly cancelled: number;
}

export interface HeldRewardRepository {
  replayDueBatch(command: {
    readonly now: Date;
    readonly batchSize: number;
  }): Promise<ExpertReferralHoldReplayResult>;
}

export async function replayHeldRewards(
  repo: HeldRewardRepository,
  now: Date,
  batchSize: number,
): Promise<ExpertReferralHoldReplayResult> {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1_000
  ) {
    throw new Error("invalid_expert_referral_hold_replay_input");
  }
  return repo.replayDueBatch({ now, batchSize });
}
