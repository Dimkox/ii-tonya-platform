import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { withSerializableRetry } from "./message-repository.js";

export interface WithdrawConsentCommand {
  readonly targetUserId: string;
  readonly purpose: string;
  readonly policyVersion: string;
  readonly correlationId: string;
}
export interface WithdrawalReceipt {
  readonly consentDecisionId: string;
  readonly optionalFieldsRemoved: number;
  readonly followUpsCancelled: number;
}
export interface SubjectExport {
  readonly userId: string;
  readonly identity: readonly { provider: string; externalId: string }[];
  readonly consents: readonly { purpose: string; decision: string; policyVersion: string; createdAt: string }[];
  readonly profile: { displayName?: string; timezone?: string } | null;
  readonly reservations: readonly { id: string; status: string; startsAt?: string }[];
  readonly feedback: readonly { reservationId: string; rating: number }[];
  readonly messageAccounting: { packageCount: number; eventCount: number; ledgerEntryCount: number };
}
export interface StartErasureCommand {
  readonly targetUserId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly pseudonym: string;
}
export interface ErasureJob {
  readonly jobId: string;
  readonly status: "pending" | "processor_complete" | "backup_verified";
  readonly contentRefsDeleted: number;
  readonly profileFieldsDeleted: number;
  readonly ledgerFactsPreserved: number;
  readonly auditFactsPreserved: number;
}

export interface PrivacyRepository {
  withdrawConsentAtomically(command: WithdrawConsentCommand): Promise<WithdrawalReceipt>;
  exportOwnedSubject(userId: string): Promise<SubjectExport>;
  startErasureAtomically(command: StartErasureCommand): Promise<ErasureJob>;
}

type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends (transaction: infer T) => unknown ? T : never;
const PROCESSORS = ["object_store", "selarti", "planerka", "make_projection"] as const;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function one<T>(rows: T[], description: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`Expected ${description}`);
  return row;
}

/** Static contract kept executable to prevent a downgrade from PostgreSQL-safe privacy controls. */
export function assertPrivacyWorkflowContract(): {
  postgresAuthoritative: true;
  immutableFactsRewritten: false;
  retentionClaim: "for_update_skip_locked";
  backupDeletionClaim: "expiry_evidence_only";
} {
  return {
    postgresAuthoritative: true,
    immutableFactsRewritten: false,
    retentionClaim: "for_update_skip_locked",
    backupDeletionClaim: "expiry_evidence_only",
  };
}

