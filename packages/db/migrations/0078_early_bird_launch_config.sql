CREATE TABLE early_bird_launch_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase text NOT NULL CHECK (phase IN ('PUBLIC_LAUNCH', 'WAVE_1_EARLY_BIRD')),
  enrollment_start_at timestamptz NOT NULL CHECK (enrollment_start_at = '2026-10-31 21:00:00+00'::timestamptz),
  client_start_at timestamptz NOT NULL CHECK (client_start_at = '2027-01-10 21:00:00+00'::timestamptz),
  promo_deadline_days integer NOT NULL CHECK (promo_deadline_days = 10),
  final_call_trigger_at timestamptz NOT NULL CHECK (final_call_trigger_at = '2026-12-28 07:00:00+00'::timestamptz),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX early_bird_launch_config_one_active ON early_bird_launch_configs ((true)) WHERE active;
--> statement-breakpoint
CREATE FUNCTION early_bird_launch_config_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'early_bird_launch_config_immutable'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.phase IS DISTINCT FROM OLD.phase
    OR NEW.enrollment_start_at IS DISTINCT FROM OLD.enrollment_start_at
    OR NEW.client_start_at IS DISTINCT FROM OLD.client_start_at
    OR NEW.promo_deadline_days IS DISTINCT FROM OLD.promo_deadline_days
    OR NEW.final_call_trigger_at IS DISTINCT FROM OLD.final_call_trigger_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NOT OLD.active OR NEW.active THEN
    RAISE EXCEPTION 'early_bird_launch_config_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER early_bird_launch_config_immutable BEFORE UPDATE OR DELETE ON early_bird_launch_configs
  FOR EACH ROW EXECUTE FUNCTION early_bird_launch_config_immutable();
--> statement-breakpoint
INSERT INTO early_bird_launch_configs (phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at)
VALUES ('PUBLIC_LAUNCH','2026-11-01 00:00:00+03','2027-01-11 00:00:00+03',10,'2026-12-28 10:00:00+03');

--> statement-breakpoint
CREATE OR REPLACE FUNCTION early_bird_choice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'early_bird_choice_immutable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  PERFORM 1 FROM early_bird_launch_configs WHERE active AND phase = 'WAVE_1_EARLY_BIRD' FOR SHARE;
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
  SELECT coalesce(max(decision_no),0)+1 INTO NEW.decision_no FROM early_bird_choices WHERE base_id=NEW.base_id;
  NEW.chosen_at:=clock_timestamp(); RETURN NEW;
END $$;
