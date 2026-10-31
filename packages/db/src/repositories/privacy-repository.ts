import { privateObjectErasureSubjectKey } from "./resident-private-erasure.js";
import { lockBookingNotificationSubjects } from "./booking-notification-authority.js";
import {
  eraseBookingNotificationRecipients,
  stopBookingNotificationRecipients,
} from "./booking-notification-repository.js";
import { createHash } from "node:crypto";
import {
  backupScheduleSchema,
  backupVerificationEvidenceSchema,
  requireBackupVerificationEvidence,
  type BackupVerificationEvidence,
  type BackupSchedule,
} from "@ii-tonya/contracts";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  clientCatalogErasureSubjectKey,
  validateClientCatalogCards,
  type ClientCatalogCard,
} from "./client-catalog-repository.js";
import {
  currentConsentGrantedSql,
  currentConsentStatesSql,
} from "./consent-current.js";
import { withSerializableRetry } from "./message-repository.js";
import { projectConsentScope } from "./consent-scope-export.js";
import { projectConsentPresentation } from "./consent-presentation-export.js";

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
  readonly consents: readonly {
    purpose: string;
    decision: string;
    policyVersion: string;
    createdAt: string;
    evidence: {
      decisionId: string;
      sequence: string;
      channel: string | null;
      scopeFields: { fields?: ("display_name" | "timezone")[] } | null;
      scopeStatus: "absent" | "complete" | "redacted";
      textSha256: string | null;
      basis: string | null;
      priorDecisionId: string | null;
      presentation: {
        id: string;
        createdAt: string;
        consumedAt: string | null;
      } | null;
    };
    document: {
      id: string;
      documentKey: string;
      version: number;
      title: string;
      body: string;
      textSha256: string;
    } | null;
  }[];
  readonly profile: { displayName?: string; timezone?: string } | null;
  readonly reservations: readonly {
    id: string;
    status: string;
    startsAt?: string;
  }[];
  readonly clientBookings: readonly {
    bookingHandle: `bk1.${string}`;
    state:
      "reserved" | "booked" | "cancelled" | "expired" | "completed" | "no_show";
    createdAt: string;
    startsAt?: string;
  }[];
  readonly feedback: readonly { reservationId: string; rating: number }[];
  readonly messageAccounting: {
    packageCount: number;
    eventCount: number;
    ledgerEntryCount: number;
  };
  readonly catalogSnapshots: readonly {
    catalogRequestId: string;
    expiresAt: string;
    cards: readonly ClientCatalogCard[];
  }[];
}
export interface StartErasureCommand {
  readonly requestId?: string;
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
  withdrawConsentAtomically(
    command: WithdrawConsentCommand,
  ): Promise<WithdrawalReceipt>;
  exportOwnedSubject(userId: string): Promise<SubjectExport>;
  startErasureAtomically(command: StartErasureCommand): Promise<ErasureJob>;
}

type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends (
  transaction: infer T,
) => unknown
  ? T
  : never;
const PROCESSORS = [
  "object_store",
  "selarti",
  "planerka",
  "make_projection",
] as const;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function one<T>(rows: T[], description: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`Expected ${description}`);
  return row;
}

type BackupJobRow = {
  jobId: string;
  status: "pending" | "processor_complete" | "backup_verified" | "dead_letter";
  policyVersion: string | null;
  expiresAt: Date | string | null;
  verificationState: "scheduled" | "verified" | null;
  receipt: unknown;
};

async function loadBackupJob(
  db: DrizzleDb | Transaction,
  jobId: string,
  lock = false,
): Promise<BackupJobRow> {
  return one(
    (
      await db.execute<BackupJobRow>(sql`
    select id as "jobId", status, backup_policy_version as "policyVersion",
      backup_expires_at as "expiresAt", backup_verification_state as "verificationState",
      erasure_receipt as receipt
    from privacy_deletion_jobs where id=${jobId}::uuid ${lock ? sql`for update` : sql``}
  `)
    ).rows,
    "privacy deletion job",
  );
}

function receiptObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function backupBinding(row: BackupJobRow) {
  const timestamp =
    row.expiresAt === null ? NaN : new Date(row.expiresAt).getTime();
  return {
    jobId: row.jobId,
    policyVersion: row.policyVersion ?? "",
    expiresNoLaterThan: Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : "",
  };
}

function backupJobState(row: BackupJobRow) {
  return {
    jobId: row.jobId,
    status: row.status,
    ...(row.policyVersion === null ||
    row.expiresAt === null ||
    row.verificationState === null
      ? {}
      : {
          backupEvidence: {
            policyVersion: row.policyVersion,
            expiresNoLaterThan: backupBinding(row).expiresNoLaterThan,
            verificationState: row.verificationState,
          },
        }),
    ...(receiptObject(row.receipt) &&
    Object.hasOwn(row.receipt, "backupVerification")
      ? {
          backupVerification: row.receipt.backupVerification,
        }
      : {}),
  };
}

async function databaseNow(db: DrizzleDb | Transaction): Promise<Date> {
  const row = one(
    (
      await db.execute<{ now: Date | string }>(
        sql`select clock_timestamp() as now`,
      )
    ).rows,
    "database clock",
  );
  return new Date(row.now);
}

async function requirePersistedBackupProof(
  db: DrizzleDb | Transaction,
  row: BackupJobRow,
): Promise<BackupVerificationEvidence> {
  if (
    row.status !== "backup_verified" ||
    row.verificationState !== "verified" ||
    !receiptObject(row.receipt)
  ) {
    throw new Error("Backup verification evidence is incomplete or invalid");
  }
  const proof = requireBackupVerificationEvidence(
    row.receipt.backupVerification,
    backupBinding(row),
    await databaseNow(db),
  );
  // Compare original PostgreSQL precision, not just JS's millisecond projection.
  const match =
    (
      await db.execute(sql`
    select id from privacy_deletion_jobs where id=${row.jobId}::uuid
      and backup_expires_at=${proof.expiresNoLaterThan}::timestamptz
      and backup_verified_at=${proof.verifiedAt}::timestamptz
  `)
    ).rows.length === 1;
  if (!match)
    throw new Error("Backup verification evidence is incomplete or invalid");
  return proof;
}

/** Parent/child locks serialize work only until commit; they are not a durable
 * invariant against later inserts or writes from old binaries/arbitrary SQL.
 */
