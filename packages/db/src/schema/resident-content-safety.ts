import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { expertCardDrafts, expertCardEntries } from "./expert-cards.js";
const created = () =>
  timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()`);
export const residentSafetyPolicies = pgTable("resident_safety_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  engine: text("engine").notNull().default("resident_safe_regex_v1"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: created(),
});
export const forbiddenPatterns = pgTable(
  "forbidden_patterns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => residentSafetyPolicies.id),
    patternRegex: text("pattern_regex").notNull(),
    category: text("category").notNull(),
    severityLevel: text("severity_level").notNull(),
    errorMessageTemplate: text("error_message_template").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    compiled: jsonb("compiled"),
    provenance: text("provenance").notNull(),
    positiveWitness: text("positive_witness").notNull(),
  },
  (t) => [
    check(
      "forbidden_patterns_category_check",
      sql`${t.category} in ('MEDICAL_CLAIM','FINANCIAL_GUARANTEE','POLITICAL_RELIGIOUS','HATE_SPEECH','SPAM_SCAM')`,
    ),
    check(
      "forbidden_patterns_severity_level_check",
      sql`${t.severityLevel} in ('BLOCKER','WARNING')`,
    ),
    check(
      "forbidden_patterns_error_message_template_check",
      sql`length(${t.errorMessageTemplate}) between 1 and 1000`,
    ),
  ],
);
export const residentSafetyActive = pgTable(
  "resident_safety_active",
  {
    id: integer("id").primaryKey(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => residentSafetyPolicies.id),
  },
  (t) => [check("resident_safety_active_id_check", sql`${t.id}=1`)],
);
export const residentCardCorrections = pgTable(
  "resident_card_corrections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => expertCardDrafts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => expertCardEntries.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    textContent: text("text_content").notNull(),
    createdAt: created(),
  },
  (t) => [
    unique("resident_card_corrections_draft_id_revision_key").on(
      t.draftId,
      t.revision,
    ),
    check("resident_card_corrections_revision_check", sql`${t.revision}>0`),
    check(
      "resident_card_corrections_text_content_check",
      sql`length(${t.textContent}) between 1 and 4000`,
    ),
  ],
);
export const residentSafetyOutcomes = pgTable(
  "resident_safety_outcomes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => expertCardDrafts.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    blocked: boolean("blocked").notNull(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => residentSafetyPolicies.id),
    revision: integer("revision").notNull(),
    issues: jsonb("issues").notNull(),
    createdAt: created(),
  },
  (t) => [
    unique("resident_safety_outcomes_user_id_request_key_key").on(
      t.userId,
      t.requestKey,
    ),
  ],
);
export const securityLogs = pgTable(
  "security_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => expertCardDrafts.id, { onDelete: "cascade" }),
    outcomeId: uuid("outcome_id")
      .notNull()
      .references(() => residentSafetyOutcomes.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull(),
    matchedPatternId: uuid("matched_pattern_id").references(
      () => forbiddenPatterns.id,
    ),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => residentSafetyPolicies.id),
    revision: integer("revision").notNull(),
    actionTaken: text("action_taken").notNull(),
    createdAt: created(),
  },
  (t) => [
    check(
      "security_logs_action_taken_check",
      sql`${t.actionTaken} in ('Blocked','Warned')`,
    ),
  ],
);
