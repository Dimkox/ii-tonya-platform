import { sql } from "drizzle-orm";
import {
  bigint as pgBigint,
  bigserial,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { adminApprovals, adminSessions } from "./audit.js";
import { experts } from "./catalog.js";
import { channelIdentities, consents, users } from "./identity.js";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

export const expertReferralAdminExecutionResults = pgTable(
  "expert_referral_admin_execution_results",
  {
    approvalId: uuid("approval_id")
      .primaryKey()
      .references(() => adminApprovals.id),
    secondApprovalId: uuid("second_approval_id").references(
      () => adminApprovals.id,
    ),
    action: text("action").notNull(),
    objectId: uuid("object_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    secondNonceHash: text("second_nonce_hash"),
    requesterSessionIdHash: text("requester_session_id_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    expectedVersion: integer("expected_version"),
    safeResult: jsonb("safe_result")
      .$type<Record<string, string | number | boolean>>()
      .notNull(),
    createdAt,
  },
  (table) => [
    check(
      "expert_referral_admin_result_action_allowed",
      sql`${table.action} in ('expert_referral.batch_generate','expert_referral.code_revoke','expert_referral.issuance_override','expert_referral.abuse_hold_open','expert_referral.abuse_hold_close','expert_residency.tariff_create','expert_residency.tariff_retire','expert_referral.hold_replay','expert_referral.feature_switch','client_commercial_policy.control_v2','expert_residency.tariff_create_v2')`,
    ),
    check(
      "expert_referral_admin_result_payload_hash_format",
      sql`${table.payloadHash} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "expert_referral_admin_result_nonce_hash_format",
      sql`${table.nonceHash} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "expert_referral_admin_result_second_binding",
      sql`coalesce((${table.action} <> 'expert_referral.issuance_override' and ${table.secondApprovalId} is null and ${table.secondNonceHash} is null) or (${table.action} = 'expert_referral.issuance_override' and ${table.secondApprovalId} is not null and ${table.secondNonceHash} is not null and ${table.secondNonceHash} ~ '^sha256:[0-9a-f]{64}$' and ${table.secondApprovalId} <> ${table.approvalId}), false)`,
    ),
    check(
      "expert_referral_admin_result_expected_version",
      sql`coalesce((${table.action} in ('expert_referral.feature_switch','client_commercial_policy.control_v2') and ${table.expectedVersion} is not null and ${table.expectedVersion} between 0 and 2147483646) or (${table.action} not in ('expert_referral.feature_switch','client_commercial_policy.control_v2') and ${table.expectedVersion} is null), false)`,
    ),
    check(
      "expert_referral_admin_result_object_only",
      sql`jsonb_typeof(${table.safeResult}) = 'object'`,
    ),
    check(
      "expert_referral_admin_result_no_secrets",
      sql`not (${table.safeResult} ?| array['codes','plaintext','digest','hash','nonce']) and ${table.safeResult}::text !~ '"(codes|plaintext|digest|hash|nonce)"[[:space:]]*:'`,
    ),
    check(
      "expert_referral_admin_result_exact_schema",
      sql`
      (${table.action} = 'expert_referral.batch_generate' and ${table.safeResult} ?& array['batchId','count'] and ${table.safeResult} - array['batchId','count'] = '{}'::jsonb and jsonb_typeof(${table.safeResult}->'batchId')='string' and (${table.safeResult}->>'batchId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof(${table.safeResult}->'count')='number') or
      (${table.action} = 'expert_referral.code_revoke' and ${table.safeResult} ?& array['id','status'] and ${table.safeResult} - array['id','status'] = '{}'::jsonb and jsonb_typeof(${table.safeResult}->'id')='string' and jsonb_typeof(${table.safeResult}->'status')='string') or
      (${table.action} = 'expert_referral.issuance_override' and ${table.safeResult} ? 'overrideId' and ${table.safeResult} - 'overrideId' = '{}'::jsonb and jsonb_typeof(${table.safeResult}->'overrideId')='string') or
      (${table.action} in ('expert_referral.abuse_hold_open','expert_referral.abuse_hold_close') and ${table.safeResult} ?& array['id','expertId','status'] and ${table.safeResult} - array['id','expertId','status'] = '{}'::jsonb and jsonb_typeof(${table.safeResult}->'id')='string' and (${table.safeResult}->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof(${table.safeResult}->'expertId')='string' and jsonb_typeof(${table.safeResult}->'status')='string') or
      (${table.action} = 'expert_residency.tariff_create' and ${table.safeResult} ? 'tariffVersionId' and ${table.safeResult} - 'tariffVersionId' = '{}'::jsonb and jsonb_typeof(${table.safeResult}->'tariffVersionId')='string') or
      (${table.action} = 'expert_residency.tariff_create_v2' and ${table.safeResult} ? 'tariffVersionId' and ${table.safeResult} - 'tariffVersionId' = '{}'::jsonb and jsonb_typeof(${table.safeResult}->'tariffVersionId')='string') or
      (${table.action} = 'expert_residency.tariff_retire' and ${table.safeResult} ?& array['tariffVersionId','activeTo'] and ${table.safeResult} - array['tariffVersionId','activeTo'] = '{}'::jsonb and jsonb_typeof(${table.safeResult}->'tariffVersionId')='string' and jsonb_typeof(${table.safeResult}->'activeTo')='string') or
      (${table.action} = 'expert_referral.hold_replay' and ${table.safeResult} ?& array['kind','reason'] and ${table.safeResult} - array['kind','reason'] = '{}'::jsonb and jsonb_typeof(${table.safeResult}->'kind')='string' and jsonb_typeof(${table.safeResult}->'reason')='string') or
      (${table.action} = 'expert_referral.feature_switch' and ${table.safeResult} ? 'version' and ${table.safeResult} - 'version' = '{}'::jsonb and jsonb_typeof(${table.safeResult}->'version')='number')
      or (${table.action} = 'client_commercial_policy.control_v2' and ${table.objectId}='00000000-0000-0000-0000-000000000041'::uuid and ${table.safeResult} ?& array['version','admissionPolicy'] and ${table.safeResult} - array['version','admissionPolicy'] = '{}'::jsonb and jsonb_typeof(${table.safeResult}->'version')='number' and (${table.safeResult}->>'version')::numeric > 0 and (${table.safeResult}->>'version')::numeric % 1 = 0 and jsonb_typeof(${table.safeResult}->'admissionPolicy')='string' and ${table.safeResult}->>'admissionPolicy' in ('legacy_package_v1','free_client_v2'))
    `,
    ),
    uniqueIndex("expert_referral_admin_results_second_approval_unique")
      .on(table.secondApprovalId)
      .where(sql`${table.secondApprovalId} is not null`),
  ],
);

export const expertReferralBatchStatus = pgEnum(
  "expert_referral_batch_status",
  ["issued", "partially_redeemed", "fully_redeemed", "revoked"],
);
export const expertReferralCodeStatus = pgEnum("expert_referral_code_status", [
  "issued",
  "redeemed",
  "revoked",
]);
export const expertResidencyOrderStatus = pgEnum(
  "expert_residency_order_status",
  [
    "quoted",
    "payment_pending",
    "settled",
    "failed",
    "expired",
    "refunded",
    "charged_back",
  ],
);
export const expertResidencyPaymentAttemptStatus = pgEnum(
  "expert_residency_payment_attempt_status",
  [
    "created",
    "pending",
    "unknown_outcome",
    "settled",
    "failed",
    "refunded",
    "charged_back",
  ],
);
export const expertResidencyProviderEventStatus = pgEnum(
  "expert_residency_provider_event_status",
  [
    "received",
    "processing",
    "processed",
    "rejected",
    "reconciliation_required",
  ],
);
export const expertFirstSettlementEligibility = pgEnum(
  "expert_first_settlement_eligibility",
  [
    "eligible",
    "permanently_ineligible",
    "pending_feature_hold",
    "cancelled_by_refund",
  ],
);
export const expertReferralMaturityStatus = pgEnum(
  "expert_referral_maturity_status",
  ["pending", "granted", "cancelled"],
);
export const expertReferralLedgerEntryKind = pgEnum(
  "expert_referral_ledger_entry_kind",
  [
    "reward_grant",
    "reservation",
    "release",
    "spend",
    "expiry",
    "reversal",
    "debt_repayment",
    "administrative_correction",
  ],
);
export const expertReferralAbuseHoldStatus = pgEnum(
  "expert_referral_abuse_hold_status",
  ["open", "closed"],
);

export const expertReferralCodeBatches = pgTable(
  "expert_referral_code_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inviterExpertId: uuid("inviter_expert_id")
      .notNull()
      .references(() => experts.id),
    requestedCount: integer("requested_count").notNull(),
    issuedByAdminId: uuid("issued_by_admin_id")
      .notNull()
      .references(() => users.id),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => adminApprovals.id),
    adminSessionIdHash: text("admin_session_id_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    status: expertReferralBatchStatus("status").notNull().default("issued"),
    createdAt,
  },
  (table) => [
    check(
      "expert_referral_batches_requested_count_bounded",
      sql`${table.requestedCount} between 1 and 1000`,
    ),
    unique("expert_referral_batches_approval_unique").on(table.approvalId),
    unique("expert_referral_batches_id_inviter_unique").on(
      table.id,
      table.inviterExpertId,
    ),
    index("expert_referral_batches_inviter_created_idx").on(
      table.inviterExpertId,
      table.createdAt,
    ),
  ],
);

export const expertReferralCodes = pgTable(
  "expert_referral_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id").notNull(),
    inviterExpertId: uuid("inviter_expert_id")
      .notNull()
      .references(() => experts.id),
    codeHash: text("code_hash").notNull(),
    keyVersion: integer("key_version").notNull(),
    maskedSuffix: text("masked_suffix").notNull(),
    status: expertReferralCodeStatus("status").notNull().default("issued"),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedApprovalId: uuid("revoked_approval_id").references(
      () => adminApprovals.id,
    ),
    revokedAdminSessionIdHash: text("revoked_admin_session_id_hash").references(
      () => adminSessions.sessionIdHash,
    ),
    createdAt,
  },
  (table) => [
    unique("expert_referral_codes_hash_unique").on(table.codeHash),
    unique("expert_referral_codes_id_inviter_unique").on(
      table.id,
      table.inviterExpertId,
    ),
    foreignKey({
      columns: [table.batchId, table.inviterExpertId],
      foreignColumns: [
        expertReferralCodeBatches.id,
        expertReferralCodeBatches.inviterExpertId,
      ],
      name: "expert_referral_codes_batch_owner_fk",
    }),
    check(
      "expert_referral_codes_hash_format",
      sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "expert_referral_codes_key_version_positive",
      sql`${table.keyVersion} > 0`,
    ),
    check(
      "expert_referral_codes_masked_suffix_bounded",
      sql`char_length(${table.maskedSuffix}) between 4 and 12`,
    ),
    check(
      "expert_referral_codes_lifecycle",
      sql`
        (${table.status} = 'issued' and ${table.redeemedAt} is null and ${table.revokedAt} is null and ${table.revokedApprovalId} is null and ${table.revokedAdminSessionIdHash} is null)
        or (${table.status} = 'redeemed' and ${table.redeemedAt} is not null and ${table.revokedAt} is null and ${table.revokedApprovalId} is null and ${table.revokedAdminSessionIdHash} is null)
        or (${table.status} = 'revoked' and ${table.redeemedAt} is null and ${table.revokedAt} is not null and ${table.revokedApprovalId} is not null and ${table.revokedAdminSessionIdHash} is not null)
      `,
    ),
    index("expert_referral_codes_inviter_status_idx").on(
      table.inviterExpertId,
      table.status,
      table.issuedAt,
    ),
  ],
);

