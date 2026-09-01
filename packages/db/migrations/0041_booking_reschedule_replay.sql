ALTER TABLE booking_reschedule_facts
  ADD COLUMN result_status text,
  ADD COLUMN result_reserved_until timestamptz,
  ADD COLUMN replay_recoverable boolean NOT NULL DEFAULT false;

ALTER TABLE booking_reschedule_facts
  ADD CONSTRAINT booking_reschedule_replay_result_check CHECK (
    (replay_recoverable AND result_status='reserved' AND result_reserved_until IS NOT NULL)
    OR
    (NOT replay_recoverable AND result_status IS NULL AND result_reserved_until IS NULL)
  );
