import type { OutboxMessage, OutboxRepository } from "./outbox-runner.js";

type FakeStatus =
  | "pending"
  | "processing"
  | "unknown_outcome"
  | "reconciling"
  | "retry_wait"
  | "succeeded"
  | "dead_letter";

interface FakeRow extends OutboxMessage {
  status: FakeStatus;
  leaseUntil?: Date;
  dispatchOwner?: string;
  reconciliationLeaseUntil?: Date;
  reconciliationOwner?: string;
  nextAttemptAt?: Date;
  nextReconciliationAt?: Date;
}

export interface FakeOutboxRepository extends OutboxRepository {
  retryCalls: { id: string; at: string; reasonCode: string }[];
  succeedCalls: string[];
  deadLetterCalls: { id: string; reasonCode: string }[];
  makeRetriesDue(): void;
  makeUnknownClaimable(): void;
  makeUnknown(id: string, reconciliationAttempt?: number): void;
  failNextLocalSuccessWrite(): void;
}

function cloneMessage(row: FakeRow): OutboxMessage {
  return {
    id: row.id,
    topic: row.topic,
    payload: row.payload,
    correlationId: row.correlationId,
    attempt: row.attempt,
    reconciliationKey: row.reconciliationKey,
    reconciliationAttempt: row.reconciliationAttempt,
  };
}

