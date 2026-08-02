export interface JobResult {
  readonly examined: number;
  readonly changed: number;
  readonly failed: number;
}

export interface ExpiryBatchCommand {
  readonly now: Date;
  readonly batchSize: number;
}

export interface ReservationExpiryRepository {
  /**
   * PostgreSQL implementations own the whole transaction: claim due reserved
   * rows with FOR UPDATE SKIP LOCKED, verify expected versions, transition the
   * reservation, append audit, and enqueue the three versioned free effects.
   */
  expireDueBatch(command: ExpiryBatchCommand): Promise<JobResult>;
}

export interface ExpiryDeps {
  readonly repository: ReservationExpiryRepository;
}

const MAX_BATCH_SIZE = 1_000;

function validBatchInput(now: Date, batchSize: number): boolean {
  return Number.isFinite(now.getTime())
    && Number.isSafeInteger(batchSize)
    && batchSize > 0
    && batchSize <= MAX_BATCH_SIZE;
}

export async function expireDueReservations(
  deps: ExpiryDeps,
  now: Date,
  batchSize: number,
): Promise<JobResult> {
  if (!validBatchInput(now, batchSize)) {
    throw new Error("Invalid reservation expiry batch input");
  }
  return deps.repository.expireDueBatch({
    now: new Date(now.getTime()),
    batchSize,
  });
}
