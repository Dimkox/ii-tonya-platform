CREATE TABLE owner_test_pricing_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_version text NOT NULL DEFAULT 'owner_test_10_20_v1' CHECK (policy_version = 'owner_test_10_20_v1'),
  provider_mode text NOT NULL DEFAULT 'live' CHECK (provider_mode = 'live'),
  onboarding_minor bigint NOT NULL DEFAULT 1000 CHECK (onboarding_minor = 1000),
  subscription_minor bigint NOT NULL DEFAULT 2000 CHECK (subscription_minor = 2000),
  granted_by uuid NOT NULL,
  grant_session_hash text NOT NULL,
  grant_approval_id uuid NOT NULL REFERENCES admin_approvals(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_session_hash text,
  revoke_approval_id uuid REFERENCES admin_approvals(id),
  UNIQUE (id, user_id),
  CHECK (isfinite(created_at) AND (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= created_at))),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_session_hash IS NULL AND revoke_approval_id IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_session_hash IS NOT NULL AND revoke_approval_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX owner_test_pricing_one_active ON owner_test_pricing_grants ((true)) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX owner_test_pricing_grant_audit_identity ON audit_events (object_id) WHERE object_type='owner_test_pricing_grant' AND action='OWNER_TEST_PRICE_GRANTED';
--> statement-breakpoint
CREATE UNIQUE INDEX owner_test_pricing_approval_audit_identity ON audit_events (correlation_id) WHERE object_type='owner_test_pricing_grant' AND action IN ('OWNER_TEST_PRICE_GRANTED','OWNER_TEST_PRICE_REVOKED');
--> statement-breakpoint
CREATE FUNCTION owner_test_pricing_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid; session_hash text; checked_at timestamptz := clock_timestamp(); event_action text; approval uuid; expected_action text; expected_type text; expected_object uuid; expected_hash text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id) THEN RAISE EXCEPTION 'owner_test_pricing_grant_immutable'; END IF;
    RETURN OLD;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM users WHERE id=NEW.user_id AND active FOR SHARE;
    IF NEW.revoked_at IS NOT NULL OR NOT FOUND THEN RAISE EXCEPTION 'owner_test_pricing_invalid_grant'; END IF;
    actor:=NEW.granted_by; session_hash:=NEW.grant_session_hash; event_action:='OWNER_TEST_PRICE_GRANTED'; approval:=NEW.grant_approval_id;
    expected_action:='owner_test_pricing.grant'; expected_type:='user'; expected_object:=NEW.user_id;
    expected_hash:='sha256:'||encode(digest('{"userId":"'||NEW.user_id::text||'"}','sha256'),'hex');
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
       OR NEW.provider_mode IS DISTINCT FROM OLD.provider_mode OR NEW.onboarding_minor IS DISTINCT FROM OLD.onboarding_minor
       OR NEW.subscription_minor IS DISTINCT FROM OLD.subscription_minor OR NEW.granted_by IS DISTINCT FROM OLD.granted_by
       OR NEW.grant_session_hash IS DISTINCT FROM OLD.grant_session_hash OR NEW.grant_approval_id IS DISTINCT FROM OLD.grant_approval_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'owner_test_pricing_grant_immutable'; END IF;
    actor:=NEW.revoked_by; session_hash:=NEW.revoke_session_hash; event_action:='OWNER_TEST_PRICE_REVOKED'; approval:=NEW.revoke_approval_id;
    expected_action:='owner_test_pricing.revoke'; expected_type:='owner_test_pricing_grant'; expected_object:=NEW.id;
    expected_hash:='sha256:'||encode(digest('{"grantId":"'||NEW.id::text||'"}','sha256'),'hex');
  END IF;
  PERFORM 1 FROM admin_sessions s JOIN users u ON u.id=s.admin_id JOIN admin_role_assignments r ON r.admin_id=s.admin_id AND r.role='security_admin'
   WHERE s.session_id_hash=session_hash AND s.admin_id=actor FOR SHARE OF s,u,r;
  IF NOT FOUND THEN RAISE EXCEPTION 'owner_test_pricing_admin_required'; END IF;
  PERFORM 1 FROM admin_approvals a
    JOIN admin_sessions s ON s.session_id_hash=a.approver_session_id_hash AND s.admin_id=a.approver_id
    JOIN users u ON u.id=s.admin_id JOIN admin_role_assignments r ON r.admin_id=s.admin_id AND r.role='security_admin'
    JOIN admin_sessions requester ON requester.session_id_hash=a.requester_session_id_hash AND requester.admin_id=a.requester_id
    WHERE a.id=approval AND a.action=expected_action AND a.object_type=expected_type AND a.object_id=expected_object
      AND a.payload_hash=expected_hash AND a.required_role='security_admin' AND a.requester_id=actor
      AND a.requester_session_id_hash=session_hash AND a.approver_id<>actor AND a.consumed_at IS NOT NULL
      AND a.approver_mfa_verified_at=s.mfa_verified_at AND a.requester_mfa_verified_at=requester.mfa_verified_at
    FOR SHARE OF a,s,u,r,requester;
  IF NOT FOUND THEN RAISE EXCEPTION 'owner_test_pricing_approval_required'; END IF;
  checked_at:=clock_timestamp();
  IF NOT EXISTS (SELECT 1 FROM admin_sessions s JOIN users u ON u.id=s.admin_id JOIN admin_role_assignments r ON r.admin_id=s.admin_id AND r.role='security_admin'
     WHERE s.session_id_hash=session_hash AND s.admin_id=actor AND u.active AND s.revoked_at IS NULL
       AND isfinite(s.expires_at) AND isfinite(s.mfa_verified_at) AND s.expires_at>checked_at
       AND s.mfa_verified_at<=checked_at AND s.mfa_verified_at>=checked_at-interval '15 minutes') THEN
    RAISE EXCEPTION 'owner_test_pricing_admin_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_approvals a JOIN admin_sessions s ON s.session_id_hash=a.approver_session_id_hash AND s.admin_id=a.approver_id JOIN users u ON u.id=s.admin_id JOIN admin_role_assignments r ON r.admin_id=s.admin_id AND r.role='security_admin'
    WHERE a.id=approval AND u.active AND s.revoked_at IS NULL AND isfinite(s.expires_at) AND isfinite(s.mfa_verified_at)
      AND s.expires_at>checked_at AND s.mfa_verified_at<=checked_at AND s.mfa_verified_at>=checked_at-interval '15 minutes'
      AND a.approver_mfa_verified_at=s.mfa_verified_at AND a.expires_at>checked_at) THEN
    RAISE EXCEPTION 'owner_test_pricing_approval_required';
  END IF;
  IF TG_OP='INSERT' THEN NEW.created_at:=checked_at; ELSE NEW.revoked_at:=checked_at; END IF;
  INSERT INTO audit_events(actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash)
  VALUES('admin',actor,session_hash,event_action,'owner_test_pricing_grant',NEW.id,'allowed','owner_requested',approval,checked_at,encode(digest(NEW.id::text,'sha256'),'hex'));
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER owner_test_pricing_grant_guard BEFORE INSERT OR UPDATE OR DELETE ON owner_test_pricing_grants
  FOR EACH ROW EXECUTE FUNCTION owner_test_pricing_grant_guard();
