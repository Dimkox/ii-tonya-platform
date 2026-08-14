export interface OutboxMessage {
  id: string;
  topic: string;
  payload: unknown;
  correlationId: string;
  attempt: number;
  reconciliationKey: string;
  reconciliationAttempt: number;
  dispatchClaimToken: string | null;
  reconciliationClaimToken: string | null;
}

export interface OutboxRepository {
  claim(
    limit: number,
    owner: string,
    leaseDurationMs: number,
    maxAttempts: number,
  ): Promise<readonly OutboxMessage[]>;
  claimUnknown(
    limit: number,
    owner: string,
    leaseDurationMs: number,
    maxReconciliationAttempts: number,
  ): Promise<readonly OutboxMessage[]>;
  recordAttemptStarted(
    id: string,
    owner: string,
    claimToken: string,
    attemptId: string,
    reconciliationKey: string,
    startedAt: Date,
  ): Promise<void>;
  markUnknownOutcome(
    id: string,
    owner: string,
    claimToken: string,
    attemptId: string,
    reconciliationKey: string,
    reasonCode: string,
  ): Promise<void>;
  markStillUnknown(
    id: string,
    owner: string,
    claimToken: string,
    reasonCode: string,
    nextCheckAt: Date,
  ): Promise<void>;
  succeed(id: string, owner: string, claimToken: string): Promise<void>;
  retry(
    id: string,
    owner: string,
    claimToken: string,
    nextAttemptAt: Date,
    reasonCode: string,
  ): Promise<void>;
  deadLetterAndAlert(
    id: string,
    owner: string,
    claimToken: string,
    reasonCode: string,
  ): Promise<void>;
  succeedAfterReconciliation(
    id: string,
    owner: string,
    claimToken: string,
  ): Promise<void>;
  retryAfterReconciliation(
    id: string,
    owner: string,
    claimToken: string,
    nextAttemptAt: Date,
    reasonCode: string,
  ): Promise<void>;
  deadLetterAfterReconciliationAndAlert(
    id: string,
    owner: string,
    claimToken: string,
    reasonCode: string,
  ): Promise<void>;
  recoverExpiredDispatchLeases(limit?: number): Promise<number>;
  recoverExpiredReconciliationLeases(limit?: number): Promise<number>;
}

export type DispatchOutcome =
  | { kind: "applied"; providerOperationId: string }
  | { kind: "not_applied"; retryable: boolean; reasonCode: string }
  | { kind: "unknown_outcome"; reconciliationKey: string; reasonCode: string };

export interface OutboxDispatcher {
  dispatch(message: OutboxMessage): Promise<DispatchOutcome>;
}

export interface OutboxReconciler {
  reconcile(
    message: OutboxMessage,
  ): Promise<
    | "applied"
    | "not_applied"
    | "still_unknown"
    | {
        kind: "terminal";
        reasonCode: "invalid_payload" | "local_source_invalid";
      }
  >;
}

export interface OutboxRunnerDeps {
  repository: OutboxRepository;
  dispatcher: OutboxDispatcher;
  reconciler: OutboxReconciler;
  now(): Date;
  retryDelayMs(attempt: number): number;
  maxAttempts: number;
  maxReconciliationAttempts: number;
  batchSize: number;
  workerId: string;
  newAttemptId(): string;
  leaseDurationMs?: number;
}

export interface OutboxRunResult {
  reconciled: number;
  dispatched: number;
}

export const MAX_OUTBOX_BATCH_SIZE = 1_000;

export function boundedFullJitterDelay(
  attempt: number,
  baseDelayMs: number,
  maximumDelayMs: number,
  random: () => number = Math.random,
): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new RangeError("attempt must be a positive integer");
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new RangeError("baseDelayMs must be non-negative");
  }
  if (!Number.isFinite(maximumDelayMs) || maximumDelayMs < 0) {
    throw new RangeError("maximumDelayMs must be non-negative");
  }
  const cap = Math.min(maximumDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError("random must return a value in [0, 1)");
  }
  return Math.floor(sample * (cap + 1));
}

function retryAt(deps: OutboxRunnerDeps, now: Date, attempt: number): Date {
  return new Date(now.getTime() + deps.retryDelayMs(attempt));
}

function dispatchToken(message: OutboxMessage): string {
  if (message.dispatchClaimToken === null) {
    throw new Error(`Dispatch claim token missing for ${message.id}`);
  }
  return message.dispatchClaimToken;
}

function reconciliationToken(message: OutboxMessage): string {
  if (message.reconciliationClaimToken === null) {
    throw new Error(`Reconciliation claim token missing for ${message.id}`);
  }
  return message.reconciliationClaimToken;
}

