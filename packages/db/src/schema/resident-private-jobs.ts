// Database-derived declarations for hand-authored0064; SQL remains migration authority.
import {
  pgTable,
  check,
  uuid,
  timestamp,
  boolean,
  text,
  foreignKey,
  integer,
  unique,
  index,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity.js";
import { residentVerificationApplications } from "./resident-verification.js";
import { residentCheckGenerations } from "./resident-review.js";
import { privacyDeletionJobs } from "./audit.js";
export const residentObjectDeletions = pgTable(
  "resident_object_deletions",
  {
    custodyId: uuid("custody_id").defaultRandom().primaryKey().notNull(),
    objectKey: text("object_key").notNull(),
    writeState: text("write_state").default("allocated").notNull(),
    claimToken: uuid("claim_token"),
    erased: boolean().default(false).notNull(),
    deleteState: text("delete_state").default("dormant").notNull(),
    deleteAttempts: integer("delete_attempts").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
    subjectErasureKey: text("subject_erasure_key"),
    deletionJobId: uuid("deletion_job_id"),
    deletionToken: uuid("deletion_token"),
    deletionStartedAt: timestamp("deletion_started_at", {
      withTimezone: true,
      mode: "string",
    }),
    deletionWriteState: text("deletion_write_state"),
  },
  (table) => [
    index("resident_object_deletions_job")
      .using("btree", table.deletionJobId.asc().nullsLast())
      .where(sql`(deletion_job_id IS NOT NULL)`),
    index("resident_object_deletions_pending")
      .using(
        "btree",
        table.updatedAt.asc().nullsLast(),
        table.custodyId.asc().nullsLast(),
      )
      .where(
        sql`(erased AND (delete_state = ANY (ARRAY['pending'::text, 'unknown'::text])))`,
      ),
    index("resident_object_deletions_subject")
      .using("btree", table.subjectErasureKey.asc().nullsLast())
      .where(sql`(subject_erasure_key IS NOT NULL)`),
    foreignKey({
      columns: [table.deletionJobId],
      foreignColumns: [privacyDeletionJobs.id],
      name: "resident_object_deletions_deletion_job_id_fkey",
    }),
    unique("resident_object_deletions_object_key_key").on(table.objectKey),
    check(
      "resident_deletion_operation_complete",
      sql`((deletion_token IS NULL) AND (deletion_started_at IS NULL) AND (deletion_write_state IS NULL)) OR ((deletion_token IS NOT NULL) AND (deletion_started_at IS NOT NULL) AND (deletion_write_state IS NOT NULL) AND (deletion_write_state = ANY (ARRAY['allocated'::text, 'inflight'::text, 'settled'::text, 'unknown'::text])))`,
    ),
    check(
      "resident_object_deletions_check",
      sql`object_key = ('custody/'::text || (custody_id)::text)`,
    ),
    check(
      "resident_object_deletions_check1",
      sql`((NOT erased) AND (delete_state = 'dormant'::text)) OR erased`,
    ),
    check(
      "resident_object_deletions_check2",
      sql`(delete_state <> 'verified'::text) OR (write_state = ANY (ARRAY['allocated'::text, 'settled'::text]))`,
    ),
    check(
      "resident_object_deletions_delete_attempts_check",
      sql`(delete_attempts >= 0) AND (delete_attempts <= 3)`,
    ),
    check(
      "resident_object_deletions_delete_state_check",
      sql`delete_state = ANY (ARRAY['dormant'::text, 'pending'::text, 'unknown'::text, 'verified'::text])`,
    ),
    check(
      "resident_object_deletions_subject_erasure_key_check",
      sql`subject_erasure_key ~ '^[0-9a-f]{64}$'::text`,
    ),
    check(
      "resident_object_deletions_write_state_check",
      sql`write_state = ANY (ARRAY['allocated'::text, 'inflight'::text, 'settled'::text, 'unknown'::text])`,
    ),
    check(
      "resident_private_erasure_link",
      sql`(subject_erasure_key IS NOT NULL) OR (deletion_job_id IS NOT NULL) OR (delete_state = 'verified'::text)`,
    ),
  ],
);

export const residentPrivateObjects = pgTable(
  "resident_private_objects",
  {
    id: uuid().primaryKey().notNull(),
    applicationId: uuid("application_id").notNull(),
    generation: integer().notNull(),
    sourceRevision: integer("source_revision").notNull(),
    purpose: text().notNull(),
    reference: jsonb().notNull(),
    consentAuthority: jsonb("consent_authority").notNull(),
    state: text().default("allocated").notNull(),
    claimToken: uuid("claim_token"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    sha256: text(),
    proposal: jsonb(),
    observation: jsonb(),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "string",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
    reconciliationRequested: boolean("reconciliation_requested")
      .default(false)
      .notNull(),
  },
  (table) => [
    index("resident_private_objects_pending")
      .using(
        "btree",
        table.createdAt.asc().nullsLast(),
        table.id.asc().nullsLast(),
      )
      .where(sql`(state = 'allocated'::text)`),
    foreignKey({
      columns: [table.applicationId],
      foreignColumns: [residentVerificationApplications.id],
      name: "resident_private_objects_application_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.id],
      foreignColumns: [residentObjectDeletions.custodyId],
      name: "resident_private_objects_id_fkey",
    }),
    unique(
      "resident_private_objects_application_id_generation_source_r_key",
    ).on(
      table.applicationId,
      table.generation,
      table.sourceRevision,
      table.purpose,
      table.reference,
    ),
    check(
      "resident_private_objects_check",
      sql`(state <> 'verified'::text) OR (sha256 IS NOT NULL)`,
    ),
    check("resident_private_objects_generation_check", sql`generation >= 0`),
    check(
      "resident_private_objects_observation_check",
      sql`(observation IS NULL) OR ((jsonb_typeof(observation) = 'object'::text) AND (octet_length((observation)::text) <= 16000))`,
    ),
    check(
      "resident_private_objects_proposal_check",
      sql`(proposal IS NULL) OR ((jsonb_typeof(proposal) = 'object'::text) AND (octet_length((proposal)::text) <= 16000))`,
    ),
    check(
      "resident_private_objects_purpose_check",
      sql`purpose = ANY (ARRAY['brief'::text, 'education'::text, 'propertyEvidence'::text, 'tourMedia'::text, 'licence'::text, 'followup'::text])`,
    ),
    check(
      "resident_private_objects_reference_check",
      sql`(jsonb_typeof(reference) = 'object'::text) AND (octet_length((reference)::text) <= 4096)`,
    ),
    check(
      "resident_private_objects_sha256_check",
      sql`sha256 ~ '^[0-9a-f]{64}$'::text`,
    ),
    check(
      "resident_private_objects_source_revision_check",
      sql`source_revision >= 0`,
    ),
    check(
      "resident_private_objects_state_check",
      sql`state = ANY (ARRAY['allocated'::text, 'inflight'::text, 'unknown'::text, 'verified'::text, 'unavailable'::text])`,
    ),
  ],
);

export const residentEvidenceJobs = pgTable(
  "resident_evidence_jobs",
  {
    applicationId: uuid("application_id").notNull(),
    generation: integer().notNull(),
    status: text().default("pending").notNull(),
    claimToken: uuid("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "string" }),
    consentAuthority: jsonb("consent_authority"),
    result: jsonb(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "string",
    }),
    documentCursor: integer("document_cursor").default(0).notNull(),
    documentsMaterialized: boolean("documents_materialized")
      .default(false)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.applicationId, table.generation],
      foreignColumns: [
        residentCheckGenerations.applicationId,
        residentCheckGenerations.generation,
      ],
      name: "resident_evidence_jobs_application_id_generation_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.applicationId, table.generation],
      name: "resident_evidence_jobs_pkey",
    }),
    check(
      "resident_evidence_jobs_document_cursor_check",
      sql`document_cursor >= 0`,
    ),
    check(
      "resident_evidence_jobs_result_check",
      sql`(result IS NULL) OR ((jsonb_typeof(result) = 'object'::text) AND (octet_length((result)::text) <= 64000))`,
    ),
    check(
      "resident_evidence_jobs_status_check",
      sql`status = ANY (ARRAY['pending'::text, 'claimed'::text, 'complete'::text, 'cancelled'::text, 'unknown'::text])`,
    ),
  ],
);

