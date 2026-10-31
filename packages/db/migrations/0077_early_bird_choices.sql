CREATE FUNCTION early_bird_current_time() RETURNS timestamptz
LANGUAGE sql VOLATILE AS $$ SELECT clock_timestamp() $$;
--> statement-breakpoint
CREATE FUNCTION early_bird_wave_active(at_time timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT at_time >= '2026-10-31 21:00:00+00'::timestamptz
     AND at_time < '2027-01-10 21:00:00+00'::timestamptz
$$;
--> statement-breakpoint
CREATE TABLE early_bird_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_id uuid NOT NULL,
  positive_choice_id uuid NOT NULL,
  decision_no integer NOT NULL DEFAULT 1 CHECK (decision_no > 0),
  revision integer NOT NULL CHECK (revision > 0),
  choice text NOT NULL CHECK (choice IN ('now', 'later')),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 128),
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  chosen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (base_id,user_id) REFERENCES expert_sales_bases(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY (positive_choice_id,user_id) REFERENCES expert_sales_choices(id,user_id) ON DELETE CASCADE,
  UNIQUE (base_id,request_key),
  UNIQUE (base_id,decision_no),
  UNIQUE (id,user_id)
);
--> statement-breakpoint
CREATE FUNCTION early_bird_choice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'early_bird_choice_immutable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
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
--> statement-breakpoint
CREATE TRIGGER early_bird_choice_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_choices FOR EACH ROW EXECUTE FUNCTION early_bird_choice_guard();
--> statement-breakpoint
CREATE FUNCTION early_bird_choice_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM early_bird_choices WHERE user_id=NEW.user_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER early_bird_choice_erasure AFTER INSERT ON expert_sales_erased_cohorts FOR EACH ROW EXECUTE FUNCTION early_bird_choice_erasure();
