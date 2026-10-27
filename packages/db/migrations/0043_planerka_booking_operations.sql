CREATE TABLE planerka_service_mappings (
  expert_service_id uuid PRIMARY KEY REFERENCES expert_services(id),
  account_id integer NOT NULL CHECK (account_id > 0),
  event_type_id integer NOT NULL CHECK (event_type_id > 0),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  time_zone text NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 128),
  enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz NOT NULL,
  UNIQUE(account_id,event_type_id)
);
--> statement-breakpoint
CREATE TABLE planerka_booking_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES reservations(id),
  account_id integer NOT NULL CHECK (account_id > 0),
  event_type_id integer NOT NULL CHECK (event_type_id > 0),
  request jsonb NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','unknown','booked','finished','cancel_pending','cancelling','cancel_unknown','cancelled','rejected','manual')),
  provider_uid text UNIQUE CHECK (provider_uid ~ '^[A-Za-z0-9_-]+$' AND length(provider_uid) BETWEEN 1 AND 256),
  cancel_requested boolean NOT NULL DEFAULT false,
  send_admitted_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  recovery_count integer NOT NULL DEFAULT 0 CHECK (recovery_count BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK (state NOT IN ('booked','finished','cancel_pending','cancelling','cancel_unknown') OR provider_uid IS NOT NULL),
  CHECK (state NOT IN ('sending','unknown') OR send_admitted_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX planerka_booking_operations_due ON planerka_booking_operations(next_attempt_at,lease_until) WHERE state IN ('pending','sending','unknown','cancel_pending','cancelling','cancel_unknown');
--> statement-breakpoint
CREATE TABLE planerka_account_requests (
  account_id integer PRIMARY KEY CHECK (account_id > 0),
  next_request_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION planerka_reservation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'booked' AND OLD.status <> 'booked' AND NOT EXISTS (
    SELECT 1 FROM planerka_booking_operations WHERE reservation_id=NEW.id AND state='booked' AND provider_uid IS NOT NULL AND NOT cancel_requested
  ) THEN RAISE EXCEPTION 'planerka_confirmation_required'; END IF;
  IF NEW.status IN ('cancelled_by_client','cancelled_by_expert','expired') AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE planerka_booking_operations SET cancel_requested=true,
      state=CASE WHEN state='pending' THEN 'cancelled' WHEN state='booked' THEN 'cancel_pending' ELSE state END,
      next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE reservation_id=NEW.id;
  END IF;
  IF NEW.status IN ('completed','no_show') AND OLD.status='booked' THEN
    UPDATE planerka_booking_operations SET state='finished',updated_at=clock_timestamp()
      WHERE reservation_id=NEW.id AND state='booked';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER planerka_reservation_transition_guard BEFORE UPDATE OF status ON reservations FOR EACH ROW EXECUTE FUNCTION planerka_reservation_transition();
--> statement-breakpoint
CREATE FUNCTION planerka_privacy_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('processor_complete','backup_verified') AND (EXISTS (
    SELECT 1 FROM planerka_booking_operations o JOIN reservations r ON r.id=o.reservation_id
    WHERE r.user_id=NEW.user_id AND o.state NOT IN ('cancelled','rejected','finished')
  ) OR EXISTS (
    SELECT 1 FROM planerka_legacy_booking_reviews l JOIN reservations r ON r.id=l.reservation_id
    WHERE r.user_id=NEW.user_id AND l.resolved_at IS NULL
  )) THEN RAISE EXCEPTION 'planerka_recovery_pending'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER planerka_privacy_completion_guard BEFORE UPDATE OF status ON privacy_deletion_jobs FOR EACH ROW EXECUTE FUNCTION planerka_privacy_completion();
--> statement-breakpoint
CREATE FUNCTION planerka_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'planerka_operation_retained'; END IF;
  IF (NEW.reservation_id,NEW.account_id,NEW.event_type_id,NEW.request,NEW.request_fingerprint,NEW.starts_at,NEW.ends_at)
    IS DISTINCT FROM (OLD.reservation_id,OLD.account_id,OLD.event_type_id,OLD.request,OLD.request_fingerprint,OLD.starts_at,OLD.ends_at)
    OR (OLD.provider_uid IS NOT NULL AND NEW.provider_uid IS DISTINCT FROM OLD.provider_uid)
    OR (OLD.send_admitted_at IS NOT NULL AND NEW.send_admitted_at IS DISTINCT FROM OLD.send_admitted_at)
    OR (NEW.send_admitted_at IS NOT NULL AND NEW.state='pending')
    OR (OLD.cancel_requested AND NOT NEW.cancel_requested)
  THEN RAISE EXCEPTION 'planerka_operation_identity_immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER planerka_operation_identity_guard BEFORE UPDATE OR DELETE ON planerka_booking_operations FOR EACH ROW EXECUTE FUNCTION planerka_operation_guard();
--> statement-breakpoint
CREATE TABLE planerka_legacy_booking_reviews (
  reservation_id uuid PRIMARY KEY REFERENCES reservations(id),
  resolved_at timestamptz,
  evidence_reference text,
  CHECK ((resolved_at IS NULL) = (evidence_reference IS NULL))
);
--> statement-breakpoint
-- Quarantine historical assertions, without inventing a provider UID or replaying POST.
INSERT INTO planerka_legacy_booking_reviews(reservation_id) SELECT id FROM reservations WHERE status='booked';
