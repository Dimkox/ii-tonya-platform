-- SCRUM-525. Planerka operations stay retained for real bookings.
-- A transaction may delete one only when it sets ii_tonya.planerka_test_purge
-- to expert:<id> and that expert is inactive and unverified.
CREATE OR REPLACE FUNCTION planerka_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF current_setting('ii_tonya.planerka_test_purge', true) = 'expert:' || (
      SELECT e.id::text FROM reservations r
      JOIN experts e ON e.id = r.expert_id
      WHERE r.id = OLD.reservation_id AND e.active = false AND e.verified = false
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'planerka_operation_retained';
  END IF;
  IF (NEW.reservation_id,NEW.account_id,NEW.event_type_id,NEW.request,NEW.request_fingerprint,NEW.starts_at,NEW.ends_at)
    IS DISTINCT FROM (OLD.reservation_id,OLD.account_id,OLD.event_type_id,OLD.request,OLD.request_fingerprint,OLD.starts_at,OLD.ends_at)
    OR (OLD.provider_uid IS NOT NULL AND NEW.provider_uid IS DISTINCT FROM OLD.provider_uid)
    OR (OLD.send_admitted_at IS NOT NULL AND NEW.send_admitted_at IS DISTINCT FROM OLD.send_admitted_at)
    OR (NEW.send_admitted_at IS NOT NULL AND NEW.state='pending')
    OR (OLD.cancel_requested AND NOT NEW.cancel_requested)
  THEN RAISE EXCEPTION 'planerka_operation_identity_immutable'; END IF;
  RETURN NEW;
END $$;
