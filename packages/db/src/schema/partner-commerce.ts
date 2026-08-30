import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable,
  text, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const centerBands = sql`{"bands":[{"capacity":30,"count":10}]}::jsonb`;
const organizerBands = sql`{"bands":[{"capacity":50,"count":5},{"capacity":100,"count":3},{"capacity":500,"count":1}]}::jsonb`;

export const commercialParticipants = pgTable("commercial_participants", {
  id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), participantKind: text("participant_kind").notNull(), onboardingState: text("onboarding_state").notNull().default("started"), createdAt,
}, (table) => [
  check("commercial_participants_kind_check", sql`${table.participantKind} in ('EXPERT','CENTER','ORGANIZER')`),
  check("commercial_participants_onboarding_state_check", sql`${table.onboardingState} in ('started','kind_selected','profile_incomplete','profile_ready','offer_available')`),
  unique("commercial_participants_user_kind_unique").on(table.userId, table.participantKind),
  unique("commercial_participants_id_kind_unique").on(table.id, table.participantKind),
  index("commercial_participants_user_idx").on(table.userId, table.createdAt, table.id),
]);

export const organizationProfiles = pgTable("organization_profiles", {
  participantId: uuid("participant_id").primaryKey(), participantKind: text("participant_kind").notNull(), legalName: text("legal_name").notNull(), onlineOnly: boolean("online_only").notNull().default(false), cityMillionPlus: boolean("city_million_plus").notNull().default(false), verificationState: text("verification_state").notNull().default("unverified"), createdAt,
}, (table) => [
  check("organization_profiles_kind_check", sql`${table.participantKind} in ('CENTER','ORGANIZER')`),
  check("organization_profiles_verification_check", sql`${table.verificationState} in ('unverified','pending','verified','rejected')`),
  check("organization_profiles_legal_name_check", sql`char_length(${table.legalName}) between 1 and 300`),
  foreignKey({ name: "organization_profiles_participant_fk", columns: [table.participantId, table.participantKind], foreignColumns: [commercialParticipants.id, commercialParticipants.participantKind] }),
]);

