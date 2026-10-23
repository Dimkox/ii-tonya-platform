-- Inactive applicant metadata only. No expert activation, paid entitlement,
-- archive restoration, approval backfill, or financial mutation follows.
CREATE TABLE expert_onboarding_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_quote_id uuid,
  verification_status text NOT NULL DEFAULT 'pending',
  onboarding_stage text,
  archived_at timestamptz,
  archive_until_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_onboarding_user_unique UNIQUE(user_id),
  CONSTRAINT expert_onboarding_user_fk FOREIGN KEY(user_id) REFERENCES users(id),
  -- 0050 already supplies payer_receipt_quote_owner_unique(id,user_id).
  -- MATCH SIMPLE deliberately permits no quote; a present quote must be owned.
  CONSTRAINT expert_onboarding_quote_owner_fk FOREIGN KEY(campaign_quote_id,user_id)
    REFERENCES expert_campaign_quotes(id,user_id),
  CONSTRAINT expert_onboarding_verification_valid CHECK(verification_status IN ('pending','approved','rejected')),
  CONSTRAINT expert_onboarding_stage_valid CHECK(onboarding_stage IN ('interview','card_draft','manager_review','promo_check','payment_ready')),
  CONSTRAINT expert_onboarding_archive_bounds CHECK(
    (archived_at IS NULL AND archive_until_date IS NULL) OR
    (archived_at IS NOT NULL AND archive_until_date IS NOT NULL
      AND isfinite(archived_at) AND isfinite(archive_until_date)
      AND archive_until_date >= archived_at
      AND archive_until_date <= (((archived_at AT TIME ZONE 'UTC') + interval '3 months') AT TIME ZONE 'UTC'))
  )
);
--> statement-breakpoint
CREATE INDEX expert_onboarding_pending_queue_idx
  ON expert_onboarding_applications(created_at,id) WHERE verification_status = 'pending';
