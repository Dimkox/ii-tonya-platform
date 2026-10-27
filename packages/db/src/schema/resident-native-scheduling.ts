import {
  pgTable,
  check,
  uuid,
  timestamp,
  text,
  foreignKey,
  integer,
  unique,
  index,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { expertCardDrafts } from "./expert-cards.js";
import { residentCardVersions } from "./resident-rich-onboarding.js";
import { experts, expertServices, slots } from "./catalog.js";
import { reservations } from "./booking.js";

export const residentScheduleState = pgTable(
  "resident_schedule_state",
  {
    draftId: uuid("draft_id").primaryKey().notNull(),
    rules: jsonb().default({}).notNull(),
    mode: text().default("live").notNull(),
    field: integer().default(0).notNull(),
    revision: integer().default(0).notNull(),
    rawInput: text("raw_input"),
    currentPreview: uuid("current_preview"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.draftId],
      foreignColumns: [expertCardDrafts.id],
      name: "resident_schedule_state_draft_id_fkey",
    }).onDelete("cascade"),
    check(
      "resident_schedule_state_field_check",
      sql`(field >= 0) AND (field <= 7)`,
    ),
    check(
      "resident_schedule_state_mode_check",
      sql`mode = ANY (ARRAY['live'::text, 'card'::text])`,
    ),
    check(
      "resident_schedule_state_raw_input_check",
      sql`octet_length(raw_input) <= 64000`,
    ),
    check("resident_schedule_state_revision_check", sql`revision >= 0`),
    check(
      "resident_schedule_state_rules_check",
      sql`(jsonb_typeof(rules) = 'object'::text) AND (octet_length((rules)::text) <= 4000)`,
    ),
  ],
);

export const residentSchedulePreviews = pgTable(
  "resident_schedule_previews",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    draftId: uuid("draft_id").notNull(),
    scheduleRevision: integer("schedule_revision").notNull(),
    draftRevision: integer("draft_revision").notNull(),
    reviewId: uuid("review_id"),
    rawInput: text("raw_input"),
    profileDigest: text("profile_digest").notNull(),
    rules: jsonb().notNull(),
    entries: jsonb().notNull(),
    omissions: jsonb().default([]).notNull(),
    errors: jsonb().default([]).notNull(),
    page: integer()
      .default(sql`'-1'`)
      .notNull(),
    pageCount: integer("page_count").notNull(),
    tokenDigest: text("token_digest"),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "string",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" })
      .default(sql`(clock_timestamp() + '01:00:00'::interval)`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.draftId],
      foreignColumns: [expertCardDrafts.id],
      name: "resident_schedule_previews_draft_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.reviewId],
      foreignColumns: [residentCardVersions.reviewId],
      name: "resident_schedule_previews_review_id_fkey",
    }).onDelete("cascade"),
    check(
      "resident_schedule_previews_draft_revision_check",
      sql`draft_revision >= 0`,
    ),
    check(
      "resident_schedule_previews_entries_check",
      sql`(jsonb_typeof(entries) = 'array'::text) AND (jsonb_array_length(entries) <= 500) AND (octet_length((entries)::text) <= 300000)`,
    ),
    check(
      "resident_schedule_previews_errors_check",
      sql`(jsonb_typeof(errors) = 'array'::text) AND (octet_length((errors)::text) <= 150000)`,
    ),
    check(
      "resident_schedule_previews_omissions_check",
      sql`(jsonb_typeof(omissions) = 'array'::text) AND (octet_length((omissions)::text) <= 150000)`,
    ),
    check("resident_schedule_previews_page_check", sql`page >= '-1'::integer`),
    check(
      "resident_schedule_previews_page_count_check",
      sql`(page_count >= 1) AND (page_count <= 500)`,
    ),
    check(
      "resident_schedule_previews_profile_digest_check",
      sql`profile_digest ~ '^[0-9a-f]{64}$'::text`,
    ),
    check(
      "resident_schedule_previews_raw_input_check",
      sql`octet_length(raw_input) <= 64000`,
    ),
    check(
      "resident_schedule_previews_rules_check",
      sql`(jsonb_typeof(rules) = 'object'::text) AND (octet_length((rules)::text) <= 4000)`,
    ),
    check(
      "resident_schedule_previews_schedule_revision_check",
      sql`schedule_revision >= 0`,
    ),
    check(
      "resident_schedule_previews_token_digest_check",
      sql`token_digest ~ '^[0-9a-f]{64}$'::text`,
    ),
  ],
);

