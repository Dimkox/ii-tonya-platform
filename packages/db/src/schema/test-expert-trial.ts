import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
export const testExpertCampaignVersions = pgTable(
  "test_expert_campaign_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("inactive"),
    capUnits: integer("cap_units").notNull().default(100),
    providerCallsPerMessage: integer("provider_calls_per_message")
      .notNull()
      .default(1),
    promptVersion: text("prompt_version"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    unique("test_expert_campaign_code_version_unique").on(t.code, t.version),
    uniqueIndex("test_expert_campaign_one_active_idx")
      .on(t.code)
      .where(sql`${t.status}='active'`),
    check(
      "test_expert_campaign_code_bounded",
      sql`char_length(${t.code}) between 1 and 128`,
    ),
    check("test_expert_campaign_version_positive", sql`${t.version} > 0`),
    check(
      "test_expert_campaign_status_check",
      sql`${t.status} in ('inactive','active','retired')`,
    ),
    check("test_expert_campaign_cap_check", sql`${t.capUnits} = 100`),
    check(
      "test_expert_campaign_provider_calls_check",
      sql`${t.providerCallsPerMessage} = 1`,
    ),
  ],
);
export const testExpertRedemptions = pgTable(
  "test_expert_redemptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignVersionId: uuid("campaign_version_id")
      .notNull()
      .references(() => testExpertCampaignVersions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    redemptionIdempotencyKey: text("redemption_idempotency_key").notNull(),
    grantedUnits: integer("granted_units").notNull().default(100),
    consumedUnits: integer("consumed_units").notNull().default(0),
    reservedUnits: integer("reserved_units").notNull().default(0),
    createdAt,
  },
  (t) => [
    unique("test_expert_redemption_key_unique").on(t.redemptionIdempotencyKey),
    index("test_expert_redemptions_user_idx").on(t.userId, t.campaignVersionId),
    check(
      "test_expert_redemption_capacity_check",
      sql`${t.consumedUnits} >= 0 and ${t.reservedUnits} >= 0 and ${t.consumedUnits} + ${t.reservedUnits} <= ${t.grantedUnits}`,
    ),
    check(
      "test_expert_redemption_key_bounded",
      sql`char_length(${t.redemptionIdempotencyKey}) between 1 and 128`,
    ),
    check("test_expert_redemption_granted_check", sql`${t.grantedUnits}=100`),
    check(
      "test_expert_redemption_units_even_check",
      sql`${t.consumedUnits}%2=0 and ${t.reservedUnits}%2=0`,
    ),
  ],
);
export const testExpertReservations = pgTable(
  "test_expert_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    redemptionId: uuid("redemption_id")
      .notNull()
      .references(() => testExpertRedemptions.id),
    requestKey: text("request_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    units: integer("units").notNull().default(2),
    status: text("status").notNull().default("reserved"),
    providerRequestId: text("provider_request_id"),
    createdAt,
  },
  (t) => [
    unique("test_expert_reservation_request_unique").on(
      t.redemptionId,
      t.requestKey,
    ),
    index("test_expert_reservations_redemption_status_idx").on(
      t.redemptionId,
      t.status,
      t.createdAt,
    ),
    index("test_expert_reservations_unknown_global_idx")
      .on(t.createdAt, t.id)
      .where(sql`${t.status}='unknown'`),
    uniqueIndex("test_expert_reservations_provider_request_idx")
      .on(t.providerRequestId)
      .where(sql`${t.providerRequestId} is not null`),
    check(
      "test_expert_reservation_key_bounded",
      sql`char_length(${t.requestKey}) between 1 and 128`,
    ),
    check(
      "test_expert_reservation_digest_check",
      sql`${t.requestDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check("test_expert_reservation_units_check", sql`${t.units} = 2`),
    check(
      "test_expert_reservation_status_check",
      sql`${t.status} in ('reserved','unknown','applied','not_applied')`,
    ),
    check(
      "test_expert_reservation_provider_request_check",
      sql`(${t.status} in ('unknown','applied') and ${t.providerRequestId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') or (${t.status} in ('reserved','not_applied') and (${t.providerRequestId} is null or ${t.providerRequestId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'))`,
    ),
  ],
);
export const testExpertOutcomes = pgTable(
  "test_expert_outcomes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => testExpertReservations.id),
    outcome: text("outcome").notNull(),
    providerRequestId: text("provider_request_id"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("test_expert_outcome_reservation_unique").on(
      t.reservationId,
      t.outcome,
    ),
    index("test_expert_outcomes_reservation_idx").on(
      t.reservationId,
      t.recordedAt,
    ),
    check(
      "test_expert_outcome_value_check",
      sql`${t.outcome} in ('unknown','applied','not_applied')`,
    ),
    check(
      "test_expert_outcome_provider_request_check",
      sql`(${t.outcome} in ('unknown','applied') and ${t.providerRequestId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') or (${t.outcome}='not_applied' and (${t.providerRequestId} is null or ${t.providerRequestId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'))`,
    ),
  ],
);
export const testExpertAuditEvents = pgTable(
  "test_expert_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    redemptionId: uuid("redemption_id")
      .notNull()
      .references(() => testExpertRedemptions.id),
    reservationId: uuid("reservation_id").references(
      () => testExpertReservations.id,
    ),
    eventType: text("event_type").notNull(),
    eventDigest: text("event_digest"),
    createdAt,
  },
  (t) => [
    index("test_expert_audit_redemption_idx").on(t.redemptionId, t.createdAt),
    check(
      "test_expert_audit_type_bounded",
      sql`char_length(${t.eventType}) between 1 and 64`,
    ),
    check(
      "test_expert_audit_digest_check",
      sql`${t.eventDigest} is null or ${t.eventDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
