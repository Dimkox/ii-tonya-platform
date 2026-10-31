CREATE TABLE early_bird_positive_price_snapshots (
  positive_choice_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_id uuid NOT NULL,
  grant_id uuid,
  onboarding_minor bigint NOT NULL DEFAULT 300000 CHECK(onboarding_minor IN(1000,300000)),
  base_monthly_minor bigint NOT NULL DEFAULT 500000 CHECK(base_monthly_minor>0 AND base_monthly_minor<=999999999999),
  policy_version text NOT NULL DEFAULT 'wave1_standard_v1' CHECK(policy_version IN('wave1_standard_v1','owner_test_10_20_v1')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(positive_choice_id,user_id) REFERENCES expert_sales_choices(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(base_id,user_id) REFERENCES expert_sales_bases(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(grant_id,user_id) REFERENCES owner_test_pricing_grants(id,user_id) ON DELETE CASCADE,
  CHECK ((grant_id IS NULL AND policy_version='wave1_standard_v1' AND onboarding_minor=300000) OR (grant_id IS NOT NULL AND policy_version='owner_test_10_20_v1' AND onboarding_minor=1000 AND base_monthly_minor=2000))
);
CREATE FUNCTION early_bird_positive_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_grant uuid; base_amount bigint;
BEGIN
  IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'early_bird_positive_snapshot_immutable'; END IF;
  LOCK TABLE consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  PERFORM 1 FROM early_bird_launch_configs WHERE active AND phase='WAVE_1_EARLY_BIRD' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_snapshot_phase'; END IF;
  SELECT b.base_tariff_amount INTO base_amount FROM expert_sales_bases b JOIN users u ON u.id=b.user_id AND u.active JOIN expert_sales_choices c ON c.base_id=b.id AND c.user_id=u.id
    WHERE b.id=NEW.base_id AND b.user_id=NEW.user_id AND c.id=NEW.positive_choice_id AND c.action='positive'
      AND c.id=(SELECT id FROM expert_sales_choices WHERE base_id=b.id ORDER BY revision DESC LIMIT 1)
      AND expert_card_current_messaging_authority(u.id,b.consent_version)
      AND NOT EXISTS(SELECT 1 FROM expert_onboarding_invoices i WHERE i.user_id=u.id)
      AND NOT EXISTS(SELECT 1 FROM expert_sales_paid_locks l WHERE l.user_id=u.id)
    FOR SHARE OF b,u,c;
  IF NOT FOUND OR NOT early_bird_wave_active(early_bird_current_time()) THEN RAISE EXCEPTION 'early_bird_snapshot_source'; END IF;
  SELECT id INTO active_grant FROM owner_test_pricing_grants WHERE user_id=NEW.user_id AND revoked_at IS NULL AND provider_mode='live' FOR SHARE;
  IF active_grant IS DISTINCT FROM NEW.grant_id THEN RAISE EXCEPTION 'early_bird_snapshot_stale'; END IF;
  IF NOT early_bird_wave_active(early_bird_current_time()) OR NOT EXISTS(SELECT 1 FROM early_bird_launch_configs WHERE active AND phase='WAVE_1_EARLY_BIRD') OR NOT EXISTS(SELECT 1 FROM expert_sales_bases b WHERE b.id=NEW.base_id AND b.user_id=NEW.user_id AND expert_card_current_messaging_authority(NEW.user_id,b.consent_version)) THEN RAISE EXCEPTION 'early_bird_snapshot_phase'; END IF;
  IF active_grant IS NULL THEN NEW.policy_version:='wave1_standard_v1'; NEW.onboarding_minor:=300000; NEW.base_monthly_minor:=base_amount;
  ELSE NEW.policy_version:='owner_test_10_20_v1'; NEW.onboarding_minor:=1000; NEW.base_monthly_minor:=2000; END IF;
  NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER early_bird_positive_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_positive_price_snapshots FOR EACH ROW EXECUTE FUNCTION early_bird_positive_snapshot_guard();
CREATE FUNCTION early_bird_positive_snapshot_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN DELETE FROM early_bird_positive_price_snapshots WHERE user_id=NEW.user_id; RETURN NULL; END $$;
CREATE TRIGGER early_bird_positive_snapshot_erasure AFTER INSERT ON expert_sales_erased_cohorts FOR EACH ROW EXECUTE FUNCTION early_bird_positive_snapshot_erasure();
CREATE OR REPLACE FUNCTION early_bird_choice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snap early_bird_positive_price_snapshots%ROWTYPE; active_grant uuid;
BEGIN
  IF TG_OP = 'DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'early_bird_choice_immutable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  PERFORM 1 FROM early_bird_launch_configs WHERE active AND phase='WAVE_1_EARLY_BIRD' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_choice_phase'; END IF;
  PERFORM 1 FROM users u JOIN expert_sales_bases b ON b.user_id=u.id WHERE u.id=NEW.user_id AND u.active AND b.id=NEW.base_id FOR SHARE OF u,b;
  IF NOT FOUND OR NOT early_bird_wave_active(early_bird_current_time()) OR NOT EXISTS (
    SELECT 1 FROM expert_sales_bases b JOIN expert_sales_choices c ON c.base_id=b.id AND c.user_id=b.user_id
      WHERE b.id=NEW.base_id AND b.user_id=NEW.user_id AND c.id=NEW.positive_choice_id
      AND c.action='positive' AND c.revision=NEW.revision
      AND c.id=(SELECT id FROM expert_sales_choices WHERE base_id=b.id ORDER BY revision DESC LIMIT 1)
      AND expert_card_current_messaging_authority(NEW.user_id,b.consent_version)
      AND NOT EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=NEW.user_id)
      AND NOT EXISTS(SELECT 1 FROM expert_onboarding_invoices WHERE user_id=NEW.user_id)
  ) THEN RAISE EXCEPTION 'early_bird_choice_source'; END IF;
  SELECT * INTO snap FROM early_bird_positive_price_snapshots WHERE positive_choice_id=NEW.positive_choice_id AND user_id=NEW.user_id AND base_id=NEW.base_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_choice_snapshot_missing'; END IF;
  SELECT id INTO active_grant FROM owner_test_pricing_grants WHERE user_id=NEW.user_id AND revoked_at IS NULL AND provider_mode='live' FOR SHARE;
  IF active_grant IS DISTINCT FROM snap.grant_id THEN RAISE EXCEPTION 'early_bird_choice_price_stale'; END IF;
  IF NOT early_bird_wave_active(early_bird_current_time()) OR NOT EXISTS(SELECT 1 FROM early_bird_launch_configs WHERE active AND phase='WAVE_1_EARLY_BIRD') OR NOT EXISTS(SELECT 1 FROM expert_sales_bases b WHERE b.id=NEW.base_id AND b.user_id=NEW.user_id AND expert_card_current_messaging_authority(NEW.user_id,b.consent_version)) THEN RAISE EXCEPTION 'early_bird_choice_phase'; END IF;
  SELECT coalesce(max(decision_no),0)+1 INTO NEW.decision_no FROM early_bird_choices WHERE base_id=NEW.base_id;
  NEW.chosen_at:=clock_timestamp(); RETURN NEW;
END $$;
