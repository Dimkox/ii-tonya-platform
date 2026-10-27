-- Private raw interview/media/proof content is RF PostgreSQL-only. Financial DDL
-- is appended by this migration's sole owner after the card relations/functions.
CREATE FUNCTION expert_card_public_payload_valid(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_typeof(value)='object' AND expert_jsonb_has_exact_keys(value,ARRAY['displayName','profession','city','summary'])
  AND jsonb_typeof(value->'displayName')='string' AND char_length(value->>'displayName') BETWEEN 1 AND 80
  AND jsonb_typeof(value->'profession')='string' AND char_length(value->>'profession') BETWEEN 1 AND 120
  AND jsonb_typeof(value->'city')='string' AND char_length(value->>'city') BETWEEN 1 AND 80
  AND jsonb_typeof(value->'summary')='string' AND char_length(value->>'summary') BETWEEN 1 AND 2000
  AND normalize(concat_ws(' ',value->>'displayName',value->>'profession',value->>'city',value->>'summary'),NFKC) !~* '(https?://|www\.|telegram:file:|rfpg:|@|[0-9][0-9()+ -]{7,}[0-9]|[[:cntrl:]])',false)
$$;
--> statement-breakpoint
CREATE TABLE expert_card_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL UNIQUE,
 user_id uuid NOT NULL UNIQUE REFERENCES users(id), revision integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'collecting', public_payload jsonb, approved_review_id uuid,
 messaging_policy_version text NOT NULL, work_bot_id text NOT NULL,work_bot_key text NOT NULL,work_chat_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_card_draft_owner UNIQUE(id,user_id),
 CONSTRAINT expert_card_draft_application_owner_fk FOREIGN KEY(application_id,user_id) REFERENCES expert_onboarding_applications(id,user_id) ON DELETE CASCADE,
 CONSTRAINT expert_card_draft_revision CHECK(coalesce((revision BETWEEN 0 AND 1000000),false)),
 CONSTRAINT expert_card_draft_status CHECK(coalesce((status IN ('collecting','manager_review','changes_requested','approved')),false)),
 CONSTRAINT expert_card_draft_public CHECK(coalesce((public_payload IS NULL OR expert_card_public_payload_valid(public_payload)),false)),
 CONSTRAINT expert_card_draft_approval CHECK(coalesce(((status='approved')=(approved_review_id IS NOT NULL)),false)),
 CONSTRAINT expert_card_draft_scope CHECK(coalesce((work_bot_id ~ '^[1-9][0-9]{0,19}$' AND work_chat_id ~ '^[1-9][0-9]{0,19}$' AND length(work_bot_key) BETWEEN 1 AND 128),false))
);
--> statement-breakpoint
CREATE TABLE expert_card_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),draft_id uuid NOT NULL,user_id uuid NOT NULL,revision integer NOT NULL,
 kind text NOT NULL,text_content text,media_reference text,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_card_entry_owner FOREIGN KEY(draft_id,user_id) REFERENCES expert_card_drafts(id,user_id) ON DELETE CASCADE,
 CONSTRAINT expert_card_entry_value CHECK(coalesce(((kind='text' AND char_length(text_content) BETWEEN 1 AND 4000 AND media_reference IS NULL) OR (kind IN ('photo','document') AND text_content IS NULL AND media_reference IS NOT NULL AND char_length(media_reference) BETWEEN 15 AND 526 AND media_reference ~ '^telegram:file:[A-Za-z0-9_-]+$')),false)),
 CONSTRAINT expert_card_entry_revision CHECK(coalesce((revision BETWEEN 1 AND 1000000),false))
);
--> statement-breakpoint
CREATE TABLE expert_card_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),draft_id uuid NOT NULL,user_id uuid NOT NULL,revision integer NOT NULL,
 action text NOT NULL,public_payload jsonb,public_digest text,manager_id uuid NOT NULL REFERENCES users(id),manager_session_hash text NOT NULL REFERENCES admin_sessions(session_id_hash),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_card_review_owner FOREIGN KEY(draft_id,user_id) REFERENCES expert_card_drafts(id,user_id) ON DELETE CASCADE,
 CONSTRAINT expert_card_review_once UNIQUE(draft_id,revision,action),
 CONSTRAINT expert_card_review_public_identity UNIQUE(id,user_id,revision,public_digest),
 CONSTRAINT expert_card_review_value CHECK(coalesce(((action='approve' AND expert_card_public_payload_valid(public_payload) AND public_digest='sha256:'||encode(digest(public_payload::text,'sha256'),'hex')) OR (action='return_changes' AND public_payload IS NULL AND public_digest IS NULL)),false))
);
--> statement-breakpoint
ALTER TABLE expert_card_drafts ADD CONSTRAINT expert_card_draft_approved_review_fk FOREIGN KEY(approved_review_id) REFERENCES expert_card_reviews(id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TABLE expert_card_material_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),content_version text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'inactive',
 content_slot text NOT NULL DEFAULT 'TODO: Wait for Content Spec',text_body text,assets jsonb NOT NULL DEFAULT '[]'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_card_template_identity UNIQUE(id,content_version),
 CONSTRAINT expert_card_template_value CHECK(coalesce((length(content_version) BETWEEN 1 AND 128 AND jsonb_typeof(assets)='array' AND jsonb_array_length(assets)<=8 AND ((status='inactive' AND text_body IS NULL) OR (status='approved' AND char_length(text_body) BETWEEN 1 AND 4000))),false))
);
--> statement-breakpoint
INSERT INTO expert_card_material_templates(content_version) VALUES('pending-content-v1');
--> statement-breakpoint
CREATE FUNCTION expert_card_delivery_receipt_valid(value jsonb,target_bot text,target_chat text,target_version text,target_digest text,expected integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_typeof(value)='object' AND expert_jsonb_has_exact_keys(value,ARRAY['messageIds','botId','chatId','contentVersion','payloadDigest'])
 AND value->>'botId'=target_bot AND value->>'chatId'=target_chat AND value->>'contentVersion'=target_version AND value->>'payloadDigest'=target_digest
 AND expected BETWEEN 1 AND 9 AND jsonb_typeof(value->'messageIds')='array' AND jsonb_array_length(value->'messageIds')=expected
 AND CASE WHEN jsonb_typeof(value->'messageIds')='array' THEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'messageIds') item WHERE jsonb_typeof(item)<>'string' OR (item#>>'{}') !~ '^[1-9][0-9]{0,19}$') ELSE false END
 AND CASE WHEN jsonb_typeof(value->'messageIds')='array' THEN (SELECT count(DISTINCT item)::integer FROM jsonb_array_elements_text(value->'messageIds') item)=expected ELSE false END,false)
