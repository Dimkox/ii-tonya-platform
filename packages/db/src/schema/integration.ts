import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const mutableTimestamps = {
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
export const outboxStatus = pgEnum("outbox_status", ["pending", "processing", "unknown_outcome", "reconciling", "succeeded", "retry_wait", "dead_letter"]);

export const integrationInbox = pgTable("integration_inbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(),
  externalEventId: text("external_event_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  normalizedIdentifier: text("normalized_identifier").notNull(),
  ...mutableTimestamps,
});
export const integrationOutbox = pgTable("integration_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: outboxStatus("status").notNull().default("pending"),
  reconciliationKey: text("reconciliation_key").notNull(),
  attempt: integer("attempt").notNull().default(0),
  reconciliationAttempt: integer("reconciliation_attempt").notNull().default(0),
  dispatchOwnerId: text("dispatch_owner_id"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  reconciliationOwnerId: text("reconciliation_owner_id"),
  reconciliationLeaseUntil: timestamp("reconciliation_lease_until", { withTimezone: true }),
  lastNormalizedReason: text("last_normalized_reason"),
  payloadHash: text("payload_hash").notNull(),
  ...mutableTimestamps,
});
export const deliveryAttempts = pgTable("delivery_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  outboxId: uuid("outbox_id").notNull().references(() => integrationOutbox.id),
  attempt: integer("attempt").notNull(),
  provider: text("provider").notNull(),
  outcome: text("outcome").notNull(),
  normalizedReason: text("normalized_reason"),
  createdAt,
});
export const deadLetters = pgTable("dead_letters", {
  id: uuid("id").defaultRandom().primaryKey(),
  outboxId: uuid("outbox_id").notNull().references(() => integrationOutbox.id),
  reason: text("reason").notNull(),
  payloadHash: text("payload_hash").notNull(),
  ...mutableTimestamps,
});
export const providerCursors = pgTable("provider_cursors", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(),
  cursor: text("cursor").notNull(),
  ...mutableTimestamps,
});
export const reconciliationRuns = pgTable("reconciliation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt,
});
export const reconciliationMismatches = pgTable("reconciliation_mismatches", {
  id: uuid("id").defaultRandom().primaryKey(),
  reconciliationRunId: uuid("reconciliation_run_id").notNull().references(() => reconciliationRuns.id),
  outboxId: uuid("outbox_id").references(() => integrationOutbox.id),
  reason: text("reason").notNull(),
  createdAt,
});
export const projectionCheckpoints = pgTable("projection_checkpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  projection: text("projection").notNull(),
  position: text("position").notNull(),
  ...mutableTimestamps,
});
