import {
  pgTable,
  index,
  check,
  primaryKey,
  foreignKey,
  unique,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { adminSessions } from "./audit.js";
import { expertCampaignQuotes } from "./expert-campaign-quotes.js";
import { expertCardMainAcceptances } from "./expert-card-payments.js";
import { expertCardMaterialTemplates } from "./expert-cards.js";
import { expertCardReviews } from "./expert-cards.js";
import { expertOnboardingApplications } from "./expert-onboarding.js";
import { expertResidencyOrders } from "./expert-residency.js";
import { expertResidencyProviderEventInbox } from "./expert-residency.js";
import { expertResidencyTariffVersions } from "./expert-residency.js";
import { experts } from "./catalog.js";
import { users } from "./identity.js";

export const expertOfferSchedules = pgTable(
  "expert_offer_schedules",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    applicationId: uuid("application_id"),
    applicationAuditId: uuid("application_audit_id").notNull(),
    tariffVersionId: uuid("tariff_version_id").notNull(),
    profileRevision: integer("profile_revision").notNull(),
    termMonths: integer("term_months").notNull(),
    sourceUpdateId: text("source_update_id").notNull(),
    consentVersion: text("consent_version").notNull(),
    originalAcceptanceId: uuid("original_acceptance_id").notNull(),
    revision: integer().notNull(),
    originalQuoteId: uuid("original_quote_id").notNull(),
    reviewId: uuid("review_id"),
    reviewAuditId: uuid("review_audit_id").notNull(),
    expertId: uuid("expert_id").notNull(),
    publicDigest: text("public_digest").notNull(),
    botId: text("bot_id"),
    botKey: text("bot_key"),
    chatId: text("chat_id"),
    requestKey: text("request_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "expert_offer_schedules_user_id_fkey",
    }),
    foreignKey({
      columns: [table.applicationId],
      foreignColumns: [expertOnboardingApplications.id],
      name: "expert_offer_schedules_application_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.tariffVersionId],
      foreignColumns: [expertResidencyTariffVersions.id],
      name: "expert_offer_schedules_tariff_version_id_fkey",
    }),
    foreignKey({
      columns: [table.originalAcceptanceId],
      foreignColumns: [expertCardMainAcceptances.id],
      name: "expert_offer_schedules_original_acceptance_id_fkey",
    }),
    foreignKey({
      columns: [table.originalQuoteId],
      foreignColumns: [expertCampaignQuotes.id],
      name: "expert_offer_schedules_original_quote_id_fkey",
    }),
    foreignKey({
      columns: [table.reviewId],
      foreignColumns: [expertCardReviews.id],
      name: "expert_offer_schedules_review_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.expertId],
      foreignColumns: [experts.id],
      name: "expert_offer_schedules_expert_id_fkey",
    }),
    foreignKey({
      columns: [table.userId, table.profileRevision],
      foreignColumns: [
        expertOfferProfiles.userId,
        expertOfferProfiles.revision,
      ],
      name: "expert_offer_schedules_user_id_profile_revision_fkey",
    }),
    unique("expert_offer_schedules_user_id_source_update_id_key").on(
      table.userId,
      table.sourceUpdateId,
    ),
    check(
      "expert_offer_schedules_term_months_check",
      sql`term_months = ANY (ARRAY[1, 3])`,
    ),
    check("expert_offer_schedules_revision_check", sql`revision > 0`),
  ],
);

export const expertPersonalOfferState = pgTable(
  "expert_personal_offer_state",
  {
    userId: uuid("user_id").primaryKey().notNull(),
    quoteId: uuid("quote_id").notNull(),
    scheduleId: uuid("schedule_id"),
    orderId: uuid("order_id"),
    paymentId: text("payment_id"),
    paymentUrl: text("payment_url"),
    refreshedAt: timestamp("refreshed_at", {
      withTimezone: true,
      mode: "string",
    })
      .default(sql`clock_timestamp()`)
      .notNull(),
    nextRefreshAt: timestamp("next_refresh_at", {
      withTimezone: true,
      mode: "string",
    })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    index("expert_personal_offer_refresh_due").using(
      "btree",
      table.nextRefreshAt.asc().nullsLast().op("timestamptz_ops"),
    ),
    foreignKey({
      columns: [table.scheduleId],
      foreignColumns: [expertOfferSchedules.id],
      name: "expert_personal_offer_state_schedule_id_fkey",
    }),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [expertResidencyOrders.id],
      name: "expert_personal_offer_state_order_id_fkey",
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "expert_personal_offer_state_user_id_fkey",
    }),
    foreignKey({
      columns: [table.quoteId],
      foreignColumns: [expertCampaignQuotes.id],
      name: "expert_personal_offer_state_quote_id_fkey",
    }),
  ],
);