$$;
--> statement-breakpoint
CREATE TABLE expert_card_material_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),draft_id uuid NOT NULL,user_id uuid NOT NULL,review_id uuid NOT NULL REFERENCES expert_card_reviews(id) ON DELETE CASCADE,revision integer NOT NULL,
 template_id uuid,content_version text,attempt_id uuid,attempt_started_at timestamptz,expected_message_count integer,status text NOT NULL DEFAULT 'waiting_content',delivery_receipt jsonb,payload_digest text,delivered_at timestamptz,
 target_bot_id text NOT NULL,target_chat_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_card_material_owner FOREIGN KEY(draft_id,user_id) REFERENCES expert_card_drafts(id,user_id) ON DELETE CASCADE,
 CONSTRAINT expert_card_material_once UNIQUE(review_id),
 CONSTRAINT expert_card_material_template FOREIGN KEY(template_id,content_version) REFERENCES expert_card_material_templates(id,content_version),
 CONSTRAINT expert_card_material_status CHECK(coalesce((status IN ('waiting_content','pending','delivered','cancelled','unknown_outcome')),false)),
 CONSTRAINT expert_card_material_attempt CHECK(coalesce(((attempt_id IS NULL AND attempt_started_at IS NULL) OR (attempt_id IS NOT NULL AND attempt_started_at IS NOT NULL AND isfinite(attempt_started_at))),false)),
 CONSTRAINT expert_card_material_receipt CHECK(coalesce(((status='delivered' AND template_id IS NOT NULL AND content_version IS NOT NULL AND delivered_at IS NOT NULL AND isfinite(delivered_at) AND attempt_id IS NOT NULL AND payload_digest IS NOT NULL AND payload_digest ~ '^sha256:[0-9a-f]{64}$' AND expert_card_delivery_receipt_valid(delivery_receipt,target_bot_id,target_chat_id,content_version,payload_digest,expected_message_count)) OR (status<>'delivered' AND delivery_receipt IS NULL AND delivered_at IS NULL)),false))
);
--> statement-breakpoint
CREATE TABLE expert_card_promo_proofs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),draft_id uuid NOT NULL,user_id uuid NOT NULL,review_id uuid NOT NULL REFERENCES expert_card_reviews(id) ON DELETE CASCADE,revision integer NOT NULL,
 kind text NOT NULL,reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_card_proof_owner FOREIGN KEY(draft_id,user_id) REFERENCES expert_card_drafts(id,user_id) ON DELETE CASCADE,
 CONSTRAINT expert_card_proof_value CHECK(coalesce(((kind='link' AND length(reference) BETWEEN 1 AND 2048 AND reference LIKE 'https://%') OR (kind IN ('photo','document') AND reference IS NOT NULL AND char_length(reference) BETWEEN 15 AND 526 AND reference ~ '^telegram:file:[A-Za-z0-9_-]+$')),false))
);
--> statement-breakpoint
CREATE TABLE expert_card_promo_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),draft_id uuid NOT NULL,user_id uuid NOT NULL,review_id uuid NOT NULL REFERENCES expert_card_reviews(id) ON DELETE CASCADE,revision integer NOT NULL,
 proof_digest text NOT NULL,manager_id uuid NOT NULL REFERENCES users(id),manager_session_hash text NOT NULL REFERENCES admin_sessions(session_id_hash),created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_card_promo_owner FOREIGN KEY(draft_id,user_id) REFERENCES expert_card_drafts(id,user_id) ON DELETE CASCADE,
 CONSTRAINT expert_card_promo_once UNIQUE(review_id,proof_digest),CONSTRAINT expert_card_promo_digest CHECK(coalesce((proof_digest ~ '^sha256:[0-9a-f]{64}$'),false))
);
--> statement-breakpoint
CREATE TABLE expert_card_handoffs (
 token_digest text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),application_id uuid NOT NULL REFERENCES expert_onboarding_applications(id) ON DELETE CASCADE,
 source_bot_key text NOT NULL,external_id text NOT NULL,target_bot_id text NOT NULL,target_bot_key text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT(now()+interval '10 minutes'),consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_card_handoff_digest CHECK(coalesce((token_digest ~ '^sha256:[0-9a-f]{64}$'),false)),
 CONSTRAINT expert_card_handoff_scope CHECK(coalesce((external_id ~ '^[1-9][0-9]{0,19}$' AND target_bot_id ~ '^[1-9][0-9]{0,19}$'),false)),
 CONSTRAINT expert_card_handoff_time CHECK(coalesce((isfinite(expires_at) AND expires_at>created_at AND expires_at<=created_at+interval '10 minutes' AND (consumed_at IS NULL OR isfinite(consumed_at))),false))
);
--> statement-breakpoint
CREATE TABLE expert_card_requests (
 bot_id text NOT NULL,update_id text NOT NULL,user_id uuid REFERENCES users(id),operation text NOT NULL,request_digest text,semantic_digest text,result_id uuid,erased_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(bot_id,update_id),
 CONSTRAINT expert_card_request_scope CHECK(coalesce((bot_id ~ '^[1-9][0-9]{0,19}$' AND update_id ~ '^(0|[1-9][0-9]{0,19})$'),false)),
 CONSTRAINT expert_card_request_digests CHECK(coalesce(((user_id IS NOT NULL AND request_digest ~ '^[0-9a-f]{64}$' AND semantic_digest ~ '^[0-9a-f]{64}$' AND erased_at IS NULL) OR (user_id IS NULL AND request_digest IS NULL AND semantic_digest IS NULL AND result_id IS NULL AND erased_at IS NOT NULL)),false)),
 CONSTRAINT expert_card_request_operation CHECK(coalesce((operation IN ('entry','submit','promo_proof','handoff_issue','handoff_redeem','main_quote','main_accept','main_checkout')),false))
);
--> statement-breakpoint
CREATE TABLE expert_card_staff_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),manager_id uuid NOT NULL REFERENCES users(id),idempotency_key text NOT NULL,draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 operation text NOT NULL,semantic_digest text NOT NULL,result_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_card_staff_request UNIQUE(manager_id,idempotency_key),CONSTRAINT expert_card_staff_value CHECK(coalesce((operation IN ('edit_public','approve','return_changes','confirm_promo') AND semantic_digest ~ '^[0-9a-f]{64}$' AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),false))
);
--> statement-breakpoint
CREATE FUNCTION expert_card_proof_digest(target_draft uuid,target_review uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT 'sha256:'||encode(digest(coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'reference',reference) ORDER BY id)::text,'[]'),'sha256'),'hex') FROM expert_card_promo_proofs WHERE draft_id=target_draft AND review_id=target_review
$$;
--> statement-breakpoint
CREATE FUNCTION expert_card_current_messaging_authority(target_user uuid,target_policy text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM consent_states s JOIN consents c ON c.id=s.last_decision_id AND c.user_id=s.user_id AND c.consent_type=s.purpose AND c.decision='granted'
 JOIN consent_document_versions d ON d.id=c.document_version_id AND d.id=s.document_version_id
 JOIN consent_presentations p ON p.id=c.presentation_id AND p.user_id=c.user_id AND p.purpose=c.consent_type AND p.document_version_id=d.id AND p.channel=c.channel
 WHERE s.user_id=target_user AND s.purpose='client_messaging' AND s.decision='granted' AND s.revision>0
 AND c.policy_version=target_policy AND c.basis='consent' AND c.scope_fields='{}'::jsonb AND c.recipient_id IS NULL AND c.reservation_id IS NULL AND c.text_sha256=d.text_sha256
 AND d.document_key='consent.client_messaging' AND d.status='approved' AND d.effective_at<=clock_timestamp()
 AND d.version=(SELECT max(candidate.version) FROM consent_document_versions candidate WHERE candidate.document_key=d.document_key AND candidate.status='approved' AND candidate.effective_at<=clock_timestamp())
 AND (c.policy_version='client-messaging-v'||d.version::text OR c.policy_version='messaging-v'||d.version::text)
 AND p.consumed_at IS NOT NULL AND p.invalidated_at IS NULL AND p.consumed_at>=p.created_at AND p.consumed_at<p.expires_at AND c.created_at>=p.created_at
 AND c.created_at=(SELECT max(candidate.created_at) FROM consents candidate WHERE candidate.user_id=c.user_id AND candidate.consent_type=c.consent_type)
 AND coalesce((SELECT bool_and(latest.decision='granted' AND latest.policy_version=target_policy) FROM consents latest WHERE latest.user_id=target_user AND latest.consent_type='client_messaging' AND latest.created_at=c.created_at),false))
