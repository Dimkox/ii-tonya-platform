-- Calendar pause never rewrites a settled paid interval.
CREATE TABLE expert_residency_lifecycle (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 expert_id uuid NOT NULL UNIQUE REFERENCES experts(id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','paused','payment_required')),
 paused_until date,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_residency_lifecycle_pause CHECK(coalesce((status='paused' AND paused_until IS NOT NULL AND isfinite(paused_until)) OR(status<>'paused' AND paused_until IS NULL),false)),
 CONSTRAINT expert_residency_lifecycle_owner_fk FOREIGN KEY(expert_id,user_id) REFERENCES experts(id,user_id)
);
--> statement-breakpoint
CREATE TABLE expert_residency_renewal_bills (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 owner_audit_id uuid NOT NULL,
 expert_id uuid NOT NULL REFERENCES experts(id),
 cycle_end timestamptz NOT NULL CHECK(isfinite(cycle_end)),
 source_order_id uuid NOT NULL REFERENCES expert_residency_orders(id),
 tariff_version_id uuid NOT NULL REFERENCES expert_residency_tariff_versions(id),
 term_months integer NOT NULL CHECK(term_months IN(1,3)),
 quote_id uuid REFERENCES expert_campaign_quotes(id),
 acceptance_id uuid REFERENCES expert_card_main_acceptances(id),
 order_id uuid REFERENCES expert_residency_orders(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_residency_renewal_cycle_unique UNIQUE(expert_id,cycle_end)
);
--> statement-breakpoint
CREATE TABLE expert_residency_lifecycle_audits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expert_id uuid NOT NULL REFERENCES experts(id),
 action text NOT NULL CHECK(action IN('pause','resume','automatic_return','suspend','restore')),
 cycle_end timestamptz CHECK(cycle_end IS NULL OR isfinite(cycle_end)),
 return_date date CHECK(return_date IS NULL OR isfinite(return_date)),
 CONSTRAINT expert_residency_lifecycle_audit_pause CHECK((action='pause')=(return_date IS NOT NULL)),
 CONSTRAINT expert_residency_lifecycle_audit_owner FOREIGN KEY(expert_id,user_id) REFERENCES experts(id,user_id),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE expert_residency_lifecycle_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expert_id uuid NOT NULL REFERENCES experts(id),
 cycle_end timestamptz NOT NULL CHECK(isfinite(cycle_end)),
 stage text NOT NULL CHECK(stage IN('seven_days','one_day','overdue','archive_offer')),
 status text NOT NULL DEFAULT 'waiting_content' CHECK(status IN('waiting_content','pending','unknown_outcome','delivered','cancelled')),
 target_bot_id text,
 target_chat_id text,
 template_version text,
 payload_digest text,
 attempt_id uuid,
 attempted_at timestamptz,
 receipt jsonb,
 delivered_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expert_residency_notice_unique UNIQUE(expert_id,cycle_end,stage),
 CONSTRAINT expert_residency_notice_owner FOREIGN KEY(expert_id,user_id) REFERENCES experts(id,user_id),
 CONSTRAINT expert_residency_notice_content CHECK(coalesce((template_version IS NULL AND payload_digest IS NULL) OR(template_version IS NOT NULL AND template_version=('lifecycle.'||stage||'.v1') AND payload_digest IS NOT NULL AND payload_digest ~ '^sha256:[0-9a-f]{64}$'),false)),
 CONSTRAINT expert_residency_notice_attempt CHECK(coalesce((attempt_id IS NULL)=(attempted_at IS NULL) AND (attempted_at IS NULL OR isfinite(attempted_at)),false)),
 CONSTRAINT expert_residency_notice_receipt CHECK(coalesce((status='delivered' AND attempt_id IS NOT NULL AND template_version IS NOT NULL AND receipt IS NOT NULL AND delivered_at IS NOT NULL AND isfinite(delivered_at) AND expert_card_delivery_receipt_valid(receipt,target_bot_id,target_chat_id,template_version,payload_digest,1) AND receipt->>'contentVersion'=template_version AND receipt->>'payloadDigest'=payload_digest) OR(status<>'delivered' AND receipt IS NULL AND delivered_at IS NULL),false))
);
--> statement-breakpoint
CREATE INDEX expert_residency_notice_due ON expert_residency_lifecycle_notices(status,created_at) WHERE attempt_id IS NULL;
--> statement-breakpoint
CREATE FUNCTION protect_expert_residency_renewal_bill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ((NEW.expert_id,NEW.owner_audit_id,NEW.cycle_end,NEW.source_order_id,NEW.created_at) IS DISTINCT FROM (OLD.expert_id,OLD.owner_audit_id,OLD.cycle_end,OLD.source_order_id,OLD.created_at)
 OR (OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id)
 OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL)) THEN RAISE EXCEPTION 'residency_bill_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.quote_id,NEW.acceptance_id,NEW.tariff_version_id,NEW.term_months) IS DISTINCT FROM (OLD.quote_id,OLD.acceptance_id,OLD.tariff_version_id,OLD.term_months) AND EXISTS(SELECT 1 FROM expert_residency_renewal_attempts a JOIN expert_residency_orders o ON o.id=a.order_id WHERE a.bill_id=OLD.id AND NOT(o.status='expired' AND o.payment_deadline<=clock_timestamp())) THEN RAISE EXCEPTION 'residency_attempt_recovery_required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.user_id IS NULL OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND active)) THEN RAISE EXCEPTION 'residency_bill_live_owner_required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.user_id IS NOT NULL AND NEW.user_id IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND active) THEN RAISE EXCEPTION 'residency_bill_erasure_required' USING ERRCODE='23514'; END IF;
 IF (NEW.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM NEW.owner_audit_id) OR NOT EXISTS(SELECT 1 FROM experts e JOIN expert_residency_orders o ON o.expert_id=e.id WHERE e.id=NEW.expert_id AND NEW.owner_audit_id=e.user_id AND o.id=NEW.source_order_id AND o.residency_ends_at=NEW.cycle_end AND (TG_OP<>'INSERT' OR o.status='settled')) THEN RAISE EXCEPTION 'residency_bill_source' USING ERRCODE='23514'; END IF;
 IF NEW.quote_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM expert_campaign_quotes q WHERE q.id=NEW.quote_id AND q.user_id=NEW.owner_audit_id AND q.tariff_version_id=NEW.tariff_version_id AND q.term_months=NEW.term_months) THEN RAISE EXCEPTION 'residency_bill_quote' USING ERRCODE='23514'; END IF;
 IF NEW.acceptance_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM expert_card_main_acceptances a WHERE a.id=NEW.acceptance_id AND a.user_id=NEW.owner_audit_id AND a.expert_id=NEW.expert_id AND a.quote_id=NEW.quote_id) THEN RAISE EXCEPTION 'residency_bill_acceptance' USING ERRCODE='23514'; END IF;
 IF NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM expert_card_main_orders m WHERE m.order_id=NEW.order_id AND m.expert_id=NEW.expert_id AND m.user_id=NEW.owner_audit_id AND EXISTS(SELECT 1 FROM expert_residency_renewal_attempts first_attempt WHERE first_attempt.bill_id=NEW.id AND first_attempt.sequence=1 AND first_attempt.order_id=NEW.order_id AND first_attempt.acceptance_id=m.acceptance_id)) THEN RAISE EXCEPTION 'residency_bill_order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_residency_renewal_bill_source BEFORE INSERT OR UPDATE ON expert_residency_renewal_bills FOR EACH ROW EXECUTE FUNCTION protect_expert_residency_renewal_bill();
