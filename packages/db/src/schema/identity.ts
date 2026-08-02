import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const mutableTimestamps = {
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  active: boolean("active").notNull().default(true),
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

/** Deletable mapping for future provider identifiers; immutable legacy facts remain evidence-only. */
export const providerSubjectMappings = pgTable(
  "provider_subject_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    provider: text("provider").notNull(),
    subjectToken: text("subject_token").notNull(),
    subjectCiphertext: text("subject_ciphertext").notNull(),
    ...mutableTimestamps,
  },
  (table) => [unique("provider_subject_mappings_provider_token_unique").on(table.provider, table.subjectToken)],
);

export const clientProfiles = pgTable(
  "client_profiles",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id),
    displayName: text("display_name"),
    timezone: text("timezone"),
    expertNote: text("expert_note"),
    ...mutableTimestamps,
  },
  (table) => [
    check(
      "client_profiles_expert_note_bounded",
      sql`${table.expertNote} is null or char_length(${table.expertNote}) between 1 and 2000`,
    ),
  ],
);

export const consents = pgTable("consents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  consentType: text("consent_type").notNull(),
  decision: text("decision").notNull(),
  policyVersion: text("policy_version").notNull(),
  createdAt,
});