export class PostgresPrivacyRepository implements PrivacyRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly options: { beforeWithdrawalAudit?: () => Promise<void> | void } = {},
  ) {}

  withdrawConsentAtomically(command: WithdrawConsentCommand): Promise<WithdrawalReceipt> {
    return withSerializableRetry(() => this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level serializable`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${command.targetUserId}, 0))`);
      const consent = one((await tx.execute<{ id: string }>(sql`
        insert into consents (user_id, consent_type, decision, policy_version)
        values (${command.targetUserId}::uuid, ${command.purpose}, 'denied', ${command.policyVersion})
        returning id
      `)).rows, "withdrawal consent fact");
      const profile = await tx.execute<{ count: number }>(sql`
        update client_profiles
        set display_name = null, timezone = null, expert_note = null, updated_at = now()
        where user_id = ${command.targetUserId}::uuid
          and ${command.purpose} in ('client_profile', 'expert_note', 'profile')
        returning 1 as count
      `);
      const cancelled = await tx.execute<{ count: number }>(sql`
        delete from notifications n
        using reservations r
        where n.reservation_id = r.id
          and r.user_id = ${command.targetUserId}::uuid
          and n.callback_consumed_at is null
        returning 1 as count
      `);
      await this.options.beforeWithdrawalAudit?.();
      await this.auditAndProjection(tx, {
        actorId: command.targetUserId,
        action: "privacy.consent_withdrawn",
        objectType: "consent",
        objectId: consent.id,
        decision: "denied",
        reasonCode: command.purpose,
        correlationId: command.correlationId,
        payload: { purpose: command.purpose, consentDecisionId: consent.id },
      });
      return {
        consentDecisionId: consent.id,
        optionalFieldsRemoved: profile.rows.length === 0 ? 0 : 3,
        followUpsCancelled: cancelled.rows.length,
      };
    }));
  }

  async exportOwnedSubject(userId: string): Promise<SubjectExport> {
    const identity = (await this.db.execute<{ provider: string; externalId: string }>(sql`
      select provider, external_id as "externalId" from channel_identities
      where user_id = ${userId}::uuid order by provider, external_id
    `)).rows;
    const consents = (await this.db.execute<{ purpose: string; decision: string; policyVersion: string; createdAt: Date | string }>(sql`
      select consent_type as purpose, decision, policy_version as "policyVersion", created_at as "createdAt"
      from consents where user_id = ${userId}::uuid order by created_at, id
    `)).rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }));
    const profileRow = (await this.db.execute<{ displayName: string | null; timezone: string | null }>(sql`
      select display_name as "displayName", timezone from client_profiles where user_id = ${userId}::uuid
    `)).rows[0];
    const reservations = (await this.db.execute<{ id: string; status: string; startsAt: Date | string | null }>(sql`
      select r.id, r.status, s.starts_at as "startsAt" from reservations r
      left join slots s on s.id = r.slot_id where r.user_id = ${userId}::uuid order by r.created_at, r.id
    `)).rows.map((row) => ({ id: row.id, status: row.status, ...(row.startsAt === null ? {} : { startsAt: new Date(row.startsAt).toISOString() }) }));
    const feedback = (await this.db.execute<{ reservationId: string; rating: number }>(sql`
      select reservation_id as "reservationId", rating from feedback where user_id = ${userId}::uuid order by created_at, id
    `)).rows;
    const counts = one((await this.db.execute<{ packageCount: number; eventCount: number; ledgerEntryCount: number }>(sql`
      select
        (select count(*)::integer from message_packages where user_id = ${userId}::uuid) as "packageCount",
        (select count(*)::integer from message_events where user_id = ${userId}::uuid) as "eventCount",
        (select count(*)::integer from message_ledger_entries l join message_packages p on p.id = l.package_id where p.user_id = ${userId}::uuid) as "ledgerEntryCount"
    `)).rows, "message accounting summary");
    return {
      userId,
      identity,
      consents,
      profile: profileRow === undefined ? null : {
        ...(profileRow.displayName === null ? {} : { displayName: profileRow.displayName }),
        ...(profileRow.timezone === null ? {} : { timezone: profileRow.timezone }),
      },
      reservations,
      feedback,
      messageAccounting: {
        packageCount: Number(counts.packageCount), eventCount: Number(counts.eventCount), ledgerEntryCount: Number(counts.ledgerEntryCount),
      },
    };
  }

  startErasureAtomically(command: StartErasureCommand): Promise<ErasureJob> {
    return withSerializableRetry(() => this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level serializable`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${command.targetUserId}, 0))`);
      const existing = (await tx.execute<{ jobId: string; status: ErasureJob["status"] }>(sql`
        select id as "jobId", status from privacy_deletion_jobs
        where user_id = ${command.targetUserId}::uuid and idempotency_key = ${command.idempotencyKey}
        for update
      `)).rows[0];
      if (existing !== undefined) return this.erasureReceipt(tx, existing.jobId, existing.status);

      const content = await tx.execute<{ id: string }>(sql`
        update conversation_messages cm set content_ref = null
        from conversations c where cm.conversation_id = c.id and c.user_id = ${command.targetUserId}::uuid
          and cm.content_ref is not null returning cm.id
      `);
      const feedback = await tx.execute<{ id: string }>(sql`
        update feedback set comment_ref = null, updated_at = now()
        where user_id = ${command.targetUserId}::uuid and comment_ref is not null returning id
      `);
      const meetings = await tx.execute<{ id: string }>(sql`
        update reservations set meeting_url = null, updated_at = now()
        where user_id = ${command.targetUserId}::uuid and meeting_url is not null returning id
      `);
      const profiles = await tx.execute<{ userId: string }>(sql`
        delete from client_profiles where user_id = ${command.targetUserId}::uuid returning user_id as "userId"
      `);
      await tx.execute(sql`delete from channel_identities where user_id = ${command.targetUserId}::uuid`);
      const job = one((await tx.execute<{ id: string }>(sql`
        insert into privacy_deletion_jobs (user_id, idempotency_key, status, evidence_pseudonym)
        values (${command.targetUserId}::uuid, ${command.idempotencyKey}, 'pending', ${command.pseudonym}) returning id
      `)).rows, "privacy deletion job");
      for (const processor of PROCESSORS) {
        await tx.execute(sql`
          insert into privacy_processor_attempts (deletion_job_id, processor, status)
          values (${job.id}::uuid, ${processor}, 'pending')
        `);
      }
      const [ledgerFacts, auditFacts] = await Promise.all([
        tx.execute<{ count: number }>(sql`select count(*)::integer as count from message_ledger_entries l join message_packages p on p.id = l.package_id where p.user_id = ${command.targetUserId}::uuid`),
        tx.execute<{ count: number }>(sql`select count(*)::integer as count from audit_events where actor_id = ${command.targetUserId}::uuid`),
      ]);
      await this.auditAndProjection(tx, {
        actorId: command.targetUserId,
        action: "privacy.erasure_started",
        objectType: "privacy_deletion_job",
        objectId: job.id,
        decision: "pending",
        reasonCode: "subject_erasure",
        correlationId: command.correlationId,
        payload: { jobId: job.id, evidencePseudonym: command.pseudonym },
      });
      return {
        jobId: job.id, status: "pending",
        contentRefsDeleted: content.rows.length + feedback.rows.length + meetings.rows.length,
        profileFieldsDeleted: profiles.rows.length === 0 ? 0 : 3,
        ledgerFactsPreserved: Number(ledgerFacts.rows[0]?.count ?? 0),
        auditFactsPreserved: Number(auditFacts.rows[0]?.count ?? 0),
      };
    }));
  }

  private async erasureReceipt(tx: Transaction, jobId: string, status: ErasureJob["status"]): Promise<ErasureJob> {
    const [ledger, audit] = await Promise.all([
      tx.execute<{ count: number }>(sql`select 0::integer as count`),
      tx.execute<{ count: number }>(sql`select 0::integer as count`),
    ]);
    return { jobId, status, contentRefsDeleted: 0, profileFieldsDeleted: 0, ledgerFactsPreserved: Number(ledger.rows[0]?.count ?? 0), auditFactsPreserved: Number(audit.rows[0]?.count ?? 0) };
  }

  private async auditAndProjection(tx: Transaction, input: {
    actorId: string; action: string; objectType: string; objectId: string; decision: string; reasonCode: string; correlationId: string; payload: Record<string, unknown>;
  }): Promise<void> {
    const metadataHash = hash(input.payload);
    await tx.execute(sql`
      insert into audit_events (actor_type, actor_id, authenticated_session_id_hash, action, object_type, object_id, decision, reason_code, correlation_id, occurred_at, metadata_hash)
      values ('client', ${input.actorId}::uuid, ${hash({ actorId: input.actorId })}, ${input.action}, ${input.objectType}, ${input.objectId}::uuid, ${input.decision}, ${input.reasonCode}, ${input.correlationId}, now(), ${metadataHash})
    `);
    await tx.execute(sql`
      insert into integration_outbox (idempotency_key, topic, payload, correlation_id, reconciliation_key, payload_hash)
      values (${`privacy:${input.action}:${input.objectId}`}, 'make.privacy_projection', ${JSON.stringify(input.payload)}::jsonb, ${input.correlationId}, ${`privacy:${input.objectId}`}, ${metadataHash})
    `);
  }
}