export const expertPersonalOfferNotices = pgTable(
  "expert_personal_offer_notices",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    quoteId: uuid("quote_id").notNull(),
    stageDeadline: timestamp("stage_deadline", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    leadHours: integer("lead_hours").notNull(),
    status: text().default("pending").notNull(),
    attemptId: uuid("attempt_id"),
    attemptedAt: timestamp("attempted_at", {
      withTimezone: true,
      mode: "string",
    }),
    receipt: jsonb(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    index("expert_personal_offer_notice_pending")
      .using(
        "btree",
        table.stageDeadline.asc().nullsLast().op("timestamptz_ops"),
      )
      .where(sql`(status = 'pending'::text)`),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "expert_personal_offer_notices_user_id_fkey",
    }),
    foreignKey({
      columns: [table.quoteId],
      foreignColumns: [expertCampaignQuotes.id],
      name: "expert_personal_offer_notices_quote_id_fkey",
    }),
    unique(
      "expert_personal_offer_notices_user_id_stage_deadline_lead_h_key",
    ).on(table.userId, table.stageDeadline, table.leadHours),
    check(
      "expert_personal_offer_notices_lead_hours_check",
      sql`lead_hours = ANY (ARRAY[24, 3, 0])`,
    ),
    check(
      "expert_personal_offer_notices_status_check",
      sql`status = ANY (ARRAY['pending'::text, 'unknown_outcome'::text, 'delivered'::text, 'cancelled'::text])`,
    ),
  ],
);

export const expertManagerTelegramPairings = pgTable(
  "expert_manager_telegram_pairings",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    tokenHash: text("token_hash").notNull(),
    sessionHash: text("session_hash").notNull(),
    botId: text("bot_id").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    telegramUserId: text("telegram_user_id"),
    telegramChatId: text("telegram_chat_id"),
    pairedAt: timestamp("paired_at", { withTimezone: true, mode: "string" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sessionHash],
      foreignColumns: [adminSessions.sessionIdHash],
      name: "expert_manager_telegram_pairings_session_hash_fkey",
    }),
    unique("expert_manager_telegram_pairings_token_hash_key").on(
      table.tokenHash,
    ),
    check(
      "expert_manager_telegram_pairings_expires_at_check",
      sql`CHECK (isfinite(expires_at`,
    ),
    check(
      "expert_manager_telegram_pairings_check",
      sql`((telegram_user_id IS NULL) AND (telegram_chat_id IS NULL) AND (paired_at IS NULL)) OR ((telegram_user_id IS NOT NULL) AND (telegram_chat_id IS NOT NULL) AND (paired_at IS NOT NULL))`,
    ),
  ],
);

export const expertManagerTelegramCallbacks = pgTable(
  "expert_manager_telegram_callbacks",
  {
    profileRevision: integer("profile_revision"),
    id: uuid().defaultRandom().primaryKey().notNull(),
    pairingId: uuid("pairing_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    decision: text().notNull(),
    nonceHash: text("nonce_hash").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.pairingId],
      foreignColumns: [expertManagerTelegramPairings.id],
      name: "expert_manager_telegram_callbacks_pairing_id_fkey",
    }),
    foreignKey({
      columns: [table.applicationId],
      foreignColumns: [expertOnboardingApplications.id],
      name: "expert_manager_telegram_callbacks_application_id_fkey",
    }).onDelete("cascade"),
    unique("expert_manager_telegram_callbacks_nonce_hash_key").on(
      table.nonceHash,
    ),
    check(
      "expert_manager_telegram_callbacks_decision_check",
      sql`decision = ANY (ARRAY['approved'::text, 'rejected'::text])`,
    ),
    check(
      "expert_manager_telegram_callbacks_expires_at_check",
      sql`CHECK (isfinite(expires_at`,
    ),
  ],
);

