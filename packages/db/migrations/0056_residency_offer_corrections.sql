-- Additive v2 facts. Historical v1 quotes/orders and source validation remain intact.
CREATE TABLE expert_offer_profiles (
 user_id uuid NOT NULL REFERENCES users(id), revision integer NOT NULL CHECK(revision>0),
 city_code text NOT NULL CHECK(length(city_code) BETWEEN 1 AND 100), million_city boolean NOT NULL,
 service_format text NOT NULL CHECK(service_format IN ('online_only','offline','hybrid')),
 ticket_minor bigint NOT NULL CHECK(ticket_minor>=0), participant_kind text NOT NULL CHECK(participant_kind IN ('expert','space')),
 idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,revision), UNIQUE(user_id,idempotency_key)
);
--> statement-breakpoint
CREATE TABLE expert_offer_profile_verifications (
 user_id uuid NOT NULL, profile_revision integer NOT NULL,
 manager_id uuid NOT NULL REFERENCES users(id), session_hash text NOT NULL REFERENCES admin_sessions(session_id_hash),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(user_id,profile_revision),
 FOREIGN KEY(user_id,profile_revision) REFERENCES expert_offer_profiles(user_id,revision)
);
--> statement-breakpoint
CREATE TRIGGER expert_offer_profiles_append_only BEFORE UPDATE OR DELETE ON expert_offer_profiles FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER expert_offer_verifications_append_only BEFORE UPDATE OR DELETE ON expert_offer_profile_verifications FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
ALTER TABLE expert_campaign_anchors DROP CONSTRAINT expert_campaign_anchor_valid,
 ADD CONSTRAINT expert_campaign_anchor_valid CHECK(rule_version IN ('expert_energy_start_v1','expert_energy_start_v2') AND isfinite(calculation_timestamp) AND calculation_timestamp BETWEEN '1970-01-01'::timestamptz AND '275760-09-13'::timestamptz AND calculation_timestamp=date_trunc('milliseconds',calculation_timestamp));
--> statement-breakpoint
ALTER TABLE expert_campaign_quotes ADD COLUMN profile_revision integer, ADD COLUMN package_price_minor bigint,
 ADD CONSTRAINT expert_campaign_quote_profile_fk FOREIGN KEY(user_id,profile_revision) REFERENCES expert_offer_profiles(user_id,revision);
