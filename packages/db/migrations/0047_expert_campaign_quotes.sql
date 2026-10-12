CREATE TABLE expert_campaign_anchors (
  user_id uuid NOT NULL REFERENCES users(id),
  rule_version text NOT NULL,
  calculation_timestamp timestamptz NOT NULL,
  PRIMARY KEY (user_id,rule_version),
  CONSTRAINT expert_campaign_anchor_identity UNIQUE(user_id,rule_version,calculation_timestamp),
  CONSTRAINT expert_campaign_anchor_valid CHECK (
    rule_version = 'expert_energy_start_v1' AND isfinite(calculation_timestamp)
    AND calculation_timestamp BETWEEN '1970-01-01 00:00:00+00'::timestamptz AND '275760-09-13 00:00:00+00'::timestamptz
    AND calculation_timestamp = date_trunc('milliseconds',calculation_timestamp)
  )
);
--> statement-breakpoint
CREATE TABLE expert_campaign_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tariff_version_id uuid NOT NULL REFERENCES expert_residency_tariff_versions(id),
  idempotency_key text NOT NULL,
  rule_version text NOT NULL,
  calculation_timestamp timestamptz NOT NULL,
  quoted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  term_months integer NOT NULL,
  duration_seconds integer NOT NULL,
  base_monthly_minor bigint NOT NULL,
  discounted_monthly_minor bigint NOT NULL,
  monthly_price_minor bigint NOT NULL,
  price_minor bigint NOT NULL,
  currency text NOT NULL,
  energy_discount_bps integer NOT NULL,
  start_discount_bps integer NOT NULL,
  floor_applied boolean NOT NULL,
  display_name text NOT NULL,
  credit_cap_bps integer NOT NULL,
  individual_services_enabled boolean NOT NULL,
  group_event_limit integer NOT NULL,
  statistics_level text NOT NULL,
  support_priority text NOT NULL,
  CONSTRAINT expert_campaign_quote_user_key UNIQUE(user_id,idempotency_key),
  CONSTRAINT expert_campaign_quote_anchor_fk FOREIGN KEY(user_id,rule_version,calculation_timestamp)
    REFERENCES expert_campaign_anchors(user_id,rule_version,calculation_timestamp),
  CONSTRAINT expert_campaign_quote_identity_valid CHECK (
    rule_version = 'expert_energy_start_v1' AND currency = 'RUB'
    AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  CONSTRAINT expert_campaign_quote_time_valid CHECK (
    isfinite(calculation_timestamp) AND isfinite(quoted_at) AND isfinite(expires_at)
    AND calculation_timestamp >= '1970-01-01 00:00:00+00'::timestamptz
    AND calculation_timestamp <= quoted_at AND quoted_at < expires_at
    AND expires_at <= '275760-09-13 00:00:00+00'::timestamptz
    AND calculation_timestamp = date_trunc('milliseconds',calculation_timestamp)
    AND quoted_at = date_trunc('milliseconds',quoted_at)
    AND expires_at = date_trunc('milliseconds',expires_at)
    AND expires_at <= quoted_at + interval '15 minutes'
  ),
  CONSTRAINT expert_campaign_quote_stage_valid CHECK (
    term_months IN (1,3) AND duration_seconds = 2592000::bigint * term_months
    AND (term_months = 1 OR quoted_at - calculation_timestamp < interval '144 hours')
    AND energy_discount_bps = CASE
      WHEN quoted_at - calculation_timestamp < interval '72 hours' THEN 4000
      WHEN quoted_at - calculation_timestamp < interval '144 hours' THEN 3000
      WHEN quoted_at - calculation_timestamp < interval '216 hours' THEN 2000 ELSE 0 END
    AND start_discount_bps = CASE WHEN term_months = 1 THEN 0
      WHEN quoted_at - calculation_timestamp < interval '72 hours' THEN 1500 ELSE 1000 END
  ),
  CONSTRAINT expert_campaign_quote_arithmetic_valid CHECK (
    base_monthly_minor > 0 AND discounted_monthly_minor >= 0
    AND discounted_monthly_minor = div(base_monthly_minor::numeric * (10000::numeric-energy_discount_bps) * (10000::numeric-start_discount_bps) + 50000000,100000000)
    AND monthly_price_minor = greatest(discounted_monthly_minor,500000)
    AND floor_applied = (discounted_monthly_minor < 500000)
    AND price_minor = monthly_price_minor::numeric * term_months
    AND price_minor BETWEEN 1 AND 999999999999
  )
);
--> statement-breakpoint
-- Source binding is enforced for raw SQL too. Lock ordering matches the repository
-- and the shared privacy authority namespace. No consent grant is implied here.
CREATE FUNCTION enforce_expert_campaign_quote_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tariff expert_residency_tariff_versions%ROWTYPE;
  stage_end timestamptz;
  expected_expiry timestamptz;
BEGIN
  LOCK TABLE consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  PERFORM 1 FROM users WHERE id=NEW.user_id AND active=true FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expert_campaign_source_invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO tariff FROM expert_residency_tariff_versions WHERE id=NEW.tariff_version_id FOR SHARE;
  IF NOT FOUND OR tariff.commercial_policy_version <> 'expert_residency_v2'
    OR NOT isfinite(NEW.quoted_at) OR NEW.quoted_at < tariff.active_from OR NEW.quoted_at >= tariff.active_to
    OR ROW(NEW.base_monthly_minor,NEW.currency,NEW.display_name,NEW.credit_cap_bps,
      NEW.individual_services_enabled,NEW.group_event_limit,NEW.statistics_level,NEW.support_priority)
      IS DISTINCT FROM ROW(tariff.price_minor,tariff.currency,tariff.display_name,tariff.credit_cap_bps,
      tariff.individual_services_enabled,tariff.group_event_limit,tariff.statistics_level,tariff.support_priority)
    OR tariff.duration_seconds <> 2592000 THEN
    RAISE EXCEPTION 'expert_campaign_source_invalid' USING ERRCODE='23514';
  END IF;
  stage_end := CASE
    WHEN NEW.quoted_at - NEW.calculation_timestamp < interval '72 hours' THEN NEW.calculation_timestamp + interval '72 hours'
    WHEN NEW.quoted_at - NEW.calculation_timestamp < interval '144 hours' THEN NEW.calculation_timestamp + interval '144 hours'
    WHEN NEW.quoted_at - NEW.calculation_timestamp < interval '216 hours' THEN NEW.calculation_timestamp + interval '216 hours'
    ELSE 'infinity'::timestamptz END;
  expected_expiry := least(NEW.quoted_at + interval '15 minutes',date_trunc('milliseconds',tariff.active_to),stage_end);
  IF NEW.expires_at IS DISTINCT FROM expected_expiry THEN
    RAISE EXCEPTION 'expert_campaign_expiry_invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_campaign_quote_source BEFORE INSERT ON expert_campaign_quotes
  FOR EACH ROW EXECUTE FUNCTION enforce_expert_campaign_quote_source();
--> statement-breakpoint
CREATE TRIGGER expert_campaign_anchors_append_only BEFORE UPDATE OR DELETE ON expert_campaign_anchors
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER expert_campaign_quotes_append_only BEFORE UPDATE OR DELETE ON expert_campaign_quotes
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
