ALTER TABLE expert_residency_orders
  ADD COLUMN campaign_quote_id uuid,
  ADD COLUMN campaign_term_months integer,
  ADD CONSTRAINT expert_campaign_order_quote_fk FOREIGN KEY(campaign_quote_id) REFERENCES expert_campaign_quotes(id),
  ADD CONSTRAINT expert_campaign_order_quote_unique UNIQUE(campaign_quote_id),
  DROP CONSTRAINT expert_order_policy_version,
  ADD CONSTRAINT expert_order_policy_version CHECK(commercial_policy_version IN ('legacy_residency_v1','expert_residency_v2','expert_campaign_v1')),
  ADD CONSTRAINT expert_campaign_order_binding CHECK (
    (commercial_policy_version <> 'expert_campaign_v1' AND campaign_quote_id IS NULL AND campaign_term_months IS NULL)
    OR (commercial_policy_version = 'expert_campaign_v1' AND campaign_quote_id IS NOT NULL
      AND campaign_term_months IS NOT NULL AND campaign_term_months IN (1,3)
      AND duration_seconds = campaign_term_months * 2592000 AND credit_cap_bps = 3000)
  );
--> statement-breakpoint
-- This is source validation, not permission to submit caller-controlled clocks.
-- The repository alone assigns its fresh created_at. Quotes remain append-only.
CREATE FUNCTION enforce_expert_campaign_order_source() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NOT FOUND OR NOT expert.active OR NOT expert.verified OR expert.user_id IS DISTINCT FROM quote.user_id THEN
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
CREATE TRIGGER expert_campaign_order_source BEFORE INSERT ON expert_residency_orders
  FOR EACH ROW EXECUTE FUNCTION enforce_expert_campaign_order_source();
--> statement-breakpoint
CREATE FUNCTION protect_expert_campaign_order_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.commercial_policy_version='expert_campaign_v1' OR OLD.campaign_quote_id IS NOT NULL THEN
      RAISE EXCEPTION 'expert_campaign_order_immutable' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.commercial_policy_version='expert_campaign_v1' OR NEW.commercial_policy_version='expert_campaign_v1'
    OR OLD.campaign_quote_id IS NOT NULL OR NEW.campaign_quote_id IS NOT NULL THEN
    IF (to_jsonb(NEW) - ARRAY['status','provider_payment_id','settled_at','residency_starts_at','residency_ends_at','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','provider_payment_id','settled_at','residency_starts_at','residency_ends_at','updated_at']) THEN
      RAISE EXCEPTION 'expert_campaign_order_immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_campaign_order_snapshot_immutable BEFORE UPDATE OR DELETE ON expert_residency_orders
  FOR EACH ROW EXECUTE FUNCTION protect_expert_campaign_order_snapshot();
