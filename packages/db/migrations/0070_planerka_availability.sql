CREATE TABLE planerka_availability_refreshes (
  expert_service_id uuid PRIMARY KEY REFERENCES expert_services(id),
  account_id integer NOT NULL CHECK(account_id > 0),
  event_type_id integer NOT NULL CHECK(event_type_id > 0),
  duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 1 AND 1440),
  time_zone text NOT NULL,
  verified_at timestamptz NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL,
  published_at timestamptz,
  reason_code text CHECK(reason_code IN ('account_rate_limit','provider_unavailable','invalid_response','mapping_invalid','slot_conflict','database_busy')),
  CHECK((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK(window_end = window_start + interval '168 hours')
);
--> statement-breakpoint
CREATE INDEX slots_planerka_service_start_idx ON slots(expert_service_id,starts_at) WHERE provider='planerka';
--> statement-breakpoint
CREATE FUNCTION planerka_availability_mapping_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_services uuid[];
BEGIN
  IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN affected_services := ARRAY[NEW.expert_service_id];
  ELSE affected_services := ARRAY[OLD.expert_service_id];
    IF TG_OP='UPDATE' THEN affected_services := array_append(affected_services,NEW.expert_service_id); END IF;
  END IF;
  -- The mapping row is already locked by UPDATE/DELETE. Match publication's
  -- mapping -> service -> expert -> refresh -> slot order.
  -- Never wait while holding a mapping: booking approval owns these rows before
  -- requesting its mapping lock. NOWAIT aborts the whole mutation for safe retry.
  PERFORM 1 FROM expert_services WHERE id=ANY(affected_services) ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM experts WHERE id IN (SELECT expert_id FROM expert_services WHERE id=ANY(affected_services)) ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM planerka_availability_refreshes WHERE expert_service_id=ANY(affected_services) ORDER BY expert_service_id FOR UPDATE NOWAIT;
  UPDATE planerka_availability_refreshes SET lease_token=NULL,lease_until=NULL,
    next_attempt_at=clock_timestamp(),reason_code='mapping_invalid'
    WHERE expert_service_id=ANY(affected_services);
  PERFORM 1 FROM slots WHERE expert_service_id=ANY(affected_services) AND provider='planerka' ORDER BY id FOR UPDATE NOWAIT;
  UPDATE slots SET observed_at=NULL WHERE expert_service_id=ANY(affected_services) AND provider='planerka';
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER planerka_availability_mapping_invalidation
  BEFORE INSERT OR UPDATE OR DELETE ON planerka_service_mappings
  FOR EACH ROW EXECUTE FUNCTION planerka_availability_mapping_invalidate();
