-- Review corrections: deterministic calendar rules and bounded private history indexes.
-- Actual trigger/guards always supply clock_timestamp(); no runtime clock override.
CREATE FUNCTION resident_reapply_deadline(decided_at timestamptz) RETURNS timestamptz LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT ((decided_at AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC' $$;
CREATE FUNCTION resident_reapply_eligible(deadline timestamptz,at_time timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT deadline<=at_time $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_review_event_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p resident_review_previews; f residents_applications;
BEGIN
 SELECT * INTO p FROM resident_review_previews WHERE id=NEW.preview_id FOR UPDATE;
 SELECT * INTO f FROM residents_applications WHERE id=p.application_id FOR UPDATE;
 IF p.id IS NULL OR f.id IS NULL OR NOT f.is_current OR f.status<>'UNDER_REVIEW' OR NOT expert_card_manager_authority_valid(NEW.manager_id,NEW.session_hash) OR p.manager_id<>NEW.manager_id OR p.session_hash<>NEW.session_hash OR p.revision<>f.revision OR p.generation<>f.check_generation OR p.expires_at<=clock_timestamp() OR NEW.attempt_id<>f.id OR NEW.action<>p.action OR NEW.reason_code<>p.reason_code OR NEW.final_hash<>p.final_hash OR NEW.template_key<>p.template_key OR NEW.template_version<>p.template_version THEN RAISE EXCEPTION 'resident_preview_stale'; END IF;
 IF NEW.action='REJECT_SOFT' AND NEW.reason_code='REJECT_INSUFFICIENT_PROOF' AND NOT EXISTS(SELECT 1 FROM resident_information_requests r JOIN resident_check_generations g ON g.application_id=r.application_id AND g.request_id=r.id AND g.generation=f.check_generation WHERE r.application_id=f.id AND r.status IN('completed','timeout')) THEN RAISE EXCEPTION 'resident_information_first'; END IF;
 NEW.created_at:=clock_timestamp(); NEW.source_revision:=f.revision; NEW.source_generation:=f.check_generation; NEW.submitted_revision:=f.submitted_revision; NEW.submitted_digest:=encode(digest(f.submitted_draft::text,'sha256'),'hex');
 NEW.deadline:=CASE WHEN NEW.action='INFO_REQUESTED' THEN NEW.created_at+interval '48 hours' END;
 NEW.reapply_at:=CASE WHEN NEW.action='REJECT_SOFT' THEN resident_reapply_deadline(NEW.created_at) END;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_verification_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM channel_identities ci JOIN users u ON u.id=ci.user_id AND u.active WHERE ci.id=NEW.channel_identity_id AND ci.user_id=NEW.user_id AND ci.provider='telegram' AND ci.status='active' AND ci.bot_key=NEW.bot_key AND ci.external_id=NEW.telegram_user_id AND ci.external_chat_id=NEW.chat_id) THEN RAISE EXCEPTION 'resident_identity_unavailable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING_DOCS' OR NEW.progress<>'FORM_FILLING' OR NEW.revision<>0 OR NEW.submitted_at IS NOT NULL OR NOT NEW.is_current THEN RAISE EXCEPTION 'resident_initial_state_invalid'; END IF;
  IF NEW.attempt_number>1 AND (NOT EXISTS(SELECT 1 FROM residents_applications previous_form JOIN resident_review_events e ON e.attempt_id=previous_form.id AND e.action='REJECT_SOFT' AND resident_reapply_eligible(e.reapply_at,clock_timestamp()) WHERE previous_form.user_id=NEW.user_id AND previous_form.attempt_number=NEW.attempt_number-1 AND NOT previous_form.is_current AND previous_form.status='REJECTED') OR EXISTS(SELECT 1 FROM expert_onboarding_payment_facts WHERE user_id=NEW.user_id) OR EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=NEW.user_id)) THEN RAISE EXCEPTION 'resident_reapply_unavailable'; END IF;
  NEW.created_at:=clock_timestamp();
  INSERT INTO resident_verification_cohorts(user_id) VALUES(NEW.user_id) ON CONFLICT DO NOTHING;
 ELSE
  IF ROW(OLD.user_id,OLD.bot_id,OLD.bot_key,OLD.channel_identity_id,OLD.created_at,OLD.policy_version,OLD.education_requirement,OLD.telegram_user_id,OLD.chat_id,OLD.form_version,OLD.attempt_number) IS DISTINCT FROM ROW(NEW.user_id,NEW.bot_id,NEW.bot_key,NEW.channel_identity_id,NEW.created_at,NEW.policy_version,NEW.education_requirement,NEW.telegram_user_id,NEW.chat_id,NEW.form_version,NEW.attempt_number) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'resident_revision_invalid'; END IF;
  IF NOT OLD.is_current OR (OLD.is_current AND NOT NEW.is_current AND (OLD.status<>'REJECTED' OR NOT EXISTS(SELECT 1 FROM resident_review_events WHERE attempt_id=OLD.id AND action='REJECT_SOFT' AND resident_reapply_eligible(reapply_at,clock_timestamp())))) THEN RAISE EXCEPTION 'resident_attempt_frozen'; END IF;
  IF OLD.submitted_at IS NOT NULL AND ROW(OLD.draft,OLD.submitted_draft,OLD.submitted_at,OLD.submitted_revision) IS DISTINCT FROM ROW(NEW.draft,NEW.submitted_draft,NEW.submitted_at,NEW.submitted_revision) THEN RAISE EXCEPTION 'resident_submission_frozen'; END IF;
  IF OLD.submitted_at IS NOT NULL AND NEW.check_generation<>OLD.check_generation AND (NEW.check_generation<>OLD.check_generation+1 OR NOT EXISTS(SELECT 1 FROM resident_check_generations g JOIN resident_information_requests r ON r.id=g.request_id WHERE g.application_id=OLD.id AND g.generation=NEW.check_generation AND r.id=OLD.active_request_id AND r.status IN('completed','timeout'))) THEN RAISE EXCEPTION 'resident_check_generation_source'; END IF;
  IF OLD.status<>NEW.status THEN
   IF NEW.status IN('APPROVED_BASIC','APPROVED_EXCLUSIVE','REJECTED','INFO_REQUESTED') AND NOT EXISTS(SELECT 1 FROM resident_review_events e WHERE e.attempt_id=OLD.id AND e.source_revision=OLD.revision AND e.source_generation=OLD.check_generation AND (e.action=NEW.status OR (NEW.status='REJECTED' AND e.action IN('REJECT_SOFT','REJECT_HARD')))) THEN RAISE EXCEPTION 'resident_manager_decisions_unavailable'; END IF;
   IF NEW.status='UNDER_REVIEW' AND OLD.status<>'PENDING_DOCS' AND (OLD.status<>'INFO_REQUESTED' OR NOT EXISTS(SELECT 1 FROM resident_information_requests WHERE id=OLD.active_request_id AND application_id=OLD.id AND status IN('completed','timeout'))) THEN RAISE EXCEPTION 'resident_review_source'; END IF;
  END IF;
  IF OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL THEN NEW.submitted_at:=clock_timestamp(); NEW.submitted_revision:=NEW.revision; NEW.check_generation:=1; END IF;
 END IF;
 IF NEW.submitted_at IS NOT NULL AND NEW.draft<>NEW.submitted_draft THEN RAISE EXCEPTION 'resident_submission_invalid'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_financial_attempt_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF EXISTS(SELECT 1 FROM expert_onboarding_applications WHERE user_id=NEW.user_id) AND (NOT EXISTS(SELECT 1 FROM residents_applications f JOIN resident_review_events e ON e.action='REJECT_SOFT' AND resident_reapply_eligible(e.reapply_at,clock_timestamp()) JOIN residents_applications previous_form ON previous_form.id=e.attempt_id AND previous_form.user_id=f.user_id AND previous_form.attempt_number=f.attempt_number-1 WHERE f.user_id=NEW.user_id AND f.is_current AND f.attempt_number>1 AND f.status='UNDER_REVIEW' AND f.submitted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM expert_sales_form_bridges WHERE form_id=f.id)) OR EXISTS(SELECT 1 FROM expert_onboarding_payment_facts WHERE user_id=NEW.user_id) OR EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=NEW.user_id)) THEN RAISE EXCEPTION 'resident_reapply_unavailable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE INDEX resident_information_requests_history ON resident_information_requests(application_id,id);
CREATE INDEX resident_review_messages_history ON resident_review_messages(application_id,event_id);
CREATE INDEX resident_information_requests_due ON resident_information_requests(deadline,id) WHERE status='open';