--> statement-breakpoint
ALTER TABLE expert_campaign_quotes DROP CONSTRAINT expert_campaign_quote_identity_valid, ADD CONSTRAINT expert_campaign_quote_identity_valid CHECK(rule_version='expert_energy_start_v2' OR (
    rule_version = 'expert_energy_start_v1' AND currency = 'RUB'
    AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'));
--> statement-breakpoint
ALTER TABLE expert_campaign_quotes DROP CONSTRAINT expert_campaign_quote_time_valid, ADD CONSTRAINT expert_campaign_quote_time_valid CHECK(rule_version='expert_energy_start_v2' OR (
    isfinite(calculation_timestamp) AND isfinite(quoted_at) AND isfinite(expires_at)
    AND calculation_timestamp >= '1970-01-01 00:00:00+00'::timestamptz
    AND calculation_timestamp <= quoted_at AND quoted_at < expires_at
    AND expires_at <= '275760-09-13 00:00:00+00'::timestamptz
    AND calculation_timestamp = date_trunc('milliseconds',calculation_timestamp)
    AND quoted_at = date_trunc('milliseconds',quoted_at)
    AND expires_at = date_trunc('milliseconds',expires_at)
    AND expires_at <= quoted_at + interval '15 minutes'));
--> statement-breakpoint
ALTER TABLE expert_campaign_quotes DROP CONSTRAINT expert_campaign_quote_stage_valid, ADD CONSTRAINT expert_campaign_quote_stage_valid CHECK(rule_version='expert_energy_start_v2' OR (
    term_months IN (1,3) AND duration_seconds = 2592000::bigint * term_months
    AND (term_months = 1 OR quoted_at - calculation_timestamp < interval '144 hours')
    AND energy_discount_bps = CASE
      WHEN quoted_at - calculation_timestamp < interval '72 hours' THEN 4000
      WHEN quoted_at - calculation_timestamp < interval '144 hours' THEN 3000
      WHEN quoted_at - calculation_timestamp < interval '216 hours' THEN 2000 ELSE 0 END
    AND start_discount_bps = CASE WHEN term_months = 1 THEN 0
      WHEN quoted_at - calculation_timestamp < interval '72 hours' THEN 1500 ELSE 1000 END));
--> statement-breakpoint
ALTER TABLE expert_campaign_quotes DROP CONSTRAINT expert_campaign_quote_arithmetic_valid, ADD CONSTRAINT expert_campaign_quote_arithmetic_valid CHECK(rule_version='expert_energy_start_v2' OR (
    base_monthly_minor > 0 AND discounted_monthly_minor >= 0
    AND discounted_monthly_minor = div(base_monthly_minor::numeric * (10000::numeric-energy_discount_bps) * (10000::numeric-start_discount_bps) + 50000000,100000000)
    AND monthly_price_minor = greatest(discounted_monthly_minor,500000)
    AND floor_applied = (discounted_monthly_minor < 500000)
    AND price_minor = monthly_price_minor::numeric * term_months
    AND price_minor BETWEEN 1 AND 999999999999));
--> statement-breakpoint
ALTER TABLE expert_campaign_quotes ADD CONSTRAINT expert_campaign_quote_v2_valid CHECK(
 (rule_version='expert_energy_start_v1' AND profile_revision IS NULL AND package_price_minor IS NULL) OR (rule_version='expert_energy_start_v2' AND profile_revision IS NOT NULL AND currency='RUB'
 AND isfinite(calculation_timestamp) AND isfinite(quoted_at) AND isfinite(expires_at)
 AND calculation_timestamp<=quoted_at AND quoted_at<expires_at AND (quoted_at-calculation_timestamp<interval '240 hours' OR expires_at<=quoted_at+interval '24 hours')
 AND calculation_timestamp=date_trunc('milliseconds',calculation_timestamp) AND quoted_at=date_trunc('milliseconds',quoted_at) AND expires_at=date_trunc('milliseconds',expires_at)
 AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
 AND term_months IN(1,3) AND duration_seconds=2592000::bigint*term_months
 AND (term_months=1 OR quoted_at-calculation_timestamp<interval '168 hours')
 AND energy_discount_bps=CASE WHEN quoted_at-calculation_timestamp<interval '96 hours' THEN 4000 WHEN quoted_at-calculation_timestamp<interval '168 hours' THEN 3000 WHEN quoted_at-calculation_timestamp<interval '240 hours' THEN 2000 ELSE 0 END
 AND base_monthly_minor>=0 AND monthly_price_minor=greatest(500000,div(base_monthly_minor::numeric*(10000-energy_discount_bps)+5000,10000))
 AND discounted_monthly_minor=div(base_monthly_minor::numeric*(10000-energy_discount_bps)+5000,10000)
 AND floor_applied=(CASE WHEN term_months=1 THEN discounted_monthly_minor<500000 ELSE div(base_monthly_minor::numeric*3*(10000-energy_discount_bps)*(10000-start_discount_bps)+50000000,100000000)<1500000 END)
 AND ((quoted_at-calculation_timestamp>=interval '168 hours' AND package_price_minor IS NULL AND start_discount_bps=0) OR (quoted_at-calculation_timestamp<interval '168 hours' AND package_price_minor IS NOT NULL AND package_price_minor=greatest(1500000,div(base_monthly_minor::numeric*3*(10000-energy_discount_bps)*(10000-start_discount_bps)+50000000,100000000))))
 AND price_minor=CASE WHEN term_months=1 THEN monthly_price_minor ELSE package_price_minor END AND price_minor BETWEEN 1 AND 999999999999));
--> statement-breakpoint
DROP TRIGGER expert_campaign_quote_source ON expert_campaign_quotes;
--> statement-breakpoint
CREATE TRIGGER expert_campaign_quote_source BEFORE INSERT ON expert_campaign_quotes FOR EACH ROW WHEN (NEW.rule_version='expert_energy_start_v1') EXECUTE FUNCTION enforce_expert_campaign_quote_source();
--> statement-breakpoint
CREATE FUNCTION enforce_expert_offer_v2_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t expert_residency_tariff_versions%ROWTYPE; p expert_offer_profiles%ROWTYPE; stage_end timestamptz; earliest timestamptz;
BEGIN
 LOCK TABLE consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 PERFORM 1 FROM users WHERE id=NEW.user_id AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'expert_offer_owner_invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM expert_offer_profiles WHERE user_id=NEW.user_id AND revision=NEW.profile_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'expert_offer_profile_invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO t FROM expert_residency_tariff_versions WHERE id=NEW.tariff_version_id FOR SHARE;
 IF NOT FOUND OR t.commercial_policy_version<>'expert_residency_v2' OR t.duration_seconds<>2592000 OR NEW.quoted_at<t.active_from OR NEW.quoted_at>=t.active_to
 OR ROW(NEW.base_monthly_minor,NEW.currency,NEW.display_name,NEW.credit_cap_bps,NEW.individual_services_enabled,NEW.group_event_limit,NEW.statistics_level,NEW.support_priority)
 IS DISTINCT FROM ROW(t.price_minor+CASE WHEN p.million_city THEN 500000 ELSE 0 END+CASE WHEN p.service_format='online_only' THEN 300000 ELSE 0 END-CASE WHEN p.ticket_minor<300000 THEN 100000 ELSE 0 END,t.currency,t.display_name,t.credit_cap_bps,t.individual_services_enabled,t.group_event_limit,t.statistics_level,t.support_priority)
 THEN RAISE EXCEPTION 'expert_offer_tariff_invalid' USING ERRCODE='23514'; END IF;
 IF p.participant_kind='space' AND NOT EXISTS(SELECT 1 FROM expert_space_tariff_approvals WHERE tariff_version_id=NEW.tariff_version_id) THEN RAISE EXCEPTION 'expert_space_tariff_unapproved' USING ERRCODE='23514'; END IF;
 IF NEW.start_discount_bps IS DISTINCT FROM (CASE WHEN NEW.quoted_at-NEW.calculation_timestamp>=interval '168 hours' THEN 0 WHEN p.participant_kind='space' THEN 1000 WHEN NEW.quoted_at-NEW.calculation_timestamp<interval '96 hours' THEN 1500 ELSE 1000 END) THEN RAISE EXCEPTION 'expert_offer_package_invalid' USING ERRCODE='23514'; END IF;
 SELECT min(calculation_timestamp) INTO earliest FROM expert_campaign_anchors WHERE user_id=NEW.user_id;
 IF NEW.calculation_timestamp IS DISTINCT FROM earliest THEN RAISE EXCEPTION 'expert_offer_anchor_invalid' USING ERRCODE='23514'; END IF;
 stage_end:=CASE WHEN NEW.quoted_at-NEW.calculation_timestamp<interval '96 hours' THEN NEW.calculation_timestamp+interval '96 hours' WHEN NEW.quoted_at-NEW.calculation_timestamp<interval '168 hours' THEN NEW.calculation_timestamp+interval '168 hours' WHEN NEW.quoted_at-NEW.calculation_timestamp<interval '240 hours' THEN NEW.calculation_timestamp+interval '240 hours' ELSE NEW.quoted_at+interval '24 hours' END;
 IF NEW.expires_at IS DISTINCT FROM least(stage_end,date_trunc('milliseconds',t.active_to)) THEN RAISE EXCEPTION 'expert_offer_expiry_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_offer_v2_source BEFORE INSERT ON expert_campaign_quotes FOR EACH ROW WHEN(NEW.rule_version='expert_energy_start_v2') EXECUTE FUNCTION enforce_expert_offer_v2_source();
--> statement-breakpoint
CREATE TABLE expert_offer_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), application_id uuid REFERENCES expert_onboarding_applications(id) ON DELETE SET NULL, application_audit_id uuid NOT NULL, tariff_version_id uuid NOT NULL REFERENCES expert_residency_tariff_versions(id), profile_revision integer NOT NULL,
 term_months integer NOT NULL CHECK(term_months IN(1,3)), source_update_id text NOT NULL, consent_version text NOT NULL,
 original_acceptance_id uuid NOT NULL REFERENCES expert_card_main_acceptances(id), revision integer NOT NULL CHECK(revision>0), original_quote_id uuid NOT NULL REFERENCES expert_campaign_quotes(id), review_id uuid REFERENCES expert_card_reviews(id) ON DELETE SET NULL, review_audit_id uuid NOT NULL, expert_id uuid NOT NULL REFERENCES experts(id), public_digest text NOT NULL,
 bot_id text, bot_key text, chat_id text, request_key text NOT NULL, request_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(user_id,source_update_id), FOREIGN KEY(user_id,profile_revision) REFERENCES expert_offer_profiles(user_id,revision)
);
--> statement-breakpoint
CREATE FUNCTION protect_expert_offer_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['application_id','review_id','bot_id','bot_key','chat_id'])=(to_jsonb(OLD)-ARRAY['application_id','review_id','bot_id','bot_key','chat_id']) AND (NEW.application_id IS NOT DISTINCT FROM OLD.application_id OR NEW.application_id IS NULL) AND (NEW.review_id IS NOT DISTINCT FROM OLD.review_id OR NEW.review_id IS NULL) AND (NEW.bot_id IS NOT DISTINCT FROM OLD.bot_id OR NEW.bot_id IS NULL) AND (NEW.bot_key IS NOT DISTINCT FROM OLD.bot_key OR NEW.bot_key IS NULL) AND (NEW.chat_id IS NOT DISTINCT FROM OLD.chat_id OR NEW.chat_id IS NULL) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'expert_offer_schedule_immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_offer_schedules_append_only BEFORE UPDATE OR DELETE ON expert_offer_schedules FOR EACH ROW EXECUTE FUNCTION protect_expert_offer_schedule();
--> statement-breakpoint
CREATE TABLE expert_personal_offer_state(user_id uuid PRIMARY KEY REFERENCES users(id),quote_id uuid NOT NULL REFERENCES expert_campaign_quotes(id),schedule_id uuid REFERENCES expert_offer_schedules(id),order_id uuid REFERENCES expert_residency_orders(id),payment_id text,payment_url text,refreshed_at timestamptz NOT NULL DEFAULT clock_timestamp(),next_refresh_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE TABLE expert_personal_offer_notices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),quote_id uuid NOT NULL REFERENCES expert_campaign_quotes(id),stage_deadline timestamptz NOT NULL,lead_hours integer NOT NULL CHECK(lead_hours IN(24,3,0)),status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','unknown_outcome','delivered','cancelled')),attempt_id uuid,attempted_at timestamptz,receipt jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(user_id,stage_deadline,lead_hours));
--> statement-breakpoint
CREATE INDEX expert_personal_offer_refresh_due ON expert_personal_offer_state(next_refresh_at);
--> statement-breakpoint
CREATE INDEX expert_personal_offer_notice_pending ON expert_personal_offer_notices(stage_deadline) WHERE status='pending';
--> statement-breakpoint
CREATE TABLE expert_manager_telegram_pairings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text UNIQUE NOT NULL,session_hash text NOT NULL REFERENCES admin_sessions(session_id_hash),bot_id text NOT NULL,expires_at timestamptz NOT NULL,telegram_user_id text,telegram_chat_id text,paired_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(isfinite(expires_at)),CHECK((telegram_user_id IS NULL AND telegram_chat_id IS NULL AND paired_at IS NULL) OR (telegram_user_id IS NOT NULL AND telegram_chat_id IS NOT NULL AND paired_at IS NOT NULL)));
--> statement-breakpoint
CREATE TABLE expert_manager_telegram_callbacks(profile_revision integer,id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pairing_id uuid NOT NULL REFERENCES expert_manager_telegram_pairings(id),application_id uuid NOT NULL REFERENCES expert_onboarding_applications(id) ON DELETE CASCADE,decision text NOT NULL CHECK(decision IN('approved','rejected')),nonce_hash text UNIQUE NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(isfinite(expires_at)));
--> statement-breakpoint
CREATE TABLE expert_manager_telegram_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pairing_id uuid NOT NULL REFERENCES expert_manager_telegram_pairings(id),application_id uuid NOT NULL REFERENCES expert_onboarding_applications(id) ON DELETE CASCADE,status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent')),lease_until timestamptz,fence uuid,sent_at timestamptz,UNIQUE(pairing_id,application_id));
--> statement-breakpoint
CREATE TABLE expert_application_material_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL UNIQUE REFERENCES expert_onboarding_applications(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id),status text NOT NULL DEFAULT 'waiting_content' CHECK(status IN('waiting_content','pending','delivered','unknown_outcome','cancelled')),target_bot_id text,target_bot_key text,target_chat_id text,template_id uuid REFERENCES expert_card_material_templates(id),content_version text,payload_digest text,delivery_receipt jsonb,attempt_id uuid,expected_message_count integer,delivered_at timestamptz,attempt_started_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE TABLE expert_application_promo_proofs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL REFERENCES expert_onboarding_applications(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id),kind text NOT NULL CHECK(kind IN('link','photo','document')),reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE TABLE expert_application_promo_confirmations(id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),idempotency_key text NOT NULL,application_id uuid PRIMARY KEY REFERENCES expert_onboarding_applications(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id),proof_digest text NOT NULL,manager_id uuid NOT NULL REFERENCES users(id),session_hash text NOT NULL REFERENCES admin_sessions(session_id_hash),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(manager_id,idempotency_key));

