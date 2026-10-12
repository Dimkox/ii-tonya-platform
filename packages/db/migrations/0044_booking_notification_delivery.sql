-- Hand-authored SQL. No historical event is replayed or assigned new consent.
CREATE TABLE booking_notification_contexts (
 reservation_id uuid PRIMARY KEY REFERENCES reservations(id),
 bot_key text NOT NULL CHECK(length(bot_key)>0),
 client_user_id uuid NOT NULL REFERENCES users(id), expert_user_id uuid NOT NULL REFERENCES users(id),
 client_identity_id uuid REFERENCES channel_identities(id) ON DELETE SET NULL,
 client_original_identity_id uuid, client_external_user_id text, client_external_chat_id text,
 client_unavailable_reason text CHECK(client_unavailable_reason IN ('recipient_unavailable','erased')),
 expert_identity_id uuid REFERENCES channel_identities(id) ON DELETE SET NULL,
 expert_original_identity_id uuid, expert_external_user_id text, expert_external_chat_id text,
 expert_unavailable_reason text CHECK(expert_unavailable_reason IN ('recipient_unavailable','erased')),
 client_consent_authority jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT booking_notification_client_tuple CHECK (
  (client_original_identity_id IS NOT NULL AND client_external_user_id IS NOT NULL AND client_external_chat_id IS NOT NULL AND client_external_user_id ~ '^[1-9][0-9]{0,15}$' AND client_external_chat_id=client_external_user_id AND client_unavailable_reason IS NULL)
  OR (client_original_identity_id IS NULL AND client_external_user_id IS NULL AND client_external_chat_id IS NULL AND client_unavailable_reason IS NOT NULL)),
 CONSTRAINT booking_notification_expert_tuple CHECK (
  (expert_original_identity_id IS NOT NULL AND expert_external_user_id IS NOT NULL AND expert_external_chat_id IS NOT NULL AND expert_external_user_id ~ '^[1-9][0-9]{0,15}$' AND expert_external_chat_id=expert_external_user_id AND expert_unavailable_reason IS NULL)
  OR (expert_original_identity_id IS NULL AND expert_external_user_id IS NULL AND expert_external_chat_id IS NULL AND expert_unavailable_reason IS NOT NULL)),
 CONSTRAINT booking_notification_consent_shape CHECK(client_consent_authority IS NULL OR ((
  jsonb_typeof(client_consent_authority)='object'
  AND client_consent_authority - ARRAY['v','subjectId','purposes']='{}'::jsonb
  AND client_consent_authority->'v'='1'::jsonb
  AND client_consent_authority->>'subjectId'=client_user_id::text
  AND jsonb_typeof(client_consent_authority->'purposes')='object'
  AND (client_consent_authority->'purposes') - 'client_messaging'='{}'::jsonb
  AND jsonb_typeof(client_consent_authority#>'{purposes,client_messaging}')='object'
  AND (client_consent_authority#>'{purposes,client_messaging}') - ARRAY['decisionId','revision']='{}'::jsonb
  AND client_consent_authority#>>'{purposes,client_messaging,decisionId}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND jsonb_typeof(client_consent_authority#>'{purposes,client_messaging,revision}')='string'
  AND client_consent_authority#>>'{purposes,client_messaging,revision}' ~ '^[1-9][0-9]{0,18}$'
  AND (client_consent_authority#>>'{purposes,client_messaging,revision}')::numeric<=9223372036854775807
 ) IS TRUE))
);
--> statement-breakpoint
CREATE FUNCTION booking_notification_context_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'booking_notification_context_immutable'; END IF;
 -- FK removal is permitted; captured originals remain immutable. Privacy may only redact.
 IF (to_jsonb(NEW)-ARRAY['client_identity_id','expert_identity_id','client_original_identity_id','client_external_user_id','client_external_chat_id','client_unavailable_reason','expert_original_identity_id','expert_external_user_id','expert_external_chat_id','expert_unavailable_reason','client_consent_authority']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['client_identity_id','expert_identity_id','client_original_identity_id','client_external_user_id','client_external_chat_id','client_unavailable_reason','expert_original_identity_id','expert_external_user_id','expert_external_chat_id','expert_unavailable_reason','client_consent_authority'])
 OR (NEW.client_identity_id IS DISTINCT FROM OLD.client_identity_id AND NEW.client_identity_id IS NOT NULL)
 OR (NEW.expert_identity_id IS DISTINCT FROM OLD.expert_identity_id AND NEW.expert_identity_id IS NOT NULL)
 OR (ROW(NEW.client_original_identity_id,NEW.client_external_user_id,NEW.client_external_chat_id,NEW.client_unavailable_reason) IS DISTINCT FROM ROW(OLD.client_original_identity_id,OLD.client_external_user_id,OLD.client_external_chat_id,OLD.client_unavailable_reason) AND NOT (NEW.client_original_identity_id IS NULL AND NEW.client_external_user_id IS NULL AND NEW.client_external_chat_id IS NULL AND NEW.client_unavailable_reason='erased'))
 OR (ROW(NEW.expert_original_identity_id,NEW.expert_external_user_id,NEW.expert_external_chat_id,NEW.expert_unavailable_reason) IS DISTINCT FROM ROW(OLD.expert_original_identity_id,OLD.expert_external_user_id,OLD.expert_external_chat_id,OLD.expert_unavailable_reason) AND NOT (NEW.expert_original_identity_id IS NULL AND NEW.expert_external_user_id IS NULL AND NEW.expert_external_chat_id IS NULL AND NEW.expert_unavailable_reason='erased'))
 OR (NEW.client_consent_authority IS DISTINCT FROM OLD.client_consent_authority AND NEW.client_consent_authority IS NOT NULL)
 THEN RAISE EXCEPTION 'booking_notification_context_immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER booking_notification_context_immutable BEFORE UPDATE OR DELETE ON booking_notification_contexts FOR EACH ROW EXECUTE FUNCTION booking_notification_context_immutable();
--> statement-breakpoint
CREATE TABLE booking_notification_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_outbox_id uuid NOT NULL REFERENCES integration_outbox(id),
 reservation_id uuid NOT NULL REFERENCES reservations(id), recipient_role text NOT NULL CHECK(recipient_role IN ('client','expert')),
 recipient_user_id uuid NOT NULL REFERENCES users(id), recipient_identity_id uuid REFERENCES channel_identities(id) ON DELETE SET NULL,
 original_identity_id uuid, bot_key text NOT NULL, external_user_id text, external_chat_id text,
 kind text NOT NULL CHECK(kind IN ('telegram.reservation_request','client.booking_confirmed','telegram.booking_cancelled','client.booking_cancelled','client.reservation_expired','expert.reservation_expired','client.booking_completed','client.booking_no_show')),
 source_version integer CHECK(source_version>0), provider_operation_id uuid REFERENCES planerka_booking_operations(id),
 template_version integer NOT NULL DEFAULT 1 CHECK(template_version=1),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','retry_wait','sending','delivered','suppressed','unknown','manual','failed')),
 reason_code text, attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), lease_token uuid, lease_until timestamptz, worker_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz,
 UNIQUE(source_outbox_id,recipient_role),
 CHECK ((external_user_id IS NULL AND external_chat_id IS NULL AND original_identity_id IS NULL) OR
 (external_user_id IS NOT NULL AND external_chat_id IS NOT NULL AND external_user_id ~ '^[1-9][0-9]{0,15}$' AND external_chat_id=external_user_id AND original_identity_id IS NOT NULL)),
 CHECK((lease_token IS NULL)=(lease_until IS NULL)),
 CONSTRAINT booking_notification_lease_shape CHECK((lease_token IS NULL)=(worker_id IS NULL) AND (worker_id IS NULL OR length(worker_id)>0)),
 CONSTRAINT booking_notification_state_lease CHECK(
  (state IN ('pending','retry_wait')) OR
  (state='sending' AND lease_token IS NOT NULL AND attempt_count>0) OR
  (state IN ('delivered','suppressed','unknown','manual','failed') AND lease_token IS NULL))
);
--> statement-breakpoint
CREATE INDEX booking_notification_deliveries_due ON booking_notification_deliveries(next_attempt_at,id) WHERE state IN ('pending','retry_wait');
--> statement-breakpoint
CREATE TABLE booking_notification_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id uuid NOT NULL REFERENCES booking_notification_deliveries(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 5), claim_token uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'), admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 bot_key text NOT NULL, chat_id text NOT NULL,
 outcome text NOT NULL DEFAULT 'started' CHECK(outcome='started'),
 UNIQUE(delivery_id,ordinal), UNIQUE(claim_token)
);
--> statement-breakpoint
-- Append-only facts retain an unknown outcome even if a later receipt resolves it.
CREATE TABLE booking_notification_attempt_facts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid NOT NULL REFERENCES booking_notification_attempts(id),
 outcome text NOT NULL CHECK(outcome IN ('not_applied','applied','unknown','failed')),
 bot_key text, response_chat_id text, telegram_message_id bigint,
 retry_after_seconds integer CHECK(retry_after_seconds BETWEEN 0 AND 2147483647),
 reason_code text NOT NULL, resolved_at timestamptz NOT NULL DEFAULT clock_timestamp(), resolution_evidence_ref text,
 UNIQUE(attempt_id,outcome), UNIQUE(bot_key,response_chat_id,telegram_message_id),
 CHECK((outcome='applied' AND bot_key IS NOT NULL AND response_chat_id IS NOT NULL AND telegram_message_id IS NOT NULL AND telegram_message_id>0)
 OR (outcome<>'applied' AND bot_key IS NULL AND response_chat_id IS NULL AND telegram_message_id IS NULL))
);
--> statement-breakpoint
CREATE FUNCTION booking_notification_fact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'booking_notification_attempt_immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER booking_notification_attempt_immutable BEFORE UPDATE OR DELETE ON booking_notification_attempts FOR EACH ROW EXECUTE FUNCTION booking_notification_fact_immutable();
--> statement-breakpoint
CREATE TRIGGER booking_notification_fact_immutable BEFORE UPDATE OR DELETE ON booking_notification_attempt_facts FOR EACH ROW EXECUTE FUNCTION booking_notification_fact_immutable();
--> statement-breakpoint
CREATE FUNCTION booking_notification_delivery_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'booking_notification_delivery_immutable'; END IF;
 IF ROW(NEW.id,NEW.source_outbox_id,NEW.reservation_id,NEW.recipient_role,NEW.recipient_user_id,NEW.bot_key,NEW.kind,NEW.source_version,NEW.provider_operation_id,NEW.template_version,NEW.created_at,NEW.expires_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.source_outbox_id,OLD.reservation_id,OLD.recipient_role,OLD.recipient_user_id,OLD.bot_key,OLD.kind,OLD.source_version,OLD.provider_operation_id,OLD.template_version,OLD.created_at,OLD.expires_at)
 OR (NEW.recipient_identity_id IS DISTINCT FROM OLD.recipient_identity_id AND NEW.recipient_identity_id IS NOT NULL)
 OR (ROW(NEW.original_identity_id,NEW.external_user_id,NEW.external_chat_id) IS DISTINCT FROM ROW(OLD.original_identity_id,OLD.external_user_id,OLD.external_chat_id)
     AND NOT (NEW.original_identity_id IS NULL AND NEW.external_user_id IS NULL AND NEW.external_chat_id IS NULL AND NEW.recipient_identity_id IS NULL AND NEW.state IN ('delivered','suppressed','unknown','manual','failed')))
 THEN RAISE EXCEPTION 'booking_notification_delivery_immutable'; END IF;
 IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
   (OLD.state='pending' AND NEW.state IN ('sending','suppressed')) OR
   (OLD.state='retry_wait' AND NEW.state IN ('sending','suppressed')) OR
   (OLD.state='sending' AND NEW.state IN ('retry_wait','delivered','unknown','manual','failed')) OR
   (OLD.state='unknown' AND NEW.state IN ('manual','delivered')) OR
   (OLD.state='manual' AND NEW.state='delivered'))
 THEN RAISE EXCEPTION 'booking_notification_transition_invalid'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER booking_notification_delivery_immutable BEFORE UPDATE OR DELETE ON booking_notification_deliveries FOR EACH ROW EXECUTE FUNCTION booking_notification_delivery_immutable();