export const residentSocialObservations = pgTable(
  "resident_social_observations",
  {
    userId: uuid("user_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    profile: text().notNull(),
    adapterVersion: text("adapter_version").notNull(),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    observation: jsonb().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.applicationId],
      foreignColumns: [residentVerificationApplications.id],
      name: "resident_social_observations_application_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "resident_social_observations_user_id_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.userId, table.profile, table.adapterVersion],
      name: "resident_social_observations_pkey",
    }),
    check(
      "resident_social_observations_adapter_version_check",
      sql`length(adapter_version) <= 100`,
    ),
    check(
      "resident_social_observations_check",
      sql`expires_at = (observed_at + '24:00:00'::interval)`,
    ),
    check(
      "resident_social_observations_observation_check",
      sql`(jsonb_typeof(observation) = 'object'::text) AND (octet_length((observation)::text) <= 16000)`,
    ),
    check(
      "resident_social_observations_profile_check",
      sql`length(profile) <= 2048`,
    ),
  ],
);

export const residentDocumentAccessAudit = pgTable(
  "resident_document_access_audit",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    custodyId: uuid("custody_id").notNull(),
    managerId: uuid("manager_id").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" })
      .default(sql`(clock_timestamp() + '00:02:00'::interval)`)
      .notNull(),
    action: text().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.managerId],
      foreignColumns: [users.id],
      name: "resident_document_access_audit_manager_id_fkey",
    }),
    check(
      "resident_document_access_audit_action_check",
      sql`action = ANY (ARRAY['link_issued'::text, 'reconcile_requested'::text])`,
    ),
  ],
);