$$;
--> statement-breakpoint
CREATE TABLE expert_card_consent_epoch (
 id integer PRIMARY KEY DEFAULT 1,revision bigint NOT NULL DEFAULT 1,
 CONSTRAINT expert_card_consent_epoch_singleton CHECK(coalesce(id=1 AND revision>0,false))
);
--> statement-breakpoint
INSERT INTO expert_card_consent_epoch(id,revision) VALUES(1,1);
--> statement-breakpoint
CREATE FUNCTION advance_expert_card_consent_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE expert_card_consent_epoch SET revision=revision+1 WHERE id=1; RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER expert_card_consent_document_epoch AFTER INSERT ON consent_document_versions FOR EACH ROW WHEN (NEW.document_key='consent.client_messaging' AND NEW.status='approved') EXECUTE FUNCTION advance_expert_card_consent_epoch();
--> statement-breakpoint
CREATE FUNCTION expert_card_activation_gate_valid(target_user uuid,target_review uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 WITH authority_epoch AS MATERIALIZED (SELECT revision FROM expert_card_consent_epoch WHERE id=1 FOR SHARE)
 SELECT EXISTS(SELECT 1 FROM authority_epoch CROSS JOIN expert_card_drafts d JOIN users u ON u.id=d.user_id AND u.active=true
 JOIN expert_onboarding_applications a ON a.id=d.application_id AND a.user_id=d.user_id AND a.verification_status='approved'
 JOIN expert_onboarding_invoices i ON i.application_id=a.id AND i.user_id=d.user_id AND i.purpose='onboarding' AND i.status='settled'
 JOIN expert_onboarding_payment_facts f ON f.invoice_id=i.id AND f.user_id=d.user_id AND f.admission='interview'
 JOIN expert_card_reviews r ON r.id=d.approved_review_id AND r.draft_id=d.id AND r.user_id=d.user_id AND r.revision=d.revision AND r.action='approve' AND r.public_payload=d.public_payload
 JOIN expert_card_material_jobs j ON j.review_id=r.id AND j.draft_id=d.id AND j.user_id=d.user_id AND j.revision=d.revision AND j.status='delivered' AND j.delivery_receipt IS NOT NULL AND j.target_bot_id=d.work_bot_id AND j.target_chat_id=d.work_chat_id
 JOIN expert_card_material_templates t ON t.id=j.template_id AND t.content_version=j.content_version AND t.status='approved' AND j.expected_message_count=1+jsonb_array_length(t.assets)
 JOIN expert_card_promo_confirmations p ON p.review_id=r.id AND p.draft_id=d.id AND p.user_id=d.user_id AND p.revision=d.revision AND p.proof_digest=expert_card_proof_digest(d.id,r.id)
 WHERE d.user_id=target_user AND r.id=target_review AND d.status='approved' AND expert_card_current_messaging_authority(d.user_id,d.messaging_policy_version)
 AND EXISTS(SELECT 1 FROM channel_identities ci WHERE ci.user_id=d.user_id AND ci.provider='telegram' AND ci.bot_key=d.work_bot_key AND ci.external_id=d.work_chat_id AND ci.external_chat_id=d.work_chat_id AND ci.status='active')
 AND EXISTS(SELECT 1 FROM expert_card_promo_proofs proof WHERE proof.review_id=r.id AND proof.draft_id=d.id))
$$;

--> statement-breakpoint
CREATE FUNCTION expert_card_manager_authority_valid(target_manager uuid,target_session text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_role_assignments r ON r.admin_id=s.admin_id AND r.role IN ('support','security_admin') JOIN users u ON u.id=s.admin_id AND u.active
 WHERE s.admin_id=target_manager AND s.session_id_hash=target_session AND s.revoked_at IS NULL AND isfinite(s.expires_at) AND isfinite(s.mfa_verified_at)
 AND s.expires_at>clock_timestamp() AND s.mfa_verified_at<=clock_timestamp() AND s.mfa_verified_at>=clock_timestamp()-interval '15 minutes')
$$;
--> statement-breakpoint
CREATE FUNCTION enforce_expert_card_review_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM admin_sessions s JOIN admin_role_assignments r ON r.admin_id=s.admin_id AND r.role IN ('support','security_admin') WHERE s.admin_id=NEW.manager_id AND s.session_id_hash=NEW.manager_session_hash FOR SHARE OF s,r;
 IF NOT FOUND OR NOT expert_card_manager_authority_valid(NEW.manager_id,NEW.manager_session_hash) OR NOT EXISTS(
 SELECT 1 FROM expert_card_drafts d WHERE d.id=NEW.draft_id AND d.user_id=NEW.user_id AND d.revision=NEW.revision
 AND ((NEW.action='approve' AND d.status='manager_review' AND d.public_payload=NEW.public_payload) OR (NEW.action='return_changes' AND d.status IN ('manager_review','approved')))
 AND expert_card_current_messaging_authority(d.user_id,d.messaging_policy_version)) THEN
 RAISE EXCEPTION 'expert_card_review_source' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_card_review_source BEFORE INSERT ON expert_card_reviews FOR EACH ROW EXECUTE FUNCTION enforce_expert_card_review_source();
--> statement-breakpoint
CREATE FUNCTION enforce_expert_card_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='expert_card_requests' THEN
   IF NEW.user_id IS NULL AND NEW.request_digest IS NULL AND NEW.semantic_digest IS NULL AND NEW.result_id IS NULL AND NEW.erased_at IS NOT NULL
   AND OLD.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND active)
   AND (to_jsonb(NEW)-ARRAY['user_id','request_digest','semantic_digest','result_id','erased_at'])=(to_jsonb(OLD)-ARRAY['user_id','request_digest','semantic_digest','result_id','erased_at']) THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='expert_card_handoffs' THEN
   IF OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND (to_jsonb(NEW)-'consumed_at')=(to_jsonb(OLD)-'consumed_at') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'expert_card_immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_card_requests_immutable BEFORE UPDATE ON expert_card_requests FOR EACH ROW EXECUTE FUNCTION enforce_expert_card_immutable();