export const expertManagerTelegramNotifications = pgTable(
  "expert_manager_telegram_notifications",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    pairingId: uuid("pairing_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    status: text().default("pending").notNull(),
    leaseUntil: timestamp("lease_until", {
      withTimezone: true,
      mode: "string",
    }),
    fence: uuid(),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    foreignKey({
      columns: [table.pairingId],
      foreignColumns: [expertManagerTelegramPairings.id],
      name: "expert_manager_telegram_notifications_pairing_id_fkey",
    }),
    foreignKey({
      columns: [table.applicationId],
      foreignColumns: [expertOnboardingApplications.id],
      name: "expert_manager_telegram_notifications_application_id_fkey",
    }).onDelete("cascade"),
    unique(
      "expert_manager_telegram_notificat_pairing_id_application_id_key",
    ).on(table.pairingId, table.applicationId),
    check(
      "expert_manager_telegram_notifications_status_check",
      sql`status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text])`,
    ),
  ],
);

export const expertApplicationPromoConfirmations = pgTable(
  "expert_application_promo_confirmations",
  {
    id: uuid().defaultRandom().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    applicationId: uuid("application_id").primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    proofDigest: text("proof_digest").notNull(),
    managerId: uuid("manager_id").notNull(),
    sessionHash: text("session_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.applicationId],
      foreignColumns: [expertOnboardingApplications.id],
      name: "expert_application_promo_confirmations_application_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "expert_application_promo_confirmations_user_id_fkey",
    }),
    foreignKey({
      columns: [table.managerId],
      foreignColumns: [users.id],
      name: "expert_application_promo_confirmations_manager_id_fkey",
    }),
    foreignKey({
      columns: [table.sessionHash],
      foreignColumns: [adminSessions.sessionIdHash],
      name: "expert_application_promo_confirmations_session_hash_fkey",
    }),
    foreignKey({
      columns: [table.applicationId, table.userId],
      foreignColumns: [
        expertOnboardingApplications.id,
        expertOnboardingApplications.userId,
      ],
      name: "expert_application_confirmation_owner_fk",
    }).onDelete("cascade"),
    unique("expert_application_promo_confirmations_id_key").on(table.id),
    unique(
      "expert_application_promo_confirm_manager_id_idempotency_key_key",
    ).on(table.idempotencyKey, table.managerId),
  ],
);

export const expertPromoReadyLogs = pgTable(
  "expert_promo_ready_logs",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    event: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  () => [
    check(
      "expert_promo_ready_logs_event_check",
      sql`event = 'Ready to send'::text`,
    ),
  ],
);

export const expertSpaceTariffApprovals = pgTable(
  "expert_space_tariff_approvals",
  {
    tariffVersionId: uuid("tariff_version_id").primaryKey().notNull(),
    managerId: uuid("manager_id").notNull(),
    sessionHash: text("session_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tariffVersionId],
      foreignColumns: [expertResidencyTariffVersions.id],
      name: "expert_space_tariff_approvals_tariff_version_id_fkey",
    }),
    foreignKey({
      columns: [table.managerId],
      foreignColumns: [users.id],
      name: "expert_space_tariff_approvals_manager_id_fkey",
    }),
    foreignKey({
      columns: [table.sessionHash],
      foreignColumns: [adminSessions.sessionIdHash],
      name: "expert_space_tariff_approvals_session_hash_fkey",
    }),
  ],
);