export const partnerTariffPolicyVersions = pgTable("partner_tariff_policy_versions", {
  id: uuid("id").defaultRandom().primaryKey(), policyVersionId: text("policy_version_id").notNull(), policyVersion: integer("policy_version").notNull(), partnerKind: text("partner_kind").notNull(), standardPriceMinor: bigint("standard_price_minor", { mode: "number" }).notNull(), referredSixPriceMinor: bigint("referred_six_price_minor", { mode: "number" }).notNull(), referredTenPriceMinor: bigint("referred_ten_price_minor", { mode: "number" }).notNull(), onlineOnlySurchargeMinor: bigint("online_only_surcharge_minor", { mode: "number" }).notNull(), cityMillionPlusSurchargeMinor: bigint("city_million_plus_surcharge_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(), durationSeconds: integer("duration_seconds").notNull(), eventEntitlements: jsonb("event_entitlements").notNull(), residentCommissionBps: integer("resident_commission_bps").notNull(), nonresidentCommissionBps: integer("nonresident_commission_bps").notNull(), nonresidentCardFeeMinor: bigint("nonresident_card_fee_minor", { mode: "number" }).notNull(), status: text("status").notNull().default("draft"), effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(), effectiveTo: timestamp("effective_to", { withTimezone: true }), createdAt,
}, (table) => [
  check("partner_tariff_policy_versions_kind_check", sql`${table.partnerKind} in ('CENTER','ORGANIZER')`), check("partner_tariff_policy_versions_id_check", sql`char_length(${table.policyVersionId}) between 1 and 128`), check("partner_tariff_policy_versions_currency_check", sql`${table.currency}='RUB'`), check("partner_tariff_policy_versions_version_check", sql`${table.policyVersion}>0`),
  check("partner_tariff_policy_versions_money_check", sql`${table.standardPriceMinor}>0 and ${table.referredSixPriceMinor}>0 and ${table.referredTenPriceMinor}>0 and ${table.referredTenPriceMinor}<=${table.referredSixPriceMinor} and ${table.referredSixPriceMinor}<=${table.standardPriceMinor} and ${table.onlineOnlySurchargeMinor}=300000 and ${table.cityMillionPlusSurchargeMinor}=500000 and ${table.durationSeconds}=2592000 and ${table.residentCommissionBps}=1000 and ${table.nonresidentCommissionBps}=1500 and ${table.nonresidentCardFeeMinor}=450000`),
  check("partner_tariff_policy_versions_status_check", sql`${table.status} in ('draft','approved','retired')`), check("partner_tariff_policy_versions_window_check", sql`${table.effectiveTo} is null or ${table.effectiveTo}>${table.effectiveFrom}`),
  check("partner_tariff_policy_versions_entitlements_check", sql`(${table.partnerKind}='CENTER' and ${table.eventEntitlements}=${centerBands}) or (${table.partnerKind}='ORGANIZER' and ${table.eventEntitlements}=${organizerBands})`),
  unique("partner_tariff_policy_versions_id_version_unique").on(table.policyVersionId, table.policyVersion), unique("partner_tariff_policy_versions_kind_identity_unique").on(table.policyVersionId, table.partnerKind), uniqueIndex("partner_tariff_policy_versions_active_idx").on(table.partnerKind).where(sql`${table.status}='approved' and ${table.effectiveTo} is null`), index("partner_tariff_policy_versions_effective_idx").on(table.partnerKind, table.effectiveFrom, table.effectiveTo),
]);

export const partnerShadowQuotes = pgTable("partner_shadow_quotes", {
  id: uuid("id").defaultRandom().primaryKey(), participantId: uuid("participant_id").notNull(), policyId: uuid("policy_id").notNull(), policyVersionId: text("policy_version_id").notNull(), policyVersion: integer("policy_version").notNull(), partnerKind: text("partner_kind").notNull(), qualifiedExpertCount: integer("qualified_expert_count").notNull(), tier: text("tier").notNull(), basePriceMinor: bigint("base_price_minor", { mode: "number" }).notNull(), onlineOnlySurchargeMinor: bigint("online_only_surcharge_minor", { mode: "number" }).notNull(), cityMillionPlusSurchargeMinor: bigint("city_million_plus_surcharge_minor", { mode: "number" }).notNull(), finalPriceMinor: bigint("final_price_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(), durationSeconds: integer("duration_seconds").notNull(), eventEntitlements: jsonb("event_entitlements").notNull(), residentCommissionBps: integer("resident_commission_bps").notNull(), nonresidentCommissionBps: integer("nonresident_commission_bps").notNull(), nonresidentCardFeeMinor: bigint("nonresident_card_fee_minor", { mode: "number" }).notNull(), createdAt,
}, (table) => [
  check("partner_shadow_quotes_kind_check", sql`${table.partnerKind} in ('CENTER','ORGANIZER')`), check("partner_shadow_quotes_tier_check", sql`${table.tier} in ('STANDARD','REFERRED_6_9','REFERRED_10_PLUS')`), check("partner_shadow_quotes_currency_check", sql`${table.currency}='RUB' and ${table.durationSeconds}=2592000`), check("partner_shadow_quotes_arithmetic_check", sql`${table.basePriceMinor}+${table.onlineOnlySurchargeMinor}+${table.cityMillionPlusSurchargeMinor}=${table.finalPriceMinor}`), check("partner_shadow_quotes_money_check", sql`${table.qualifiedExpertCount}>=0 and ${table.basePriceMinor}>0 and ${table.onlineOnlySurchargeMinor}>=0 and ${table.cityMillionPlusSurchargeMinor}>=0 and ${table.finalPriceMinor}>0 and ${table.residentCommissionBps}=1000 and ${table.nonresidentCommissionBps}=1500 and ${table.nonresidentCardFeeMinor}=450000`), check("partner_shadow_quotes_entitlements_check", sql`(${table.partnerKind}='CENTER' and ${table.eventEntitlements}=${centerBands}) or (${table.partnerKind}='ORGANIZER' and ${table.eventEntitlements}=${organizerBands})`),
  foreignKey({ name: "partner_shadow_quotes_participant_kind_fk", columns: [table.participantId, table.partnerKind], foreignColumns: [commercialParticipants.id, commercialParticipants.participantKind] }), foreignKey({ name: "partner_shadow_quotes_policy_kind_fk", columns: [table.policyVersionId, table.partnerKind], foreignColumns: [partnerTariffPolicyVersions.policyVersionId, partnerTariffPolicyVersions.partnerKind] }), index("partner_shadow_quotes_participant_idx").on(table.participantId, table.createdAt, table.id),
]);

export const partnerCommandReceipts = pgTable("partner_command_receipts", {
  id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), command: text("command").notNull(), idempotencyKey: text("idempotency_key").notNull(), payloadHash: text("payload_hash").notNull(), result: jsonb("result").notNull(), createdAt,
}, (table) => [check("partner_command_receipts_command_check", sql`${table.command} in ('partner_onboarding','partner_quote')`), check("partner_command_receipts_hash_check", sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`), unique("partner_command_receipts_idempotency_unique").on(table.userId, table.command, table.idempotencyKey)]);