--> statement-breakpoint
CREATE OR REPLACE FUNCTION expert_card_activation_gate_valid(target_user uuid,target_review uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 WITH authority_epoch AS MATERIALIZED (SELECT revision FROM expert_card_consent_epoch WHERE id=1 FOR SHARE)
 SELECT EXISTS(SELECT 1 FROM authority_epoch CROSS JOIN expert_card_drafts d JOIN users u ON u.id=d.user_id AND u.active=true
 JOIN expert_onboarding_applications a ON a.id=d.application_id AND a.user_id=d.user_id AND a.verification_status='approved'
 JOIN expert_onboarding_invoices i ON i.application_id=a.id AND i.user_id=d.user_id AND i.purpose='onboarding' AND i.status='settled'
 JOIN expert_onboarding_payment_facts f ON f.invoice_id=i.id AND f.user_id=d.user_id AND f.admission='interview'
 JOIN expert_card_reviews r ON r.id=d.approved_review_id AND r.draft_id=d.id AND r.user_id=d.user_id AND r.revision=d.revision AND r.action='approve' AND r.public_payload=d.public_payload
 LEFT JOIN expert_card_material_jobs j ON j.review_id=r.id AND j.draft_id=d.id AND j.user_id=d.user_id AND j.revision=d.revision AND j.status='delivered' AND j.delivery_receipt IS NOT NULL AND j.target_bot_id=d.work_bot_id AND j.target_chat_id=d.work_chat_id
 LEFT JOIN expert_card_material_templates t ON t.id=j.template_id AND t.content_version=j.content_version AND t.status='approved' AND j.expected_message_count=1+jsonb_array_length(t.assets)
 LEFT JOIN expert_card_promo_confirmations p ON p.review_id=r.id AND p.draft_id=d.id AND p.user_id=d.user_id AND p.revision=d.revision AND p.proof_digest=expert_card_proof_digest(d.id,r.id)
 WHERE d.user_id=target_user AND r.id=target_review AND d.status='approved' AND expert_card_current_messaging_authority(d.user_id,d.messaging_policy_version)

 AND EXISTS(SELECT 1 FROM channel_identities ci WHERE ci.user_id=d.user_id AND ci.provider='telegram' AND ci.bot_key=d.work_bot_key AND ci.external_id=d.work_chat_id AND ci.external_chat_id=d.work_chat_id AND ci.status='active')
 AND ((j.id IS NOT NULL AND t.id IS NOT NULL AND p.id IS NOT NULL AND EXISTS(SELECT 1 FROM expert_card_promo_proofs proof WHERE proof.review_id=r.id AND proof.draft_id=d.id)) OR EXISTS(SELECT 1 FROM expert_application_promo_confirmations ap WHERE ap.application_id=a.id AND ap.user_id=d.user_id AND ap.proof_digest=(SELECT 'sha256:'||encode(digest(coalesce(string_agg(proof.id::text||':'||proof.kind||':'||proof.reference,E'\n' ORDER BY proof.created_at,proof.id),''),'sha256'),'hex') FROM expert_application_promo_proofs proof WHERE proof.application_id=a.id AND proof.user_id=d.user_id) AND EXISTS(SELECT 1 FROM expert_application_promo_proofs proof WHERE proof.application_id=a.id AND proof.user_id=d.user_id))))
$$;


--> statement-breakpoint
ALTER TABLE expert_card_main_acceptances ADD COLUMN acceptance_source text NOT NULL DEFAULT 'explicit',ADD COLUMN offer_schedule_id uuid REFERENCES expert_offer_schedules(id),ADD CONSTRAINT expert_card_acceptance_source_valid CHECK((acceptance_source='explicit' AND offer_schedule_id IS NULL) OR (acceptance_source='schedule' AND offer_schedule_id IS NOT NULL));
--> statement-breakpoint
CREATE FUNCTION enforce_expert_offer_schedule_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.application_audit_id:=NEW.application_id; NEW.review_audit_id:=NEW.review_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM expert_card_main_acceptances a JOIN expert_campaign_quotes q ON q.id=a.quote_id JOIN expert_card_drafts d ON d.application_id=a.application_id AND d.user_id=a.user_id JOIN expert_card_requests req ON req.bot_id=NEW.bot_id AND req.bot_id||':'||req.update_id=NEW.source_update_id AND req.user_id=NEW.user_id AND req.operation='main_accept' AND req.result_id=NEW.original_acceptance_id AND req.erased_at IS NULL
 WHERE NEW.created_at>=a.created_at AND NEW.created_at<=clock_timestamp() AND a.id=NEW.original_acceptance_id AND a.acceptance_source='explicit' AND a.user_id=NEW.user_id AND a.application_id=NEW.application_id AND a.expert_id=NEW.expert_id AND a.review_id=NEW.review_id AND a.revision=NEW.revision AND a.public_digest=NEW.public_digest AND q.id=NEW.original_quote_id AND q.tariff_version_id=NEW.tariff_version_id AND q.term_months=NEW.term_months AND q.profile_revision=NEW.profile_revision AND q.rule_version='expert_energy_start_v2' AND NEW.consent_version=d.messaging_policy_version AND NEW.bot_id=d.work_bot_id AND NEW.bot_key=d.work_bot_key AND NEW.chat_id=d.work_chat_id AND NEW.request_key=NEW.source_update_id AND NEW.request_digest=req.request_digest AND expert_card_activation_gate_valid(a.user_id,a.review_id)) THEN RAISE EXCEPTION 'expert_offer_schedule_source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_offer_schedule_source BEFORE INSERT ON expert_offer_schedules FOR EACH ROW EXECUTE FUNCTION enforce_expert_offer_schedule_source();
