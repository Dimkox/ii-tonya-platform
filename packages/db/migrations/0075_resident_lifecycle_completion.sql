-- Private workflow state only. No financial interval, review or migration history rewrite.
CREATE TABLE resident_lifecycle_subjects (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 expert_id uuid UNIQUE REFERENCES experts(id),
 activation_kind text CHECK (activation_kind IN ('observed_baseline','first_projection')),
 activation_order_id uuid REFERENCES expert_residency_orders(id),
 activated_at timestamptz,
 observed_at timestamptz,
 first_main_invoice_order_id uuid REFERENCES expert_residency_orders(id),
 first_main_invoice_at timestamptz,
 CONSTRAINT resident_first_main_invoice_shape CHECK((first_main_invoice_order_id IS NULL)=(first_main_invoice_at IS NULL) AND (first_main_invoice_at IS NULL OR isfinite(first_main_invoice_at))),
 last_scanned_at timestamptz NOT NULL DEFAULT '-infinity',
 CONSTRAINT resident_lifecycle_subject_owner FOREIGN KEY(expert_id,user_id) REFERENCES experts(id,user_id),
 CONSTRAINT resident_lifecycle_activation_shape CHECK (coalesce(
  (activation_kind IS NULL AND activation_order_id IS NULL AND activated_at IS NULL AND observed_at IS NULL) OR
  (activation_kind='observed_baseline' AND expert_id IS NOT NULL AND activation_order_id IS NULL AND activated_at IS NULL AND observed_at IS NOT NULL AND isfinite(observed_at)) OR
  (activation_kind='first_projection' AND expert_id IS NOT NULL AND activated_at IS NOT NULL AND isfinite(activated_at) AND observed_at IS NULL AND activation_order_id IS NOT NULL),false))
);
--> statement-breakpoint
INSERT INTO resident_lifecycle_subjects(user_id,expert_id,activation_kind,observed_at)
 SELECT user_id,expert_id,'observed_baseline',clock_timestamp() FROM experts_published;