export const residentServiceMappings = pgTable(
  "resident_service_mappings",
  {
    draftId: uuid("draft_id").notNull(),
    richServiceId: uuid("rich_service_id").notNull(),
    expertServiceId: uuid("expert_service_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.draftId],
      foreignColumns: [expertCardDrafts.id],
      name: "resident_service_mappings_draft_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.expertServiceId],
      foreignColumns: [expertServices.id],
      name: "resident_service_mappings_expert_service_id_fkey",
    }),
    primaryKey({
      columns: [table.draftId, table.richServiceId],
      name: "resident_service_mappings_pkey",
    }),
    unique("resident_service_mappings_expert_service_id_key").on(
      table.expertServiceId,
    ),
  ],
);

export const residentServiceVersions = pgTable(
  "resident_service_versions",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    reviewId: uuid("review_id").notNull(),
    richServiceId: uuid("rich_service_id").notNull(),
    expertServiceId: uuid("expert_service_id").notNull(),
    title: text().notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    format: text().notNull(),
    logistics: jsonb().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.expertServiceId],
      foreignColumns: [expertServices.id],
      name: "resident_service_versions_expert_service_id_fkey",
    }),
    foreignKey({
      columns: [table.reviewId],
      foreignColumns: [residentCardVersions.reviewId],
      name: "resident_service_versions_review_id_fkey",
    }).onDelete("cascade"),
    unique("resident_service_versions_review_id_rich_service_id_key").on(
      table.reviewId,
      table.richServiceId,
    ),
    check(
      "resident_service_versions_duration_minutes_check",
      sql`(duration_minutes >= 5) AND (duration_minutes <= 1440)`,
    ),
    check(
      "resident_service_versions_format_check",
      sql`format = ANY (ARRAY['ONLINE'::text, 'OFFLINE'::text, 'HYBRID'::text])`,
    ),
    check(
      "resident_service_versions_logistics_check",
      sql`(jsonb_typeof(logistics) = 'object'::text) AND (octet_length((logistics)::text) <= 10000)`,
    ),
    check(
      "resident_service_versions_title_check",
      sql`(length(title) >= 1) AND (length(title) <= 160)`,
    ),
  ],
);

export const residentScheduleVersions = pgTable(
  "resident_schedule_versions",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    previewId: uuid("preview_id").notNull(),
    reviewId: uuid("review_id").notNull(),
    expertId: uuid("expert_id").notNull(),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    validUntil: timestamp("valid_until", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.expertId],
      foreignColumns: [experts.id],
      name: "resident_schedule_versions_expert_id_fkey",
    }),
    foreignKey({
      columns: [table.previewId],
      foreignColumns: [residentSchedulePreviews.id],
      name: "resident_schedule_versions_preview_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.reviewId],
      foreignColumns: [residentCardVersions.reviewId],
      name: "resident_schedule_versions_review_id_fkey",
    }).onDelete("cascade"),
    unique("resident_schedule_versions_preview_id_key").on(table.previewId),
  ],
);

export const residentNativeSlots = pgTable(
  "resident_native_slots",
  {
    slotId: uuid("slot_id").primaryKey().notNull(),
    scheduleId: uuid("schedule_id").notNull(),
    serviceVersionId: uuid("service_version_id").notNull(),
    localStart: text("local_start").notNull(),
    timezone: text().notNull(),
    bufferMinutes: integer("buffer_minutes").notNull(),
    occupiedUntil: timestamp("occupied_until", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    withdrawnAt: timestamp("withdrawn_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    index("resident_native_slots_schedule").using(
      "btree",
      table.scheduleId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.scheduleId],
      foreignColumns: [residentScheduleVersions.id],
      name: "resident_native_slots_schedule_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.serviceVersionId],
      foreignColumns: [residentServiceVersions.id],
      name: "resident_native_slots_service_version_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.slotId],
      foreignColumns: [slots.id],
      name: "resident_native_slots_slot_id_fkey",
    }).onDelete("cascade"),
    check(
      "resident_native_slots_buffer_minutes_check",
      sql`(buffer_minutes >= 0) AND (buffer_minutes <= 240)`,
    ),
  ],
);

