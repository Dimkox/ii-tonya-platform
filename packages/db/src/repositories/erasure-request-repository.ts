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
  /** Authenticated Telegram admission and update ownership share one commit.
   * Lock order: event advisory lock -> user -> identity -> erasure request.
   * A durable denied/pinned owner tombstone prevents old updates targeting a new binding.
   */
  async acceptTelegram(input: {
    botKey: string;
    telegramUserId: string;
    chatId: string;
    eventKey: string;
    payloadHash: string;
    receiptDigest(userId: string): string;
  }): Promise<
    | {
        kind: "accepted";
        userId: string;
        request: RequestRow;
        receiptAvailable: boolean;
      }
    | { kind: "denied" }
  > {
    if (
      !input.botKey ||
      input.botKey.length > 256 ||
      !/^[1-9]\d{0,19}$/u.test(input.telegramUserId) ||
      input.chatId !== input.telegramUserId ||
      !/^[0-9a-f]{64}$/u.test(input.eventKey) ||
      !/^[0-9a-f]{64}$/u.test(input.payloadHash)
    )
      return { kind: "denied" };
    return this.bounded(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"telegram-erasure:" + input.eventKey},0))`,
      );
      const replay = (
        await tx.execute<{ owner: string; hash: string }>(sql`
        select normalized_identifier as owner, payload_hash as hash from integration_inbox
        where provider='telegram_erasure_v1' and external_event_id=${input.eventKey}
      `)
      ).rows[0];
      if (
        replay &&
        (replay.hash !== input.payloadHash || replay.owner === "denied")
      )
        return { kind: "denied" };
      // Preliminary discovery supplies the user lock only; authorization is repeated
      // after that lock and under a row lock on the exact private identity.
      const candidates = (
        await tx.execute<{ id: string; userId: string }>(sql`
        select id, user_id as "userId" from channel_identities
        where provider='telegram' and bot_key=${input.botKey} and external_id=${input.telegramUserId}
          and external_chat_id=${input.chatId} and status='active' limit 2
      `)
      ).rows;
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      const pinnedOwner = replay?.owner ?? candidate?.userId ?? "denied";
      if (!replay)
        await tx.execute(sql`
        insert into integration_inbox(provider,external_event_id,payload_hash,normalized_identifier)
        values('telegram_erasure_v1',${input.eventKey},${input.payloadHash},${pinnedOwner})
      `);
      if (!candidate || pinnedOwner !== candidate.userId)
        return { kind: "denied" };
      const userId = candidate.userId;
      const owner = (
        await tx.execute(
          sql`select id from users where id=${userId}::uuid and active for update`,
        )
      ).rows[0];
      if (!owner) return { kind: "denied" };
      const identity = (
        await tx.execute(sql`
        select id from channel_identities where id=${candidate.id}::uuid and user_id=${userId}::uuid
          and provider='telegram' and bot_key=${input.botKey} and external_id=${input.telegramUserId}
          and external_chat_id=${input.chatId} and status='active' for update
      `)
      ).rows[0];
      if (!identity) return { kind: "denied" };
      const receiptDigest = input.receiptDigest(userId);
      if (!/^[0-9a-f]{64}$/u.test(receiptDigest))
        throw new Error("invalid_receipt_digest");
      const inserted = (
        await tx.execute<RequestRow>(sql`
        insert into client_erasure_requests(user_id,receipt_digest) values(${userId}::uuid,${receiptDigest})
        on conflict do nothing returning ${projection}
      `)
      ).rows[0];
      const request =
        inserted ??
        (
          await tx.execute<RequestRow & { receiptAvailable: boolean }>(sql`
        select ${projection}, (receipt_digest=${receiptDigest} and receipt_revoked_at is null) as "receiptAvailable"
        from client_erasure_requests where user_id=${userId}::uuid for update
      `)
        ).rows[0];
      if (!request) throw new Error("erasure_request_unavailable");
      return {
        kind: "accepted",
        userId,
        request,
        receiptAvailable:
          inserted !== undefined ||
          (request as RequestRow & { receiptAvailable: boolean })
            .receiptAvailable === true,
      };
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
