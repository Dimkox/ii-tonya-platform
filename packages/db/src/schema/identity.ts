import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
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

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  active: boolean("active").notNull().default(true),
  ...mutableTimestamps,
});

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
    ...mutableTimestamps,
  },
  (table) => [
    unique("channel_identities_provider_external_unique").on(
      table.provider,
      table.externalId,
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

export const consents = pgTable("consents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  consentType: text("consent_type").notNull(),
  decision: text("decision").notNull(),
  policyVersion: text("policy_version").notNull(),
  createdAt,
});
