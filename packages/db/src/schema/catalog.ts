import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

const mutableTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const experts = pgTable("experts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  active: boolean("active").notNull().default(false),
  verified: boolean("verified").notNull().default(false),
  ...mutableTimestamps,
});

export const expertServices = pgTable("expert_services", {
  id: uuid("id").defaultRandom().primaryKey(),
  expertId: uuid("expert_id").notNull().references(() => experts.id),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  durationMinutes: integer("duration_minutes").notNull(),
  ...mutableTimestamps,
});

export const slots = pgTable("slots", {
  id: uuid("id").defaultRandom().primaryKey(),
  expertServiceId: uuid("expert_service_id").notNull().references(() => expertServices.id),
  provider: text("provider").notNull(),
  externalSlotId: text("external_slot_id").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  capacity: integer("capacity").notNull(),
  ...mutableTimestamps,
});
