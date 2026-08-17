import { sql } from "drizzle-orm";
import {
  check,
  char,
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { messageEvents } from "./billing.js";
import { slots } from "./catalog.js";
import { providerSubjectMappings, users } from "./identity.js";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const mutableTimestamps = {
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const clientConversationGrants = pgTable(
  "client_conversation_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerSubjectMappingId: uuid("provider_subject_mapping_id")
      .notNull()
      .references(() => providerSubjectMappings.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    unique("client_conversation_grants_mapping_scope_unique").on(
      table.providerSubjectMappingId,
      table.scope,
    ),
    check(
      "client_conversation_grants_scope_check",
      sql`${table.scope} in ('client_catalog:read','client_booking:write')`,
    ),
    check(
      "client_conversation_grants_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "client_conversation_grants_revocation_check",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
    index("client_conversation_grants_mapping_scope_lookup_idx").on(
      table.providerSubjectMappingId,
      table.scope,
      table.expiresAt,
    ),
  ],
);

export const clientConversationOperations = pgTable(
  "client_conversation_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageEventId: uuid("message_event_id")
      .notNull()
      .references(() => messageEvents.id, { onDelete: "cascade" }),
    bindingId: uuid("binding_id").references(() => providerSubjectMappings.id, {
      onDelete: "set null",
    }),
    requiredScope: text("required_scope").notNull(),
    toolKind: text("tool_kind").notNull(),
    proposalDigest: char("proposal_digest", { length: 64 }).notNull(),
    payloadEnvelopeVersion: smallint("payload_envelope_version"),
    payloadKeyId: text("payload_key_id"),
    payloadNonce: bytea("payload_nonce"),
    payloadCiphertext: bytea("payload_ciphertext"),
    payloadTag: bytea("payload_tag"),
    payloadExpiresAt: timestamp("payload_expires_at", {
      withTimezone: true,
    }).notNull(),
    status: text("status").notNull(),
    claimFence: bigint("claim_fence", { mode: "number" }).notNull().default(0),
    claimOwnerId: text("claim_owner_id"),
    claimToken: uuid("claim_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    reconciliationOwnerId: text("reconciliation_owner_id"),
    reconciliationClaimToken: uuid("reconciliation_claim_token"),
    reconciliationLeaseUntil: timestamp("reconciliation_lease_until", {
      withTimezone: true,
    }),
    attempt: integer("attempt").notNull().default(0),
    reconciliationAttempt: integer("reconciliation_attempt")
      .notNull()
      .default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    resultDigest: char("result_digest", { length: 64 }),
    terminalReason: text("terminal_reason"),
    ...mutableTimestamps,
  },
  (table) => [
    unique("client_conversation_operations_message_event_unique").on(
      table.messageEventId,
    ),
    unique("client_conversation_operations_nonce_unique").on(
      table.payloadKeyId,
      table.payloadNonce,
    ),
    check(
      "client_conversation_operations_proposal_digest_check",
      sql`${table.proposalDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "client_conversation_operations_result_digest_check",
      sql`${table.resultDigest} is null or ${table.resultDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "client_conversation_operations_fence_check",
      sql`${table.claimFence} >= 0 and ${table.attempt} between 0 and 5 and ${table.reconciliationAttempt} between 0 and 5`,
    ),
    check(
      "client_conversation_operations_tool_scope_check",
      sql`(${table.toolKind} = 'show_catalog' and ${table.requiredScope} = 'client_catalog:read') or (${table.toolKind} = 'start_booking' and ${table.requiredScope} = 'client_booking:write')`,
    ),
    check(
      "client_conversation_operations_expiry_check",
      sql`${table.payloadExpiresAt} > ${table.createdAt} and ${table.payloadExpiresAt} <= ${table.createdAt} + interval '24 hours' and ${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      "client_conversation_operations_key_check",
      sql`${table.payloadKeyId} is null or ${table.payloadKeyId} ~ '^[A-Za-z0-9_-]{1,32}$'`,
    ),
    check(
      "client_conversation_operations_crypto_check",
      sql`(${table.status} in ('pending','retry_wait','unknown_outcome','processing','reconciling') and ${table.payloadEnvelopeVersion} = 1 and ${table.payloadKeyId} is not null and octet_length(${table.payloadNonce}) = 12 and ${table.payloadCiphertext} is not null and octet_length(${table.payloadTag}) = 16) or (${table.status} in ('succeeded','denied','dead_letter','privacy_expired') and ${table.payloadEnvelopeVersion} is null and ${table.payloadKeyId} is null and ${table.payloadNonce} is null and ${table.payloadCiphertext} is null and ${table.payloadTag} is null)`,
    ),
    check(
      "client_conversation_operations_lease_check",
      sql`(${table.status} = 'processing' and ${table.claimOwnerId} is not null and ${table.claimToken} is not null and ${table.leaseUntil} is not null and ${table.leaseUntil} <= ${table.payloadExpiresAt} and ${table.reconciliationOwnerId} is null and ${table.reconciliationClaimToken} is null and ${table.reconciliationLeaseUntil} is null) or (${table.status} = 'reconciling' and ${table.reconciliationOwnerId} is not null and ${table.reconciliationClaimToken} is not null and ${table.reconciliationLeaseUntil} is not null and ${table.reconciliationLeaseUntil} <= ${table.payloadExpiresAt} and ${table.claimOwnerId} is null and ${table.claimToken} is null and ${table.leaseUntil} is null) or (${table.status} not in ('processing','reconciling') and ${table.claimOwnerId} is null and ${table.claimToken} is null and ${table.leaseUntil} is null and ${table.reconciliationOwnerId} is null and ${table.reconciliationClaimToken} is null and ${table.reconciliationLeaseUntil} is null)`,
    ),
    check(
      "client_conversation_operations_retry_check",
      sql`(${table.status} = 'retry_wait' and ${table.nextAttemptAt} is not null) or (${table.status} <> 'retry_wait' and ${table.nextAttemptAt} is null)`,
    ),
    check(
      "client_conversation_operations_terminal_check",
      sql`(${table.status} = 'succeeded' and ${table.resultDigest} is not null and ${table.terminalReason} is null) or (${table.status} = 'denied' and ${table.resultDigest} is null and ${table.terminalReason} = 'grant_denied') or (${table.status} = 'dead_letter' and ${table.resultDigest} is null and ${table.terminalReason} in ('invalid_operation','attempts_exhausted','crypto_invalid')) or (${table.status} = 'privacy_expired' and ${table.resultDigest} is null and ${table.terminalReason} = 'payload_expired') or (${table.status} in ('pending','processing','retry_wait','unknown_outcome','reconciling') and ${table.resultDigest} is null and ${table.terminalReason} is null)`,
    ),
    index("client_conversation_operations_dispatch_idx")
      .on(table.status, table.nextAttemptAt, table.leaseUntil)
      .where(
        sql`${table.status} in ('pending','retry_wait','unknown_outcome','reconciling')`,
      ),
    index("client_conversation_operations_expiry_idx")
      .on(table.payloadExpiresAt, table.id)
      .where(
        sql`${table.status} in ('pending','processing','retry_wait','unknown_outcome','reconciling')`,
      ),
  ],
);

export const clientConversationRuntimeLeases = pgTable(
  "client_conversation_runtime_leases",
  {
    capability: text("capability").notNull(),
    instanceId: text("instance_id").notNull(),
    contractVersion: integer("contract_version").notNull(),
    buildSha: char("build_sha", { length: 40 }).notNull(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.capability, table.instanceId],
      name: "client_conversation_runtime_leases_pkey",
    }),
    check(
      "client_conversation_runtime_leases_capability_check",
      sql`${table.capability} in ('dispatch_v1','cleanup_v1')`,
    ),
    check(
      "client_conversation_runtime_leases_contract_check",
      sql`${table.contractVersion} = 1`,
    ),
    check(
      "client_conversation_runtime_leases_sha_check",
      sql`${table.buildSha} ~ '^[0-9a-f]{40}$'`,
    ),
    check(
      "client_conversation_runtime_leases_duration_check",
      sql`${table.leaseUntil} > ${table.heartbeatAt} and ${table.leaseUntil} <= ${table.heartbeatAt} + interval '30 seconds'`,
    ),
  ],
);

export const clientConversationOperationCases = pgTable(
  "client_conversation_operation_cases",
  {
    operationId: uuid("operation_id")
      .notNull()
      .references(() => clientConversationOperations.id, {
        onDelete: "cascade",
      }),
    caseKind: text("case_kind").notNull(),
    reason: text("reason").notNull(),
    createdAt,
  },
  (table) => [
    unique("client_conversation_operation_cases_operation_kind_unique").on(
      table.operationId,
      table.caseKind,
    ),
    check(
      "client_conversation_operation_cases_kind_check",
      sql`${table.caseKind} in ('operator_case','deletion_receipt')`,
    ),
    check(
      "client_conversation_operation_cases_reason_check",
      sql`${table.reason} in ('grant_denied','invalid_operation','attempts_exhausted','payload_expired','crypto_invalid')`,
    ),
  ],
);
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
