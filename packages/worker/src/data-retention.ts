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
}

export interface RetentionReport {
  readonly examined: number;
  readonly deleted: number;
  readonly failed: number;
}

const IMMUTABLE_CLASSES = new Set<string>([
  "message_ledger", "consent", "safety", "reservation", "approval", "audit",
]);

export async function runRetentionBatch(
  deps: RetentionDeps,
  now: Date,
  batchSize: number,
): Promise<RetentionReport> {
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
  for (const claim of claims) {
    const idempotencyKey = `retention:${claim.class}:${claim.id}`;
    await deps.repository.markStarted(claim.id, idempotencyKey);
    try {
      const outcome = await deps.repository.deleteContent(claim.id, idempotencyKey);
      if (outcome.kind === "deleted") {
        await deps.repository.markDeleted(claim.id, idempotencyKey);
        deleted += 1;
        continue;
      }
      await deps.repository.markUnknown(claim.id, idempotencyKey);
      const reconciled = await deps.repository.reconcile(claim.id, idempotencyKey);
      if (reconciled === "deleted") {
        await deps.repository.markDeleted(claim.id, idempotencyKey);
        deleted += 1;
      } else if (reconciled === "not_deleted") {
        await deps.repository.deadLetter(claim.id, "delete_not_applied_after_reconciliation");
        failed += 1;
      } else {
        await deps.repository.deadLetter(claim.id, "delete_unknown_after_reconciliation");
        failed += 1;
      }
    } catch {
      await deps.repository.markUnknown(claim.id, idempotencyKey);
      const reconciled = await deps.repository.reconcile(claim.id, idempotencyKey);
      if (reconciled === "deleted") {
        await deps.repository.markDeleted(claim.id, idempotencyKey);
        deleted += 1;
      } else {
        await deps.repository.deadLetter(claim.id, "delete_exception_after_reconciliation");
        failed += 1;
      }
    }
  }
  return { examined: claims.length, deleted, failed };
}
