import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { expertCardDrafts } from "./expert-cards.js";
export const hashtagsDb = pgTable(
  "hashtags_db",
  {
    id: uuid("id").primaryKey(),
    parentCategory: text("parent_category").notNull(),
    subCategory: text("sub_category").notNull(),
    tagValue: text("tag_value").notNull().unique("hashtags_db_tag_value_key"),
    displayLabel: text("display_label").notNull(),
    synonymProvenance: jsonb("synonym_provenance").notNull().default([]),
    synonymsJson: jsonb("synonyms_json").$type<{ term: string }[]>().notNull(),
    weightScore: integer("weight_score").notNull().default(5),
    isActive: boolean("is_active").notNull().default(true),
    sourceSha256: text("source_sha256")
      .notNull()
      .default(
        "f5211313189e3d3074a761868693796e93bb160c01d87f3d2989bac48b2ab75e",
      ),
  },
  () => [
    check(
      "hashtags_db_value",
      sql`length(tag_value) BETWEEN 1 AND 100 AND length(display_label) BETWEEN 1 AND 101 AND length(parent_category) BETWEEN 1 AND 200 AND length(sub_category) BETWEEN 1 AND 200`,
    ),
    check("hashtags_db_synonyms", sql`hashtags_synonyms_valid(synonyms_json)`),
    check("hashtags_db_weight", sql`weight_score BETWEEN 1 AND 10`),
    check("hashtags_db_source", sql`source_sha256 ~ '^[0-9a-f]{64}$'`),
  ],
);
export const expertCardDraftTags = pgTable(
  "expert_card_draft_tags",
  {
    draftId: uuid("draft_id").notNull(),
    userId: uuid("user_id").notNull(),
    tagId: uuid("tag_id").notNull(),
  },
  (t) => [
    primaryKey({
      name: "expert_card_draft_tags_pkey",
      columns: [t.draftId, t.tagId],
    }),
    foreignKey({
      name: "expert_card_draft_tags_tag_id_fkey",
      columns: [t.tagId],
      foreignColumns: [hashtagsDb.id],
    }),
    foreignKey({
      name: "expert_card_draft_tag_owner",
      columns: [t.draftId, t.userId],
      foreignColumns: [expertCardDrafts.id, expertCardDrafts.userId],
    }).onDelete("cascade"),
  ],
);

export const tagEmbeddingsCache = pgTable("tag_embeddings_cache", {
  singleton: boolean("singleton").primaryKey().default(true),
  generation: text("generation").notNull(),
  modelDigest: text("model_digest").notNull(),
  taxonomyDigest: text("taxonomy_digest").notNull(),
  cache: jsonb("cache").notNull(),
});
export const residentTagDecisions = pgTable(
  "resident_tag_decisions",
  {
    draftId: uuid("draft_id")
      .notNull()
      .references(() => expertCardDrafts.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    identity: text("identity").notNull(),
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id),
    sessionHash: text("session_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.revision, t.identity] })],
);
