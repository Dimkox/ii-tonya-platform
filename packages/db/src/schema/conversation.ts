import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

const mutableTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  ...mutableTimestamps,
});
export const conversationMessages = pgTable("conversation_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id),
  authorType: text("author_type").notNull(),
  contentRef: text("content_ref"),
  createdAt,
});
export const promptVersions = pgTable("prompt_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull(),
  contentRef: text("content_ref").notNull(),
  createdAt,
});
export const safetyIncidents = pgTable("safety_incidents", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").references(() => conversations.id),
  reasonCode: text("reason_code").notNull(),
  metadataHash: text("metadata_hash").notNull(),
  createdAt,
});
export const humanEscalations = pgTable("human_escalations", {
  id: uuid("id").defaultRandom().primaryKey(),
  incidentId: uuid("incident_id").notNull().references(() => safetyIncidents.id),
  status: text("status").notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  acknowledgementDeadline: timestamp("acknowledgement_deadline", { withTimezone: true }).notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  escalationReason: text("escalation_reason").notNull(),
  ...mutableTimestamps,
});