export const expertApplicationMaterialJobs = pgTable(
  "expert_application_material_jobs",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    applicationId: uuid("application_id").notNull(),
    userId: uuid("user_id").notNull(),
    status: text().default("waiting_content").notNull(),
    targetBotId: text("target_bot_id"),
    targetBotKey: text("target_bot_key"),
    targetChatId: text("target_chat_id"),
    templateId: uuid("template_id"),
    contentVersion: text("content_version"),
    payloadDigest: text("payload_digest"),
    deliveryReceipt: jsonb("delivery_receipt"),
    attemptId: uuid("attempt_id"),
    expectedMessageCount: integer("expected_message_count"),
    deliveredAt: timestamp("delivered_at", {
      withTimezone: true,
      mode: "string",
    }),
    attemptStartedAt: timestamp("attempt_started_at", {
      withTimezone: true,
      mode: "string",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.applicationId],
      foreignColumns: [expertOnboardingApplications.id],
      name: "expert_application_material_jobs_application_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "expert_application_material_jobs_user_id_fkey",
    }),
    foreignKey({
      columns: [table.templateId],
      foreignColumns: [expertCardMaterialTemplates.id],
      name: "expert_application_material_jobs_template_id_fkey",
    }),
    foreignKey({
      columns: [table.applicationId, table.userId],
      foreignColumns: [
        expertOnboardingApplications.id,
        expertOnboardingApplications.userId,
      ],
      name: "expert_application_material_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.templateId, table.contentVersion],
      foreignColumns: [
        expertCardMaterialTemplates.id,
        expertCardMaterialTemplates.contentVersion,
      ],
      name: "expert_application_material_template_fk",
    }),
    unique("expert_application_material_jobs_application_id_key").on(
      table.applicationId,
    ),
    check(
      "expert_application_material_jobs_status_check",
      sql`status = ANY (ARRAY['waiting_content'::text, 'pending'::text, 'delivered'::text, 'unknown_outcome'::text, 'cancelled'::text])`,
    ),
    check(
      "expert_application_material_attempt",
      sql`CHECK (COALESCE((((attempt_id IS NULL) AND (attempt_started_at IS NULL)) OR ((attempt_id IS NOT NULL) AND (attempt_started_at IS NOT NULL) AND isfinite(attempt_started_at))), false`,
    ),
    check(
      "expert_application_material_receipt",
      sql`CHECK (COALESCE((((status = 'delivered'::text) AND (template_id IS NOT NULL) AND (content_version IS NOT NULL) AND (delivered_at IS NOT NULL) AND isfinite(delivered_at) AND (attempt_id IS NOT NULL) AND (payload_digest IS NOT NULL) AND (payload_digest ~ '^sha256:[0-9a-f]{64}$'::text) AND expert_card_delivery_receipt_valid(delivery_receipt, target_bot_id, target_chat_id, content_version, payload_digest, expected_message_count)) OR ((status <> 'delivered'::text) AND (delivery_receipt IS NULL) AND (delivered_at IS NULL))), false`,
    ),
  ],
);

export const expertApplicationPromoProofs = pgTable(
  "expert_application_promo_proofs",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    applicationId: uuid("application_id").notNull(),
    userId: uuid("user_id").notNull(),
    kind: text().notNull(),
    reference: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.applicationId],
      foreignColumns: [expertOnboardingApplications.id],
      name: "expert_application_promo_proofs_application_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "expert_application_promo_proofs_user_id_fkey",
    }),
    foreignKey({
      columns: [table.applicationId, table.userId],
      foreignColumns: [
        expertOnboardingApplications.id,
        expertOnboardingApplications.userId,
      ],
      name: "expert_application_proof_owner_fk",
    }).onDelete("cascade"),
    check(
      "expert_application_promo_proofs_kind_check",
      sql`kind = ANY (ARRAY['link'::text, 'photo'::text, 'document'::text])`,
    ),
    check(
      "expert_application_proof_value",
      sql`CHECK (COALESCE((((kind = 'link'::text) AND ((length(reference) >= 1) AND (length(reference) <= 2048)) AND (reference ~~ 'https://%'::text)) OR ((kind = ANY (ARRAY['photo'::text, 'document'::text])) AND ((char_length(reference) >= 15) AND (char_length(reference) <= 526)) AND (reference ~ '^telegram:file:[A-Za-z0-9_-]+$'::text))), false`,
    ),
  ],
);