async function requireCompletedErasureWork(
  tx: Transaction,
  jobId: string,
): Promise<void> {
  const attempts = (
    await tx.execute<{ processor: string; status: string }>(sql`
    select processor, status from privacy_processor_attempts
    where deletion_job_id=${jobId}::uuid order by processor for update
  `)
  ).rows;
  const privateObjects = (
    await tx.execute(
      sql`select d.custody_id from resident_object_deletions d left join privacy_deletion_jobs related on related.id=d.deletion_job_id join privacy_deletion_jobs current_job on current_job.id=${jobId}::uuid where d.delete_state<>'verified' and (related.user_id=current_job.user_id or d.subject_erasure_key=encode(digest('resident-private:'||current_job.user_id::text,'sha256'),'hex')) for update of d`,
    )
  ).rows;
  if (privateObjects.length)
    throw new Error("Private object erasure is incomplete");
  const bookings = (
    await tx.execute<{ phase: string }>(sql`
    select phase from client_booking_erasure_work where deletion_job_id=${jobId}::uuid for update
  `)
  ).rows;
  if (
    attempts.length !== PROCESSORS.length ||
    PROCESSORS.some(
      (name) =>
        !attempts.some(
          (attempt) =>
            attempt.processor === name && attempt.status === "acknowledged",
        ),
    ) ||
    bookings.some((booking) => booking.phase !== "complete")
  ) {
    throw new Error(
      "All four named processor acknowledgements and booking erasure completion are required",
    );
  }
}

/** Static contract kept executable to prevent a downgrade from PostgreSQL-safe privacy controls. */
export function assertPrivacyWorkflowContract(): {
  postgresAuthoritative: true;
  immutableFactsRewritten: false;
  retentionClaim: "for_update_skip_locked";
  backupDeletionClaim: "verified_bound_evidence";
} {
  return {
    postgresAuthoritative: true,
    immutableFactsRewritten: false,
    retentionClaim: "for_update_skip_locked",
    backupDeletionClaim: "verified_bound_evidence",
  };
}