export const expertReferrals = pgTable(
  "expert_referrals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codeId: uuid("code_id").notNull(),
    inviterExpertId: uuid("inviter_expert_id")
      .notNull()
      .references(() => experts.id),
    inviteeExpertId: uuid("invitee_expert_id")
      .notNull()
      .references(() => experts.id),
    boundAt: timestamp("bound_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("expert_referrals_code_unique").on(table.codeId),
    unique("expert_referrals_invitee_unique").on(table.inviteeExpertId),
    unique("expert_referrals_id_inviter_unique").on(
      table.id,
      table.inviterExpertId,
    ),
    unique("expert_referrals_id_invitee_unique").on(
      table.id,
      table.inviteeExpertId,
    ),
    foreignKey({
      columns: [table.codeId, table.inviterExpertId],
      foreignColumns: [
        expertReferralCodes.id,
        expertReferralCodes.inviterExpertId,
      ],
      name: "expert_referrals_code_owner_fk",
    }),
    check(
      "expert_referrals_distinct_experts",
      sql`${table.inviterExpertId} <> ${table.inviteeExpertId}`,
    ),
    index("expert_referrals_inviter_idx").on(table.inviterExpertId),
  ],
);

export const expertResidencyTariffVersions = pgTable(
  "expert_residency_tariff_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tariffKey: text("tariff_key").notNull(),
    displayName: text("display_name").notNull(),
    priceMinor: pgBigint("price_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("RUB"),
    durationSeconds: integer("duration_seconds").notNull(),
    activeFrom: timestamp("active_from", { withTimezone: true }).notNull(),
    activeTo: timestamp("active_to", { withTimezone: true }).notNull(),
    commercialPolicyVersion: text("commercial_policy_version")
      .notNull()
      .default("legacy_residency_v1"),
    creditCapBps: integer("credit_cap_bps").notNull().default(5000),
    individualServicesEnabled: boolean("individual_services_enabled")
      .notNull()
      .default(false),
    groupEventLimit: integer("group_event_limit").notNull().default(0),
    statisticsLevel: text("statistics_level").notNull().default("basic"),
    supportPriority: text("support_priority").notNull().default("standard"),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => adminApprovals.id),
    adminSessionIdHash: text("admin_session_id_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    createdAt,
  },
  (table) => [
    unique("expert_tariff_versions_approval_unique").on(table.approvalId),
    check(
      "expert_tariff_price_bounds",
      sql`${table.priceMinor} > 0 and ${table.priceMinor} <= 999999999999`,
    ),
    check("expert_tariff_currency_rub", sql`${table.currency} = 'RUB'`),
    check(
      "expert_tariff_policy_version",
      sql`${table.commercialPolicyVersion} in ('legacy_residency_v1','expert_residency_v2')`,
    ),
    check(
      "expert_tariff_credit_cap",
      sql`${table.creditCapBps} between 0 and 10000`,
    ),
    check(
      "expert_tariff_v2_cap",
      sql`${table.commercialPolicyVersion} <> 'expert_residency_v2' or ${table.creditCapBps} = 3000`,
    ),
    check(
      "expert_tariff_v2_price",
      sql`${table.commercialPolicyVersion} <> 'expert_residency_v2' or ${table.priceMinor} in (390000,590000,999000)`,
    ),
    check(
      "expert_tariff_v2_duration",
      sql`${table.commercialPolicyVersion} <> 'expert_residency_v2' or ${table.durationSeconds} = 2592000`,
    ),
    check(
      "expert_tariff_v2_combination",
      sql`${table.commercialPolicyVersion} <> 'expert_residency_v2' or (${table.tariffKey}='START' and ${table.displayName}='Старт' and ${table.priceMinor}=390000 and ${table.durationSeconds}=2592000 and ${table.creditCapBps}=3000 and ${table.individualServicesEnabled}=true and ${table.groupEventLimit}=0 and ${table.statisticsLevel}='basic' and ${table.supportPriority}='standard') or (${table.tariffKey}='BASE' and ${table.displayName}='База' and ${table.priceMinor}=590000 and ${table.durationSeconds}=2592000 and ${table.creditCapBps}=3000 and ${table.individualServicesEnabled}=true and ${table.groupEventLimit}=1 and ${table.statisticsLevel}='expanded' and ${table.supportPriority}='standard') or (${table.tariffKey}='PRO' and ${table.displayName}='Про' and ${table.priceMinor}=999000 and ${table.durationSeconds}=2592000 and ${table.creditCapBps}=3000 and ${table.individualServicesEnabled}=true and ${table.groupEventLimit}=3 and ${table.statisticsLevel}='expanded' and ${table.supportPriority}='priority')`,
    ),
    check(
      "expert_tariff_group_event_limit",
      sql`${table.groupEventLimit} between 0 and 3`,
    ),
    check(
      "expert_tariff_statistics_level",
      sql`${table.statisticsLevel} in ('basic','expanded')`,
    ),
    check(
      "expert_tariff_support_priority",
      sql`${table.supportPriority} in ('standard','priority')`,
    ),
    check("expert_tariff_duration_positive", sql`${table.durationSeconds} > 0`),
    check(
      "expert_tariff_active_interval_valid",
      sql`${table.activeTo} > ${table.activeFrom}`,
    ),
    index("expert_tariff_lookup_idx").on(table.tariffKey, table.activeFrom),
  ],
);