--> statement-breakpoint
CREATE FUNCTION expert_campaign_current_profile_valid(target_user uuid,target_quote uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM expert_campaign_quotes q WHERE q.id=target_quote AND q.user_id=target_user AND (q.rule_version='expert_energy_start_v1' OR (q.rule_version='expert_energy_start_v2' AND q.profile_revision=(SELECT max(revision) FROM expert_offer_profiles WHERE user_id=target_user) AND EXISTS(SELECT 1 FROM expert_offer_profile_verifications v WHERE v.user_id=target_user AND v.profile_revision=q.profile_revision))))
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_card_main_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.application_id IS NULL OR NEW.review_id IS NULL OR NOT expert_campaign_current_profile_valid(NEW.user_id,NEW.quote_id) OR NOT expert_card_activation_gate_valid(NEW.user_id,NEW.review_id)
 OR NOT EXISTS(SELECT 1 FROM expert_card_drafts d JOIN expert_card_reviews r ON r.id=d.approved_review_id
   JOIN expert_campaign_quotes q ON q.id=NEW.quote_id AND q.user_id=NEW.user_id
   JOIN experts e ON e.id=NEW.expert_id AND e.user_id=NEW.user_id
   WHERE d.application_id=NEW.application_id AND d.user_id=NEW.user_id AND r.id=NEW.review_id
     AND r.revision=NEW.revision AND r.public_digest=NEW.public_digest AND q.quoted_at<=clock_timestamp() AND q.expires_at>clock_timestamp()
     AND (q.rule_version='expert_energy_start_v1' OR (q.profile_revision=(SELECT max(revision) FROM expert_offer_profiles WHERE user_id=NEW.user_id) AND EXISTS(SELECT 1 FROM expert_offer_profile_verifications pv WHERE pv.user_id=NEW.user_id AND pv.profile_revision=q.profile_revision)))) THEN
  RAISE EXCEPTION 'expert_card_main_acceptance_source' USING ERRCODE='23514';
 END IF;
 IF NEW.acceptance_source='schedule' AND NOT EXISTS(SELECT 1 FROM expert_offer_schedules s JOIN expert_campaign_quotes q ON q.id=NEW.quote_id JOIN expert_card_main_acceptances original ON original.id=s.original_acceptance_id AND original.acceptance_source='explicit'
 WHERE s.id=NEW.offer_schedule_id AND s.id=(SELECT latest.id FROM expert_offer_schedules latest WHERE latest.user_id=NEW.user_id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1) AND s.user_id=NEW.user_id AND s.application_id=NEW.application_id AND s.expert_id=NEW.expert_id AND s.review_id=NEW.review_id AND s.revision=NEW.revision AND s.public_digest=NEW.public_digest AND s.tariff_version_id=q.tariff_version_id AND s.term_months=q.term_months AND s.profile_revision=q.profile_revision) THEN RAISE EXCEPTION 'expert_offer_schedule_binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TABLE expert_promo_ready_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event text NOT NULL CHECK(event='Ready to send'),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
