// Derived from the hand-authored 0081 catalogue. SQL migrations remain authoritative.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { earlyBirdLaunchConfigs } from "./early-bird-launch-config.js";
import { earlyBirdChoices } from "./early-bird-choices.js";
import { expertSalesBases } from "./expert-separated-sales.js";
import { ownerTestPricingGrants } from "./owner-test-pricing.js";
import { residentReviewEvents } from "./resident-review.js";

export const earlyBirdAdmissions = pgTable(
  "early_bird_admissions",
  {
    intentId: uuid("intent_id").notNull(),
    userId: uuid("user_id").notNull(),
    expertId: uuid("expert_id").notNull(),
    draftId: uuid("draft_id").notNull(),
    reviewId: uuid("review_id").notNull(),
    revision: integer("revision").notNull(),
    publicDigest: text("public_digest").notNull(),
    admittedAt: timestamp("admitted_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    primaryKey({
      name: "early_bird_admissions_pkey",
      columns: [t.intentId, t.reviewId],
    }),
  ],
);

export const earlyBirdCompositeIntents = pgTable(
  "early_bird_composite_intents",
  {
    id: uuid("id").primaryKey(),
    invoiceId: uuid("invoice_id").notNull(),
    userId: uuid("user_id").notNull(),
    baseId: uuid("base_id").notNull(),
    choiceId: uuid("choice_id").notNull(),
    grantId: uuid("grant_id"),
    configId: uuid("config_id").notNull(),
    pricingPolicy: text("pricing_policy").notNull(),
    providerMode: text("provider_mode").notNull().default(sql.raw("'live'")),
    priceKind: text("price_kind").notNull().default(sql.raw("'full_price'")),
    promotionEligible: boolean("promotion_eligible").notNull().default(false),
    baseMonthlyMinor: bigint("base_monthly_minor", { mode: "bigint" })
      .notNull()
      .default(sql.raw("0")),
    participantKind: text("participant_kind")
      .notNull()
      .default(sql.raw("'expert'")),
    ruleVersion: text("rule_version")
      .notNull()
      .default(sql.raw("'expert_separated_sales_v3'")),
    quotedAt: timestamp("quoted_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
    idempotencyKey: uuid("idempotency_key").notNull(),
    onboardingMinor: bigint("onboarding_minor", { mode: "bigint" }).notNull(),
    subscriptionMinor: bigint("subscription_minor", {
      mode: "bigint",
    }).notNull(),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    baseOfferShownAt: timestamp("base_offer_shown_at", {
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    launchAt: timestamp("launch_at", { withTimezone: true }).notNull(),
    requestDigest: text("request_digest").notNull(),
    status: text("status").notNull().default(sql.raw("'prepared'")),
    dispatchMarkedAt: timestamp("dispatch_marked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    unique("early_bird_composite_intents_id_user_id_key").on(t.id, t.userId),
    unique("early_bird_composite_intents_invoice_id_key").on(t.invoiceId),
    unique("early_bird_composite_intents_idempotency_key_key").on(
      t.idempotencyKey,
    ),
    foreignKey({
      name: "early_bird_composite_intents_config_id_fkey",
      columns: [t.configId],
      foreignColumns: [earlyBirdLaunchConfigs.id],
    }),
    foreignKey({
      name: "early_bird_composite_intents_base_id_user_id_fkey",
      columns: [t.baseId, t.userId],
      foreignColumns: [expertSalesBases.id, expertSalesBases.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_composite_intents_choice_id_user_id_fkey",
      columns: [t.choiceId, t.userId],
      foreignColumns: [earlyBirdChoices.id, earlyBirdChoices.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_composite_intents_grant_id_user_id_fkey",
      columns: [t.grantId, t.userId],
      foreignColumns: [
        ownerTestPricingGrants.id,
        ownerTestPricingGrants.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_composite_intents_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    uniqueIndex("early_bird_one_composite_intent_per_user")
      .on(t.userId)
      .where(
        sql.raw(
          "(status = ANY (ARRAY['prepared'::text, 'unknown'::text, 'settled'::text]))",
        ),
      ),
    check(
      "early_bird_composite_intents_check3",
      sql.raw(
        "pricing_policy = 'owner_test_10_20_v1'::text AND grant_id IS NOT NULL AND provider_mode = 'live'::text OR pricing_policy = 'wave1_standard_v1'::text AND grant_id IS NULL",
      ),
    ),
    check(
      "early_bird_composite_intents_id_check",
      sql.raw(
        "id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'::text",
      ),
    ),
    check(
      "early_bird_composite_intents_pricing_policy_check",
      sql.raw(
        "pricing_policy = ANY (ARRAY['wave1_standard_v1'::text, 'owner_test_10_20_v1'::text])",
      ),
    ),
    check(
      "early_bird_composite_intents_provider_mode_check",
      sql.raw("provider_mode = ANY (ARRAY['test'::text, 'live'::text])"),
    ),
    check(
      "early_bird_composite_intents_price_kind_check",
      sql.raw(
        "price_kind = ANY (ARRAY['fixed_test'::text, 'discounted'::text, 'full_price'::text])",
      ),
    ),
    check(
      "early_bird_composite_intents_base_monthly_minor_check",
      sql.raw(
        "base_monthly_minor >= 0 AND base_monthly_minor <= '999999999999'::bigint",
      ),
    ),
    check(
      "early_bird_composite_intents_participant_kind_check",
      sql.raw("participant_kind = ANY (ARRAY['expert'::text, 'space'::text])"),
    ),
    check(
      "early_bird_composite_intents_rule_version_check",
      sql.raw("rule_version = 'expert_separated_sales_v3'::text"),
    ),
    check(
      "early_bird_composite_intents_quoted_at_check",
      sql.raw("isfinite(quoted_at)"),
    ),
    check(
      "early_bird_composite_intents_idempotency_key_check",
      sql.raw(
        "idempotency_key::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'::text",
      ),
    ),
    check(
      "early_bird_composite_intents_onboarding_minor_check",
      sql.raw("onboarding_minor = ANY (ARRAY[1000::bigint, 300000::bigint])"),
    ),
    check(
      "early_bird_composite_intents_subscription_minor_check",
      sql.raw(
        "subscription_minor > 0 AND subscription_minor <= '999999999999'::bigint",
      ),
    ),
    check(
      "early_bird_composite_intents_check",
      sql.raw(
        "total_minor <= '999999999999'::bigint AND total_minor = (onboarding_minor + subscription_minor)",
      ),
    ),
    check(
      "early_bird_composite_intents_request_digest_check",
      sql.raw("request_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
    check(
      "early_bird_composite_intents_status_check",
      sql.raw(
        "status = ANY (ARRAY['prepared'::text, 'unknown'::text, 'abandoned'::text, 'settled'::text, 'refunded'::text])",
      ),
    ),
    check(
      "early_bird_composite_intents_check1",
      sql.raw(
        "isfinite(base_offer_shown_at) AND expires_at = (base_offer_shown_at + '240:00:00'::interval)",
      ),
    ),
    check(
      "early_bird_composite_intents_check2",
      sql.raw(
        "(status = ANY (ARRAY['unknown'::text, 'settled'::text, 'refunded'::text])) AND dispatch_marked_at IS NOT NULL AND isfinite(dispatch_marked_at) OR (status = ANY (ARRAY['prepared'::text, 'abandoned'::text])) AND dispatch_marked_at IS NULL",
      ),
    ),
  ],
);

export const earlyBirdCoverageEpochs = pgTable(
  "early_bird_coverage_epochs",
  {
    userId: uuid("user_id").primaryKey(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "early_bird_coverage_epochs_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    check("early_bird_coverage_epochs_revision_check", sql.raw("revision > 0")),
  ],
);

export const earlyBirdDeferredAccounts = pgTable(
  "early_bird_deferred_accounts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    baseId: uuid("base_id").notNull(),
    choiceId: uuid("choice_id").notNull(),
    grantId: uuid("grant_id"),
    configId: uuid("config_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    onboardingMinor: bigint("onboarding_minor", { mode: "bigint" }).notNull(),
    subscriptionMinor: bigint("subscription_minor", {
      mode: "bigint",
    }).notNull(),
    launchAt: timestamp("launch_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    unique("early_bird_deferred_accounts_id_user_id_key").on(t.id, t.userId),
    unique("early_bird_deferred_accounts_user_id_key").on(t.userId),
    foreignKey({
      name: "early_bird_deferred_accounts_config_id_fkey",
      columns: [t.configId],
      foreignColumns: [earlyBirdLaunchConfigs.id],
    }),
    foreignKey({
      name: "early_bird_deferred_accounts_base_id_user_id_fkey",
      columns: [t.baseId, t.userId],
      foreignColumns: [expertSalesBases.id, expertSalesBases.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_deferred_accounts_choice_id_user_id_fkey",
      columns: [t.choiceId, t.userId],
      foreignColumns: [earlyBirdChoices.id, earlyBirdChoices.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_deferred_accounts_grant_id_user_id_fkey",
      columns: [t.grantId, t.userId],
      foreignColumns: [
        ownerTestPricingGrants.id,
        ownerTestPricingGrants.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_deferred_accounts_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    check(
      "early_bird_deferred_accounts_check",
      sql.raw(
        "policy_version = 'wave1_standard_v1'::text AND grant_id IS NULL AND onboarding_minor = 300000 OR policy_version = 'owner_test_10_20_v1'::text AND grant_id IS NOT NULL AND onboarding_minor = 1000 AND subscription_minor = 2000",
      ),
    ),
    check(
      "early_bird_deferred_accounts_onboarding_minor_check",
      sql.raw("onboarding_minor > 0"),
    ),
    check(
      "early_bird_deferred_accounts_subscription_minor_check",
      sql.raw("subscription_minor > 0"),
    ),
    check(
      "early_bird_deferred_accounts_launch_at_check",
      sql.raw("isfinite(launch_at)"),
    ),
  ],
);

export const earlyBirdDeferredReceiptTombstones = pgTable(
  "early_bird_deferred_receipt_tombstones",
  {
    captureHash: text("capture_hash").primaryKey(),
  },
  () => [
    check(
      "early_bird_deferred_receipt_tombstones_capture_hash_check",
      sql.raw("capture_hash ~ '^[0-9a-f]{64}$'::text"),
    ),
  ],
);

export const earlyBirdFinalCallEngagements = pgTable(
  "early_bird_final_call_engagements",
  {
    userId: uuid("user_id").notNull(),
    configId: uuid("config_id").notNull(),
    engagedAt: timestamp("engaged_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    primaryKey({
      name: "early_bird_final_call_engagements_pkey",
      columns: [t.userId, t.configId],
    }),
    foreignKey({
      name: "early_bird_final_call_engagements_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_final_call_engagements_config_id_fkey",
      columns: [t.configId],
      foreignColumns: [earlyBirdLaunchConfigs.id],
    }),
  ],
);

export const earlyBirdFinalCallPolicy = pgTable(
  "early_bird_final_call_policy",
  {
    configId: uuid("config_id").primaryKey(),
    repeatWithoutEngagement: boolean("repeat_without_engagement")
      .notNull()
      .default(false),
  },
  (t) => [
    foreignKey({
      name: "early_bird_final_call_policy_config_id_fkey",
      columns: [t.configId],
      foreignColumns: [earlyBirdLaunchConfigs.id],
    }),
  ],
);

export const earlyBirdFinalCallQueue = pgTable(
  "early_bird_final_call_queue",
  {
    id: uuid("id").primaryKey().default(sql.raw("gen_random_uuid()")),
    userId: uuid("user_id").notNull(),
    kind: text("kind").notNull(),
    configVersion: text("config_version").notNull(),
    triggerAt: timestamp("trigger_at", { withTimezone: true }).notNull(),
    clientStartAt: timestamp("client_start_at", {
      withTimezone: true,
    }).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default(sql.raw("'pending'")),
    attemptId: uuid("attempt_id"),
    preparedUntil: timestamp("prepared_until", { withTimezone: true }),
    messageId: text("message_id"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    foreignKey({
      name: "early_bird_final_call_queue_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    uniqueIndex("early_bird_final_call_one_active")
      .on(t.userId, t.kind)
      .where(
        sql.raw(
          "(status = ANY (ARRAY['pending'::text, 'preparing'::text, 'dispatched'::text, 'delivered'::text, 'uncertain'::text]))",
        ),
      ),
    index("early_bird_final_call_ready").on(
      t.status,
      t.availableAt,
      t.createdAt,
      t.id,
    ),
    check(
      "early_bird_final_call_queue_kind_check",
      sql.raw("kind = ANY (ARRAY['first'::text, 'repeat'::text])"),
    ),
    check(
      "early_bird_final_call_queue_config_version_check",
      sql.raw("config_version ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_final_call_queue_status_check",
      sql.raw(
        "status = ANY (ARRAY['pending'::text, 'preparing'::text, 'dispatched'::text, 'delivered'::text, 'cancelled'::text, 'uncertain'::text])",
      ),
    ),
    check(
      "early_bird_final_call_queue_check",
      sql.raw(
        "isfinite(trigger_at) AND isfinite(client_start_at) AND isfinite(scheduled_at) AND isfinite(available_at) AND isfinite(created_at)",
      ),
    ),
    check(
      "early_bird_final_call_queue_check1",
      sql.raw(
        "trigger_at < client_start_at AND scheduled_at >= trigger_at AND scheduled_at < client_start_at AND available_at >= scheduled_at",
      ),
    ),
    check(
      "early_bird_final_call_queue_check2",
      sql.raw(
        "mod(EXTRACT(epoch FROM scheduled_at - trigger_at), 86400::numeric) = 0::numeric",
      ),
    ),
    check(
      "early_bird_final_call_queue_check3",
      sql.raw(
        "status = 'pending'::text AND attempt_id IS NULL AND prepared_until IS NULL AND message_id IS NULL AND delivered_at IS NULL OR status = 'preparing'::text AND attempt_id IS NOT NULL AND prepared_until IS NOT NULL AND isfinite(prepared_until) AND message_id IS NULL AND delivered_at IS NULL OR (status = ANY (ARRAY['dispatched'::text, 'uncertain'::text])) AND attempt_id IS NOT NULL AND prepared_until IS NULL AND message_id IS NULL AND delivered_at IS NULL OR status = 'cancelled'::text AND prepared_until IS NULL AND message_id IS NULL AND delivered_at IS NULL OR status = 'delivered'::text AND attempt_id IS NOT NULL AND prepared_until IS NULL AND message_id IS NOT NULL AND message_id ~ '^[1-9][0-9]{0,19}$'::text AND delivered_at IS NOT NULL AND isfinite(delivered_at) AND delivered_at >= created_at",
      ),
    ),
  ],
);

export const earlyBirdGatewayClaims = pgTable(
  "early_bird_gateway_claims",
  {
    intentId: uuid("intent_id").primaryKey(),
    contactId: uuid("contact_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    unique("early_bird_gateway_claims_idempotency_key_key").on(
      t.idempotencyKey,
    ),
    check(
      "early_bird_gateway_claims_request_digest_check",
      sql.raw("request_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
  ],
);

export const earlyBirdGatewayContactState = pgTable(
  "early_bird_gateway_contact_state",
  {
    contactId: uuid("contact_id").primaryKey(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  () => [],
);

export const earlyBirdIntentTombstones = pgTable(
  "early_bird_intent_tombstones",
  {
    intentHash: text("intent_hash").primaryKey(),
    invoiceHash: text("invoice_hash").notNull(),
    idempotencyHash: text("idempotency_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    unique("early_bird_intent_tombstones_invoice_hash_key").on(t.invoiceHash),
    unique("early_bird_intent_tombstones_idempotency_hash_key").on(
      t.idempotencyHash,
    ),
    check(
      "early_bird_intent_tombstones_check",
      sql.raw(
        "intent_hash ~ '^[0-9a-f]{64}$'::text AND invoice_hash ~ '^[0-9a-f]{64}$'::text AND idempotency_hash ~ '^[0-9a-f]{64}$'::text",
      ),
    ),
  ],
);

export const earlyBirdMessageDispatchClaims = pgTable(
  "early_bird_message_dispatch_claims",
  {
    eventId: uuid("event_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
  },
  (t) => [
    foreignKey({
      name: "early_bird_message_dispatch_claims_event_id_fkey",
      columns: [t.eventId],
      foreignColumns: [residentReviewEvents.id],
    }),
    foreignKey({
      name: "early_bird_message_dispatch_claims_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    check(
      "early_bird_message_dispatch_claims_token_hash_check",
      sql.raw("token_hash ~ '^[a-f0-9]{64}$'::text"),
    ),
  ],
);

export const earlyBirdMessageReplacements = pgTable(
  "early_bird_message_replacements",
  {
    eventId: uuid("event_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    originalHash: text("original_hash").notNull(),
    replacementText: text("replacement_text").notNull(),
    replacementHash: text("replacement_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    foreignKey({
      name: "early_bird_message_replacements_event_id_fkey",
      columns: [t.eventId],
      foreignColumns: [residentReviewEvents.id],
    }),
    foreignKey({
      name: "early_bird_message_replacements_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    check(
      "early_bird_message_replacements_original_hash_check",
      sql.raw("original_hash ~ '^[a-f0-9]{64}$'::text"),
    ),
    check(
      "early_bird_message_replacements_replacement_text_check",
      sql.raw(
        "length(replacement_text) <= 4096 AND octet_length(replacement_text) <= 12000",
      ),
    ),
    check(
      "early_bird_message_replacements_check",
      sql.raw(
        "replacement_hash = encode(digest(replacement_text, 'sha256'::text), 'hex'::text)",
      ),
    ),
  ],
);

export const earlyBirdReceiptContacts = pgTable(
  "early_bird_receipt_contacts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    choiceId: uuid("choice_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    keyId: text("key_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
  },
  (t) => [
    unique("early_bird_receipt_contacts_user_id_idempotency_key_key").on(
      t.userId,
      t.idempotencyKey,
    ),
    unique("early_bird_receipt_contacts_choice_id_user_id_key").on(
      t.userId,
      t.choiceId,
    ),
    foreignKey({
      name: "early_bird_receipt_contacts_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_receipt_contacts_choice_id_user_id_fkey",
      columns: [t.choiceId, t.userId],
      foreignColumns: [earlyBirdChoices.id, earlyBirdChoices.userId],
    }).onDelete("cascade"),
    check(
      "early_bird_receipt_contacts_idempotency_key_check",
      sql.raw("idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'::text"),
    ),
    check(
      "early_bird_receipt_contacts_captured_at_check",
      sql.raw(
        "isfinite(captured_at) AND captured_at = date_trunc('milliseconds'::text, captured_at)",
      ),
    ),
    check(
      "early_bird_receipt_contacts_check",
      sql.raw(
        "isfinite(expires_at) AND expires_at = date_trunc('milliseconds'::text, expires_at) AND expires_at > captured_at AND expires_at <= (captured_at + '12:00:00'::interval)",
      ),
    ),
    check(
      "early_bird_receipt_contacts_key_id_check",
      sql.raw("key_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_receipt_contacts_ciphertext_check",
      sql.raw(
        "ciphertext ~ '^prc1\\.[A-Za-z0-9_-]+$'::text AND length(ciphertext) >= 45 AND length(ciphertext) <= 405",
      ),
    ),
  ],
);

export const earlyBirdRefundBindingRegistry = pgTable(
  "early_bird_refund_binding_registry",
  {
    providerRefundId: text("provider_refund_id").primaryKey(),
    product: text("product").notNull(),
    userId: uuid("user_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
  },
  () => [
    check(
      "early_bird_refund_binding_registry_provider_refund_id_check",
      sql.raw("provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_refund_binding_registry_product_check",
      sql.raw("product = ANY (ARRAY['composite'::text, 'deferred'::text])"),
    ),
  ],
);

export const earlyBirdUnknownRecovery = pgTable(
  "early_bird_unknown_recovery",
  {
    intentId: uuid("intent_id").primaryKey(),
    invoiceId: uuid("invoice_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    unique("early_bird_unknown_recovery_invoice_id_key").on(t.invoiceId),
    unique("early_bird_unknown_recovery_idempotency_key_key").on(
      t.idempotencyKey,
    ),
    check(
      "early_bird_unknown_recovery_total_minor_check",
      sql.raw("total_minor > 0 AND total_minor <= '999999999999'::bigint"),
    ),
  ],
);

export const receiptRevocationOutbox = pgTable(
  "receipt_revocation_outbox",
  {
    subjectId: uuid("subject_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    token: text("token").notNull(),
    keyVersion: text("key_version").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({
      name: "receipt_revocation_outbox_pkey",
      columns: [t.token, t.keyVersion],
    }),
    check(
      "receipt_revocation_outbox_token_check",
      sql.raw("token ~ '^[a-f0-9]{64}$'::text"),
    ),
    check(
      "receipt_revocation_outbox_key_version_check",
      sql.raw("key_version ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "receipt_revocation_outbox_check",
      sql.raw("acknowledged_at IS NULL OR acknowledged_at >= requested_at"),
    ),
  ],
);

export const earlyBirdCompositeRequests = pgTable(
  "early_bird_composite_requests",
  {
    intentId: uuid("intent_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    bodyVersion: integer("body_version").notNull(),
    ciphertext: text("ciphertext").notNull(),
    keyReference: text("key_reference").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("early_bird_composite_requests_idempotency_key_key").on(
      t.idempotencyKey,
    ),
    foreignKey({
      name: "early_bird_composite_requests_intent_id_user_id_fkey",
      columns: [t.intentId, t.userId],
      foreignColumns: [
        earlyBirdCompositeIntents.id,
        earlyBirdCompositeIntents.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_composite_requests_request_digest_check",
      sql.raw("request_digest ~ '^sha256:[0-9a-f]{64}$'::text"),
    ),
    check(
      "early_bird_composite_requests_body_version_check",
      sql.raw("body_version = 1"),
    ),
    check(
      "early_bird_composite_requests_ciphertext_check",
      sql.raw("length(ciphertext) >= 1 AND length(ciphertext) <= 262144"),
    ),
    check(
      "early_bird_composite_requests_key_reference_check",
      sql.raw(
        "key_reference ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$'::text",
      ),
    ),
    check(
      "early_bird_composite_requests_expires_at_check",
      sql.raw("isfinite(expires_at)"),
    ),
  ],
);

export const earlyBirdDeferredInvoices = pgTable(
  "early_bird_deferred_invoices",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id").notNull(),
    userId: uuid("user_id").notNull(),
    stage: text("stage").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    providerId: text("provider_id"),
    evidenceDigest: text("evidence_digest"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    dispatchStartedAt: timestamp("dispatch_started_at", { withTimezone: true }),
  },
  (t) => [
    unique("early_bird_deferred_invoice_identity").on(t.id, t.userId),
    unique("early_bird_deferred_invoices_account_id_stage_key").on(
      t.accountId,
      t.stage,
    ),
    unique("early_bird_deferred_invoices_idempotency_key_key").on(
      t.idempotencyKey,
    ),
    unique("early_bird_deferred_invoices_provider_id_key").on(t.providerId),
    foreignKey({
      name: "early_bird_deferred_invoices_account_id_user_id_fkey",
      columns: [t.accountId, t.userId],
      foreignColumns: [
        earlyBirdDeferredAccounts.id,
        earlyBirdDeferredAccounts.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_deferred_invoices_stage_check",
      sql.raw("stage = ANY (ARRAY['onboarding'::text, 'subscription'::text])"),
    ),
    check(
      "early_bird_deferred_invoices_amount_minor_check",
      sql.raw("amount_minor > 0"),
    ),
    check(
      "early_bird_deferred_invoices_provider_id_check",
      sql.raw("provider_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_deferred_invoices_evidence_digest_check",
      sql.raw("evidence_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
    check(
      "early_bird_deferred_invoices_captured_at_check",
      sql.raw("isfinite(captured_at)"),
    ),
    check(
      "early_bird_deferred_invoices_check",
      sql.raw(
        "provider_id IS NULL AND evidence_digest IS NULL AND captured_at IS NULL OR provider_id IS NOT NULL AND evidence_digest IS NOT NULL AND captured_at IS NOT NULL",
      ),
    ),
  ],
);

export const earlyBirdDeferredReceiptContacts = pgTable(
  "early_bird_deferred_receipt_contacts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    keyId: text("key_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
  },
  (t) => [
    unique("early_bird_deferred_receipt_contacts_id_user_id_key").on(
      t.id,
      t.userId,
    ),
    unique(
      "early_bird_deferred_receipt_contact_user_id_idempotency_key_key",
    ).on(t.userId, t.idempotencyKey),
    foreignKey({
      name: "early_bird_deferred_receipt_contacts_account_id_user_id_fkey",
      columns: [t.accountId, t.userId],
      foreignColumns: [
        earlyBirdDeferredAccounts.id,
        earlyBirdDeferredAccounts.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_deferred_receipt_contacts_idempotency_key_check",
      sql.raw("idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'::text"),
    ),
    check(
      "early_bird_deferred_receipt_contacts_captured_at_check",
      sql.raw("isfinite(captured_at)"),
    ),
    check(
      "early_bird_deferred_receipt_contacts_check",
      sql.raw(
        "isfinite(expires_at) AND expires_at > captured_at AND expires_at <= (captured_at + '12:00:00'::interval)",
      ),
    ),
    check(
      "early_bird_deferred_receipt_contacts_key_id_check",
      sql.raw("key_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_deferred_receipt_contacts_ciphertext_check",
      sql.raw(
        "ciphertext ~ '^prc1\\.[A-Za-z0-9_-]+$'::text AND length(ciphertext) >= 45 AND length(ciphertext) <= 405",
      ),
    ),
  ],
);

export const earlyBirdMessageDispatchConsumptions = pgTable(
  "early_bird_message_dispatch_consumptions",
  {
    eventId: uuid("event_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    foreignKey({
      name: "early_bird_message_dispatch_consumptions_event_id_fkey",
      columns: [t.eventId],
      foreignColumns: [earlyBirdMessageDispatchClaims.eventId],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_message_dispatch_consumptions_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

export const earlyBirdPaymentSuccesses = pgTable(
  "early_bird_payment_successes",
  {
    intentId: uuid("intent_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    providerObjectId: text("provider_object_id").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    disposition: text("disposition").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    unique("early_bird_payment_successes_provider_object_id_key").on(
      t.providerObjectId,
    ),
    foreignKey({
      name: "early_bird_payment_successes_intent_id_user_id_fkey",
      columns: [t.intentId, t.userId],
      foreignColumns: [
        earlyBirdCompositeIntents.id,
        earlyBirdCompositeIntents.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_payment_successes_provider_object_id_check",
      sql.raw("provider_object_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_payment_successes_evidence_digest_check",
      sql.raw("evidence_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
    check(
      "early_bird_payment_successes_captured_at_check",
      sql.raw("isfinite(captured_at)"),
    ),
    check(
      "early_bird_payment_successes_disposition_check",
      sql.raw("disposition = ANY (ARRAY['eligible'::text, 'reconcile'::text])"),
    ),
    check(
      "early_bird_payment_successes_check",
      sql.raw(
        "disposition = 'reconcile'::text AND starts_at IS NULL AND ends_at IS NULL OR disposition = 'eligible'::text AND starts_at IS NOT NULL AND ends_at = (starts_at + '720:00:00'::interval)",
      ),
    ),
  ],
);

export const earlyBirdRefundReconciliation = pgTable(
  "early_bird_refund_reconciliation",
  {
    operationId: uuid("operation_id").primaryKey(),
    intentId: uuid("intent_id").notNull(),
    userId: uuid("user_id").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    providerRefundId: text("provider_refund_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    unique("early_bird_refund_reconciliation_provider_refund_id_key").on(
      t.providerRefundId,
    ),
    foreignKey({
      name: "early_bird_refund_reconciliation_intent_id_user_id_fkey",
      columns: [t.intentId, t.userId],
      foreignColumns: [
        earlyBirdCompositeIntents.id,
        earlyBirdCompositeIntents.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_refund_reconciliation_provider_payment_id_check",
      sql.raw("provider_payment_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_refund_reconciliation_provider_refund_id_check",
      sql.raw("provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_refund_reconciliation_amount_minor_check",
      sql.raw("amount_minor > 0"),
    ),
    check(
      "early_bird_refund_reconciliation_evidence_digest_check",
      sql.raw("evidence_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
  ],
);

export const earlyBirdVerifiedBindings = pgTable(
  "early_bird_verified_bindings",
  {
    intentId: uuid("intent_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    providerObjectId: text("provider_object_id").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    unique("early_bird_verified_bindings_provider_object_id_key").on(
      t.providerObjectId,
    ),
    foreignKey({
      name: "early_bird_verified_bindings_intent_id_user_id_fkey",
      columns: [t.intentId, t.userId],
      foreignColumns: [
        earlyBirdCompositeIntents.id,
        earlyBirdCompositeIntents.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_verified_bindings_provider_object_id_check",
      sql.raw("provider_object_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_verified_bindings_evidence_digest_check",
      sql.raw("evidence_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
  ],
);

export const earlyBirdVerifiedRefundBindings = pgTable(
  "early_bird_verified_refund_bindings",
  {
    operationId: uuid("operation_id").primaryKey(),
    intentId: uuid("intent_id").notNull(),
    userId: uuid("user_id").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    providerRefundId: text("provider_refund_id").notNull(),
  },
  (t) => [
    unique("early_bird_verified_refund_bindings_provider_refund_id_key").on(
      t.providerRefundId,
    ),
    foreignKey({
      name: "early_bird_verified_refund_bindings_intent_id_user_id_fkey",
      columns: [t.intentId, t.userId],
      foreignColumns: [
        earlyBirdCompositeIntents.id,
        earlyBirdCompositeIntents.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_verified_refund_bindings_provider_payment_id_check",
      sql.raw("provider_payment_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_verified_refund_bindings_provider_refund_id_check",
      sql.raw("provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
  ],
);

export const earlyBirdWaveOneExclusions = pgTable(
  "early_bird_wave_one_exclusions",
  {
    userId: uuid("user_id").primaryKey(),
    accountId: uuid("account_id").notNull(),
    excludedAt: timestamp("excluded_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
    reason: text("reason").notNull().default(sql.raw("'EXCLUDED_FROM_WAVE_1'")),
  },
  (t) => [
    unique("early_bird_wave_one_exclusions_account_id_key").on(t.accountId),
    foreignKey({
      name: "early_bird_wave_one_exclusions_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_wave_one_exclusions_account_id_fkey",
      columns: [t.accountId],
      foreignColumns: [earlyBirdDeferredAccounts.id],
    }).onDelete("cascade"),
    check(
      "early_bird_wave_one_exclusions_reason_check",
      sql.raw("reason = 'EXCLUDED_FROM_WAVE_1'::text"),
    ),
  ],
);

export const earlyBirdCandidateObservations = pgTable(
  "early_bird_candidate_observations",
  {
    intentId: uuid("intent_id").notNull(),
    userId: uuid("user_id").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    primaryKey({
      name: "early_bird_candidate_observations_pkey",
      columns: [t.intentId, t.evidenceDigest],
    }),
    foreignKey({
      name: "early_bird_candidate_observations_intent_id_fkey",
      columns: [t.intentId],
      foreignColumns: [earlyBirdVerifiedBindings.intentId],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_candidate_observations_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    check(
      "early_bird_candidate_observations_evidence_digest_check",
      sql.raw("evidence_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
  ],
);

export const earlyBirdCoverageRevisions = pgTable(
  "early_bird_coverage_revisions",
  {
    intentId: uuid("intent_id").notNull(),
    userId: uuid("user_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    primaryKey({
      name: "early_bird_coverage_revisions_pkey",
      columns: [t.intentId, t.revision],
    }),
    foreignKey({
      name: "early_bird_coverage_revisions_intent_id_fkey",
      columns: [t.intentId],
      foreignColumns: [earlyBirdPaymentSuccesses.intentId],
    }).onDelete("cascade"),
    check(
      "early_bird_coverage_revisions_revision_check",
      sql.raw("revision > 0"),
    ),
    check(
      "early_bird_coverage_revisions_check",
      sql.raw("ends_at = (starts_at + '720:00:00'::interval)"),
    ),
  ],
);

export const earlyBirdDeferredRequests = pgTable(
  "early_bird_deferred_requests",
  {
    invoiceId: uuid("invoice_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    receiptContactId: uuid("receipt_contact_id").notNull(),
    requestDigest: text("request_digest").notNull(),
    ciphertext: text("ciphertext").notNull(),
    keyReference: text("key_reference").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "early_bird_deferred_requests_invoice_id_fkey",
      columns: [t.invoiceId],
      foreignColumns: [earlyBirdDeferredInvoices.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_deferred_requests_receipt_contact_id_user_id_fkey",
      columns: [t.receiptContactId, t.userId],
      foreignColumns: [
        earlyBirdDeferredReceiptContacts.id,
        earlyBirdDeferredReceiptContacts.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_deferred_requests_request_digest_check",
      sql.raw("request_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
    check(
      "early_bird_deferred_requests_ciphertext_check",
      sql.raw("length(ciphertext) >= 1 AND length(ciphertext) <= 262144"),
    ),
    check(
      "early_bird_deferred_requests_key_reference_check",
      sql.raw(
        "key_reference ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$'::text",
      ),
    ),
    check(
      "early_bird_deferred_requests_expires_at_check",
      sql.raw("isfinite(expires_at)"),
    ),
  ],
);

export const earlyBirdDeferredVerifiedBindings = pgTable(
  "early_bird_deferred_verified_bindings",
  {
    invoiceId: uuid("invoice_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    providerId: text("provider_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
  },
  (t) => [
    unique("early_bird_deferred_verified_bindings_provider_id_key").on(
      t.providerId,
    ),
    foreignKey({
      name: "early_bird_deferred_verified_bindings_invoice_id_fkey",
      columns: [t.invoiceId],
      foreignColumns: [earlyBirdDeferredInvoices.id],
    }).onDelete("cascade"),
    check(
      "early_bird_deferred_verified_bindings_provider_id_check",
      sql.raw("provider_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_deferred_verified_bindings_amount_minor_check",
      sql.raw("amount_minor > 0"),
    ),
    check(
      "early_bird_deferred_verified_bindings_evidence_digest_check",
      sql.raw("evidence_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
  ],
);

export const earlyBirdDeferredVerifiedRefundBindings = pgTable(
  "early_bird_deferred_verified_refund_bindings",
  {
    providerRefundId: text("provider_refund_id").primaryKey(),
    invoiceId: uuid("invoice_id").notNull(),
    userId: uuid("user_id").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    foreignKey({
      name: "early_bird_deferred_verified_refund_bin_invoice_id_user_id_fkey",
      columns: [t.invoiceId, t.userId],
      foreignColumns: [
        earlyBirdDeferredInvoices.id,
        earlyBirdDeferredInvoices.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_deferred_verified_refund_bi_provider_refund_id_check",
      sql.raw("provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_deferred_verified_refund_b_provider_payment_id_check",
      sql.raw("provider_payment_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_deferred_verified_refund_bindings_amount_minor_check",
      sql.raw("amount_minor > 0"),
    ),
    check(
      "early_bird_deferred_verified_refund_bindi_evidence_digest_check",
      sql.raw("evidence_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
  ],
);

export const earlyBirdPaymentFullRefunds = pgTable(
  "early_bird_payment_full_refunds",
  {
    intentId: uuid("intent_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    providerRefundId: text("provider_refund_id").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    unique("early_bird_payment_full_refunds_provider_refund_id_key").on(
      t.providerRefundId,
    ),
    foreignKey({
      name: "early_bird_payment_full_refunds_intent_id_fkey",
      columns: [t.intentId],
      foreignColumns: [earlyBirdPaymentSuccesses.intentId],
    }).onDelete("cascade"),
    check(
      "early_bird_payment_full_refunds_provider_refund_id_check",
      sql.raw("provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_payment_full_refunds_evidence_digest_check",
      sql.raw("evidence_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
    check(
      "early_bird_payment_full_refunds_amount_minor_check",
      sql.raw("amount_minor > 0"),
    ),
    check(
      "early_bird_payment_full_refunds_occurred_at_check",
      sql.raw("isfinite(occurred_at)"),
    ),
  ],
);

export const earlyBirdRefundRegistry = pgTable(
  "early_bird_refund_registry",
  {
    providerRefundId: text("provider_refund_id").primaryKey(),
    intentId: uuid("intent_id"),
    userId: uuid("user_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    deferredInvoiceId: uuid("deferred_invoice_id"),
  },
  (t) => [
    foreignKey({
      name: "early_bird_refund_registry_intent_id_user_id_fkey",
      columns: [t.intentId, t.userId],
      foreignColumns: [
        earlyBirdCompositeIntents.id,
        earlyBirdCompositeIntents.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_refund_registry_deferred_fk",
      columns: [t.deferredInvoiceId, t.userId],
      foreignColumns: [
        earlyBirdDeferredInvoices.id,
        earlyBirdDeferredInvoices.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_refund_registry_provider_refund_id_check",
      sql.raw("provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'::text"),
    ),
    check(
      "early_bird_refund_registry_amount_minor_check",
      sql.raw("amount_minor > 0"),
    ),
    check(
      "early_bird_refund_registry_exact_source",
      sql.raw(
        "((intent_id IS NOT NULL)::integer + (deferred_invoice_id IS NOT NULL)::integer) = 1",
      ),
    ),
  ],
);

export const earlyBirdCoverageReconciliation = pgTable(
  "early_bird_coverage_reconciliation",
  {
    intentId: uuid("intent_id").notNull(),
    userId: uuid("user_id").notNull(),
    orderId: uuid("order_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    primaryKey({
      name: "early_bird_coverage_reconciliation_pkey",
      columns: [t.intentId, t.orderId],
    }),
    foreignKey({
      name: "early_bird_coverage_reconciliation_intent_id_fkey",
      columns: [t.intentId],
      foreignColumns: [earlyBirdPaymentFullRefunds.intentId],
    }).onDelete("cascade"),
  ],
);

export const earlyBirdDeferredRefundFacts = pgTable(
  "early_bird_deferred_refund_facts",
  {
    providerRefundId: text("provider_refund_id").primaryKey(),
    invoiceId: uuid("invoice_id").notNull(),
    userId: uuid("user_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
    evidenceDigest: text("evidence_digest").notNull(),
  },
  (t) => [
    foreignKey({
      name: "early_bird_deferred_refund_facts_provider_refund_id_fkey",
      columns: [t.providerRefundId],
      foreignColumns: [
        earlyBirdDeferredVerifiedRefundBindings.providerRefundId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_deferred_refund_facts_invoice_id_user_id_fkey",
      columns: [t.invoiceId, t.userId],
      foreignColumns: [
        earlyBirdDeferredInvoices.id,
        earlyBirdDeferredInvoices.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_deferred_refund_facts_amount_minor_check",
      sql.raw("amount_minor > 0"),
    ),
    check(
      "early_bird_deferred_refund_facts_evidence_digest_check",
      sql.raw("evidence_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
  ],
);

export const earlyBirdDeferredRefundResolutions = pgTable(
  "early_bird_deferred_refund_resolutions",
  {
    providerRefundId: text("provider_refund_id").primaryKey(),
    invoiceId: uuid("invoice_id").notNull(),
    userId: uuid("user_id").notNull(),
    disposition: text("disposition").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    foreignKey({
      name: "early_bird_deferred_refund_resolutions_provider_refund_id_fkey",
      columns: [t.providerRefundId],
      foreignColumns: [
        earlyBirdDeferredVerifiedRefundBindings.providerRefundId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_deferred_refund_resolutions_invoice_id_user_id_fkey",
      columns: [t.invoiceId, t.userId],
      foreignColumns: [
        earlyBirdDeferredInvoices.id,
        earlyBirdDeferredInvoices.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_deferred_refund_resolutions_disposition_check",
      sql.raw("disposition = 'canceled'::text"),
    ),
    check(
      "early_bird_deferred_refund_resolutions_evidence_digest_check",
      sql.raw("evidence_digest ~ '^sha256:[a-f0-9]{64}$'::text"),
    ),
  ],
);

export const earlyBirdDeferredRefundReconciliation = pgTable(
  "early_bird_deferred_refund_reconciliation",
  {
    providerRefundId: text("provider_refund_id").primaryKey(),
    invoiceId: uuid("invoice_id").notNull(),
    userId: uuid("user_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    foreignKey({
      name: "early_bird_deferred_refund_reconciliati_provider_refund_id_fkey",
      columns: [t.providerRefundId],
      foreignColumns: [earlyBirdDeferredRefundFacts.providerRefundId],
    }).onDelete("cascade"),
    foreignKey({
      name: "early_bird_deferred_refund_reconciliati_invoice_id_user_id_fkey",
      columns: [t.invoiceId, t.userId],
      foreignColumns: [
        earlyBirdDeferredInvoices.id,
        earlyBirdDeferredInvoices.userId,
      ],
    }).onDelete("cascade"),
    check(
      "early_bird_deferred_refund_reconciliation_amount_minor_check",
      sql.raw("amount_minor > 0"),
    ),
  ],
);
