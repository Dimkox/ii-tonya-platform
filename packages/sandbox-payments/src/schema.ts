import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const sandboxExpertResidencyEnvironment = pgTable(
  "sandbox_expert_residency_environment",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    marker: text("marker").notNull(),
  },
  (table) => [
    check("sandbox_environment_singleton", sql`${table.singleton}`),
    check(
      "sandbox_environment_marker",
      sql`${table.marker} = 'ii_tonya_sandbox_v1'`,
    ),
  ],
);

export const sandboxExpertResidencyPayments = pgTable(
  "sandbox_expert_residency_payments",
  {
    paymentId: text("payment_id").primaryKey(),
    orderId: uuid("order_id").notNull().unique(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    checkoutUrl: text("checkout_url").notNull(),
    state: text("state").notNull(),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "sandbox_payment_id_format",
      sql`${table.paymentId} ~ '^sandbox_payment_[A-Za-z0-9_-]{22,128}$'`,
    ),
    check("sandbox_payment_amount_positive", sql`${table.amountMinor} > 0`),
    check("sandbox_payment_currency", sql`${table.currency} = 'RUB'`),
    check(
      "sandbox_payment_state",
      sql`${table.state} in ('created','settled','refunded')`,
    ),
    check("sandbox_payment_version", sql`${table.version} >= 0`),
  ],
);

export const sandboxExpertResidencyCommands = pgTable(
  "sandbox_expert_residency_commands",
  {
    commandId: text("command_id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => sandboxExpertResidencyPayments.paymentId),
    commandKind: text("command_kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("sandbox_command_kind_idempotency_unique").on(
      table.commandKind,
      table.idempotencyKey,
    ),
    check(
      "sandbox_command_id_format",
      sql`${table.commandId} ~ '^sandbox_command_[A-Za-z0-9_-]{22,128}$'`,
    ),
    check(
      "sandbox_command_kind",
      sql`${table.commandKind} in ('checkout','transition')`,
    ),
    check(
      "sandbox_command_payload_digest",
      sql`${table.payloadDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "sandbox_command_idempotency_key",
      sql`length(${table.idempotencyKey}) between 1 and 200 and ${table.idempotencyKey} ~ '^[A-Za-z0-9_.:-]+$'`,
    ),
    check(
      "sandbox_command_result_object",
      sql`jsonb_typeof(${table.result}) = 'object'`,
    ),
    index("sandbox_commands_payment_idx").on(table.paymentId),
  ],
);

export const sandboxExpertResidencyEvents = pgTable(
  "sandbox_expert_residency_events",
  {
    eventId: text("event_id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => sandboxExpertResidencyPayments.paymentId),
    transitionKind: text("transition_kind").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    payload: jsonb("payload").notNull(),
    correlationId: text("correlation_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "sandbox_event_id_format",
      sql`${table.eventId} ~ '^sandbox_event_[A-Za-z0-9_-]{22,128}$'`,
    ),
    check(
      "sandbox_event_transition_kind",
      sql`${table.transitionKind} in ('settled','refunded')`,
    ),
    check(
      "sandbox_event_payload_digest",
      sql`${table.payloadDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "sandbox_event_payload_object",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    check(
      "sandbox_event_correlation_id",
      sql`length(${table.correlationId}) between 1 and 200 and ${table.correlationId} ~ '^[A-Za-z0-9_.:-]+$'`,
    ),
    check(
      "sandbox_event_processed_at",
      sql`${table.processedAt} is null or ${table.processedAt} >= ${table.occurredAt}`,
    ),
    index("sandbox_events_payment_pending_idx")
      .on(table.paymentId, table.occurredAt, table.eventId)
      .where(sql`${table.processedAt} is null`),
  ],
);