export const expertTelegramResidencyCallbacks = pgTable(
  "expert_telegram_residency_callbacks",
  {
    tokenHash: char("token_hash", { length: 64 }).primaryKey(),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    telegramUserId: varchar("telegram_user_id", { length: 20 }).notNull(),
    tariffVersionId: uuid("tariff_version_id")
      .notNull()
      .references(() => expertResidencyTariffVersions.id),
    action: text("action").notNull().default("start_residency_checkout"),
    idempotencyKey: text("idempotency_key").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    checkoutStatus: text("checkout_status").notNull().default("issued"),
    checkoutUrl: varchar("checkout_url", { length: 2048 }),
    processingFence: uuid("processing_fence"),
    processingLeaseUntil: timestamp("processing_lease_until", {
      withTimezone: true,
    }),
    outcomeRecordedAt: timestamp("outcome_recorded_at", {
      withTimezone: true,
    }),
    createdAt,
  },
  (table) => [
    unique("expert_telegram_residency_callbacks_idempotency_unique").on(
      table.idempotencyKey,
    ),
    check(
      "expert_telegram_residency_callbacks_action_check",
      sql`${table.action} = 'start_residency_checkout'`,
    ),
    check(
      "expert_telegram_residency_callbacks_token_hash_check",
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "expert_telegram_residency_callbacks_telegram_id_check",
      sql`${table.telegramUserId} ~ '^[1-9][0-9]{0,19}$'`,
    ),
    check(
      "expert_telegram_residency_callbacks_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "expert_telegram_residency_callbacks_checkout_state_check",
      sql`(${table.checkoutStatus} = 'issued' and ${table.consumedAt} is null) or (${table.checkoutStatus} <> 'issued' and ${table.consumedAt} is not null)`,
    ),
    check(
      "expert_telegram_residency_callbacks_processing_lease_check",
      sql`(${table.checkoutStatus} = 'processing' and ${table.processingFence} is not null and ${table.processingLeaseUntil} is not null) or (${table.checkoutStatus} <> 'processing' and ${table.processingFence} is null and ${table.processingLeaseUntil} is null)`,
    ),
    check(
      "expert_telegram_residency_callbacks_checkout_outcome_check",
      sql`((${table.checkoutStatus} in ('issued','processing')) and ${table.outcomeRecordedAt} is null and ${table.checkoutUrl} is null) or (${table.checkoutStatus} in ('unavailable','unknown') and ${table.outcomeRecordedAt} is not null and ${table.checkoutUrl} is null) or (${table.checkoutStatus} = 'ready' and ${table.outcomeRecordedAt} is not null and ${table.checkoutUrl} is not null and char_length(${table.checkoutUrl}) between 1 and 2048 and ${table.checkoutUrl} ~* '^https://[^[:space:]]+$')`,
    ),
    index("expert_telegram_residency_callbacks_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.consumedAt} is null`),
    index("expert_telegram_residency_callbacks_processing_lease_idx")
      .on(table.processingLeaseUntil)
      .where(sql`${table.checkoutStatus} = 'processing'`),
    index("expert_telegram_residency_callbacks_url_cleanup_idx")
      .on(table.expiresAt)
      .where(sql`${table.checkoutUrl} is not null`),
  ],
);

export const expertResidencyOrders = pgTable(
  "expert_residency_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    tariffVersionId: uuid("tariff_version_id")
      .notNull()
      .references(() => expertResidencyTariffVersions.id),
    snapshotDisplayName: text("snapshot_display_name").notNull(),
    priceMinor: pgBigint("price_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("RUB"),
    durationSeconds: integer("duration_seconds").notNull(),
    creditMinor: pgBigint("credit_minor", { mode: "bigint" }).notNull(),
    cashMinor: pgBigint("cash_minor", { mode: "bigint" }).notNull(),
    commercialPolicyVersion: text("commercial_policy_version")
      .notNull()
      .default("legacy_residency_v1"),
    creditCapBps: integer("credit_cap_bps").notNull().default(5000),
    individualServicesEnabled: boolean("individual_services_enabled")
      .notNull()
      .default(false),
    groupEventLimit: integer("group_event_limit").notNull().default(0),
    statisticsLevel: text("statistics_level").notNull().default("basic"),
    supportPriority: text("support_priority").notNull().default("standard"),
    paymentDeadline: timestamp("payment_deadline", {
      withTimezone: true,
    }).notNull(),
    providerDeadline: timestamp("provider_deadline", {
      withTimezone: true,
    }).notNull(),
    providerPaymentId: text("provider_payment_id"),
    status: expertResidencyOrderStatus("status").notNull().default("quoted"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    residencyStartsAt: timestamp("residency_starts_at", { withTimezone: true }),
    residencyEndsAt: timestamp("residency_ends_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("expert_orders_expert_idempotency_unique").on(
      table.expertId,
      table.idempotencyKey,
    ),
    unique("expert_orders_id_expert_unique").on(table.id, table.expertId),
    uniqueIndex("expert_orders_provider_payment_unique")
      .on(table.providerPaymentId)
      .where(sql`${table.providerPaymentId} is not null`),
    check(
      "expert_order_money_bounds",
      sql`
        ${table.priceMinor} > 0 and ${table.priceMinor} <= 999999999999 and
        ${table.creditMinor} >= 0 and ${table.creditMinor} <= 999999999999 and
        ${table.cashMinor} >= 0 and ${table.cashMinor} <= 999999999999
      `,
    ),
    check(
      "expert_order_credit_cap",
      sql`${table.creditCapBps} between 0 and 10000 and ${table.creditMinor} * 10000 <= ${table.priceMinor} * ${table.creditCapBps}`,
    ),
    check(
      "expert_order_policy_version",
      sql`${table.commercialPolicyVersion} in ('legacy_residency_v1','expert_residency_v2')`,
    ),
    check(
      "expert_order_v2_cap",
      sql`${table.commercialPolicyVersion} <> 'expert_residency_v2' or ${table.creditCapBps} = 3000`,
    ),
    check(
      "expert_order_v2_price",
      sql`${table.commercialPolicyVersion} <> 'expert_residency_v2' or ${table.priceMinor} in (390000,590000,999000)`,
    ),
    check(
      "expert_order_v2_duration",
      sql`${table.commercialPolicyVersion} <> 'expert_residency_v2' or ${table.durationSeconds} = 2592000`,
    ),
    check(
      "expert_order_group_event_limit",
      sql`${table.groupEventLimit} between 0 and 3`,
    ),
    check(
      "expert_order_statistics_level",
      sql`${table.statisticsLevel} in ('basic','expanded')`,
    ),
    check(
      "expert_order_support_priority",
      sql`${table.supportPriority} in ('standard','priority')`,
    ),
    check(
      "expert_order_cash_credit_conservation",
      sql`${table.cashMinor} + ${table.creditMinor} = ${table.priceMinor}`,
    ),
    check(
      "expert_order_cash_remainder",
      sql`${table.cashMinor} = ${table.priceMinor} - ${table.creditMinor}`,
    ),
    check("expert_order_currency_rub", sql`${table.currency} = 'RUB'`),
    check("expert_order_duration_positive", sql`${table.durationSeconds} > 0`),
    check(
      "expert_order_deadline_after_creation",
      sql`${table.paymentDeadline} > ${table.createdAt}`,
    ),
    check(
      "expert_order_deadline_not_after_provider",
      sql`${table.paymentDeadline} <= ${table.providerDeadline}`,
    ),
    check(
      "expert_order_settlement_interval",
      sql`
        (${table.settledAt} is null and ${table.residencyStartsAt} is null and ${table.residencyEndsAt} is null)
        or (
          ${table.settledAt} is not null and
          ${table.residencyStartsAt} is not null and
          ${table.residencyEndsAt} is not null and
          ${table.residencyStartsAt} >= ${table.settledAt} and
          ${table.residencyEndsAt} = ${table.residencyStartsAt} + make_interval(secs => ${table.durationSeconds})
        )
      `,
    ),
    index("expert_orders_status_deadline_idx").on(
      table.status,
      table.paymentDeadline,
    ),
  ],
);

export const expertResidencyPaymentAttempts = pgTable(
  "expert_residency_payment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => expertResidencyOrders.id),
    provider: text("provider").notNull(),
    providerRequestId: text("provider_request_id").notNull(),
    expectedAmountMinor: pgBigint("expected_amount_minor", {
      mode: "bigint",
    }).notNull(),
    currency: text("currency").notNull().default("RUB"),
    status: expertResidencyPaymentAttemptStatus("status")
      .notNull()
      .default("created"),
    idempotencyKey: text("idempotency_key").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("expert_payment_attempt_provider_request_unique").on(
      table.provider,
      table.providerRequestId,
    ),
    unique("expert_payment_attempt_idempotency_unique").on(
      table.idempotencyKey,
    ),
    unique("expert_payment_attempt_id_order_unique").on(
      table.id,
      table.orderId,
    ),
    check(
      "expert_payment_attempt_amount_bounds",
      sql`${table.expectedAmountMinor} >= 0 and ${table.expectedAmountMinor} <= 999999999999`,
    ),
    check(
      "expert_payment_attempt_currency_rub",
      sql`${table.currency} = 'RUB'`,
    ),
    check(
      "expert_payment_attempt_resolution",
      sql`
        (${table.status} in ('created', 'pending', 'unknown_outcome') and ${table.resolvedAt} is null)
        or (${table.status} in ('settled', 'failed', 'refunded', 'charged_back') and ${table.resolvedAt} is not null)
      `,
    ),
    index("expert_payment_attempt_order_status_idx").on(
      table.orderId,
      table.status,
    ),
  ],
);

export const expertResidencyProviderOperations = pgTable(
  "expert_residency_provider_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commandId: uuid("command_id").notNull(),
    orderId: uuid("order_id").notNull(),
    paymentAttemptId: uuid("payment_attempt_id").notNull(),
    operationKind: text("operation_kind")
      .$type<"create_payment" | "create_refund">()
      .notNull(),
    provider: text("provider").notNull().default("yookassa"),
    environmentMode: text("environment_mode")
      .$type<"test" | "live">()
      .notNull(),
    providerObjectId: text("provider_object_id"),
    parentPaymentId: text("parent_payment_id"),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("RUB"),
    requestDigest: text("request_digest").notNull(),
    claimDigest: text("claim_digest").notNull(),
    idempotencyKey: uuid("idempotency_key").defaultRandom().notNull(),
    status: text("status")
      .$type<
        | "claimed"
        | "pending"
        | "unknown_outcome"
        | "succeeded"
        | "canceled"
        | "failed"
      >()
      .notNull()
      .default("claimed"),
    reconciliationClaimedAt: timestamp("reconciliation_claimed_at", {
      withTimezone: true,
    }),
    replayCiphertext: text("replay_ciphertext"),
    replayKeyReference: text("replay_key_reference"),
    replayBodyVersion: integer("replay_body_version"),
    recoveryAttempt: integer("recovery_attempt").notNull().default(0),
    recoveryNextAt: timestamp("recovery_next_at", { withTimezone: true }),
    recoveryLeaseToken: uuid("recovery_lease_token"),
    recoveryLeaseUntil: timestamp("recovery_lease_until", {
      withTimezone: true,
    }),
    recoveryExpiresAt: timestamp("recovery_expires_at", { withTimezone: true }),
    manualReviewAt: timestamp("manual_review_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [expertResidencyOrders.id],
      name: "expert_provider_operations_order_fk",
    }),
    foreignKey({
      columns: [table.paymentAttemptId, table.orderId],
      foreignColumns: [
        expertResidencyPaymentAttempts.id,
        expertResidencyPaymentAttempts.orderId,
      ],
      name: "expert_provider_operations_attempt_order_fk",
    }),
    uniqueIndex("expert_provider_operations_command_unique").on(
      table.provider,
      table.commandId,
    ),
    uniqueIndex("expert_provider_operations_idempotency_unique").on(
      table.idempotencyKey,
    ),
    uniqueIndex("expert_provider_operations_object_unique")
      .on(table.provider, table.providerObjectId)
      .where(sql`${table.providerObjectId} is not null`),
    index("expert_provider_operations_reconcile_idx").on(
      table.status,
      table.reconciliationClaimedAt,
      table.createdAt,
      table.id,
    ),
    index("expert_provider_operations_order_kind_idx").on(
      table.orderId,
      table.operationKind,
      table.createdAt,
    ),
    index("expert_provider_operations_unbound_recovery_idx")
      .on(table.recoveryNextAt, table.createdAt, table.id)
      .where(
        sql`${table.providerObjectId} is null and ${table.status} = 'unknown_outcome' and ${table.replayCiphertext} is not null and ${table.manualReviewAt} is null`,
      ),
    check(
      "expert_provider_operations_provider",
      sql`${table.provider} = 'yookassa'`,
    ),
    check(
      "expert_provider_operations_kind",
      sql`${table.operationKind} in ('create_payment','create_refund')`,
    ),
    check(
      "expert_provider_operations_mode",
      sql`${table.environmentMode} in ('test','live')`,
    ),
    check(
      "expert_provider_operations_amount",
      sql`${table.amountMinor} > 0 and ${table.amountMinor} <= 999999999999`,
    ),
    check(
      "expert_provider_operations_currency",
      sql`${table.currency} = 'RUB'`,
    ),
    check(
      "expert_provider_operations_request_digest",
      sql`${table.requestDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "expert_provider_operations_claim_digest",
      sql`${table.claimDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "expert_provider_operations_provider_id",
      sql`${table.providerObjectId} is null or ${table.providerObjectId} ~ '^[A-Za-z0-9_-]{1,64}$'`,
    ),
    check(
      "expert_provider_operations_parent",
      sql`(${table.operationKind} = 'create_payment' and ${table.parentPaymentId} is null) or (${table.operationKind} = 'create_refund' and ${table.parentPaymentId} ~ '^[A-Za-z0-9_-]{1,64}$')`,
    ),
    check(
      "expert_provider_operations_status",
      sql`${table.status} in ('claimed','pending','unknown_outcome','succeeded','canceled','failed')`,
    ),
    check(
      "expert_provider_operations_resolution",
      sql`(${table.status} in ('claimed','pending','unknown_outcome') and ${table.resolvedAt} is null) or (${table.status} in ('succeeded','canceled','failed') and ${table.resolvedAt} is not null)`,
    ),
    check(
      "expert_provider_operations_replay_bundle",
      sql`(${table.replayCiphertext} is null and ${table.replayKeyReference} is null and ${table.replayBodyVersion} is null and ${table.recoveryExpiresAt} is null) or (length(${table.replayCiphertext}) between 1 and 32768 and ${table.replayKeyReference} ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9._/-]{1,192}$' and ${table.replayBodyVersion} between 1 and 2147483647 and ${table.recoveryExpiresAt} is not null)`,
    ),
    check(
      "expert_provider_operations_recovery_attempt",
      sql`${table.recoveryAttempt} between 0 and 100`,
    ),
    check(
      "expert_provider_operations_recovery_lease",
      sql`(${table.recoveryLeaseToken} is null) = (${table.recoveryLeaseUntil} is null)`,
    ),
    check(
      "expert_provider_operations_manual_review",
      sql`${table.manualReviewAt} is null or (${table.providerObjectId} is null and ${table.status} = 'unknown_outcome')`,
    ),
  ],
);

