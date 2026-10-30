-- A wave form bridge is a qualification fact, not payment or activation.
-- Before enabling any wave payment, extend both reapplication guards to exclude
-- settled and unresolved wave onboarding/composite operations under the subject lock.
CREATE TABLE early_bird_form_enrollments (
 form_id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 choice_id uuid NOT NULL, enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(form_id,user_id) REFERENCES residents_applications(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(choice_id,user_id) REFERENCES early_bird_choices(id,user_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE FUNCTION early_bird_form_enrollment_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE shown_grant uuid; active_grant uuid; BEGIN
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'early_bird_form_enrollment_immutable'; END IF;
 LOCK TABLE consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 PERFORM 1 FROM early_bird_launch_configs WHERE active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_form_enrollment_source'; END IF;
 IF EXISTS(SELECT 1 FROM residents_applications f JOIN residents_applications prior_form ON prior_form.user_id=f.user_id AND prior_form.attempt_number=f.attempt_number-1 AND NOT prior_form.is_current AND prior_form.status='REJECTED' JOIN early_bird_form_enrollments prev ON prev.form_id=prior_form.id AND prev.user_id=prior_form.user_id AND prev.choice_id=NEW.choice_id JOIN early_bird_choices c ON c.id=NEW.choice_id AND c.user_id=f.user_id JOIN expert_sales_bases b ON b.id=c.base_id AND b.user_id=c.user_id JOIN resident_review_events e ON e.attempt_id=prior_form.id AND e.action='REJECT_SOFT' AND resident_reapply_eligible(e.reapply_at,clock_timestamp()) JOIN users u ON u.id=f.user_id AND u.active WHERE f.id=NEW.form_id AND f.user_id=NEW.user_id AND f.is_current AND f.status='PENDING_DOCS' AND f.bot_id=b.bot_id AND f.bot_key=b.bot_key AND f.chat_id=b.chat_id AND expert_card_current_messaging_authority(f.user_id,b.consent_version) AND NOT EXISTS(SELECT 1 FROM expert_onboarding_payment_facts WHERE user_id=f.user_id) AND NOT EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=f.user_id)) THEN NEW.enrolled_at:=clock_timestamp(); RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM early_bird_launch_configs WHERE active AND phase='WAVE_1_EARLY_BIRD') THEN RAISE EXCEPTION 'early_bird_form_enrollment_source'; END IF;
 SELECT snap.grant_id INTO shown_grant FROM early_bird_choices c JOIN early_bird_positive_price_snapshots snap ON snap.positive_choice_id=c.positive_choice_id AND snap.user_id=c.user_id AND snap.base_id=c.base_id WHERE c.id=NEW.choice_id AND c.user_id=NEW.user_id FOR SHARE OF snap;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_form_enrollment_source'; END IF;
 SELECT id INTO active_grant FROM owner_test_pricing_grants WHERE user_id=NEW.user_id AND revoked_at IS NULL AND provider_mode='live' FOR SHARE;
 IF active_grant IS DISTINCT FROM shown_grant THEN RAISE EXCEPTION 'early_bird_form_enrollment_source'; END IF;
 IF NOT EXISTS(SELECT 1 FROM residents_applications f JOIN early_bird_choices c ON c.id=NEW.choice_id AND c.user_id=f.user_id JOIN expert_sales_bases b ON b.id=c.base_id AND b.user_id=c.user_id JOIN users u ON u.id=f.user_id AND u.active WHERE f.id=NEW.form_id AND f.user_id=NEW.user_id AND f.status='PENDING_DOCS' AND f.is_current AND c.id=(SELECT id FROM early_bird_choices WHERE base_id=b.id ORDER BY decision_no DESC LIMIT 1) AND c.positive_choice_id=(SELECT id FROM expert_sales_choices WHERE base_id=b.id ORDER BY revision DESC LIMIT 1) AND f.bot_id=b.bot_id AND f.bot_key=b.bot_key AND f.chat_id=b.chat_id AND expert_card_current_messaging_authority(f.user_id,b.consent_version) AND early_bird_wave_active(early_bird_current_time())) THEN RAISE EXCEPTION 'early_bird_form_enrollment_source'; END IF;
 NEW.enrolled_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER early_bird_form_enrollment_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_form_enrollments FOR EACH ROW EXECUTE FUNCTION early_bird_form_enrollment_guard();
--> statement-breakpoint
CREATE TABLE early_bird_form_bridges (
  application_id uuid PRIMARY KEY REFERENCES expert_onboarding_applications(id) ON DELETE CASCADE,
  form_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice_id uuid NOT NULL,
  submitted_revision integer NOT NULL,
  submitted_digest text NOT NULL CHECK(submitted_digest ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY(form_id,user_id) REFERENCES residents_applications(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(choice_id,user_id) REFERENCES early_bird_choices(id,user_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE FUNCTION early_bird_form_bridge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'early_bird_form_bridge_immutable'; END IF;
 LOCK TABLE consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 PERFORM 1 FROM early_bird_launch_configs WHERE active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_form_bridge_phase'; END IF;
 IF NOT EXISTS(SELECT 1 FROM residents_applications f JOIN users u ON u.id=f.user_id AND u.active JOIN early_bird_form_enrollments en ON en.form_id=f.id AND en.user_id=f.user_id AND en.choice_id=NEW.choice_id JOIN early_bird_choices c ON c.id=en.choice_id AND c.user_id=f.user_id JOIN expert_sales_bases b ON b.id=c.base_id AND b.user_id=c.user_id JOIN expert_onboarding_applications a ON a.id=NEW.application_id AND a.user_id=f.user_id AND a.verification_status='pending' AND a.campaign_quote_id IS NULL WHERE f.id=NEW.form_id AND f.user_id=NEW.user_id AND f.is_current AND f.status='UNDER_REVIEW' AND f.submitted_at IS NOT NULL AND f.submitted_revision=NEW.submitted_revision AND encode(digest(f.submitted_draft::text,'sha256'),'hex')=NEW.submitted_digest AND c.id=(SELECT id FROM early_bird_choices WHERE base_id=b.id ORDER BY decision_no DESC LIMIT 1) AND expert_card_current_messaging_authority(f.user_id,b.consent_version) AND NOT EXISTS(SELECT 1 FROM expert_sales_form_bridges WHERE user_id=f.user_id)) THEN RAISE EXCEPTION 'early_bird_form_bridge_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER early_bird_form_bridge_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_form_bridges FOR EACH ROW EXECUTE FUNCTION early_bird_form_bridge_guard();
--> statement-breakpoint
-- Preserve the legacy terminal-review guard, adding a distinct wave source.
CREATE OR REPLACE FUNCTION resident_terminal_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM early_bird_form_bridges WHERE application_id=NEW.application_id) THEN
  LOCK TABLE consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  PERFORM 1 FROM early_bird_launch_configs WHERE active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'resident_preview_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM early_bird_form_bridges b JOIN residents_applications f ON f.id=b.form_id AND f.user_id=b.user_id AND f.is_current JOIN resident_review_events e ON e.attempt_id=f.id AND e.source_revision=f.revision-1 AND e.manager_id=NEW.manager_id AND e.session_hash=NEW.manager_session_hash JOIN early_bird_choices c ON c.id=b.choice_id AND c.user_id=b.user_id JOIN expert_sales_bases base ON base.id=c.base_id AND base.user_id=c.user_id JOIN users u ON u.id=b.user_id AND u.active WHERE b.application_id=NEW.application_id AND b.user_id=NEW.user_id AND f.submitted_revision=b.submitted_revision AND encode(digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest AND c.id=(SELECT id FROM early_bird_choices WHERE base_id=base.id ORDER BY decision_no DESC LIMIT 1) AND expert_card_current_messaging_authority(b.user_id,base.consent_version) AND ((NEW.decision='approved' AND e.action IN('APPROVED_BASIC','APPROVED_EXCLUSIVE')) OR (NEW.decision='rejected' AND e.action IN('REJECT_SOFT','REJECT_HARD')))) THEN RAISE EXCEPTION 'resident_preview_required'; END IF;
 ELSIF EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN residents_applications f ON f.id=b.form_id WHERE b.application_id=NEW.application_id AND f.form_version=2) AND NOT EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN residents_applications f ON f.id=b.form_id AND f.is_current JOIN resident_review_events e ON e.attempt_id=f.id AND e.source_revision=f.revision-1 AND e.manager_id=NEW.manager_id AND e.session_hash=NEW.manager_session_hash WHERE b.application_id=NEW.application_id AND ((NEW.decision='approved' AND e.action IN('APPROVED_BASIC','APPROVED_EXCLUSIVE')) OR (NEW.decision='rejected' AND e.action IN('REJECT_SOFT','REJECT_HARD')))) THEN RAISE EXCEPTION 'resident_preview_required'; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
