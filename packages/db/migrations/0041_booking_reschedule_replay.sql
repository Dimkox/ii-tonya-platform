ALTER TABLE booking_reschedule_facts
  ADD COLUMN result_status text,
  ADD COLUMN result_reserved_until timestamptz;

ALTER TABLE booking_reschedule_facts
  DISABLE TRIGGER booking_reschedule_facts_immutable_guard;

UPDATE booking_reschedule_facts AS fact
SET result_status='reserved',
  result_reserved_until=reservation.reserved_until
FROM reservations AS reservation
WHERE reservation.id=fact.reservation_id;

ALTER TABLE booking_reschedule_facts
  ENABLE TRIGGER booking_reschedule_facts_immutable_guard;

ALTER TABLE booking_reschedule_facts
  ALTER COLUMN result_status SET NOT NULL,
  ALTER COLUMN result_reserved_until SET NOT NULL,
  ADD CONSTRAINT booking_reschedule_result_status_check
    CHECK (result_status='reserved');
