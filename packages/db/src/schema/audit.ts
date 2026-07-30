import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorType: text("actor_type").notNull(),
  actorId: uuid("actor_id").notNull(),
  authenticatedSessionIdHash: text("authenticated_session_id_hash").notNull(),
  action: text("action").notNull(),
  objectType: text("object_type").notNull(),
  objectId: uuid("object_id").notNull(),
  decision: text("decision").notNull(),
  reasonCode: text("reason_code").notNull(),
  correlationId: text("correlation_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  metadataHash: text("metadata_hash").notNull(),
  createdAt,
});
export const adminApprovals = pgTable(
  "admin_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    requesterId: uuid("requester_id").notNull().references(() => users.id),
    approverId: uuid("approver_id").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    nonce: text("nonce").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    unique("admin_approvals_scope_nonce_unique").on(
      table.action,
      table.objectType,
      table.objectId,
      table.requesterId,
      table.approverId,
      table.nonce,
    ),
  ],
);
export const privacyDeletionJobs = pgTable(
  "privacy_deletion_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    evidencePseudonym: text("evidence_pseudonym"),
    backupPolicyVersion: text("backup_policy_version"),
    backupVerificationState: text("backup_verification_state"),
    backupVerifiedAt: timestamp("backup_verified_at", { withTimezone: true }),
    backupExpiresAt: timestamp("backup_expires_at", { withTimezone: true }),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("privacy_deletion_jobs_subject_idempotency_unique")
      .on(table.userId, table.idempotencyKey),
  ],
);
export const privacyProcessorAttempts = pgTable(
  "privacy_processor_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deletionJobId: uuid("deletion_job_id").notNull().references(() => privacyDeletionJobs.id),
    processor: text("processor").notNull(),
    status: text("status").notNull(),
    receiptRef: text("receipt_ref"),
    idempotencyKey: text("idempotency_key"),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("privacy_processor_attempts_job_processor_unique")
      .on(table.deletionJobId, table.processor),
  ],
);