export const expertMainActivationAdmissions = pgTable(
  "expert_main_activation_admissions",
  {
    orderId: uuid("order_id").primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    expertId: uuid("expert_id").notNull(),
    quoteId: uuid("quote_id").notNull(),
    profileRevision: integer("profile_revision"),
    applicationAuditId: uuid("application_audit_id").notNull(),
    reviewAuditId: uuid("review_audit_id").notNull(),
    publicDigest: text("public_digest").notNull(),
    providerEventId: uuid("provider_event_id").notNull(),
    admittedAt: timestamp("admitted_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [expertResidencyOrders.id],
      name: "expert_main_activation_admissions_order_id_fkey",
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "expert_main_activation_admissions_user_id_fkey",
    }),
    foreignKey({
      columns: [table.expertId],
      foreignColumns: [experts.id],
      name: "expert_main_activation_admissions_expert_id_fkey",
    }),
    foreignKey({
      columns: [table.quoteId],
      foreignColumns: [expertCampaignQuotes.id],
      name: "expert_main_activation_admissions_quote_id_fkey",
    }),
    foreignKey({
      columns: [table.providerEventId],
      foreignColumns: [expertResidencyProviderEventInbox.id],
      name: "expert_main_activation_admissions_provider_event_id_fkey",
    }),
    foreignKey({
      columns: [table.userId, table.profileRevision],
      foreignColumns: [
        expertOfferProfiles.userId,
        expertOfferProfiles.revision,
      ],
      name: "expert_main_admission_profile_fk",
    }),
    unique("expert_main_activation_admissions_provider_event_id_key").on(
      table.providerEventId,
    ),
    check(
      "expert_main_activation_admissions_profile_revision_check",
      sql`profile_revision > 0`,
    ),
    check(
      "expert_main_activation_admissions_public_digest_check",
      sql`public_digest ~ '^sha256:[0-9a-f]{64}$'::text`,
    ),
    check(
      "expert_main_activation_admissions_admitted_at_check",
      sql`CHECK (isfinite(admitted_at`,
    ),
  ],
);

export const expertOfferProfileVerifications = pgTable(
  "expert_offer_profile_verifications",
  {
    userId: uuid("user_id").notNull(),
    profileRevision: integer("profile_revision").notNull(),
    managerId: uuid("manager_id").notNull(),
    sessionHash: text("session_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.managerId],
      foreignColumns: [users.id],
      name: "expert_offer_profile_verifications_manager_id_fkey",
    }),
    foreignKey({
      columns: [table.sessionHash],
      foreignColumns: [adminSessions.sessionIdHash],
      name: "expert_offer_profile_verifications_session_hash_fkey",
    }),
    foreignKey({
      columns: [table.userId, table.profileRevision],
      foreignColumns: [
        expertOfferProfiles.userId,
        expertOfferProfiles.revision,
      ],
      name: "expert_offer_profile_verification_user_id_profile_revision_fkey",
    }),
    primaryKey({
      columns: [table.userId, table.profileRevision],
      name: "expert_offer_profile_verifications_pkey",
    }),
  ],
);

export const expertOfferProfiles = pgTable(
  "expert_offer_profiles",
  {
    userId: uuid("user_id").notNull(),
    revision: integer().notNull(),
    cityCode: text("city_code").notNull(),
    millionCity: boolean("million_city").notNull(),
    serviceFormat: text("service_format").notNull(),
    ticketMinor: bigint("ticket_minor", { mode: "bigint" }).notNull(),
    participantKind: text("participant_kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "expert_offer_profiles_user_id_fkey",
    }),
    primaryKey({
      columns: [table.userId, table.revision],
      name: "expert_offer_profiles_pkey",
    }),
    unique("expert_offer_profiles_user_id_idempotency_key_key").on(
      table.userId,
      table.idempotencyKey,
    ),
    check("expert_offer_profiles_revision_check", sql`revision > 0`),
    check(
      "expert_offer_profiles_city_code_check",
      sql`(length(city_code) >= 1) AND (length(city_code) <= 100)`,
    ),
    check(
      "expert_offer_profiles_service_format_check",
      sql`service_format = ANY (ARRAY['online_only'::text, 'offline'::text, 'hybrid'::text])`,
    ),
    check("expert_offer_profiles_ticket_minor_check", sql`ticket_minor >= 0`),
    check(
      "expert_offer_profiles_participant_kind_check",
      sql`participant_kind = ANY (ARRAY['expert'::text, 'space'::text])`,
    ),
  ],
);