ALTER TABLE expert_promo_guide_work ADD COLUMN ready_log_event_id uuid UNIQUE REFERENCES expert_promo_ready_logs(id), ALTER COLUMN content_slot SET DEFAULT 'TODO: Wait for PDF';

--> statement-breakpoint
ALTER TABLE expert_promo_requests DROP CONSTRAINT expert_promo_request_operation,ADD CONSTRAINT expert_promo_request_operation CHECK(operation IN ('register','application','quote','enroll','consent','tariffs','profile'));
--> statement-breakpoint
CREATE TABLE expert_space_tariff_approvals(tariff_version_id uuid PRIMARY KEY REFERENCES expert_residency_tariff_versions(id),manager_id uuid NOT NULL REFERENCES users(id),session_hash text NOT NULL REFERENCES admin_sessions(session_id_hash),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE FUNCTION enforce_expert_offer_manager_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT expert_card_manager_authority_valid(NEW.manager_id,NEW.session_hash) THEN RAISE EXCEPTION 'expert_offer_manager_required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='expert_offer_profile_verifications' THEN
 IF NEW.profile_revision IS DISTINCT FROM (SELECT max(revision) FROM expert_offer_profiles WHERE user_id=NEW.user_id) THEN RAISE EXCEPTION 'expert_offer_current_profile_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_offer_profile_verification_source BEFORE INSERT ON expert_offer_profile_verifications FOR EACH ROW EXECUTE FUNCTION enforce_expert_offer_manager_fact();
--> statement-breakpoint
CREATE TRIGGER expert_space_tariff_approval_source BEFORE INSERT ON expert_space_tariff_approvals FOR EACH ROW EXECUTE FUNCTION enforce_expert_offer_manager_fact();
--> statement-breakpoint
CREATE TRIGGER expert_space_tariff_approvals_append_only BEFORE UPDATE OR DELETE ON expert_space_tariff_approvals FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE FUNCTION enforce_expert_application_promo_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM expert_onboarding_applications a JOIN expert_onboarding_invoices i ON i.application_id=a.id AND i.user_id=a.user_id AND i.status='settled' JOIN expert_onboarding_payment_facts f ON f.invoice_id=i.id AND f.admission='interview' WHERE a.id=NEW.application_id AND a.user_id=NEW.user_id) THEN RAISE EXCEPTION 'expert_application_promo_owner' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='expert_application_promo_confirmations' THEN
 IF NOT expert_card_manager_authority_valid(NEW.manager_id,NEW.session_hash) OR NOT EXISTS(SELECT 1 FROM expert_application_promo_proofs p WHERE p.application_id=NEW.application_id AND p.user_id=NEW.user_id) OR NEW.proof_digest IS DISTINCT FROM (SELECT 'sha256:'||encode(digest(coalesce(string_agg(p.id::text||':'||p.kind||':'||p.reference,E'\n' ORDER BY p.created_at,p.id),''),'sha256'),'hex') FROM expert_application_promo_proofs p WHERE p.application_id=NEW.application_id AND p.user_id=NEW.user_id) THEN RAISE EXCEPTION 'expert_application_promo_manager' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_application_material_owner BEFORE INSERT ON expert_application_material_jobs FOR EACH ROW EXECUTE FUNCTION enforce_expert_application_promo_owner();
