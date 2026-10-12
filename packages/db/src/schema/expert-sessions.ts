import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users, channelIdentities } from "./identity.js";
import { experts } from "./catalog.js";
export const expertSessions = pgTable(
  "expert_sessions",
  {
    tokenDigest: text("token_digest").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    channelIdentityId: uuid("channel_identity_id")
      .notNull()
      .references(() => channelIdentities.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    botKey: text("bot_key"),
    externalChatId: text("external_chat_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "expert_sessions_identity",
      sql`${t.externalId} ~ '^[1-9][0-9]{0,15}$' AND (${t.botKey} IS NULL OR ${t.botKey} ~ '^[A-Za-z0-9_-]{1,64}$') AND ((${t.externalChatId} IS NOT NULL AND ${t.externalChatId}=${t.externalId}) OR (${t.botKey} IS NULL AND ${t.externalChatId} IS NULL))`,
    ),
    check(
      "expert_sessions_digest",
      sql`${t.tokenDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "expert_sessions_lifetime",
      sql`isfinite(${t.createdAt}) and isfinite(${t.expiresAt}) and ${t.expiresAt}>${t.createdAt} and ${t.expiresAt}<=${t.createdAt}+interval '1 hour' and (${t.revokedAt} is null or (isfinite(${t.revokedAt}) and ${t.revokedAt}>=${t.createdAt}))`,
    ),
    index("expert_sessions_expiry_idx").on(t.expiresAt, t.tokenDigest),
  ],
);
export const expertIdentityProofReceipts = pgTable(
  "expert_identity_proof_receipts",
  {
    replayDigest: text("replay_digest").primaryKey(),
    sessionTokenDigest: text("session_token_digest")
      .unique()
      .references(() => expertSessions.tokenDigest, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "expert_proof_digest",
      sql`${t.replayDigest} ~ '^expert-login:v1:[0-9a-f]{64}$'`,
    ),
    check(
      "expert_proof_lifetime",
      sql`isfinite(${t.createdAt}) and isfinite(${t.expiresAt}) and ${t.expiresAt}>${t.createdAt} and ${t.expiresAt}<=${t.createdAt}+interval '330 seconds'`,
    ),
    index("expert_identity_proof_expiry_idx").on(t.expiresAt, t.replayDigest),
  ],
);
