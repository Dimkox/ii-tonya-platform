-- Separate onboarding fee. These facts never enter residency/referral/coupon tables.
ALTER TABLE expert_onboarding_applications ADD CONSTRAINT expert_onboarding_id_user_unique UNIQUE(id,user_id);
--> statement-breakpoint
CREATE TABLE expert_verification_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES expert_onboarding_applications(id) ON DELETE SET NULL,
  application_audit_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  manager_id uuid NOT NULL REFERENCES users(id),
  manager_session_hash text NOT NULL REFERENCES admin_sessions(session_id_hash),
  decision text NOT NULL,
  reason_code text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_verification_decision_binding UNIQUE(id,application_audit_id,user_id,decision),
  CONSTRAINT expert_verification_decision_replay UNIQUE(manager_id,idempotency_key),
  CONSTRAINT expert_verification_decision_status CHECK(decision IN ('approved','rejected')),
  CONSTRAINT expert_verification_reason_code CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT expert_verification_request_key CHECK(idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  CONSTRAINT expert_verification_application_audit CHECK(application_id IS NULL OR application_id=application_audit_id)
);
--> statement-breakpoint
CREATE TABLE expert_onboarding_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES expert_onboarding_applications(id) ON DELETE SET NULL,
  application_audit_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  decision_id uuid NOT NULL UNIQUE,
  decision text NOT NULL DEFAULT 'approved',
  purpose text NOT NULL DEFAULT 'onboarding',
  amount_minor bigint NOT NULL DEFAULT 300000,
  currency text NOT NULL DEFAULT 'RUB',
  provider_mode text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_onboarding_invoice_decision_fk FOREIGN KEY(decision_id,application_audit_id,user_id,decision) REFERENCES expert_verification_decisions(id,application_audit_id,user_id,decision),
  CONSTRAINT expert_onboarding_invoice_binding UNIQUE(id,application_audit_id,user_id,purpose,amount_minor,currency,provider_mode),
  CONSTRAINT expert_onboarding_invoice_purpose CHECK(purpose='onboarding' AND amount_minor=300000 AND currency='RUB' AND decision='approved'),
  CONSTRAINT expert_onboarding_invoice_mode CHECK(provider_mode IN ('test','live')),
  CONSTRAINT expert_onboarding_invoice_status CHECK(status IN ('pending','settled','cancelled')),
  CONSTRAINT expert_onboarding_invoice_audit CHECK(application_id IS NULL OR application_id=application_audit_id)
);
--> statement-breakpoint
CREATE TABLE expert_onboarding_payment_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL UNIQUE,
  application_audit_id uuid NOT NULL,
  user_id uuid NOT NULL,
  purpose text NOT NULL DEFAULT 'onboarding',
  amount_minor bigint NOT NULL DEFAULT 300000,
  currency text NOT NULL DEFAULT 'RUB',
  provider_mode text NOT NULL,
  provider_object_id text UNIQUE,
  status text NOT NULL DEFAULT 'created',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_onboarding_operation_invoice_fk FOREIGN KEY(invoice_id,application_audit_id,user_id,purpose,amount_minor,currency,provider_mode) REFERENCES expert_onboarding_invoices(id,application_audit_id,user_id,purpose,amount_minor,currency,provider_mode),
  CONSTRAINT expert_onboarding_operation_binding UNIQUE(id,invoice_id,user_id,purpose,amount_minor,currency,provider_mode,provider_object_id),
  CONSTRAINT expert_onboarding_operation_purpose CHECK(purpose='onboarding' AND amount_minor=300000 AND currency='RUB'),
  CONSTRAINT expert_onboarding_operation_mode CHECK(provider_mode IN ('test','live')),
  CONSTRAINT expert_onboarding_operation_status CHECK(status IN ('created','pending','unknown_outcome','succeeded','cancelled')),
  CONSTRAINT expert_onboarding_operation_provider_id CHECK(provider_object_id IS NULL OR provider_object_id ~ '^[A-Za-z0-9_-]{1,64}$')
);
--> statement-breakpoint
CREATE TABLE expert_verification_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES expert_onboarding_applications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  reason_code text,
  content_slot text NOT NULL DEFAULT 'TODO: Wait for Content Spec',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_verification_work_once UNIQUE(application_id,kind),
  CONSTRAINT expert_verification_work_kind CHECK(kind IN ('onboarding_invoice','verification_rejected','interview_ready')),
  CONSTRAINT expert_verification_work_reason CHECK(reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT expert_verification_work_status CHECK(status IN ('pending','completed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE expert_onboarding_payment_facts (
  invoice_id uuid PRIMARY KEY REFERENCES expert_onboarding_invoices(id),
  operation_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  purpose text NOT NULL DEFAULT 'onboarding',
  amount_minor bigint NOT NULL DEFAULT 300000,
  currency text NOT NULL DEFAULT 'RUB',
  provider_mode text NOT NULL,
  provider_object_id text NOT NULL UNIQUE,
  event_id text NOT NULL UNIQUE,
  evidence_digest text NOT NULL,
  captured_at timestamptz NOT NULL,
  admission text NOT NULL,
  reason_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_onboarding_fact_operation_fk FOREIGN KEY(operation_id,invoice_id,user_id,purpose,amount_minor,currency,provider_mode,provider_object_id) REFERENCES expert_onboarding_payment_operations(id,invoice_id,user_id,purpose,amount_minor,currency,provider_mode,provider_object_id),
  CONSTRAINT expert_onboarding_fact_binding CHECK(purpose='onboarding' AND amount_minor=300000 AND currency='RUB' AND provider_mode IN ('test','live')),
  CONSTRAINT expert_onboarding_fact_evidence CHECK(evidence_digest ~ '^sha256:[0-9a-f]{64}$' AND length(event_id) BETWEEN 1 AND 200),
  CONSTRAINT expert_onboarding_fact_admission CHECK((admission='interview' AND reason_code='payment_verified') OR (admission='blocked' AND reason_code IN ('application_erased','owner_inactive','consent_unavailable','application_unavailable'))),
  CONSTRAINT expert_onboarding_fact_capture CHECK(isfinite(captured_at) AND captured_at>='1970-01-01'::timestamptz)
);
--> statement-breakpoint
CREATE FUNCTION enforce_expert_verification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='expert_verification_decisions' THEN
    IF NEW.application_id IS NULL AND (to_jsonb(NEW)-'application_id')=(to_jsonb(OLD)-'application_id') THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='expert_onboarding_invoices' THEN
    IF (to_jsonb(NEW)-ARRAY['application_id','status'])=(to_jsonb(OLD)-ARRAY['application_id','status'])
      AND (NEW.application_id IS NOT DISTINCT FROM OLD.application_id OR NEW.application_id IS NULL)
      AND (NEW.status=OLD.status OR (OLD.status IN ('pending','cancelled') AND NEW.status='settled') OR (OLD.status='pending' AND NEW.status='cancelled'))
      AND (NEW.status<>'settled' OR EXISTS(SELECT 1 FROM expert_onboarding_payment_facts f WHERE f.invoice_id=NEW.id)) THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='expert_onboarding_payment_operations' THEN
    IF (to_jsonb(NEW)-ARRAY['provider_object_id','status'])=(to_jsonb(OLD)-ARRAY['provider_object_id','status'])
      AND (NEW.provider_object_id IS NOT DISTINCT FROM OLD.provider_object_id OR OLD.provider_object_id IS NULL)
      AND (NEW.status=OLD.status OR OLD.status<>'succeeded')
      AND (NEW.status<>'succeeded' OR EXISTS(SELECT 1 FROM expert_onboarding_payment_facts f WHERE f.operation_id=NEW.id)) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'expert_verification_immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_verification_decisions_immutable BEFORE UPDATE ON expert_verification_decisions FOR EACH ROW EXECUTE FUNCTION enforce_expert_verification_immutable();
--> statement-breakpoint
CREATE TRIGGER expert_onboarding_invoices_immutable BEFORE UPDATE ON expert_onboarding_invoices FOR EACH ROW EXECUTE FUNCTION enforce_expert_verification_immutable();
--> statement-breakpoint
CREATE TRIGGER expert_onboarding_operations_immutable BEFORE UPDATE ON expert_onboarding_payment_operations FOR EACH ROW EXECUTE FUNCTION enforce_expert_verification_immutable();
--> statement-breakpoint
CREATE TRIGGER expert_verification_decisions_no_delete BEFORE DELETE ON expert_verification_decisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER expert_onboarding_invoices_no_delete BEFORE DELETE ON expert_onboarding_invoices FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER expert_onboarding_operations_no_delete BEFORE DELETE ON expert_onboarding_payment_operations FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER expert_onboarding_payment_facts_immutable BEFORE UPDATE OR DELETE ON expert_onboarding_payment_facts FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

--> statement-breakpoint
CREATE FUNCTION enforce_expert_verification_decision_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE manager admin_sessions%ROWTYPE; checked_at timestamptz;
BEGIN
  SELECT s.* INTO manager FROM admin_sessions s JOIN admin_role_assignments r ON r.admin_id=s.admin_id
    JOIN users u ON u.id=s.admin_id AND u.active=true
    WHERE s.session_id_hash=NEW.manager_session_hash AND s.admin_id=NEW.manager_id
      AND r.role IN ('support','security_admin') ORDER BY r.role LIMIT 1 FOR SHARE OF s,r,u;
  checked_at:=clock_timestamp();
  IF NOT FOUND OR manager.revoked_at IS NOT NULL
    OR manager.expires_at IS NULL OR manager.mfa_verified_at IS NULL
    OR NOT isfinite(manager.expires_at) OR NOT isfinite(manager.mfa_verified_at)
    OR manager.expires_at<=checked_at
    OR manager.mfa_verified_at>checked_at OR manager.mfa_verified_at<checked_at-interval '15 minutes'
    OR NEW.application_id IS NULL OR NEW.application_id<>NEW.application_audit_id
    OR NOT EXISTS(SELECT 1 FROM expert_onboarding_applications a JOIN users u ON u.id=a.user_id AND u.active=true
      WHERE a.id=NEW.application_id AND a.user_id=NEW.user_id AND a.verification_status='pending') THEN
    RAISE EXCEPTION 'expert_verification_decision_source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_verification_decisions_source BEFORE INSERT ON expert_verification_decisions FOR EACH ROW EXECUTE FUNCTION enforce_expert_verification_decision_source();
--> statement-breakpoint
CREATE FUNCTION enforce_expert_application_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.campaign_quote_id IS DISTINCT FROM OLD.campaign_quote_id THEN
    RAISE EXCEPTION 'expert_application_identity_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_onboarding_application_identity_immutable BEFORE UPDATE ON expert_onboarding_applications FOR EACH ROW EXECUTE FUNCTION enforce_expert_application_identity_immutable();
