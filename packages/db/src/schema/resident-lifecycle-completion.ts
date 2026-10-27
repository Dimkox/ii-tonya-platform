import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  check,
  foreignKey,
  index,
  uniqueIndex,
  unique,
} from "drizzle-orm/pg-core";
import { users, channelIdentities } from "./identity.js";
import { experts } from "./catalog.js";
import { expertResidencyOrders } from "./expert-residency.js";
import { expertCardDrafts, expertCardReviews } from "./expert-cards.js";
import { expertOnboardingApplications } from "./expert-onboarding.js";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const residentLifecycleSubjects = pgTable(
  "resident_lifecycle_subjects",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    expertId: uuid("expert_id")
      .unique()
      .references(() => experts.id),
    activationKind: text("activation_kind"),
    activationOrderId: uuid("activation_order_id").references(
      () => expertResidencyOrders.id,
    ),
    activatedAt: time("activated_at"),
    observedAt: time("observed_at"),
    firstMainInvoiceAt: time("first_main_invoice_at"),
    firstMainInvoiceOrderId: uuid("first_main_invoice_order_id").references(
      () => expertResidencyOrders.id,
    ),
    lastScannedAt: time("last_scanned_at")
      .notNull()
      .default(sql`'-infinity'`),
  },
  (t) => [
    foreignKey({
      name: "resident_lifecycle_subject_owner",
      columns: [t.expertId, t.userId],
      foreignColumns: [experts.id, experts.userId],
    }),
    index("resident_lifecycle_subject_scan").on(t.lastScannedAt, t.userId),
    check(
      "resident_first_main_invoice_shape",
      sql`(first_main_invoice_order_id IS NULL)=(first_main_invoice_at IS NULL) AND (first_main_invoice_at IS NULL OR isfinite(first_main_invoice_at))`,
    ),
    check(
      "resident_lifecycle_subjects_activation_kind_check",
      sql`activation_kind IN ('observed_baseline','first_projection')`,
    ),
    check(
      "resident_lifecycle_activation_shape",
      sql`coalesce((activation_kind IS NULL AND activation_order_id IS NULL AND activated_at IS NULL AND observed_at IS NULL) OR (activation_kind='observed_baseline' AND expert_id IS NOT NULL AND activation_order_id IS NULL AND activated_at IS NULL AND observed_at IS NOT NULL AND isfinite(observed_at)) OR (activation_kind='first_projection' AND expert_id IS NOT NULL AND activated_at IS NOT NULL AND isfinite(activated_at) AND observed_at IS NULL AND activation_order_id IS NOT NULL),false)`,
    ),
  ],
);
export const residentWorkNotices = pgTable(
  "resident_work_notices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => residentLifecycleSubjects.userId, {
        onDelete: "cascade",
      }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => expertCardDrafts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    reviewId: uuid("review_id").references(() => expertCardReviews.id, {
      onDelete: "cascade",
    }),
    state: text("state").notNull().default("pending"),
    targetBotId: text("target_bot_id").notNull(),
    targetBotKey: text("target_bot_key").notNull(),
    targetChatId: text("target_chat_id").notNull(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => channelIdentities.id, { onDelete: "cascade" }),
    consentAuthority: jsonb("consent_authority").notNull(),
    availableAt: time("available_at")
      .notNull()
      .default(sql`clock_timestamp()`),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptId: uuid("last_attempt_id"),
    createdAt: time("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({
      name: "resident_work_notice_owner",
      columns: [t.draftId, t.userId],
      foreignColumns: [expertCardDrafts.id, expertCardDrafts.userId],
    }).onDelete("cascade"),
    uniqueIndex("resident_work_notice_review_unique")
      .on(t.reviewId, t.kind)
      .where(sql`review_id IS NOT NULL`),
    uniqueIndex("resident_work_notice_activation_unique")
      .on(t.userId)
      .where(sql`kind='first_activation'`),
    index("resident_work_notice_due")
      .on(t.availableAt, t.id)
      .where(sql`state='pending'`),
    check(
      "resident_work_notices_kind_check",
      sql`kind IN ('card_approved','card_returned','first_activation')`,
    ),
    check(
      "resident_work_notices_state_check",
      sql`state IN ('pending','unknown','delivered','cancelled')`,
    ),
    check(
      "resident_work_notices_attempt_count_check",
      sql`attempt_count BETWEEN 0 AND 3`,
    ),
    check(
      "resident_work_notice_source",
      sql`(kind='first_activation')=(review_id IS NULL)`,
    ),
    check(
      "resident_work_notice_route",
      sql`target_bot_id ~ '^[1-9][0-9]{0,15}$' AND target_chat_id ~ '^[1-9][0-9]{0,15}$' AND length(target_bot_key) BETWEEN 1 AND 128`,
    ),
    check(
      "resident_work_notice_attempt",
      sql`(attempt_count=0)=(last_attempt_id IS NULL)`,
    ),
    check(
      "resident_work_notice_time",
      sql`isfinite(created_at) AND isfinite(available_at)`,
    ),
  ],
);
export const residentWorkNoticeAttempts = pgTable(
  "resident_work_notice_attempts",
  {
    id: uuid("id").primaryKey(),
    noticeId: uuid("notice_id")
      .notNull()
      .references(() => residentWorkNotices.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    state: text("state").notNull().default("unknown"),
    receipt: jsonb("receipt"),
    createdAt: time("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("resident_work_attempt_sequence").on(t.noticeId, t.sequence),
    unique("resident_work_attempt_owner").on(t.noticeId, t.id, t.sequence),
    check(
      "resident_work_notice_attempts_sequence_check",
      sql`sequence BETWEEN 1 AND 3`,
    ),
    check(
      "resident_work_notice_attempts_payload_digest_check",
      sql`payload_digest ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "resident_work_notice_attempts_state_check",
      sql`state IN ('unknown','not_applied','delivered','cancelled')`,
    ),
    check(
      "resident_work_attempt_receipt",
      sql`(state='delivered')=(receipt IS NOT NULL)`,
    ),
  ],
);
export const residentWorkBotState = pgTable(
  "resident_work_bot_state",
  {
    botKey: text("bot_key").primaryKey(),
    notBefore: time("not_before")
      .notNull()
      .default(sql`'-infinity'`),
    paused: boolean("paused").notNull().default(false),
  },
  () => [
    check(
      "resident_work_bot_state_bot_key_check",
      sql`length(bot_key) BETWEEN 1 AND 128`,
    ),
  ],
);
export const residentLifecycleCases = pgTable(
  "resident_lifecycle_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => residentLifecycleSubjects.userId, {
        onDelete: "cascade",
      }),
    applicationId: uuid("application_id").references(
      () => expertOnboardingApplications.id,
      { onDelete: "cascade" },
    ),
    kind: text("kind").notNull(),
    generation: text("generation").notNull(),
    status: text("status").notNull().default("open"),
    revision: integer("revision").notNull().default(0),
    dueAt: time("due_at"),
    windowStart: time("window_start"),
    windowEnd: time("window_end"),
    numerator: integer("numerator"),
    denominator: integer("denominator"),
    missingProvenance: integer("missing_provenance"),
    resolution: text("resolution"),
    managerId: uuid("manager_id").references(() => users.id, {
      onDelete: "set null",
    }),
    commandKey: text("command_key"),
    resolvedAt: time("resolved_at"),
    createdAt: time("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({
      name: "resident_lifecycle_case_owner",
      columns: [t.applicationId, t.userId],
      foreignColumns: [
        expertOnboardingApplications.id,
        expertOnboardingApplications.userId,
      ],
    }).onDelete("cascade"),
    unique("resident_lifecycle_case_generation").on(
      t.userId,
      t.kind,
      t.generation,
    ),
    index("resident_lifecycle_case_queue")
      .on(t.createdAt, t.id)
      .where(sql`status='open'`),
    check(
      "resident_lifecycle_cases_kind_check",
      sql`kind IN ('materials_missing','promotion_overdue','main_payment_overdue','payment_reconciliation','quality_window','notice_unknown')`,
    ),
    check(
      "resident_lifecycle_cases_generation_check",
      sql`length(generation) BETWEEN 1 AND 200`,
    ),
    check(
      "resident_lifecycle_cases_status_check",
      sql`status IN ('open','resolved','no_action')`,
    ),
    check("resident_lifecycle_cases_revision_check", sql`revision>=0`),
    check(
      "resident_lifecycle_cases_resolution_check",
      sql`length(resolution) BETWEEN 1 AND 2000`,
    ),
    check(
      "resident_lifecycle_case_quality",
      sql`coalesce((kind='quality_window' AND window_start IS NOT NULL AND window_end IS NOT NULL AND isfinite(window_start) AND isfinite(window_end) AND window_start<window_end AND numerator>=0 AND denominator>=numerator AND missing_provenance>=0) OR (kind<>'quality_window' AND window_start IS NULL AND window_end IS NULL AND numerator IS NULL AND denominator IS NULL AND missing_provenance IS NULL),false)`,
    ),
    check(
      "resident_lifecycle_case_resolution",
      sql`(status='resolved')=(resolved_at IS NOT NULL)`,
    ),
    check(
      "resident_lifecycle_case_time",
      sql`isfinite(created_at) AND (due_at IS NULL OR isfinite(due_at))`,
    ),
  ],
);
// Deferred last-attempt FK and source/immutability triggers are SQL-only; exact
// definitions and validation flags are retained by the database-derived state.
