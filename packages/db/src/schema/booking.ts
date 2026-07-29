import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { expertServices } from "./catalog.js";
import { users } from "./identity.js";

const mutableTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
export const reservationStatus = pgEnum("reservation_status", ["reserved", "booked", "cancelled_by_client", "cancelled_by_expert", "expired", "completed", "no_show"]);

export const reservations = pgTable("reservations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  expertServiceId: uuid("expert_service_id").notNull().references(() => expertServices.id),
  status: reservationStatus("status").notNull().default("reserved"),
  idempotencyKey: text("idempotency_key").notNull(),
  reservedUntil: timestamp("reserved_until", { withTimezone: true }).notNull(),
  version: integer("version").notNull().default(1),
  ...mutableTimestamps,
});

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  reservationId: uuid("reservation_id").notNull().references(() => reservations.id),
  idempotencyKey: text("idempotency_key").notNull(),
  callbackTokenHash: text("callback_token_hash"),
  callbackClaims: text("callback_claims"),
  callbackExpiresAt: timestamp("callback_expires_at", { withTimezone: true }),
  callbackExpertId: uuid("callback_expert_id"),
  callbackAction: text("callback_action"),
  callbackVersion: integer("callback_version"),
  callbackConsumedAt: timestamp("callback_consumed_at", { withTimezone: true }),
  ...mutableTimestamps,
});

export const feedback = pgTable("feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  reservationId: uuid("reservation_id").notNull().references(() => reservations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  rating: integer("rating").notNull(),
  commentRef: text("comment_ref"),
  ...mutableTimestamps,
});
