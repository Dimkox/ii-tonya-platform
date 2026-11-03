CREATE TABLE expert_promo_funnel_state (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'REFERRAL_ACTIVE',
  incoming_referrer_code text,
  opt_out_ref boolean NOT NULL DEFAULT false,
  opt_out_at timestamptz,
  code_issued_at timestamptz NOT NULL DEFAULT now(),
  message6_sent_at timestamptz,
  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  first_name text,
  gender text,
  crm_synced_referral_count integer,
  crm_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_promo_funnel_status CHECK(status IN ('REFERRAL_ACTIVE','WAITING_FOR_LAUNCH')),
  CONSTRAINT expert_promo_funnel_incoming_code CHECK(incoming_referrer_code IS NULL OR incoming_referrer_code ~ '^promo_[0-9a-f]{32}$'),
  CONSTRAINT expert_promo_funnel_opt_out CHECK((opt_out_ref AND opt_out_at IS NOT NULL AND isfinite(opt_out_at)) OR (NOT opt_out_ref AND opt_out_at IS NULL)),
  CONSTRAINT expert_promo_funnel_times CHECK(isfinite(code_issued_at) AND isfinite(last_interaction_at) AND (message6_sent_at IS NULL OR (isfinite(message6_sent_at) AND message6_sent_at>=code_issued_at))),
  CONSTRAINT expert_promo_funnel_first_name CHECK(first_name IS NULL OR length(first_name) BETWEEN 1 AND 64),
  CONSTRAINT expert_promo_funnel_gender CHECK(gender IS NULL OR gender IN ('female','male')),
  CONSTRAINT expert_promo_funnel_crm CHECK((crm_synced_referral_count IS NULL AND crm_synced_at IS NULL) OR (crm_synced_referral_count>=0 AND crm_synced_at IS NOT NULL AND isfinite(crm_synced_at)))
);
--> statement-breakpoint
CREATE INDEX expert_promo_funnel_timer_idx ON expert_promo_funnel_state(code_issued_at) WHERE status='REFERRAL_ACTIVE' AND NOT opt_out_ref;
--> statement-breakpoint
CREATE TABLE expert_promo_manager_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_promo_question_text CHECK(length(question) BETWEEN 1 AND 3000),
  CONSTRAINT expert_promo_question_status CHECK(status IN ('open','answered'))
);
--> statement-breakpoint
CREATE INDEX expert_promo_manager_questions_open_idx ON expert_promo_manager_questions(created_at) WHERE status='open';