--> statement-breakpoint
CREATE TRIGGER expert_application_proof_owner BEFORE INSERT ON expert_application_promo_proofs FOR EACH ROW EXECUTE FUNCTION enforce_expert_application_promo_owner();
--> statement-breakpoint
CREATE TRIGGER expert_application_confirmation_owner BEFORE INSERT OR UPDATE ON expert_application_promo_confirmations FOR EACH ROW EXECUTE FUNCTION enforce_expert_application_promo_owner();

--> statement-breakpoint
CREATE FUNCTION erase_expert_offer_delivery_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE expert_personal_offer_state SET payment_id=NULL,payment_url=NULL WHERE user_id=OLD.user_id;
 UPDATE expert_personal_offer_notices SET status='cancelled',receipt=NULL WHERE user_id=OLD.user_id;
 UPDATE expert_offer_schedules SET bot_id=NULL,bot_key=NULL,chat_id=NULL WHERE user_id=OLD.user_id;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_offer_application_erasure AFTER DELETE ON expert_onboarding_applications FOR EACH ROW EXECUTE FUNCTION erase_expert_offer_delivery_state();
--> statement-breakpoint
ALTER TABLE expert_application_material_jobs
 ADD CONSTRAINT expert_application_material_owner_fk FOREIGN KEY(application_id,user_id) REFERENCES expert_onboarding_applications(id,user_id) ON DELETE CASCADE,
 ADD CONSTRAINT expert_application_material_template_fk FOREIGN KEY(template_id,content_version) REFERENCES expert_card_material_templates(id,content_version),
 ADD CONSTRAINT expert_application_material_attempt CHECK(coalesce(((attempt_id IS NULL AND attempt_started_at IS NULL) OR (attempt_id IS NOT NULL AND attempt_started_at IS NOT NULL AND isfinite(attempt_started_at))),false)),
 ADD CONSTRAINT expert_application_material_receipt CHECK(coalesce(((status='delivered' AND template_id IS NOT NULL AND content_version IS NOT NULL AND delivered_at IS NOT NULL AND isfinite(delivered_at) AND attempt_id IS NOT NULL AND payload_digest IS NOT NULL AND payload_digest ~ '^sha256:[0-9a-f]{64}$' AND expert_card_delivery_receipt_valid(delivery_receipt,target_bot_id,target_chat_id,content_version,payload_digest,expected_message_count)) OR (status<>'delivered' AND delivery_receipt IS NULL AND delivered_at IS NULL)),false));
--> statement-breakpoint
ALTER TABLE expert_application_promo_proofs ADD CONSTRAINT expert_application_proof_owner_fk FOREIGN KEY(application_id,user_id) REFERENCES expert_onboarding_applications(id,user_id) ON DELETE CASCADE,
 ADD CONSTRAINT expert_application_proof_value CHECK(coalesce(((kind='link' AND length(reference) BETWEEN 1 AND 2048 AND reference LIKE 'https://%') OR (kind IN ('photo','document') AND char_length(reference) BETWEEN 15 AND 526 AND reference ~ '^telegram:file:[A-Za-z0-9_-]+$')),false));
--> statement-breakpoint
ALTER TABLE expert_application_promo_confirmations ADD CONSTRAINT expert_application_confirmation_owner_fk FOREIGN KEY(application_id,user_id) REFERENCES expert_onboarding_applications(id,user_id) ON DELETE CASCADE;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_campaign_order_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  quote expert_campaign_quotes%ROWTYPE;
  tariff expert_residency_tariff_versions%ROWTYPE;
  expert experts%ROWTYPE;
  checked_at timestamptz;