export class PostgresPrivacyRepository implements PrivacyRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly options: {
      beforeWithdrawalAudit?: () => Promise<void> | void;
      beforePrivacyReceiptDisclosure?: (
        tx: Transaction,
        userId: string,
      ) => Promise<unknown | undefined>;
      privacyMutationCapability?: {
        enabled: boolean;
        /** Trusted server configuration, shared with the worker's active policy.
         * Absence denies terminal certification; it never selects a default.
         */
        activeBackupPolicyVersion?: string;
        captureManifests?: (userId: string) => Promise<
          readonly {
            processor: (typeof PROCESSORS)[number];
            ciphertext: string;
            keyReference: string;
            algorithm: string;
            version: string;
            subjectDeletionKeyHash: string;
          }[]
        >;
        verifyEnvelope?: (envelope: {
          ciphertext: string;
          keyReference: string;
          algorithm: string;
          version: string;
          subjectDeletionKeyHash: string;
        }) => Promise<boolean> | boolean;
      };
    } = {},
  ) {}

  withdrawConsentAtomically(
    command: WithdrawConsentCommand,
  ): Promise<WithdrawalReceipt> {
    if (!this.options.privacyMutationCapability?.enabled)
      return Promise.reject(new Error("Privacy mutations are disabled"));
    if (
      ![
        "client_profile",
        "expert_note",
        "expert_handoff",
        "follow_up",
        "client_messaging",
        "selarti_ai_processing",
      ].includes(command.purpose)
    ) {
      return Promise.reject(new Error("Unknown privacy consent purpose"));
    }
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        // Re-read authority after the subject barrier, including after a lock wait.
        await tx.execute(sql`set transaction isolation level read committed`);
        await tx.execute(sql`set local statement_timeout='2000ms'`);
        await tx.execute(sql`set local lock_timeout='1000ms'`);
        await lockBookingNotificationSubjects(tx, [command.targetUserId]);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.targetUserId}::uuid::text, 0))`,
        );
        let receiptDisclosureFailure: unknown;
        if (this.options.beforePrivacyReceiptDisclosure) {
          await tx.execute(sql`savepoint receipt_disclosure_guard`);
          try {
            receiptDisclosureFailure =
              await this.options.beforePrivacyReceiptDisclosure(
                tx,
                command.targetUserId,
              );
            await tx.execute(sql`release savepoint receipt_disclosure_guard`);
          } catch (error) {
            // A database/capture failure cannot preserve a durable retry ticket.
            // Roll back the whole mutation; gateway outages are returned values.
            throw error;
          }
        }
        if (command.purpose === "client_messaging") {
          await stopBookingNotificationRecipients(tx, command.targetUserId);
          await tx.execute(
            sql`update experts set active=false,updated_at=clock_timestamp() where user_id=${command.targetUserId}::uuid and active`,
          );
          await tx.execute(
            sql`update expert_residency_lifecycle_notices set status='cancelled' where user_id=${command.targetUserId}::uuid and status<>'delivered'`,
          );
          await tx.execute(
            sql`update resident_work_notices set state='cancelled' where user_id=${command.targetUserId}::uuid and state<>'delivered'`,
          );
          await tx.execute(
            sql`update experts_published set active=false,updated_at=clock_timestamp() where user_id=${command.targetUserId}::uuid and active=true`,
          );
          await tx.execute(
            sql`update expert_card_material_jobs set status='cancelled' where user_id=${command.targetUserId}::uuid and status in ('waiting_content','pending','unknown_outcome')`,
          );

          await tx.execute(
            sql`update expert_verification_work set status='cancelled' where user_id=${command.targetUserId}::uuid and status='pending'`,
          );
          await tx.execute(
            // Public provider uncertainty survives local privacy invalidation.
            // Revoked consent denies capture; only fresh GET may prove cancellation.
            sql`update expert_onboarding_invoices i set status='cancelled' where user_id=${command.targetUserId}::uuid and status='pending' and not exists(select 1 from public_expert_payment_requests r where r.invoice_id=i.id and r.state<>'abandoned')`,
          );
          await tx.execute(
            sql`update expert_onboarding_payment_operations op set status='cancelled' where user_id=${command.targetUserId}::uuid and status in ('created','pending','unknown_outcome') and not exists(select 1 from public_expert_payment_requests r where r.legacy_operation_id=op.id and r.state<>'abandoned')`,
          );
        }
        // RIGHTS-08 + EVID-01: отзыв PreviouslyGranted != первоначальный отказ.
        const consent = one(
          (
            await tx.execute<{ id: string; decision: string }>(sql`
        insert into consents (user_id, consent_type, decision, policy_version, basis, created_at)
        values (
          ${command.targetUserId}::uuid,
          ${command.purpose},
          (case
             when ${currentConsentGrantedSql({
               userExpression: sql`${command.targetUserId}::uuid`,
               purpose: command.purpose,
             })}
             then 'revoked' else 'denied'
           end),
          ${command.policyVersion},
          'consent', clock_timestamp()
        )
        returning id, decision
      `)
          ).rows,
          "withdrawal consent fact",
        );
        await this.projectAndInvalidate(
          tx,
          command.targetUserId,
          command.purpose,
          consent.decision,
          consent.id,
        );
        const profile =
          command.purpose === "client_profile"
            ? await tx.execute<{
                displayName: string | null;
                timezone: string | null;
                expertNote: string | null;
              }>(sql`
          update client_profiles set display_name = null, timezone = null, expert_note = null, updated_at = now()
          where user_id = ${command.targetUserId}::uuid
          returning display_name as "displayName", timezone, expert_note as "expertNote"
        `)
            : command.purpose === "expert_note"
              ? await tx.execute<{
                  displayName: string | null;
                  timezone: string | null;
                  expertNote: string | null;
                }>(sql`
          update client_profiles set expert_note = null, updated_at = now()
          where user_id = ${command.targetUserId}::uuid returning display_name as "displayName", timezone, expert_note as "expertNote"
        `)
              : {
                  rows: [] as {
                    displayName: string | null;
                    timezone: string | null;
                    expertNote: string | null;
                  }[],
                };
        const cancelled =
          command.purpose === "follow_up"
            ? await tx.execute<{ count: number }>(sql`
        delete from notifications n using reservations r
        where n.reservation_id = r.id and r.user_id = ${command.targetUserId}::uuid
          and n.callback_action = 'follow_up' and n.callback_consumed_at is null returning 1 as count
      `)
            : { rows: [] as { count: number }[] };
        // DEC-PLT-004 §3: withdrawing the note content also withdraws the transfer (never the
        // reverse), and either way receivers must delete their copies in the same transaction.
        const handoffFact =
          command.purpose === "expert_note"
            ? one(
                (
                  await tx.execute<{ id: string; decision: string }>(sql`
          insert into consents (user_id, consent_type, decision, policy_version, basis, created_at)
          values (
            ${command.targetUserId}::uuid,
            'expert_handoff',
            (case
               when ${currentConsentGrantedSql({
                 userExpression: sql`${command.targetUserId}::uuid`,
                 purpose: "expert_handoff",
               })}
               then 'revoked' else 'denied'
             end),
            'handoff-v1',
            'consent', clock_timestamp()
          )
          returning id, decision
        `)
                ).rows,
                "cascaded handoff withdrawal consent fact",
              )
            : undefined;
        if (handoffFact) {
          await this.projectAndInvalidate(
            tx,
            command.targetUserId,
            "expert_handoff",
            handoffFact.decision,
            handoffFact.id,
          );
        }
        const handoffConsentId =
          command.purpose === "expert_handoff" ? consent.id : handoffFact?.id;
        if (handoffConsentId !== undefined) {
          const handoffPayload = {
            userId: command.targetUserId,
            consentDecisionId: handoffConsentId,
            purpose: "expert_handoff",
          };
          await tx.execute(sql`
          insert into integration_outbox (idempotency_key, topic, payload, correlation_id, reconciliation_key, payload_hash)
          values (
            ${`privacy:booking.handoff_revoked:${handoffConsentId}`},
            'booking.handoff_revoked',
            ${JSON.stringify(handoffPayload)}::jsonb,
            ${command.correlationId},
            ${`booking.handoff_revoked:${handoffConsentId}`},
            ${hash(handoffPayload)}
          )
        `);
        }
        await this.options.beforeWithdrawalAudit?.();
        await this.auditAndProjection(tx, {
          actorId: command.targetUserId,
          action: "privacy.consent_withdrawn",
          objectType: "consent",
          objectId: consent.id,
          decision: consent.decision,
          reasonCode: command.purpose,
          correlationId: command.correlationId,
          payload: { purpose: command.purpose, consentDecisionId: consent.id },
        });
        return {
          receiptDisclosureFailure,
          receipt: {
            consentDecisionId: consent.id,
            optionalFieldsRemoved: profile.rows.reduce(
              (count, row) =>
                count +
                [row.displayName, row.timezone, row.expertNote].filter(
                  (value) => value !== null,
                ).length,
              0,
            ),
            followUpsCancelled: cancelled.rows.length,
          },
        };
      }),
    ).then(({ receipt, receiptDisclosureFailure }) => {
      if (receiptDisclosureFailure !== undefined)
        throw Object.assign(
          new Error("receipt_disclosure_cancellation_uncertain", {
            cause: receiptDisclosureFailure,
          }),
          { mutationResult: receipt },
        );
      return receipt;
    });
  }

  /**
   * EVID-03/EGRESS-03: журнал остаётся append-only, а «текущее состояние» — проекция с
   * монотонной ревизией; отзыв дополнительно гасит ранее выданные предъявления, чтобы старая
   * кнопка не могла возродить решение (EVID-04, BOT-05).
   */
  private async projectAndInvalidate(
    tx: Transaction,
    userId: string,
    purpose: string,
    decision: string,
    decisionId: string,
  ): Promise<void> {
    await tx.execute(sql`
      insert into consent_states (user_id, purpose, decision, last_decision_id, revision)
      values (${userId}::uuid, ${purpose}, ${decision}, ${decisionId}::uuid, 1)
      on conflict (user_id, purpose)
        do update set decision = excluded.decision,
                      last_decision_id = excluded.last_decision_id,
                      revision = consent_states.revision + 1,
                      updated_at = now()
    `);
    await tx.execute(sql`
      update consent_presentations
      set invalidated_at = now(), revoke_epoch = revoke_epoch + 1
      where user_id = ${userId}::uuid
        and purpose = ${purpose}
        and consumed_at is null
        and invalidated_at is null
    `);
  }

  async listCurrentConsents(userId: string): Promise<
    Array<{
      purpose: string;
      inForce: boolean;
      policyVersion: string;
      decidedAt: string;
    }>
  > {
    const rows = (
      await this.db.execute<{
        purpose: string;
        inForce: boolean;
        policyVersion: string;
        decidedAt: string;
      }>(currentConsentStatesSql(sql`${userId}::uuid`))
    ).rows;
    return rows.map((row) => ({
      purpose: row.purpose,
      inForce: row.inForce === true,
      policyVersion: row.policyVersion,
      decidedAt: row.decidedAt,
    }));
  }

  async exportOwnedSubject(userId: string): Promise<SubjectExport> {
    const identity = (
      await this.db.execute<{ provider: string; externalId: string }>(sql`
      select provider, external_id as "externalId" from channel_identities
      where user_id = ${userId}::uuid order by provider, external_id
    `)
    ).rows;
    // Historical facts only: do not substitute current authority or latest documents.
    // Linked evidence is projected only after checking the decision owner's bindings.
    const consents = (
      await this.db.execute<{
        purpose: string;
        decision: string;
        policyVersion: string;
        createdAt: Date | string;
        evidence: Omit<
          SubjectExport["consents"][number]["evidence"],
          "scopeFields" | "scopeStatus"
        > & { scopeFields: unknown };
        document: SubjectExport["consents"][number]["document"];
      }>(sql`
      select c.consent_type as purpose, c.decision, c.policy_version as "policyVersion", c.created_at as "createdAt",
        jsonb_build_object(
          'decisionId',c.id,'sequence',c.sequence::text,'channel',c.channel,
          'scopeFields',c.scope_fields,'textSha256',c.text_sha256,'basis',c.basis,
          'priorDecisionId',prior.id,
          'presentation',case when p.id is null then null else jsonb_build_object(
            'id',p.id,'createdAt',p.created_at,'consumedAt',p.consumed_at
          ) end
        ) as evidence,
        case when d.id is null then null else jsonb_build_object(
          'id',d.id,'documentKey',d.document_key,'version',d.version,
          'title',d.title,'body',d.body,'textSha256',d.text_sha256
        ) end as document
      from consents c
      left join consent_document_versions d on d.id=c.document_version_id
      left join consents prior on prior.id=c.prior_decision_id and prior.user_id=c.user_id
      left join consent_presentations p on p.id=c.presentation_id
        and p.user_id=c.user_id and p.purpose=c.consent_type
        and p.document_version_id=c.document_version_id
      where c.user_id = ${userId}::uuid order by c.created_at, c.id
    `)
    ).rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      evidence: {
        ...row.evidence,
        ...projectConsentScope(row.evidence.scopeFields),
        presentation: projectConsentPresentation(row.evidence.presentation),
      },
    }));
    const profileRow = (
      await this.db.execute<{
        displayName: string | null;
        timezone: string | null;
      }>(sql`
      select display_name as "displayName", timezone from client_profiles where user_id = ${userId}::uuid
    `)
    ).rows[0];
    const reservations = (
      await this.db.execute<{
        id: string;
        status: string;
        startsAt: Date | string | null;
      }>(sql`
      select r.id, r.status, s.starts_at as "startsAt" from reservations r
      left join slots s on s.id = r.slot_id where r.user_id = ${userId}::uuid
        and not exists (
          select 1 from client_booking_receipts b where b.reservation_id=r.id
        )
      order by r.created_at, r.id
    `)
    ).rows.map((row) => ({
      id: row.id,
      status: row.status,
      ...(row.startsAt === null
        ? {}
        : { startsAt: new Date(row.startsAt).toISOString() }),
    }));
    const clientBookings = (
      await this.db.execute<{
        bookingHandle: `bk1.${string}`;
        state:
          | "reserved"
          | "booked"
          | "cancelled"
          | "expired"
          | "completed"
          | "no_show";
        createdAt: Date | string;
        startsAt: Date | string | null;
      }>(sql`
      select b.booking_handle as "bookingHandle",
        case
          when r.status in ('cancelled_by_client','cancelled_by_expert') then 'cancelled'
          else r.status::text
        end as state,
        b.created_at as "createdAt",s.starts_at as "startsAt"
      from client_booking_receipts b
      join reservations r on r.id=b.reservation_id
      left join slots s on s.id=r.slot_id
      where b.user_id=${userId}::uuid
      order by b.created_at,b.id
    `)
    ).rows.map((row) => ({
      bookingHandle: row.bookingHandle,
      state: row.state,
      createdAt: new Date(row.createdAt).toISOString(),
      ...(row.startsAt === null
        ? {}
        : { startsAt: new Date(row.startsAt).toISOString() }),
    }));
    const feedback = (
      await this.db.execute<{ reservationId: string; rating: number }>(sql`
      select reservation_id as "reservationId", rating from feedback where user_id = ${userId}::uuid order by created_at, id
    `)
    ).rows;
    const catalogSnapshots = (
      await this.db.execute<{
        catalogRequestId: string;
        expiresAt: Date | string;
        cards: unknown;
      }>(sql`
      select r.id as "catalogRequestId",s.expires_at as "expiresAt",s.cards
      from client_catalog_requests r
      join client_catalog_snapshots s on s.request_id=r.id
      where r.user_id=${userId}::uuid and r.state='ready'
      order by r.created_at,r.id
    `)
    ).rows.map((row) => {
      return {
        catalogRequestId: row.catalogRequestId,
        expiresAt: new Date(row.expiresAt).toISOString(),
        cards: validateClientCatalogCards(row.cards),
      };
    });
    const counts = one(
      (
        await this.db.execute<{
          packageCount: number;
          eventCount: number;
          ledgerEntryCount: number;
        }>(sql`
      select
        (select count(*)::integer from message_packages where user_id = ${userId}::uuid) as "packageCount",
        (select count(*)::integer from message_events where user_id = ${userId}::uuid) as "eventCount",
        (select count(*)::integer from message_ledger_entries l join message_packages p on p.id = l.package_id where p.user_id = ${userId}::uuid) as "ledgerEntryCount"
    `)
      ).rows,
      "message accounting summary",
    );
    return {
      userId,
      identity,
      consents,
      profile:
        profileRow === undefined
          ? null
          : {
              ...(profileRow.displayName === null
                ? {}
                : { displayName: profileRow.displayName }),
              ...(profileRow.timezone === null
                ? {}
                : { timezone: profileRow.timezone }),
            },
      reservations,
      clientBookings,
      feedback,
      messageAccounting: {
        packageCount: Number(counts.packageCount),
        eventCount: Number(counts.eventCount),
        ledgerEntryCount: Number(counts.ledgerEntryCount),
      },
      catalogSnapshots,
    };
  }

  startErasureAtomically(command: StartErasureCommand): Promise<ErasureJob> {
    const capability = this.options.privacyMutationCapability;
    if (!capability?.enabled)
      return Promise.reject(new Error("Privacy mutations are disabled"));
    const captureManifests = capability.captureManifests;
    if (captureManifests === undefined)
      return Promise.reject(
        new Error("Privacy deletion target capture is not bound"),
      );
    const verifyEnvelope = capability.verifyEnvelope;
    if (verifyEnvelope === undefined)
      return Promise.reject(
        new Error("Privacy deletion envelope verification is not bound"),
      );
    return this.startErasureWithVerifiedManifests(
      command,
      captureManifests,
      verifyEnvelope,
    );
  }

  private async startErasureWithVerifiedManifests(
    command: StartErasureCommand,
    captureManifests: NonNullable<
      NonNullable<
        typeof this.options.privacyMutationCapability
      >["captureManifests"]
    >,
    verifyEnvelope: NonNullable<
      NonNullable<
        typeof this.options.privacyMutationCapability
      >["verifyEnvelope"]
    >,
  ): Promise<ErasureJob> {
    const catalogSubjectKey = clientCatalogErasureSubjectKey(
      command.targetUserId,
    );
    const manifests = await captureManifests(command.targetUserId);
    const verified = await Promise.all(
      manifests.map(async (manifest) => {
        try {
          return await verifyEnvelope(manifest);
        } catch {
          return false;
        }
      }),
    );
    if (verified.some((value) => !value))
      throw new Error("Privacy deletion manifest verification failed");
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await lockBookingNotificationSubjects(tx, [command.targetUserId], {
          identityMutation: true,
        });
        await tx.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended('choice:' || c.choice_digest,0)
        )
        from client_catalog_choices c
        join client_catalog_requests r on r.id=c.request_id
        where r.user_id=${command.targetUserId}::uuid
        order by c.choice_digest
      `);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.targetUserId}, 0))`,
        );
        const subject = (
          await tx.execute<{ userId: string }>(sql`
        select id as "userId" from users
        where id=${command.targetUserId}::uuid
        for update
      `)
        ).rows[0];
        if (subject === undefined)
          throw new Error("Privacy subject is unavailable");
        let receiptDisclosureFailure: unknown;
        if (this.options.beforePrivacyReceiptDisclosure) {
          await tx.execute(sql`savepoint receipt_disclosure_guard`);
          try {
            receiptDisclosureFailure =
              await this.options.beforePrivacyReceiptDisclosure(
                tx,
                command.targetUserId,
              );
            await tx.execute(sql`release savepoint receipt_disclosure_guard`);
          } catch (error) {
            // A database/capture failure cannot preserve a durable retry ticket.
            // Roll back the whole mutation; gateway outages are returned values.
            throw error;
          }
        }
        if (command.requestId !== undefined) {
          if (command.idempotencyKey !== `erasure-request:${command.requestId}`)
            throw new Error("Erasure request binding is invalid");
          const request = (
            await tx.execute(sql`
            select id from client_erasure_requests
            where id=${command.requestId}::uuid and user_id=${command.targetUserId}::uuid
            for update
          `)
          ).rows[0];
          if (!request) throw new Error("Erasure request binding is invalid");
        }
        await tx.execute(sql`
        update users set active=false,updated_at=clock_timestamp()
        where id=${command.targetUserId}::uuid
      `);
        await tx.execute(sql`
        delete from client_sessions where user_id=${command.targetUserId}::uuid
      `);
        const existing = (
          await tx.execute<{ jobId: string; status: ErasureJob["status"] }>(sql`
        select id as "jobId", status from privacy_deletion_jobs
        where user_id = ${command.targetUserId}::uuid and idempotency_key = ${command.idempotencyKey}
        for update
      `)
        ).rows[0];
        if (existing !== undefined)
          return {
            receipt: await this.erasureReceipt(
              tx,
              existing.jobId,
              existing.status,
            ),
            receiptDisclosureFailure,
          };

        if (
          manifests.length !== PROCESSORS.length ||
          new Set(manifests.map((manifest) => manifest.processor)).size !==
            PROCESSORS.length ||
          PROCESSORS.some(
            (processor) =>
              !manifests.some((manifest) => manifest.processor === processor),
          ) ||
          manifests.some(
            (manifest) =>
              manifest.keyReference.trim().length === 0 ||
              manifest.keyReference === "unbound-placeholder" ||
              manifest.ciphertext.trim().length === 0 ||
              manifest.algorithm.trim().length === 0 ||
              manifest.version.trim().length === 0 ||
              manifest.subjectDeletionKeyHash.trim().length === 0,
          )
        ) {
          throw new Error("Privacy deletion target capture is incomplete");
        }
        const profileBefore = (
          await tx.execute<{
            displayName: string | null;
            timezone: string | null;
            expertNote: string | null;
          }>(sql`
        select display_name as "displayName", timezone, expert_note as "expertNote" from client_profiles where user_id = ${command.targetUserId}::uuid for update
      `)
        ).rows[0];
        await tx.execute(sql`
        select o.id as "outboxId"
        from integration_outbox o
        join client_catalog_erasure_index e
          on o.idempotency_key='client-catalog:' || e.request_id::text
        where e.subject_key=${catalogSubjectKey}
          and o.topic='catalog.show'
        order by o.id
        for update of o
      `);
        await tx.execute(sql`
        select id from client_catalog_requests
        where user_id=${command.targetUserId}::uuid
        order by id for update
      `);
        await tx.execute(sql`
        select t.request_id from client_catalog_tombstones t
        join client_catalog_erasure_index e on e.request_id=t.request_id
        where e.subject_key=${catalogSubjectKey}
        order by t.request_id for update of t
      `);
        await tx.execute(sql`
        select request_id from client_catalog_erasure_index
        where subject_key=${catalogSubjectKey}
        order by request_id for update
      `);
        await tx.execute(sql`
        delete from client_catalog_requests
        where user_id=${command.targetUserId}::uuid
      `);
        await tx.execute(sql`
        delete from client_catalog_tombstones t
        using client_catalog_erasure_index e
        where e.request_id=t.request_id and e.subject_key=${catalogSubjectKey}
      `);
        await tx.execute(sql`
        delete from client_catalog_erasure_index
        where subject_key=${catalogSubjectKey}
      `);
        const job = one(
          (
            await tx.execute<{ id: string }>(sql`
        insert into privacy_deletion_jobs (user_id, idempotency_key, status, evidence_pseudonym, legacy_provider_identifier_evidence)
        values (${command.targetUserId}::uuid, ${command.idempotencyKey}, 'pending', ${command.pseudonym}, ${hash({ userId: command.targetUserId, kind: "legacy_provider_identifier_evidence" })}) returning id
      `)
          ).rows,
          "privacy deletion job",
        );
        // Bind prior consent-withdrawal tombstones as well as still-attached objects.
        await tx.execute(
          sql`update resident_object_deletions set deletion_job_id=${job.id}::uuid,subject_erasure_key=null where subject_erasure_key=${privateObjectErasureSubjectKey(command.targetUserId)} and deletion_job_id is null`,
        );
        await tx.execute(sql`
        insert into client_booking_erasure_work (deletion_job_id,phase)
        values (${job.id}::uuid,'cancel_active')
      `);
        for (const manifest of manifests) {
          const idempotencyKey = `${job.id}:${manifest.processor}`;
          await tx.execute(sql`
          insert into privacy_deletion_manifests (deletion_job_id, processor, manifest_ciphertext, subject_deletion_key_hash, key_reference, algorithm, version)
          values (${job.id}::uuid, ${manifest.processor}, ${manifest.ciphertext}, ${manifest.subjectDeletionKeyHash}, ${manifest.keyReference}, ${manifest.algorithm}, ${manifest.version})
        `);
          await tx.execute(sql`
          insert into privacy_processor_attempts (deletion_job_id, processor, status, idempotency_key)
          values (${job.id}::uuid, ${manifest.processor}, 'pending', ${idempotencyKey})
        `);
        }
        await tx.execute(
          sql`delete from resident_native_confirmations c using reservations r where c.reservation_id=r.id and r.user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from resident_lifecycle_subjects where user_id=${command.targetUserId}::uuid`,
        );
        // Manifests exist before any deletable local mapping/content is cleared.
        // Lifecycle routing/schedules are not financial retention data. Immutable
        // renewal attempts retain only the canonical financial UUID bindings.
        await tx.execute(
          sql`delete from expert_residency_lifecycle_notices where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from expert_residency_lifecycle_audits where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from expert_residency_lifecycle where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`update expert_residency_renewal_bills set user_id=null where user_id=${command.targetUserId}::uuid`,
        );
        // Card raw entries, private media/proofs, approved public payload and live
        // publication have no financial retention authority. Financial C bindings
        // retain UUID/digest audit facts via nullable live FKs, never raw content.
        await tx.execute(
          sql`update experts set public_display_name=null,active=false,verified=false,updated_at=clock_timestamp() where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from experts_published where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from expert_card_handoffs where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`update expert_card_requests set user_id=null,request_digest=null,semantic_digest=null,result_id=null,erased_at=clock_timestamp() where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from resident_safety_outcomes where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`update expert_services es set name='Удалённая услуга',code=null,language=null,active=false from resident_service_mappings m join expert_card_drafts d on d.id=m.draft_id where m.expert_service_id=es.id and d.user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from expert_card_drafts where user_id=${command.targetUserId}::uuid`,
        );
        // Preserve immutable onboarding financial facts and audit UUIDs. Nullable
        // live application FKs are cleared by its physical deletion below; late
        // verified payment remains financial truth but can never recreate admission.
        await tx.execute(
          sql`delete from expert_verification_work where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`update expert_onboarding_invoices i set status='cancelled' where user_id=${command.targetUserId}::uuid and status='pending' and not exists(select 1 from public_expert_payment_requests r where r.invoice_id=i.id and r.state<>'abandoned')`,
        );
        await tx.execute(
          sql`update expert_onboarding_payment_operations op set status='cancelled' where user_id=${command.targetUserId}::uuid and status in ('created','pending','unknown_outcome') and not exists(select 1 from public_expert_payment_requests r where r.legacy_operation_id=op.id and r.state<>'abandoned')`,
        );
        // Promo acquisition has no financial retention authority. Remove queued
        // sends, pending enrollment and direct identity digests; keep only inactive
        // UUID ownership tombstones so an erased inviter can never be reassigned.
        // New intake PII and private Telegram references disappear before identity deletion.
        // Retain only erased request tombstones so delayed updates cannot resurrect data.
        await tx.execute(
          sql`delete from residents_applications where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`update resident_verification_requests set user_id=null,request_digest=null,result=null,erased_at=clock_timestamp() where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from expert_promo_guide_work where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from expert_promo_manager_work where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from expert_promo_enrollments where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`update expert_promo_requests set user_id=null,request_digest=null,erased_at=clock_timestamp() where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from expert_promo_bonus_indications where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from expert_promo_codes where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`update expert_promo_registrations set identity_digest=null,erased_at=clock_timestamp() where user_id=${command.targetUserId}::uuid and identity_digest is not null`,
        );
        // Applicant workflow metadata has no financial retention authority.
        // Remove it atomically before identity mappings, preserving quote/ledger facts.
        await tx.execute(sql`
        delete from expert_onboarding_applications
        where user_id = ${command.targetUserId}::uuid
      `);
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
        await tx.execute<{ userId: string }>(sql`
        delete from client_profiles where user_id = ${command.targetUserId}::uuid returning user_id as "userId"
      `);
        await eraseBookingNotificationRecipients(tx, command.targetUserId);
        // A first-settlement snapshot retains its immutable channel UUID FK.
        // Remove session PII and all unreferenced mappings; referenced identities
        // become blocked, content-free financial tombstones, never live transport.
        await tx.execute(
          sql`delete from expert_sessions where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from channel_identities ci where ci.user_id=${command.targetUserId}::uuid and not exists(select 1 from expert_first_residency_settlements f where f.settlement_invitee_channel_identity_id=ci.id or f.settlement_inviter_channel_identity_id=ci.id)`,
        );
        await tx.execute(
          sql`update channel_identities set external_id='erased:'||id::text,bot_key=null,external_chat_id=null,status='blocked',updated_at=clock_timestamp() where user_id=${command.targetUserId}::uuid`,
        );
        await tx.execute(
          sql`delete from provider_subject_mappings where user_id = ${command.targetUserId}::uuid`,
        );
        const [ledgerFacts, auditFacts] = await Promise.all([
          tx.execute<{ count: number }>(
            sql`select count(*)::integer as count from message_ledger_entries l join message_packages p on p.id = l.package_id where p.user_id = ${command.targetUserId}::uuid`,
          ),
          tx.execute<{ count: number }>(
            sql`select count(*)::integer as count from audit_events where actor_id = ${command.targetUserId}::uuid`,
          ),
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
        const receipt: ErasureJob = {
          jobId: job.id,
          status: "pending",
          contentRefsDeleted:
            content.rows.length + feedback.rows.length + meetings.rows.length,
          profileFieldsDeleted:
            profileBefore === undefined
              ? 0
              : [
                  profileBefore.displayName,
                  profileBefore.timezone,
                  profileBefore.expertNote,
                ].filter((value) => value !== null).length,
          ledgerFactsPreserved: Number(ledgerFacts.rows[0]?.count ?? 0),
          auditFactsPreserved: Number(auditFacts.rows[0]?.count ?? 0),
        };
        await tx.execute(
          sql`update privacy_deletion_jobs set erasure_receipt = ${JSON.stringify(receipt)}::jsonb, updated_at = now() where id = ${job.id}::uuid`,
        );
        if (command.requestId !== undefined) {
          await tx.execute(sql`update client_erasure_requests set job_id=${job.id}::uuid
            where id=${command.requestId}::uuid and user_id=${command.targetUserId}::uuid`);
        }
        return { receipt, receiptDisclosureFailure };
      }),
    ).then(({ receipt, receiptDisclosureFailure }) => {
      if (receiptDisclosureFailure !== undefined)
        throw Object.assign(
          new Error("receipt_disclosure_cancellation_uncertain", {
            cause: receiptDisclosureFailure,
          }),
          { mutationResult: receipt },
        );
      return receipt;
    });
  }

  private async erasureReceipt(
    tx: Transaction,
    jobId: string,
    status: ErasureJob["status"],
  ): Promise<ErasureJob> {
    const job = await loadBackupJob(tx, jobId, true);
    if (status === "processor_complete" || status === "backup_verified")
      await requireCompletedErasureWork(tx, jobId);
    if (status === "backup_verified") {
      const activePolicy =
        this.options.privacyMutationCapability?.activeBackupPolicyVersion;
      if (activePolicy === undefined || activePolicy !== job.policyVersion) {
        throw new Error(
          "Backup verification evidence is incomplete or invalid",
        );
      }
      await requireCompletedErasureWork(tx, jobId);
      await requirePersistedBackupProof(tx, job);
    }
    const stored = job.receipt;
    if (
      typeof stored === "object" &&
      stored !== null &&
      !Array.isArray(stored)
    ) {
      const receipt = stored as Partial<ErasureJob>;
      if (
        typeof receipt.contentRefsDeleted === "number" &&
        typeof receipt.profileFieldsDeleted === "number" &&
        typeof receipt.ledgerFactsPreserved === "number" &&
        typeof receipt.auditFactsPreserved === "number"
      ) {
        return {
          jobId,
          status,
          contentRefsDeleted: receipt.contentRefsDeleted,
          profileFieldsDeleted: receipt.profileFieldsDeleted,
          ledgerFactsPreserved: receipt.ledgerFactsPreserved,
          auditFactsPreserved: receipt.auditFactsPreserved,
        };
      }
    }
    throw new Error("Persisted erasure receipt is missing or invalid");
  }

  private async auditAndProjection(
    tx: Transaction,
    input: {
      actorId: string;
      action: string;
      objectType: string;
      objectId: string;
      decision: string;
      reasonCode: string;
      correlationId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
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

/** Concrete PostgreSQL worker repository. Claims are transactionally fenced and never dispatch provider work. */
export class PostgresPrivacyWorkflowRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly capability?: { enabled: boolean },
  ) {}

  private assertMutationEnabled(): void {
    if (!this.capability?.enabled)
      throw new Error("Privacy processing is disabled");
  }

  async getJob(jobId: string, transaction?: Transaction) {
    // Receipt reads supply their transaction so ownership, retained facts and
    // proof checks share both locks and database-enforced wait bounds.
    const read = async (tx: Transaction) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      const row = await loadBackupJob(tx, jobId, true);
      if (
        row.status === "processor_complete" ||
        row.status === "backup_verified"
      )
        await requireCompletedErasureWork(tx, jobId);
      if (row.status === "backup_verified") {
        await requirePersistedBackupProof(tx, row);
      }
      return backupJobState(row);
    };
    return transaction ? read(transaction) : this.db.transaction(read);
  }

  async getAttempt(jobId: string, processor: string) {
    return one(
      (
        await this.db.execute<{
          status:
            | "pending"
            | "started"
            | "unknown_outcome"
            | "acknowledged"
            | "dead_letter";
        }>(sql`
      select status from privacy_processor_attempts where deletion_job_id = ${jobId}::uuid and processor = ${processor}
    `)
      ).rows,
      "privacy processor attempt",
    ).status;
  }
  async loadManifest(jobId: string, processor: string) {
    return one(
      (
        await this.db.execute<{
          ciphertext: string;
          keyReference: string;
          algorithm: string;
          version: string;
        }>(sql`
      select manifest_ciphertext as ciphertext, key_reference as "keyReference", algorithm, version
      from privacy_deletion_manifests where deletion_job_id = ${jobId}::uuid and processor = ${processor}
    `)
      ).rows,
      "privacy deletion manifest",
    );
  }

  async markStarted(
    jobId: string,
    processor: string,
    idempotencyKey: string,
  ): Promise<void> {
    this.assertMutationEnabled();
    const updated = await this.db.execute(sql`
      update privacy_processor_attempts set status = 'started', updated_at = now()
      where deletion_job_id = ${jobId}::uuid and processor = ${processor} and idempotency_key = ${idempotencyKey}
        and status in ('pending', 'unknown_outcome')
      returning id
    `);
    if (updated.rows.length !== 1)
      throw new Error("Privacy processor attempt CAS lost");
  }

  async markUnknown(jobId: string, processor: string): Promise<void> {
    this.assertMutationEnabled();
    const updated = await this.db.execute(sql`
      update privacy_processor_attempts set status = 'unknown_outcome', updated_at = now()
      where deletion_job_id = ${jobId}::uuid and processor = ${processor} and status = 'started' returning id
    `);
    if (updated.rows.length !== 1)
      throw new Error("Privacy processor unknown transition lost");
  }

  async acknowledge(
    jobId: string,
    processor: string,
    receiptHash: string,
  ): Promise<void> {
    this.assertMutationEnabled();
    const updated = await this.db.execute(sql`
      update privacy_processor_attempts set status = 'acknowledged', receipt_ref = ${receiptHash}, updated_at = now()
      where deletion_job_id = ${jobId}::uuid and processor = ${processor} and status in ('started', 'unknown_outcome') returning id
    `);
    if (updated.rows.length !== 1)
      throw new Error("Privacy processor acknowledgement CAS lost");
  }

  async deadLetter(
    jobId: string,
    processor: string,
    reason: string,
  ): Promise<void> {
    this.assertMutationEnabled();
    await this.db.transaction(async (tx) => {
      // Same parent-before-child order as completion and terminal replay.
      const row = await loadBackupJob(tx, jobId, true);
      if (row.status !== "pending" && row.status !== "dead_letter") {
        throw new Error("Privacy erasure job is already complete");
      }
      await tx.execute(sql`
        update privacy_processor_attempts set status = 'dead_letter', receipt_ref = ${hash({ reason })}, updated_at = now()
        where deletion_job_id = ${jobId}::uuid and processor = ${processor} and status <> 'acknowledged'
      `);
      await tx.execute(
        sql`update privacy_deletion_jobs set status = 'dead_letter', updated_at = now() where id = ${jobId}::uuid`,
      );
    });
  }

  async completeProcessors(
    jobId: string,
    evidence: BackupSchedule,
  ): Promise<void> {
    this.assertMutationEnabled();
    const schedule = backupScheduleSchema.safeParse(evidence);
    if (!schedule.success) throw new Error("Backup schedule is invalid");
    await this.db.transaction(async (tx) => {
      const row = await loadBackupJob(tx, jobId, true);
      if (row.status !== "pending")
        throw new Error("Processor completion CAS lost");
      await requireCompletedErasureWork(tx, jobId);
      const updated = await tx.execute(sql`
        update privacy_deletion_jobs set status='processor_complete', backup_policy_version=${schedule.data.policyVersion},
          backup_expires_at=${schedule.data.expiresNoLaterThan}::timestamptz, backup_verification_state='scheduled', updated_at=clock_timestamp()
        where id=${jobId}::uuid and status='pending' returning id
      `);
      if (updated.rows.length !== 1)
        throw new Error("Processor completion CAS lost");
    });
  }

  async verifyBackup(jobId: string, evidence: BackupVerificationEvidence) {
    this.assertMutationEnabled();
    // Take a strict copy before any I/O; neither caller mutation nor unknown fields enter JSONB.
    const parsed = backupVerificationEvidenceSchema.safeParse(evidence);
    if (!parsed.success || parsed.data.jobId !== jobId)
      throw new Error("Backup verification evidence is incomplete or invalid");
    return this.db.transaction(async (tx) => {
      const row = await loadBackupJob(tx, jobId, true);
      await requireCompletedErasureWork(tx, jobId);
      const proof = requireBackupVerificationEvidence(
        parsed.data,
        backupBinding(row),
        await databaseNow(tx),
      );
      if (row.status === "backup_verified") {
        const persisted = await requirePersistedBackupProof(tx, row);
        if (JSON.stringify(persisted) !== JSON.stringify(proof))
          throw new Error(
            "Backup verification evidence conflicts with persisted proof",
          );
        return backupJobState(row);
      }
      if (
        row.status !== "processor_complete" ||
        row.verificationState !== "scheduled" ||
        !receiptObject(row.receipt) ||
        Object.hasOwn(row.receipt, "backupVerification")
      ) {
        throw new Error(
          "Backup verification evidence is incomplete or invalid",
        );
      }
      const updated = await tx.execute(sql`
        update privacy_deletion_jobs set status='backup_verified', backup_verification_state='verified',
          backup_verified_at=${proof.verifiedAt}::timestamptz,
          erasure_receipt=jsonb_set(erasure_receipt, '{backupVerification}', ${JSON.stringify(proof)}::jsonb),
          updated_at=clock_timestamp()
        where id=${jobId}::uuid and status='processor_complete' and backup_verification_state='scheduled'
          and backup_policy_version=${proof.policyVersion}
          and backup_expires_at=${proof.expiresNoLaterThan}::timestamptz
          and backup_expires_at <= clock_timestamp() and ${proof.verifiedAt}::timestamptz <= clock_timestamp()
        returning id
      `);
      if (updated.rows.length !== 1)
        throw new Error(
          "Backup verification CAS lost or expiry has not elapsed",
        );
      return backupJobState(await loadBackupJob(tx, jobId));
    });
  }

  async claimExpiredContent(now: Date, batchSize: number) {
    this.assertMutationEnabled();
    return this.db.transaction(
      async (tx) =>
        (
          await tx.execute<{ id: string; class: string }>(sql`
      with candidates as (
        select id from privacy_retention_items
        where status in ('pending', 'unknown_outcome') and expires_at <= ${now}
        order by expires_at, id for update skip locked limit ${batchSize}
      ) update privacy_retention_items i set status = 'claimed', updated_at = now()
      from candidates where i.id = candidates.id returning i.id, i.content_class as class
    `)
        ).rows,
    );
  }

  async markRetentionStarted(
    id: string,
    idempotencyKey: string,
  ): Promise<void> {
    this.assertMutationEnabled();
    const updated = await this.db.execute(sql`
      update privacy_retention_items set status = 'started', idempotency_key = ${idempotencyKey}, updated_at = now()
      where id = ${id}::uuid and status = 'claimed' returning id
    `);
    if (updated.rows.length !== 1)
      throw new Error("Retention attempt CAS lost");
  }
  async deleteRetentionContent(
    id: string,
    idempotencyKey: string,
  ): Promise<{ kind: "deleted" }> {
    this.assertMutationEnabled();
    void idempotencyKey;
    const updated = await this.db.execute(
      sql`update privacy_retention_items set content_ref = null, updated_at = now() where id = ${id}::uuid and status = 'started' returning id`,
    );
    if (updated.rows.length !== 1)
      throw new Error("Retention deletion CAS lost");
    return { kind: "deleted" };
  }
  async markRetentionDeleted(
    id: string,
    idempotencyKey: string,
  ): Promise<void> {
    this.assertMutationEnabled();
    await this.db.execute(
      sql`update privacy_retention_items set status = 'deleted', receipt_hash = ${hash({ id, idempotencyKey })}, updated_at = now() where id = ${id}::uuid and status = 'started'`,
    );
  }
  async markRetentionUnknown(
    id: string,
    idempotencyKey: string,
  ): Promise<void> {
    this.assertMutationEnabled();
    void idempotencyKey;
    await this.db.execute(
      sql`update privacy_retention_items set status = 'unknown_outcome', updated_at = now() where id = ${id}::uuid and status = 'started'`,
    );
  }
  async reconcileRetention(
    id: string,
    idempotencyKey: string,
  ): Promise<"deleted" | "not_deleted" | "unknown"> {
    void idempotencyKey;
    const row = one(
      (
        await this.db.execute<{ contentRef: string | null }>(
          sql`select content_ref as "contentRef" from privacy_retention_items where id = ${id}::uuid`,
        )
      ).rows,
      "retention item",
    );
    return row.contentRef === null ? "deleted" : "not_deleted";
  }
  async deadLetterRetention(id: string, reason: string): Promise<void> {
    this.assertMutationEnabled();
    await this.db.execute(
      sql`update privacy_retention_items set status = 'dead_letter', receipt_hash = ${hash({ id, reason })}, updated_at = now() where id = ${id}::uuid`,
    );
  }
  async alertRetention(event: {
    class: string;
    reason: string;
  }): Promise<void> {
    this.assertMutationEnabled();
    void event;
  }
}