export const expertResidencyReceiptContacts = pgTable(
  "expert_residency_receipt_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    contactKind: text("contact_kind").$type<"email" | "phone">().notNull(),
    ciphertext: text("ciphertext").notNull(),
    keyReference: text("key_reference").notNull(),
    consentId: uuid("consent_id")
      .notNull()
      .references(() => consents.id),
    consentDecision: text("consent_decision")
      .$type<"granted" | "denied">()
      .notNull(),
    consentPurpose: text("consent_purpose").notNull(),
    policyVersion: text("policy_version").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    index("expert_receipt_contacts_authority_idx").on(
      table.userId,
      table.consentPurpose,
      table.policyVersion,
      table.createdAt,
      table.id,
    ),
    check(
      "expert_receipt_contacts_kind",
      sql`${table.contactKind} in ('email','phone')`,
    ),
    check(
      "expert_receipt_contacts_ciphertext",
      sql`length(${table.ciphertext}) between 1 and 8192`,
    ),
    check(
      "expert_receipt_contacts_key_reference",
      sql`${table.keyReference} ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9._/-]{1,192}$'`,
    ),
    check(
      "expert_receipt_contacts_consent",
      sql`${table.consentDecision} in ('granted','denied')`,
    ),
    check(
      "expert_receipt_contacts_verification",
      sql`(${table.consentDecision} = 'granted' and ${table.verifiedAt} is not null) or (${table.consentDecision} = 'denied' and ${table.verifiedAt} is null)`,
    ),
    check(
      "expert_receipt_contacts_revocation",
      sql`${table.revokedAt} is null or (${table.verifiedAt} is not null and ${table.revokedAt} >= ${table.verifiedAt})`,
    ),
  ],
);

