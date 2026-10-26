import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  check,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { adminSessions } from "./audit.js";
import { users } from "./identity.js";
import { residentVerificationApplications } from "./resident-verification.js";
const at = (n: string) => timestamp(n, { withTimezone: true });
export const residentMessageTemplates = pgTable(
  "resident_message_templates",
  {
    keyName: text("key_name").notNull(),
    version: integer("version").notNull(),
    category: text("category").notNull(),
    bodyText: text("body_text").notNull(),
    variablesList: jsonb("variables_list").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.keyName, t.version] }),
    check("resident_message_templates_version_check", sql`${t.version}>0`),
    check(
      "resident_message_templates_category_check",
      sql`${t.category} IN ('REJECT_SOFT','REJECT_HARD','INFO_REQUEST','REFUND_NOTICE')`,
    ),
    check(
      "resident_message_templates_variables_list_check",
      sql`jsonb_typeof(${t.variablesList})='array'`,
    ),
  ],
);
export const residentReviewPreviews = pgTable(
  "resident_review_previews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => residentVerificationApplications.id, {
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id),
    sessionHash: text("session_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    revision: integer("revision").notNull(),
    generation: integer("generation").notNull(),
    templateKey: text("template_key").notNull(),
    templateVersion: integer("template_version").notNull(),
    action: text("action").notNull(),
    reasonCode: text("reason_code").notNull(),
    questions: jsonb("questions").notNull().default([]),
    finalText: text("final_text").notNull(),
    finalHash: text("final_hash").notNull(),
    variables: jsonb("variables").notNull(),
    createdAt: at("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
    expiresAt: at("expires_at")
      .notNull()
      .default(sql`clock_timestamp()+interval '5 minutes'`),
  },
  (t) => [
    unique().on(t.id, t.applicationId),
    check(
      "resident_review_previews_action_check",
      sql`${t.action} IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE','REJECT_SOFT','REJECT_HARD','INFO_REQUESTED')`,
    ),
    check(
      "resident_review_previews_questions_check",
      sql`jsonb_typeof(${t.questions})='array' AND jsonb_array_length(${t.questions})<=10`,
    ),
    check(
      "resident_review_previews_final_text_check",
      sql`octet_length(${t.finalText})<=12000 AND length(${t.finalText})<=4096`,
    ),
    check(
      "resident_review_previews_check",
      sql`${t.finalHash}=encode(digest(${t.finalText},'sha256'),'hex')`,
    ),
  ],
);
export const residentReviewEvents = pgTable(
  "resident_review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id").notNull(),
    previewId: uuid("preview_id").notNull().unique(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id),
    sessionHash: text("session_hash").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    sourceGeneration: integer("source_generation").notNull(),
    submittedRevision: integer("submitted_revision").notNull(),
    submittedDigest: text("submitted_digest").notNull(),
    action: text("action").notNull(),
    reasonCode: text("reason_code").notNull(),
    templateKey: text("template_key").notNull(),
    templateVersion: integer("template_version").notNull(),
    finalHash: text("final_hash").notNull(),
    deadline: at("deadline"),
    reapplyAt: at("reapply_at"),
    createdAt: at("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check(
      "resident_review_events_final_hash_check",
      sql`${t.finalHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
export const residentInformationRequests = pgTable(
  "resident_information_requests",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => residentReviewEvents.id),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => residentVerificationApplications.id, {
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    questions: jsonb("questions").notNull(),
    deadline: at("deadline").notNull(),
    status: text("status").notNull().default("open"),
    completedAt: at("completed_at"),
  },
  (t) => [
    check(
      "resident_information_requests_questions_check",
      sql`jsonb_typeof(${t.questions})='array' AND jsonb_array_length(${t.questions}) BETWEEN 1 AND 10`,
    ),
    check(
      "resident_information_requests_status_check",
      sql`${t.status} IN ('open','completed','timeout','superseded')`,
    ),
  ],
);
export const residentCheckGenerations = pgTable(
  "resident_check_generations",
  {
    applicationId: uuid("application_id")
      .notNull()
      .references(() => residentVerificationApplications.id, {
        onDelete: "cascade",
      }),
    generation: integer("generation").notNull(),
    submittedRevision: integer("submitted_revision").notNull(),
    supplementRevision: integer("supplement_revision").notNull(),
    requestId: uuid("request_id").references(
      () => residentInformationRequests.id,
      { onDelete: "cascade" },
    ),
    status: text("status").notNull().default("pending"),
    createdAt: at("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({ columns: [t.applicationId, t.generation] }),
    check(
      "resident_check_generations_status_check",
      sql`${t.status} IN ('pending','manual_review','cancelled')`,
    ),
  ],
);
export const residentReviewMessages = pgTable(
  "resident_review_messages",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => residentReviewEvents.id),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => residentVerificationApplications.id, {
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    consentVersion: text("consent_version").notNull(),
    finalText: text("final_text").notNull(),
    finalHash: text("final_hash").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    receipt: text("receipt"),
    dispatchedAt: at("dispatched_at"),
    completedAt: at("completed_at"),
    createdAt: at("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check(
      "resident_review_messages_status_check",
      sql`${t.status} IN ('pending','dispatched','delivered','cancelled','unknown')`,
    ),
    check(
      "resident_review_messages_attempts_check",
      sql`${t.attempts} BETWEEN 0 AND 3`,
    ),
    index("resident_review_messages_pending")
      .on(t.createdAt)
      .where(sql`${t.status}='pending'`),
    check(
      "resident_review_messages_check",
      sql`${t.finalHash}=encode(digest(${t.finalText},'sha256'),'hex')`,
    ),
  ],
);
export const residentReviewRecoveries = pgTable(
  "resident_review_recoveries",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => residentReviewEvents.id),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id),
    sessionHash: text("session_hash").notNull(),
    action: text("action").notNull().default("closed_without_resend"),
    createdAt: at("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check(
      "resident_review_recoveries_action_check",
      sql`${t.action}='closed_without_resend'`,
    ),
  ],
);
