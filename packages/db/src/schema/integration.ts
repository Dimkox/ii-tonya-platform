import { sql } from "drizzle-orm";
import {
  check,
  char,
  date,
  foreignKey,
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { messageEvents } from "./billing.js";
import { slots } from "./catalog.js";
import { users } from "./identity.js";
import { adminApprovals } from "./audit.js";

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
    dialogueId: uuid("dialogue_id").references(() => dialogues.id),
    dialogueSequence: bigint("dialogue_sequence", { mode: "bigint" }),
    sensitiveRedactedAt: timestamp("sensitive_redacted_at", {
      withTimezone: true,
    }),
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
    check(
      "integration_outbox_dialogue_order_pair",
      sql`(${table.dialogueId} is null) = (${table.dialogueSequence} is null)`,
    ),
    check(
      "integration_outbox_dialogue_sequence_positive",
      sql`${table.dialogueSequence} is null or ${table.dialogueSequence} > 0`,
    ),
    uniqueIndex("integration_outbox_dialogue_sequence_unique")
      .on(table.dialogueId, table.dialogueSequence)
      .where(sql`${table.dialogueId} is not null`),
    index("integration_outbox_dialogue_order_claim_idx")
      .on(table.dialogueId, table.dialogueSequence, table.status)
      .where(
        sql`${table.topic} = 'telegram.send_text.v1' and ${table.dialogueId} is not null`,
      ),
    index("integration_outbox_dispatch_lease")
      .on(table.status, table.leaseUntil)
      .where(sql`${table.status} = 'processing'`),
    index("integration_outbox_reconciliation_lease")
      .on(table.status, table.reconciliationLeaseUntil)
      .where(sql`${table.status} = 'reconciling'`),
  ],
);