--> statement-breakpoint
CREATE TRIGGER expert_card_requests_no_delete BEFORE DELETE ON expert_card_requests FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER expert_card_handoffs_immutable BEFORE UPDATE ON expert_card_handoffs FOR EACH ROW EXECUTE FUNCTION enforce_expert_card_immutable();
--> statement-breakpoint
CREATE TRIGGER expert_card_entries_immutable BEFORE UPDATE ON expert_card_entries FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER expert_card_reviews_immutable BEFORE UPDATE ON expert_card_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER expert_card_proofs_immutable BEFORE UPDATE ON expert_card_promo_proofs FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER expert_card_promoconfirm_immutable BEFORE UPDATE ON expert_card_promo_confirmations FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER expert_card_staff_actions_immutable BEFORE UPDATE ON expert_card_staff_actions FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER expert_card_material_templates_immutable BEFORE UPDATE OR DELETE ON expert_card_material_templates FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

--> statement-breakpoint
-- Block C financial supplement: append after card tables and activation gate.
ALTER TABLE experts ADD CONSTRAINT experts_id_user_unique UNIQUE(id,user_id);
--> statement-breakpoint
ALTER TABLE expert_promo_registrations ADD CONSTRAINT expert_promo_registration_owner_unique UNIQUE(user_id,referrer_user_id);
--> statement-breakpoint
CREATE TABLE expert_card_main_acceptances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 application_id uuid REFERENCES expert_onboarding_applications(id) ON DELETE SET NULL,
 application_audit_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id),
 expert_id uuid NOT NULL,
 review_id uuid REFERENCES expert_card_reviews(id) ON DELETE SET NULL,
 review_audit_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 public_digest text NOT NULL CHECK(public_digest ~ '^sha256:[0-9a-f]{64}$'),
 quote_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_card_acceptance_owner_fk FOREIGN KEY(expert_id,user_id) REFERENCES experts(id,user_id),
 CONSTRAINT expert_card_acceptance_quote_fk FOREIGN KEY(quote_id,user_id) REFERENCES expert_campaign_quotes(id,user_id),
 CONSTRAINT expert_card_acceptance_once UNIQUE(user_id,review_audit_id,quote_id),
 CONSTRAINT expert_card_acceptance_identity UNIQUE(id,user_id,expert_id,quote_id),
 CONSTRAINT expert_card_acceptance_live CHECK((application_id IS NULL OR application_id=application_audit_id) AND (review_id IS NULL OR review_id=review_audit_id))
);
--> statement-breakpoint
CREATE TABLE expert_card_main_orders (
 order_id uuid PRIMARY KEY,
 acceptance_id uuid NOT NULL UNIQUE,
 application_id uuid REFERENCES expert_onboarding_applications(id) ON DELETE SET NULL,
 application_audit_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id),
 expert_id uuid NOT NULL,
 quote_id uuid NOT NULL,
 review_id uuid REFERENCES expert_card_reviews(id) ON DELETE SET NULL,
 review_audit_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 public_digest text NOT NULL CHECK(public_digest ~ '^sha256:[0-9a-f]{64}$'),
 purpose text NOT NULL DEFAULT 'main_residency' CHECK(purpose='main_residency'),
 provider_mode text NOT NULL CHECK(provider_mode IN ('test','live')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_card_main_order_owner_fk FOREIGN KEY(order_id,expert_id) REFERENCES expert_residency_orders(id,expert_id),
 CONSTRAINT expert_card_main_order_acceptance_fk FOREIGN KEY(acceptance_id,user_id,expert_id,quote_id) REFERENCES expert_card_main_acceptances(id,user_id,expert_id,quote_id),
 CONSTRAINT expert_card_main_order_identity UNIQUE(order_id,user_id,expert_id),
 CONSTRAINT expert_card_main_order_live CHECK((application_id IS NULL OR application_id=application_audit_id) AND (review_id IS NULL OR review_id=review_audit_id))
);
--> statement-breakpoint
CREATE TABLE expert_promo_qualification_audits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 main_order_id uuid NOT NULL UNIQUE,
 invitee_user_id uuid NOT NULL,
 inviter_user_id uuid NOT NULL,
 invitee_expert_id uuid NOT NULL,
 inviter_expert_id uuid NOT NULL,
 provider_event_id uuid NOT NULL UNIQUE REFERENCES expert_residency_provider_event_inbox(id),
 qualified_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_promo_qualification_registration_fk FOREIGN KEY(invitee_user_id,inviter_user_id) REFERENCES expert_promo_registrations(user_id,referrer_user_id),
 CONSTRAINT expert_promo_qualification_order_fk FOREIGN KEY(main_order_id,invitee_user_id,invitee_expert_id) REFERENCES expert_card_main_orders(order_id,user_id,expert_id),
 CONSTRAINT expert_promo_qualification_inviter_fk FOREIGN KEY(inviter_expert_id,inviter_user_id) REFERENCES experts(id,user_id),
 CONSTRAINT expert_promo_qualification_distinct CHECK(invitee_user_id<>inviter_user_id AND invitee_expert_id<>inviter_expert_id),
 CONSTRAINT expert_promo_qualification_identity UNIQUE(id,invitee_expert_id,inviter_expert_id)
);
--> statement-breakpoint
ALTER TABLE expert_referrals ALTER COLUMN code_id DROP NOT NULL,
 ADD COLUMN acquisition_source text NOT NULL DEFAULT 'qualified_code',
 ADD COLUMN promo_qualification_id uuid,
 ADD CONSTRAINT expert_referrals_source CHECK(
 (acquisition_source='qualified_code' AND code_id IS NOT NULL AND promo_qualification_id IS NULL)
 OR (acquisition_source='promo_registration' AND code_id IS NULL AND promo_qualification_id IS NOT NULL)),
 ADD CONSTRAINT expert_referrals_promo_qualification_unique UNIQUE(promo_qualification_id),
 ADD CONSTRAINT expert_referrals_promo_qualification_fk FOREIGN KEY(promo_qualification_id,invitee_expert_id,inviter_expert_id) REFERENCES expert_promo_qualification_audits(id,invitee_expert_id,inviter_expert_id);
