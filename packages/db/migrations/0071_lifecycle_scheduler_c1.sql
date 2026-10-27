CREATE TABLE lifecycle_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'reservation',
  occurrence_key text NOT NULL,
  job_type text NOT NULL,
  run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  lease_token uuid,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lifecycle_jobs_subject_type_unique UNIQUE (subject_kind, subject_id, job_type, occurrence_key),
  CONSTRAINT lifecycle_jobs_subject_kind_check CHECK (subject_kind IN ('reservation','user','coupon')),
  CONSTRAINT lifecycle_jobs_occurrence_key_check CHECK (char_length(occurrence_key) BETWEEN 1 AND 128 AND occurrence_key !~ '[[:cntrl:]]'),
  CONSTRAINT lifecycle_jobs_type_check CHECK (job_type IN ('booking_reminder_48h','booking_reminder_24h','booking_reminder_1h','weekly_checkup','post_visit_feedback','coupon_expiry_14d','coupon_expiry_7d')),
  CONSTRAINT lifecycle_jobs_status_check CHECK (status IN ('pending','processing','retry_wait','cancelled','succeeded','dead_letter')),
  CONSTRAINT lifecycle_jobs_attempt_count_check CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT lifecycle_jobs_cancellation_reason_check CHECK (cancellation_reason IS NULL OR (char_length(cancellation_reason) BETWEEN 1 AND 64 AND cancellation_reason ~ '^[a-z][a-z0-9_]*$')),
  CONSTRAINT lifecycle_jobs_lease_check CHECK ((status = 'processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (status <> 'processing' AND lease_token IS NULL AND lease_until IS NULL))
);
CREATE INDEX lifecycle_jobs_due_claim_idx ON lifecycle_jobs (run_at, id) WHERE status IN ('pending','retry_wait');
CREATE INDEX lifecycle_jobs_lease_idx ON lifecycle_jobs (lease_until, id) WHERE status IN ('processing');
