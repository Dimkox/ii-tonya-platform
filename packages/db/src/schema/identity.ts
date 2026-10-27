import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const mutableTimestamps = {
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const users = pgTable(
  "users",
  {
    currentVerificationStage: text("current_verification_stage")
      .notNull()
      .default("NONE"),
    id: uuid("id").defaultRandom().primaryKey(),
    active: boolean("active").notNull().default(true),
    ...mutableTimestamps,
  },
  (table) => [
    check(
      "users_current_verification_stage_check",
      sql`${table.currentVerificationStage} IN ('NONE','FORM_FILLING','AUTO_CHECK','MANAGER_REVIEW','DONE')`,
    ),
  ],
);

export const clientSessions = pgTable(
  "client_sessions",
  {
    tokenDigest: char("token_digest", { length: 71 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    check(
      "client_sessions_token_digest_check",
      sql`${table.tokenDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "client_sessions_scope_check",
      sql`${table.scope} in ('client_catalog:read','client_booking:write')`,
    ),
    check(
      "client_sessions_lifecycle_check",
      sql`${table.expiresAt} > ${table.createdAt} and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt})`,
    ),
    index("client_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const clientSessionBookingGrants = pgTable(
  "client_session_booking_grants",
  {
    sessionTokenDigest: char("session_token_digest", {
      length: 71,
    }).primaryKey(),
  },
  (table) => [
    foreignKey({
      name: "client_session_booking_grants_session_fk",
      columns: [table.sessionTokenDigest],
      foreignColumns: [clientSessions.tokenDigest],
    }).onDelete("cascade"),
  ],
);

export const clientIdentityProofReceipts = pgTable(
  "client_identity_proof_receipts",
  {
    replayDigest: text("replay_digest").primaryKey(),
    sessionTokenDigest: char("session_token_digest", { length: 71 }).references(
      () => clientSessions.tokenDigest,
      { onDelete: "set null" },
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    check(
      "client_identity_proof_receipts_replay_digest_check",
      sql`${table.replayDigest} ~ '^hmac-sha256:v[1-9][0-9]*:[0-9a-f]{64}$'`,
    ),
    check(
      "client_identity_proof_receipts_session_digest_check",
      sql`${table.sessionTokenDigest} is null or ${table.sessionTokenDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "client_identity_proof_receipts_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    unique("client_identity_proof_receipts_session_digest_unique").on(
      table.sessionTokenDigest,
    ),
    index("client_identity_proof_receipts_expiry_idx").on(table.expiresAt),
  ],
);

export const channelIdentities = pgTable(
  "channel_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    botKey: text("bot_key"),
    externalChatId: text("external_chat_id"),
    status: text("status").notNull().default("active"),
    ...mutableTimestamps,
  },
  (table) => [
    unique("channel_identity_resident_owner").on(table.id, table.userId),
    uniqueIndex("channel_identities_provider_external_legacy_unique")
      .on(table.provider, table.externalId)
      .where(sql`${table.botKey} is null`),
    uniqueIndex("channel_identities_telegram_bot_user_chat_unique")
      .on(table.provider, table.botKey, table.externalId, table.externalChatId)
      .where(
        sql`${table.provider} = 'telegram' and ${table.botKey} is not null and ${table.externalChatId} is not null and ${table.status} = 'active'`,
      ),
    check(
      "channel_identities_status_check",
      sql`${table.status} in ('active','unresolved','blocked')`,
    ),
  ],
);

/** Deletable mapping for future provider identifiers; immutable legacy facts remain evidence-only. */
export const providerSubjectMappings = pgTable(
  "provider_subject_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    subjectToken: text("subject_token").notNull(),
    subjectCiphertext: text("subject_ciphertext").notNull(),
    ...mutableTimestamps,
  },
  (table) => [
    unique("provider_subject_mappings_provider_token_unique").on(
      table.provider,
      table.subjectToken,
    ),
  ],
);

export const clientProfiles = pgTable(
  "client_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id),
    displayName: text("display_name"),
    timezone: text("timezone"),
    expertNote: text("expert_note"),
    ...mutableTimestamps,
  },
  (table) => [
    check(
      "client_profiles_expert_note_bounded",
      sql`${table.expertNote} is null or char_length(${table.expertNote}) between 1 and 2000`,
    ),
  ],
);

