import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Immutable versions and their fixed SQL policy are guarded by migration 0078. */
export const earlyBirdLaunchConfigs = pgTable("early_bird_launch_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  phase: text("phase").notNull(),
  enrollmentStartAt: timestamp("enrollment_start_at", {
    withTimezone: true,
  }).notNull(),
  clientStartAt: timestamp("client_start_at", { withTimezone: true }).notNull(),
  promoDeadlineDays: integer("promo_deadline_days").notNull(),
  finalCallTriggerAt: timestamp("final_call_trigger_at", {
    withTimezone: true,
  }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()`),
});
