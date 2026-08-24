import { sql } from "drizzle-orm";
import {
  bigint as pgBigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { adminApprovals, adminSessions } from "./audit.js";
import { experts } from "./catalog.js";
import { users } from "./identity.js";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();

export const expertReferralBatchStatus = pgEnum(
  "expert_referral_batch_status",
  ["issued"],
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
  ["created", "pending", "unknown_outcome", "succeeded", "failed", "cancelled"],
);
export const expertResidencyProviderEventStatus = pgEnum(
  "expert_residency_provider_event_status",
  ["pending", "processing", "processed", "failed"],
);
export const expertFirstSettlementEligibility = pgEnum(
  "expert_first_settlement_eligibility",
  ["eligible", "ineligible", "pending_feature_hold", "cancelled_by_refund"],
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
      "expert_referral_batch_count_bounds",
      sql`${table.requestedCount} between 1 and 1000`,
    ),
    unique("expert_referral_batch_identity_unique").on(
      table.id,
      table.inviterExpertId,
    ),
    unique("expert_referral_batch_approval_unique").on(table.approvalId),
    index("expert_referral_batch_inviter_created").on(
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
    maskedSuffix: text("masked_suffix").notNull(),
    hmacKeyVersion: integer("hmac_key_version").notNull(),
    status: expertReferralCodeStatus("status").notNull().default("issued"),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationApprovalId: uuid("revocation_approval_id").references(
      () => adminApprovals.id,
    ),
    revokedByAdminId: uuid("revoked_by_admin_id").references(() => users.id),
    revocationAdminSessionIdHash: text(
      "revocation_admin_session_id_hash",
    ).references(() => adminSessions.sessionIdHash),
  },
  (table) => [
    foreignKey({
      columns: [table.batchId, table.inviterExpertId],
      foreignColumns: [
        expertReferralCodeBatches.id,
        expertReferralCodeBatches.inviterExpertId,
      ],
      name: "expert_referral_code_batch_inviter_fk",
    }),
    unique("expert_referral_code_identity_unique").on(
      table.id,
      table.inviterExpertId,
    ),
    unique("expert_referral_code_hash_unique").on(
      table.hmacKeyVersion,
      table.codeHash,
    ),
    check(
      "expert_referral_code_key_version_positive",
      sql`${table.hmacKeyVersion} > 0`,
    ),
    check(
      "expert_referral_code_mask_present",
      sql`char_length(${table.maskedSuffix}) between 1 and 32`,
    ),
    check(
      "expert_referral_code_lifecycle",
      sql`
        (${table.status} = 'issued' and ${table.redeemedAt} is null and ${table.revokedAt} is null and ${table.revocationApprovalId} is null and ${table.revokedByAdminId} is null and ${table.revocationAdminSessionIdHash} is null)
        or (${table.status} = 'redeemed' and ${table.redeemedAt} is not null and ${table.revokedAt} is null and ${table.revocationApprovalId} is null and ${table.revokedByAdminId} is null and ${table.revocationAdminSessionIdHash} is null)
        or (${table.status} = 'revoked' and ${table.redeemedAt} is null and ${table.revokedAt} is not null and ${table.revocationApprovalId} is not null and ${table.revokedByAdminId} is not null and ${table.revocationAdminSessionIdHash} is not null)
      `,
    ),
    index("expert_referral_code_inventory").on(
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
    foreignKey({
      columns: [table.codeId, table.inviterExpertId],
      foreignColumns: [
        expertReferralCodes.id,
        expertReferralCodes.inviterExpertId,
      ],
      name: "expert_referral_code_inviter_fk",
    }),
    unique("expert_referral_code_unique").on(table.codeId),
    unique("expert_referral_invitee_unique").on(table.inviteeExpertId),
    check(
      "expert_referral_distinct_experts",
      sql`${table.inviterExpertId} <> ${table.inviteeExpertId}`,
    ),
    index("expert_referral_inviter_bound").on(
      table.inviterExpertId,
      table.boundAt,
    ),
  ],
);

export const expertResidencyTariffVersions = pgTable(
  "expert_residency_tariff_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tariffKey: text("tariff_key").notNull(),
    version: integer("version").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    priceMinor: pgBigint("price_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    activeFrom: timestamp("active_from", { withTimezone: true }).notNull(),
    activeTo: timestamp("active_to", { withTimezone: true }),
    createdByAdminId: uuid("created_by_admin_id")
      .notNull()
      .references(() => users.id),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => adminApprovals.id),
    adminSessionIdHash: text("admin_session_id_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    createdAt,
  },
  (table) => [
    unique("expert_tariff_version_unique").on(table.tariffKey, table.version),
    unique("expert_tariff_approval_unique").on(table.approvalId),
    check("expert_tariff_version_positive", sql`${table.version} > 0`),
    check("expert_tariff_price_positive", sql`${table.priceMinor} > 0`),
    check("expert_tariff_currency_rub", sql`${table.currency} = 'RUB'`),
    check(
      "expert_tariff_duration_bounds",
      sql`${table.durationSeconds} between 86400 and 315360000`,
    ),
    check(
      "expert_tariff_active_interval",
      sql`${table.activeTo} is null or ${table.activeTo} > ${table.activeFrom}`,
    ),
    index("expert_tariff_activation_lookup").on(
      table.tariffKey,
      table.activeFrom,
      table.activeTo,
    ),
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
    tariffName: text("tariff_name").notNull(),
    tariffDescription: text("tariff_description").notNull(),
    priceMinor: pgBigint("price_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    creditMinor: pgBigint("credit_minor", { mode: "bigint" }).notNull(),
    cashMinor: pgBigint("cash_minor", { mode: "bigint" }).notNull(),
    paymentDeadline: timestamp("payment_deadline", {
      withTimezone: true,
    }).notNull(),
    providerDeadline: timestamp("provider_deadline", {
      withTimezone: true,
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    paymentProvider: text("payment_provider"),
    providerPaymentId: text("provider_payment_id"),
    status: expertResidencyOrderStatus("status").notNull().default("quoted"),
    quotedAt: timestamp("quoted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paymentStartedAt: timestamp("payment_started_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    residencyStartsAt: timestamp("residency_starts_at", { withTimezone: true }),
    residencyEndsAt: timestamp("residency_ends_at", { withTimezone: true }),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("expert_order_idempotency_unique").on(table.idempotencyKey),
    check("expert_order_price_positive", sql`${table.priceMinor} > 0`),
    check(
      "expert_order_nonnegative_quotes",
      sql`${table.creditMinor} >= 0 and ${table.cashMinor} >= 0`,
    ),
    check(
      "expert_order_credit_cap",
      sql`${table.creditMinor} <= ${table.priceMinor} / 2`,
    ),
    check(
      "expert_order_cash_remainder",
      sql`${table.cashMinor} = ${table.priceMinor} - ${table.creditMinor}`,
    ),
    check("expert_order_currency_rub", sql`${table.currency} = 'RUB'`),
    check(
      "expert_order_duration_bounds",
      sql`${table.durationSeconds} between 86400 and 315360000`,
    ),
    check(
      "expert_order_payment_deadline_after_quote",
      sql`${table.paymentDeadline} > ${table.quotedAt}`,
    ),
    check(
      "expert_order_provider_deadline_after_quote",
      sql`${table.providerDeadline} > ${table.quotedAt}`,
    ),
    check(
      "expert_order_provider_identity_complete",
      sql`(${table.paymentProvider} is null and ${table.providerPaymentId} is null) or (${table.paymentProvider} is not null and ${table.providerPaymentId} is not null)`,
    ),
    check(
      "expert_order_residency_interval_complete",
      sql`
        (${table.settledAt} is null and ${table.residencyStartsAt} is null and ${table.residencyEndsAt} is null)
        or (${table.settledAt} is not null and ${table.residencyStartsAt} is not null and ${table.residencyEndsAt} is not null and extract(epoch from (${table.residencyEndsAt} - ${table.residencyStartsAt})) = ${table.durationSeconds})
      `,
    ),
    uniqueIndex("expert_order_provider_payment_unique")
      .on(table.paymentProvider, table.providerPaymentId)
      .where(
        sql`${table.paymentProvider} is not null and ${table.providerPaymentId} is not null`,
      ),
    index("expert_order_expert_status_deadline").on(
      table.expertId,
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
    currency: text("currency").notNull(),
    status: expertResidencyPaymentAttemptStatus("status")
      .notNull()
      .default("created"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("expert_payment_attempt_provider_request_unique").on(
      table.provider,
      table.providerRequestId,
    ),
    unique("expert_payment_attempt_idempotency_unique").on(
      table.idempotencyKey,
    ),
    check(
      "expert_payment_attempt_amount_positive",
      sql`${table.expectedAmountMinor} > 0`,
    ),
    check(
      "expert_payment_attempt_currency_rub",
      sql`${table.currency} = 'RUB'`,
    ),
    index("expert_payment_attempt_order_status").on(
      table.orderId,
      table.status,
    ),
  ],
);

export const expertResidencyProviderEventInbox = pgTable(
  "expert_residency_provider_event_inbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    paymentAttemptId: uuid("payment_attempt_id").references(
      () => expertResidencyPaymentAttempts.id,
    ),
    orderId: uuid("order_id").references(() => expertResidencyOrders.id),
    payloadDigest: text("payload_digest").notNull(),
    authenticated: boolean("authenticated").notNull(),
    eventKind: text("event_kind").notNull(),
    processingStatus: expertResidencyProviderEventStatus("processing_status")
      .notNull()
      .default("pending"),
    processingResultDigest: text("processing_result_digest"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    unique("expert_provider_event_unique").on(
      table.provider,
      table.externalEventId,
    ),
    check(
      "expert_provider_event_processing_result",
      sql`
        (${table.processingStatus} in ('pending', 'processing') and ${table.processedAt} is null)
        or (${table.processingStatus} in ('processed', 'failed') and ${table.processedAt} is not null and ${table.processingResultDigest} is not null)
      `,
    ),
    index("expert_provider_event_processing_queue").on(
      table.processingStatus,
      table.receivedAt,
    ),
  ],
);

export const expertFirstResidencySettlements = pgTable(
  "expert_first_residency_settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    settlementSequence: bigserial("settlement_sequence", {
      mode: "bigint",
    }).notNull(),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    qualifyingOrderId: uuid("qualifying_order_id")
      .notNull()
      .references(() => expertResidencyOrders.id),
    eligibilityStatus:
      expertFirstSettlementEligibility("eligibility_status").notNull(),
    eligibilityReasonCode: text("eligibility_reason_code").notNull(),
    expertActive: boolean("expert_active").notNull(),
    expertVerified: boolean("expert_verified").notNull(),
    uniqueIdentity: boolean("unique_identity").notNull(),
    abuseCleared: boolean("abuse_cleared").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    unique("expert_first_settlement_expert_unique").on(table.expertId),
    unique("expert_first_settlement_order_unique").on(table.qualifyingOrderId),
    unique("expert_first_settlement_sequence_unique").on(
      table.settlementSequence,
    ),
    check(
      "expert_first_settlement_eligibility_snapshot",
      sql`${table.eligibilityStatus} not in ('eligible', 'pending_feature_hold') or (${table.expertActive} and ${table.expertVerified} and ${table.uniqueIdentity} and ${table.abuseCleared})`,
    ),
  ],
);

export const expertReferralRewardGrants = pgTable(
  "expert_referral_reward_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inviterExpertId: uuid("inviter_expert_id")
      .notNull()
      .references(() => experts.id),
    referralId: uuid("referral_id")
      .notNull()
      .references(() => expertReferrals.id),
    qualifyingOrderId: uuid("qualifying_order_id")
      .notNull()
      .references(() => expertResidencyOrders.id),
    firstSettlementId: uuid("first_settlement_id")
      .notNull()
      .references(() => expertFirstResidencySettlements.id),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("expert_reward_referral_unique").on(table.referralId),
    unique("expert_reward_order_unique").on(table.qualifyingOrderId),
    unique("expert_reward_first_settlement_unique").on(table.firstSettlementId),
    check("expert_reward_exact_amount", sql`${table.amountMinor} = 100000`),
    check(
      "expert_reward_exact_expiry",
      sql`extract(epoch from (${table.expiresAt} - ${table.grantedAt})) = 31536000`,
    ),
    index("expert_reward_inviter_expiry").on(
      table.inviterExpertId,
      table.expiresAt,
      table.grantedAt,
      table.id,
    ),
  ],
);

export const expertReferralLedgerEntries = pgTable(
  "expert_referral_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountExpertId: uuid("account_expert_id")
      .notNull()
      .references(() => experts.id),
    entryKind: expertReferralLedgerEntryKind("entry_kind").notNull(),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" }).notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    rewardGrantId: uuid("reward_grant_id"),
    originalEntryId: uuid("original_entry_id"),
    adminApprovalId: uuid("admin_approval_id").references(
      () => adminApprovals.id,
    ),
    adminSessionIdHash: text("admin_session_id_hash").references(
      () => adminSessions.sessionIdHash,
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt,
  },
  (table) => [
    foreignKey({
      columns: [table.rewardGrantId],
      foreignColumns: [expertReferralRewardGrants.id],
      name: "expert_ledger_reward_grant_fk",
    }),
    foreignKey({
      columns: [table.originalEntryId],
      foreignColumns: [table.id],
      name: "expert_ledger_original_entry_fk",
    }),
    unique("expert_ledger_idempotency_unique").on(table.idempotencyKey),
    unique("expert_ledger_source_fact_unique").on(
      table.entryKind,
      table.sourceType,
      table.sourceId,
    ),
    check(
      "expert_ledger_entry_contract",
      sql`
        (${table.entryKind} = 'reward_grant' and ${table.amountMinor} > 0 and ${table.sourceType} = 'reward_grant' and ${table.sourceId} = ${table.rewardGrantId} and ${table.rewardGrantId} is not null and ${table.originalEntryId} is null and ${table.adminApprovalId} is null and ${table.adminSessionIdHash} is null)
        or (${table.entryKind} = 'reservation' and ${table.amountMinor} < 0 and ${table.rewardGrantId} is null and ${table.originalEntryId} is null and ${table.adminApprovalId} is null and ${table.adminSessionIdHash} is null)
        or (${table.entryKind} = 'release' and ${table.amountMinor} > 0 and ${table.rewardGrantId} is null and ${table.originalEntryId} is not null and ${table.adminApprovalId} is null and ${table.adminSessionIdHash} is null)
        or (${table.entryKind} = 'spend' and ${table.amountMinor} < 0 and ${table.rewardGrantId} is null and ${table.originalEntryId} is not null and ${table.adminApprovalId} is null and ${table.adminSessionIdHash} is null)
        or (${table.entryKind} in ('expiry', 'reversal') and ${table.amountMinor} < 0 and ${table.sourceType} = 'reward_grant' and ${table.rewardGrantId} is null and ${table.originalEntryId} is not null and ${table.adminApprovalId} is null and ${table.adminSessionIdHash} is null)
        or (${table.entryKind} = 'debt_repayment' and ${table.amountMinor} > 0 and ${table.sourceType} = 'reward_grant' and ${table.rewardGrantId} is null and ${table.originalEntryId} is not null and ${table.adminApprovalId} is null and ${table.adminSessionIdHash} is null)
        or (${table.entryKind} = 'administrative_correction' and ${table.amountMinor} <> 0 and ${table.rewardGrantId} is null and ${table.adminApprovalId} is not null and ${table.adminSessionIdHash} is not null)
      `,
    ),
    uniqueIndex("expert_ledger_reward_grant_unique")
      .on(table.rewardGrantId)
      .where(sql`${table.entryKind} = 'reward_grant'`),
    uniqueIndex("expert_ledger_reservation_terminal_unique")
      .on(table.originalEntryId)
      .where(sql`${table.entryKind} in ('release', 'spend')`),
    index("expert_ledger_account_created").on(
      table.accountExpertId,
      table.createdAt,
      table.id,
    ),
    index("expert_ledger_original_entry").on(table.originalEntryId),
  ],
);

export const expertReferralLedgerAllocations = pgTable(
  "expert_referral_ledger_allocations",
  {
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => expertReferralLedgerEntries.id),
    rewardGrantId: uuid("reward_grant_id")
      .notNull()
      .references(() => expertReferralRewardGrants.id),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" }).notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({
      columns: [table.ledgerEntryId, table.rewardGrantId],
      name: "expert_ledger_allocation_pk",
    }),
    check("expert_ledger_allocation_positive", sql`${table.amountMinor} > 0`),
    index("expert_ledger_allocation_grant").on(
      table.rewardGrantId,
      table.ledgerEntryId,
    ),
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
    reason: text("reason").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    requestedByAdminId: uuid("requested_by_admin_id")
      .notNull()
      .references(() => users.id),
    requesterSessionIdHash: text("requester_session_id_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    firstApproverId: uuid("first_approver_id")
      .notNull()
      .references(() => users.id),
    secondApproverId: uuid("second_approver_id")
      .notNull()
      .references(() => users.id),
    firstApprovalId: uuid("first_approval_id")
      .notNull()
      .references(() => adminApprovals.id),
    secondApprovalId: uuid("second_approval_id")
      .notNull()
      .references(() => adminApprovals.id),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    unique("expert_issuance_override_first_approval_unique").on(
      table.firstApprovalId,
    ),
    unique("expert_issuance_override_second_approval_unique").on(
      table.secondApprovalId,
    ),
    check(
      "expert_issuance_override_quota_bounds",
      sql`${table.additionalQuota} between 1 and 1000 and ${table.consumedCount} between 0 and ${table.additionalQuota}`,
    ),
    check(
      "expert_issuance_override_approval_separation",
      sql`${table.requestedByAdminId} <> ${table.firstApproverId} and ${table.requestedByAdminId} <> ${table.secondApproverId} and ${table.firstApproverId} <> ${table.secondApproverId} and ${table.firstApprovalId} <> ${table.secondApprovalId}`,
    ),
    check(
      "expert_issuance_override_interval",
      sql`${table.expiresAt} > ${table.validFrom}`,
    ),
    index("expert_issuance_override_inviter_expiry").on(
      table.inviterExpertId,
      table.expiresAt,
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
    openedByAdminId: uuid("opened_by_admin_id")
      .notNull()
      .references(() => users.id),
    openedAdminSessionIdHash: text("opened_admin_session_id_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedApprovalId: uuid("closed_approval_id").references(
      () => adminApprovals.id,
    ),
    closedByAdminId: uuid("closed_by_admin_id").references(() => users.id),
    closedAdminSessionIdHash: text("closed_admin_session_id_hash").references(
      () => adminSessions.sessionIdHash,
    ),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    unique("expert_abuse_hold_opened_approval_unique").on(
      table.openedApprovalId,
    ),
    uniqueIndex("expert_abuse_hold_closed_approval_unique")
      .on(table.closedApprovalId)
      .where(sql`${table.closedApprovalId} is not null`),
    uniqueIndex("expert_abuse_hold_one_open")
      .on(table.expertId)
      .where(sql`${table.status} = 'open'`),
    check("expert_abuse_hold_version_positive", sql`${table.version} > 0`),
    check(
      "expert_abuse_hold_lifecycle",
      sql`
        (${table.status} = 'open' and ${table.closedApprovalId} is null and ${table.closedByAdminId} is null and ${table.closedAdminSessionIdHash} is null and ${table.closedAt} is null)
        or (${table.status} = 'closed' and ${table.closedApprovalId} is not null and ${table.closedByAdminId} is not null and ${table.closedAdminSessionIdHash} is not null and ${table.closedAt} is not null and ${table.closedAt} >= ${table.openedAt})
      `,
    ),
  ],
);

export const expertReferralFeatureControls = pgTable(
  "expert_referral_feature_controls",
  {
    featureKey: text("feature_key").primaryKey(),
    version: integer("version").notNull(),
    newCommandsEnabled: boolean("new_commands_enabled")
      .notNull()
      .default(false),
    rewardGrantsEnabled: boolean("reward_grants_enabled")
      .notNull()
      .default(false),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => adminApprovals.id),
    changedByAdminId: uuid("changed_by_admin_id")
      .notNull()
      .references(() => users.id),
    adminSessionIdHash: text("admin_session_id_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("expert_feature_control_approval_unique").on(table.approvalId),
    check(
      "expert_feature_control_singleton",
      sql`${table.featureKey} = 'expert_referrals'`,
    ),
    check("expert_feature_control_version_positive", sql`${table.version} > 0`),
  ],
);

export const expertReferralBalances = pgView("expert_referral_balances", {
  expertId: uuid("expert_id").notNull(),
  spendableBalanceMinor: pgBigint("spendable_balance_minor", {
    mode: "bigint",
  }).notNull(),
  reservedBalanceMinor: pgBigint("reserved_balance_minor", {
    mode: "bigint",
  }).notNull(),
  debtMinor: pgBigint("debt_minor", { mode: "bigint" }).notNull(),
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
}).as(sql`
  with grant_positions as (
    select
      g.id as grant_id,
      g.inviter_expert_id as expert_id,
      g.expires_at,
      coalesce(sum(
        case
          when l.entry_kind in ('release', 'debt_repayment') then 0
          when l.entry_kind = 'reservation' and exists (
            select 1
            from expert_referral_ledger_entries terminal
            where terminal.original_entry_id = l.id
              and terminal.entry_kind in ('release', 'spend')
          ) then 0
          when l.amount_minor < 0 then -a.amount_minor
          else a.amount_minor
        end
      ), 0)::bigint as net_minor
    from expert_referral_reward_grants g
    left join expert_referral_ledger_allocations a on a.reward_grant_id = g.id
    left join expert_referral_ledger_entries l on l.id = a.ledger_entry_id
    group by g.id, g.inviter_expert_id, g.expires_at
  ), account_positions as (
    select
      e.id as expert_id,
      coalesce(sum(
        case
          when p.expires_at > statement_timestamp()
          then greatest(p.net_minor, 0)
          else 0
        end
      ), 0)::bigint as current_credit_minor,
      coalesce(sum(greatest(-p.net_minor, 0)), 0)::bigint as debt_minor,
      min(p.expires_at) filter (
        where p.expires_at > statement_timestamp() and p.net_minor > 0
      ) as nearest_expiry_at
    from experts e
    left join grant_positions p on p.expert_id = e.id
    group by e.id
  ), active_reservations as (
    select
      l.account_expert_id as expert_id,
      coalesce(sum(a.amount_minor), 0)::bigint as reserved_minor
    from expert_referral_ledger_entries l
    join expert_referral_ledger_allocations a on a.ledger_entry_id = l.id
    join expert_referral_reward_grants g on g.id = a.reward_grant_id
    where l.entry_kind = 'reservation'
      and g.expires_at > statement_timestamp()
      and not exists (
        select 1
        from expert_referral_ledger_entries terminal
        join expert_referral_ledger_allocations terminal_allocation
          on terminal_allocation.ledger_entry_id = terminal.id
          and terminal_allocation.reward_grant_id = a.reward_grant_id
        where terminal.original_entry_id = l.id
          and terminal.entry_kind in ('release', 'spend')
      )
    group by l.account_expert_id
  ), lifetime_totals as (
    select
      e.id as expert_id,
      coalesce(sum(l.amount_minor) filter (where l.entry_kind = 'reward_grant'), 0)::bigint as lifetime_granted_minor,
      coalesce(sum(-l.amount_minor) filter (where l.entry_kind = 'spend'), 0)::bigint as lifetime_spent_minor,
      coalesce(sum(-l.amount_minor) filter (where l.entry_kind = 'expiry'), 0)::bigint as lifetime_expired_minor
    from experts e
    left join expert_referral_ledger_entries l on l.account_expert_id = e.id
    group by e.id
  )
  select
    p.expert_id,
    case when p.debt_minor > 0 then 0 else p.current_credit_minor end::bigint as spendable_balance_minor,
    coalesce(r.reserved_minor, 0)::bigint as reserved_balance_minor,
    p.debt_minor,
    p.nearest_expiry_at,
    l.lifetime_granted_minor,
    l.lifetime_spent_minor,
    l.lifetime_expired_minor
  from account_positions p
  join lifetime_totals l on l.expert_id = p.expert_id
  left join active_reservations r on r.expert_id = p.expert_id
`);
