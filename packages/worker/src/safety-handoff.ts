export interface SafetyHandoffReport {
  readonly examined: number;
  readonly escalated: number;
  readonly unchanged: number;
}

export interface SafetyHandoffBatchCommand {
  readonly now: Date;
  readonly batchSize: number;
}

export interface SafetyHandoffAcknowledgement {
  readonly handoffId: string;
  readonly operatorId: string;
  readonly authenticatedSessionIdHash: string;
  readonly expectedVersion: number;
  readonly acknowledgedAt: Date;
}

export type SafetyHandoffAcknowledgementResult =
  | { readonly kind: "acknowledged"; readonly version: number }
  | { readonly kind: "conflict" };

export interface SafetyHandoffRepository {
  /**
   * PostgreSQL implementations own one transaction per bounded batch. They
   * lock due rows with FOR UPDATE SKIP LOCKED, fence on owner/status/version,
   * append audit, and enqueue the free dedicated safety effect atomically.
   */
  processDueBatch(command: SafetyHandoffBatchCommand): Promise<SafetyHandoffReport>;
  /** Authenticated operator acknowledgement is an atomic expected-version command. */
  acknowledge(
    command: SafetyHandoffAcknowledgement,
  ): Promise<SafetyHandoffAcknowledgementResult>;
}

export interface SafetyHandoffDeps {
  readonly repository: SafetyHandoffRepository;
}

const MAX_BATCH_SIZE = 1_000;

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

export async function processSafetyHandoffs(
  deps: SafetyHandoffDeps,
  now: Date,
  batchSize: number,
): Promise<SafetyHandoffReport> {
  if (
    !validDate(now)
    || !Number.isSafeInteger(batchSize)
    || batchSize < 1
    || batchSize > MAX_BATCH_SIZE
  ) {
    throw new Error("Invalid safety handoff batch input");
  }
  return deps.repository.processDueBatch({
    now: new Date(now.getTime()),
    batchSize,
  });
}

export async function acknowledgeSafetyHandoff(
  deps: SafetyHandoffDeps,
  command: SafetyHandoffAcknowledgement,
): Promise<SafetyHandoffAcknowledgementResult> {
  if (
    command.handoffId.trim().length === 0
    || command.operatorId.trim().length === 0
    || command.authenticatedSessionIdHash.trim().length === 0
    || !Number.isSafeInteger(command.expectedVersion)
    || command.expectedVersion < 0
    || !validDate(command.acknowledgedAt)
  ) {
    throw new Error("Invalid safety handoff acknowledgement");
  }
  return deps.repository.acknowledge({
    ...command,
    acknowledgedAt: new Date(command.acknowledgedAt.getTime()),
  });
}