export const consentDocumentVersions = pgTable(
  "consent_document_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentKey: text("document_key").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    textSha256: char("text_sha256", { length: 64 }).notNull(),
    status: text("status").notNull().default("inactive"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    createdAt,
  },
  (table) => [
    unique("consent_document_key_version_unique").on(
      table.documentKey,
      table.version,
    ),
    check(
      "consent_document_key_bounded",
      sql`char_length(${table.documentKey}) between 1 and 128`,
    ),
    check("consent_document_version_positive", sql`${table.version} > 0`),
    check(
      "consent_document_title_bounded",
      sql`char_length(${table.title}) between 1 and 256`,
    ),
    check(
      "consent_document_body_bounded",
      sql`char_length(${table.body}) between 1 and 65536`,
    ),
    check(
      "consent_document_digest_check",
      sql`${table.textSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "consent_document_body_matches_digest",
      sql`${table.textSha256} = encode(digest(${table.body}, 'sha256'), 'hex')`,
    ),
    check(
      "consent_document_status_check",
      sql`${table.status} in ('inactive', 'approved', 'retired')`,
    ),
    check(
      "consent_document_approval_check",
      sql`${table.status} <> 'approved' or (${table.approvedAt} is not null and char_length(${table.approvedBy}) between 1 and 128)`,
    ),
    check(
      "consent_document_transition_audit_required",
      sql`${table.status} <> 'retired' or ${table.approvedAt} is not null`,
    ),
  ],
);

export const consentPresentations = pgTable(
  "consent_presentations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    sessionKey: text("session_key"),
    purpose: text("purpose").notNull(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => consentDocumentVersions.id, { onDelete: "restrict" }),
    tokenDigest: text("token_digest").notNull(),
    channel: text("channel").notNull(),
    revokeEpoch: bigint("revoke_epoch", { mode: "number" })
      .notNull()
      .default(0),
    createdAt,
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("consent_presentations_token_unique").on(table.tokenDigest),
    index("consent_presentations_subject_idx").on(
      table.userId,
      table.purpose,
      table.createdAt,
    ),
    check(
      "consent_presentations_subject_check",
      sql`(${table.userId} is not null) <> (${table.sessionKey} is not null)`,
    ),
    check(
      "consent_presentations_session_bounded",
      sql`${table.sessionKey} is null or char_length(${table.sessionKey}) between 8 and 128`,
    ),
    check(
      "consent_presentations_purpose_bounded",
      sql`char_length(${table.purpose}) between 1 and 64`,
    ),
    check(
      "consent_presentations_token_digest_check",
      sql`${table.tokenDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "consent_presentations_channel_check",
      sql`${table.channel} in ('web', 'telegram')`,
    ),
    check(
      "consent_presentations_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check("consent_presentations_epoch_check", sql`${table.revokeEpoch} >= 0`),
  ],
);

export const consentStates = pgTable(
  "consent_states",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    decision: text("decision").notNull(),
    documentVersionId: uuid("document_version_id").references(
      () => consentDocumentVersions.id,
      { onDelete: "restrict" },
    ),
    lastDecisionId: uuid("last_decision_id").references(() => consents.id, {
      onDelete: "restrict",
    }),
    revision: bigint("revision", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.purpose],
      name: "consent_states_pkey",
    }),
    check(
      "consent_states_purpose_bounded",
      sql`char_length(${table.purpose}) between 1 and 64`,
    ),
    check(
      "consent_states_decision_check",
      sql`${table.decision} in ('granted', 'denied', 'revoked')`,
    ),
    check("consent_states_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    consentType: text("consent_type").notNull(),
    decision: text("decision").notNull(),
    policyVersion: text("policy_version").notNull(),
    sequence: bigint("sequence", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull(),
    channel: text("channel"),
    scopeFields: jsonb("scope_fields"),
    documentVersionId: uuid("document_version_id").references(
      () => consentDocumentVersions.id,
      { onDelete: "restrict" },
    ),
    presentationId: uuid("presentation_id").references(
      () => consentPresentations.id,
      { onDelete: "restrict" },
    ),
    priorDecisionId: uuid("prior_decision_id"),
    recipientId: uuid("recipient_id"),
    reservationId: uuid("reservation_id"),
    textSha256: text("text_sha256"),
    basis: text("basis"),
    createdAt,
  },
  (table) => [
    index("consents_subject_purpose_order_idx").on(
      table.userId,
      table.consentType,
      table.createdAt,
      table.sequence,
    ),
    check(
      "consents_decision_known",
      sql`${table.decision} in ('granted', 'denied', 'revoked')`,
    ),
    check(
      "consents_channel_known",
      sql`${table.channel} is null or ${table.channel} in ('web', 'telegram')`,
    ),
    check(
      "consents_text_sha256_shape",
      sql`${table.textSha256} is null or ${table.textSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "consents_no_self_reference",
      sql`${table.priorDecisionId} is null or ${table.priorDecisionId} <> ${table.id}`,
    ),
  ],
);
