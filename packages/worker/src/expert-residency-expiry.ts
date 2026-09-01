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
  return repository.expireDueBatch({
    now: new Date(now.getTime()),
    batchSize,
  });
}
