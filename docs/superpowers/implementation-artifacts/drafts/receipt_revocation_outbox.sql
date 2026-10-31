-- DRAFT ONLY. Contains opaque tokens and pseudonymous contact IDs, never receipt data.
-- Entries are deleted once acknowledged. Independent of subject/contact FK so erasure cannot drop
-- an unresolved cancellation. Grant access only to reviewed privacy/worker roles.
CREATE TABLE receipt_revocation_outbox (
 subject_id uuid NOT NULL,
 contact_id uuid NOT NULL,
 token text NOT NULL CHECK(token ~ '^[a-f0-9]{64}$'),
 key_version text NOT NULL CHECK(key_version ~ '^[A-Za-z0-9_-]{1,64}$'),
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 acknowledged_at timestamptz,
 PRIMARY KEY(token,key_version),
 CHECK(acknowledged_at IS NULL OR acknowledged_at>=requested_at)
);
REVOKE ALL ON TABLE receipt_revocation_outbox FROM PUBLIC;
