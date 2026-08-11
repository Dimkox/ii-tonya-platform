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

function assertJobInput(now: Date, batchSize: number): void {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1_000
  ) {
    throw new Error("invalid_expert_residency_expiry_input");
  }
}

export async function expireExpertResidencyOrders(
  repo: ExpertResidencyExpiryRepository,
  now: Date,
  batchSize: number,
): Promise<ExpertResidencyExpiryResult> {
  assertJobInput(now, batchSize);
  return repo.expireDueBatch({ now, batchSize });
}
