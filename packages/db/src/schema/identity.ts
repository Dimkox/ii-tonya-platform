import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const mutableTimestamps = {
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  ...mutableTimestamps,
});

export const channelIdentities = pgTable(
  "channel_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    ...mutableTimestamps,
  },
  (table) => [
    unique("channel_identities_provider_external_unique")
      .on(table.provider, table.externalId),
  ],
);

export const clientProfiles = pgTable("client_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  displayName: text("display_name"),
  timezone: text("timezone"),
  ...mutableTimestamps,
});

export const consents = pgTable("consents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  consentType: text("consent_type").notNull(),
  decision: text("decision").notNull(),
  policyVersion: text("policy_version").notNull(),
  createdAt,
});
