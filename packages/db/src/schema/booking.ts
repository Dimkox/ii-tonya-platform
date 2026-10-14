import { sql } from "drizzle-orm";
import {
  check,
  boolean,
  jsonb,
  char,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { experts, expertServices, slots } from "./catalog.js";
import { privacyDeletionJobs } from "./audit.js";
import { users } from "./identity.js";

const mutableTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};
export const reservationStatus = pgEnum("reservation_status", [
  "reserved",
  "booked",
  "cancelled_by_client",
  "cancelled_by_expert",
  "expired",
  "completed",
  "no_show",
]);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => slots.id),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    expertServiceId: uuid("expert_service_id")
      .notNull()
      .references(() => expertServices.id),
    status: reservationStatus("status").notNull().default("reserved"),
    idempotencyKey: text("idempotency_key").notNull(),
    reservedUntil: timestamp("reserved_until", {
      withTimezone: true,
    }).notNull(),
    meetingUrl: text("meeting_url"),
    version: integer("version").notNull().default(1),
    ...mutableTimestamps,
  },
  (table) => [
    unique("reservations_idempotency_unique").on(table.idempotencyKey),
    index("reservations_client_active_overlap").on(table.userId, table.status),
    index("reservations_expert_active_overlap").on(
      table.expertId,
      table.status,
    ),
    check("reservations_version_positive", sql`${table.version} > 0`),
    check(
      "reservations_deadline_after_creation",
      sql`${table.reservedUntil} > ${table.createdAt}`,
    ),
    check(
      "reservations_meeting_url_https",
      sql`${table.meetingUrl} is null or (${table.meetingUrl} ~ '^https://[^[:space:]]+$' and char_length(${table.meetingUrl}) <= 2048)`,
    ),
  ],
);

export const clientBookingReceipts = pgTable(
  "client_booking_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    choiceDigest: char("choice_digest", { length: 71 }).notNull(),
    bookingHandle: char("booking_handle", { length: 47 }).notNull(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    createdAt: mutableTimestamps.createdAt,
  },
  (table) => [
    unique("client_booking_receipts_user_choice_unique").on(
      table.userId,
      table.choiceDigest,
    ),
    unique("client_booking_receipts_booking_handle_unique").on(
      table.bookingHandle,
    ),
    unique("client_booking_receipts_reservation_unique").on(
      table.reservationId,
    ),
    check(
      "client_booking_receipts_choice_digest_check",
      sql`${table.choiceDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "client_booking_receipts_booking_handle_check",
      sql`${table.bookingHandle} ~ '^bk1\.[A-Za-z0-9_-]{43}$'`,
    ),
    index("client_booking_receipts_owner_handle_idx").on(
      table.userId,
      table.bookingHandle,
    ),
  ],
);

export const clientBookingErasureWork = pgTable(
  "client_booking_erasure_work",
  {
    deletionJobId: uuid("deletion_job_id")
      .primaryKey()
      .references(() => privacyDeletionJobs.id, { onDelete: "cascade" }),
    phase: text("phase").notNull().default("cancel_active"),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "client_booking_erasure_work_phase_check",
      sql`${table.phase} in ('cancel_active','cleanup_public','complete','dead_letter')`,
    ),
    check(
      "client_booking_erasure_work_attempt_count_check",
      sql`${table.attemptCount} between 0 and 5`,
    ),
    check(
      "client_booking_erasure_work_lease_check",
      sql`(${table.leaseToken} is null) = (${table.leaseUntil} is null)`,
    ),
    index("client_booking_erasure_work_claim_idx")
      .on(table.phase, table.leaseUntil, table.updatedAt)
      .where(sql`${table.phase} in ('cancel_active','cleanup_public')`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    idempotencyKey: text("idempotency_key").notNull(),
    callbackTokenHash: text("callback_token_hash"),
    callbackClaims: text("callback_claims"),
    callbackExpiresAt: timestamp("callback_expires_at", { withTimezone: true }),
    callbackExpertId: uuid("callback_expert_id").references(() => experts.id),
    callbackAction: text("callback_action"),
    callbackVersion: integer("callback_version"),
    callbackConsumedAt: timestamp("callback_consumed_at", {
      withTimezone: true,
    }),
    ...mutableTimestamps,
  },
  (table) => [
    unique("notifications_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("notifications_callback_token_hash_unique")
      .on(table.callbackTokenHash)
      .where(sql`${table.callbackTokenHash} is not null`),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id").references(() => reservations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    rating: integer("rating").notNull(),
    commentRef: text("comment_ref"),
    sourceEventId: text("source_event_id").notNull(),
    contentHash: text("content_hash").notNull(),
    negativePolicyVersion: text("negative_policy_version").notNull(),
    escalationStatus: text("escalation_status").notNull().default("none"),
    createdAt: mutableTimestamps.createdAt,
  },
  (table) => [unique("feedback_source_event_unique").on(table.sourceEventId)],
);

export const planerkaServiceMappings = pgTable("planerka_service_mappings", {
  expertServiceId: uuid("expert_service_id")
    .primaryKey()
    .references(() => expertServices.id),
  accountId: integer("account_id").notNull(),
  eventTypeId: integer("event_type_id").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  timeZone: text("time_zone").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
});
export const planerkaBookingOperations = pgTable(
  "planerka_booking_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .unique()
      .references(() => reservations.id),
    accountId: integer("account_id").notNull(),
    eventTypeId: integer("event_type_id").notNull(),
    request: jsonb("request").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("pending"),
    providerUid: text("provider_uid").unique(),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    sendAdmittedAt: timestamp("send_admitted_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    recoveryCount: integer("recovery_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reasonCode: text("reason_code"),
    ...mutableTimestamps,
  },
);
export const planerkaAccountRequests = pgTable("planerka_account_requests", {
  accountId: integer("account_id").primaryKey(),
  nextRequestAt: timestamp("next_request_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const planerkaAvailabilityRefreshes = pgTable(
  "planerka_availability_refreshes",
  {
    expertServiceId: uuid("expert_service_id")
      .primaryKey()
      .references(() => expertServices.id),
    accountId: integer("account_id").notNull(),
    eventTypeId: integer("event_type_id").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    timeZone: text("time_zone").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
    }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    reasonCode: text("reason_code"),
  },
);
export const planerkaLegacyBookingReviews = pgTable(
  "planerka_legacy_booking_reviews",
  {
    reservationId: uuid("reservation_id")
      .primaryKey()
      .references(() => reservations.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    evidenceReference: text("evidence_reference"),
  },
);
