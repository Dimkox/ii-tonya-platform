import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    approverId: uuid("approver_id").references(() => users.id),
    requesterSessionIdHash: text("requester_session_id_hash").notNull().default("legacy-unbound"),
    approverSessionIdHash: text("approver_session_id_hash"),
    payloadHash: text("payload_hash").notNull().default("legacy-unbound"),
    requiredRole: text("required_role").notNull().default("support"),
    requesterMfaVerifiedAt: timestamp("requester_mfa_verified_at", { withTimezone: true }),
    approverMfaVerifiedAt: timestamp("approver_mfa_verified_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    nonce: text("nonce").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex("admin_approvals_bound_scope_nonce_unique")
      .on(
        table.action,
        table.objectType,
        table.objectId,
        table.requesterId,
        table.nonce,
      )
      .where(sql`${table.requesterSessionIdHash} <> 'legacy-unbound'`),
    check(
      "admin_approvals_required_role_allowed",
      sql`${table.requiredRole} in ('support', 'catalog_admin', 'entitlement_admin', 'security_admin')`,
    ),
    check(
      "admin_approvals_binding_complete",
      sql`${table.requesterSessionIdHash} = 'legacy-unbound' or (
        ${table.requesterMfaVerifiedAt} is not null and (
          (
            ${table.approverId} is null and
            ${table.approverSessionIdHash} is null and
            ${table.approverMfaVerifiedAt} is null and
            ${table.approvedAt} is null
          ) or (
            ${table.approverId} is not null and
            ${table.approverSessionIdHash} is not null and
            ${table.approverMfaVerifiedAt} is not null and
            ${table.approvedAt} is not null
          )
        )
      )`,
    ),
    check(
      "admin_approvals_lifecycle_order",
      sql`${table.requesterSessionIdHash} = 'legacy-unbound' or (
        ${table.expiresAt} > ${table.createdAt} and
        ${table.requesterMfaVerifiedAt} <= ${table.createdAt} and
        (${table.approvedAt} is null or (
          ${table.approvedAt} >= ${table.createdAt} and
          ${table.approverMfaVerifiedAt} <= ${table.approvedAt}
        )) and
        (${table.consumedAt} is null or (
          ${table.approvedAt} is not null and
          ${table.consumedAt} >= ${table.approvedAt}
        ))
      )`,
    ),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    sessionIdHash: text("session_id_hash").primaryKey(),
    adminId: uuid("admin_id").notNull().references(() => users.id),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    check(
      "admin_sessions_lifecycle_order",
      sql`${table.mfaVerifiedAt} <= ${table.expiresAt} and (
        ${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}
      )`,
    ),
  ],
);

export const adminRoleAssignments = pgTable(
  "admin_role_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminId: uuid("admin_id").notNull().references(() => users.id),
    role: text("role").notNull(),
    createdAt,
  },
  (table) => [
    unique("admin_role_assignments_admin_role_unique").on(
      table.adminId,
      table.role,
    ),
    check(
      "admin_role_assignments_role_allowed",
      sql`${table.role} in ('support', 'catalog_admin', 'entitlement_admin', 'security_admin')`,
    ),
  ],
);

export const adminObjectAssignments = pgTable(
  "admin_object_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminId: uuid("admin_id").notNull().references(() => users.id),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    createdAt,
  },
  (table) => [
    unique("admin_object_assignments_scope_unique").on(
      table.adminId,
      table.objectType,
      table.objectId,
    ),
    check(
      "admin_object_assignments_type_allowed",
      sql`${table.objectType} in ('safety_case', 'feedback_queue', 'selarti_budget_policy')`,
    ),
  ],
);
export const adminCaseActions = pgTable(
  "admin_case_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    action: text("action").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    approvalId: uuid("approval_id").notNull().references(() => adminApprovals.id),
    createdAt,
  },
  (table) => [
    unique("admin_case_actions_object_action_unique").on(
      table.objectType,
      table.objectId,
      table.action,
    ),
    unique("admin_case_actions_approval_unique").on(table.approvalId),
    check(
      "admin_case_actions_object_type_allowed",
      sql`${table.objectType} in ('safety_alert', 'negative_feedback')`,
    ),
    check(
      "admin_case_actions_action_allowed",
      sql`${table.action} in ('acknowledge', 'resolve')`,
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
    legacyProviderIdentifierEvidence: text("legacy_provider_identifier_evidence"),
    erasureReceipt: jsonb("erasure_receipt"),
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
    unique("privacy_deletion_jobs_id_subject_unique").on(table.id, table.userId),
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
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("privacy_processor_attempts_job_processor_unique")
      .on(table.deletionJobId, table.processor),
    unique("privacy_processor_attempts_idempotency_unique")
      .on(table.idempotencyKey),
  ],
);

export const privacyDeletionManifests = pgTable(
  "privacy_deletion_manifests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deletionJobId: uuid("deletion_job_id").notNull().references(() => privacyDeletionJobs.id),
    processor: text("processor").notNull(),
    manifestCiphertext: text("manifest_ciphertext").notNull(),
    subjectDeletionKeyHash: text("subject_deletion_key_hash").notNull(),
    keyReference: text("key_reference").notNull(),
    algorithm: text("algorithm").notNull(),
    version: text("version").notNull(),
    createdAt,
  },
  (table) => [unique("privacy_deletion_manifests_job_processor_unique").on(table.deletionJobId, table.processor)],
);

export const privacyRetentionItems = pgTable("privacy_retention_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentClass: text("content_class").notNull(),
  contentRef: text("content_ref"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key"),
  receiptHash: text("receipt_hash"),
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