--> statement-breakpoint
ALTER TABLE expert_card_requests DROP CONSTRAINT expert_card_request_operation;
--> statement-breakpoint
ALTER TABLE expert_card_requests ADD CONSTRAINT expert_card_request_operation CHECK(coalesce((operation IN('entry','submit','promo_proof','handoff_issue','handoff_redeem','main_quote','main_accept','main_checkout','residency_pause','residency_resume')),false));
--> statement-breakpoint
CREATE TABLE expert_residency_renewal_attempts (
 bill_id uuid NOT NULL REFERENCES expert_residency_renewal_bills(id),
 sequence integer NOT NULL CHECK(sequence>0),
 quote_id uuid NOT NULL REFERENCES expert_campaign_quotes(id),
 acceptance_id uuid NOT NULL REFERENCES expert_card_main_acceptances(id),
 order_id uuid NOT NULL UNIQUE REFERENCES expert_residency_orders(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(bill_id,sequence)
);
--> statement-breakpoint
CREATE FUNCTION protect_expert_residency_renewal_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bill expert_residency_renewal_bills%ROWTYPE; prior expert_residency_renewal_attempts%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'residency_attempt_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO bill FROM expert_residency_renewal_bills WHERE id=NEW.bill_id FOR UPDATE;
 IF NOT FOUND OR bill.user_id IS NULL OR bill.quote_id IS DISTINCT FROM NEW.quote_id OR bill.acceptance_id IS DISTINCT FROM NEW.acceptance_id THEN RAISE EXCEPTION 'residency_attempt_bill' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM expert_residency_renewal_attempts WHERE bill_id=NEW.bill_id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence<>coalesce(prior.sequence,0)+1 OR (prior.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM expert_residency_orders WHERE id=prior.order_id AND status='expired' AND payment_deadline<=clock_timestamp())) OR NOT EXISTS(SELECT 1 FROM expert_card_main_orders m JOIN expert_residency_orders o ON o.id=m.order_id WHERE m.order_id=NEW.order_id AND m.acceptance_id=NEW.acceptance_id AND m.user_id=bill.user_id AND m.expert_id=bill.expert_id AND o.campaign_quote_id=NEW.quote_id AND o.id<>bill.source_order_id AND o.created_at>=bill.created_at AND o.status='payment_pending' AND o.payment_deadline>clock_timestamp()) THEN RAISE EXCEPTION 'residency_attempt_source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_residency_renewal_attempt_source BEFORE INSERT OR UPDATE OR DELETE ON expert_residency_renewal_attempts FOR EACH ROW EXECUTE FUNCTION protect_expert_residency_renewal_attempt();