--> statement-breakpoint
CREATE TABLE experts_published (
 expert_id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 application_audit_id uuid NOT NULL,
 draft_id uuid REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 review_id uuid REFERENCES expert_card_reviews(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision>0),
 public_payload jsonb NOT NULL,
 public_digest text NOT NULL CHECK(public_digest ~ '^sha256:[0-9a-f]{64}$'),
 paid_order_id uuid NOT NULL,
 next_billing_date timestamptz NOT NULL CHECK(isfinite(next_billing_date)),
 active boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT experts_published_owner_fk FOREIGN KEY(expert_id,user_id) REFERENCES experts(id,user_id),
 CONSTRAINT experts_published_paid_order_fk FOREIGN KEY(paid_order_id,expert_id) REFERENCES expert_residency_orders(id,expert_id)
);
--> statement-breakpoint
CREATE FUNCTION protect_expert_card_financial_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'expert_card_financial_immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME IN ('expert_card_main_acceptances','expert_card_main_orders')
   AND (to_jsonb(NEW)-ARRAY['application_id','review_id'])=(to_jsonb(OLD)-ARRAY['application_id','review_id'])
   AND (NEW.application_id IS NOT DISTINCT FROM OLD.application_id OR NEW.application_id IS NULL)
   AND (NEW.review_id IS NOT DISTINCT FROM OLD.review_id OR NEW.review_id IS NULL) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'expert_card_financial_immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_card_main_acceptance_immutable BEFORE UPDATE OR DELETE ON expert_card_main_acceptances FOR EACH ROW EXECUTE FUNCTION protect_expert_card_financial_binding();
