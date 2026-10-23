import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { expertCampaignQuotes } from "./expert-campaign-quotes.js";

// Applicant queue only: approval/stage/archive metadata never grants expert access,
// paid residency, or referral credit. Workflows remain a separate capability.
export const expertOnboardingApplications = pgTable(
  "expert_onboarding_applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    campaignQuoteId: uuid("campaign_quote_id"),
    verificationStatus: text("verification_status")
      .$type<"pending" | "approved" | "rejected">()
      .notNull()
      .default("pending"),
    onboardingStage: text("onboarding_stage").$type<
      | "interview"
      | "card_draft"
      | "manager_review"
      | "promo_check"
      | "payment_ready"
    >(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archiveUntilDate: timestamp("archive_until_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("expert_onboarding_user_unique").on(t.userId),
    unique("expert_onboarding_id_user_unique").on(t.id, t.userId),
    foreignKey({
      name: "expert_onboarding_user_fk",
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "expert_onboarding_quote_owner_fk",
      columns: [t.campaignQuoteId, t.userId],
      foreignColumns: [expertCampaignQuotes.id, expertCampaignQuotes.userId],
    }),
    check(
      "expert_onboarding_verification_valid",
      sql`verification_status IN ('pending','approved','rejected')`,
    ),
    check(
      "expert_onboarding_stage_valid",
      sql`onboarding_stage IN ('interview','card_draft','manager_review','promo_check','payment_ready')`,
    ),
    check(
      "expert_onboarding_archive_bounds",
      sql`(archived_at IS NULL AND archive_until_date IS NULL) OR
      (archived_at IS NOT NULL AND archive_until_date IS NOT NULL
       AND isfinite(archived_at) AND isfinite(archive_until_date)
       AND archive_until_date >= archived_at
       AND archive_until_date <= (((archived_at AT TIME ZONE 'UTC') + interval '3 months') AT TIME ZONE 'UTC'))`,
    ),
    index("expert_onboarding_pending_queue_idx")
      .on(t.createdAt, t.id)
      .where(sql`verification_status = 'pending'`),
  ],
);
