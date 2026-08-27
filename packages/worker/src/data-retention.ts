export type RetentionClass = "conversation_content" | "provider_payload";
export type ImmutableRetentionClass =
  | "message_ledger"
  | "consent"
  | "safety"
  | "reservation"
  | "approval"
  | "audit";

export interface RetentionClaim {
  readonly id: string;
  readonly class: RetentionClass | ImmutableRetentionClass | string;
}

export interface RetentionRepository {
  /** PostgreSQL implementation must claim rows using FOR UPDATE SKIP LOCKED. */
  claimExpiredContent(now: Date, batchSize: number): Promise<readonly RetentionClaim[]>;
  markStarted(id: string, idempotencyKey: string): Promise<void>;
  deleteContent(id: string, idempotencyKey: string): Promise<{ kind: "deleted" | "unknown_outcome" }>;
  markDeleted(id: string, idempotencyKey: string): Promise<void>;
  markUnknown(id: string, idempotencyKey: string): Promise<void>;
  reconcile(id: string, idempotencyKey: string): Promise<"deleted" | "not_deleted" | "unknown">;
  deadLetter(id: string, reason: string): Promise<void>;
  alert(event: { class: string; reason: string }): Promise<void>;
}

export interface RetentionDeps {
  readonly repository: RetentionRepository;
  readonly allowedClasses: ReadonlySet<RetentionClass>;
  readonly audit: { append(event: Record<string, unknown>): Promise<void> | void };
  readonly capability?: { enabled: boolean };
}

export interface RetentionReport {
  readonly examined: number;
  readonly deleted: number;
  readonly failed: number;
  readonly byClass: Record<string, { examined: number; deleted: number; failed: number }>;
}

const IMMUTABLE_CLASSES = new Set<string>([
  "message_ledger", "consent", "safety", "reservation", "approval", "audit",
]);

export async function runRetentionBatch(
  deps: RetentionDeps,
  now: Date,
  batchSize: number,
): Promise<RetentionReport> {
  if (!deps.capability?.enabled) throw new Error("Privacy processing is disabled");
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error("Invalid retention batch input");
  }
  const claims = await deps.repository.claimExpiredContent(now, batchSize);
  for (const claim of claims) {
    if (IMMUTABLE_CLASSES.has(claim.class) || !deps.allowedClasses.has(claim.class as RetentionClass)) {
      await deps.repository.alert({ class: claim.class, reason: "forbidden_retention_class" });
      throw new Error(`Retention class ${claim.class} is forbidden`);
    }
  }
  let deleted = 0;
  let failed = 0;
  const byClass: Record<string, { examined: number; deleted: number; failed: number }> = {};
  for (const claim of claims) {
    const counts = byClass[claim.class] ??= { examined: 0, deleted: 0, failed: 0 };
    counts.examined += 1;
    const idempotencyKey = `retention:${claim.class}:${claim.id}`;
    await deps.repository.markStarted(claim.id, idempotencyKey);
    try {
      const outcome = await deps.repository.deleteContent(claim.id, idempotencyKey);
      if (outcome.kind === "deleted") {
        await deps.repository.markDeleted(claim.id, idempotencyKey);
        deleted += 1;
        counts.deleted += 1;
        continue;
      }
      await deps.repository.markUnknown(claim.id, idempotencyKey);
      const reconciled = await deps.repository.reconcile(claim.id, idempotencyKey);
      if (reconciled === "deleted") {
        await deps.repository.markDeleted(claim.id, idempotencyKey);
        deleted += 1;
        counts.deleted += 1;
      } else if (reconciled === "not_deleted") {
        await deps.repository.deadLetter(claim.id, "delete_not_applied_after_reconciliation");
        failed += 1;
        counts.failed += 1;
      } else {
        await deps.repository.deadLetter(claim.id, "delete_unknown_after_reconciliation");
        failed += 1;
        counts.failed += 1;
      }
    } catch {
      await deps.repository.markUnknown(claim.id, idempotencyKey);
      const reconciled = await deps.repository.reconcile(claim.id, idempotencyKey);
      if (reconciled === "deleted") {
        await deps.repository.markDeleted(claim.id, idempotencyKey);
        deleted += 1;
        counts.deleted += 1;
      } else {
        await deps.repository.deadLetter(claim.id, "delete_exception_after_reconciliation");
        failed += 1;
        counts.failed += 1;
      }
    }
  }
  await deps.audit.append({ action: "privacy.retention_completed", examined: claims.length, deleted, failed, byClass });
  return { examined: claims.length, deleted, failed, byClass };
}

export type ClientCatalogRetentionOutcome =
  | "expired"
  | "removed"
  | "no_op"
  | "failed";

export interface ClientCatalogRetentionReport {
  readonly examined: number;
  readonly expired: number;
  readonly removed: number;
}

export interface ClientCatalogRetentionRepository {
  expireDue(input: {
    now: Date;
    limit: number;
  }): Promise<ClientCatalogRetentionReport>;
}

export async function runClientCatalogRetention(
  deps: {
    repository: ClientCatalogRetentionRepository;
    metrics?: {
      record(
        labels: {
          phase: "cleanup";
          outcome: ClientCatalogRetentionOutcome;
        },
        count?: number,
      ): void;
    };
  },
  now: Date,
  limit: number,
): Promise<ClientCatalogRetentionReport> {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1_000
  ) {
    throw new Error("client_catalog_retention_invalid");
  }
  try {
    const report = await deps.repository.expireDue({ now, limit });
    if (report.expired > 0) {
      deps.metrics?.record(
        { phase: "cleanup", outcome: "expired" },
        report.expired,
      );
    }
    if (report.removed > 0) {
      deps.metrics?.record(
        { phase: "cleanup", outcome: "removed" },
        report.removed,
      );
    }
    if (report.examined === 0) {
      deps.metrics?.record({ phase: "cleanup", outcome: "no_op" });
    }
    return report;
  } catch (error) {
    deps.metrics?.record({ phase: "cleanup", outcome: "failed" });
    throw error;
  }
}

export interface ClientSessionRetentionReport {
  readonly receiptsRemoved: number;
  readonly sessionsRemoved: number;
}

type ClientSessionRetentionLabels = Readonly<{
  operation: "cleanup";
  outcome: "allowed" | "unavailable" | "removed";
}>;

export async function runClientSessionRetention(
  deps: {
    repository: {
      cleanupExpired(limit: number): Promise<ClientSessionRetentionReport>;
    };
    metrics?: {
      record(labels: ClientSessionRetentionLabels, count?: number): void;
    };
  },
  limit: number,
): Promise<ClientSessionRetentionReport> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("client_session_retention_invalid");
  }
  try {
    const report = await deps.repository.cleanupExpired(limit);
    if (
      !Number.isSafeInteger(report.receiptsRemoved) ||
      report.receiptsRemoved < 0 ||
      report.receiptsRemoved > limit ||
      !Number.isSafeInteger(report.sessionsRemoved) ||
      report.sessionsRemoved < 0 ||
      report.sessionsRemoved > limit
    ) {
      throw new Error("client_session_retention_unavailable");
    }
    const removed = report.receiptsRemoved + report.sessionsRemoved;
    if (removed > 0) {
      deps.metrics?.record(
        { operation: "cleanup", outcome: "removed" },
        removed,
      );
    } else {
      deps.metrics?.record({ operation: "cleanup", outcome: "allowed" });
    }
    return report;
  } catch {
    deps.metrics?.record({ operation: "cleanup", outcome: "unavailable" });
    throw new Error("client_session_retention_unavailable");
  }
}
