import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { expertOnboardingApplications } from "./expert-onboarding.js";

/** Composite ownership and qualification guards are hand-authored in 0080. */
export const earlyBirdFormEnrollments = pgTable("early_bird_form_enrollments", {
  formId: uuid("form_id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  choiceId: uuid("choice_id").notNull(),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()`),
});
export const earlyBirdFormBridges = pgTable("early_bird_form_bridges", {
  applicationId: uuid("application_id")
    .primaryKey()
    .references(() => expertOnboardingApplications.id, { onDelete: "cascade" }),
  formId: uuid("form_id").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  choiceId: uuid("choice_id").notNull(),
  submittedRevision: integer("submitted_revision").notNull(),
  submittedDigest: text("submitted_digest").notNull(),
});
