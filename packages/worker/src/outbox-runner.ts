export interface OutboxMessage {
  id: string;
  topic: string;
  payload: unknown;
  correlationId: string;
  attempt: number;
  reconciliationKey: string;
  reconciliationAttempt: number;
}

export interface OutboxRepository {
  claim(
    limit: number,
    owner: string,
    leaseUntil: Date,
    maxAttempts: number,
  ): Promise<readonly OutboxMessage[]>;
  claimUnknown(
    limit: number,
    owner: string,
    leaseUntil: Date,
    maxReconciliationAttempts: number,
  ): Promise<readonly OutboxMessage[]>;
  recordAttemptStarted(
    id: string,
    owner: string,
    attemptId: string,
    reconciliationKey: string,
    startedAt: Date,
  ): Promise<void>;
  markUnknownOutcome(
    id: string,
    owner: string,
    attemptId: string,
    reconciliationKey: string,
    reasonCode: string,
    now: Date,
  ): Promise<void>;
  markStillUnknown(
    id: string,
    owner: string,
    now: Date,
    reasonCode: string,
    nextCheckAt: Date,
  ): Promise<void>;
  succeed(id: string, owner: string, now: Date): Promise<void>;
  retry(
    id: string,
    owner: string,
    now: Date,
    nextAttemptAt: Date,
    reasonCode: string,
  ): Promise<void>;
  deadLetterAndAlert(
    id: string,
    owner: string,
    now: Date,
    reasonCode: string,
  ): Promise<void>;
  succeedAfterReconciliation(id: string, owner: string, now: Date): Promise<void>;
  retryAfterReconciliation(
    id: string,
    owner: string,
    now: Date,
    nextAttemptAt: Date,
    reasonCode: string,
  ): Promise<void>;
  deadLetterAfterReconciliationAndAlert(
    id: string,
    owner: string,
    now: Date,
    reasonCode: string,
  ): Promise<void>;
  recoverExpiredDispatchLeases(now: Date): Promise<number>;
  recoverExpiredReconciliationLeases(now: Date): Promise<number>;
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
  ): Promise<"applied" | "not_applied" | "still_unknown">;
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

async function reconcileUnknown(
  deps: OutboxRunnerDeps,
  message: OutboxMessage,
  now: Date,
): Promise<void> {
  let resolution: "applied" | "not_applied" | "still_unknown";
  try {
    resolution = await deps.reconciler.reconcile(message);
  } catch {
    const mutationAt = deps.now();
    if (message.reconciliationAttempt >= deps.maxReconciliationAttempts) {
      await deps.repository.deadLetterAfterReconciliationAndAlert(
        message.id,
        deps.workerId,
        mutationAt,
        "reconciliation_exception_exhausted",
      );
    } else {
      await deps.repository.markStillUnknown(
        message.id,
        deps.workerId,
        mutationAt,
        "reconciliation_exception",
        retryAt(deps, now, message.reconciliationAttempt),
      );
    }
    return;
  }

  const mutationAt = deps.now();
  if (resolution === "applied") {
    await deps.repository.succeedAfterReconciliation(
      message.id,
      deps.workerId,
      mutationAt,
    );
    return;
  }
  if (resolution === "not_applied") {
    if (message.attempt >= deps.maxAttempts) {
      await deps.repository.deadLetterAfterReconciliationAndAlert(
        message.id,
        deps.workerId,
        mutationAt,
        "dispatch_attempts_exhausted_after_reconciliation",
      );
    } else {
      await deps.repository.retryAfterReconciliation(
        message.id,
        deps.workerId,
        mutationAt,
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
      mutationAt,
      "unknown_outcome_reconciliation_exhausted",
    );
  } else {
    await deps.repository.markStillUnknown(
      message.id,
      deps.workerId,
      mutationAt,
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
      attemptId,
      message.reconciliationKey,
      "dispatch_exception_unknown",
      deps.now(),
    );
    return;
  }

  if (outcome.kind === "applied") {
    await deps.repository.succeed(message.id, deps.workerId, deps.now());
    return;
  }
  if (outcome.kind === "unknown_outcome") {
    await deps.repository.markUnknownOutcome(
      message.id,
      deps.workerId,
      attemptId,
      outcome.reconciliationKey,
      outcome.reasonCode,
      deps.now(),
    );
    return;
  }
  if (outcome.retryable && message.attempt < deps.maxAttempts) {
    await deps.repository.retry(
      message.id,
      deps.workerId,
      deps.now(),
      retryAt(deps, now, message.attempt),
      outcome.reasonCode,
    );
  } else {
    await deps.repository.deadLetterAndAlert(
      message.id,
      deps.workerId,
      deps.now(),
      outcome.reasonCode,
    );
  }
}

export async function runOutboxBatch(
  deps: OutboxRunnerDeps,
): Promise<OutboxRunResult> {
  const now = deps.now();
  await deps.repository.recoverExpiredDispatchLeases(now);
  await deps.repository.recoverExpiredReconciliationLeases(now);
  const leaseUntil = new Date(now.getTime() + (deps.leaseDurationMs ?? 30_000));

  const unknown = await deps.repository.claimUnknown(
    deps.batchSize,
    deps.workerId,
    leaseUntil,
    deps.maxReconciliationAttempts,
  );
  for (const message of unknown) {
    await reconcileUnknown(deps, message, now);
  }

  const messages = await deps.repository.claim(
    deps.batchSize,
    deps.workerId,
    leaseUntil,
    deps.maxAttempts,
  );
  for (const message of messages) {
    await dispatchPending(deps, message, now);
  }

  return { reconciled: unknown.length, dispatched: messages.length };
}
