import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  foreignKey,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { expertCardDrafts, expertCardReviews } from "./expert-cards.js";
import { residentObjectDeletions } from "./resident-private-jobs.js";
export const residentCardMedia = pgTable(
  "resident_card_media",
  {
    id: uuid().primaryKey().notNull(),
    draftId: uuid("draft_id").notNull(),
    sourceReference: text("source_reference").notNull(),
    size: integer().notNull(),
    mimeType: text("mime_type").notNull(),
    state: text().default("allocated").notNull(),
    sha256: text(),
  },
  (table) => [
    foreignKey({
      columns: [table.draftId],
      foreignColumns: [expertCardDrafts.id],
      name: "resident_card_media_draft_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.id],
      foreignColumns: [residentObjectDeletions.custodyId],
      name: "resident_card_media_id_fkey",
    }),
    unique("resident_card_media_draft_id_source_reference_key").on(
      table.draftId,
      table.sourceReference,
    ),
    check(
      "resident_card_media_check",
      sql`(state <> 'verified'::text) OR (sha256 IS NOT NULL)`,
    ),
    check(
      "resident_card_media_mime_type_check",
      sql`mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text])`,
    ),
    check(
      "resident_card_media_sha256_check",
      sql`sha256 ~ '^[0-9a-f]{64}$'::text`,
    ),
    check(
      "resident_card_media_size_check",
      sql`(size >= 1) AND (size <= 20971520)`,
    ),
    check(
      "resident_card_media_state_check",
      sql`state = ANY (ARRAY['allocated'::text, 'inflight'::text, 'unknown'::text, 'verified'::text, 'unavailable'::text])`,
    ),
  ],
);

export const residentCardVersions = pgTable(
  "resident_card_versions",
  {
    reviewId: uuid("review_id").primaryKey().notNull(),
    draftId: uuid("draft_id").notNull(),
    revision: integer().notNull(),
    profile: jsonb(),
    initialSchedule: jsonb("initial_schedule"),
    publicPayload: jsonb("public_payload").notNull(),
    safetyFields: jsonb("safety_fields").notNull(),
    safetyProof: jsonb("safety_proof").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.draftId],
      foreignColumns: [expertCardDrafts.id],
      name: "resident_card_versions_draft_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.reviewId],
      foreignColumns: [expertCardReviews.id],
      name: "resident_card_versions_review_id_fkey",
    }).onDelete("cascade"),
    unique("resident_card_versions_draft_id_revision_key").on(
      table.draftId,
      table.revision,
    ),
    check(
      "resident_card_versions_profile_check",
      sql`(profile IS NULL) OR resident_rich_profile_valid(profile, true)`,
    ),
  ],
);