--> statement-breakpoint
CREATE TRIGGER expert_card_main_order_immutable BEFORE UPDATE OR DELETE ON expert_card_main_orders FOR EACH ROW EXECUTE FUNCTION protect_expert_card_financial_binding();
--> statement-breakpoint
CREATE TRIGGER expert_promo_qualification_immutable BEFORE UPDATE OR DELETE ON expert_promo_qualification_audits FOR EACH ROW EXECUTE FUNCTION protect_expert_card_financial_binding();
--> statement-breakpoint
CREATE FUNCTION enforce_expert_card_main_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.application_id IS NULL OR NEW.review_id IS NULL OR NOT expert_card_activation_gate_valid(NEW.user_id,NEW.review_id)
 OR NOT EXISTS(SELECT 1 FROM expert_card_drafts d JOIN expert_card_reviews r ON r.id=d.approved_review_id
   JOIN expert_campaign_quotes q ON q.id=NEW.quote_id AND q.user_id=NEW.user_id
   JOIN experts e ON e.id=NEW.expert_id AND e.user_id=NEW.user_id
   WHERE d.application_id=NEW.application_id AND d.user_id=NEW.user_id AND r.id=NEW.review_id
     AND r.revision=NEW.revision AND r.public_digest=NEW.public_digest AND q.quoted_at<=clock_timestamp() AND q.expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'expert_card_main_acceptance_source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_card_main_acceptance_source BEFORE INSERT ON expert_card_main_acceptances FOR EACH ROW EXECUTE FUNCTION enforce_expert_card_main_acceptance();
--> statement-breakpoint
CREATE FUNCTION enforce_expert_card_main_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM expert_card_main_acceptances a JOIN expert_residency_orders o
   ON o.id=NEW.order_id AND o.expert_id=a.expert_id AND o.campaign_quote_id=a.quote_id
   WHERE a.id=NEW.acceptance_id AND a.user_id=NEW.user_id AND a.expert_id=NEW.expert_id AND a.quote_id=NEW.quote_id
     AND a.application_audit_id=NEW.application_audit_id AND a.review_audit_id=NEW.review_audit_id
     AND a.revision=NEW.revision AND a.public_digest=NEW.public_digest AND NEW.application_id=a.application_id
     AND NEW.review_id=a.review_id AND expert_card_activation_gate_valid(a.user_id,a.review_id)) THEN
  RAISE EXCEPTION 'expert_card_main_order_source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_card_main_order_source BEFORE INSERT ON expert_card_main_orders FOR EACH ROW EXECUTE FUNCTION enforce_expert_card_main_order();
