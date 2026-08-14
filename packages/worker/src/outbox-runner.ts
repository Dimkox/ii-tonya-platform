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
  claimWithMetrics?(
    limit: number,
    owner: string,
    leaseDurationMs: number,
    maxAttempts: number,
  ): Promise<OutboxClaimBatch>;
  claimUnknownWithMetrics?(
    limit: number,
    owner: string,
    leaseDurationMs: number,
    maxReconciliationAttempts: number,
  ): Promise<OutboxClaimBatch>;
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
  recoverExpiredDispatchLeasesByTopic?(
    limit?: number,
  ): Promise<readonly OutboxRecoveryCount[]>;
  recoverExpiredReconciliationLeasesByTopic?(
    limit?: number,
  ): Promise<readonly OutboxRecoveryCount[]>;
}

export type DispatchOutcome =
  | { kind: "applied"; providerOperationId?: string }
  | { kind: "not_applied"; retryable: boolean; reasonCode: string }
  | { kind: "unknown_outcome"; reconciliationKey: string; reasonCode: string }
  | {
      kind: "terminal";
      reasonCode: "invalid_payload" | "local_source_invalid";
    };

export interface OutboxDispatcher {
  dispatch(message: OutboxMessage): Promise<DispatchOutcome>;
}

export interface OutboxReconciler {
  reconcile(message: OutboxMessage): Promise<
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
  metrics?: OutboxRunnerMetrics;
}

export type OutboxMetricTopic =
  "safety_operator_escalation" | "admin_negative_feedback";
export type OutboxMetricPhase =
  "claim" | "dispatch" | "reconciliation" | "lease_recovery";
export type OutboxMetricOutcome =
  "applied" | "retry" | "unknown" | "terminal" | "dead_letter" | "no_op";
export type OutboxMetricReasonClass =
  | "invalid_payload"
  | "local_source_invalid"
  | "attempts_exhausted"
  | "reconciliation_exhausted"
  | "lease_expired"
  | "internal";
export interface OutboxRunnerMetricLabels {
  readonly topic: OutboxMetricTopic;
  readonly phase: OutboxMetricPhase;
  readonly outcome: OutboxMetricOutcome;
  readonly reasonClass: OutboxMetricReasonClass;
}
export interface OutboxRunnerMetrics {
  record(labels: OutboxRunnerMetricLabels, count?: number): void;
}
export interface OutboxRecoveryCount {
  readonly topic: "safety.operator_escalation" | "admin.negative_feedback";
  readonly count: number;
}
export interface OutboxClaimBatch {
  readonly messages: readonly OutboxMessage[];
  readonly exhausted: readonly OutboxRecoveryCount[];
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
    throw new Error("outbox_dispatch_claim_token_missing");
  }
  return message.dispatchClaimToken;
}

function reconciliationToken(message: OutboxMessage): string {
  if (message.reconciliationClaimToken === null) {
    throw new Error("outbox_reconciliation_claim_token_missing");
  }
  return message.reconciliationClaimToken;
}

function metricTopic(topic: string): OutboxMetricTopic {
  if (topic === "safety.operator_escalation") {
    return "safety_operator_escalation";
  }
  if (topic === "admin.negative_feedback") return "admin_negative_feedback";
  throw new Error("worker_outbox_metric_topic_unregistered");
}

function reasonClass(reasonCode: string): OutboxMetricReasonClass {
  if (reasonCode === "invalid_payload") return "invalid_payload";
  if (reasonCode === "local_source_invalid") return "local_source_invalid";
  if (reasonCode.includes("reconciliation_exhausted")) {
    return "reconciliation_exhausted";
  }
  if (reasonCode.includes("attempts_exhausted")) {
    return "attempts_exhausted";
  }
  return "internal";
}

function record(
  deps: OutboxRunnerDeps,
  topic: string,
  phase: OutboxMetricPhase,
  outcome: OutboxMetricOutcome,
  metricReason: OutboxMetricReasonClass,
  count?: number,
): void {
  deps.metrics?.record(
    { topic: metricTopic(topic), phase, outcome, reasonClass: metricReason },
    count,
  );
}

function recordRecovery(
  deps: OutboxRunnerDeps,
  counts: readonly OutboxRecoveryCount[],
): void {
  for (const item of counts) {
    if (!Number.isSafeInteger(item.count) || item.count < 0) {
      throw new Error("worker_outbox_recovery_count_invalid");
    }
    if (item.count > 0) {
      record(
        deps,
        item.topic,
        "lease_recovery",
        "unknown",
        "lease_expired",
        item.count,
      );
    }
  }
}

