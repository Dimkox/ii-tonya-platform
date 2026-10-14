CREATE TABLE booking_waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES slots(id),
  waitlist_handle char(47) NOT NULL,
  choice_digest char(71) NOT NULL,
  join_idempotency_key char(64) NOT NULL,
  status text NOT NULL DEFAULT 'waiting',
  promoted_reservation_id uuid REFERENCES reservations(id),
  promotion_hold_until timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_waitlist_handle_check CHECK (waitlist_handle ~ '^wl1\.[A-Za-z0-9_-]{43}$'),
  CONSTRAINT booking_waitlist_handle_unique UNIQUE(waitlist_handle),
  CONSTRAINT booking_waitlist_choice_digest_check CHECK (choice_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT booking_waitlist_join_key_check CHECK (join_idempotency_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT booking_waitlist_join_key_unique UNIQUE(join_idempotency_key),
  CONSTRAINT booking_waitlist_status_check CHECK (status IN ('waiting','promoting','promoted','cancelled','expired')),
  CONSTRAINT booking_waitlist_promotion_check CHECK (
    (status='promoted' AND promoted_reservation_id IS NOT NULL AND promotion_hold_until IS NOT NULL
      AND promotion_hold_until <= updated_at + interval '72 hours')
    OR (status<>'promoted' AND promoted_reservation_id IS NULL AND promotion_hold_until IS NULL)
  ),
  CONSTRAINT booking_waitlist_reason_check CHECK (
    cancellation_reason IS NULL OR cancellation_reason ~ '^[a-z][a-z0-9_]{0,63}$'
  )
);
CREATE UNIQUE INDEX booking_waitlist_one_active_client_slot
  ON booking_waitlist_entries(user_id,slot_id)
  WHERE status IN ('waiting','promoting');
CREATE INDEX booking_waitlist_fifo_claim_idx
  ON booking_waitlist_entries(slot_id,created_at,id)
  WHERE status='waiting';

CREATE TABLE booking_waitlist_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_type text NOT NULL,
  idempotency_key char(64) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_hash char(71) NOT NULL,
  waitlist_entry_id uuid REFERENCES booking_waitlist_entries(id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_waitlist_receipt_unique UNIQUE(command_type,idempotency_key),
  CONSTRAINT booking_waitlist_receipt_type_check CHECK (command_type IN ('join','leave','promote')),
  CONSTRAINT booking_waitlist_receipt_key_check CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT booking_waitlist_receipt_hash_check CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$')
);

CREATE TABLE booking_reschedule_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  old_slot_id uuid NOT NULL REFERENCES slots(id),
  new_slot_id uuid NOT NULL REFERENCES slots(id),
  old_version integer NOT NULL,
  new_version integer NOT NULL,
  idempotency_key char(64) NOT NULL UNIQUE,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_reschedule_slots_check CHECK (old_slot_id<>new_slot_id),
  CONSTRAINT booking_reschedule_versions_check CHECK (old_version>0 AND new_version=old_version+1),
  CONSTRAINT booking_reschedule_key_check CHECK (idempotency_key ~ '^[0-9a-f]{64}$')
);

CREATE FUNCTION booking_reschedule_facts_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'booking_reschedule_facts_immutable' USING ERRCODE='55000';
END; $$;
CREATE TRIGGER booking_reschedule_facts_immutable_guard
BEFORE UPDATE OR DELETE ON booking_reschedule_facts
FOR EACH ROW EXECUTE FUNCTION booking_reschedule_facts_immutable();