--> statement-breakpoint
CREATE FUNCTION enforce_expert_promo_qualification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity_count integer; invitee_identity text; inviter_identity text;
BEGIN
 IF EXISTS(SELECT 1 FROM expert_first_residency_settlements WHERE expert_id=NEW.invitee_expert_id)
 OR EXISTS(SELECT 1 FROM expert_referrals WHERE invitee_expert_id=NEW.invitee_expert_id)
 OR NOT EXISTS(SELECT 1 FROM expert_card_main_orders m JOIN expert_residency_orders o ON o.id=m.order_id
   JOIN expert_residency_provider_event_inbox p ON p.id=NEW.provider_event_id AND p.order_id=o.id AND p.event_kind='settled'
     AND p.authenticated=true AND p.status='processing' AND p.identity_version=1 AND p.amount_minor=o.cash_minor AND p.currency=o.currency
   JOIN expert_residency_provider_operations po ON po.order_id=o.id AND po.operation_kind='create_payment' AND po.environment_mode=m.provider_mode
     AND po.provider_object_id=p.payment_id AND po.amount_minor=p.amount_minor AND po.currency=p.currency AND po.status IN('pending','unknown_outcome','succeeded')
   JOIN experts ie ON ie.id=NEW.invitee_expert_id AND ie.user_id=NEW.invitee_user_id AND ie.active AND ie.verified
   JOIN experts ir ON ir.id=NEW.inviter_expert_id AND ir.user_id=NEW.inviter_user_id AND ir.active AND ir.verified
   JOIN users ue ON ue.id=ie.user_id AND ue.active JOIN users ur ON ur.id=ir.user_id AND ur.active
   WHERE m.order_id=NEW.main_order_id AND m.user_id=NEW.invitee_user_id AND m.expert_id=NEW.invitee_expert_id
     AND p.provider='yookassa' AND expert_card_activation_gate_valid(m.user_id,m.review_id)
     AND o.status='payment_pending' AND o.payment_deadline>clock_timestamp())
 OR EXISTS(SELECT 1 FROM expert_referral_abuse_holds WHERE expert_id IN(NEW.invitee_expert_id,NEW.inviter_expert_id) AND status='open') THEN
  RAISE EXCEPTION 'expert_promo_qualification_source' USING ERRCODE='23514';
 END IF;
 SELECT count(DISTINCT external_id),min(external_id) INTO identity_count,invitee_identity FROM channel_identities
 WHERE user_id=NEW.invitee_user_id AND provider='telegram' AND status='active' AND external_chat_id=external_id;
 IF identity_count<>1 THEN RAISE EXCEPTION 'expert_promo_qualification_identity' USING ERRCODE='23514'; END IF;
 SELECT count(DISTINCT external_id),min(external_id) INTO identity_count,inviter_identity FROM channel_identities
 WHERE user_id=NEW.inviter_user_id AND provider='telegram' AND status='active' AND external_chat_id=external_id;
 IF identity_count<>1 OR inviter_identity=invitee_identity THEN RAISE EXCEPTION 'expert_promo_qualification_identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_promo_qualification_source BEFORE INSERT ON expert_promo_qualification_audits FOR EACH ROW EXECUTE FUNCTION enforce_expert_promo_qualification();
--> statement-breakpoint
CREATE FUNCTION enforce_expert_promo_referral_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.acquisition_source='promo_registration' AND NOT EXISTS(
   SELECT 1 FROM expert_promo_qualification_audits a JOIN expert_promo_registrations r ON r.user_id=a.invitee_user_id AND r.referrer_user_id=a.inviter_user_id
   JOIN expert_residency_provider_event_inbox p ON p.id=a.provider_event_id AND p.status='processing' AND p.authenticated AND p.event_kind='settled'
   JOIN expert_residency_orders o ON o.id=a.main_order_id AND o.status='payment_pending' AND o.payment_deadline>clock_timestamp()
   JOIN experts ie ON ie.id=a.invitee_expert_id AND ie.user_id=a.invitee_user_id AND ie.active AND ie.verified
   JOIN experts ir ON ir.id=a.inviter_expert_id AND ir.user_id=a.inviter_user_id AND ir.active AND ir.verified
   JOIN users ue ON ue.id=ie.user_id AND ue.active JOIN users ur ON ur.id=ir.user_id AND ur.active
   WHERE a.id=NEW.promo_qualification_id AND a.invitee_expert_id=NEW.invitee_expert_id AND a.inviter_expert_id=NEW.inviter_expert_id AND r.erased_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds WHERE expert_id IN(a.invitee_expert_id,a.inviter_expert_id) AND status='open')
     AND (SELECT count(DISTINCT external_id)=1 FROM channel_identities WHERE user_id=a.invitee_user_id AND provider='telegram' AND status='active' AND external_chat_id=external_id)
     AND (SELECT count(DISTINCT external_id)=1 FROM channel_identities WHERE user_id=a.inviter_user_id AND provider='telegram' AND status='active' AND external_chat_id=external_id)
     AND (SELECT min(external_id) FROM channel_identities WHERE user_id=a.invitee_user_id AND provider='telegram' AND status='active' AND external_chat_id=external_id) IS DISTINCT FROM (SELECT min(external_id) FROM channel_identities WHERE user_id=a.inviter_user_id AND provider='telegram' AND status='active' AND external_chat_id=external_id)
     AND NOT EXISTS(SELECT 1 FROM expert_first_residency_settlements WHERE expert_id=NEW.invitee_expert_id)) THEN
  RAISE EXCEPTION 'expert_promo_referral_source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_promo_referral_source BEFORE INSERT ON expert_referrals FOR EACH ROW EXECUTE FUNCTION enforce_expert_promo_referral_source();
