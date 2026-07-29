import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const ledgerEntryKind = pgEnum("ledger_entry_kind", ["grant", "debit", "free", "compensation", "revocation"]);

export const messagePackages = pgTable("message_packages", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  grantedMessages: integer("granted_messages").notNull(),
  grantIdempotencyKey: text("grant_idempotency_key").notNull(),
  createdAt,
});

export const messageEvents = pgTable("message_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  externalMessageId: text("external_message_id").notNull(),
  direction: text("direction").notNull(),
  createdAt,
});

export const messageLedgerEntries = pgTable("message_ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  packageId: uuid("package_id").notNull().references(() => messagePackages.id),
  entryKind: ledgerEntryKind("entry_kind").notNull(),
  delta: integer("delta").notNull(),
  direction: text("direction").notNull().default("outbound"),
  messageEventId: uuid("message_event_id").references(() => messageEvents.id),
  originalEntryId: uuid("original_entry_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt,
});
