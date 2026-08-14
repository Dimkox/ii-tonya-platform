import { sql } from "drizzle-orm";
import {
  check,
  char,
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
export const webhookInbox = pgTable(
  "webhook_inbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    status: text("status").notNull(),
    claimId: uuid("claim_id").notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    ...mutableTimestamps,
  },
  (table) => [
    unique("webhook_inbox_provider_event_unique").on(
      table.provider,
      table.externalEventId,
    ),
    check(
      "webhook_inbox_status_allowed",
      sql`${table.status} in ('processing', 'complete', 'failed')`,
    ),
    index("webhook_inbox_lease").on(table.status, table.leaseUntil),
  ],
);
export const expertAiRequestReceipts = pgTable(
  "expert_ai_request_receipts",
  {
    requestKeyHash: char("request_key_hash", { length: 64 })
      .notNull()
      .primaryKey(),
    requestDigest: char("request_digest", { length: 64 }).notNull(),
    status: text("status").notNull(),
    claimId: uuid("claim_id").notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    outcomeStatus: integer("outcome_status"),
    outcomeCode: text("outcome_code"),
    outcomeDetail: text("outcome_detail"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    ...mutableTimestamps,
  },
  (table) => [
    check(
      "expert_ai_request_receipts_hashes_check",
      sql`${table.requestKeyHash} ~ '^[0-9a-f]{64}$' and ${table.requestDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "expert_ai_request_receipts_status_check",
      sql`${table.status} in ('processing','complete','failed')`,
    ),
    check(
      "expert_ai_request_receipts_version_check",
      sql`${table.version} > 0`,
    ),
    check(
      "expert_ai_request_receipts_state_check",
      sql`(${table.status} = 'processing' and ${table.leaseUntil} is not null and ${table.outcomeStatus} is null and ${table.outcomeCode} is null and ${table.outcomeDetail} is null) or (${table.status} = 'failed' and ${table.leaseUntil} is null and ${table.outcomeStatus} is null and ${table.outcomeCode} is null and ${table.outcomeDetail} is null) or (${table.status} = 'complete' and ${table.leaseUntil} is null and ((${table.outcomeStatus} = 200 and ${table.outcomeCode} = 'completed' and ${table.outcomeDetail} in ('redeem_expert_referral','view_referral_summary','quote_residency','start_residency_checkout')) or (${table.outcomeStatus} = 422 and ${table.outcomeCode} = 'proposal_rejected' and ${table.outcomeDetail} in ('invalid_shape','unsupported_intent','unauthorized_scope')) or (${table.outcomeStatus} = 403 and ${table.outcomeCode} = 'forbidden' and ${table.outcomeDetail} is null) or (${table.outcomeStatus} = 503 and ${table.outcomeCode} = 'feature_disabled' and ${table.outcomeDetail} is null)))`,
    ),
    index("expert_ai_request_receipts_lease_idx")
      .on(table.leaseUntil)
      .where(sql`${table.status} = 'processing'`),
    index("expert_ai_request_receipts_cleanup_idx")
      .on(table.expiresAt)
      .where(sql`${table.status} in ('complete','failed')`),
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
    check(
      "integration_errors_status_allowed",
      sql`${table.status} in ('open', 'resolved')`,
    ),
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