--> statement-breakpoint
CREATE FUNCTION enforce_expert_published_card_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NOT NEW.active AND (to_jsonb(NEW)-ARRAY['active','updated_at'])=(to_jsonb(OLD)-ARRAY['active','updated_at']) THEN RETURN NEW; END IF;
 IF NEW.draft_id IS NULL OR NEW.review_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM experts e JOIN users u ON u.id=e.user_id AND u.active JOIN expert_card_reviews r ON r.id=NEW.review_id
   JOIN expert_card_drafts d ON d.id=NEW.draft_id AND d.approved_review_id=r.id AND d.revision=r.revision
   JOIN expert_residency_orders o ON o.id=NEW.paid_order_id AND o.expert_id=e.id AND o.status='settled'
   JOIN expert_card_main_orders m ON m.order_id=o.id AND m.expert_id=e.id AND m.user_id=NEW.user_id AND m.review_id=r.id AND m.revision=NEW.revision AND m.public_digest=NEW.public_digest
   WHERE expert_card_activation_gate_valid(NEW.user_id,NEW.review_id) AND e.id=NEW.expert_id AND e.user_id=NEW.user_id AND e.active AND e.verified AND d.user_id=e.user_id
     AND d.application_id=NEW.application_audit_id AND r.action='approve' AND r.revision=NEW.revision
     AND r.public_digest=NEW.public_digest AND r.public_payload=NEW.public_payload AND o.residency_ends_at=NEW.next_billing_date)
 OR (NEW.active AND (NEW.next_billing_date<=clock_timestamp() OR NOT EXISTS(
   SELECT 1 FROM expert_residency_orders o WHERE o.expert_id=NEW.expert_id AND o.status='settled' AND o.residency_starts_at<=clock_timestamp() AND o.residency_ends_at>clock_timestamp()))) THEN
  RAISE EXCEPTION 'expert_published_card_source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_published_card_source BEFORE INSERT OR UPDATE ON experts_published FOR EACH ROW EXECUTE FUNCTION enforce_expert_published_card_source();
--> statement-breakpoint
-- Preserve all legacy snapshot/TTL checks; only exact accepted main-card admission is additive.
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
  PERFORM 1 FROM users WHERE id=quote.user_id AND active=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expert_campaign_order_source' USING ERRCODE='23514'; END IF;
  SELECT * INTO expert FROM experts WHERE id=NEW.expert_id FOR SHARE;
  IF NOT FOUND OR expert.user_id IS DISTINCT FROM quote.user_id OR (
    (NOT expert.active OR NOT expert.verified) AND NOT EXISTS(
      SELECT 1 FROM expert_card_main_acceptances a WHERE a.expert_id=NEW.expert_id AND a.user_id=quote.user_id
        AND a.quote_id=quote.id AND a.application_id IS NOT NULL AND a.review_id IS NOT NULL
        AND expert_card_activation_gate_valid(a.user_id,a.review_id))) THEN
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
CREATE FUNCTION enforce_expert_card_promo_confirmation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM admin_sessions s JOIN admin_role_assignments r ON r.admin_id=s.admin_id AND r.role IN ('support','security_admin') WHERE s.admin_id=NEW.manager_id AND s.session_id_hash=NEW.manager_session_hash FOR SHARE OF s,r;
 IF NOT FOUND OR NOT expert_card_manager_authority_valid(NEW.manager_id,NEW.manager_session_hash) OR NOT EXISTS(
 SELECT 1 FROM expert_card_drafts d JOIN users u ON u.id=d.user_id AND u.active
 JOIN expert_card_reviews r ON r.id=d.approved_review_id AND r.draft_id=d.id AND r.user_id=d.user_id AND r.revision=d.revision AND r.action='approve'
 JOIN expert_card_material_jobs j ON j.review_id=r.id AND j.draft_id=d.id AND j.user_id=d.user_id AND j.revision=d.revision AND j.status='delivered'
 JOIN expert_card_material_templates t ON t.id=j.template_id AND t.content_version=j.content_version AND t.status='approved'
 WHERE d.id=NEW.draft_id AND d.user_id=NEW.user_id AND d.status='approved' AND r.id=NEW.review_id AND d.revision=NEW.revision
 AND NEW.proof_digest=expert_card_proof_digest(d.id,r.id) AND EXISTS(SELECT 1 FROM expert_card_promo_proofs p WHERE p.review_id=r.id AND p.draft_id=d.id)
 AND j.target_bot_id=d.work_bot_id AND j.target_chat_id=d.work_chat_id AND j.expected_message_count=1+jsonb_array_length(t.assets)
 AND expert_card_current_messaging_authority(d.user_id,d.messaging_policy_version)) THEN RAISE EXCEPTION 'expert_card_promo_confirmation_source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_card_promo_confirmation_source BEFORE INSERT ON expert_card_promo_confirmations FOR EACH ROW EXECUTE FUNCTION enforce_expert_card_promo_confirmation_source();
--> statement-breakpoint
CREATE FUNCTION enforce_expert_card_draft_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.application_id,NEW.user_id,NEW.work_bot_id,NEW.work_bot_key,NEW.work_chat_id) IS DISTINCT FROM ROW(OLD.id,OLD.application_id,OLD.user_id,OLD.work_bot_id,OLD.work_bot_key,OLD.work_chat_id)
 OR NEW.revision<OLD.revision OR NEW.revision>OLD.revision+1 THEN RAISE EXCEPTION 'expert_card_draft_identity' USING ERRCODE='23514'; END IF;
 IF NEW.approved_review_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM expert_card_reviews r WHERE r.id=NEW.approved_review_id AND r.draft_id=NEW.id AND r.user_id=NEW.user_id AND r.revision=NEW.revision AND r.action='approve' AND r.public_payload=NEW.public_payload) THEN
 RAISE EXCEPTION 'expert_card_draft_review_identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_card_draft_identity BEFORE UPDATE ON expert_card_drafts FOR EACH ROW EXECUTE FUNCTION enforce_expert_card_draft_identity();
