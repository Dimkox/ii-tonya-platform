import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { messageEvents } from "./billing.js";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const mutableTimestamps = {
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};
export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "processing",
  "unknown_outcome",
  "reconciling",
  "succeeded",
  "retry_wait",
  "dead_letter",
]);

export const integrationInbox = pgTable(
  "integration_inbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    normalizedIdentifier: text("normalized_identifier").notNull(),
    messageEventId: uuid("message_event_id").references(() => messageEvents.id),
    ...mutableTimestamps,
  },
  (table) => [
    unique("integration_inbox_provider_event_unique").on(
      table.provider,
      table.externalEventId,
    ),
  ],
);
export const integrationErrors = pgTable(
  "integration_errors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    reasonCode: text("reason_code").notNull(),
    metadataHash: text("metadata_hash").notNull(),
    status: text("status").notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...mutableTimestamps,
  },
  (table) => [
    check("integration_errors_status_allowed", sql`${table.status} in ('open', 'resolved')`),
  ],
);
export const integrationOutbox = pgTable(
  "integration_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    topic: text("topic").notNull().default("legacy.unknown"),
    payload: jsonb("payload").notNull().default({}),
    correlationId: text("correlation_id").notNull().default("legacy"),
    status: outboxStatus("status").notNull().default("pending"),
    reconciliationKey: text("reconciliation_key").notNull(),
    attempt: integer("attempt").notNull().default(0),
    reconciliationAttempt: integer("reconciliation_attempt")
      .notNull()
      .default(0),
    dispatchOwnerId: text("dispatch_owner_id"),
    dispatchClaimToken: text("dispatch_claim_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    reconciliationOwnerId: text("reconciliation_owner_id"),
    reconciliationClaimToken: text("reconciliation_claim_token"),
    reconciliationLeaseUntil: timestamp("reconciliation_lease_until", {
      withTimezone: true,
    }),
    nextReconciliationAt: timestamp("next_reconciliation_at", {
      withTimezone: true,
    }),
    lastNormalizedReason: text("last_normalized_reason"),
    payloadHash: text("payload_hash").notNull(),
    ...mutableTimestamps,
  },
  (table) => [
    unique("integration_outbox_idempotency_unique").on(table.idempotencyKey),
    check(
      "integration_outbox_reconciliation_key_present",
      sql`length(${table.reconciliationKey}) > 0`,
    ),
    check(
      "integration_outbox_attempts_nonnegative",
      sql`${table.attempt} >= 0 and ${table.reconciliationAttempt} >= 0`,
    ),
    index("integration_outbox_dispatch_lease")
      .on(table.status, table.leaseUntil)
      .where(sql`${table.status} = 'processing'`),
    index("integration_outbox_reconciliation_lease")
      .on(table.status, table.reconciliationLeaseUntil)
      .where(sql`${table.status} = 'reconciling'`),
  ],
);
export const deliveryAttempts = pgTable("delivery_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  outboxId: uuid("outbox_id")
    .notNull()
    .references(() => integrationOutbox.id),
  attemptId: text("attempt_id").notNull().default("legacy"),
  attempt: integer("attempt").notNull(),
  provider: text("provider").notNull(),
  outcome: text("outcome").notNull(),
  reconciliationKey: text("reconciliation_key").notNull().default("legacy"),
  normalizedReason: text("normalized_reason"),
  createdAt,
});
export const deadLetters = pgTable(
  "dead_letters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => integrationOutbox.id),
    reason: text("reason").notNull(),
    payloadHash: text("payload_hash").notNull(),
    ...mutableTimestamps,
  },
  (table) => [unique("dead_letters_outbox_unique").on(table.outboxId)],
);
export const outboxOperatorAlerts = pgTable(
  "outbox_operator_alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => integrationOutbox.id),
    reasonCode: text("reason_code").notNull(),
    createdAt,
  },
  (table) => [
    unique("outbox_operator_alerts_outbox_reason_unique").on(
      table.outboxId,
      table.reasonCode,
    ),
  ],
);
export const providerCursors = pgTable(
  "provider_cursors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    cursor: text("cursor").notNull(),
    ...mutableTimestamps,
  },
  (table) => [unique("provider_cursors_provider_unique").on(table.provider)],
);
export const reconciliationRuns = pgTable("reconciliation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt,
});
export const reconciliationMismatches = pgTable("reconciliation_mismatches", {
  id: uuid("id").defaultRandom().primaryKey(),
  reconciliationRunId: uuid("reconciliation_run_id")
    .notNull()
    .references(() => reconciliationRuns.id),
  outboxId: uuid("outbox_id").references(() => integrationOutbox.id),
  reason: text("reason").notNull(),
  createdAt,
});
export const projectionCheckpoints = pgTable(
  "projection_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projection: text("projection").notNull(),
    position: text("position").notNull(),
    ...mutableTimestamps,
  },
  (table) => [
    unique("projection_checkpoints_projection_unique").on(table.projection),
  ],
);