export const clientCatalogRequests = pgTable(
  "client_catalog_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestDigest: char("request_digest", { length: 64 }).notNull(),
    serviceCode: text("service_code"),
    language: text("language"),
    state: text("state").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
    ...mutableTimestamps,
  },
  (table) => [
    unique("client_catalog_requests_user_digest_unique").on(
      table.userId,
      table.requestDigest,
    ),
    check(
      "client_catalog_requests_digest_check",
      sql`${table.requestDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "client_catalog_requests_state_check",
      sql`${table.state} in ('pending','ready')`,
    ),
    check(
      "client_catalog_requests_filters_check",
      sql`(${table.serviceCode} is null or (char_length(${table.serviceCode}) between 1 and 64 and ${table.serviceCode} !~ '[[:cntrl:]]')) and (${table.language} is null or (char_length(${table.language}) between 1 and 32 and ${table.language} !~ '[[:cntrl:]]'))`,
    ),
    check(
      "client_catalog_requests_time_check",
      sql`${table.expiresAt} >= ${table.createdAt} and ${table.updatedAt} >= ${table.createdAt}`,
    ),
    index("client_catalog_requests_expiry_idx")
      .on(table.expiresAt, table.id)
      .where(sql`${table.state} in ('pending','ready')`),
  ],
);

export const clientCatalogSnapshots = pgTable(
  "client_catalog_snapshots",
  {
    requestId: uuid("request_id")
      .primaryKey()
      .references(() => clientCatalogRequests.id, { onDelete: "cascade" }),
    cards: jsonb("cards").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    check(
      "client_catalog_snapshots_cards_check",
      sql`jsonb_typeof(${table.cards}) = 'array' and jsonb_array_length(${table.cards}) <= 20`,
    ),
    check(
      "client_catalog_snapshots_expiry_check",
      sql`${table.expiresAt} >= ${table.createdAt}`,
    ),
  ],
);

export const clientCatalogTombstones = pgTable(
  "client_catalog_tombstones",
  {
    requestId: uuid("request_id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("expired"),
  },
  (table) => [
    check(
      "client_catalog_tombstones_state_check",
      sql`${table.state} = 'expired'`,
    ),
  ],
);

export const clientCatalogErasureIndex = pgTable(
  "client_catalog_erasure_index",
  {
    requestId: uuid("request_id").primaryKey(),
    subjectKey: char("subject_key", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "client_catalog_erasure_index_subject_check",
      sql`${table.subjectKey} ~ '^[0-9a-f]{64}$'`,
    ),
    index("client_catalog_erasure_index_subject_idx").on(
      table.subjectKey,
      table.requestId,
    ),
  ],
);
export const clientCatalogChoices = pgTable(
  "client_catalog_choices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => clientCatalogRequests.id, { onDelete: "cascade" }),
    choiceDigest: char("choice_digest", { length: 71 }).notNull(),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => slots.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    unique("client_catalog_choices_choice_digest_unique").on(
      table.choiceDigest,
    ),
    check(
      "client_catalog_choices_choice_digest_check",
      sql`${table.choiceDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "client_catalog_choices_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    index("client_catalog_choices_request_expiry_idx").on(
      table.requestId,
      table.expiresAt,
      table.id,
    ),
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
    caseType: text("case_type").notNull().default("delivery_failure"),
    caseReasonCode: text("case_reason_code")
      .notNull()
      .default("delivery_failure"),
    status: text("status").notNull().default("open"),
    rating: integer("rating"),
    contentHash: text("content_hash"),
    policyVersion: text("policy_version"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("outbox_operator_alerts_outbox_reason_unique").on(
      table.outboxId,
      table.reasonCode,
    ),
    check(
      "outbox_operator_alerts_case_type_check",
      sql`${table.caseType} in ('safety','negative_feedback','delivery_failure')`,
    ),
    check(
      "outbox_operator_alerts_status_check",
      sql`${table.status} in ('open','acknowledged','resolved')`,
    ),
    check(
      "outbox_operator_alerts_case_reason_check",
      sql`${table.caseReasonCode} ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'`,
    ),
    check(
      "outbox_operator_alerts_payload_check",
      sql`(${table.caseType} = 'safety' and ${table.caseReasonCode} = 'safety_operator_escalation' and ${table.rating} is null and ${table.contentHash} is null and ${table.policyVersion} is null) or (${table.caseType} = 'negative_feedback' and ${table.caseReasonCode} = 'negative_feedback_policy' and ${table.rating} between 1 and 5 and ${table.contentHash} ~ '^[0-9a-f]{64}$' and ${table.policyVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$') or (${table.caseType} = 'delivery_failure' and ${table.caseReasonCode} in ('delivery_failure','negative_feedback_source_invalid') and ${table.rating} is null and ${table.contentHash} is null and ${table.policyVersion} is null)`,
    ),
    check(
      "outbox_operator_alerts_lifecycle_check",
      sql`((${table.status} = 'open' and ${table.acknowledgedAt} is null and ${table.resolvedAt} is null) or (${table.status} = 'acknowledged' and ${table.acknowledgedAt} is not null and ${table.resolvedAt} is null) or (${table.status} = 'resolved' and ${table.resolvedAt} is not null)) and ${table.updatedAt} >= ${table.createdAt} and (${table.acknowledgedAt} is null or ${table.acknowledgedAt} >= ${table.createdAt}) and (${table.resolvedAt} is null or ${table.resolvedAt} >= ${table.createdAt})`,
    ),
    index("outbox_operator_alerts_unresolved_cursor_idx")
      .on(table.caseType, table.status, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.status} in ('open','acknowledged')`),
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

export const dialogues = pgTable(
  "dialogues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantKey: text("tenant_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    botKey: text("bot_key").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    nextDeliverySequence: bigint("next_delivery_sequence", { mode: "bigint" })
      .notNull()
      .default(0n),
    createdAt,
  },
  (table) => [
    unique("dialogues_scope_unique").on(
      table.tenantKey,
      table.provider,
      table.botKey,
      table.externalChatId,
    ),
    unique("dialogues_id_user_bot_chat_unique").on(
      table.id,
      table.userId,
      table.botKey,
      table.externalChatId,
    ),
    check(
      "dialogues_delivery_sequence_nonnegative",
      sql`${table.nextDeliverySequence} >= 0`,
    ),
  ],
);
export const dialogueInbound = pgTable(
  "dialogue_inbound",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dialogueId: uuid("dialogue_id")
      .notNull()
      .references(() => dialogues.id),
    provider: text("provider").notNull(),
    botKey: text("bot_key").notNull(),
    providerUpdateId: bigint("provider_update_id", {
      mode: "bigint",
    }).notNull(),
    payloadHash: char("payload_hash", { length: 64 }).notNull(),
    text: text("text").notNull(),
    createdAt,
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("dialogue_inbound_provider_bot_update_unique").on(
      table.provider,
      table.botKey,
      table.providerUpdateId,
    ),
    check(
      "dialogue_inbound_text_check",
      sql`char_length(${table.text}) between 1 and 4096 and ${table.text} !~ '[[:cntrl:]]'`,
    ),
    check(
      "dialogue_inbound_expiry_check",
      sql`${table.expiresAt} = ${table.createdAt} + interval '30 days'`,
    ),
    index("dialogue_inbound_dialogue_idx").on(
      table.dialogueId,
      table.createdAt,
    ),
    index("dialogue_inbound_expiry_idx").on(table.expiresAt, table.id),
  ],
);
export const dialogueRouteDecisions = pgTable(
  "dialogue_route_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inboundId: uuid("inbound_id")
      .notNull()
      .references(() => dialogueInbound.id),
    routeVersion: integer("route_version").notNull().default(1),
    route: text("route").notNull(),
    createdAt,
  },
  (table) => [
    unique("dialogue_route_inbound_unique").on(table.inboundId),
    check(
      "dialogue_route_check",
      sql`${table.route} in ('deterministic','complex_dialogue')`,
    ),
    check("dialogue_route_version_check", sql`${table.routeVersion} > 0`),
  ],
);

export const selartiResponseProposals = pgTable(
  "selarti_response_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: text("request_id").notNull(),
    dialogueId: uuid("dialogue_id")
      .notNull()
      .references(() => dialogues.id),
    tenantKey: text("tenant_key").notNull(),
    requestPayloadHash: char("request_payload_hash", { length: 64 }).notNull(),
    responsePayloadHash: char("response_payload_hash", {
      length: 64,
    }).notNull(),
    text: text("text"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
  },
  (table) => [
    unique("selarti_response_proposals_request_id_unique").on(table.requestId),
    check(
      "selarti_response_proposals_hash_check",
      sql`${table.requestPayloadHash} ~ '^[0-9a-f]{64}$' and ${table.responsePayloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "selarti_response_proposals_text_check",
      sql`${table.text} is null or (char_length(${table.text}) between 1 and 4096 and ${table.text} !~ '[[:cntrl:]]')`,
    ),
    check(
      "selarti_response_proposals_expiry_check",
      sql`${table.expiresAt} = ${table.acceptedAt} + interval '30 days'`,
    ),
    check(
      "selarti_response_proposals_redaction_check",
      sql`(${table.text} is null) = (${table.redactedAt} is not null)`,
    ),
    index("selarti_response_proposals_expiry_idx")
      .on(table.expiresAt, table.id)
      .where(sql`${table.redactedAt} is null`),
  ],
);

export const dialogueDeliveries = pgTable(
  "dialogue_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dialogueId: uuid("dialogue_id")
      .notNull()
      .references(() => dialogues.id),
    dialogueSequence: bigint("dialogue_sequence", {
      mode: "bigint",
    }).notNull(),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => integrationOutbox.id),
    payloadHash: char("payload_hash", { length: 64 }).notNull(),
    createdAt,
  },
  (table) => [
    unique("dialogue_deliveries_outbox_id_unique").on(table.outboxId),
    unique("dialogue_deliveries_dialogue_sequence_unique").on(
      table.dialogueId,
      table.dialogueSequence,
    ),
    unique("dialogue_deliveries_source_unique").on(
      table.source,
      table.sourceId,
    ),
    check(
      "dialogue_deliveries_sequence_positive",
      sql`${table.dialogueSequence} > 0`,
    ),
    check(
      "dialogue_deliveries_source_check",
      sql`${table.source} in ('deterministic','selarti')`,
    ),
    check(
      "dialogue_deliveries_hash_check",
      sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
    index("dialogue_deliveries_order_idx").on(
      table.dialogueId,
      table.dialogueSequence,
    ),
  ],
);