async function reconcileUnknown(
  deps: OutboxRunnerDeps,
  message: OutboxMessage,
  now: Date,
): Promise<void> {
  let resolution: Awaited<ReturnType<OutboxReconciler["reconcile"]>>;
  try {
    resolution = await deps.reconciler.reconcile(message);
  } catch {
    if (message.reconciliationAttempt >= deps.maxReconciliationAttempts) {
      await deps.repository.deadLetterAfterReconciliationAndAlert(
        message.id,
        deps.workerId,
        reconciliationToken(message),
        "reconciliation_exception_exhausted",
      );
    } else {
      await deps.repository.markStillUnknown(
        message.id,
        deps.workerId,
        reconciliationToken(message),
        "reconciliation_exception",
        retryAt(deps, now, message.reconciliationAttempt),
      );
    }
    return;
  }

  if (typeof resolution === "object") {
    await deps.repository.deadLetterAfterReconciliationAndAlert(
      message.id,
      deps.workerId,
      reconciliationToken(message),
      resolution.reasonCode,
    );
    return;
  }

  if (resolution === "applied") {
    await deps.repository.succeedAfterReconciliation(
      message.id,
      deps.workerId,
      reconciliationToken(message),
    );
    return;
  }
  if (resolution === "not_applied") {
    if (message.attempt >= deps.maxAttempts) {
      await deps.repository.deadLetterAfterReconciliationAndAlert(
        message.id,
        deps.workerId,
        reconciliationToken(message),
        "dispatch_attempts_exhausted_after_reconciliation",
      );
    } else {
      await deps.repository.retryAfterReconciliation(
        message.id,
        deps.workerId,
        reconciliationToken(message),
        retryAt(deps, now, message.attempt),
        "reconciled_not_applied",
      );
    }
    return;
  }
  if (message.reconciliationAttempt >= deps.maxReconciliationAttempts) {
    await deps.repository.deadLetterAfterReconciliationAndAlert(
      message.id,
      deps.workerId,
      reconciliationToken(message),
      "unknown_outcome_reconciliation_exhausted",
    );
  } else {
    await deps.repository.markStillUnknown(
      message.id,
      deps.workerId,
      reconciliationToken(message),
      "still_unknown",
      retryAt(deps, now, message.reconciliationAttempt),
    );
  }
}

async function dispatchPending(
  deps: OutboxRunnerDeps,
  message: OutboxMessage,
  now: Date,
): Promise<void> {
  const attemptId = deps.newAttemptId();
  await deps.repository.recordAttemptStarted(
    message.id,
    deps.workerId,
    dispatchToken(message),
    attemptId,
    message.reconciliationKey,
    now,
  );

  let outcome: DispatchOutcome;
  try {
    outcome = await deps.dispatcher.dispatch(message);
  } catch {
    await deps.repository.markUnknownOutcome(
      message.id,
      deps.workerId,
      dispatchToken(message),
      attemptId,
      message.reconciliationKey,
      "dispatch_exception_unknown",
    );
    return;
  }

  if (outcome.kind === "applied") {
    await deps.repository.succeed(
      message.id,
      deps.workerId,
      dispatchToken(message),
    );
    return;
  }
  if (outcome.kind === "unknown_outcome") {
    await deps.repository.markUnknownOutcome(
      message.id,
      deps.workerId,
      dispatchToken(message),
      attemptId,
      outcome.reconciliationKey,
      outcome.reasonCode,
    );
    return;
  }
  if (outcome.retryable && message.attempt < deps.maxAttempts) {
    await deps.repository.retry(
      message.id,
      deps.workerId,
      dispatchToken(message),
      retryAt(deps, now, message.attempt),
      outcome.reasonCode,
    );
  } else {
    await deps.repository.deadLetterAndAlert(
      message.id,
      deps.workerId,
      dispatchToken(message),
      outcome.reasonCode,
    );
  }
}

export async function runOutboxBatch(
  deps: OutboxRunnerDeps,
): Promise<OutboxRunResult> {
  if (
    !Number.isSafeInteger(deps.batchSize)
    || deps.batchSize < 1
    || deps.batchSize > MAX_OUTBOX_BATCH_SIZE
  ) {
    throw new RangeError("batchSize must be a safe integer between 1 and 1000");
  }
  const now = deps.now();
  await deps.repository.recoverExpiredDispatchLeases(deps.batchSize);
  await deps.repository.recoverExpiredReconciliationLeases(deps.batchSize);
  const leaseDurationMs = deps.leaseDurationMs ?? 30_000;

  const unknown = await deps.repository.claimUnknown(
    deps.batchSize,
    deps.workerId,
    leaseDurationMs,
    deps.maxReconciliationAttempts,
  );
  for (const message of unknown) {
    await reconcileUnknown(deps, message, now);
  }

  const messages = await deps.repository.claim(
    deps.batchSize,
    deps.workerId,
    leaseDurationMs,
    deps.maxAttempts,
  );
  for (const message of messages) {
    await dispatchPending(deps, message, now);
  }

  return { reconciled: unknown.length, dispatched: messages.length };
}
