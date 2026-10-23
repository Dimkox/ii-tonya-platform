-- Reusable acquisition namespace only: never a coupon, qualified referral code,
-- financial balance or payment authority. All personal data remains RF PostgreSQL.
CREATE TABLE expert_promo_codes (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ref_code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_promo_code_namespace CHECK(ref_code ~ '^promo_[0-9a-f]{32}$')
);
--> statement-breakpoint
CREATE TABLE expert_promo_registrations (
  identity_digest text UNIQUE,
  erased_at timestamptz,
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_promo_identity_digest CHECK(identity_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT expert_promo_no_self CHECK(user_id IS DISTINCT FROM referrer_user_id)
);
--> statement-breakpoint
CREATE INDEX expert_promo_referrer_idx ON expert_promo_registrations(referrer_user_id);
--> statement-breakpoint
CREATE TABLE expert_promo_requests (
  bot_id text NOT NULL,
  request_key text NOT NULL,
  user_id uuid REFERENCES users(id),
  request_digest text,
  erased_at timestamptz,
  operation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(bot_id,request_key),
  CONSTRAINT expert_promo_bot_id CHECK(bot_id ~ '^[1-9][0-9]{0,19}$'),
  CONSTRAINT expert_promo_request_digest CHECK(request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT expert_promo_request_key CHECK(length(request_key) BETWEEN 1 AND 200),
  CONSTRAINT expert_promo_request_erasure CHECK((user_id IS NOT NULL AND request_digest IS NOT NULL AND erased_at IS NULL) OR (user_id IS NULL AND request_digest IS NULL AND erased_at IS NOT NULL)),
  CONSTRAINT expert_promo_request_operation CHECK(operation IN ('register','application','quote','enroll','consent','tariffs'))
);
--> statement-breakpoint
CREATE TABLE expert_promo_guide_work (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting_content',
  content_slot text NOT NULL DEFAULT 'TODO: Wait for Content Spec',
  delivered_at timestamptz,
  delivery_receipt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_promo_guide_status CHECK(status IN ('waiting_content','pending','delivered','cancelled')),
  CONSTRAINT expert_promo_guide_delivery CHECK(
    (status='delivered' AND delivered_at IS NOT NULL AND isfinite(delivered_at) AND delivery_receipt IS NOT NULL AND length(delivery_receipt) BETWEEN 1 AND 200)
    OR (status<>'delivered' AND delivered_at IS NULL AND delivery_receipt IS NULL))
);
--> statement-breakpoint
CREATE TABLE expert_promo_bonus_indications (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bonus_points integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'frozen',
  policy_version text NOT NULL DEFAULT 'promo_advance_within_qualified_1000_v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_promo_indication_nonfinancial CHECK(bonus_points=100 AND status='frozen' AND policy_version='promo_advance_within_qualified_1000_v1')
);
--> statement-breakpoint
CREATE TABLE expert_promo_manager_work (
  application_id uuid PRIMARY KEY REFERENCES expert_onboarding_applications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  content_slot text NOT NULL DEFAULT 'TODO: Wait for Content Spec',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_promo_manager_status CHECK(status IN ('pending','completed','cancelled'))
);
--> statement-breakpoint
CREATE FUNCTION enforce_expert_promo_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='expert_promo_registrations' THEN
   IF NEW.identity_digest IS NULL AND NEW.erased_at IS NOT NULL
    AND NEW.user_id=OLD.user_id AND NEW.referrer_user_id IS NOT DISTINCT FROM OLD.referrer_user_id
    AND NEW.created_at=OLD.created_at AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND active=true) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='expert_promo_requests' THEN
   IF NEW.user_id IS NULL AND NEW.request_digest IS NULL AND NEW.erased_at IS NOT NULL
    AND OLD.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND active=true)
    AND ROW(NEW.bot_id,NEW.request_key,NEW.operation,NEW.created_at) IS NOT DISTINCT FROM ROW(OLD.bot_id,OLD.request_key,OLD.operation,OLD.created_at) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'expert_promo_immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_promo_codes_immutable BEFORE UPDATE ON expert_promo_codes
FOR EACH ROW EXECUTE FUNCTION enforce_expert_promo_immutable();
--> statement-breakpoint
CREATE TRIGGER expert_promo_registrations_immutable BEFORE UPDATE ON expert_promo_registrations
FOR EACH ROW EXECUTE FUNCTION enforce_expert_promo_immutable();
--> statement-breakpoint
CREATE TRIGGER expert_promo_requests_immutable BEFORE UPDATE ON expert_promo_requests
FOR EACH ROW EXECUTE FUNCTION enforce_expert_promo_immutable();

--> statement-breakpoint
CREATE TABLE expert_promo_enrollments (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  channel_identity_id uuid NOT NULL UNIQUE REFERENCES channel_identities(id) ON DELETE CASCADE,
  bot_id text NOT NULL,
  ref_code text,
  presentation_id uuid REFERENCES consent_presentations(id),
  policy_version text,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_promo_enrollment_status CHECK(status IN ('pending','granted','denied')),
  CONSTRAINT expert_promo_enrollment_bot CHECK(bot_id ~ '^[1-9][0-9]{0,19}$'),
  CONSTRAINT expert_promo_enrollment_ref CHECK(ref_code IS NULL OR ref_code ~ '^promo_[0-9a-f]{32}$'),
  CONSTRAINT expert_promo_enrollment_expiry CHECK(isfinite(expires_at) AND expires_at>created_at AND expires_at<=created_at+interval '24 hours')
);
