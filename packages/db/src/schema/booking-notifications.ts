import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  bigint,
  unique,
  primaryKey,
  index,
  check,
  boolean,
} from "drizzle-orm/pg-core";
import {
  reservations,
  notifications,
  planerkaBookingOperations,
} from "./booking.js";
import { users, channelIdentities } from "./identity.js";
import { integrationOutbox } from "./integration.js";
const clock = () =>
  timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()`);
export const bookingNotificationBotControls = pgTable(
  "booking_notification_bot_controls",
  {
    botKey: text("bot_key").primaryKey(),
    admissionEnabled: boolean("admission_enabled").notNull().default(false),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pauseReason: text("pause_reason"),
    notBefore: timestamp("not_before", { withTimezone: true })
      .notNull()
      .default(sql`'-infinity'`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check(
      "booking_notification_bot_controls_bot_key_check",
      sql`length(${t.botKey}) BETWEEN 1 AND 128`,
    ),
    check(
      "booking_notification_bot_controls_pause_reason_check",
      sql`${t.pauseReason} IN ('bot_rejected','bot_mismatch','request_invalid')`,
    ),
    check(
      "booking_notification_bot_controls_check",
      sql`(${t.pausedAt} IS NULL) = (${t.pauseReason} IS NULL)`,
    ),
  ],
);
export const bookingNotificationContexts = pgTable(
  "booking_notification_contexts",
  {
    reservationId: uuid("reservation_id")
      .primaryKey()
      .references(() => reservations.id),
    botKey: text("bot_key").notNull(),
    clientUserId: uuid("client_user_id")
      .notNull()
      .references(() => users.id),
    expertUserId: uuid("expert_user_id")
      .notNull()
      .references(() => users.id),
    clientIdentityId: uuid("client_identity_id").references(
      () => channelIdentities.id,
      { onDelete: "set null" },
    ),
    clientOriginalIdentityId: uuid("client_original_identity_id"),
    clientExternalUserId: text("client_external_user_id"),
    clientExternalChatId: text("client_external_chat_id"),
    clientUnavailableReason: text("client_unavailable_reason"),
    expertIdentityId: uuid("expert_identity_id").references(
      () => channelIdentities.id,
      { onDelete: "set null" },
    ),
    expertOriginalIdentityId: uuid("expert_original_identity_id"),
    expertExternalUserId: text("expert_external_user_id"),
    expertExternalChatId: text("expert_external_chat_id"),
    expertUnavailableReason: text("expert_unavailable_reason"),
    clientConsentAuthority: jsonb("client_consent_authority"),
    createdAt: clock(),
  },
);
export const bookingNotificationDeliveries = pgTable(
  "booking_notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceOutboxId: uuid("source_outbox_id")
      .notNull()
      .references(() => integrationOutbox.id),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    recipientRole: text("recipient_role").notNull(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id),
    recipientIdentityId: uuid("recipient_identity_id").references(
      () => channelIdentities.id,
      { onDelete: "set null" },
    ),
    originalIdentityId: uuid("original_identity_id"),
    botKey: text("bot_key").notNull(),
    externalUserId: text("external_user_id"),
    externalChatId: text("external_chat_id"),
    kind: text("kind").notNull(),
    sourceVersion: integer("source_version"),
    providerOperationId: uuid("provider_operation_id").references(
      () => planerkaBookingOperations.id,
    ),
    templateVersion: integer("template_version").notNull().default(1),
    state: text("state").notNull().default("pending"),
    reasonCode: text("reason_code"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    workerId: text("worker_id"),
    createdAt: clock(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    unique().on(t.sourceOutboxId, t.recipientRole),
    index("booking_notification_deliveries_due")
      .on(t.nextAttemptAt, t.id)
      .where(sql`${t.state} in ('pending','retry_wait')`),
  ],
);
export const bookingNotificationAttempts = pgTable(
  "booking_notification_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => bookingNotificationDeliveries.id),
    ordinal: integer("ordinal").notNull(),
    claimToken: uuid("claim_token").notNull(),
    requestDigest: text("request_digest").notNull(),
    wireVersion: integer("wire_version"),
    admittedAt: timestamp("admitted_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    botKey: text("bot_key").notNull(),
    chatId: text("chat_id").notNull(),
    outcome: text("outcome").notNull().default("started"),
  },
  (t) => [
    unique().on(t.deliveryId, t.ordinal),
    unique().on(t.claimToken),
    check(
      "booking_notification_attempts_wire_version_check",
      sql`${t.wireVersion}=1`,
    ),
    check(
      "booking_notification_attempts_outcome_check",
      sql`${t.outcome}='started'`,
    ),
  ],
);
export const bookingNotificationAttemptFacts = pgTable(
  "booking_notification_attempt_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => bookingNotificationAttempts.id),
    outcome: text("outcome").notNull(),
    botKey: text("bot_key"),
    responseChatId: text("response_chat_id"),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    retryAfterSeconds: integer("retry_after_seconds"),
    reasonCode: text("reason_code").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    resolutionEvidenceRef: text("resolution_evidence_ref"),
  },
  (t) => [
    unique().on(t.attemptId, t.outcome),
    unique().on(t.botKey, t.responseChatId, t.telegramMessageId),
  ],
);
export const bookingNotificationCallbacks = pgTable(
  "booking_notification_callbacks",
  {
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => bookingNotificationDeliveries.id),
    action: text("action").notNull(),
    notificationId: uuid("notification_id")
      .notNull()
      .unique()
      .references(() => notifications.id),
    callbackTokenHash: text("callback_token_hash").notNull(),
    callbackTokenCiphertext: text("callback_token_ciphertext"),
    encryptionKeyId: text("encryption_key_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.deliveryId, t.action] })],
);
