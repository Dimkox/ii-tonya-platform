ALTER TABLE dialogues ADD COLUMN next_delivery_sequence bigint NOT NULL DEFAULT 0;
ALTER TABLE dialogues ADD CONSTRAINT dialogues_delivery_sequence_nonnegative CHECK (next_delivery_sequence >= 0);

ALTER TABLE integration_outbox ADD COLUMN dialogue_id uuid REFERENCES dialogues(id);
ALTER TABLE integration_outbox ADD COLUMN dialogue_sequence bigint;
ALTER TABLE integration_outbox ADD COLUMN sensitive_redacted_at timestamptz;
ALTER TABLE integration_outbox ADD CONSTRAINT integration_outbox_dialogue_order_pair CHECK ((dialogue_id IS NULL) = (dialogue_sequence IS NULL));
ALTER TABLE integration_outbox ADD CONSTRAINT integration_outbox_dialogue_sequence_positive CHECK (dialogue_sequence IS NULL OR dialogue_sequence > 0);
CREATE UNIQUE INDEX integration_outbox_dialogue_sequence_unique ON integration_outbox(dialogue_id, dialogue_sequence) WHERE dialogue_id IS NOT NULL;
CREATE INDEX integration_outbox_dialogue_order_claim_idx ON integration_outbox(dialogue_id, dialogue_sequence, status) WHERE topic = 'telegram.send_text.v1' AND dialogue_id IS NOT NULL;

CREATE TABLE selarti_response_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL UNIQUE,
  dialogue_id uuid NOT NULL REFERENCES dialogues(id),
  tenant_key text NOT NULL,
  request_payload_hash char(64) NOT NULL,
  response_payload_hash char(64) NOT NULL,
  text text,
  accepted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  redacted_at timestamptz,
  CONSTRAINT selarti_response_proposals_hash_check CHECK (request_payload_hash ~ '^[0-9a-f]{64}$' AND response_payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT selarti_response_proposals_text_check CHECK (text IS NULL OR (char_length(text) BETWEEN 1 AND 4096 AND text !~ '[[:cntrl:]]')),
  CONSTRAINT selarti_response_proposals_expiry_check CHECK (expires_at = accepted_at + interval '30 days'),
  CONSTRAINT selarti_response_proposals_redaction_check CHECK ((text IS NULL) = (redacted_at IS NOT NULL))
);
CREATE INDEX selarti_response_proposals_expiry_idx ON selarti_response_proposals(expires_at, id) WHERE redacted_at IS NULL;

CREATE TABLE dialogue_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dialogue_id uuid NOT NULL REFERENCES dialogues(id),
  dialogue_sequence bigint NOT NULL,
  source text NOT NULL,
  source_id text NOT NULL,
  outbox_id uuid NOT NULL UNIQUE REFERENCES integration_outbox(id),
  payload_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dialogue_deliveries_sequence_positive CHECK (dialogue_sequence > 0),
  CONSTRAINT dialogue_deliveries_source_check CHECK (source IN ('deterministic','selarti')),
  CONSTRAINT dialogue_deliveries_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT dialogue_deliveries_dialogue_sequence_unique UNIQUE(dialogue_id, dialogue_sequence),
  CONSTRAINT dialogue_deliveries_source_unique UNIQUE(source, source_id)
);
CREATE INDEX dialogue_deliveries_order_idx ON dialogue_deliveries(dialogue_id, dialogue_sequence);

CREATE TABLE dialogue_inbound_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dialogue_id uuid NOT NULL REFERENCES dialogues(id),
  provider text NOT NULL,
  bot_key text NOT NULL,
  provider_update_id bigint NOT NULL,
  payload_hash char(64) NOT NULL,
  route text NOT NULL,
  occurred_at timestamptz NOT NULL,
  purged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dialogue_inbound_tombstones_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT dialogue_inbound_tombstones_route_check CHECK (route IN ('deterministic','complex_dialogue')),
  CONSTRAINT dialogue_inbound_tombstones_scope_unique UNIQUE(provider, bot_key, provider_update_id)
);
