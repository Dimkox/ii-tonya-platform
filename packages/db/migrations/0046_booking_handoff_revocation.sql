-- Local accounting is not evidence of historical disclosure or remote deletion.
CREATE TABLE booking_handoff_revocation_receipts (
  source_outbox_id uuid PRIMARY KEY REFERENCES integration_outbox(id),
  consent_decision_id uuid REFERENCES consents(id),
  outcome text NOT NULL,
  coverage text NOT NULL,
  known_recipient_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_handoff_revocation_outcome_check CHECK (
    (outcome = 'processed' AND consent_decision_id IS NOT NULL AND coverage = 'historical_disclosure_untracked') OR
    (outcome = 'quarantined_invalid' AND consent_decision_id IS NULL AND coverage = 'invalid_source') OR
    (outcome = 'quarantined_legacy' AND consent_decision_id IS NOT NULL AND coverage = 'historical_disclosure_untracked')
  ),
  CONSTRAINT booking_handoff_revocation_recipient_count_check CHECK (known_recipient_count = 0)
);
--> statement-breakpoint
CREATE TRIGGER booking_handoff_revocation_receipts_append_only
BEFORE UPDATE OR DELETE ON booking_handoff_revocation_receipts
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