export function fakeOutboxRepository(
  seed: readonly Pick<OutboxMessage, "id" | "topic" | "attempt">[],
): FakeOutboxRepository {
  const rows = new Map<string, FakeRow>(
    seed.map((item) => [
      item.id,
      {
        ...item,
        payload: {},
        correlationId: `correlation:${item.id}`,
        reconciliationKey: `${item.topic.split(".").at(-1) ?? item.topic}:${item.id}`,
        reconciliationAttempt: 0,
        status: "pending",
      },
    ]),
  );
  let failSuccessWrite = false;
  const retryCalls: { id: string; at: string; reasonCode: string }[] = [];
  const succeedCalls: string[] = [];
  const deadLetterCalls: { id: string; reasonCode: string }[] = [];

  const requireRow = (id: string): FakeRow => {
    const row = rows.get(id);
    if (row === undefined) throw new Error(`Unknown fake outbox row: ${id}`);
    return row;
  };

  return {
    retryCalls,
    succeedCalls,
    deadLetterCalls,
    async claim(limit, owner, leaseUntil, maxAttempts) {
      for (const row of rows.values()) {
        if (
          (row.status === "pending" || row.status === "retry_wait") &&
          row.attempt >= maxAttempts
        ) {
          row.status = "dead_letter";
          deadLetterCalls.push({
            id: row.id,
            reasonCode: "dispatch_attempts_exhausted_before_claim",
          });
        }
      }
      const claimed = [...rows.values()]
        .filter(
          (row) => row.status === "pending" || row.status === "retry_wait",
        )
        .slice(0, limit);
      for (const row of claimed) {
        row.status = "processing";
        row.attempt += 1;
        row.leaseUntil = leaseUntil;
        row.dispatchOwner = owner;
      }
      return claimed.map(cloneMessage);
    },
    async claimUnknown(limit, owner, leaseUntil, maxReconciliationAttempts) {
      for (const row of rows.values()) {
        if (
          row.status === "unknown_outcome" &&
          row.reconciliationAttempt >= maxReconciliationAttempts
        ) {
          row.status = "dead_letter";
          deadLetterCalls.push({
            id: row.id,
            reasonCode:
              "unknown_outcome_reconciliation_exhausted_before_claim",
          });
        }
      }
      const claimed = [...rows.values()]
        .filter((row) => row.status === "unknown_outcome")
        .slice(0, limit);
      for (const row of claimed) {
        row.status = "reconciling";
        row.reconciliationAttempt += 1;
        row.reconciliationLeaseUntil = leaseUntil;
        row.reconciliationOwner = owner;
      }
      return claimed.map(cloneMessage);
    },
    async recordAttemptStarted(id, owner, _attemptId, reconciliationKey, now) {
      const row = requireRow(id);
      if (
        row.status !== "processing" ||
        row.dispatchOwner !== owner ||
        row.leaseUntil === undefined ||
        row.leaseUntil < now
      )
        throw new Error("Row is not dispatch-leased");
      if (row.reconciliationKey !== reconciliationKey) {
        throw new Error("Reconciliation key mismatch");
      }
    },
    async markUnknownOutcome(
      id,
      owner,
      _attemptId,
      reconciliationKey,
      _reasonCode,
      now,
    ) {
      const row = requireRow(id);
      if (
        row.status !== "processing" ||
        row.dispatchOwner !== owner ||
        row.leaseUntil === undefined ||
        row.leaseUntil < now
      ) {
        throw new Error("Dispatch lease lost");
      }
      if (row.reconciliationKey !== reconciliationKey) {
        throw new Error("Reconciliation key mismatch");
      }
      row.status = "unknown_outcome";
      delete row.leaseUntil;
      delete row.dispatchOwner;
    },
    async markStillUnknown(id, owner, now, _reasonCode, nextCheckAt) {
      const row = requireRow(id);
      if (
        row.status !== "reconciling" ||
        row.reconciliationOwner !== owner ||
        row.reconciliationLeaseUntil === undefined ||
        row.reconciliationLeaseUntil < now
      ) {
        throw new Error("Reconciliation lease lost");
      }
      row.status = "unknown_outcome";
      row.nextReconciliationAt = nextCheckAt;
      delete row.reconciliationLeaseUntil;
      delete row.reconciliationOwner;
    },
    async succeed(id, owner, now) {
      if (failSuccessWrite) {
        failSuccessWrite = false;
        throw new Error("simulated local acknowledgement failure");
      }
      const row = requireRow(id);
      if (
        row.status !== "processing" ||
        row.dispatchOwner !== owner ||
        row.leaseUntil === undefined ||
        row.leaseUntil < now
      ) {
        throw new Error("Dispatch lease lost");
      }
      row.status = "succeeded";
      succeedCalls.push(id);
    },
    async retry(id, owner, now, nextAttemptAt, reasonCode) {
      const row = requireRow(id);
      if (
        row.status !== "processing" ||
        row.dispatchOwner !== owner ||
        row.leaseUntil === undefined ||
        row.leaseUntil < now
      ) {
        throw new Error("Dispatch lease lost");
      }
      row.status = "retry_wait";
      row.nextAttemptAt = nextAttemptAt;
      retryCalls.push({ id, at: nextAttemptAt.toISOString(), reasonCode });
    },
    async deadLetterAndAlert(id, owner, now, reasonCode) {
      const row = requireRow(id);
      if (
        row.status !== "processing" ||
        row.dispatchOwner !== owner ||
        row.leaseUntil === undefined ||
        row.leaseUntil < now
      ) {
        throw new Error("Dispatch lease lost");
      }
      row.status = "dead_letter";
      deadLetterCalls.push({ id, reasonCode });
    },
    async succeedAfterReconciliation(id, owner, now) {
      const row = requireRow(id);
      if (
        row.status !== "reconciling" ||
        row.reconciliationOwner !== owner ||
        row.reconciliationLeaseUntil === undefined ||
        row.reconciliationLeaseUntil < now
      ) {
        throw new Error("Reconciliation lease lost");
      }
      row.status = "succeeded";
      succeedCalls.push(id);
    },
    async retryAfterReconciliation(
      id,
      owner,
      now,
      nextAttemptAt,
      reasonCode,
    ) {
      const row = requireRow(id);
      if (
        row.status !== "reconciling" ||
        row.reconciliationOwner !== owner ||
        row.reconciliationLeaseUntil === undefined ||
        row.reconciliationLeaseUntil < now
      ) {
        throw new Error("Reconciliation lease lost");
      }
      row.status = "retry_wait";
      row.nextAttemptAt = nextAttemptAt;
      retryCalls.push({ id, at: nextAttemptAt.toISOString(), reasonCode });
    },
    async deadLetterAfterReconciliationAndAlert(id, owner, now, reasonCode) {
      const row = requireRow(id);
      if (
        row.status !== "reconciling" ||
        row.reconciliationOwner !== owner ||
        row.reconciliationLeaseUntil === undefined ||
        row.reconciliationLeaseUntil < now
      ) {
        throw new Error("Reconciliation lease lost");
      }
      row.status = "dead_letter";
      deadLetterCalls.push({ id, reasonCode });
    },
    async recoverExpiredDispatchLeases(now) {
      let count = 0;
      for (const row of rows.values()) {
        if (
          row.status === "processing" &&
          row.leaseUntil !== undefined &&
          row.leaseUntil <= now
        ) {
          row.status = "unknown_outcome";
          delete row.leaseUntil;
          delete row.dispatchOwner;
          count += 1;
        }
      }
      return count;
    },
    async recoverExpiredReconciliationLeases(now) {
      let count = 0;
      for (const row of rows.values()) {
        if (
          row.status === "reconciling" &&
          row.reconciliationLeaseUntil !== undefined &&
          row.reconciliationLeaseUntil <= now
        ) {
          row.status = "unknown_outcome";
          delete row.reconciliationLeaseUntil;
          delete row.reconciliationOwner;
          count += 1;
        }
      }
      return count;
    },
    makeRetriesDue() {
      for (const row of rows.values()) {
        if (row.status === "retry_wait") {
          row.status = "pending";
          delete row.nextAttemptAt;
        }
      }
    },
    makeUnknownClaimable() {
      for (const row of rows.values()) {
        if (row.status === "unknown_outcome") delete row.nextReconciliationAt;
      }
    },
    makeUnknown(id, reconciliationAttempt = 0) {
      const row = requireRow(id);
      row.status = "unknown_outcome";
      row.reconciliationAttempt = reconciliationAttempt;
    },
    failNextLocalSuccessWrite() {
      failSuccessWrite = true;
    },
  };
}