export const dialogueInboundTombstones = pgTable(
  "dialogue_inbound_tombstones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dialogueId: uuid("dialogue_id")
      .notNull()
      .references(() => dialogues.id),
    provider: text("provider").notNull(),
    botKey: text("bot_key").notNull(),
    providerUpdateId: bigint("provider_update_id", {
      mode: "bigint",
    }).notNull(),
    payloadHash: char("payload_hash", { length: 64 }).notNull(),
    route: text("route").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    purgedAt: timestamp("purged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("dialogue_inbound_tombstones_scope_unique").on(
      table.provider,
      table.botKey,
      table.providerUpdateId,
    ),
    check(
      "dialogue_inbound_tombstones_hash_check",
      sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "dialogue_inbound_tombstones_route_check",
      sql`${table.route} in ('deterministic','complex_dialogue')`,
    ),
  ],
);

export const selartiBudgetPolicies = pgTable(
  "selarti_budget_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    globalCapRubMinor: bigint("global_cap_rub_minor", {
      mode: "bigint",
    }).notNull(),
    globalWarningRubMinor: bigint("global_warning_rub_minor", {
      mode: "bigint",
    }).notNull(),
    globalSoftRubMinor: bigint("global_soft_rub_minor", {
      mode: "bigint",
    }).notNull(),
    perUserWarningRubMinor: bigint("per_user_warning_rub_minor", {
      mode: "bigint",
    }).notNull(),
    perUserSoftRubMinor: bigint("per_user_soft_rub_minor", {
      mode: "bigint",
    }).notNull(),
    perUserHardRubMinor: bigint("per_user_hard_rub_minor", {
      mode: "bigint",
    }).notNull(),
    officialUsdRubQuoteMicros: bigint("official_usd_rub_quote_micros", {
      mode: "bigint",
    }).notNull(),
    selartiUpliftBps: integer("selarti_uplift_bps").notNull().default(1000),
    usdMicrosPerRequest: bigint("usd_micros_per_request", {
      mode: "bigint",
    }).notNull(),
    usdMicrosPerUnit: bigint("usd_micros_per_unit", {
      mode: "bigint",
    }).notNull(),
    worstCaseBillableUnits: bigint("worst_case_billable_units", {
      mode: "bigint",
    }).notNull(),
    rateVersion: text("rate_version").notNull(),
    modelVersion: text("model_version").notNull(),
    stressInflationBps: integer("stress_inflation_bps").notNull().default(6000),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => adminApprovals.id),
    createdAt,
  },
  (table) => {
    const derivedWorstCaseRubMinor = sql`ceil(((${table.usdMicrosPerRequest}::numeric + ${table.usdMicrosPerUnit}::numeric * ${table.worstCaseBillableUnits}::numeric) * ceil(${table.officialUsdRubQuoteMicros}::numeric * (10000 + ${table.selartiUpliftBps})::numeric / 10000) * 100) / 1000000000000)`;
    return [
      unique("selarti_budget_policies_version_unique").on(table.version),
      unique("selarti_budget_policies_approval_id_unique").on(table.approvalId),
      unique("selarti_budget_policy_id_version_unique").on(
        table.id,
        table.version,
      ),
      uniqueIndex("selarti_budget_policy_one_active_idx")
        .on(table.status)
        .where(
          sql`${table.status}='approved' and ${table.effectiveTo} is null`,
        ),
      check(
        "selarti_budget_policy_status_check",
        sql`${table.status} in ('approved','retired')`,
      ),
      check(
        "selarti_budget_policy_window_check",
        sql`${table.effectiveTo} is null or ${table.effectiveTo}>${table.effectiveFrom}`,
      ),
      check(
        "selarti_budget_policy_threshold_check",
        sql`${table.globalCapRubMinor}>0 and ${table.globalCapRubMinor}<=999999999999 and ${table.globalWarningRubMinor}>=0 and ${table.globalWarningRubMinor}<=999999999999 and ${table.globalWarningRubMinor}<=${table.globalSoftRubMinor} and ${table.globalSoftRubMinor}<=999999999999 and ${table.globalSoftRubMinor}<=${table.globalCapRubMinor} and ${table.perUserWarningRubMinor}>=0 and ${table.perUserWarningRubMinor}<=999999999999 and ${table.perUserWarningRubMinor}<=${table.perUserSoftRubMinor} and ${table.perUserSoftRubMinor}<=999999999999 and ${table.perUserSoftRubMinor}<=${table.perUserHardRubMinor} and ${table.perUserHardRubMinor}<=999999999999 and ${table.perUserHardRubMinor}<=${table.globalCapRubMinor}`,
      ),
      check(
        "selarti_budget_policy_cost_check",
        sql`${table.officialUsdRubQuoteMicros}>0 and ${table.officialUsdRubQuoteMicros}<=999999999999 and ${table.selartiUpliftBps}=1000 and ${table.usdMicrosPerRequest}>=0 and ${table.usdMicrosPerRequest}<=999999999999 and ${table.usdMicrosPerUnit}>=0 and ${table.usdMicrosPerUnit}<=999999999999 and ${table.worstCaseBillableUnits}>0 and ${table.worstCaseBillableUnits}<=1000000 and ${table.stressInflationBps}=6000 and ${derivedWorstCaseRubMinor}>0 and ${derivedWorstCaseRubMinor}<=999999999999`,
      ),
    ];
  },
);