BEGIN
  IF NEW.commercial_policy_version <> 'expert_campaign_v1' THEN RETURN NEW; END IF;
  SELECT * INTO quote FROM expert_campaign_quotes WHERE id=NEW.campaign_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expert_campaign_order_source' USING ERRCODE='23514';
  END IF;
  LOCK TABLE consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(quote.user_id::text,0));
  IF NOT expert_campaign_current_profile_valid(quote.user_id,quote.id) THEN RAISE EXCEPTION 'expert_offer_current_profile_required' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM users WHERE id=quote.user_id AND active=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expert_campaign_order_source' USING ERRCODE='23514'; END IF;
  SELECT * INTO expert FROM experts WHERE id=NEW.expert_id FOR SHARE;
  IF NOT FOUND OR expert.user_id IS DISTINCT FROM quote.user_id OR (
    (quote.rule_version='expert_energy_start_v2' OR NOT expert.active OR NOT expert.verified) AND NOT EXISTS(
      SELECT 1 FROM expert_card_main_acceptances a WHERE a.expert_id=NEW.expert_id AND a.user_id=quote.user_id
        AND a.quote_id=quote.id AND a.application_id IS NOT NULL AND a.review_id IS NOT NULL
        AND expert_card_activation_gate_valid(a.user_id,a.review_id)
        AND (a.acceptance_source='explicit' OR a.offer_schedule_id=(SELECT latest.id FROM expert_offer_schedules latest WHERE latest.user_id=quote.user_id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)))) THEN
    RAISE EXCEPTION 'expert_campaign_order_source' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM expert_campaign_quotes WHERE id=quote.id FOR SHARE;
  SELECT * INTO tariff FROM expert_residency_tariff_versions WHERE id=quote.tariff_version_id FOR SHARE;
  checked_at := clock_timestamp();
  IF checked_at < quote.quoted_at OR checked_at >= quote.expires_at THEN
    RAISE EXCEPTION 'expert_campaign_order_expired' USING ERRCODE='23514',CONSTRAINT='expert_campaign_order_expired';
  END IF;
  IF NOT FOUND OR tariff.commercial_policy_version <> 'expert_residency_v2'
    OR checked_at < tariff.active_from OR checked_at >= tariff.active_to
    OR NEW.created_at < quote.quoted_at OR NEW.created_at > checked_at
    OR NEW.provider_deadline IS DISTINCT FROM quote.expires_at
    OR NOT isfinite(NEW.created_at) OR NOT isfinite(NEW.payment_deadline)
    OR ROW(NEW.tariff_version_id,NEW.campaign_term_months,NEW.snapshot_display_name,NEW.price_minor,NEW.currency,
      NEW.duration_seconds,NEW.credit_cap_bps,NEW.individual_services_enabled,NEW.group_event_limit,NEW.statistics_level,NEW.support_priority)
      IS DISTINCT FROM ROW(quote.tariff_version_id,quote.term_months,quote.display_name,quote.price_minor,quote.currency,
      quote.duration_seconds,quote.credit_cap_bps,quote.individual_services_enabled,quote.group_event_limit,quote.statistics_level,quote.support_priority)
  THEN RAISE EXCEPTION 'expert_campaign_order_source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TABLE expert_main_activation_admissions (
 order_id uuid PRIMARY KEY REFERENCES expert_residency_orders(id),
 user_id uuid NOT NULL REFERENCES users(id),expert_id uuid NOT NULL REFERENCES experts(id),quote_id uuid NOT NULL REFERENCES expert_campaign_quotes(id),
 profile_revision integer CHECK(profile_revision>0),application_audit_id uuid NOT NULL,review_audit_id uuid NOT NULL,
 public_digest text NOT NULL CHECK(public_digest ~ '^sha256:[0-9a-f]{64}$'),
 provider_event_id uuid NOT NULL UNIQUE REFERENCES expert_residency_provider_event_inbox(id),
 admitted_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(admitted_at)),
 CONSTRAINT expert_main_admission_profile_fk FOREIGN KEY(user_id,profile_revision) REFERENCES expert_offer_profiles(user_id,revision)
);
--> statement-breakpoint
-- Controlled provenance backfill precedes the live admission source/immutability triggers.
-- A settled balance alone is insufficient: require immutable accepted main-card
-- provenance and timely canonical processed settlement with stored mode.
-- Publication is not required: a valid prepaid future interval may be disconnected.
INSERT INTO expert_main_activation_admissions(order_id,user_id,expert_id,quote_id,profile_revision,application_audit_id,review_audit_id,public_digest,provider_event_id,admitted_at)
 SELECT DISTINCT ON(o.id) o.id,m.user_id,m.expert_id,m.quote_id,NULL,m.application_audit_id,m.review_audit_id,m.public_digest,p.id,greatest(p.verified_at,coalesce(o.settled_at,p.processed_at))
 FROM expert_card_main_orders m JOIN expert_residency_orders o ON o.id=m.order_id AND o.expert_id=m.expert_id AND o.campaign_quote_id=m.quote_id AND o.status='settled'
 JOIN expert_campaign_quotes q ON q.id=m.quote_id AND q.user_id=m.user_id AND q.rule_version='expert_energy_start_v1'
 JOIN expert_card_main_acceptances a ON a.id=m.acceptance_id AND a.user_id=m.user_id AND a.expert_id=m.expert_id AND a.quote_id=m.quote_id AND a.application_audit_id=m.application_audit_id AND a.review_audit_id=m.review_audit_id AND a.public_digest=m.public_digest AND a.created_at<=o.created_at
 JOIN expert_card_reviews review ON review.id=m.review_audit_id AND review.action='approve' AND review.public_digest=m.public_digest AND review.revision=m.revision
 JOIN expert_residency_provider_event_inbox p ON p.order_id=o.id AND p.provider='yookassa' AND p.authenticated AND p.identity_version=1 AND p.status='processed' AND p.result_code='settled' AND p.event_kind='settled' AND p.payment_id=o.provider_payment_id AND p.amount_minor=o.cash_minor AND p.currency=o.currency
 JOIN expert_residency_provider_operations po ON po.order_id=o.id AND po.operation_kind='create_payment' AND po.environment_mode=m.provider_mode AND po.provider_object_id=p.payment_id AND po.amount_minor=p.amount_minor AND po.currency=p.currency AND po.status IN ('pending','unknown_outcome','succeeded')
 WHERE m.purpose='main_residency' AND isfinite(p.verified_at) AND isfinite(p.processed_at) AND p.processed_at>=p.verified_at AND isfinite(o.settled_at) AND p.verified_at<=o.settled_at AND o.settled_at<o.payment_deadline
 ORDER BY o.id,p.processed_at,p.id;
