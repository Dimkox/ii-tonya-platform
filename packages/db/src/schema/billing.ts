import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  pgView,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const ledgerEntryKind = pgEnum("ledger_entry_kind", ["grant", "debit", "free", "compensation", "revocation"]);

export const messagePackages = pgTable(
  "message_packages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    grantedMessages: integer("granted_messages").notNull(),
    grantIdempotencyKey: text("grant_idempotency_key").notNull(),
    kind: text("kind").notNull().default("paid"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt,
  },
  (table) => [
    check("message_packages_grant_positive", sql`${table.grantedMessages} > 0`),
    check("message_packages_kind_allowed", sql`${table.kind} in ('admin', 'paid', 'intro')`),
    unique("message_packages_grant_idempotency_unique").on(table.grantIdempotencyKey),
    index("message_packages_eligible_order").on(
      table.userId,
      table.kind,
      table.expiresAt,
      table.grantedAt,
      table.id,
    ),
  ],
);

export const messageEvents = pgTable(
  "message_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    provider: text("provider").notNull(),
    externalMessageId: text("external_message_id").notNull(),
    direction: text("direction").notNull(),
    createdAt,
  },
  (table) => [
    unique("message_events_provider_external_unique")
      .on(table.provider, table.externalMessageId),
  ],
);

export const messageLedgerEntries = pgTable(
  "message_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    packageId: uuid("package_id").notNull().references(() => messagePackages.id),
    entryKind: ledgerEntryKind("entry_kind").notNull(),
    delta: integer("delta").notNull(),
    direction: text("direction").notNull().default("outbound"),
    messageEventId: uuid("message_event_id").references(() => messageEvents.id),
    originalEntryId: uuid("original_entry_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt,
  },
  (table) => [
    unique("message_ledger_idempotency_unique").on(table.idempotencyKey),
    foreignKey({
      columns: [table.originalEntryId],
      foreignColumns: [table.id],
      name: "message_ledger_original_entry_fk",
    }),
    check("message_ledger_delta_matches_kind", sql`
      (${table.entryKind} = 'grant' and ${table.delta} > 0 and ${table.messageEventId} is null and ${table.originalEntryId} is null)
      or (${table.entryKind} = 'debit' and ${table.delta} = -1 and ${table.messageEventId} is not null and ${table.originalEntryId} is null)
      or (${table.entryKind} = 'free' and ${table.delta} = 0 and ${table.messageEventId} is not null and ${table.originalEntryId} is null)
      or (${table.entryKind} = 'compensation' and ${table.delta} = 1 and ${table.messageEventId} is null and ${table.originalEntryId} is not null)
      or (${table.entryKind} = 'revocation' and ${table.delta} <= 0 and ${table.messageEventId} is null and ${table.originalEntryId} is not null)
    `),
    uniqueIndex("message_ledger_message_fact_once")
      .on(table.messageEventId, table.direction)
      .where(sql`${table.messageEventId} is not null and ${table.entryKind} in ('debit', 'free')`),
    uniqueIndex("message_ledger_grant_once_per_package")
      .on(table.packageId)
      .where(sql`${table.entryKind} = 'grant'`),
    uniqueIndex("message_ledger_compensation_once_per_original")
      .on(table.originalEntryId)
      .where(sql`${table.entryKind} = 'compensation'`),
    uniqueIndex("message_ledger_revocation_once_per_package_grant")
      .on(table.packageId, table.originalEntryId)
      .where(sql`${table.entryKind} = 'revocation'`),
  ],
);

export const packageBalances = pgView("package_balances", {
  packageId: uuid("package_id").notNull(),
  userId: uuid("user_id").notNull(),
  balance: integer("balance").notNull(),
}).as(sql`
  select p.id as package_id, p.user_id, coalesce(sum(l.delta), 0)::integer as balance
  from message_packages p
  left join message_ledger_entries l on l.package_id = p.id
  group by p.id, p.user_id
`);
