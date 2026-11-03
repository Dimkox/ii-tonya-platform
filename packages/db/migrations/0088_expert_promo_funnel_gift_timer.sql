ALTER TABLE expert_promo_funnel_state ADD COLUMN gift_sent_at timestamptz;
--> statement-breakpoint
ALTER TABLE expert_promo_funnel_state ADD CONSTRAINT expert_promo_funnel_gift_time CHECK(gift_sent_at IS NULL OR (isfinite(gift_sent_at) AND gift_sent_at>=code_issued_at));