--> statement-breakpoint
CREATE FUNCTION enforce_expert_main_activation_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT expert_campaign_current_profile_valid(NEW.user_id,NEW.quote_id) OR NOT EXISTS(
 SELECT 1 FROM expert_card_main_orders m JOIN expert_residency_orders o ON o.id=m.order_id AND o.expert_id=m.expert_id AND o.campaign_quote_id=m.quote_id AND o.status='settled'
 JOIN expert_campaign_quotes q ON q.id=m.quote_id AND q.user_id=m.user_id AND q.rule_version IN ('expert_energy_start_v1','expert_energy_start_v2') AND q.profile_revision IS NOT DISTINCT FROM NEW.profile_revision
 JOIN expert_residency_provider_event_inbox p ON p.id=NEW.provider_event_id AND p.order_id=o.id AND p.provider='yookassa' AND p.authenticated=true AND p.identity_version=1 AND p.status='processing' AND p.event_kind='settled' AND p.amount_minor=o.cash_minor AND p.currency=o.currency AND p.payment_id=o.provider_payment_id
 JOIN expert_residency_provider_operations po ON po.order_id=o.id AND po.operation_kind='create_payment' AND po.environment_mode=m.provider_mode AND po.provider_object_id=p.payment_id AND po.amount_minor=p.amount_minor AND po.currency=p.currency AND po.status IN('pending','unknown_outcome','succeeded')
 WHERE m.order_id=NEW.order_id AND m.user_id=NEW.user_id AND m.expert_id=NEW.expert_id AND m.quote_id=NEW.quote_id AND m.purpose='main_residency'
 AND m.application_audit_id=NEW.application_audit_id AND m.review_audit_id=NEW.review_audit_id AND m.public_digest=NEW.public_digest
 AND m.application_id IS NOT NULL AND m.review_id IS NOT NULL AND expert_card_activation_gate_valid(m.user_id,m.review_id)
 AND NEW.admitted_at>=p.verified_at AND NEW.admitted_at<=clock_timestamp()) THEN RAISE EXCEPTION 'expert_main_activation_admission_source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_main_activation_admission_source BEFORE INSERT ON expert_main_activation_admissions FOR EACH ROW EXECUTE FUNCTION enforce_expert_main_activation_admission();
--> statement-breakpoint
CREATE TRIGGER expert_main_activation_admissions_append_only BEFORE UPDATE OR DELETE ON expert_main_activation_admissions FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_published_card_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NOT NEW.active AND (to_jsonb(NEW)-ARRAY['active','updated_at'])=(to_jsonb(OLD)-ARRAY['active','updated_at']) THEN RETURN NEW; END IF;
 IF NEW.draft_id IS NULL OR NEW.review_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM experts e JOIN users u ON u.id=e.user_id AND u.active JOIN expert_card_reviews r ON r.id=NEW.review_id
   JOIN expert_card_drafts d ON d.id=NEW.draft_id AND d.approved_review_id=r.id AND d.revision=r.revision
   JOIN expert_residency_orders o ON o.id=NEW.paid_order_id AND o.expert_id=e.id AND o.status='settled'
   JOIN expert_card_main_orders m ON m.order_id=o.id AND m.expert_id=e.id AND m.user_id=NEW.user_id AND m.review_id=r.id AND m.revision=NEW.revision AND m.public_digest=NEW.public_digest
   WHERE expert_card_activation_gate_valid(NEW.user_id,NEW.review_id) AND e.id=NEW.expert_id AND e.user_id=NEW.user_id AND e.active AND e.verified AND d.user_id=e.user_id
     AND EXISTS(SELECT 1 FROM expert_main_activation_admissions admission WHERE admission.order_id=o.id AND admission.user_id=NEW.user_id AND admission.expert_id=NEW.expert_id AND admission.quote_id=m.quote_id AND admission.application_audit_id=NEW.application_audit_id AND admission.review_audit_id=m.review_audit_id AND admission.public_digest=NEW.public_digest)
     AND d.application_id=NEW.application_audit_id AND r.action='approve' AND r.revision=NEW.revision
     AND r.public_digest=NEW.public_digest AND r.public_payload=NEW.public_payload AND o.residency_ends_at=NEW.next_billing_date)
 OR (NEW.active AND (NEW.next_billing_date<=clock_timestamp() OR NOT EXISTS(
   SELECT 1 FROM expert_residency_orders o WHERE o.expert_id=NEW.expert_id AND o.status='settled' AND o.residency_starts_at<=clock_timestamp() AND o.residency_ends_at>clock_timestamp()))) THEN
  RAISE EXCEPTION 'expert_published_card_source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION clear_expert_offer_delivery_state(subject uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF subject IS NULL THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(subject::text,0));
 UPDATE expert_personal_offer_state SET payment_id=NULL,payment_url=NULL WHERE user_id=subject;
 UPDATE expert_personal_offer_notices SET status=CASE WHEN status IN('pending','unknown_outcome') THEN 'cancelled' ELSE status END,receipt=NULL WHERE user_id=subject;
 UPDATE expert_offer_schedules SET bot_id=NULL,bot_key=NULL,chat_id=NULL WHERE user_id=subject;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erase_expert_offer_delivery_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM clear_expert_offer_delivery_state(OLD.user_id);
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE FUNCTION enforce_expert_offer_subject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='users' THEN
  PERFORM clear_expert_offer_delivery_state(NEW.id);
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='consents' THEN
  PERFORM clear_expert_offer_delivery_state(NEW.user_id);
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  PERFORM clear_expert_offer_delivery_state(OLD.user_id);
  RETURN OLD;
 END IF;
 IF NEW.status<>'active' OR NEW.user_id IS DISTINCT FROM OLD.user_id OR ROW(NEW.provider,NEW.bot_key,NEW.external_id,NEW.external_chat_id) IS DISTINCT FROM ROW(OLD.provider,OLD.bot_key,OLD.external_id,OLD.external_chat_id) THEN
  PERFORM clear_expert_offer_delivery_state(OLD.user_id);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_offer_user_deactivation AFTER UPDATE OF active ON users FOR EACH ROW WHEN(OLD.active AND NOT NEW.active) EXECUTE FUNCTION enforce_expert_offer_subject_cleanup();
--> statement-breakpoint
CREATE TRIGGER expert_offer_identity_revocation AFTER UPDATE OF status,user_id,provider,bot_key,external_id,external_chat_id OR DELETE ON channel_identities FOR EACH ROW EXECUTE FUNCTION enforce_expert_offer_subject_cleanup();
--> statement-breakpoint
CREATE TRIGGER expert_offer_consent_revocation AFTER INSERT ON consents FOR EACH ROW WHEN(NEW.consent_type='client_messaging' AND NEW.decision IN('denied','revoked')) EXECUTE FUNCTION enforce_expert_offer_subject_cleanup();
