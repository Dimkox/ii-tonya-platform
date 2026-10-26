-- Additive review corrections preserve issued and historical financial facts.
ALTER TABLE expert_sales_form_bridges ADD COLUMN submitted_digest text, ADD COLUMN submitted_at timestamptz;
DROP TRIGGER expert_sales_bridge_immutable ON expert_sales_form_bridges;
UPDATE expert_sales_form_bridges b SET submitted_digest=encode(digest(f.submitted_draft::text,'sha256'),'hex'),submitted_at=f.submitted_at FROM residents_applications f WHERE f.id=b.form_id AND f.user_id=b.user_id;
ALTER TABLE expert_sales_form_bridges ADD CONSTRAINT expert_sales_submission_proof CHECK((submitted_digest IS NULL AND submitted_at IS NULL) OR (submitted_digest IS NOT NULL AND submitted_digest ~ '^[0-9a-f]{64}$' AND submitted_at IS NOT NULL AND isfinite(submitted_at)));
CREATE TRIGGER expert_sales_bridge_immutable BEFORE UPDATE ON expert_sales_form_bridges FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE FUNCTION expert_sales_form_valid(application uuid,owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN residents_applications f ON f.id=b.form_id AND f.user_id=b.user_id AND f.status='UNDER_REVIEW' AND f.submitted_at=b.submitted_at AND encode(digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest JOIN resident_verification_check_work w ON w.application_id=f.id AND w.user_id=f.user_id AND w.submitted_revision=b.submitted_revision WHERE b.application_id=application AND b.user_id=owner)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION expert_sales_bridge_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 SELECT encode(digest(f.submitted_draft::text,'sha256'),'hex'),f.submitted_at,w.submitted_revision INTO NEW.submitted_digest,NEW.submitted_at,NEW.submitted_revision FROM residents_applications f JOIN resident_verification_check_work w ON w.application_id=f.id AND w.user_id=f.user_id WHERE f.id=NEW.form_id AND f.user_id=NEW.user_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.submitted_digest IS NULL OR NEW.submitted_at IS NULL OR NOT EXISTS(SELECT 1 FROM residents_applications f JOIN expert_sales_selections s ON s.user_id=f.user_id JOIN expert_campaign_quotes q ON q.sales_selection_id=s.id AND q.user_id=f.user_id JOIN expert_onboarding_applications a ON a.campaign_quote_id=q.id AND a.user_id=f.user_id WHERE f.id=NEW.form_id AND f.user_id=NEW.user_id AND f.status='UNDER_REVIEW' AND f.submitted_at IS NOT NULL AND EXISTS(SELECT 1 FROM resident_verification_check_work w WHERE w.application_id=f.id AND w.user_id=f.user_id AND w.submitted_revision=NEW.submitted_revision) AND s.id=NEW.selection_id AND q.id=NEW.quote_id AND a.id=NEW.application_id AND a.verification_status='pending') THEN RAISE EXCEPTION 'expert_sales_bridge_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION expert_sales_paid_lock_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM expert_sales_fee_attempts a JOIN expert_onboarding_payment_facts f ON f.invoice_id=a.invoice_id AND f.user_id=a.user_id AND f.admission='interview' JOIN expert_sales_selections s ON s.id=a.selection_id AND s.user_id=a.user_id WHERE a.invoice_id=NEW.invoice_id AND a.user_id=NEW.user_id AND s.id=NEW.selection_id AND s.selected_total_minor=NEW.final_locked_price AND s.term_months=NEW.term_months AND f.captured_at<a.expires_at AND EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN residents_applications form ON form.id=b.form_id AND form.user_id=b.user_id AND expert_sales_form_valid(b.application_id,b.user_id) AND form.submitted_at IS NOT NULL JOIN expert_sales_bases base ON base.user_id=b.user_id JOIN users u ON u.id=b.user_id AND u.active JOIN expert_onboarding_applications app ON app.id=b.application_id AND app.verification_status='approved' WHERE b.user_id=a.user_id AND expert_card_current_messaging_authority(b.user_id,base.consent_version)) AND EXISTS(SELECT 1 FROM expert_sales_provider_requests r JOIN expert_sales_provider_observations o ON o.invoice_id=r.invoice_id AND o.provider_object_id=r.provider_object_id AND o.status='waiting_for_capture' AND o.observed_at<=r.dispatched_at WHERE r.invoice_id=a.invoice_id AND r.kind='capture' AND r.status IN('dispatched','observed') AND r.dispatched_at<a.expires_at AND r.dispatched_at<=f.captured_at)) THEN RAISE EXCEPTION 'expert_sales_paid_lock_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION expert_sales_attempt_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN expert_onboarding_invoices i ON i.application_id=b.application_id AND i.user_id=b.user_id JOIN expert_verification_decisions d ON d.id=i.decision_id AND d.decision='approved' JOIN expert_sales_selections approved ON approved.id=b.selection_id JOIN expert_sales_selections s ON s.base_id=approved.base_id AND s.id=(SELECT id FROM expert_sales_selections WHERE user_id=b.user_id ORDER BY selected_at DESC,id DESC LIMIT 1) JOIN residents_applications form ON form.id=b.form_id AND form.user_id=b.user_id AND expert_sales_form_valid(b.application_id,b.user_id) AND form.submitted_at IS NOT NULL WHERE i.id=NEW.invoice_id AND b.user_id=NEW.user_id AND s.id=NEW.selection_id AND NEW.expires_at<=s.offer_expiry_date AND NEW.expires_at<=NEW.created_at+interval '24 hours' AND NEW.created_at>=d.created_at AND i.sales_attempt_number IS NOT NULL) THEN RAISE EXCEPTION 'expert_sales_attempt_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION expert_sales_receipt_authority(quote uuid,owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN expert_campaign_quotes q ON q.id=b.quote_id AND q.user_id=b.user_id AND q.rule_version='expert_separated_sales_v3' JOIN expert_sales_selections original ON original.id=b.selection_id JOIN expert_sales_bases base ON base.id=original.base_id AND base.user_id=b.user_id JOIN expert_onboarding_applications a ON a.id=b.application_id AND a.verification_status IN('pending','approved') JOIN users u ON u.id=b.user_id AND u.active WHERE b.quote_id=quote AND b.user_id=owner AND expert_sales_form_valid(b.application_id,b.user_id) AND expert_card_current_messaging_authority(b.user_id,base.consent_version) AND NOT EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=b.user_id))
$$;
--> statement-breakpoint
ALTER FUNCTION payer_receipt_redaction_due(payer_receipt_contacts) RENAME TO payer_receipt_redaction_due_v2;
CREATE FUNCTION payer_receipt_redaction_due(contact payer_receipt_contacts) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM expert_campaign_quotes q WHERE q.id=contact.quote_id AND q.rule_version='expert_separated_sales_v3') THEN contact.expires_at<=clock_timestamp() OR NOT expert_sales_receipt_authority(contact.quote_id,contact.user_id) ELSE payer_receipt_redaction_due_v2(contact) END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_payer_receipt_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.redacted_at IS NOT NULL OR NEW.captured_at>clock_timestamp() OR (NOT expert_sales_receipt_authority(NEW.quote_id,NEW.user_id) AND NOT EXISTS(
      SELECT 1 FROM expert_campaign_quotes q JOIN users u ON u.id=q.user_id
      JOIN expert_residency_tariff_versions t ON t.id=q.tariff_version_id
      WHERE q.id=NEW.quote_id AND q.user_id=NEW.user_id AND u.active
        AND q.rule_version<>'expert_separated_sales_v3' AND q.quoted_at<=NEW.captured_at AND q.expires_at>clock_timestamp()
        AND t.active_from<=clock_timestamp() AND t.active_to>clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM expert_residency_orders o WHERE o.campaign_quote_id=q.id))) THEN
      RAISE EXCEPTION 'payer_receipt_unavailable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL
    AND NEW.redacted_at<=clock_timestamp() AND NEW.key_id IS NULL AND NEW.ciphertext IS NULL
    AND (to_jsonb(NEW)-ARRAY['key_id','ciphertext','redacted_at'])=(to_jsonb(OLD)-ARRAY['key_id','ciphertext','redacted_at'])
    AND payer_receipt_redaction_due(OLD) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'payer_receipt_immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
