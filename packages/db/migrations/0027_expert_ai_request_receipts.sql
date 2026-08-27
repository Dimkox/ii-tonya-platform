CREATE TABLE "expert_ai_request_receipts" (
  "request_key_hash" char(64) PRIMARY KEY NOT NULL,
  "request_digest" char(64) NOT NULL,
  "status" text NOT NULL,
  "claim_id" uuid NOT NULL,
  "lease_until" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "outcome_status" integer,
  "outcome_code" text,
  "outcome_detail" text,
  "expires_at" timestamp with time zone DEFAULT (now() + interval '7 days') NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "expert_ai_request_receipts_hashes_check" CHECK ("request_key_hash" ~ '^[0-9a-f]{64}$' AND "request_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "expert_ai_request_receipts_status_check" CHECK ("status" IN ('processing','complete','failed')),
  CONSTRAINT "expert_ai_request_receipts_version_check" CHECK ("version" > 0),
  CONSTRAINT "expert_ai_request_receipts_state_check" CHECK (("status" = 'processing' AND "lease_until" IS NOT NULL AND "outcome_status" IS NULL AND "outcome_code" IS NULL AND "outcome_detail" IS NULL) OR ("status" = 'failed' AND "lease_until" IS NULL AND "outcome_status" IS NULL AND "outcome_code" IS NULL AND "outcome_detail" IS NULL) OR ("status" = 'complete' AND "lease_until" IS NULL AND (("outcome_status" = 200 AND "outcome_code" = 'completed' AND "outcome_detail" IN ('redeem_expert_referral','view_referral_summary','quote_residency','start_residency_checkout')) OR ("outcome_status" = 422 AND "outcome_code" = 'proposal_rejected' AND "outcome_detail" IN ('invalid_shape','unsupported_intent','unauthorized_scope')) OR ("outcome_status" = 403 AND "outcome_code" = 'forbidden' AND "outcome_detail" IS NULL) OR ("outcome_status" = 503 AND "outcome_code" = 'feature_disabled' AND "outcome_detail" IS NULL))))
);
--> statement-breakpoint
CREATE INDEX "expert_ai_request_receipts_lease_idx" ON "expert_ai_request_receipts" ("lease_until") WHERE "status" = 'processing';
--> statement-breakpoint
CREATE INDEX "expert_ai_request_receipts_cleanup_idx" ON "expert_ai_request_receipts" ("expires_at") WHERE "status" IN ('complete','failed');
