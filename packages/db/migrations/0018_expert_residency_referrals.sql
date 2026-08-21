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
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."expert_first_settlement_eligibility" AS ENUM('eligible', 'ineligible', 'pending_feature_hold', 'cancelled_by_refund');--> statement-breakpoint
CREATE TYPE "public"."expert_referral_abuse_hold_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."expert_referral_batch_status" AS ENUM('issued');--> statement-breakpoint
CREATE TYPE "public"."expert_referral_code_status" AS ENUM('issued', 'redeemed', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."expert_referral_ledger_entry_kind" AS ENUM('reward_grant', 'reservation', 'release', 'spend', 'expiry', 'reversal', 'debt_repayment', 'administrative_correction');--> statement-breakpoint
CREATE TYPE "public"."expert_residency_order_status" AS ENUM('quoted', 'payment_pending', 'settled', 'failed', 'expired', 'refunded', 'charged_back');--> statement-breakpoint
CREATE TYPE "public"."expert_residency_payment_attempt_status" AS ENUM('created', 'pending', 'unknown_outcome', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."expert_residency_provider_event_status" AS ENUM('pending', 'processing', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "expert_first_residency_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_sequence" bigserial NOT NULL,
	"expert_id" uuid NOT NULL,
	"qualifying_order_id" uuid NOT NULL,
	"eligibility_status" "expert_first_settlement_eligibility" NOT NULL,
	"eligibility_reason_code" text NOT NULL,
	"expert_active" boolean NOT NULL,
	"expert_verified" boolean NOT NULL,
	"unique_identity" boolean NOT NULL,
	"abuse_cleared" boolean NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_first_settlement_expert_unique" UNIQUE("expert_id"),
	CONSTRAINT "expert_first_settlement_order_unique" UNIQUE("qualifying_order_id"),
	CONSTRAINT "expert_first_settlement_sequence_unique" UNIQUE("settlement_sequence"),
	CONSTRAINT "expert_first_settlement_eligibility_snapshot" CHECK ("expert_first_residency_settlements"."eligibility_status" not in ('eligible', 'pending_feature_hold') or ("expert_first_residency_settlements"."expert_active" and "expert_first_residency_settlements"."expert_verified" and "expert_first_residency_settlements"."unique_identity" and "expert_first_residency_settlements"."abuse_cleared"))
);
--> statement-breakpoint
CREATE TABLE "expert_referral_abuse_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expert_id" uuid NOT NULL,
	"status" "expert_referral_abuse_hold_status" DEFAULT 'open' NOT NULL,
	"reason_code" text NOT NULL,
	"opened_approval_id" uuid NOT NULL,
	"opened_by_admin_id" uuid NOT NULL,
	"opened_admin_session_id_hash" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_approval_id" uuid,
	"closed_by_admin_id" uuid,
	"closed_admin_session_id_hash" text,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "expert_abuse_hold_opened_approval_unique" UNIQUE("opened_approval_id"),
	CONSTRAINT "expert_abuse_hold_version_positive" CHECK ("expert_referral_abuse_holds"."version" > 0),
	CONSTRAINT "expert_abuse_hold_lifecycle" CHECK (
        ("expert_referral_abuse_holds"."status" = 'open' and "expert_referral_abuse_holds"."closed_approval_id" is null and "expert_referral_abuse_holds"."closed_by_admin_id" is null and "expert_referral_abuse_holds"."closed_admin_session_id_hash" is null and "expert_referral_abuse_holds"."closed_at" is null)
        or ("expert_referral_abuse_holds"."status" = 'closed' and "expert_referral_abuse_holds"."closed_approval_id" is not null and "expert_referral_abuse_holds"."closed_by_admin_id" is not null and "expert_referral_abuse_holds"."closed_admin_session_id_hash" is not null and "expert_referral_abuse_holds"."closed_at" is not null and "expert_referral_abuse_holds"."closed_at" >= "expert_referral_abuse_holds"."opened_at")
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
	CONSTRAINT "expert_referral_batch_identity_unique" UNIQUE("id","inviter_expert_id"),
	CONSTRAINT "expert_referral_batch_approval_unique" UNIQUE("approval_id"),
	CONSTRAINT "expert_referral_batch_count_bounds" CHECK ("expert_referral_code_batches"."requested_count" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "expert_referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"inviter_expert_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"masked_suffix" text NOT NULL,
	"hmac_key_version" integer NOT NULL,
	"status" "expert_referral_code_status" DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_approval_id" uuid,
	"revoked_by_admin_id" uuid,
	"revocation_admin_session_id_hash" text,
	CONSTRAINT "expert_referral_code_identity_unique" UNIQUE("id","inviter_expert_id"),
	CONSTRAINT "expert_referral_code_hash_unique" UNIQUE("hmac_key_version","code_hash"),
	CONSTRAINT "expert_referral_code_key_version_positive" CHECK ("expert_referral_codes"."hmac_key_version" > 0),
	CONSTRAINT "expert_referral_code_mask_present" CHECK (char_length("expert_referral_codes"."masked_suffix") between 1 and 32),
	CONSTRAINT "expert_referral_code_lifecycle" CHECK (
        ("expert_referral_codes"."status" = 'issued' and "expert_referral_codes"."redeemed_at" is null and "expert_referral_codes"."revoked_at" is null and "expert_referral_codes"."revocation_approval_id" is null and "expert_referral_codes"."revoked_by_admin_id" is null and "expert_referral_codes"."revocation_admin_session_id_hash" is null)
        or ("expert_referral_codes"."status" = 'redeemed' and "expert_referral_codes"."redeemed_at" is not null and "expert_referral_codes"."revoked_at" is null and "expert_referral_codes"."revocation_approval_id" is null and "expert_referral_codes"."revoked_by_admin_id" is null and "expert_referral_codes"."revocation_admin_session_id_hash" is null)
        or ("expert_referral_codes"."status" = 'revoked' and "expert_referral_codes"."redeemed_at" is null and "expert_referral_codes"."revoked_at" is not null and "expert_referral_codes"."revocation_approval_id" is not null and "expert_referral_codes"."revoked_by_admin_id" is not null and "expert_referral_codes"."revocation_admin_session_id_hash" is not null)
      )
);
--> statement-breakpoint
CREATE TABLE "expert_referral_feature_controls" (
	"feature_key" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"new_commands_enabled" boolean DEFAULT false NOT NULL,
	"reward_grants_enabled" boolean DEFAULT false NOT NULL,
	"approval_id" uuid NOT NULL,
	"changed_by_admin_id" uuid NOT NULL,
	"admin_session_id_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_feature_control_approval_unique" UNIQUE("approval_id"),
	CONSTRAINT "expert_feature_control_singleton" CHECK ("expert_referral_feature_controls"."feature_key" = 'expert_referrals'),
	CONSTRAINT "expert_feature_control_version_positive" CHECK ("expert_referral_feature_controls"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "expert_referral_issuance_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_expert_id" uuid NOT NULL,
	"additional_quota" integer NOT NULL,
	"consumed_count" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"requested_by_admin_id" uuid NOT NULL,
	"requester_session_id_hash" text NOT NULL,
	"first_approver_id" uuid NOT NULL,
	"second_approver_id" uuid NOT NULL,
	"first_approval_id" uuid NOT NULL,
	"second_approval_id" uuid NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_issuance_override_first_approval_unique" UNIQUE("first_approval_id"),
	CONSTRAINT "expert_issuance_override_second_approval_unique" UNIQUE("second_approval_id"),
	CONSTRAINT "expert_issuance_override_quota_bounds" CHECK ("expert_referral_issuance_overrides"."additional_quota" between 1 and 1000 and "expert_referral_issuance_overrides"."consumed_count" between 0 and "expert_referral_issuance_overrides"."additional_quota"),
	CONSTRAINT "expert_issuance_override_approval_separation" CHECK ("expert_referral_issuance_overrides"."requested_by_admin_id" <> "expert_referral_issuance_overrides"."first_approver_id" and "expert_referral_issuance_overrides"."requested_by_admin_id" <> "expert_referral_issuance_overrides"."second_approver_id" and "expert_referral_issuance_overrides"."first_approver_id" <> "expert_referral_issuance_overrides"."second_approver_id" and "expert_referral_issuance_overrides"."first_approval_id" <> "expert_referral_issuance_overrides"."second_approval_id"),
	CONSTRAINT "expert_issuance_override_interval" CHECK ("expert_referral_issuance_overrides"."expires_at" > "expert_referral_issuance_overrides"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "expert_referral_ledger_allocations" (
	"ledger_entry_id" uuid NOT NULL,
	"reward_grant_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_ledger_allocation_pk" PRIMARY KEY("ledger_entry_id","reward_grant_id"),
	CONSTRAINT "expert_ledger_allocation_positive" CHECK ("expert_referral_ledger_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "expert_referral_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_expert_id" uuid NOT NULL,
	"entry_kind" "expert_referral_ledger_entry_kind" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"original_entry_id" uuid,
	"admin_approval_id" uuid,
	"admin_session_id_hash" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_ledger_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "expert_ledger_source_fact_unique" UNIQUE("entry_kind","source_type","source_id"),
	CONSTRAINT "expert_ledger_entry_contract" CHECK (
        ("expert_referral_ledger_entries"."entry_kind" = 'reward_grant' and "expert_referral_ledger_entries"."amount_minor" > 0 and "expert_referral_ledger_entries"."original_entry_id" is null and "expert_referral_ledger_entries"."admin_approval_id" is null and "expert_referral_ledger_entries"."admin_session_id_hash" is null)
        or ("expert_referral_ledger_entries"."entry_kind" = 'reservation' and "expert_referral_ledger_entries"."amount_minor" < 0 and "expert_referral_ledger_entries"."original_entry_id" is null and "expert_referral_ledger_entries"."admin_approval_id" is null and "expert_referral_ledger_entries"."admin_session_id_hash" is null)
        or ("expert_referral_ledger_entries"."entry_kind" = 'release' and "expert_referral_ledger_entries"."amount_minor" > 0 and "expert_referral_ledger_entries"."original_entry_id" is not null and "expert_referral_ledger_entries"."admin_approval_id" is null and "expert_referral_ledger_entries"."admin_session_id_hash" is null)
        or ("expert_referral_ledger_entries"."entry_kind" = 'spend' and "expert_referral_ledger_entries"."amount_minor" < 0 and "expert_referral_ledger_entries"."original_entry_id" is not null and "expert_referral_ledger_entries"."admin_approval_id" is null and "expert_referral_ledger_entries"."admin_session_id_hash" is null)
        or ("expert_referral_ledger_entries"."entry_kind" in ('expiry', 'reversal') and "expert_referral_ledger_entries"."amount_minor" < 0 and "expert_referral_ledger_entries"."admin_approval_id" is null and "expert_referral_ledger_entries"."admin_session_id_hash" is null)
        or ("expert_referral_ledger_entries"."entry_kind" = 'debt_repayment' and "expert_referral_ledger_entries"."amount_minor" > 0 and "expert_referral_ledger_entries"."admin_approval_id" is null and "expert_referral_ledger_entries"."admin_session_id_hash" is null)
        or ("expert_referral_ledger_entries"."entry_kind" = 'administrative_correction' and "expert_referral_ledger_entries"."amount_minor" <> 0 and "expert_referral_ledger_entries"."admin_approval_id" is not null and "expert_referral_ledger_entries"."admin_session_id_hash" is not null)
      )
);
--> statement-breakpoint
CREATE TABLE "expert_referral_reward_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_expert_id" uuid NOT NULL,
	"referral_id" uuid NOT NULL,
	"qualifying_order_id" uuid NOT NULL,
	"first_settlement_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "expert_reward_referral_unique" UNIQUE("referral_id"),
	CONSTRAINT "expert_reward_order_unique" UNIQUE("qualifying_order_id"),
	CONSTRAINT "expert_reward_first_settlement_unique" UNIQUE("first_settlement_id"),
	CONSTRAINT "expert_reward_exact_amount" CHECK ("expert_referral_reward_grants"."amount_minor" = 100000),
	CONSTRAINT "expert_reward_exact_expiry" CHECK (extract(epoch from ("expert_referral_reward_grants"."expires_at" - "expert_referral_reward_grants"."granted_at")) = 31536000)
);
--> statement-breakpoint
CREATE TABLE "expert_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_id" uuid NOT NULL,
	"inviter_expert_id" uuid NOT NULL,
	"invitee_expert_id" uuid NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_referral_code_unique" UNIQUE("code_id"),
	CONSTRAINT "expert_referral_invitee_unique" UNIQUE("invitee_expert_id"),
	CONSTRAINT "expert_referral_distinct_experts" CHECK ("expert_referrals"."inviter_expert_id" <> "expert_referrals"."invitee_expert_id")
);
--> statement-breakpoint
CREATE TABLE "expert_residency_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expert_id" uuid NOT NULL,
	"tariff_version_id" uuid NOT NULL,
	"tariff_name" text NOT NULL,
	"tariff_description" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"credit_minor" bigint NOT NULL,
	"cash_minor" bigint NOT NULL,
	"payment_deadline" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"payment_provider" text,
	"provider_payment_id" text,
	"status" "expert_residency_order_status" DEFAULT 'quoted' NOT NULL,
	"quoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_started_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"residency_starts_at" timestamp with time zone,
	"residency_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_order_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "expert_order_price_positive" CHECK ("expert_residency_orders"."price_minor" > 0),
	CONSTRAINT "expert_order_nonnegative_quotes" CHECK ("expert_residency_orders"."credit_minor" >= 0 and "expert_residency_orders"."cash_minor" >= 0),
	CONSTRAINT "expert_order_credit_cap" CHECK ("expert_residency_orders"."credit_minor" <= "expert_residency_orders"."price_minor" / 2),
	CONSTRAINT "expert_order_cash_remainder" CHECK ("expert_residency_orders"."cash_minor" = "expert_residency_orders"."price_minor" - "expert_residency_orders"."credit_minor"),
	CONSTRAINT "expert_order_currency_rub" CHECK ("expert_residency_orders"."currency" = 'RUB'),
	CONSTRAINT "expert_order_duration_bounds" CHECK ("expert_residency_orders"."duration_seconds" between 86400 and 315360000),
	CONSTRAINT "expert_order_payment_deadline_after_quote" CHECK ("expert_residency_orders"."payment_deadline" > "expert_residency_orders"."quoted_at"),
	CONSTRAINT "expert_order_provider_identity_complete" CHECK (("expert_residency_orders"."payment_provider" is null and "expert_residency_orders"."provider_payment_id" is null) or ("expert_residency_orders"."payment_provider" is not null and "expert_residency_orders"."provider_payment_id" is not null)),
	CONSTRAINT "expert_order_residency_interval_complete" CHECK (
        ("expert_residency_orders"."settled_at" is null and "expert_residency_orders"."residency_starts_at" is null and "expert_residency_orders"."residency_ends_at" is null)
        or ("expert_residency_orders"."settled_at" is not null and "expert_residency_orders"."residency_starts_at" is not null and "expert_residency_orders"."residency_ends_at" is not null and extract(epoch from ("expert_residency_orders"."residency_ends_at" - "expert_residency_orders"."residency_starts_at")) = "expert_residency_orders"."duration_seconds")
      )
);
--> statement-breakpoint
CREATE TABLE "expert_residency_payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_request_id" text NOT NULL,
	"expected_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "expert_residency_payment_attempt_status" DEFAULT 'created' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_payment_attempt_provider_request_unique" UNIQUE("provider","provider_request_id"),
	CONSTRAINT "expert_payment_attempt_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "expert_payment_attempt_amount_positive" CHECK ("expert_residency_payment_attempts"."expected_amount_minor" > 0),
	CONSTRAINT "expert_payment_attempt_currency_rub" CHECK ("expert_residency_payment_attempts"."currency" = 'RUB')
);
--> statement-breakpoint
CREATE TABLE "expert_residency_provider_event_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"payment_attempt_id" uuid,
	"order_id" uuid,
	"payload_digest" text NOT NULL,
	"authenticated" boolean NOT NULL,
	"event_kind" text NOT NULL,
	"processing_status" "expert_residency_provider_event_status" DEFAULT 'pending' NOT NULL,
	"processing_result_digest" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "expert_provider_event_unique" UNIQUE("provider","external_event_id"),
	CONSTRAINT "expert_provider_event_processing_result" CHECK (
        ("expert_residency_provider_event_inbox"."processing_status" in ('pending', 'processing') and "expert_residency_provider_event_inbox"."processed_at" is null)
        or ("expert_residency_provider_event_inbox"."processing_status" in ('processed', 'failed') and "expert_residency_provider_event_inbox"."processed_at" is not null and "expert_residency_provider_event_inbox"."processing_result_digest" is not null)
      )
);
--> statement-breakpoint
CREATE TABLE "expert_residency_tariff_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tariff_key" text NOT NULL,
	"version" integer NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"active_from" timestamp with time zone NOT NULL,
	"active_to" timestamp with time zone,
	"created_by_admin_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"admin_session_id_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expert_tariff_version_unique" UNIQUE("tariff_key","version"),
	CONSTRAINT "expert_tariff_approval_unique" UNIQUE("approval_id"),
	CONSTRAINT "expert_tariff_version_positive" CHECK ("expert_residency_tariff_versions"."version" > 0),
	CONSTRAINT "expert_tariff_price_positive" CHECK ("expert_residency_tariff_versions"."price_minor" > 0),
	CONSTRAINT "expert_tariff_currency_rub" CHECK ("expert_residency_tariff_versions"."currency" = 'RUB'),
	CONSTRAINT "expert_tariff_duration_bounds" CHECK ("expert_residency_tariff_versions"."duration_seconds" between 86400 and 315360000),
	CONSTRAINT "expert_tariff_active_interval" CHECK ("expert_residency_tariff_versions"."active_to" is null or "expert_residency_tariff_versions"."active_to" > "expert_residency_tariff_versions"."active_from")
);
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_residency_settlements_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_residency_settlements_qualifying_order_id_expert_residency_orders_id_fk" FOREIGN KEY ("qualifying_order_id") REFERENCES "public"."expert_residency_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_opened_approval_id_admin_approvals_id_fk" FOREIGN KEY ("opened_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_opened_by_admin_id_users_id_fk" FOREIGN KEY ("opened_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_opened_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("opened_admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_closed_approval_id_admin_approvals_id_fk" FOREIGN KEY ("closed_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_closed_by_admin_id_users_id_fk" FOREIGN KEY ("closed_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_abuse_holds" ADD CONSTRAINT "expert_referral_abuse_holds_closed_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("closed_admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_code_batches" ADD CONSTRAINT "expert_referral_code_batches_inviter_expert_id_experts_id_fk" FOREIGN KEY ("inviter_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_code_batches" ADD CONSTRAINT "expert_referral_code_batches_issued_by_admin_id_users_id_fk" FOREIGN KEY ("issued_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_code_batches" ADD CONSTRAINT "expert_referral_code_batches_approval_id_admin_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_code_batches" ADD CONSTRAINT "expert_referral_code_batches_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_codes" ADD CONSTRAINT "expert_referral_codes_inviter_expert_id_experts_id_fk" FOREIGN KEY ("inviter_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_codes" ADD CONSTRAINT "expert_referral_codes_revocation_approval_id_admin_approvals_id_fk" FOREIGN KEY ("revocation_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_codes" ADD CONSTRAINT "expert_referral_codes_revoked_by_admin_id_users_id_fk" FOREIGN KEY ("revoked_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_codes" ADD CONSTRAINT "expert_referral_codes_revocation_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("revocation_admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_codes" ADD CONSTRAINT "expert_referral_code_batch_inviter_fk" FOREIGN KEY ("batch_id","inviter_expert_id") REFERENCES "public"."expert_referral_code_batches"("id","inviter_expert_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_feature_controls" ADD CONSTRAINT "expert_referral_feature_controls_approval_id_admin_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_feature_controls" ADD CONSTRAINT "expert_referral_feature_controls_changed_by_admin_id_users_id_fk" FOREIGN KEY ("changed_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_feature_controls" ADD CONSTRAINT "expert_referral_feature_controls_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_inviter_expert_id_experts_id_fk" FOREIGN KEY ("inviter_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_requested_by_admin_id_users_id_fk" FOREIGN KEY ("requested_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_requester_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("requester_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_first_approver_id_users_id_fk" FOREIGN KEY ("first_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_second_approver_id_users_id_fk" FOREIGN KEY ("second_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_first_approval_id_admin_approvals_id_fk" FOREIGN KEY ("first_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_issuance_overrides" ADD CONSTRAINT "expert_referral_issuance_overrides_second_approval_id_admin_approvals_id_fk" FOREIGN KEY ("second_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_allocations" ADD CONSTRAINT "expert_referral_ledger_allocations_ledger_entry_id_expert_referral_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."expert_referral_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_allocations" ADD CONSTRAINT "expert_referral_ledger_allocations_reward_grant_id_expert_referral_reward_grants_id_fk" FOREIGN KEY ("reward_grant_id") REFERENCES "public"."expert_referral_reward_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_entries" ADD CONSTRAINT "expert_referral_ledger_entries_account_expert_id_experts_id_fk" FOREIGN KEY ("account_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_entries" ADD CONSTRAINT "expert_referral_ledger_entries_admin_approval_id_admin_approvals_id_fk" FOREIGN KEY ("admin_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_entries" ADD CONSTRAINT "expert_referral_ledger_entries_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_ledger_entries" ADD CONSTRAINT "expert_ledger_original_entry_fk" FOREIGN KEY ("original_entry_id") REFERENCES "public"."expert_referral_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_reward_grants" ADD CONSTRAINT "expert_referral_reward_grants_inviter_expert_id_experts_id_fk" FOREIGN KEY ("inviter_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_reward_grants" ADD CONSTRAINT "expert_referral_reward_grants_referral_id_expert_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."expert_referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_reward_grants" ADD CONSTRAINT "expert_referral_reward_grants_qualifying_order_id_expert_residency_orders_id_fk" FOREIGN KEY ("qualifying_order_id") REFERENCES "public"."expert_residency_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referral_reward_grants" ADD CONSTRAINT "expert_referral_reward_grants_first_settlement_id_expert_first_residency_settlements_id_fk" FOREIGN KEY ("first_settlement_id") REFERENCES "public"."expert_first_residency_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referrals" ADD CONSTRAINT "expert_referrals_inviter_expert_id_experts_id_fk" FOREIGN KEY ("inviter_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referrals" ADD CONSTRAINT "expert_referrals_invitee_expert_id_experts_id_fk" FOREIGN KEY ("invitee_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_referrals" ADD CONSTRAINT "expert_referral_code_inviter_fk" FOREIGN KEY ("code_id","inviter_expert_id") REFERENCES "public"."expert_referral_codes"("id","inviter_expert_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_orders" ADD CONSTRAINT "expert_residency_orders_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_orders" ADD CONSTRAINT "expert_residency_orders_tariff_version_id_expert_residency_tariff_versions_id_fk" FOREIGN KEY ("tariff_version_id") REFERENCES "public"."expert_residency_tariff_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_payment_attempts" ADD CONSTRAINT "expert_residency_payment_attempts_order_id_expert_residency_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."expert_residency_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ADD CONSTRAINT "expert_residency_provider_event_inbox_payment_attempt_id_expert_residency_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."expert_residency_payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ADD CONSTRAINT "expert_residency_provider_event_inbox_order_id_expert_residency_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."expert_residency_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_tariff_versions" ADD CONSTRAINT "expert_residency_tariff_versions_created_by_admin_id_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_tariff_versions" ADD CONSTRAINT "expert_residency_tariff_versions_approval_id_admin_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_residency_tariff_versions" ADD CONSTRAINT "expert_residency_tariff_versions_admin_session_id_hash_admin_sessions_session_id_hash_fk" FOREIGN KEY ("admin_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expert_abuse_hold_closed_approval_unique" ON "expert_referral_abuse_holds" USING btree ("closed_approval_id") WHERE "expert_referral_abuse_holds"."closed_approval_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expert_abuse_hold_one_open" ON "expert_referral_abuse_holds" USING btree ("expert_id") WHERE "expert_referral_abuse_holds"."status" = 'open';--> statement-breakpoint
CREATE INDEX "expert_referral_batch_inviter_created" ON "expert_referral_code_batches" USING btree ("inviter_expert_id","created_at");--> statement-breakpoint
CREATE INDEX "expert_referral_code_inventory" ON "expert_referral_codes" USING btree ("inviter_expert_id","status","issued_at");--> statement-breakpoint
CREATE INDEX "expert_issuance_override_inviter_expiry" ON "expert_referral_issuance_overrides" USING btree ("inviter_expert_id","expires_at");--> statement-breakpoint
CREATE INDEX "expert_ledger_allocation_grant" ON "expert_referral_ledger_allocations" USING btree ("reward_grant_id","ledger_entry_id");--> statement-breakpoint
CREATE INDEX "expert_ledger_account_created" ON "expert_referral_ledger_entries" USING btree ("account_expert_id","created_at","id");--> statement-breakpoint
CREATE INDEX "expert_ledger_original_entry" ON "expert_referral_ledger_entries" USING btree ("original_entry_id");--> statement-breakpoint
CREATE INDEX "expert_reward_inviter_expiry" ON "expert_referral_reward_grants" USING btree ("inviter_expert_id","expires_at","granted_at","id");--> statement-breakpoint
CREATE INDEX "expert_referral_inviter_bound" ON "expert_referrals" USING btree ("inviter_expert_id","bound_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expert_order_provider_payment_unique" ON "expert_residency_orders" USING btree ("payment_provider","provider_payment_id") WHERE "expert_residency_orders"."payment_provider" is not null and "expert_residency_orders"."provider_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "expert_order_expert_status_deadline" ON "expert_residency_orders" USING btree ("expert_id","status","payment_deadline");--> statement-breakpoint
CREATE INDEX "expert_payment_attempt_order_status" ON "expert_residency_payment_attempts" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "expert_provider_event_processing_queue" ON "expert_residency_provider_event_inbox" USING btree ("processing_status","received_at");--> statement-breakpoint
CREATE INDEX "expert_tariff_activation_lookup" ON "expert_residency_tariff_versions" USING btree ("tariff_key","active_from","active_to");--> statement-breakpoint
ALTER TABLE "expert_residency_tariff_versions"
  ADD CONSTRAINT "expert_tariff_active_interval_exclusion"
  EXCLUDE USING gist (
    "tariff_key" WITH =,
    tstzrange("active_from", "active_to", '[)') WITH &&
  );--> statement-breakpoint
ALTER TABLE "experts" ADD CONSTRAINT "experts_user_id_unique" UNIQUE("user_id");--> statement-breakpoint
CREATE FUNCTION reject_expert_referral_append_only_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'expert referral append-only fact cannot be changed',
    CONSTRAINT = TG_TABLE_NAME || '_append_only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "expert_referrals_append_only"
BEFORE UPDATE OR DELETE ON "expert_referrals"
FOR EACH ROW EXECUTE FUNCTION reject_expert_referral_append_only_change();--> statement-breakpoint
CREATE TRIGGER "expert_first_residency_settlements_append_only"
BEFORE UPDATE OR DELETE ON "expert_first_residency_settlements"
FOR EACH ROW EXECUTE FUNCTION reject_expert_referral_append_only_change();--> statement-breakpoint
CREATE TRIGGER "expert_referral_reward_grants_append_only"
BEFORE UPDATE OR DELETE ON "expert_referral_reward_grants"
FOR EACH ROW EXECUTE FUNCTION reject_expert_referral_append_only_change();--> statement-breakpoint
CREATE TRIGGER "expert_referral_ledger_entries_append_only"
BEFORE UPDATE OR DELETE ON "expert_referral_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION reject_expert_referral_append_only_change();--> statement-breakpoint
CREATE TRIGGER "expert_referral_ledger_allocations_append_only"
BEFORE UPDATE OR DELETE ON "expert_referral_ledger_allocations"
FOR EACH ROW EXECUTE FUNCTION reject_expert_referral_append_only_change();--> statement-breakpoint
CREATE FUNCTION enforce_expert_ledger_allocation_total()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_ledger_entry_id uuid;
  target_amount_minor bigint;
  target_account_expert_id uuid;
  allocated_minor numeric;
BEGIN
  IF TG_TABLE_NAME = 'expert_referral_ledger_entries' THEN
    target_ledger_entry_id := NEW.id;
  ELSE
    target_ledger_entry_id := NEW.ledger_entry_id;
  END IF;

  SELECT abs(amount_minor), account_expert_id
  INTO target_amount_minor, target_account_expert_id
  FROM expert_referral_ledger_entries
  WHERE id = target_ledger_entry_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM expert_referral_ledger_allocations a
    JOIN expert_referral_reward_grants g ON g.id = a.reward_grant_id
    WHERE a.ledger_entry_id = target_ledger_entry_id
      AND g.inviter_expert_id <> target_account_expert_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'expert ledger allocation account mismatch',
      CONSTRAINT = 'expert_ledger_allocation_account_match';
  END IF;

  SELECT coalesce(sum(amount_minor), 0)
  INTO allocated_minor
  FROM expert_referral_ledger_allocations
  WHERE ledger_entry_id = target_ledger_entry_id;

  IF allocated_minor <> target_amount_minor THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'expert ledger entry requires exact reward-grant allocations',
      CONSTRAINT = 'expert_ledger_allocation_required';
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "expert_ledger_entry_allocation_required"
AFTER INSERT ON "expert_referral_ledger_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_expert_ledger_allocation_total();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "expert_ledger_allocation_total"
AFTER INSERT ON "expert_referral_ledger_allocations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_expert_ledger_allocation_total();--> statement-breakpoint
CREATE FUNCTION enforce_expert_reward_grant_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM expert_referrals r
    JOIN expert_first_residency_settlements s
      ON s.id = NEW.first_settlement_id
    WHERE r.id = NEW.referral_id
      AND r.inviter_expert_id = NEW.inviter_expert_id
      AND r.invitee_expert_id = s.expert_id
      AND s.qualifying_order_id = NEW.qualifying_order_id
      AND s.eligibility_status = 'eligible'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'expert reward grant identity chain is invalid',
      CONSTRAINT = 'expert_reward_identity_chain';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "expert_reward_identity_chain"
BEFORE INSERT ON "expert_referral_reward_grants"
FOR EACH ROW EXECUTE FUNCTION enforce_expert_reward_grant_identity();--> statement-breakpoint
CREATE FUNCTION enforce_expert_abuse_hold_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'expert abuse hold deletion is forbidden',
      CONSTRAINT = 'expert_abuse_hold_lifecycle';
  END IF;
  IF OLD.status <> 'open' OR NEW.status <> 'closed'
    OR NEW.version <> OLD.version + 1
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.expert_id IS DISTINCT FROM OLD.expert_id
    OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
    OR NEW.opened_approval_id IS DISTINCT FROM OLD.opened_approval_id
    OR NEW.opened_by_admin_id IS DISTINCT FROM OLD.opened_by_admin_id
    OR NEW.opened_admin_session_id_hash IS DISTINCT FROM OLD.opened_admin_session_id_hash
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
    OR NEW.closed_at > clock_timestamp()
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'invalid expert abuse hold transition',
      CONSTRAINT = 'expert_abuse_hold_lifecycle';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "expert_abuse_hold_transition"
BEFORE UPDATE OR DELETE ON "expert_referral_abuse_holds"
FOR EACH ROW EXECUTE FUNCTION enforce_expert_abuse_hold_transition();--> statement-breakpoint
CREATE FUNCTION enforce_expert_feature_control_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'expert feature control deletion is forbidden',
      CONSTRAINT = 'expert_feature_control_version_positive';
  END IF;
  IF NEW.feature_key IS DISTINCT FROM OLD.feature_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.version <> OLD.version + 1
    OR NEW.updated_at < OLD.updated_at
    OR NEW.updated_at > clock_timestamp()
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'expert feature control version conflict',
      CONSTRAINT = 'expert_feature_control_version_positive';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "expert_feature_control_transition"
BEFORE UPDATE OR DELETE ON "expert_referral_feature_controls"
FOR EACH ROW EXECUTE FUNCTION enforce_expert_feature_control_transition();--> statement-breakpoint
CREATE FUNCTION enforce_expert_order_snapshot_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'expert residency order deletion is forbidden',
      CONSTRAINT = 'expert_order_snapshot_immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.expert_id IS DISTINCT FROM OLD.expert_id
    OR NEW.tariff_version_id IS DISTINCT FROM OLD.tariff_version_id
    OR NEW.tariff_name IS DISTINCT FROM OLD.tariff_name
    OR NEW.tariff_description IS DISTINCT FROM OLD.tariff_description
    OR NEW.price_minor IS DISTINCT FROM OLD.price_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
    OR NEW.credit_minor IS DISTINCT FROM OLD.credit_minor
    OR NEW.cash_minor IS DISTINCT FROM OLD.cash_minor
    OR NEW.payment_deadline IS DISTINCT FROM OLD.payment_deadline
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.quoted_at IS DISTINCT FROM OLD.quoted_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'expert residency order snapshot is immutable',
      CONSTRAINT = 'expert_order_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "expert_order_snapshot_immutable"
BEFORE UPDATE OR DELETE ON "expert_residency_orders"
FOR EACH ROW EXECUTE FUNCTION enforce_expert_order_snapshot_immutability();--> statement-breakpoint
CREATE VIEW "public"."expert_referral_balances" AS (
  with grant_positions as (
    select
      g.id as grant_id,
      g.inviter_expert_id as expert_id,
      g.expires_at,
      coalesce(sum(
        case when l.amount_minor < 0 then -a.amount_minor else a.amount_minor end
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
);
