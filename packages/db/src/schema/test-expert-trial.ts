import { sql } from "drizzle-orm";
import {
  char,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { dialogues, integrationOutbox } from "./integration.js";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
export const testExpertPromptAssets = pgTable(
  "test_expert_prompt_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assetKey: text("asset_key").notNull(),
    version: integer("version").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    sourcePath: text("source_path").notNull(),
    status: text("status").notNull().default("inactive"),
    officialContractEvidence: text("official_contract_evidence"),
    createdAt,
  },
  (t) => [
    unique("test_expert_prompt_id_version_unique").on(t.id, t.version),
    unique("test_expert_prompt_key_version_unique").on(t.assetKey, t.version),
    check(
      "test_expert_prompt_key_bounded",
      sql`char_length(${t.assetKey}) between 1 and 128`,
    ),
    check("test_expert_prompt_version_positive", sql`${t.version} > 0`),
    check(
      "test_expert_prompt_digest_check",
      sql`${t.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "test_expert_prompt_source_bounded",
      sql`char_length(${t.sourcePath}) between 1 and 512 and ${t.sourcePath} !~ '[[:cntrl:]]'`,
    ),
    check(
      "test_expert_prompt_status_check",
      sql`${t.status} in ('inactive','approved','retired')`,
    ),
    check(
      "test_expert_prompt_activation_check",
      sql`${t.status} <> 'approved' or (${t.officialContractEvidence} is not null and char_length(${t.officialContractEvidence}) between 1 and 512)`,
    ),
  ],
);
export const testExpertCampaignVersions = pgTable(
  "test_expert_campaign_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("inactive"),
    capUnits: integer("cap_units").notNull().default(100),
    providerCallsPerMessage: integer("provider_calls_per_message")
      .notNull()
      .default(1),
    promptAssetId: uuid("prompt_asset_id"),
    promptAssetVersion: integer("prompt_asset_version"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    foreignKey({
      name: "test_expert_campaign_prompt_asset_fk",
      columns: [t.promptAssetId, t.promptAssetVersion],
      foreignColumns: [
        testExpertPromptAssets.id,
        testExpertPromptAssets.version,
      ],
    }),
    unique("test_expert_campaign_code_version_unique").on(t.code, t.version),
    uniqueIndex("test_expert_campaign_one_active_idx")
      .on(t.code)
      .where(sql`${t.status}='active'`),
    check(
      "test_expert_campaign_code_bounded",
      sql`char_length(${t.code}) between 1 and 128`,
    ),
    check("test_expert_campaign_version_positive", sql`${t.version} > 0`),
    check(
      "test_expert_campaign_status_check",
      sql`${t.status} in ('inactive','active','retired')`,
    ),
    check("test_expert_campaign_cap_check", sql`${t.capUnits} = 100`),
    check(
      "test_expert_campaign_provider_calls_check",
      sql`${t.providerCallsPerMessage} = 1`,
    ),
    check(
      "test_expert_campaign_period_check",
      sql`${t.effectiveTo} is null or ${t.effectiveFrom} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    check(
      "test_expert_campaign_prompt_activation_check",
      sql`${t.status} <> 'active' or (${t.promptAssetId} is not null and ${t.promptAssetVersion} is not null and ${t.effectiveFrom} is not null)`,
    ),
  ],
);
export const testExpertLifecycleAuditEvents = pgTable(
  "test_expert_lifecycle_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    createdAt,
  },
  (t) => [
    check(
      "test_expert_lifecycle_entity_type_check",
      sql`${t.entityType} in ('prompt','campaign')`,
    ),
    check(
      "test_expert_lifecycle_transition_check",
      sql`${t.fromStatus}<>${t.toStatus}`,
    ),
  ],
);
export const testExpertSessions = pgTable(
  "test_expert_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignVersionId: uuid("campaign_version_id").references(
      () => testExpertCampaignVersions.id,
    ),
    redemptionId: uuid("redemption_id"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    dialogueId: uuid("dialogue_id")
      .notNull()
      .references(() => dialogues.id),
    botKey: text("bot_key").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    state: text("state").notNull(),
    version: integer("version").notNull().default(1),
    segment: text("segment"),
    nameDigest: char("name_digest", { length: 64 }),
    specializationDigest: char("specialization_digest", { length: 64 }),
    copyVersion: text("copy_version").notNull(),
    sellingActivation: text("selling_activation").notNull().default("inactive"),
    status: text("status").notNull().default("active"),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("test_expert_session_one_active_scope_idx")
      .on(t.botKey, t.externalChatId)
      .where(sql`${t.status}='active'`),
    index("test_expert_sessions_user_idx").on(t.userId, t.createdAt),
    check(
      "test_expert_session_state_check",
      sql`${t.state} in ('awaiting_name','awaiting_specialization','awaiting_segment','ready','qualified','closed')`,
    ),
    check("test_expert_session_version_positive", sql`${t.version}>0`),
    check(
      "test_expert_session_segment_check",
      sql`${t.segment} is null or ${t.segment} in ('EXPERT','CENTER','ORGANIZER')`,
    ),
    check(
      "test_expert_session_digest_check",
      sql`(${t.nameDigest} is null or ${t.nameDigest} ~ '^[0-9a-f]{64}$') and (${t.specializationDigest} is null or ${t.specializationDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "test_expert_session_scope_bounded",
      sql`char_length(${t.botKey}) between 1 and 128 and char_length(${t.externalChatId}) between 1 and 64`,
    ),
    check(
      "test_expert_session_copy_bounded",
      sql`char_length(${t.copyVersion}) between 1 and 128`,
    ),
    check(
      "test_expert_session_selling_inactive",
      sql`${t.sellingActivation}='inactive'`,
    ),
    check(
      "test_expert_session_status_check",
      sql`${t.status} in ('active','closed')`,
    ),
    check(
      "test_expert_session_closed_equivalence_check",
      sql`(${t.state}='closed')=(${t.status}='closed')`,
    ),
    check(
      "test_expert_session_progress_check",
      sql`(${t.state}='awaiting_name' and ${t.nameDigest} is null and ${t.specializationDigest} is null and ${t.segment} is null) or (${t.state}='awaiting_specialization' and ${t.nameDigest} is not null and ${t.specializationDigest} is null and ${t.segment} is null) or (${t.state}='awaiting_segment' and ${t.nameDigest} is not null and ${t.specializationDigest} is not null and ${t.segment} is null) or (${t.state} in ('ready','qualified','closed') and ${t.nameDigest} is not null and ${t.specializationDigest} is not null and ${t.segment} is not null)`,
    ),
    check(
      "test_expert_session_qualified_authority_check",
      sql`${t.state}<>'qualified' or (${t.campaignVersionId} is not null and ${t.redemptionId} is not null)`,
    ),
    foreignKey({
      name: "test_expert_session_dialogue_scope_fk",
      columns: [t.dialogueId, t.userId, t.botKey, t.externalChatId],
      foreignColumns: [
        dialogues.id,
        dialogues.userId,
        dialogues.botKey,
        dialogues.externalChatId,
      ],
    }),
    foreignKey({
      name: "test_expert_session_redemption_scope_fk",
      columns: [t.redemptionId, t.campaignVersionId, t.userId],
      foreignColumns: [
        testExpertRedemptions.id,
        testExpertRedemptions.campaignVersionId,
        testExpertRedemptions.userId,
      ],
    }),
  ],
);
export const testExpertDeterministicRequests = pgTable(
  "test_expert_deterministic_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => testExpertSessions.id),
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => integrationOutbox.id),
    botKey: text("bot_key").notNull(),
    requestKey: text("request_key").notNull(),
    requestDigest: char("request_digest", { length: 64 }).notNull(),
    createdAt,
  },
  (t) => [
    unique("test_expert_deterministic_scope_key_unique").on(
      t.botKey,
      t.requestKey,
    ),
    check(
      "test_expert_deterministic_bot_bounded",
      sql`char_length(${t.botKey}) between 1 and 128`,
    ),
    check(
      "test_expert_deterministic_key_bounded",
      sql`char_length(${t.requestKey}) between 1 and 128`,
    ),
    check(
      "test_expert_deterministic_digest_check",
      sql`${t.requestDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
export const testExpertRedemptions = pgTable(
  "test_expert_redemptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignVersionId: uuid("campaign_version_id")
      .notNull()
      .references(() => testExpertCampaignVersions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    redemptionIdempotencyKey: text("redemption_idempotency_key").notNull(),
    grantedUnits: integer("granted_units").notNull().default(100),
    consumedUnits: integer("consumed_units").notNull().default(0),
    reservedUnits: integer("reserved_units").notNull().default(0),
    createdAt,
  },
  (t) => [
    unique("test_expert_redemption_key_unique").on(t.redemptionIdempotencyKey),
    unique("test_expert_redemption_scope_unique").on(
      t.id,
      t.campaignVersionId,
      t.userId,
    ),
    index("test_expert_redemptions_user_idx").on(t.userId, t.campaignVersionId),
    check(
      "test_expert_redemption_nonnegative_check",
      sql`${t.consumedUnits} >= 0 and ${t.reservedUnits} >= 0`,
    ),
    check(
      "test_expert_redemption_capacity_check",
      sql`${t.consumedUnits} + ${t.reservedUnits} <= ${t.grantedUnits}`,
    ),
    check(
      "test_expert_redemption_key_bounded",
      sql`char_length(${t.redemptionIdempotencyKey}) between 1 and 128`,
    ),
    check("test_expert_redemption_granted_check", sql`${t.grantedUnits}=100`),
    check(
      "test_expert_redemption_units_even_check",
      sql`${t.consumedUnits}%2=0 and ${t.reservedUnits}%2=0`,
    ),
  ],
);
export const testExpertReservations = pgTable(
  "test_expert_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    redemptionId: uuid("redemption_id")
      .notNull()
      .references(() => testExpertRedemptions.id),
    requestKey: text("request_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    units: integer("units").notNull().default(2),
    status: text("status").notNull().default("reserved"),
    providerRequestId: text("provider_request_id"),
    createdAt,
  },
  (t) => [
    unique("test_expert_reservation_request_unique").on(
      t.redemptionId,
      t.requestKey,
    ),
    index("test_expert_reservations_redemption_status_idx").on(
      t.redemptionId,
      t.status,
      t.createdAt,
    ),
    index("test_expert_reservations_unknown_global_idx")
      .on(t.createdAt, t.id)
      .where(sql`${t.status} in ('reserved','unknown')`),
    uniqueIndex("test_expert_reservations_provider_request_idx")
      .on(t.providerRequestId)
      .where(sql`${t.providerRequestId} is not null`),
    check(
      "test_expert_reservation_key_bounded",
      sql`char_length(${t.requestKey}) between 1 and 128`,
    ),
    check(
      "test_expert_reservation_digest_check",
      sql`${t.requestDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check("test_expert_reservation_units_check", sql`${t.units} = 2`),
    check(
      "test_expert_reservation_status_check",
      sql`${t.status} in ('reserved','unknown','applied','not_applied')`,
    ),
    check(
      "test_expert_reservation_provider_request_check",
      sql`(${t.status} in ('unknown','applied') and ${t.providerRequestId} ~ '^sha256:[0-9a-f]{64}$') or (${t.status} in ('reserved','not_applied') and (${t.providerRequestId} is null or ${t.providerRequestId} ~ '^sha256:[0-9a-f]{64}$'))`,
    ),
  ],
);
export const testExpertOutcomes = pgTable(
  "test_expert_outcomes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => testExpertReservations.id),
    outcome: text("outcome").notNull(),
    providerRequestId: text("provider_request_id"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("test_expert_outcome_reservation_unique").on(
      t.reservationId,
      t.outcome,
    ),
    index("test_expert_outcomes_reservation_idx").on(
      t.reservationId,
      t.recordedAt,
    ),
    uniqueIndex("test_expert_outcomes_unknown_unique")
      .on(t.reservationId)
      .where(sql`${t.outcome}='unknown'`),
    uniqueIndex("test_expert_outcomes_terminal_unique")
      .on(t.reservationId)
      .where(sql`${t.outcome} in ('applied','not_applied')`),
    check(
      "test_expert_outcome_value_check",
      sql`${t.outcome} in ('unknown','applied','not_applied')`,
    ),
    check(
      "test_expert_outcome_provider_request_check",
      sql`(${t.outcome} in ('unknown','applied') and ${t.providerRequestId} ~ '^sha256:[0-9a-f]{64}$') or (${t.outcome}='not_applied' and (${t.providerRequestId} is null or ${t.providerRequestId} ~ '^sha256:[0-9a-f]{64}$'))`,
    ),
  ],
);
export const testExpertAuditEvents = pgTable(
  "test_expert_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    redemptionId: uuid("redemption_id")
      .notNull()
      .references(() => testExpertRedemptions.id),
    reservationId: uuid("reservation_id").references(
      () => testExpertReservations.id,
    ),
    eventType: text("event_type").notNull(),
    eventDigest: text("event_digest"),
    createdAt,
  },
  (t) => [
    index("test_expert_audit_redemption_idx").on(t.redemptionId, t.createdAt),
    check(
      "test_expert_audit_type_bounded",
      sql`char_length(${t.eventType}) between 1 and 64`,
    ),
    check(
      "test_expert_audit_digest_check",
      sql`${t.eventDigest} is null or ${t.eventDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
