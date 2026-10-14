import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";

const mutableTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const experts = pgTable(
  "experts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    publicDisplayName: text("public_display_name"),
    active: boolean("active").notNull().default(false),
    verified: boolean("verified").notNull().default(false),
    ...mutableTimestamps,
  },
  (table) => [unique("experts_user_id_unique").on(table.userId)],
);

export const expertServices = pgTable("expert_services", {
  id: uuid("id").defaultRandom().primaryKey(),
  expertId: uuid("expert_id")
    .notNull()
    .references(() => experts.id),
  name: text("name").notNull(),
  code: text("code"),
  language: text("language"),
  active: boolean("active").notNull().default(true),
  durationMinutes: integer("duration_minutes").notNull(),
  ...mutableTimestamps,
});

export const slots = pgTable(
  "slots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expertServiceId: uuid("expert_service_id")
      .notNull()
      .references(() => expertServices.id),
    provider: text("provider").notNull(),
    externalSlotId: text("external_slot_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    capacity: integer("capacity").notNull(),
    ...mutableTimestamps,
  },
  (table) => [
    index("slots_planerka_service_start_idx")
      .on(table.expertServiceId, table.startsAt)
      .where(sql`${table.provider} = 'planerka'`),
    unique("slots_provider_external_unique").on(
      table.provider,
      table.externalSlotId,
    ),
    check("slots_capacity_positive", sql`${table.capacity} > 0`),
  ],
);
