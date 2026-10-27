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
      .$type<"expert_energy_start_v1">()
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
      sql`rule_version = 'expert_energy_start_v1' AND isfinite(calculation_timestamp)
    AND calculation_timestamp BETWEEN '1970-01-01 00:00:00+00'::timestamptz AND '275760-09-13 00:00:00+00'::timestamptz
    AND calculation_timestamp = date_trunc('milliseconds',calculation_timestamp)`,
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
    ruleVersion: text("rule_version")
      .$type<"expert_energy_start_v1">()
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
    unique("expert_campaign_quote_user_key").on(
      table.userId,
      table.idempotencyKey,
    ),
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
      sql`rule_version = 'expert_energy_start_v1' AND currency = 'RUB'
    AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'`,
    ),
    check(
      "expert_campaign_quote_time_valid",
      sql`isfinite(calculation_timestamp) AND isfinite(quoted_at) AND isfinite(expires_at)
    AND calculation_timestamp >= '1970-01-01 00:00:00+00'::timestamptz
    AND calculation_timestamp <= quoted_at AND quoted_at < expires_at
    AND expires_at <= '275760-09-13 00:00:00+00'::timestamptz
    AND calculation_timestamp = date_trunc('milliseconds',calculation_timestamp)
    AND quoted_at = date_trunc('milliseconds',quoted_at)
    AND expires_at = date_trunc('milliseconds',expires_at)
    AND expires_at <= quoted_at + interval '15 minutes'`,
    ),
    check(
      "expert_campaign_quote_stage_valid",
      sql`term_months IN (1,3) AND duration_seconds = 2592000::bigint * term_months
    AND (term_months = 1 OR quoted_at - calculation_timestamp < interval '144 hours')
    AND energy_discount_bps = CASE
      WHEN quoted_at - calculation_timestamp < interval '72 hours' THEN 4000
      WHEN quoted_at - calculation_timestamp < interval '144 hours' THEN 3000
      WHEN quoted_at - calculation_timestamp < interval '216 hours' THEN 2000 ELSE 0 END
    AND start_discount_bps = CASE WHEN term_months = 1 THEN 0
      WHEN quoted_at - calculation_timestamp < interval '72 hours' THEN 1500 ELSE 1000 END`,
    ),
    check(
      "expert_campaign_quote_arithmetic_valid",
      sql`base_monthly_minor > 0 AND discounted_monthly_minor >= 0
    AND discounted_monthly_minor = div(base_monthly_minor::numeric * (10000::numeric-energy_discount_bps) * (10000::numeric-start_discount_bps) + 50000000,100000000)
    AND monthly_price_minor = greatest(discounted_monthly_minor,500000)
    AND floor_applied = (discounted_monthly_minor < 500000)
    AND price_minor = monthly_price_minor::numeric * term_months
    AND price_minor BETWEEN 1 AND 999999999999`,
    ),
  ],
);
