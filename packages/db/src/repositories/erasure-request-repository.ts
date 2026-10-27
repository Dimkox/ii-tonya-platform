import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  PostgresPrivacyWorkflowRepository,
  type PostgresPrivacyRepository,
} from "./privacy-repository.js";

type RequestRow = { id: string; createdAt: string; jobId: string | null };
type RequestTransaction = Parameters<
  Parameters<DrizzleDb["transaction"]>[0]
>[0];
const projection = sql`id, to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt", job_id as "jobId"`;

export class PostgresErasureRequestRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly activeBackupPolicyVersion?: string,
  ) {}
  private async bounded<T>(
    operation: (tx: RequestTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout='2000ms'`);
        await tx.execute(sql`set local lock_timeout='1000ms'`);
        return operation(tx);
      });
    } catch {
      // Rollback has completed before rejecting. No query text, subject/digest
      // parameters or driver error escapes this storage boundary.
      throw new Error("erasure_storage_unavailable");
    }
  }
  async pendingRequests(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("invalid_erasure_batch");
    return this.bounded(
      async (tx) =>
        (
          await tx.execute<{ id: string; userId: string }>(
            sql`select id,user_id as "userId" from client_erasure_requests where job_id is null order by created_at,id limit ${limit}`,
          )
        ).rows,
    );
  }
  async accept(input: {
    userId: string;
    receiptDigest: string;
  }): Promise<
    { kind: "accepted"; request: RequestRow } | { kind: "denied" | "conflict" }
  > {
    return this.bounded(async (tx) => {
      // Same user lock as physical erasure; inactivity is checked after waiting.
      const owner = (
        await tx.execute(
          sql`select id from users where id=${input.userId}::uuid and active for update`,
        )
      ).rows[0];
      if (!owner) return { kind: "denied" };
      const inserted = (
        await tx.execute<RequestRow>(
          sql`insert into client_erasure_requests(user_id,receipt_digest) values (${input.userId}::uuid,${input.receiptDigest}) on conflict do nothing returning ${projection}`,
        )
      ).rows[0];
      if (inserted) return { kind: "accepted", request: inserted };
      const existing = (
        await tx.execute<RequestRow>(
          sql`select ${projection} from client_erasure_requests where user_id=${input.userId}::uuid and receipt_digest=${input.receiptDigest} and receipt_revoked_at is null`,
        )
      ).rows[0];
      return existing
        ? { kind: "accepted", request: existing }
        : { kind: "conflict" };
    });
  }
  async findOwned(userId: string): Promise<RequestRow | null> {
    return this.bounded(
      async (tx) =>
        (
          await tx.execute<RequestRow>(
            sql`select ${projection} from client_erasure_requests where user_id=${userId}::uuid`,
          )
        ).rows[0] ?? null,
    );
  }
  async findByReceiptDigest(digest: string): Promise<RequestRow | null> {
    return this.bounded(
      async (tx) =>
        (
          await tx.execute<RequestRow>(
            sql`select ${projection} from client_erasure_requests where receipt_digest=${digest} and receipt_revoked_at is null`,
          )
        ).rows[0] ?? null,
    );
  }
  async getVerifiedJob(jobId: string) {
    return this.bounded(async (tx) => {
      const row = (
        await tx.execute<{ receipt: unknown; policy: string | null }>(sql`
      select j.erasure_receipt as receipt, j.backup_policy_version as policy
      from privacy_deletion_jobs j join client_erasure_requests r on r.job_id=j.id and r.user_id=j.user_id
      where j.id=${jobId}::uuid
      for update of j
    `)
      ).rows[0];
      if (!row) throw new Error("erasure_job_unavailable");
      const job = await new PostgresPrivacyWorkflowRepository(this.db).getJob(
        jobId,
        tx,
      );
      if (
        job.status === "backup_verified" &&
        (!this.activeBackupPolicyVersion ||
          row.policy !== this.activeBackupPolicyVersion)
      )
        throw new Error("erasure_proof_unavailable");
      const receipt = row.receipt as Record<string, unknown> | null;
      const ledger = receipt?.ledgerFactsPreserved;
      const audit = receipt?.auditFactsPreserved;
      const retainedFacts =
        typeof ledger === "number" &&
        Number.isSafeInteger(ledger) &&
        ledger >= 0 &&
        typeof audit === "number" &&
        Number.isSafeInteger(audit) &&
        audit >= 0
          ? { ledgerFactsPreserved: ledger, auditFactsPreserved: audit }
          : null;
      if (job.status === "backup_verified" && !retainedFacts)
        throw new Error("erasure_receipt_unavailable");
      return { status: job.status, retainedFacts };
    });
  }
}

/** Trusted execution adapter; no receipt-facing method calls this mutation. */
export function createErasureRequestExecution(
  privacy: Pick<PostgresPrivacyRepository, "startErasureAtomically">,
  pseudonymize: (userId: string) => string,
) {
  return {
    begin(request: { id: string; userId: string }) {
      return privacy.startErasureAtomically({
        requestId: request.id,
        targetUserId: request.userId,
        correlationId: `erasure-request:${request.id}`,
        idempotencyKey: `erasure-request:${request.id}`,
        pseudonym: pseudonymize(request.userId),
      });
    },
  };
}
