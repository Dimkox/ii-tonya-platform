import { expertOfferProfiles } from "./expert-offer-corrections.js";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { expertResidencyTariffVersions } from "./expert-residency.js";

export const expertCampaignAnchors = pgTable(
  "expert_campaign_anchors",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    ruleVersion: text("rule_version")
      .$type<"expert_energy_start_v1" | "expert_energy_start_v2">()
      .notNull(),
    calculationTimestamp: timestamp("calculation_timestamp", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.ruleVersion] }),
    unique("expert_campaign_anchor_identity").on(
      table.userId,
      table.ruleVersion,
      table.calculationTimestamp,
    ),
    check(
      "expert_campaign_anchor_valid",
      sql.raw(
        "(rule_version = ANY (ARRAY['expert_energy_start_v1'::text, 'expert_energy_start_v2'::text])) AND isfinite(calculation_timestamp) AND calculation_timestamp >= '1970-01-01 00:00:00+00'::timestamp with time zone AND calculation_timestamp <= '275760-09-13 00:00:00+00'::timestamp with time zone AND calculation_timestamp = date_trunc('milliseconds'::text, calculation_timestamp)",
      ),
    ),
  ],
);

export const expertCampaignQuotes = pgTable(
  "expert_campaign_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    tariffVersionId: uuid("tariff_version_id")
      .notNull()
      .references(() => expertResidencyTariffVersions.id),
    idempotencyKey: text("idempotency_key").notNull(),
    profileRevision: integer("profile_revision"),
    packagePriceMinor: bigint("package_price_minor", { mode: "bigint" }),
    ruleVersion: text("rule_version")
      .$type<"expert_energy_start_v1" | "expert_energy_start_v2">()
      .notNull(),
    calculationTimestamp: timestamp("calculation_timestamp", {
      withTimezone: true,
    }).notNull(),
    quotedAt: timestamp("quoted_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    termMonths: integer("term_months").$type<1 | 3>().notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    baseMonthlyMinor: bigint("base_monthly_minor", {
      mode: "bigint",
    }).notNull(),
    discountedMonthlyMinor: bigint("discounted_monthly_minor", {
      mode: "bigint",
    }).notNull(),
    monthlyPriceMinor: bigint("monthly_price_minor", {
      mode: "bigint",
    }).notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").$type<"RUB">().notNull(),
    energyDiscountBps: integer("energy_discount_bps").notNull(),
    startDiscountBps: integer("start_discount_bps").notNull(),
    floorApplied: boolean("floor_applied").notNull(),
    displayName: text("display_name").notNull(),
    creditCapBps: integer("credit_cap_bps").notNull(),
    individualServicesEnabled: boolean("individual_services_enabled").notNull(),
    groupEventLimit: integer("group_event_limit").notNull(),
    statisticsLevel: text("statistics_level")
      .$type<"basic" | "expanded">()
      .notNull(),
    supportPriority: text("support_priority")
      .$type<"standard" | "priority">()
      .notNull(),
  },
  (table) => [
    check(
      "expert_campaign_quote_v2_valid",
      sql.raw(
        "rule_version = 'expert_energy_start_v1'::text AND profile_revision IS NULL AND package_price_minor IS NULL OR rule_version = 'expert_energy_start_v2'::text AND profile_revision IS NOT NULL AND currency = 'RUB'::text AND isfinite(calculation_timestamp) AND isfinite(quoted_at) AND isfinite(expires_at) AND calculation_timestamp <= quoted_at AND quoted_at < expires_at AND ((quoted_at - calculation_timestamp) < '240:00:00'::interval OR expires_at <= (quoted_at + '24:00:00'::interval)) AND calculation_timestamp = date_trunc('milliseconds'::text, calculation_timestamp) AND quoted_at = date_trunc('milliseconds'::text, quoted_at) AND expires_at = date_trunc('milliseconds'::text, expires_at) AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'::text AND (term_months = ANY (ARRAY[1, 3])) AND duration_seconds = (2592000::bigint * term_months) AND (term_months = 1 OR (quoted_at - calculation_timestamp) < '168:00:00'::interval) AND energy_discount_bps =\nCASE\n    WHEN (quoted_at - calculation_timestamp) < '96:00:00'::interval THEN 4000\n    WHEN (quoted_at - calculation_timestamp) < '168:00:00'::interval THEN 3000\n    WHEN (quoted_at - calculation_timestamp) < '240:00:00'::interval THEN 2000\n    ELSE 0\nEND AND base_monthly_minor >= 0 AND monthly_price_minor::numeric = GREATEST(500000::numeric, div(base_monthly_minor::numeric * (10000 - energy_discount_bps)::numeric + 5000::numeric, 10000::numeric)) AND discounted_monthly_minor::numeric = div(base_monthly_minor::numeric * (10000 - energy_discount_bps)::numeric + 5000::numeric, 10000::numeric) AND floor_applied =\nCASE\n    WHEN term_months = 1 THEN discounted_monthly_minor < 500000\n    ELSE div(base_monthly_minor::numeric * 3::numeric * (10000 - energy_discount_bps)::numeric * (10000 - start_discount_bps)::numeric + 50000000::numeric, 100000000::numeric) < 1500000::numeric\nEND AND ((quoted_at - calculation_timestamp) >= '168:00:00'::interval AND package_price_minor IS NULL AND start_discount_bps = 0 OR (quoted_at - calculation_timestamp) < '168:00:00'::interval AND package_price_minor IS NOT NULL AND package_price_minor::numeric = GREATEST(1500000::numeric, div(base_monthly_minor::numeric * 3::numeric * (10000 - energy_discount_bps)::numeric * (10000 - start_discount_bps)::numeric + 50000000::numeric, 100000000::numeric))) AND price_minor =\nCASE\n    WHEN term_months = 1 THEN monthly_price_minor\n    ELSE package_price_minor\nEND AND price_minor >= 1 AND price_minor <= '999999999999'::bigint",
      ),
    ),
    unique("expert_campaign_quote_user_key").on(
      table.userId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "expert_campaign_quote_profile_fk",
      columns: [table.userId, table.profileRevision],
      foreignColumns: [
        expertOfferProfiles.userId,
        expertOfferProfiles.revision,
      ],
    }),
    foreignKey({
      name: "expert_campaign_quote_anchor_fk",
      columns: [table.userId, table.ruleVersion, table.calculationTimestamp],
      foreignColumns: [
        expertCampaignAnchors.userId,
        expertCampaignAnchors.ruleVersion,
        expertCampaignAnchors.calculationTimestamp,
      ],
    }),
    check(
      "expert_campaign_quote_identity_valid",
      sql.raw(
        "rule_version = 'expert_energy_start_v2'::text OR rule_version = 'expert_energy_start_v1'::text AND currency = 'RUB'::text AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'::text",
      ),
    ),
    check(
      "expert_campaign_quote_time_valid",
      sql.raw(
        "rule_version = 'expert_energy_start_v2'::text OR isfinite(calculation_timestamp) AND isfinite(quoted_at) AND isfinite(expires_at) AND calculation_timestamp >= '1970-01-01 00:00:00+00'::timestamp with time zone AND calculation_timestamp <= quoted_at AND quoted_at < expires_at AND expires_at <= '275760-09-13 00:00:00+00'::timestamp with time zone AND calculation_timestamp = date_trunc('milliseconds'::text, calculation_timestamp) AND quoted_at = date_trunc('milliseconds'::text, quoted_at) AND expires_at = date_trunc('milliseconds'::text, expires_at) AND expires_at <= (quoted_at + '00:15:00'::interval)",
      ),
    ),
    check(
      "expert_campaign_quote_stage_valid",
      sql.raw(
        "rule_version = 'expert_energy_start_v2'::text OR (term_months = ANY (ARRAY[1, 3])) AND duration_seconds = (2592000::bigint * term_months) AND (term_months = 1 OR (quoted_at - calculation_timestamp) < '144:00:00'::interval) AND energy_discount_bps =\nCASE\n    WHEN (quoted_at - calculation_timestamp) < '72:00:00'::interval THEN 4000\n    WHEN (quoted_at - calculation_timestamp) < '144:00:00'::interval THEN 3000\n    WHEN (quoted_at - calculation_timestamp) < '216:00:00'::interval THEN 2000\n    ELSE 0\nEND AND start_discount_bps =\nCASE\n    WHEN term_months = 1 THEN 0\n    WHEN (quoted_at - calculation_timestamp) < '72:00:00'::interval THEN 1500\n    ELSE 1000\nEND",
      ),
    ),
    check(
      "expert_campaign_quote_arithmetic_valid",
      sql.raw(
        "rule_version = 'expert_energy_start_v2'::text OR base_monthly_minor > 0 AND discounted_monthly_minor >= 0 AND discounted_monthly_minor::numeric = div(base_monthly_minor::numeric * (10000::numeric - energy_discount_bps::numeric) * (10000::numeric - start_discount_bps::numeric) + 50000000::numeric, 100000000::numeric) AND monthly_price_minor = GREATEST(discounted_monthly_minor, 500000::bigint) AND floor_applied = (discounted_monthly_minor < 500000) AND price_minor::numeric = (monthly_price_minor::numeric * term_months::numeric) AND price_minor >= 1 AND price_minor <= '999999999999'::bigint",
      ),
    ),
  ],
);