function recordExhaustion(
  deps: OutboxRunnerDeps,
  counts: readonly OutboxRecoveryCount[],
  metricReason: "attempts_exhausted" | "reconciliation_exhausted",
): void {
  for (const item of counts) {
    if (!Number.isSafeInteger(item.count) || item.count < 0) {
      throw new Error("worker_outbox_exhaustion_count_invalid");
    }
    if (item.count > 0) {
      record(
        deps,
        item.topic,
        "claim",
        "dead_letter",
        metricReason,
        item.count,
      );
    }
  }
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
      record(
        deps,
        message.topic,
        "reconciliation",
        "dead_letter",
        "reconciliation_exhausted",
      );
    } else {
      await deps.repository.markStillUnknown(
        message.id,
        deps.workerId,
        reconciliationToken(message),
        "reconciliation_exception",
        retryAt(deps, now, message.reconciliationAttempt),
      );
      record(deps, message.topic, "reconciliation", "unknown", "internal");
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
    record(
      deps,
      message.topic,
      "reconciliation",
      "terminal",
      reasonClass(resolution.reasonCode),
    );
    return;
  }

  if (resolution === "applied") {
    await deps.repository.succeedAfterReconciliation(
      message.id,
      deps.workerId,
      reconciliationToken(message),
    );
    record(deps, message.topic, "reconciliation", "applied", "internal");
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
      record(
        deps,
        message.topic,
        "reconciliation",
        "dead_letter",
        "attempts_exhausted",
      );
    } else {
      await deps.repository.retryAfterReconciliation(
        message.id,
        deps.workerId,
        reconciliationToken(message),
        retryAt(deps, now, message.attempt),
        "reconciled_not_applied",
      );
      record(deps, message.topic, "reconciliation", "retry", "internal");
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
    record(
      deps,
      message.topic,
      "reconciliation",
      "dead_letter",
      "reconciliation_exhausted",
    );
  } else {
    await deps.repository.markStillUnknown(
      message.id,
      deps.workerId,
      reconciliationToken(message),
      "still_unknown",
      retryAt(deps, now, message.reconciliationAttempt),
    );
    record(deps, message.topic, "reconciliation", "unknown", "internal");
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
    record(deps, message.topic, "dispatch", "unknown", "internal");
    return;
  }

  if (outcome.kind === "applied") {
    await deps.repository.succeed(
      message.id,
      deps.workerId,
      dispatchToken(message),
    );
    record(deps, message.topic, "dispatch", "applied", "internal");
    return;
  }
  if (outcome.kind === "terminal") {
    await deps.repository.deadLetterAndAlert(
      message.id,
      deps.workerId,
      dispatchToken(message),
      outcome.reasonCode,
    );
    record(
      deps,
      message.topic,
      "dispatch",
      "terminal",
      reasonClass(outcome.reasonCode),
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
    record(deps, message.topic, "dispatch", "unknown", "internal");
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
    record(deps, message.topic, "dispatch", "retry", "internal");
  } else {
    await deps.repository.deadLetterAndAlert(
      message.id,
      deps.workerId,
      dispatchToken(message),
      outcome.reasonCode,
    );
    record(deps, message.topic, "dispatch", "dead_letter", "internal");
  }
}

export async function runOutboxBatch(
  deps: OutboxRunnerDeps,
): Promise<OutboxRunResult> {
  if (
    !Number.isSafeInteger(deps.batchSize) ||
    deps.batchSize < 1 ||
    deps.batchSize > MAX_OUTBOX_BATCH_SIZE
  ) {
    throw new RangeError("batchSize must be a safe integer between 1 and 1000");
  }
  const now = deps.now();
  if (deps.metrics === undefined) {
    await deps.repository.recoverExpiredDispatchLeases(deps.batchSize);
    await deps.repository.recoverExpiredReconciliationLeases(deps.batchSize);
  } else {
    if (
      deps.repository.recoverExpiredDispatchLeasesByTopic === undefined ||
      deps.repository.recoverExpiredReconciliationLeasesByTopic === undefined
    ) {
      throw new Error("worker_outbox_metrics_recovery_capability_unavailable");
    }
    recordRecovery(
      deps,
      await deps.repository.recoverExpiredDispatchLeasesByTopic(deps.batchSize),
    );
    recordRecovery(
      deps,
      await deps.repository.recoverExpiredReconciliationLeasesByTopic(
        deps.batchSize,
      ),
    );
  }
  const leaseDurationMs = deps.leaseDurationMs ?? 30_000;

  let unknown: readonly OutboxMessage[];
  if (deps.metrics === undefined) {
    unknown = await deps.repository.claimUnknown(
      deps.batchSize,
      deps.workerId,
      leaseDurationMs,
      deps.maxReconciliationAttempts,
    );
  } else {
    if (deps.repository.claimUnknownWithMetrics === undefined) {
      throw new Error("worker_outbox_metrics_claim_capability_unavailable");
    }
    const batch = await deps.repository.claimUnknownWithMetrics(
      deps.batchSize,
      deps.workerId,
      leaseDurationMs,
      deps.maxReconciliationAttempts,
    );
    unknown = batch.messages;
    recordExhaustion(
      deps,
      batch.exhausted,
      "reconciliation_exhausted",
    );
  }
  for (const message of unknown) {
    record(deps, message.topic, "claim", "no_op", "internal");
    await reconcileUnknown(deps, message, now);
  }

  let messages: readonly OutboxMessage[];
  if (deps.metrics === undefined) {
    messages = await deps.repository.claim(
      deps.batchSize,
      deps.workerId,
      leaseDurationMs,
      deps.maxAttempts,
    );
  } else {
    if (deps.repository.claimWithMetrics === undefined) {
      throw new Error("worker_outbox_metrics_claim_capability_unavailable");
    }
    const batch = await deps.repository.claimWithMetrics(
      deps.batchSize,
      deps.workerId,
      leaseDurationMs,
      deps.maxAttempts,
    );
    messages = batch.messages;
    recordExhaustion(deps, batch.exhausted, "attempts_exhausted");
  }
  for (const message of messages) {
    record(deps, message.topic, "claim", "no_op", "internal");
    await dispatchPending(deps, message, now);
  }

  return { reconciled: unknown.length, dispatched: messages.length };
}