export const selartiCostReservations = pgTable(
  "selarti_cost_reservations",
  {
    requestId: text("request_id").primaryKey(),
    payloadHash: char("payload_hash", { length: 64 }).notNull(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => selartiBudgetPolicies.id),
    policyVersion: integer("policy_version").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    dialogueId: uuid("dialogue_id")
      .notNull()
      .references(() => dialogues.id),
    periodStart: date("period_start").notNull(),
    officialUsdRubQuoteMicros: bigint("official_usd_rub_quote_micros", {
      mode: "bigint",
    }).notNull(),
    effectiveUsdRubQuoteMicros: bigint("effective_usd_rub_quote_micros", {
      mode: "bigint",
    }).notNull(),
    selartiUpliftBps: integer("selarti_uplift_bps").notNull(),
    usdMicrosPerRequest: bigint("usd_micros_per_request", {
      mode: "bigint",
    }).notNull(),
    usdMicrosPerUnit: bigint("usd_micros_per_unit", {
      mode: "bigint",
    }).notNull(),
    worstCaseBillableUnits: bigint("worst_case_billable_units", {
      mode: "bigint",
    }).notNull(),
    worstCaseUsdMicros: bigint("worst_case_usd_micros", {
      mode: "bigint",
    }).notNull(),
    reservedRubMinor: bigint("reserved_rub_minor", {
      mode: "bigint",
    }).notNull(),
    rateVersion: text("rate_version").notNull(),
    modelVersion: text("model_version").notNull(),
    createdAt,
  },
  (table) => [
    index("selarti_cost_reservations_period_idx").on(
      table.periodStart,
      table.userId,
    ),
    foreignKey({
      columns: [table.policyId, table.policyVersion],
      foreignColumns: [selartiBudgetPolicies.id, selartiBudgetPolicies.version],
      name: "selarti_cost_reservation_policy_fk",
    }),
    check(
      "selarti_cost_reservation_hash_check",
      sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "selarti_cost_reservation_amount_check",
      sql`${table.reservedRubMinor}>0 and ${table.worstCaseUsdMicros}>0`,
    ),
  ],
);