--> statement-breakpoint
CREATE FUNCTION enforce_expert_residency_calendar_pause() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.active AND EXISTS(SELECT 1 FROM expert_residency_lifecycle WHERE user_id=NEW.user_id AND status='paused') THEN RAISE EXCEPTION 'residency_paused' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_residency_calendar_pause_publication BEFORE INSERT OR UPDATE ON experts_published FOR EACH ROW EXECUTE FUNCTION enforce_expert_residency_calendar_pause();
--> statement-breakpoint
CREATE TRIGGER expert_residency_calendar_pause_access BEFORE INSERT OR UPDATE ON experts FOR EACH ROW EXECUTE FUNCTION enforce_expert_residency_calendar_pause();
--> statement-breakpoint
INSERT INTO expert_card_material_templates(content_version,status,text_body,assets) VALUES
 ('lifecycle.seven_days.pending','inactive',NULL,'[]'),
 ('lifecycle.one_day.pending','inactive',NULL,'[]'),
 ('lifecycle.overdue.pending','inactive',NULL,'[]'),
 ('lifecycle.archive_offer.pending','inactive',NULL,'[]');
--> statement-breakpoint
CREATE FUNCTION expert_residency_current_coverage(target_expert uuid) RETURNS TABLE(source_order_id uuid,ends_at timestamptz) LANGUAGE sql VOLATILE AS $$
 WITH RECURSIVE instant AS MATERIALIZED(SELECT clock_timestamp() AS at), chain AS (
  SELECT o.id,o.residency_ends_at FROM expert_residency_orders o,instant
  WHERE o.expert_id=target_expert AND o.status='settled' AND o.residency_starts_at<=instant.at AND o.residency_ends_at>instant.at
  UNION
  SELECT o.id,o.residency_ends_at FROM expert_residency_orders o JOIN chain c ON o.residency_starts_at<=c.residency_ends_at AND o.residency_ends_at>c.residency_ends_at
  WHERE o.expert_id=target_expert AND o.status='settled'
 ) SELECT id,residency_ends_at FROM chain ORDER BY residency_ends_at DESC,id LIMIT 1
$$;
