import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { adminSessions } from "./audit.js";
import { expertOnboardingApplications } from "./expert-onboarding.js";
import type {
  ProfessionalCard,
  ExpertCardMaterialPayload,
} from "../repositories/expert-card-repository.js";
const time = (name: string) => timestamp(name, { withTimezone: true });
const created = () => time("created_at").notNull().defaultNow();
const approvedReviewColumn = (): AnyPgColumn => expertCardReviews.id;
export const expertCardDrafts = pgTable(
  "expert_card_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id),
    revision: integer("revision").notNull().default(0),
    status: text("status").notNull().default("collecting"),
    semanticTags: jsonb("semantic_tags")
      .$type<string[]>()
      .notNull()
      .default([]),
    tagPreview: jsonb("tag_preview"),
    initialSchedule: jsonb("initial_schedule"),
    richMode: boolean("rich_mode").notNull().default(false),
    richProfile:
      jsonb("rich_profile").$type<import("@ii-tonya/contracts").RichProfile>(),
    richGuided: jsonb("rich_guided")
      .notNull()
      .default(sql`'{}'::jsonb`),
    richPendingServices: jsonb("rich_pending_services")
      .notNull()
      .default(sql`'[]'::jsonb`),
    richProposal:
      jsonb("rich_proposal").$type<
        import("@ii-tonya/contracts").RichProposal
      >(),
    ownerConfirmedDigest: text("owner_confirmed_digest"),
    previewPage: integer("preview_page"),
    previewTokenDigest: text("preview_token_digest"),
    previewContentDigest: text("preview_content_digest"),
    assistanceRequestedAt: time("assistance_requested_at"),
    assistanceRevision: integer("assistance_revision"),
    assistanceResolvedAt: time("assistance_resolved_at"),
    inputMode: text("input_mode").notNull().default("INTERVIEW"),
    documentImportRevision: integer("document_import_revision"),
    documentProposal: jsonb("document_proposal").$type<{
      source: "pdf" | "docx";
      content: string;
    }>(),
    publicPayload: jsonb("public_payload").$type<ProfessionalCard>(),
    approvedReviewId: uuid("approved_review_id"),
    messagingPolicyVersion: text("messaging_policy_version").notNull(),
    workBotId: text("work_bot_id").notNull(),
    workBotKey: text("work_bot_key").notNull(),
    workChatId: text("work_chat_id").notNull(),
    createdAt: created(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "resident_rich_pending_services_shape",
      sql`jsonb_typeof(rich_pending_services)='array' AND jsonb_array_length(rich_pending_services)<=8 AND octet_length(rich_pending_services::text)<=95000`,
    ),
    check(
      "expert_card_drafts_rich_guided_check",
      sql`jsonb_typeof(rich_guided)='object' AND octet_length(rich_guided::text)<=16000`,
    ),
    check(
      "resident_rich_shape",
      sql`coalesce((NOT rich_mode AND rich_profile IS NULL AND rich_proposal IS NULL) OR (rich_mode AND resident_rich_profile_valid(rich_profile)),false)`,
    ),
    check(
      "expert_card_input_mode",
      sql`coalesce((document_import_revision IS NULL OR document_import_revision BETWEEN 1 AND revision) AND input_mode IN ('INTERVIEW','DOCUMENT_PROPOSAL') AND ((input_mode='INTERVIEW' AND document_proposal IS NULL) OR (input_mode='DOCUMENT_PROPOSAL' AND jsonb_typeof(document_proposal)='object' AND jsonb_typeof(document_proposal->'source')='string' AND jsonb_typeof(document_proposal->'content')='string' AND document_proposal ?& ARRAY['source','content'] AND (document_proposal-'source'-'content')='{}'::jsonb AND document_proposal->>'source' IN ('pdf','docx') AND length(btrim(document_proposal->>'content'))>=50 AND octet_length(document_proposal::text)<=100000)),false)`,
    ),
    unique("expert_card_draft_owner").on(t.id, t.userId),
    // SQL0054 makes this circular review FK DEFERRABLE INITIALLY DEFERRED.
    // Drizzle cannot express the flags; the SQL catalogue retains them.
    foreignKey({
      name: "expert_card_draft_approved_review_fk",
      columns: [t.approvedReviewId],
      foreignColumns: [approvedReviewColumn()],
    }),
    foreignKey({
      name: "expert_card_draft_application_owner_fk",
      columns: [t.applicationId, t.userId],
      foreignColumns: [
        expertOnboardingApplications.id,
        expertOnboardingApplications.userId,
      ],
    }).onDelete("cascade"),
    check(
      "expert_card_draft_revision",
      sql`coalesce((${t.revision} BETWEEN 0 AND 1000000),false)`,
    ),
    check(
      "expert_card_draft_status",
      sql`coalesce((${t.status} IN ('collecting','manager_review','changes_requested','approved')),false)`,
    ),
    check(
      "expert_card_draft_public",
      sql`coalesce((${t.publicPayload} IS NULL OR expert_card_public_payload_valid(${t.publicPayload})),false)`,
    ),
    check(
      "expert_card_draft_approval",
      sql`coalesce(((${t.status}='approved')=(${t.approvedReviewId} IS NOT NULL)),false)`,
    ),
    check(
      "expert_card_draft_scope",
      sql`coalesce((${t.workBotId} ~ '^[1-9][0-9]{0,19}$' AND ${t.workChatId} ~ '^[1-9][0-9]{0,19}$' AND length(${t.workBotKey}) BETWEEN 1 AND 128),false)`,
    ),
  ],
);
export const expertCardEntries = pgTable(
  "expert_card_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    draftId: uuid("draft_id").notNull(),
    userId: uuid("user_id").notNull(),
    revision: integer("revision").notNull(),
    kind: text("kind").notNull(),
    textContent: text("text_content"),
    mediaReference: text("media_reference"),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      name: "expert_card_entry_owner",
      columns: [t.draftId, t.userId],
      foreignColumns: [expertCardDrafts.id, expertCardDrafts.userId],
    }).onDelete("cascade"),
    check(
      "expert_card_entry_value",
      sql`coalesce((${t.kind}='text' AND char_length(${t.textContent}) BETWEEN 1 AND 4000 AND ${t.mediaReference} IS NULL) OR (${t.kind} IN ('photo','document') AND ${t.textContent} IS NULL AND ${t.mediaReference} IS NOT NULL AND char_length(${t.mediaReference}) BETWEEN 15 AND 526 AND ${t.mediaReference} ~ '^telegram:file:[A-Za-z0-9_-]+$'),false)`,
    ),
    check(
      "expert_card_entry_revision",
      sql`coalesce((${t.revision} BETWEEN 1 AND 1000000),false)`,
    ),
  ],
);
export const expertCardReviews = pgTable(
  "expert_card_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    draftId: uuid("draft_id").notNull(),
    userId: uuid("user_id").notNull(),
    revision: integer("revision").notNull(),
    action: text("action").notNull(),
    publicPayload: jsonb("public_payload").$type<ProfessionalCard>(),
    publicDigest: text("public_digest"),
    safetyProof: jsonb("safety_proof"),
    warningAcknowledgment: text("warning_acknowledgment"),
    returnReason: text("return_reason"),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id),
    managerSessionHash: text("manager_session_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      name: "expert_card_review_owner",
      columns: [t.draftId, t.userId],
      foreignColumns: [expertCardDrafts.id, expertCardDrafts.userId],
    }).onDelete("cascade"),
    unique("expert_card_review_once").on(t.draftId, t.revision, t.action),
    unique("expert_card_review_public_identity").on(
      t.id,
      t.userId,
      t.revision,
      t.publicDigest,
    ),
    check(
      "expert_card_review_value",
      sql`coalesce((${t.action}='approve' AND expert_card_public_payload_valid(${t.publicPayload}) AND ${t.publicDigest}='sha256:'||encode(digest(${t.publicPayload}::text,'sha256'),'hex')) OR (${t.action}='return_changes' AND ${t.publicPayload} IS NULL AND ${t.publicDigest} IS NULL),false)`,
    ),
  ],
);
export const expertCardMaterialTemplates = pgTable(
  "expert_card_material_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentVersion: text("content_version").notNull().unique(),
    status: text("status").notNull().default("inactive"),
    contentSlot: text("content_slot")
      .notNull()
      .default("TODO: Wait for Content Spec"),
    textBody: text("text_body"),
    assets: jsonb("assets")
      .$type<ExpertCardMaterialPayload["assets"]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: created(),
  },
  (t) => [
    unique("expert_card_template_identity").on(t.id, t.contentVersion),
    check(
      "expert_card_template_value",
      sql`coalesce((length(${t.contentVersion}) BETWEEN 1 AND 128 AND jsonb_typeof(${t.assets})='array' AND jsonb_array_length(${t.assets})<=8 AND ((${t.status}='inactive' AND ${t.textBody} IS NULL) OR (${t.status}='approved' AND char_length(${t.textBody}) BETWEEN 1 AND 4000))),false)`,
    ),
  ],
);
export const expertCardMaterialJobs = pgTable(
  "expert_card_material_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    draftId: uuid("draft_id").notNull(),
    userId: uuid("user_id").notNull(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => expertCardReviews.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    templateId: uuid("template_id"),
    contentVersion: text("content_version"),
    attemptId: uuid("attempt_id"),
    attemptStartedAt: time("attempt_started_at"),
    expectedMessageCount: integer("expected_message_count"),
    status: text("status").notNull().default("waiting_content"),
    deliveryReceipt: jsonb("delivery_receipt"),
    payloadDigest: text("payload_digest"),
    deliveredAt: time("delivered_at"),
    targetBotId: text("target_bot_id").notNull(),
    targetChatId: text("target_chat_id").notNull(),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      name: "expert_card_material_owner",
      columns: [t.draftId, t.userId],
      foreignColumns: [expertCardDrafts.id, expertCardDrafts.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "expert_card_material_template",
      columns: [t.templateId, t.contentVersion],
      foreignColumns: [
        expertCardMaterialTemplates.id,
        expertCardMaterialTemplates.contentVersion,
      ],
    }),
    unique("expert_card_material_once").on(t.reviewId),
    check(
      "expert_card_material_status",
      sql`coalesce((${t.status} IN ('waiting_content','pending','delivered','cancelled','unknown_outcome')),false)`,
    ),
    check(
      "expert_card_material_attempt",
      sql`coalesce(((${t.attemptId} IS NULL AND ${t.attemptStartedAt} IS NULL) OR (${t.attemptId} IS NOT NULL AND ${t.attemptStartedAt} IS NOT NULL AND isfinite(${t.attemptStartedAt}))),false)`,
    ),
    check(
      "expert_card_material_receipt",
      sql`coalesce(((${t.status}='delivered' AND ${t.templateId} IS NOT NULL AND ${t.contentVersion} IS NOT NULL AND ${t.deliveredAt} IS NOT NULL AND isfinite(${t.deliveredAt}) AND ${t.attemptId} IS NOT NULL AND ${t.payloadDigest} IS NOT NULL AND ${t.payloadDigest} ~ '^sha256:[0-9a-f]{64}$' AND expert_card_delivery_receipt_valid(${t.deliveryReceipt},${t.targetBotId},${t.targetChatId},${t.contentVersion},${t.payloadDigest},${t.expectedMessageCount})) OR (${t.status}<>'delivered' AND ${t.deliveryReceipt} IS NULL AND ${t.deliveredAt} IS NULL)),false)`,
    ),
  ],
);
export const expertCardPromoProofs = pgTable(
  "expert_card_promo_proofs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    draftId: uuid("draft_id").notNull(),
    userId: uuid("user_id").notNull(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => expertCardReviews.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    kind: text("kind").notNull(),
    reference: text("reference").notNull(),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      name: "expert_card_proof_owner",
      columns: [t.draftId, t.userId],
      foreignColumns: [expertCardDrafts.id, expertCardDrafts.userId],
    }).onDelete("cascade"),
    check(
      "expert_card_proof_value",
      sql`coalesce(((${t.kind}='link' AND length(${t.reference}) BETWEEN 1 AND 2048 AND ${t.reference} LIKE 'https://%') OR (${t.kind} IN ('photo','document') AND ${t.reference} IS NOT NULL AND char_length(${t.reference}) BETWEEN 15 AND 526 AND ${t.reference} ~ '^telegram:file:[A-Za-z0-9_-]+$')),false)`,
    ),
  ],
);
export const expertCardPromoConfirmations = pgTable(
  "expert_card_promo_confirmations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    draftId: uuid("draft_id").notNull(),
    userId: uuid("user_id").notNull(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => expertCardReviews.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    proofDigest: text("proof_digest").notNull(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id),
    managerSessionHash: text("manager_session_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      name: "expert_card_promo_owner",
      columns: [t.draftId, t.userId],
      foreignColumns: [expertCardDrafts.id, expertCardDrafts.userId],
    }).onDelete("cascade"),
    unique("expert_card_promo_once").on(t.reviewId, t.proofDigest),
    check(
      "expert_card_promo_digest",
      sql`coalesce((${t.proofDigest} ~ '^sha256:[0-9a-f]{64}$'),false)`,
    ),
  ],
);
export const expertCardHandoffs = pgTable(
  "expert_card_handoffs",
  {
    tokenDigest: text("token_digest").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => expertOnboardingApplications.id, {
        onDelete: "cascade",
      }),
    sourceBotKey: text("source_bot_key").notNull(),
    externalId: text("external_id").notNull(),
    targetBotId: text("target_bot_id").notNull(),
    targetBotKey: text("target_bot_key").notNull(),
    expiresAt: time("expires_at")
      .notNull()
      .default(sql`now()+interval '10 minutes'`),
    consumedAt: time("consumed_at"),
    createdAt: created(),
  },
  (t) => [
    check(
      "expert_card_handoff_digest",
      sql`coalesce((${t.tokenDigest} ~ '^sha256:[0-9a-f]{64}$'),false)`,
    ),
    check(
      "expert_card_handoff_scope",
      sql`coalesce((${t.externalId} ~ '^[1-9][0-9]{0,19}$' AND ${t.targetBotId} ~ '^[1-9][0-9]{0,19}$'),false)`,
    ),
    check(
      "expert_card_handoff_time",
      sql`coalesce((isfinite(${t.expiresAt}) AND ${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+interval '10 minutes' AND (${t.consumedAt} IS NULL OR isfinite(${t.consumedAt}))),false)`,
    ),
  ],
);
export const expertCardRequests = pgTable(
  "expert_card_requests",
  {
    botId: text("bot_id").notNull(),
    updateId: text("update_id").notNull(),
    userId: uuid("user_id").references(() => users.id),
    operation: text("operation").notNull(),
    requestDigest: text("request_digest"),
    semanticDigest: text("semantic_digest"),
    resultId: uuid("result_id"),
    erasedAt: time("erased_at"),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.botId, t.updateId] }),
    check(
      "expert_card_request_scope",
      sql`coalesce((${t.botId} ~ '^[1-9][0-9]{0,19}$' AND ${t.updateId} ~ '^(0|[1-9][0-9]{0,19})$'),false)`,
    ),
    check(
      "expert_card_request_digests",
      sql`coalesce(((${t.userId} IS NOT NULL AND ${t.requestDigest} ~ '^[0-9a-f]{64}$' AND ${t.semanticDigest} ~ '^[0-9a-f]{64}$' AND ${t.erasedAt} IS NULL) OR (${t.userId} IS NULL AND ${t.requestDigest} IS NULL AND ${t.semanticDigest} IS NULL AND ${t.resultId} IS NULL AND ${t.erasedAt} IS NOT NULL)),false)`,
    ),
    check(
      "expert_card_request_operation",
      sql`coalesce((${t.operation} IN ('entry','submit','promo_proof','handoff_issue','handoff_redeem','main_quote','main_accept','main_checkout','residency_pause','residency_resume','tags_toggle')),false)`,
    ),
  ],
);
export const expertCardStaffActions = pgTable(
  "expert_card_staff_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => expertCardDrafts.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    semanticDigest: text("semantic_digest").notNull(),
    resultId: uuid("result_id"),
    createdAt: created(),
  },
  (t) => [
    unique("expert_card_staff_request").on(t.managerId, t.idempotencyKey),
    check(
      "expert_card_staff_value",
      sql`coalesce((${t.operation} IN ('edit_public','approve','return_changes','confirm_promo') AND ${t.semanticDigest} ~ '^[0-9a-f]{64}$' AND ${t.idempotencyKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),false)`,
    ),
  ],
);

// Updating this singleton makes concurrent consent-document publication visible
// to SERIALIZABLE activation transactions through PostgreSQL's conflict checks.
export const expertCardConsentEpoch = pgTable(
  "expert_card_consent_epoch",
  {
    id: integer("id").primaryKey().default(1),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (t) => [
    check(
      "expert_card_consent_epoch_singleton",
      sql`coalesce(${t.id}=1 AND ${t.revision}>0,false)`,
    ),
  ],
);