export const expertResidencyProviderEventInbox = pgTable(
  "expert_residency_provider_event_inbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    eventKind: text("event_kind").notNull(),
    identityVersion: integer("identity_version").notNull().default(0),
    paymentId: text("payment_id"),
    orderId: uuid("order_id").references(() => expertResidencyOrders.id),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" }),
    currency: text("currency"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    authenticated: boolean("authenticated").notNull(),
    verificationId: text("verification_id"),
    verifierKeyVersion: text("verifier_key_version"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    status: expertResidencyProviderEventStatus("status")
      .notNull()
      .default("received"),
    resultCode: text("result_code"),
    resultPayload: jsonb("result_payload").$type<Record<string, unknown>>(),
    resultSchemaVersion: integer("result_schema_version"),
    resultLegacyExempt: boolean("result_legacy_exempt")
      .notNull()
      .default(false),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("expert_provider_event_unique").on(
      table.provider,
      table.externalEventId,
    ),
    check(
      "expert_provider_event_digest_format",
      sql`${table.payloadDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "expert_provider_verification_id_bounded",
      sql`char_length(${table.verificationId}) between 1 and 200`,
    ),
    check(
      "expert_provider_verifier_key_bounded",
      sql`char_length(${table.verifierKeyVersion}) between 1 and 100`,
    ),
    check(
      "expert_provider_event_amount_bounded",
      sql`${table.amountMinor} >= 0 and ${table.amountMinor} <= 999999999999`,
    ),
    check("expert_provider_event_currency_rub", sql`${table.currency} = 'RUB'`),
    check(
      "expert_provider_event_identity_complete",
      sql`(${table.identityVersion}=0 and ${table.paymentId} is null and ${table.orderId} is null and ${table.amountMinor} is null and ${table.currency} is null and ${table.occurredAt} is null and ${table.verificationId} is null and ${table.verifierKeyVersion} is null and ${table.verifiedAt} is null) or (${table.identityVersion}=1 and ${table.paymentId} is not null and ${table.orderId} is not null and ${table.amountMinor} is not null and ${table.currency} is not null and ${table.occurredAt} is not null and ${table.verificationId} is not null and ${table.verifierKeyVersion} is not null and ${table.verifiedAt} is not null)`,
    ),
    check(
      "expert_provider_event_processing_state",
      sql`
        (${table.status} in ('received', 'processing', 'reconciliation_required') and ${table.processedAt} is null)
        or (${table.status} in ('processed', 'rejected') and ${table.processedAt} is not null)
      `,
    ),
    check(
      "expert_provider_reversal_result_shape",
      sql`${table.eventKind} not in ('refunded','charged_back') or ${table.status} <> 'processed' or (${table.resultLegacyExempt} and ${table.resultSchemaVersion} is null and ${table.resultPayload} is null) or coalesce((${table.resultSchemaVersion} is not distinct from 1 and ${table.resultPayload} is not null and jsonb_typeof(${table.resultPayload})='object' and expert_jsonb_has_exact_keys(${table.resultPayload},array['kind','eventId','paymentId','orderId','cashRefundedMinor','restoredCreditMinor','rewardReversed','debtMinor','terminated']::text[]) and ${table.resultPayload}->>'kind'=${table.eventKind} and ${table.resultPayload}->>'eventId'=${table.externalEventId} and ${table.resultPayload}->>'paymentId'=${table.paymentId} and ${table.resultPayload}->>'orderId'=${table.orderId}::text and ${table.resultPayload}->>'cashRefundedMinor' ~ '^(0|[1-9][0-9]{0,11})$' and ${table.resultPayload}->>'restoredCreditMinor'='0' and jsonb_typeof(${table.resultPayload}->'rewardReversed')='boolean' and ${table.resultPayload}->>'debtMinor' ~ '^(0|[1-9][0-9]{0,11})$' and jsonb_typeof(${table.resultPayload}->'terminated')='boolean'),false)`,
    ),
    index("expert_provider_event_status_received_idx").on(
      table.status,
      table.receivedAt,
    ),
  ],
);

export const expertFirstResidencySettlements = pgTable(
  "expert_first_residency_settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    settlementSequence: bigserial("settlement_sequence", {
      mode: "bigint",
    }).notNull(),
    qualifyingOrderId: uuid("qualifying_order_id").notNull(),
    qualifyingPaymentAttemptId: uuid("qualifying_payment_attempt_id").notNull(),
    referralId: uuid("referral_id"),
    eligibility: expertFirstSettlementEligibility("eligibility").notNull(),
    reasonCode: text("reason_code").notNull(),
    settlementExpertActive: boolean("settlement_expert_active").notNull(),
    settlementExpertVerified: boolean("settlement_expert_verified").notNull(),
    settlementAbuseCleared: boolean("settlement_abuse_cleared").notNull(),
    settlementControlVersion: integer("settlement_control_version")
      .notNull()
      .default(0),
    settlementInviteeUserId: uuid("settlement_invitee_user_id").references(
      () => users.id,
    ),
    settlementInviteeChannelIdentityId: uuid(
      "settlement_invitee_channel_identity_id",
    ).references(() => channelIdentities.id),
    settlementInviterExpertId: uuid("settlement_inviter_expert_id").references(
      () => experts.id,
    ),
    settlementInviterUserId: uuid("settlement_inviter_user_id").references(
      () => users.id,
    ),
    settlementInviterChannelIdentityId: uuid(
      "settlement_inviter_channel_identity_id",
    ).references(() => channelIdentities.id),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    unique("expert_first_settlement_expert_unique").on(table.expertId),
    unique("expert_first_settlement_order_unique").on(table.qualifyingOrderId),
    unique("expert_first_settlement_sequence_unique").on(
      table.settlementSequence,
    ),
    unique("expert_first_settlement_identity_unique").on(
      table.id,
      table.referralId,
      table.qualifyingOrderId,
      table.qualifyingPaymentAttemptId,
    ),
    foreignKey({
      columns: [table.qualifyingOrderId, table.expertId],
      foreignColumns: [
        expertResidencyOrders.id,
        expertResidencyOrders.expertId,
      ],
      name: "expert_first_settlement_order_owner_fk",
    }),
    foreignKey({
      columns: [table.qualifyingPaymentAttemptId, table.qualifyingOrderId],
      foreignColumns: [
        expertResidencyPaymentAttempts.id,
        expertResidencyPaymentAttempts.orderId,
      ],
      name: "expert_first_settlement_payment_order_fk",
    }),
    foreignKey({
      columns: [table.referralId, table.expertId],
      foreignColumns: [expertReferrals.id, expertReferrals.inviteeExpertId],
      name: "expert_first_settlement_referral_invitee_fk",
    }),
    check(
      "expert_first_settlement_eligibility_evidence",
      sql`
        (${table.eligibility} in ('eligible', 'pending_feature_hold') and ${table.referralId} is not null and ${table.settlementExpertActive} and ${table.settlementExpertVerified} and ${table.settlementAbuseCleared})
        or (${table.eligibility} in ('permanently_ineligible', 'cancelled_by_refund'))
      `,
    ),
    check(
      "expert_first_settlement_pending_snapshot_complete",
      sql`${table.eligibility} <> 'pending_feature_hold' or (${table.settlementInviteeUserId} is not null and ${table.settlementInviteeChannelIdentityId} is not null and ${table.settlementInviterExpertId} is not null and ${table.settlementInviterUserId} is not null and ${table.settlementInviterChannelIdentityId} is not null)`,
    ),
  ],
);

export const expertReferralMaturities = pgTable(
  "expert_referral_maturities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firstSettlementId: uuid("first_settlement_id").notNull(),
    referralId: uuid("referral_id").notNull(),
    qualifyingOrderId: uuid("qualifying_order_id").notNull(),
    qualifyingPaymentAttemptId: uuid("qualifying_payment_attempt_id").notNull(),
    inviterExpertId: uuid("inviter_expert_id").notNull().references(() => experts.id),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
    maturesAt: timestamp("matures_at", { withTimezone: true }).notNull(),
    status: expertReferralMaturityStatus("status").notNull().default("pending"),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    terminalReason: text("terminal_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt,
  },
  (table) => [
    unique("expert_referral_maturities_settlement_unique").on(table.firstSettlementId),
    unique("expert_referral_maturities_order_unique").on(table.qualifyingOrderId),
    unique("expert_referral_maturities_payment_unique").on(table.qualifyingPaymentAttemptId),
    unique("expert_referral_maturities_referral_unique").on(table.referralId),
    unique("expert_referral_maturities_idempotency_unique").on(table.idempotencyKey),
    index("expert_referral_maturities_due_idx").on(table.maturesAt, table.id),
    foreignKey({
      columns: [table.firstSettlementId, table.referralId, table.qualifyingOrderId, table.qualifyingPaymentAttemptId],
      foreignColumns: [expertFirstResidencySettlements.id, expertFirstResidencySettlements.referralId, expertFirstResidencySettlements.qualifyingOrderId, expertFirstResidencySettlements.qualifyingPaymentAttemptId],
      name: "expert_referral_maturity_settlement_fk",
    }),
    check("expert_referral_maturity_settled_clock", sql`${table.maturesAt} = ${table.settledAt} + interval '30 days'`),
    check("expert_referral_maturity_idempotency_nonempty", sql`length(${table.idempotencyKey}) between 1 and 256`),
  ],
);

export const expertReferralRewardGrants = pgTable(
  "expert_referral_reward_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    referralId: uuid("referral_id").notNull(),
    firstSettlementId: uuid("first_settlement_id").notNull(),
    qualifyingOrderId: uuid("qualifying_order_id").notNull(),
    qualifyingPaymentAttemptId: uuid("qualifying_payment_attempt_id").notNull(),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" })
      .notNull()
      .default(sql`100000`),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt,
  },
  (table) => [
    unique("expert_reward_grants_referral_unique").on(table.referralId),
    unique("expert_reward_grants_first_settlement_unique").on(
      table.firstSettlementId,
    ),
    unique("expert_reward_grants_qualifying_order_unique").on(
      table.qualifyingOrderId,
    ),
    unique("expert_reward_grants_qualifying_payment_unique").on(
      table.qualifyingPaymentAttemptId,
    ),
    unique("expert_reward_grants_id_expert_unique").on(
      table.id,
      table.expertId,
    ),
    unique("expert_reward_grants_idempotency_unique").on(table.idempotencyKey),
    foreignKey({
      columns: [table.referralId, table.expertId],
      foreignColumns: [expertReferrals.id, expertReferrals.inviterExpertId],
      name: "expert_reward_grants_referral_inviter_fk",
    }),
    foreignKey({
      columns: [
        table.firstSettlementId,
        table.referralId,
        table.qualifyingOrderId,
        table.qualifyingPaymentAttemptId,
      ],
      foreignColumns: [
        expertFirstResidencySettlements.id,
        expertFirstResidencySettlements.referralId,
        expertFirstResidencySettlements.qualifyingOrderId,
        expertFirstResidencySettlements.qualifyingPaymentAttemptId,
      ],
      name: "expert_reward_grants_first_marker_fk",
    }),
    check(
      "expert_reward_grant_exact_amount",
      sql`${table.amountMinor} = 100000`,
    ),
    check(
      "expert_reward_grant_expiry_exact",
      sql`${table.expiresAt} = ${table.grantedAt} + interval '365 days'`,
    ),
    index("expert_reward_grants_expert_expiry_idx").on(
      table.expertId,
      table.expiresAt,
    ),
  ],
);

export const expertReferralLedgerEntries = pgTable(
  "expert_referral_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    entryKind: expertReferralLedgerEntryKind("entry_kind").notNull(),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" }).notNull(),
    orderId: uuid("order_id").references(() => expertResidencyOrders.id),
    originalEntryId: uuid("original_entry_id"),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    adminApprovalId: uuid("admin_approval_id").references(
      () => adminApprovals.id,
    ),
    adminSessionIdHash: text("admin_session_id_hash").references(
      () => adminSessions.sessionIdHash,
    ),
    createdAt,
  },
  (table) => [
    unique("expert_ledger_idempotency_unique").on(table.idempotencyKey),
    unique("expert_ledger_entries_id_expert_unique").on(
      table.id,
      table.expertId,
    ),
    foreignKey({
      columns: [table.originalEntryId],
      foreignColumns: [table.id],
      name: "expert_ledger_original_entry_fk",
    }),
    check(
      "expert_ledger_amount_bounds",
      sql`${table.amountMinor} <> 0 and abs(${table.amountMinor}) <= 999999999999`,
    ),
    check(
      "expert_ledger_kind_contract",
      sql`
        (${table.entryKind} = 'reward_grant' and ${table.amountMinor} > 0 and ${table.orderId} is null and ${table.originalEntryId} is null)
        or (${table.entryKind} = 'reservation' and ${table.amountMinor} < 0 and ${table.orderId} is not null and ${table.originalEntryId} is null)
        or (${table.entryKind} in ('release', 'debt_repayment') and ${table.amountMinor} > 0 and ${table.originalEntryId} is not null)
        or (${table.entryKind} in ('spend', 'expiry', 'reversal') and ${table.amountMinor} < 0 and ${table.originalEntryId} is not null)
        or (${table.entryKind} = 'administrative_correction' and ${table.adminApprovalId} is not null and ${table.adminSessionIdHash} is not null)
      `,
    ),
    check(
      "expert_ledger_admin_binding_complete",
      sql`
        (${table.adminApprovalId} is null and ${table.adminSessionIdHash} is null)
        or (${table.adminApprovalId} is not null and ${table.adminSessionIdHash} is not null)
      `,
    ),
    index("expert_ledger_expert_created_idx").on(
      table.expertId,
      table.createdAt,
    ),
  ],
);

export const expertReferralLedgerAllocations = pgTable(
  "expert_referral_ledger_allocations",
  {
    ledgerEntryId: uuid("ledger_entry_id").notNull(),
    rewardGrantId: uuid("reward_grant_id").notNull(),
    expertId: uuid("expert_id").notNull(),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" }).notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({
      columns: [table.ledgerEntryId, table.rewardGrantId],
      name: "expert_ledger_allocations_pk",
    }),
    foreignKey({
      columns: [table.ledgerEntryId, table.expertId],
      foreignColumns: [
        expertReferralLedgerEntries.id,
        expertReferralLedgerEntries.expertId,
      ],
      name: "expert_ledger_allocations_entry_owner_fk",
    }),
    foreignKey({
      columns: [table.rewardGrantId, table.expertId],
      foreignColumns: [
        expertReferralRewardGrants.id,
        expertReferralRewardGrants.expertId,
      ],
      name: "expert_ledger_allocations_grant_owner_fk",
    }),
    check(
      "expert_ledger_allocation_nonzero",
      sql`${table.amountMinor} <> 0 and abs(${table.amountMinor}) <= 999999999999`,
    ),
    index("expert_ledger_allocations_grant_idx").on(table.rewardGrantId),
  ],
);

export const expertReferralIssuanceOverrides = pgTable(
  "expert_referral_issuance_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inviterExpertId: uuid("inviter_expert_id")
      .notNull()
      .references(() => experts.id),
    additionalQuota: integer("additional_quota").notNull(),
    consumedCount: integer("consumed_count").notNull().default(0),
    reasonCode: text("reason_code").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    approverOneId: uuid("approver_one_id")
      .notNull()
      .references(() => users.id),
    approverTwoId: uuid("approver_two_id")
      .notNull()
      .references(() => users.id),
    approvalOneId: uuid("approval_one_id")
      .notNull()
      .references(() => adminApprovals.id),
    approvalTwoId: uuid("approval_two_id")
      .notNull()
      .references(() => adminApprovals.id),
    requesterSessionIdHash: text("requester_session_id_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    createdAt,
  },
  (table) => [
    unique("expert_issuance_overrides_approval_one_unique").on(
      table.approvalOneId,
    ),
    unique("expert_issuance_overrides_approval_two_unique").on(
      table.approvalTwoId,
    ),
    check(
      "expert_issuance_override_quota_bounded",
      sql`${table.additionalQuota} between 1 and 1000 and ${table.consumedCount} between 0 and ${table.additionalQuota}`,
    ),
    check(
      "expert_issuance_override_reason_bounded",
      sql`char_length(${table.reasonCode}) between 1 and 128`,
    ),
    check(
      "expert_issuance_override_validity",
      sql`${table.validUntil} > ${table.validFrom}`,
    ),
    check(
      "expert_issuance_override_distinct_approvers",
      sql`${table.approverOneId} <> ${table.approverTwoId} and ${table.requesterId} <> ${table.approverOneId} and ${table.requesterId} <> ${table.approverTwoId} and ${table.approvalOneId} <> ${table.approvalTwoId}`,
    ),
    index("expert_issuance_overrides_inviter_validity_idx").on(
      table.inviterExpertId,
      table.validUntil,
    ),
  ],
);

export const expertReferralAbuseHolds = pgTable(
  "expert_referral_abuse_holds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    status: expertReferralAbuseHoldStatus("status").notNull().default("open"),
    reasonCode: text("reason_code").notNull(),
    openedApprovalId: uuid("opened_approval_id")
      .notNull()
      .references(() => adminApprovals.id),
    openedAdminSessionIdHash: text("opened_admin_session_id_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedApprovalId: uuid("closed_approval_id").references(
      () => adminApprovals.id,
    ),
    closedAdminSessionIdHash: text("closed_admin_session_id_hash").references(
      () => adminSessions.sessionIdHash,
    ),
    closedReasonCode: text("closed_reason_code"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    unique("expert_abuse_holds_opened_approval_unique").on(
      table.openedApprovalId,
    ),
    uniqueIndex("expert_abuse_holds_closed_approval_unique")
      .on(table.closedApprovalId)
      .where(sql`${table.closedApprovalId} is not null`),
    uniqueIndex("expert_abuse_holds_one_open_per_expert")
      .on(table.expertId)
      .where(sql`${table.status} = 'open'`),
    check(
      "expert_abuse_holds_reason_bounded",
      sql`char_length(${table.reasonCode}) between 1 and 128 and (${table.closedReasonCode} is null or char_length(${table.closedReasonCode}) between 1 and 128)`,
    ),
    check(
      "expert_abuse_holds_lifecycle",
      sql`
        (${table.status} = 'open' and ${table.closedApprovalId} is null and ${table.closedAdminSessionIdHash} is null and ${table.closedReasonCode} is null and ${table.closedAt} is null)
        or (${table.status} = 'closed' and ${table.closedApprovalId} is not null and ${table.closedAdminSessionIdHash} is not null and ${table.closedReasonCode} is not null and ${table.closedAt} >= ${table.openedAt})
      `,
    ),
  ],
);

export const expertReferralFeatureControls = pgTable(
  "expert_referral_feature_controls",
  {
    controlKey: text("control_key").primaryKey().default("expert_referrals"),
    version: integer("version").notNull(),
    newCommandsEnabled: boolean("new_commands_enabled")
      .notNull()
      .default(false),
    rewardGrantsEnabled: boolean("reward_grants_enabled")
      .notNull()
      .default(false),
    updatedApprovalId: uuid("updated_approval_id")
      .notNull()
      .references(() => adminApprovals.id),
    updatedAdminSessionIdHash: text("updated_admin_session_id_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    updatedAt,
  },
  (table) => [
    check(
      "expert_referral_controls_singleton",
      sql`${table.controlKey} = 'expert_referrals'`,
    ),
    check(
      "expert_referral_controls_version_positive",
      sql`${table.version} > 0`,
    ),
    unique("expert_referral_controls_approval_unique").on(
      table.updatedApprovalId,
    ),
  ],
);

export const expertReferralBalances = pgView("expert_referral_balances", {
  expertId: uuid("expert_id").notNull(),
  availableCreditMinor: pgBigint("available_credit_minor", {
    mode: "bigint",
  }).notNull(),
  reservedCreditMinor: pgBigint("reserved_credit_minor", {
    mode: "bigint",
  }).notNull(),
  nearestExpiryAt: timestamp("nearest_expiry_at", { withTimezone: true }),
  lifetimeGrantedMinor: pgBigint("lifetime_granted_minor", {
    mode: "bigint",
  }).notNull(),
  lifetimeSpentMinor: pgBigint("lifetime_spent_minor", {
    mode: "bigint",
  }).notNull(),
  lifetimeExpiredMinor: pgBigint("lifetime_expired_minor", {
    mode: "bigint",
  }).notNull(),
  debtMinor: pgBigint("debt_minor", { mode: "bigint" }).notNull(),
}).as(sql`
  with ledger_totals as (
    select
      expert_id,
      coalesce(sum(amount_minor), 0)::bigint as net_minor,
      coalesce(-sum(amount_minor) filter (where entry_kind in ('reservation', 'release')), 0)::bigint as reserved_minor,
      coalesce(sum(amount_minor) filter (where entry_kind = 'reward_grant'), 0)::bigint as granted_minor,
      coalesce(-sum(amount_minor) filter (where entry_kind = 'spend'), 0)::bigint as spent_minor,
      coalesce(-sum(amount_minor) filter (where entry_kind = 'expiry'), 0)::bigint as expired_minor
    from expert_referral_ledger_entries
    group by expert_id
  ), grant_remaining as (
    select
      g.id,
      g.expert_id,
      g.expires_at,
      coalesce(sum(a.amount_minor), 0)::bigint as remaining_minor
    from expert_referral_reward_grants g
    left join expert_referral_ledger_allocations a
      on a.reward_grant_id = g.id
    where g.expires_at > transaction_timestamp()
    group by g.id, g.expert_id, g.expires_at
    having sum(a.amount_minor) > 0
  ), grant_expiry as (
    select expert_id, min(expires_at) as nearest_expiry_at
    from grant_remaining
    group by expert_id
  )
  select
    e.id as expert_id,
    greatest(coalesce(l.net_minor, 0), 0)::bigint as available_credit_minor,
    greatest(coalesce(l.reserved_minor, 0), 0)::bigint as reserved_credit_minor,
    g.nearest_expiry_at,
    greatest(coalesce(l.granted_minor, 0), 0)::bigint as lifetime_granted_minor,
    greatest(coalesce(l.spent_minor, 0), 0)::bigint as lifetime_spent_minor,
    greatest(coalesce(l.expired_minor, 0), 0)::bigint as lifetime_expired_minor,
    greatest(-coalesce(l.net_minor, 0), 0)::bigint as debt_minor
  from experts e
  left join ledger_totals l on l.expert_id = e.id
  left join grant_expiry g on g.expert_id = e.id
`);
