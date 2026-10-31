import { sql } from "drizzle-orm";
import { bigint, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

/** Composite source constraints and erasure guards are authored in migration 0079. */
export const earlyBirdPositivePriceSnapshots = pgTable(
  "early_bird_positive_price_snapshots",
  {
    positiveChoiceId: uuid("positive_choice_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    baseId: uuid("base_id").notNull(),
    grantId: uuid("grant_id"),
    onboardingMinor: bigint("onboarding_minor", { mode: "number" })
      .notNull()
      .default(300000),
    baseMonthlyMinor: bigint("base_monthly_minor", { mode: "number" })
      .notNull()
      .default(500000),
    policyVersion: text("policy_version")
      .notNull()
      .default("wave1_standard_v1"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
);
