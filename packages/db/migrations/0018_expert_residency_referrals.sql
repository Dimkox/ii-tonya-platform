DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM experts GROUP BY user_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'expert_user_identity_duplicates';
  END IF;
END $$;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TYPE "public"."expert_first_settlement_eligibility" AS ENUM('eligible', 'permanently_ineligible', 'pending_feature_hold', 'cancelled_by_refund');--> statement-breakpoint
CREATE TYPE "public"."expert_referral_abuse_hold_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."expert_referral_batch_status" AS ENUM('issued', 'partially_redeemed', 'fully_redeemed', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."expert_referral_code_status" AS ENUM('issued', 'redeemed', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."expert_referral_ledger_entry_kind" AS ENUM('reward_grant', 'reservation', 'release', 'spend', 'expiry', 'reversal', 'debt_repayment', 'administrative_correction');--> statement-breakpoint
CREATE TYPE "public"."expert_residency_order_status" AS ENUM('quoted', 'payment_pending', 'settled', 'failed', 'expired', 'refunded', 'charged_back');--> statement-breakpoint
CREATE TYPE "public"."expert_residency_payment_attempt_status" AS ENUM('created', 'pending', 'unknown_outcome', 'settled', 'failed', 'refunded', 'charged_back');--> statement-breakpoint
CREATE TYPE "public"."expert_residency_provider_event_status" AS ENUM('received', 'processing', 'processed', 'rejected', 'reconciliation_required');--> statement-breakpoint
CREATE TABLE "expert_first_residency_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expert_id" uuid NOT NULL,
	"settlement_sequence" bigserial NOT NULL,
	"qualifying_order_id" uuid NOT NULL,
	"qualifying_payment_attempt_id" uuid NOT NULL,
	"referral_id" uuid,
	"eligibility" "expert_first_settlement_eligibility" NOT NULL,
	"reason_code" text NOT NULL,
	"settlement_expert_active" boolean NOT NULL,
	"settlement_expert_verified" boolean NOT NULL,
	"settlement_abuse_cleared" boolean NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_first_settlement_expert_unique" UNIQUE("expert_id"),
	CONSTRAINT "expert_first_settlement_order_unique" UNIQUE("qualifying_order_id"),
	CONSTRAINT "expert_first_settlement_sequence_unique" UNIQUE("settlement_sequence"),
	CONSTRAINT "expert_first_settlement_identity_unique" UNIQUE("id","referral_id","qualifying_order_id","qualifying_payment_attempt_id"),
	CONSTRAINT "expert_first_settlement_eligibility_evidence" CHECK (
        ("expert_first_residency_settlements"."eligibility" in ('eligible', 'pending_feature_hold') and "expert_first_residency_settlements"."referral_id" is not null and "expert_first_residency_settlements"."settlement_expert_active" and "expert_first_residency_settlements"."settlement_expert_verified" and "expert_first_residency_settlements"."settlement_abuse_cleared")
        or ("expert_first_residency_settlements"."eligibility" in ('permanently_ineligible', 'cancelled_by_refund'))
      )
);
--> statement-breakpoint
CREATE TABLE "expert_referral_abuse_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expert_id" uuid NOT NULL,
	"status" "expert_referral_abuse_hold_status" DEFAULT 'open' NOT NULL,
	"reason_code" text NOT NULL,
	"opened_approval_id" uuid NOT NULL,
	"opened_admin_session_id_hash" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_approval_id" uuid,
	"closed_admin_session_id_hash" text,
	"closed_reason_code" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_abuse_holds_opened_approval_unique" UNIQUE("opened_approval_id"),
	CONSTRAINT "expert_abuse_holds_reason_bounded" CHECK (char_length("expert_referral_abuse_holds"."reason_code") between 1 and 128 and ("expert_referral_abuse_holds"."closed_reason_code" is null or char_length("expert_referral_abuse_holds"."closed_reason_code") between 1 and 128)),
	CONSTRAINT "expert_abuse_holds_lifecycle" CHECK (
        ("expert_referral_abuse_holds"."status" = 'open' and "expert_referral_abuse_holds"."closed_approval_id" is null and "expert_referral_abuse_holds"."closed_admin_session_id_hash" is null and "expert_referral_abuse_holds"."closed_reason_code" is null and "expert_referral_abuse_holds"."closed_at" is null)
        or ("expert_referral_abuse_holds"."status" = 'closed' and "expert_referral_abuse_holds"."closed_approval_id" is not null and "expert_referral_abuse_holds"."closed_admin_session_id_hash" is not null and "expert_referral_abuse_holds"."closed_reason_code" is not null and "expert_referral_abuse_holds"."closed_at" >= "expert_referral_abuse_holds"."opened_at")
      )
);
--> statement-breakpoint
CREATE TABLE "expert_referral_code_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_expert_id" uuid NOT NULL,
	"requested_count" integer NOT NULL,
	"issued_by_admin_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"admin_session_id_hash" text NOT NULL,
	"status" "expert_referral_batch_status" DEFAULT 'issued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_referral_batches_approval_unique" UNIQUE("approval_id"),
	CONSTRAINT "expert_referral_batches_id_inviter_unique" UNIQUE("id","inviter_expert_id"),
	CONSTRAINT "expert_referral_batches_requested_count_bounded" CHECK ("expert_referral_code_batches"."requested_count" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "expert_referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"inviter_expert_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"key_version" integer NOT NULL,
	"masked_suffix" text NOT NULL,
	"status" "expert_referral_code_status" DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_approval_id" uuid,
	"revoked_admin_session_id_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_referral_codes_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "expert_referral_codes_id_inviter_unique" UNIQUE("id","inviter_expert_id"),
	CONSTRAINT "expert_referral_codes_hash_format" CHECK ("expert_referral_codes"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "expert_referral_codes_key_version_positive" CHECK ("expert_referral_codes"."key_version" > 0),
	CONSTRAINT "expert_referral_codes_masked_suffix_bounded" CHECK (char_length("expert_referral_codes"."masked_suffix") between 4 and 12),
	CONSTRAINT "expert_referral_codes_lifecycle" CHECK (
        ("expert_referral_codes"."status" = 'issued' and "expert_referral_codes"."redeemed_at" is null and "expert_referral_codes"."revoked_at" is null and "expert_referral_codes"."revoked_approval_id" is null and "expert_referral_codes"."revoked_admin_session_id_hash" is null)
        or ("expert_referral_codes"."status" = 'redeemed' and "expert_referral_codes"."redeemed_at" is not null and "expert_referral_codes"."revoked_at" is null and "expert_referral_codes"."revoked_approval_id" is null and "expert_referral_codes"."revoked_admin_session_id_hash" is null)
        or ("expert_referral_codes"."status" = 'revoked' and "expert_referral_codes"."redeemed_at" is null and "expert_referral_codes"."revoked_at" is not null and "expert_referral_codes"."revoked_approval_id" is not null and "expert_referral_codes"."revoked_admin_session_id_hash" is not null)
      )
);
--> statement-breakpoint
CREATE TABLE "expert_referral_feature_controls" (
	"control_key" text PRIMARY KEY DEFAULT 'expert_referrals' NOT NULL,
	"version" integer NOT NULL,
	"new_commands_enabled" boolean DEFAULT false NOT NULL,
	"reward_grants_enabled" boolean DEFAULT false NOT NULL,
	"updated_approval_id" uuid NOT NULL,
	"updated_admin_session_id_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_referral_controls_approval_unique" UNIQUE("updated_approval_id"),
	CONSTRAINT "expert_referral_controls_singleton" CHECK ("expert_referral_feature_controls"."control_key" = 'expert_referrals'),
	CONSTRAINT "expert_referral_controls_version_positive" CHECK ("expert_referral_feature_controls"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "expert_referral_issuance_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_expert_id" uuid NOT NULL,
	"additional_quota" integer NOT NULL,
	"consumed_count" integer DEFAULT 0 NOT NULL,
	"reason_code" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"requester_id" uuid NOT NULL,
	"approver_one_id" uuid NOT NULL,
	"approver_two_id" uuid NOT NULL,
	"approval_one_id" uuid NOT NULL,
	"approval_two_id" uuid NOT NULL,
	"requester_session_id_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_issuance_overrides_approval_one_unique" UNIQUE("approval_one_id"),
	CONSTRAINT "expert_issuance_overrides_approval_two_unique" UNIQUE("approval_two_id"),
	CONSTRAINT "expert_issuance_override_quota_bounded" CHECK ("expert_referral_issuance_overrides"."additional_quota" between 1 and 1000 and "expert_referral_issuance_overrides"."consumed_count" between 0 and "expert_referral_issuance_overrides"."additional_quota"),
	CONSTRAINT "expert_issuance_override_reason_bounded" CHECK (char_length("expert_referral_issuance_overrides"."reason_code") between 1 and 128),
	CONSTRAINT "expert_issuance_override_validity" CHECK ("expert_referral_issuance_overrides"."valid_until" > "expert_referral_issuance_overrides"."valid_from"),
	CONSTRAINT "expert_issuance_override_distinct_approvers" CHECK ("expert_referral_issuance_overrides"."approver_one_id" <> "expert_referral_issuance_overrides"."approver_two_id" and "expert_referral_issuance_overrides"."requester_id" <> "expert_referral_issuance_overrides"."approver_one_id" and "expert_referral_issuance_overrides"."requester_id" <> "expert_referral_issuance_overrides"."approver_two_id" and "expert_referral_issuance_overrides"."approval_one_id" <> "expert_referral_issuance_overrides"."approval_two_id")
);
--> statement-breakpoint
CREATE TABLE "expert_referral_ledger_allocations" (
	"ledger_entry_id" uuid NOT NULL,
	"reward_grant_id" uuid NOT NULL,
	"expert_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_ledger_allocations_pk" PRIMARY KEY("ledger_entry_id","reward_grant_id"),
	CONSTRAINT "expert_ledger_allocation_nonzero" CHECK ("expert_referral_ledger_allocations"."amount_minor" <> 0 and abs("expert_referral_ledger_allocations"."amount_minor") <= 999999999999)
);
--> statement-breakpoint
CREATE TABLE "expert_referral_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expert_id" uuid NOT NULL,
	"entry_kind" "expert_referral_ledger_entry_kind" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"order_id" uuid,
	"original_entry_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"admin_approval_id" uuid,
	"admin_session_id_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_ledger_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "expert_ledger_entries_id_expert_unique" UNIQUE("id","expert_id"),
	CONSTRAINT "expert_ledger_amount_bounds" CHECK ("expert_referral_ledger_entries"."amount_minor" <> 0 and abs("expert_referral_ledger_entries"."amount_minor") <= 999999999999),
	CONSTRAINT "expert_ledger_kind_contract" CHECK (
        ("expert_referral_ledger_entries"."entry_kind" = 'reward_grant' and "expert_referral_ledger_entries"."amount_minor" > 0 and "expert_referral_ledger_entries"."order_id" is null and "expert_referral_ledger_entries"."original_entry_id" is null)
        or ("expert_referral_ledger_entries"."entry_kind" = 'reservation' and "expert_referral_ledger_entries"."amount_minor" < 0 and "expert_referral_ledger_entries"."order_id" is not null and "expert_referral_ledger_entries"."original_entry_id" is null)
        or ("expert_referral_ledger_entries"."entry_kind" in ('release', 'debt_repayment') and "expert_referral_ledger_entries"."amount_minor" > 0 and "expert_referral_ledger_entries"."original_entry_id" is not null)
        or ("expert_referral_ledger_entries"."entry_kind" in ('spend', 'expiry', 'reversal') and "expert_referral_ledger_entries"."amount_minor" < 0 and "expert_referral_ledger_entries"."original_entry_id" is not null)
        or ("expert_referral_ledger_entries"."entry_kind" = 'administrative_correction' and "expert_referral_ledger_entries"."admin_approval_id" is not null and "expert_referral_ledger_entries"."admin_session_id_hash" is not null)
      ),
	CONSTRAINT "expert_ledger_admin_binding_complete" CHECK (
        ("expert_referral_ledger_entries"."admin_approval_id" is null and "expert_referral_ledger_entries"."admin_session_id_hash" is null)
        or ("expert_referral_ledger_entries"."admin_approval_id" is not null and "expert_referral_ledger_entries"."admin_session_id_hash" is not null)
      )
);
--> statement-breakpoint
CREATE TABLE "expert_referral_reward_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expert_id" uuid NOT NULL,
	"referral_id" uuid NOT NULL,
	"first_settlement_id" uuid NOT NULL,
	"qualifying_order_id" uuid NOT NULL,
	"qualifying_payment_attempt_id" uuid NOT NULL,
	"amount_minor" bigint DEFAULT 100000 NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_reward_grants_referral_unique" UNIQUE("referral_id"),
	CONSTRAINT "expert_reward_grants_first_settlement_unique" UNIQUE("first_settlement_id"),
	CONSTRAINT "expert_reward_grants_qualifying_order_unique" UNIQUE("qualifying_order_id"),
	CONSTRAINT "expert_reward_grants_qualifying_payment_unique" UNIQUE("qualifying_payment_attempt_id"),
	CONSTRAINT "expert_reward_grants_id_expert_unique" UNIQUE("id","expert_id"),
	CONSTRAINT "expert_reward_grants_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "expert_reward_grant_exact_amount" CHECK ("expert_referral_reward_grants"."amount_minor" = 100000),
	CONSTRAINT "expert_reward_grant_expiry_exact" CHECK ("expert_referral_reward_grants"."expires_at" = "expert_referral_reward_grants"."granted_at" + interval '365 days')
);
--> statement-breakpoint
CREATE TABLE "expert_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_id" uuid NOT NULL,
	"inviter_expert_id" uuid NOT NULL,
	"invitee_expert_id" uuid NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_referrals_code_unique" UNIQUE("code_id"),
	CONSTRAINT "expert_referrals_invitee_unique" UNIQUE("invitee_expert_id"),
	CONSTRAINT "expert_referrals_id_inviter_unique" UNIQUE("id","inviter_expert_id"),
	CONSTRAINT "expert_referrals_id_invitee_unique" UNIQUE("id","invitee_expert_id"),
	CONSTRAINT "expert_referrals_distinct_experts" CHECK ("expert_referrals"."inviter_expert_id" <> "expert_referrals"."invitee_expert_id")
);
--> statement-breakpoint
CREATE TABLE "expert_residency_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expert_id" uuid NOT NULL,
	"tariff_version_id" uuid NOT NULL,
	"snapshot_display_name" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"duration_seconds" integer NOT NULL,
	"credit_minor" bigint NOT NULL,
	"cash_minor" bigint NOT NULL,
	"payment_deadline" timestamp with time zone NOT NULL,
	"provider_payment_id" text,
	"status" "expert_residency_order_status" DEFAULT 'quoted' NOT NULL,
	"settled_at" timestamp with time zone,
	"residency_starts_at" timestamp with time zone,
	"residency_ends_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_orders_expert_idempotency_unique" UNIQUE("expert_id","idempotency_key"),
	CONSTRAINT "expert_orders_id_expert_unique" UNIQUE("id","expert_id"),
	CONSTRAINT "expert_order_money_bounds" CHECK (
        "expert_residency_orders"."price_minor" > 0 and "expert_residency_orders"."price_minor" <= 999999999999 and
        "expert_residency_orders"."credit_minor" >= 0 and "expert_residency_orders"."credit_minor" <= 999999999999 and
        "expert_residency_orders"."cash_minor" >= 0 and "expert_residency_orders"."cash_minor" <= 999999999999
      ),
	CONSTRAINT "expert_order_credit_cap" CHECK ("expert_residency_orders"."credit_minor" <= "expert_residency_orders"."price_minor" / 2),
	CONSTRAINT "expert_order_cash_remainder" CHECK ("expert_residency_orders"."cash_minor" = "expert_residency_orders"."price_minor" - "expert_residency_orders"."credit_minor"),
	CONSTRAINT "expert_order_currency_rub" CHECK ("expert_residency_orders"."currency" = 'RUB'),
	CONSTRAINT "expert_order_duration_positive" CHECK ("expert_residency_orders"."duration_seconds" > 0),
	CONSTRAINT "expert_order_deadline_after_creation" CHECK ("expert_residency_orders"."payment_deadline" > "expert_residency_orders"."created_at"),
	CONSTRAINT "expert_order_settlement_interval" CHECK (
        ("expert_residency_orders"."settled_at" is null and "expert_residency_orders"."residency_starts_at" is null and "expert_residency_orders"."residency_ends_at" is null)
        or (
          "expert_residency_orders"."settled_at" is not null and
          "expert_residency_orders"."residency_starts_at" is not null and
          "expert_residency_orders"."residency_ends_at" is not null and
          "expert_residency_orders"."residency_starts_at" >= "expert_residency_orders"."settled_at" and
          "expert_residency_orders"."residency_ends_at" = "expert_residency_orders"."residency_starts_at" + make_interval(secs => "expert_residency_orders"."duration_seconds")
        )
      )
);
--> statement-breakpoint
CREATE TABLE "expert_residency_payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_request_id" text NOT NULL,
	"expected_amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"status" "expert_residency_payment_attempt_status" DEFAULT 'created' NOT NULL,
	"idempotency_key" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_payment_attempt_provider_request_unique" UNIQUE("provider","provider_request_id"),
	CONSTRAINT "expert_payment_attempt_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "expert_payment_attempt_id_order_unique" UNIQUE("id","order_id"),
	CONSTRAINT "expert_payment_attempt_amount_bounds" CHECK ("expert_residency_payment_attempts"."expected_amount_minor" >= 0 and "expert_residency_payment_attempts"."expected_amount_minor" <= 999999999999),
	CONSTRAINT "expert_payment_attempt_currency_rub" CHECK ("expert_residency_payment_attempts"."currency" = 'RUB'),
	CONSTRAINT "expert_payment_attempt_resolution" CHECK (
        ("expert_residency_payment_attempts"."status" in ('created', 'pending', 'unknown_outcome') and "expert_residency_payment_attempts"."resolved_at" is null)
        or ("expert_residency_payment_attempts"."status" in ('settled', 'failed', 'refunded', 'charged_back') and "expert_residency_payment_attempts"."resolved_at" is not null)
      )
);
--> statement-breakpoint
CREATE TABLE "expert_residency_provider_event_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"payload_digest" text NOT NULL,
	"event_kind" text NOT NULL,
	"authenticated" boolean NOT NULL,
	"status" "expert_residency_provider_event_status" DEFAULT 'received' NOT NULL,
	"result_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_provider_event_unique" UNIQUE("provider","external_event_id"),
	CONSTRAINT "expert_provider_event_digest_format" CHECK ("expert_residency_provider_event_inbox"."payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "expert_provider_event_processing_state" CHECK (
        ("expert_residency_provider_event_inbox"."status" in ('received', 'processing', 'reconciliation_required') and "expert_residency_provider_event_inbox"."processed_at" is null)
        or ("expert_residency_provider_event_inbox"."status" in ('processed', 'rejected') and "expert_residency_provider_event_inbox"."processed_at" is not null)
      )
);
--> statement-breakpoint
CREATE TABLE "expert_residency_tariff_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tariff_key" text NOT NULL,
	"display_name" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"duration_seconds" integer NOT NULL,
	"active_from" timestamp with time zone NOT NULL,
	"active_to" timestamp with time zone NOT NULL,
	"approval_id" uuid NOT NULL,
	"admin_session_id_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_tariff_versions_approval_unique" UNIQUE("approval_id"),
	CONSTRAINT "expert_tariff_price_bounds" CHECK ("expert_residency_tariff_versions"."price_minor" > 0 and "expert_residency_tariff_versions"."price_minor" <= 999999999999),
	CONSTRAINT "expert_tariff_currency_rub" CHECK ("expert_residency_tariff_versions"."currency" = 'RUB'),
	CONSTRAINT "expert_tariff_duration_positive" CHECK ("expert_residency_tariff_versions"."duration_seconds" > 0),
	CONSTRAINT "expert_tariff_active_interval_valid" CHECK ("expert_residency_tariff_versions"."active_to" > "expert_residency_tariff_versions"."active_from")
);
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_residency_settlements_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_settlement_order_owner_fk" FOREIGN KEY ("qualifying_order_id","expert_id") REFERENCES "public"."expert_residency_orders"("id","expert_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_settlement_payment_order_fk" FOREIGN KEY ("qualifying_payment_attempt_id","qualifying_order_id") REFERENCES "public"."expert_residency_payment_attempts"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_settlement_referral_invitee_fk" FOREIGN KEY ("referral_id","expert_id") REFERENCES "public"."expert_referrals"("id","invitee_expert_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_opened_approval_id_admin_approvals_id_fk" FOREIGN KEY ("opened_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_opened_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("opened_admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_closed_approval_id_admin_approvals_id_fk" FOREIGN KEY ("closed_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_closed_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("closed_admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_code_batches" ADD CONSTRAINT "expert_referral_code_batches_inviter_expert_id_experts_id_fk" FOREIGN KEY ("inviter_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_code_batches" ADD CONSTRAINT "expert_referral_code_batches_issued_by_admin_id_users_id_fk" FOREIGN KEY ("issued_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_code_batches" ADD CONSTRAINT "expert_referral_code_batches_approval_id_admin_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_code_batches" ADD CONSTRAINT "expert_referral_code_batches_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_codes" ADD CONSTRAINT "expert_referral_codes_inviter_expert_id_experts_id_fk" FOREIGN KEY ("inviter_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_codes" ADD CONSTRAINT "expert_referral_codes_revoked_approval_id_admin_approvals_id_fk" FOREIGN KEY ("revoked_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_codes" ADD CONSTRAINT "expert_referral_codes_revoked_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("revoked_admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_codes" ADD CONSTRAINT "expert_referral_codes_batch_owner_fk" FOREIGN KEY ("batch_id","inviter_expert_id") REFERENCES "public"."expert_referral_code_batches"("id","inviter_expert_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_feature_controls" ADD CONSTRAINT "expert_referral_feature_controls_updated_approval_id_admin_approvals_id_fk" FOREIGN KEY ("updated_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_feature_controls" ADD CONSTRAINT "expert_referral_feature_controls_updated_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("updated_admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_inviter_expert_id_experts_id_fk" FOREIGN KEY ("inviter_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_approver_one_id_users_id_fk" FOREIGN KEY ("approver_one_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_approver_two_id_users_id_fk" FOREIGN KEY ("approver_two_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_approval_one_id_admin_approvals_id_fk" FOREIGN KEY ("approval_one_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_approval_two_id_admin_approvals_id_fk" FOREIGN KEY ("approval_two_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_requester_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("requester_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_allocations" ADD CONSTRAINT "expert_ledger_allocations_entry_owner_fk" FOREIGN KEY ("ledger_entry_id","expert_id") REFERENCES "public"."expert_referral_ledger_entries"("id","expert_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_allocations" ADD CONSTRAINT "expert_ledger_allocations_grant_owner_fk" FOREIGN KEY ("reward_grant_id","expert_id") REFERENCES "public"."expert_referral_reward_grants"("id","expert_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_entries" ADD CONSTRAINT "expert_referral_ledger_entries_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_entries" ADD CONSTRAINT "expert_referral_ledger_entries_order_id_expert_residency_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."expert_residency_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_entries" ADD CONSTRAINT "expert_referral_ledger_entries_admin_approval_id_admin_approvals_id_fk" FOREIGN KEY ("admin_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_entries" ADD CONSTRAINT "expert_referral_ledger_entries_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_entries" ADD CONSTRAINT "expert_ledger_original_entry_fk" FOREIGN KEY ("original_entry_id") REFERENCES "public"."expert_referral_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_reward_grants" ADD CONSTRAINT "expert_referral_reward_grants_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_reward_grants" ADD CONSTRAINT "expert_reward_grants_referral_inviter_fk" FOREIGN KEY ("referral_id","expert_id") REFERENCES "public"."expert_referrals"("id","inviter_expert_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_reward_grants" ADD CONSTRAINT "expert_reward_grants_first_marker_fk" FOREIGN KEY ("first_settlement_id","referral_id","qualifying_order_id","qualifying_payment_attempt_id") REFERENCES "public"."expert_first_residency_settlements"("id","referral_id","qualifying_order_id","qualifying_payment_attempt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referrals" ADD CONSTRAINT "expert_referrals_inviter_expert_id_experts_id_fk" FOREIGN KEY ("inviter_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referrals" ADD CONSTRAINT "expert_referrals_invitee_expert_id_experts_id_fk" FOREIGN KEY ("invitee_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referrals" ADD CONSTRAINT "expert_referrals_code_owner_fk" FOREIGN KEY ("code_id","inviter_expert_id") REFERENCES "public"."expert_referral_codes"("id","inviter_expert_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_orders" ADD CONSTRAINT "expert_residency_orders_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_orders" ADD CONSTRAINT "expert_residency_orders_tariff_version_id_expert_residency_tariff_versions_id_fk" FOREIGN KEY ("tariff_version_id") REFERENCES "public"."expert_residency_tariff_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_payment_attempts" ADD CONSTRAINT "expert_residency_payment_attempts_order_id_expert_residency_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."expert_residency_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_tariff_versions" ADD CONSTRAINT "expert_residency_tariff_versions_approval_id_admin_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_tariff_versions" ADD CONSTRAINT "expert_residency_tariff_versions_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expert_abuse_holds_closed_approval_unique" ON "expert_referral_abuse_holds" USING btree ("closed_approval_id") WHERE "expert_referral_abuse_holds"."closed_approval_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expert_abuse_holds_one_open_per_expert" ON "expert_referral_abuse_holds" USING btree ("expert_id") WHERE "expert_referral_abuse_holds"."status" = 'open';--> statement-breakpoint
CREATE INDEX "expert_referral_batches_inviter_created_idx" ON "expert_referral_code_batches" USING btree ("inviter_expert_id","created_at");--> statement-breakpoint
CREATE INDEX "expert_referral_codes_inviter_status_idx" ON "expert_referral_codes" USING btree ("inviter_expert_id","status","issued_at");--> statement-breakpoint
CREATE INDEX "expert_issuance_overrides_inviter_validity_idx" ON "expert_referral_issuance_overrides" USING btree ("inviter_expert_id","valid_until");--> statement-breakpoint
CREATE INDEX "expert_ledger_allocations_grant_idx" ON "expert_referral_ledger_allocations" USING btree ("reward_grant_id");--> statement-breakpoint
CREATE INDEX "expert_ledger_expert_created_idx" ON "expert_referral_ledger_entries" USING btree ("expert_id","created_at");--> statement-breakpoint
CREATE INDEX "expert_reward_grants_expert_expiry_idx" ON "expert_referral_reward_grants" USING btree ("expert_id","expires_at");--> statement-breakpoint
CREATE INDEX "expert_referrals_inviter_idx" ON "expert_referrals" USING btree ("inviter_expert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expert_orders_provider_payment_unique" ON "expert_residency_orders" USING btree ("provider_payment_id") WHERE "expert_residency_orders"."provider_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "expert_orders_status_deadline_idx" ON "expert_residency_orders" USING btree ("status","payment_deadline");--> statement-breakpoint
CREATE INDEX "expert_payment_attempt_order_status_idx" ON "expert_residency_payment_attempts" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "expert_provider_event_status_received_idx" ON "expert_residency_provider_event_inbox" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "expert_tariff_lookup_idx" ON "expert_residency_tariff_versions" USING btree ("tariff_key","active_from");--> statement-breakpoint
ALTER TABLE "experts" ADD CONSTRAINT "experts_user_id_unique" UNIQUE("user_id");--> statement-breakpoint
ALTER TABLE "expert_residency_tariff_versions"
  ADD CONSTRAINT "expert_tariff_active_interval_exclusion"
  EXCLUDE USING gist (
    "tariff_key" WITH =,
    tstzrange("active_from", "active_to", '[)') WITH &&
  );
--> statement-breakpoint
CREATE TRIGGER "expert_referral_append_only"
  BEFORE UPDATE OR DELETE ON "expert_referrals"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER "expert_referral_append_only"
  BEFORE UPDATE OR DELETE ON "expert_referral_reward_grants"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER "expert_referral_append_only"
  BEFORE UPDATE OR DELETE ON "expert_referral_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER "expert_referral_append_only"
  BEFORE UPDATE OR DELETE ON "expert_referral_ledger_allocations"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE FUNCTION expert_first_settlement_guard_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      CONSTRAINT = 'expert_first_settlement_transition',
      MESSAGE = 'expert_first_settlement_guard';
  END IF;

  IF OLD.eligibility <> 'pending_feature_hold'
    OR NEW.eligibility NOT IN ('eligible', 'permanently_ineligible', 'cancelled_by_refund')
    OR ROW(
      NEW.id,
      NEW.expert_id,
      NEW.settlement_sequence,
      NEW.qualifying_order_id,
      NEW.qualifying_payment_attempt_id,
      NEW.referral_id,
      NEW.settlement_expert_active,
      NEW.settlement_expert_verified,
      NEW.settlement_abuse_cleared,
      NEW.settled_at,
      NEW.created_at
    ) IS DISTINCT FROM ROW(
      OLD.id,
      OLD.expert_id,
      OLD.settlement_sequence,
      OLD.qualifying_order_id,
      OLD.qualifying_payment_attempt_id,
      OLD.referral_id,
      OLD.settlement_expert_active,
      OLD.settlement_expert_verified,
      OLD.settlement_abuse_cleared,
      OLD.settled_at,
      OLD.created_at
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      CONSTRAINT = 'expert_first_settlement_transition',
      MESSAGE = 'expert_first_settlement_guard';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "expert_first_settlement_guard"
  BEFORE UPDATE OR DELETE ON "expert_first_residency_settlements"
  FOR EACH ROW EXECUTE FUNCTION expert_first_settlement_guard_change();
--> statement-breakpoint
CREATE FUNCTION expert_reward_grant_require_eligible_settlement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  marker_eligibility expert_first_settlement_eligibility;
BEGIN
  SELECT eligibility
    INTO marker_eligibility
    FROM expert_first_residency_settlements
    WHERE id = NEW.first_settlement_id
      AND referral_id = NEW.referral_id
      AND qualifying_order_id = NEW.qualifying_order_id
      AND qualifying_payment_attempt_id = NEW.qualifying_payment_attempt_id
    FOR UPDATE;

  IF NOT FOUND OR marker_eligibility <> 'eligible' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'expert_reward_grants_eligible_settlement',
      MESSAGE = 'expert_reward_grants_eligible_settlement';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "expert_reward_grants_eligible_settlement"
  BEFORE INSERT ON "expert_referral_reward_grants"
  FOR EACH ROW EXECUTE FUNCTION expert_reward_grant_require_eligible_settlement();
--> statement-breakpoint
CREATE FUNCTION expert_referral_validate_ledger_allocation_total()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_entry_id uuid;
  expected_total bigint;
  allocated_total bigint;
BEGIN
  IF TG_TABLE_NAME = 'expert_referral_ledger_entries' THEN
    target_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.ledger_entry_id ELSE NEW.ledger_entry_id END;
  END IF;

  SELECT amount_minor
    INTO expected_total
    FROM expert_referral_ledger_entries
    WHERE id = target_entry_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(amount_minor), 0)::bigint
    INTO allocated_total
    FROM expert_referral_ledger_allocations
    WHERE ledger_entry_id = target_entry_id;

  IF allocated_total <> expected_total THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'expert_ledger_allocations_exact_total',
      MESSAGE = 'expert_ledger_allocations_exact_total';
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "expert_ledger_allocations_exact_total"
  AFTER INSERT OR UPDATE ON "expert_referral_ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION expert_referral_validate_ledger_allocation_total();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "expert_ledger_allocations_exact_total"
  AFTER INSERT OR UPDATE OR DELETE ON "expert_referral_ledger_allocations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION expert_referral_validate_ledger_allocation_total();
--> statement-breakpoint
CREATE VIEW "public"."expert_referral_balances" AS (
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
);