ALTER TABLE expert_sales_notices ADD COLUMN selection_id uuid REFERENCES expert_sales_selections(id),ADD COLUMN invoice_id uuid REFERENCES expert_onboarding_invoices(id),ADD COLUMN choice_revision integer,ADD COLUMN prepared_until timestamptz;
UPDATE expert_sales_notices SET status='cancelled',receipt=NULL WHERE status='pending';
ALTER TABLE expert_sales_notices DROP CONSTRAINT expert_sales_notices_status_check,ADD CONSTRAINT expert_sales_notices_status_check CHECK(status IN('pending','preparing','dispatched','delivered','cancelled'));
ALTER TABLE expert_sales_notices DROP CONSTRAINT expert_sales_notices_base_id_stage_at_kind_key;
CREATE UNIQUE INDEX expert_sales_stage_notice_once ON expert_sales_notices(base_id,stage_at,kind,choice_revision) WHERE kind IN('24h','3h');
CREATE UNIQUE INDEX expert_sales_replacement_notice_once ON expert_sales_notices(invoice_id) WHERE kind='refresh' AND invoice_id IS NOT NULL;
CREATE UNIQUE INDEX expert_sales_selection_notice_once ON expert_sales_notices(selection_id,kind) WHERE kind IN('refresh','reselect') AND invoice_id IS NULL AND selection_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE expert_sales_operator_recoveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),invoice_id uuid NOT NULL REFERENCES expert_sales_fee_attempts(invoice_id),user_id uuid NOT NULL REFERENCES users(id),manager_id uuid NOT NULL REFERENCES users(id),session_hash text NOT NULL REFERENCES admin_sessions(session_id_hash),request_key text NOT NULL,provider_object_id text NOT NULL,observed_status text NOT NULL,evidence_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(manager_id,request_key),CHECK(request_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'));
CREATE FUNCTION expert_sales_operator_recovery_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT expert_card_manager_authority_valid(NEW.manager_id,NEW.session_hash) OR NOT EXISTS(SELECT 1 FROM expert_sales_fee_attempts a JOIN expert_sales_provider_observations o ON o.invoice_id=a.invoice_id AND o.provider_object_id=NEW.provider_object_id AND o.evidence_digest=NEW.evidence_digest AND o.status=NEW.observed_status AND o.observed_at>clock_timestamp()-interval '30 seconds' WHERE a.invoice_id=NEW.invoice_id AND a.user_id=NEW.user_id) THEN RAISE EXCEPTION 'expert_sales_recovery_authority'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER expert_sales_operator_recovery_source BEFORE INSERT ON expert_sales_operator_recoveries FOR EACH ROW EXECUTE FUNCTION expert_sales_operator_recovery_source();
CREATE TRIGGER expert_sales_operator_recovery_immutable BEFORE UPDATE OR DELETE ON expert_sales_operator_recoveries FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

--> statement-breakpoint
ALTER TABLE expert_sales_provider_observations DROP CONSTRAINT expert_sales_provider_observatio_invoice_id_evidence_digest_key;
