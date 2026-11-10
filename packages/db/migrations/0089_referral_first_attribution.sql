-- First inviter wins for every referral program. Existing attribution rows are
-- not rewritten. Legacy promo rows keep counts_for_inviter NULL and still count.
ALTER TABLE expert_promo_registrations
  ADD COLUMN counts_for_inviter boolean;
--> statement-breakpoint
ALTER TABLE expert_promo_registrations
  ADD CONSTRAINT expert_promo_counts_for_inviter
  CHECK (counts_for_inviter IS NOT TRUE OR referrer_user_id IS NOT NULL);
--> statement-breakpoint
COMMENT ON TABLE expert_promo_registrations IS
  'First inviter wins. One row per referred user. A later promo code or referral link does not move attribution, bonuses, or the PDF count. Insert with ON CONFLICT (user_id) DO NOTHING. counts_for_inviter is true only for a new visitor attributed on the first bot contact; NULL keeps legacy rows in the count; false means a later code was not counted.';
--> statement-breakpoint
COMMENT ON COLUMN expert_promo_registrations.counts_for_inviter IS
  'True only when this registration is a new visitor attributed to the first inviter. The promo PDF counts two such visitors and is issued once.';
--> statement-breakpoint
COMMENT ON TABLE expert_referrals IS
  'First inviter wins. expert_referrals_invitee_unique allows one inviter per invitee. A later resident code does not move the bonus. Insert with ON CONFLICT (invitee_expert_id) DO NOTHING.';
--> statement-breakpoint
COMMENT ON CONSTRAINT expert_referrals_invitee_unique ON expert_referrals IS
  'The referred expert is attributed once, to the first inviter.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_promo_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='expert_promo_registrations' THEN
   IF NEW.identity_digest IS NULL AND NEW.erased_at IS NOT NULL
    AND NEW.user_id=OLD.user_id AND NEW.referrer_user_id IS NOT DISTINCT FROM OLD.referrer_user_id
    AND NEW.created_at=OLD.created_at
    AND NEW.counts_for_inviter IS NOT DISTINCT FROM OLD.counts_for_inviter
    AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND active=true) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='expert_promo_requests' THEN
   IF NEW.user_id IS NULL AND NEW.request_digest IS NULL AND NEW.erased_at IS NOT NULL
    AND OLD.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND active=true)
    AND ROW(NEW.bot_id,NEW.request_key,NEW.operation,NEW.created_at) IS NOT DISTINCT FROM ROW(OLD.bot_id,OLD.request_key,OLD.operation,OLD.created_at) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'expert_promo_immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TABLE client_referral_attributions (
  referred_user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  inviter_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_referral_no_self CHECK (referred_user_id <> inviter_user_id)
);
--> statement-breakpoint
COMMENT ON TABLE client_referral_attributions IS
  'Client coupon referral: the referred client is attributed once, to the first inviter. A later code does not move attribution or coupons. Insert with ON CONFLICT (referred_user_id) DO NOTHING. This table does not grant spendable coupons and does not touch payment providers.';
--> statement-breakpoint
CREATE INDEX client_referral_inviter_idx ON client_referral_attributions(inviter_user_id);
--> statement-breakpoint
CREATE TRIGGER client_referral_attributions_immutable
  BEFORE UPDATE OR DELETE ON client_referral_attributions
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
