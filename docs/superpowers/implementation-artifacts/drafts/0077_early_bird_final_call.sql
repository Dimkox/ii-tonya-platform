CREATE TABLE early_bird_final_call_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('first','repeat')),
 config_version text NOT NULL CHECK (config_version ~ '^[A-Za-z0-9_-]{1,64}$'),
 trigger_at timestamptz NOT NULL,
 client_start_at timestamptz NOT NULL,
 scheduled_at timestamptz NOT NULL,
 available_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','dispatched','delivered','cancelled','uncertain')),
 attempt_id uuid,
 prepared_until timestamptz,
 message_id text,
 delivered_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (isfinite(trigger_at) AND isfinite(client_start_at) AND isfinite(scheduled_at) AND isfinite(available_at) AND isfinite(created_at)),
 CHECK (trigger_at < client_start_at AND scheduled_at >= trigger_at AND scheduled_at < client_start_at AND available_at >= scheduled_at),
 CHECK (mod(extract(epoch from scheduled_at-trigger_at)::numeric,86400)=0),
 CHECK ((status='pending' AND attempt_id IS NULL AND prepared_until IS NULL AND message_id IS NULL AND delivered_at IS NULL)
 OR (status='preparing' AND attempt_id IS NOT NULL AND prepared_until IS NOT NULL AND isfinite(prepared_until) AND message_id IS NULL AND delivered_at IS NULL)
 OR (status IN ('dispatched','uncertain') AND attempt_id IS NOT NULL AND prepared_until IS NULL AND message_id IS NULL AND delivered_at IS NULL)
 OR (status='cancelled' AND prepared_until IS NULL AND message_id IS NULL AND delivered_at IS NULL)
 OR (status='delivered' AND attempt_id IS NOT NULL AND prepared_until IS NULL AND message_id IS NOT NULL AND message_id ~ '^[1-9][0-9]{0,19}$' AND delivered_at IS NOT NULL AND isfinite(delivered_at) AND delivered_at >= created_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX early_bird_final_call_one_active ON early_bird_final_call_queue(user_id,kind) WHERE status IN ('pending','preparing','dispatched','delivered','uncertain');
--> statement-breakpoint
CREATE INDEX early_bird_final_call_ready ON early_bird_final_call_queue(status,available_at,created_at,id);
--> statement-breakpoint
CREATE FUNCTION early_bird_final_call_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE first_time timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN
   IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'early_bird_final_call_immutable';
 END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.status <> 'pending' OR NEW.attempt_id IS NOT NULL OR NEW.message_id IS NOT NULL OR NEW.delivered_at IS NOT NULL OR NEW.prepared_until IS NOT NULL THEN RAISE EXCEPTION 'early_bird_final_call_initial_state'; END IF;
   IF NEW.kind='repeat' THEN
     SELECT delivered_at INTO first_time FROM early_bird_final_call_queue WHERE user_id=NEW.user_id AND kind='first' AND status='delivered' FOR SHARE;
     IF first_time IS NULL OR NEW.scheduled_at < first_time+interval '72 hours' THEN RAISE EXCEPTION 'early_bird_final_call_repeat_source'; END IF;
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.kind IS DISTINCT FROM OLD.kind
 OR NEW.config_version IS DISTINCT FROM OLD.config_version OR NEW.trigger_at IS DISTINCT FROM OLD.trigger_at
 OR NEW.client_start_at IS DISTINCT FROM OLD.client_start_at OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
 OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'early_bird_final_call_immutable'; END IF;
 IF OLD.status IN ('delivered','cancelled','uncertain') THEN RAISE EXCEPTION 'early_bird_final_call_terminal'; END IF;
 IF NEW.status='preparing' AND (early_bird_current_time()<NEW.trigger_at OR early_bird_current_time()>=NEW.client_start_at) THEN RAISE EXCEPTION 'early_bird_final_call_window'; END IF;
 IF NEW.status='preparing' AND NOT ((OLD.status='pending' AND OLD.available_at<=early_bird_current_time()) OR (OLD.status='preparing' AND OLD.prepared_until<=clock_timestamp())) THEN RAISE EXCEPTION 'early_bird_final_call_lease'; END IF;
 IF NEW.status='preparing' AND (NEW.attempt_id IS NULL OR NEW.attempt_id IS NOT DISTINCT FROM OLD.attempt_id OR NEW.available_at IS DISTINCT FROM OLD.available_at) THEN RAISE EXCEPTION 'early_bird_final_call_lease'; END IF;
 IF OLD.status='preparing' AND NEW.status<>'preparing' AND ((OLD.prepared_until<=clock_timestamp() AND NEW.status<>'cancelled') OR (NEW.status<>'pending' AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id)) THEN RAISE EXCEPTION 'early_bird_final_call_lease'; END IF;
 IF NEW.status='dispatched' AND (early_bird_current_time()<NEW.trigger_at OR early_bird_current_time()>=NEW.client_start_at) THEN RAISE EXCEPTION 'early_bird_final_call_window'; END IF;
 IF OLD.status='dispatched' AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id THEN RAISE EXCEPTION 'early_bird_final_call_attempt'; END IF;
 IF NEW.status='pending' AND (NEW.available_at<=early_bird_current_time() OR mod(extract(epoch from NEW.available_at-NEW.trigger_at)::numeric,86400)<>0) THEN RAISE EXCEPTION 'early_bird_final_call_retry_tick'; END IF;
 IF NEW.status<>'pending' AND NEW.available_at IS DISTINCT FROM OLD.available_at THEN RAISE EXCEPTION 'early_bird_final_call_available'; END IF;
 IF NOT ((OLD.status='pending' AND NEW.status IN ('preparing','cancelled'))
 OR (OLD.status='preparing' AND NEW.status IN ('preparing','pending','dispatched','cancelled'))
 OR (OLD.status='dispatched' AND NEW.status IN ('delivered','uncertain'))) THEN RAISE EXCEPTION 'early_bird_final_call_transition'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER early_bird_final_call_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_final_call_queue FOR EACH ROW EXECUTE FUNCTION early_bird_final_call_guard();
--> statement-breakpoint
CREATE FUNCTION early_bird_final_call_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN DELETE FROM early_bird_final_call_queue WHERE user_id=NEW.user_id; RETURN NULL; END $$;
--> statement-breakpoint
CREATE TRIGGER early_bird_final_call_erasure AFTER INSERT ON expert_sales_erased_cohorts FOR EACH ROW EXECUTE FUNCTION early_bird_final_call_erasure();
--> statement-breakpoint
CREATE FUNCTION early_bird_final_call_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- No ONBOARDING_ONLY payment authority exists yet. A later reviewed migration
 -- must replace this gate when authoritative state and checkout exist.
 RAISE EXCEPTION 'early_bird_final_call_authority_unavailable';
END $$;
--> statement-breakpoint
CREATE TRIGGER early_bird_final_call_admission BEFORE INSERT ON early_bird_final_call_queue FOR EACH ROW EXECUTE FUNCTION early_bird_final_call_admission();