INSERT INTO resident_lifecycle_subjects(user_id) SELECT user_id FROM expert_card_drafts ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE resident_work_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES resident_lifecycle_subjects(user_id) ON DELETE CASCADE,
 draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('card_approved','card_returned','first_activation')),
 review_id uuid REFERENCES expert_card_reviews(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','unknown','delivered','cancelled')),
 target_bot_id text NOT NULL,
 target_bot_key text NOT NULL,
 target_chat_id text NOT NULL,
 identity_id uuid NOT NULL REFERENCES channel_identities(id) ON DELETE CASCADE,
 consent_authority jsonb NOT NULL,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 last_attempt_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT resident_work_notice_owner FOREIGN KEY(draft_id,user_id) REFERENCES expert_card_drafts(id,user_id) ON DELETE CASCADE,
 CONSTRAINT resident_work_notice_source CHECK((kind='first_activation')=(review_id IS NULL)),
 CONSTRAINT resident_work_notice_route CHECK(target_bot_id ~ '^[1-9][0-9]{0,15}$' AND target_chat_id ~ '^[1-9][0-9]{0,15}$' AND length(target_bot_key) BETWEEN 1 AND 128),
 CONSTRAINT resident_work_notice_attempt CHECK((attempt_count=0)=(last_attempt_id IS NULL)),
 CONSTRAINT resident_work_notice_time CHECK(isfinite(created_at) AND isfinite(available_at))
);
CREATE UNIQUE INDEX resident_work_notice_review_unique ON resident_work_notices(review_id,kind) WHERE review_id IS NOT NULL;
CREATE UNIQUE INDEX resident_work_notice_activation_unique ON resident_work_notices(user_id) WHERE kind='first_activation';
CREATE INDEX resident_work_notice_due ON resident_work_notices(available_at,id) WHERE state='pending';
--> statement-breakpoint
CREATE TABLE resident_work_notice_attempts (
 id uuid PRIMARY KEY,
 notice_id uuid NOT NULL REFERENCES resident_work_notices(id) ON DELETE CASCADE,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 3),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^sha256:[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'unknown' CHECK(state IN ('unknown','not_applied','delivered','cancelled')),
 receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT resident_work_attempt_sequence UNIQUE(notice_id,sequence),
 CONSTRAINT resident_work_attempt_owner UNIQUE(notice_id,id,sequence),
 CONSTRAINT resident_work_attempt_receipt CHECK((state='delivered')=(receipt IS NOT NULL))
);
ALTER TABLE resident_work_notices ADD CONSTRAINT resident_work_last_attempt FOREIGN KEY(id,last_attempt_id,attempt_count) REFERENCES resident_work_notice_attempts(notice_id,id,sequence) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TABLE resident_work_bot_state (
 bot_key text PRIMARY KEY CHECK(length(bot_key) BETWEEN 1 AND 128),
 not_before timestamptz NOT NULL DEFAULT '-infinity',
 paused boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE TABLE resident_lifecycle_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES resident_lifecycle_subjects(user_id) ON DELETE CASCADE,
 application_id uuid REFERENCES expert_onboarding_applications(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('materials_missing','promotion_overdue','main_payment_overdue','payment_reconciliation','quality_window','notice_unknown')),
 generation text NOT NULL CHECK(length(generation) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','no_action')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 due_at timestamptz,
 window_start timestamptz,
 window_end timestamptz,
 numerator integer,
 denominator integer,
 missing_provenance integer,
 resolution text CHECK(length(resolution) BETWEEN 1 AND 2000),
 manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
 command_key text,
 resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT resident_lifecycle_case_owner FOREIGN KEY(application_id,user_id) REFERENCES expert_onboarding_applications(id,user_id) ON DELETE CASCADE,
 CONSTRAINT resident_lifecycle_case_generation UNIQUE(user_id,kind,generation),
 CONSTRAINT resident_lifecycle_case_quality CHECK(coalesce(
  (kind='quality_window' AND window_start IS NOT NULL AND window_end IS NOT NULL AND isfinite(window_start) AND isfinite(window_end) AND window_start<window_end AND numerator>=0 AND denominator>=numerator AND missing_provenance>=0) OR
  (kind<>'quality_window' AND window_start IS NULL AND window_end IS NULL AND numerator IS NULL AND denominator IS NULL AND missing_provenance IS NULL),false)),
 CONSTRAINT resident_lifecycle_case_resolution CHECK((status='resolved')=(resolved_at IS NOT NULL)),
 CONSTRAINT resident_lifecycle_case_time CHECK(isfinite(created_at) AND (due_at IS NULL OR isfinite(due_at)))
);
CREATE INDEX resident_lifecycle_case_queue ON resident_lifecycle_cases(created_at,id) WHERE status='open';
CREATE INDEX resident_lifecycle_subject_scan ON resident_lifecycle_subjects(last_scanned_at,user_id);
CREATE INDEX resident_quality_reservations ON reservations(expert_id,created_at,id);
CREATE INDEX resident_quality_audit ON audit_events(object_id,action,actor_id) WHERE object_type='reservation' AND action IN ('reservation.reserve','reservation.expert_cancel');
--> statement-breakpoint
CREATE FUNCTION resident_lifecycle_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='resident_lifecycle_subjects' THEN
  IF TG_OP='UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR (OLD.first_main_invoice_at IS NOT NULL AND (NEW.first_main_invoice_at,NEW.first_main_invoice_order_id) IS DISTINCT FROM (OLD.first_main_invoice_at,OLD.first_main_invoice_order_id))) THEN RAISE EXCEPTION 'resident_first_invoice_immutable' USING ERRCODE='23514'; END IF;
  IF NEW.first_main_invoice_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.first_main_invoice_at IS NULL) AND NOT EXISTS(SELECT 1 FROM expert_personal_offer_state st JOIN expert_card_main_orders m ON m.order_id=st.order_id AND m.user_id=NEW.user_id JOIN expert_residency_orders o ON o.id=m.order_id JOIN expert_residency_provider_operations op ON op.order_id=o.id AND op.operation_kind='create_payment' AND op.provider_object_id=st.payment_id AND op.amount_minor=o.cash_minor AND op.currency=o.currency AND op.status IN('pending','unknown_outcome','succeeded') WHERE st.user_id=NEW.user_id AND st.order_id=NEW.first_main_invoice_order_id AND st.payment_url IS NOT NULL AND o.status='payment_pending' AND o.payment_deadline>clock_timestamp() AND expert_card_activation_gate_valid(m.user_id,m.review_id)) THEN RAISE EXCEPTION 'resident_first_invoice_source_invalid' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.activation_kind IS NOT NULL AND (NEW.activation_kind,NEW.activation_order_id,NEW.activated_at,NEW.observed_at,NEW.expert_id) IS DISTINCT FROM (OLD.activation_kind,OLD.activation_order_id,OLD.activated_at,OLD.observed_at,OLD.expert_id) THEN RAISE EXCEPTION 'resident_activation_immutable' USING ERRCODE='23514'; END IF;
  IF NEW.activation_kind='first_projection' AND (TG_OP='INSERT' OR OLD.activation_kind IS NULL) AND NOT EXISTS(SELECT 1 FROM experts_published p JOIN experts e ON e.id=p.expert_id WHERE p.user_id=NEW.user_id AND p.expert_id=NEW.expert_id AND p.paid_order_id=NEW.activation_order_id AND p.active AND e.active AND e.verified AND EXISTS(SELECT 1 FROM expert_residency_current_coverage(p.expert_id) c WHERE c.source_order_id=p.paid_order_id AND c.ends_at=p.next_billing_date)) THEN RAISE EXCEPTION 'resident_activation_source_invalid' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='resident_work_notices' THEN
  IF TG_OP='UPDATE' AND (NEW.user_id,NEW.draft_id,NEW.kind,NEW.review_id,NEW.target_bot_id,NEW.target_bot_key,NEW.target_chat_id,NEW.identity_id,NEW.consent_authority,NEW.created_at) IS DISTINCT FROM (OLD.user_id,OLD.draft_id,OLD.kind,OLD.review_id,OLD.target_bot_id,OLD.target_bot_key,OLD.target_chat_id,OLD.identity_id,OLD.consent_authority,OLD.created_at) THEN RAISE EXCEPTION 'resident_notice_source_immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (NOT EXISTS(SELECT 1 FROM expert_card_drafts d JOIN channel_identities ci ON ci.id=NEW.identity_id WHERE d.id=NEW.draft_id AND d.user_id=NEW.user_id AND d.work_bot_id=NEW.target_bot_id AND d.work_bot_key=NEW.target_bot_key AND d.work_chat_id=NEW.target_chat_id AND ci.user_id=NEW.user_id AND ci.bot_key=NEW.target_bot_key AND ci.external_id=NEW.target_chat_id AND ci.external_chat_id=NEW.target_chat_id AND ci.status='active') OR (NEW.review_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM expert_card_reviews r WHERE r.id=NEW.review_id AND r.draft_id=NEW.draft_id AND r.user_id=NEW.user_id AND r.action=CASE WHEN NEW.kind='card_approved' THEN 'approve' ELSE 'return_changes' END)) OR (NEW.kind='first_activation' AND NOT EXISTS(SELECT 1 FROM resident_lifecycle_subjects s WHERE s.user_id=NEW.user_id AND s.activation_kind='first_projection'))) THEN RAISE EXCEPTION 'resident_notice_source_invalid' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='resident_work_notice_attempts' THEN
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.notice_id,NEW.sequence,NEW.payload_digest,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.notice_id,OLD.sequence,OLD.payload_digest,OLD.created_at) OR (OLD.state<>'unknown' AND NEW IS DISTINCT FROM OLD)) THEN RAISE EXCEPTION 'resident_attempt_immutable' USING ERRCODE='23514'; END IF;
  IF NEW.state='delivered' AND NOT EXISTS(SELECT 1 FROM resident_work_notices n WHERE n.id=NEW.notice_id AND jsonb_typeof(NEW.receipt)='object' AND jsonb_typeof(NEW.receipt->'messageId')='number' AND NEW.receipt->>'botKey'=n.target_bot_key AND NEW.receipt->>'chatId'=n.target_chat_id AND NEW.receipt->>'messageId' ~ '^[1-9][0-9]{0,15}$' AND (NEW.receipt->>'messageId')::numeric<=9007199254740991 AND NEW.receipt-'botKey'-'chatId'-'messageId'='{}'::jsonb) THEN RAISE EXCEPTION 'resident_receipt_invalid' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='resident_lifecycle_cases' AND TG_OP='UPDATE' THEN
  IF (NEW.user_id,NEW.application_id,NEW.kind,NEW.generation,NEW.due_at,NEW.window_start,NEW.window_end,NEW.numerator,NEW.denominator,NEW.missing_provenance,NEW.created_at) IS DISTINCT FROM (OLD.user_id,OLD.application_id,OLD.kind,OLD.generation,OLD.due_at,OLD.window_start,OLD.window_end,OLD.numerator,OLD.denominator,OLD.missing_provenance,OLD.created_at) OR (OLD.status<>'open' AND (to_jsonb(NEW)-'manager_id') IS DISTINCT FROM (to_jsonb(OLD)-'manager_id')) OR (OLD.manager_id IS DISTINCT FROM NEW.manager_id AND OLD.status<>'open' AND NEW.manager_id IS NOT NULL) THEN RAISE EXCEPTION 'resident_case_evidence_immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER resident_lifecycle_subject_guard BEFORE INSERT OR UPDATE ON resident_lifecycle_subjects FOR EACH ROW EXECUTE FUNCTION resident_lifecycle_source_guard();