export const selartiActualUsageFacts = pgTable(
  "selarti_actual_usage_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    factId: text("fact_id").notNull(),
    requestId: text("request_id")
      .notNull()
      .references(() => selartiCostReservations.requestId),
    payloadHash: char("payload_hash", { length: 64 }).notNull(),
    outcome: text("outcome").notNull(),
    actualUsdMicros: bigint("actual_usd_micros", { mode: "bigint" }),
    actualRubMinor: bigint("actual_rub_minor", { mode: "bigint" }),
    createdAt,
  },
  (table) => [
    unique("selarti_actual_usage_facts_fact_id_unique").on(table.factId),
    index("selarti_actual_usage_request_idx").on(
      table.requestId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("selarti_actual_usage_terminal_unique")
      .on(table.requestId)
      .where(sql`${table.outcome} in ('not_applied','applied')`),
    uniqueIndex("selarti_actual_usage_unknown_unique")
      .on(table.requestId)
      .where(sql`${table.outcome}='unknown'`),
    check(
      "selarti_actual_usage_hash_check",
      sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "selarti_actual_usage_outcome_check",
      sql`${table.outcome} in ('unknown','not_applied','applied')`,
    ),
    check(
      "selarti_actual_usage_amount_check",
      sql`(${table.outcome}='applied' and ${table.actualUsdMicros} is not null and ${table.actualUsdMicros}>=0 and ${table.actualRubMinor} is not null and ${table.actualRubMinor}>=0) or (${table.outcome}<>'applied' and ${table.actualUsdMicros} is null and ${table.actualRubMinor} is null)`,
    ),
  ],
);

export const selartiCostAdjustments = pgTable(
  "selarti_cost_adjustments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => selartiCostReservations.requestId),
    kind: text("kind").notNull(),
    amountRubMinor: bigint("amount_rub_minor", { mode: "bigint" }).notNull(),
    factId: text("fact_id").notNull(),
    createdAt,
  },
  (table) => [
    unique("selarti_cost_adjustment_unique").on(table.requestId, table.kind),
    check(
      "selarti_cost_adjustment_kind_check",
      sql`${table.kind} in ('released','consumed','unused_released','overrun')`,
    ),
    check(
      "selarti_cost_adjustment_amount_check",
      sql`${table.amountRubMinor}>=0`,
    ),
  ],
);

export const selartiBudgetAlerts = pgTable(
  "selarti_budget_alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: text("request_id").notNull(),
    policyVersion: integer("policy_version").notNull(),
    outcome: text("outcome").notNull(),
    amountRubMinor: bigint("amount_rub_minor", { mode: "bigint" }).notNull(),
    createdAt,
  },
  (table) => [
    unique("selarti_budget_alert_unique").on(table.requestId, table.outcome),
    check(
      "selarti_budget_alert_outcome_check",
      sql`${table.outcome} in ('warning','soft_stop','hard_stop','overrun','unknown')`,
    ),
    check("selarti_budget_alert_amount_check", sql`${table.amountRubMinor}>=0`),
    index("selarti_budget_alerts_created_idx").on(table.createdAt, table.id),
  ],
);
