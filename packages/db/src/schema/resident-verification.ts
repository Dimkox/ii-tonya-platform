import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
  primaryKey,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { users, channelIdentities } from "./identity.js";
import type { ResidentDraft } from "@ii-tonya/domain";
const at = (name: string) => timestamp(name, { withTimezone: true });
export const residentVerificationApplications = pgTable(
  "residents_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    botId: text("bot_id").notNull(),
    botKey: text("bot_key").notNull(),
    telegramId: text("telegram_user_id").notNull(),
    chatId: text("chat_id").notNull(),
    channelIdentityId: uuid("channel_identity_id").notNull(),
    motivationText: text("motivation_text").generatedAlwaysAs(
      sql`draft->>'motivation'`,
    ),
    educationRefsJson: jsonb("education_refs_json").generatedAlwaysAs(
      sql`draft->'education'`,
    ),
    propertyRefsJson: jsonb("property_refs_json").generatedAlwaysAs(
      sql`draft->'propertyEvidence'`,
    ),
    systemCheckResult: jsonb("system_check_result").notNull().default({
      education: "unknown",
      social: "pending",
      upload: "pending_upload",
    }),
    managerNotes: text("manager_notes"),
    currentField: text("current_field"),
    educationRequirement: text("education_requirement")
      .notNull()
      .default("unknown_manual_review"),
    roleType: text("role_type").generatedAlwaysAs(sql`draft->>'primaryRole'`),
    targetCategory: text("target_category").generatedAlwaysAs(
      sql`draft->>'category'`,
    ),
    taxStatus: text("tax_status").generatedAlwaysAs(sql`draft->>'tax'`),
    locationCity: text("location_city").generatedAlwaysAs(sql`draft->>'city'`),
    socialLinksJson: jsonb("social_links_json").generatedAlwaysAs(
      sql`resident_verification_social_projection(draft->'socialLinks')`,
    ),
    revision: integer("revision").notNull().default(0),
    formVersion: integer("form_version").notNull().default(1),
    policyVersion: text("policy_version")
      .notNull()
      .default("resident_education_unknown_v1"),
    draft: jsonb("draft").$type<ResidentDraft>().notNull().default({}),
    status: text("status").notNull().default("PENDING_DOCS"),
    progress: text("progress").notNull().default("FORM_FILLING"),
    submittedDraft: jsonb("submitted_draft").$type<ResidentDraft>(),
    submittedAt: at("submitted_at"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "resident_verification_submission",
      sql.raw(
        "submitted_at IS NULL AND submitted_draft IS NULL AND status = 'PENDING_DOCS'::text AND progress = 'FORM_FILLING'::text OR submitted_at IS NOT NULL AND isfinite(submitted_at) AND submitted_draft IS NOT NULL AND resident_verification_draft_valid(submitted_draft, true, education_requirement) AND status <> 'PENDING_DOCS'::text",
      ),
    ),
    check(
      "residents_applications_bot_id_check",
      sql.raw("bot_id ~ '^[1-9][0-9]{0,15}$'::text"),
    ),
    check(
      "residents_applications_bot_key_check",
      sql.raw("length(bot_key) >= 1 AND length(bot_key) <= 128"),
    ),
    check(
      "residents_applications_check",
      sql.raw("chat_id = telegram_user_id"),
    ),
    check(
      "residents_applications_current_field_check",
      sql.raw(
        "current_field = ANY (ARRAY['roles'::text, 'primaryRole'::text, 'category'::text, 'tax'::text, 'city'::text, 'socialLinks'::text, 'motivation'::text, 'specialization'::text, 'averageCheckMinor'::text, 'education'::text, 'propertyEvidence'::text, 'capacity'::text, 'amenities'::text, 'path'::text, 'cases'::text])",
      ),
    ),
    check(
      "residents_applications_education_requirement_check",
      sql.raw(
        "education_requirement = ANY (ARRAY['required'::text, 'optional'::text, 'unknown_manual_review'::text])",
      ),
    ),
    check(
      "residents_applications_form_version_check",
      sql.raw("form_version = 1"),
    ),
    check(
      "residents_applications_manager_notes_check",
      sql.raw("manager_notes IS NULL"),
    ),
    check(
      "residents_applications_policy_version_check",
      sql.raw("policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'::text"),
    ),
    check(
      "residents_applications_progress_check",
      sql.raw(
        "progress = ANY (ARRAY['NONE'::text, 'FORM_FILLING'::text, 'AUTO_CHECK'::text, 'MANAGER_REVIEW'::text, 'DONE'::text])",
      ),
    ),
    check("residents_applications_revision_check", sql.raw("revision >= 0")),
    check(
      "residents_applications_status_check",
      sql.raw(
        "status = ANY (ARRAY['PENDING_DOCS'::text, 'UNDER_REVIEW'::text, 'INFO_REQUESTED'::text, 'APPROVED_BASIC'::text, 'APPROVED_EXCLUSIVE'::text, 'REJECTED'::text])",
      ),
    ),
    check(
      "residents_applications_system_check_result_check",
      sql.raw(
        'system_check_result = \'{"social": "pending", "upload": "pending_upload", "education": "unknown"}\'::jsonb',
      ),
    ),
    check(
      "residents_applications_telegram_user_id_check",
      sql.raw("telegram_user_id ~ '^[1-9][0-9]{0,19}$'::text"),
    ),
    foreignKey({
      columns: [t.channelIdentityId, t.userId],
      foreignColumns: [channelIdentities.id, channelIdentities.userId],
    }),
    index("residents_application_role_status_idx").on(t.roleType, t.status),
    index("residents_application_telegram_idx").on(
      t.botId,
      t.botKey,
      t.telegramId,
    ),
    unique("residents_applications_id_user_id_key").on(t.id, t.userId),
    check(
      "residents_applications_draft_check",
      sql`resident_verification_draft_valid(${t.draft})`,
    ),
  ],
);
export const residentVerificationApplicationUpdates = pgTable(
  "resident_verification_application_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id").notNull(),
    userId: uuid("user_id").notNull(),
    revision: integer("revision").notNull(),
    kind: text("kind").notNull(),
    answers: jsonb("answers").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "resident_verification_followup_check",
      sql`kind<>'followup' OR resident_verification_followup_valid(answers)`,
    ),
    check(
      "resident_verification_application_updates_answers_check",
      sql.raw(
        "jsonb_typeof(answers) = 'object'::text AND octet_length(answers::text) <= 100000",
      ),
    ),
    check(
      "resident_verification_application_updates_kind_check",
      sql.raw(
        "kind = ANY (ARRAY['patch'::text, 'submit'::text, 'followup'::text, 'question'::text])",
      ),
    ),
    check(
      "resident_verification_application_updates_revision_check",
      sql.raw("revision > 0"),
    ),
    foreignKey({
      columns: [t.applicationId, t.userId],
      foreignColumns: [
        residentVerificationApplications.id,
        residentVerificationApplications.userId,
      ],
    }).onDelete("cascade"),
    unique(
      "resident_verification_application_updates_application_id_revision_key",
    ).on(t.applicationId, t.revision),
  ],
);
export const residentVerificationCheckWork = pgTable(
  "resident_verification_check_work",
  {
    applicationId: uuid("application_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    submittedRevision: integer("submitted_revision").notNull(),
    status: text("status").notNull().default("pending"),
    educationResult: text("education_result").notNull().default("unknown"),
    socialResult: text("social_result").notNull().default("pending"),
    uploadState: text("upload_state").notNull().default("pending_upload"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "resident_verification_check_work_education_result_check",
      sql.raw("education_result = 'unknown'::text"),
    ),
    check(
      "resident_verification_check_work_social_result_check",
      sql.raw("social_result = 'pending'::text"),
    ),
    check(
      "resident_verification_check_work_status_check",
      sql.raw("status = ANY (ARRAY['pending'::text, 'cancelled'::text])"),
    ),
    check(
      "resident_verification_check_work_submitted_revision_check",
      sql.raw("submitted_revision > 0"),
    ),
    check(
      "resident_verification_check_work_upload_state_check",
      sql.raw("upload_state = 'pending_upload'::text"),
    ),
    foreignKey({
      columns: [t.applicationId, t.userId],
      foreignColumns: [
        residentVerificationApplications.id,
        residentVerificationApplications.userId,
      ],
    }).onDelete("cascade"),
  ],
);
export const residentVerificationRequests = pgTable(
  "resident_verification_requests",
  {
    botId: text("bot_id").notNull(),
    botKey: text("bot_key").notNull(),
    requestKey: text("request_key").notNull(),
    userId: uuid("user_id").references(() => users.id),
    requestDigest: text("request_digest"),
    operation: text("operation").notNull(),
    result: jsonb("result"),
    erasedAt: at("erased_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("resident_verification_requests_subject_idx")
      .on(t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    check(
      "resident_verification_request_erasure",
      sql.raw(
        "user_id IS NOT NULL AND request_digest ~ '^[0-9a-f]{64}$'::text AND request_digest IS NOT NULL AND result IS NOT NULL AND erased_at IS NULL OR user_id IS NULL AND request_digest IS NULL AND result IS NULL AND erased_at IS NOT NULL",
      ),
    ),
    check(
      "resident_verification_requests_operation_check",
      sql.raw(
        "operation = ANY (ARRAY['start'::text, 'patch'::text, 'submit'::text, 'followup'::text, 'question'::text])",
      ),
    ),
    check(
      "resident_verification_requests_request_key_check",
      sql.raw("length(request_key) >= 1 AND length(request_key) <= 200"),
    ),
    primaryKey({ columns: [t.botId, t.botKey, t.requestKey] }),
  ],
);

export const residentVerificationCohorts = pgTable(
  "resident_verification_cohorts",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id),
    enrolledAt: at("enrolled_at").notNull().defaultNow(),
  },
);