export const residentScheduleBusy = pgTable(
  "resident_schedule_busy",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    expertId: uuid("expert_id").notNull(),
    draftId: uuid("draft_id").notNull(),
    startsAt: timestamp("starts_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    endsAt: timestamp("ends_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    index("resident_schedule_busy_expert").using(
      "btree",
      table.expertId.asc().nullsLast().op("uuid_ops"),
      table.startsAt.asc().nullsLast().op("timestamptz_ops"),
      table.endsAt.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.draftId],
      foreignColumns: [expertCardDrafts.id],
      name: "resident_schedule_busy_draft_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.expertId],
      foreignColumns: [experts.id],
      name: "resident_schedule_busy_expert_id_fkey",
    }),
    check("resident_schedule_busy_check", sql`ends_at > starts_at`),
  ],
);

export const residentNativeConfirmations = pgTable(
  "resident_native_confirmations",
  {
    reservationId: uuid("reservation_id").primaryKey().notNull(),
    slotId: uuid("slot_id").notNull(),
    serviceVersionId: uuid("service_version_id").notNull(),
    reservationVersion: integer("reservation_version").notNull(),
    snapshot: jsonb().notNull(),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "string",
    })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.reservationId],
      foreignColumns: [reservations.id],
      name: "resident_native_confirmations_reservation_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.serviceVersionId],
      foreignColumns: [residentServiceVersions.id],
      name: "resident_native_confirmations_service_version_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.slotId],
      foreignColumns: [residentNativeSlots.slotId],
      name: "resident_native_confirmations_slot_id_fkey",
    }).onDelete("cascade"),
    check(
      "resident_native_confirmations_reservation_version_check",
      sql`reservation_version > 1`,
    ),
    check(
      "resident_native_confirmations_snapshot_check",
      sql`(jsonb_typeof(snapshot) = 'object'::text) AND (octet_length((snapshot)::text) <= 15000)`,
    ),
  ],
);

export const residentNativeLogistics = pgTable(
  "resident_native_logistics",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    reservationId: uuid("reservation_id").notNull(),
    kind: text().notNull(),
    dueAt: timestamp("due_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    state: text().default("pending").notNull(),
    attemptId: uuid("attempt_id"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    leaseUntil: timestamp("lease_until", {
      withTimezone: true,
      mode: "string",
    }),
    receipt: jsonb(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    index("resident_native_logistics_due")
      .using(
        "btree",
        table.dueAt.asc().nullsLast().op("timestamptz_ops"),
        table.id.asc().nullsLast().op("uuid_ops"),
      )
      .where(sql`(state = 'pending'::text)`),
    foreignKey({
      columns: [table.reservationId],
      foreignColumns: [residentNativeConfirmations.reservationId],
      name: "resident_native_logistics_reservation_id_fkey",
    }).onDelete("cascade"),
    unique("resident_native_logistics_reservation_id_kind_key").on(
      table.reservationId,
      table.kind,
    ),
    check(
      "resident_native_logistics_attempt_count_check",
      sql`(attempt_count >= 0) AND (attempt_count <= 3)`,
    ),
    check(
      "resident_native_logistics_kind_check",
      sql`kind = ANY (ARRAY['online'::text, 'offline'::text])`,
    ),
    check(
      "resident_native_logistics_receipt_check",
      sql`(receipt IS NULL) OR ((jsonb_typeof(receipt) = 'object'::text) AND (octet_length((receipt)::text) <= 1000))`,
    ),
    check(
      "resident_native_logistics_state_check",
      sql`state = ANY (ARRAY['pending'::text, 'sending'::text, 'unknown'::text, 'delivered'::text, 'suppressed'::text])`,
    ),
  ],
);
