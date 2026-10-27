-- Control provisioning is explicit. No seed row or restart may enable admission.
CREATE TABLE booking_notification_bot_controls (
 bot_key text PRIMARY KEY CHECK(length(bot_key) BETWEEN 1 AND 128),
 admission_enabled boolean NOT NULL DEFAULT false,
 paused_at timestamptz,
 pause_reason text CHECK(pause_reason IN ('bot_rejected','bot_mismatch','request_invalid')),
 not_before timestamptz NOT NULL DEFAULT '-infinity',
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((paused_at IS NULL) = (pause_reason IS NULL))
);
--> statement-breakpoint
-- NULL is legacy caller-provided digest evidence, never upgraded retroactively.
ALTER TABLE booking_notification_attempts ADD COLUMN wire_version integer CHECK(wire_version=1);