--> statement-breakpoint
-- Deferred: attempts are inserted before the delivery becomes sending in the same
-- transaction. Validate the final cross-table state, never an intermediate row.
CREATE FUNCTION booking_notification_attempt_state_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d booking_notification_deliveries%ROWTYPE; a booking_notification_attempts%ROWTYPE; target uuid;
BEGIN
 IF TG_TABLE_NAME='booking_notification_deliveries' THEN target=NEW.id;
 ELSIF TG_TABLE_NAME='booking_notification_attempts' THEN target=NEW.delivery_id;
 ELSE SELECT delivery_id INTO target FROM booking_notification_attempts WHERE id=NEW.attempt_id; END IF;
 SELECT * INTO d FROM booking_notification_deliveries WHERE id=target FOR UPDATE;
 IF d.attempt_count<>(SELECT count(*) FROM booking_notification_attempts WHERE delivery_id=target)
 THEN RAISE EXCEPTION 'booking_notification_attempt_count_invalid'; END IF;
 IF d.attempt_count>0 THEN
  SELECT * INTO a FROM booking_notification_attempts WHERE delivery_id=target AND ordinal=d.attempt_count;
  IF NOT FOUND OR a.bot_key IS DISTINCT FROM d.bot_key OR
    (d.external_chat_id IS NOT NULL AND a.chat_id IS DISTINCT FROM d.external_chat_id)
  THEN RAISE EXCEPTION 'booking_notification_attempt_binding_invalid'; END IF;
 END IF;
 IF d.state='sending' AND (a.id IS NULL OR a.claim_token IS DISTINCT FROM d.lease_token OR EXISTS(SELECT 1 FROM booking_notification_attempt_facts WHERE attempt_id=a.id))
 THEN RAISE EXCEPTION 'booking_notification_sending_invalid'; END IF;
 IF d.state='delivered' AND NOT EXISTS(SELECT 1 FROM booking_notification_attempt_facts WHERE attempt_id=a.id AND outcome='applied')
 THEN RAISE EXCEPTION 'booking_notification_receipt_required'; END IF;
 IF d.state IN ('unknown','manual') AND NOT EXISTS(SELECT 1 FROM booking_notification_attempt_facts WHERE attempt_id=a.id AND outcome='unknown')
 THEN RAISE EXCEPTION 'booking_notification_uncertainty_required'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER booking_notification_delivery_attempt_state AFTER INSERT OR UPDATE ON booking_notification_deliveries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_notification_attempt_state_valid();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER booking_notification_attempt_delivery_state AFTER INSERT ON booking_notification_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_notification_attempt_state_valid();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER booking_notification_fact_delivery_state AFTER INSERT ON booking_notification_attempt_facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_notification_attempt_state_valid();
--> statement-breakpoint
CREATE TABLE booking_notification_callbacks (
 delivery_id uuid NOT NULL REFERENCES booking_notification_deliveries(id), action text NOT NULL CHECK(action IN ('confirm','cancel')),
 notification_id uuid NOT NULL UNIQUE REFERENCES notifications(id), callback_token_hash text NOT NULL CHECK(callback_token_hash ~ '^[a-f0-9]{64}$'), callback_token_ciphertext text, encryption_key_id text, expires_at timestamptz NOT NULL,
 PRIMARY KEY(delivery_id,action), CHECK((callback_token_ciphertext IS NULL)=(encryption_key_id IS NULL))
);