CREATE TRIGGER resident_work_notice_guard BEFORE INSERT OR UPDATE ON resident_work_notices FOR EACH ROW EXECUTE FUNCTION resident_lifecycle_source_guard();
CREATE TRIGGER resident_work_attempt_guard BEFORE INSERT OR UPDATE ON resident_work_notice_attempts FOR EACH ROW EXECUTE FUNCTION resident_lifecycle_source_guard();
CREATE TRIGGER resident_lifecycle_case_guard BEFORE UPDATE ON resident_lifecycle_cases FOR EACH ROW EXECUTE FUNCTION resident_lifecycle_source_guard();
--> statement-breakpoint
-- Join receipts remain erasable with the subject; updates cannot rewrite client provenance.
CREATE FUNCTION resident_waitlist_join_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.command_type='join' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'waitlist_join_receipt_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER resident_waitlist_join_guard BEFORE UPDATE ON booking_waitlist_command_receipts FOR EACH ROW EXECUTE FUNCTION resident_waitlist_join_immutable();

--> statement-breakpoint
-- Validate final committed state: claim, receipt and privacy transitions span statements.
CREATE FUNCTION resident_work_delivery_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n resident_work_notices%ROWTYPE; a resident_work_notice_attempts%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='resident_work_notices' THEN SELECT * INTO n FROM resident_work_notices WHERE id=NEW.id;
 ELSE SELECT * INTO n FROM resident_work_notices WHERE id=NEW.notice_id; END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF n.last_attempt_id IS NOT NULL THEN SELECT * INTO a FROM resident_work_notice_attempts WHERE id=n.last_attempt_id AND notice_id=n.id AND sequence=n.attempt_count; END IF;
 IF (n.state='delivered' AND (a.state IS DISTINCT FROM 'delivered' OR a.receipt IS NULL)) OR
    (n.state='unknown' AND a.state IS DISTINCT FROM 'unknown') OR
    (n.state='pending' AND n.attempt_count>0 AND a.state IS DISTINCT FROM 'not_applied') OR
    (a.state='delivered' AND n.state NOT IN('delivered','cancelled')) THEN
   RAISE EXCEPTION 'resident_work_delivery_inconsistent' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER resident_work_notice_delivery_guard AFTER INSERT OR UPDATE ON resident_work_notices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION resident_work_delivery_consistent();
CREATE CONSTRAINT TRIGGER resident_work_attempt_delivery_guard AFTER INSERT OR UPDATE ON resident_work_notice_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION resident_work_delivery_consistent();
