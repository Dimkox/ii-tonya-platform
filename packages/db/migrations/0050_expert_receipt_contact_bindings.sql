ALTER TABLE expert_campaign_quotes ADD CONSTRAINT payer_receipt_quote_owner_unique UNIQUE(id,user_id);
--> statement-breakpoint
ALTER TABLE expert_residency_orders ADD CONSTRAINT payer_receipt_order_quote_unique UNIQUE(id,campaign_quote_id);
--> statement-breakpoint
CREATE TABLE payer_receipt_contacts (
  id uuid PRIMARY KEY,
  quote_id uuid NOT NULL,
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  kind text NOT NULL CHECK(kind='email'),
  basis text NOT NULL CHECK(basis='fiscal_payment_dec_plt_004_v1'),
  captured_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  key_id text,
  ciphertext text,
  redacted_at timestamptz,
  CONSTRAINT payer_receipt_quote_owner_fk FOREIGN KEY(quote_id,user_id) REFERENCES expert_campaign_quotes(id,user_id),
  CONSTRAINT payer_receipt_identity_unique UNIQUE(id,quote_id,user_id),
  CONSTRAINT payer_receipt_user_key_unique UNIQUE(user_id,idempotency_key),
  CONSTRAINT payer_receipt_key_valid CHECK(idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  CONSTRAINT payer_receipt_time_valid CHECK(isfinite(captured_at) AND isfinite(expires_at)
    AND captured_at=date_trunc('milliseconds',captured_at) AND expires_at=date_trunc('milliseconds',expires_at)
    AND expires_at>captured_at AND expires_at<=captured_at+interval '400 days'),
  CONSTRAINT payer_receipt_envelope_valid CHECK(
    (redacted_at IS NULL AND key_id IS NOT NULL AND key_id ~ '^[A-Za-z0-9_-]{1,64}$'
      AND ciphertext IS NOT NULL AND length(ciphertext) BETWEEN 45 AND 405 AND ciphertext ~ '^prc1\.[A-Za-z0-9_-]+$')
    OR (redacted_at IS NOT NULL AND isfinite(redacted_at) AND redacted_at>=captured_at AND key_id IS NULL AND ciphertext IS NULL))
);
--> statement-breakpoint
CREATE TABLE payer_receipt_order_bindings (
  order_id uuid PRIMARY KEY,
  contact_id uuid NOT NULL UNIQUE,
  quote_id uuid NOT NULL,
  user_id uuid NOT NULL,
  CONSTRAINT payer_receipt_binding_order_fk FOREIGN KEY(order_id,quote_id) REFERENCES expert_residency_orders(id,campaign_quote_id),
  CONSTRAINT payer_receipt_binding_contact_fk FOREIGN KEY(contact_id,quote_id,user_id) REFERENCES payer_receipt_contacts(id,quote_id,user_id)
);
--> statement-breakpoint
CREATE INDEX payer_receipt_cleanup ON payer_receipt_contacts(expires_at,id) WHERE redacted_at IS NULL;
--> statement-breakpoint
CREATE FUNCTION payer_receipt_redaction_due(contact payer_receipt_contacts) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT contact.expires_at<=clock_timestamp() OR (
    NOT EXISTS(SELECT 1 FROM payer_receipt_order_bindings b WHERE b.contact_id=contact.id)
    AND (EXISTS(SELECT 1 FROM expert_residency_orders o WHERE o.campaign_quote_id=contact.quote_id)
      OR NOT EXISTS(SELECT 1 FROM expert_campaign_quotes q
        JOIN users u ON u.id=q.user_id JOIN expert_residency_tariff_versions t ON t.id=q.tariff_version_id
        WHERE q.id=contact.quote_id AND u.active AND q.expires_at>clock_timestamp()
          AND t.active_from<=clock_timestamp() AND t.active_to>clock_timestamp())))
$$;
--> statement-breakpoint
CREATE FUNCTION protect_payer_receipt_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.redacted_at IS NOT NULL OR NEW.captured_at>clock_timestamp() OR NOT EXISTS(
      SELECT 1 FROM expert_campaign_quotes q JOIN users u ON u.id=q.user_id
      JOIN expert_residency_tariff_versions t ON t.id=q.tariff_version_id
      WHERE q.id=NEW.quote_id AND q.user_id=NEW.user_id AND u.active
        AND q.quoted_at<=NEW.captured_at AND q.expires_at>clock_timestamp()
        AND t.active_from<=clock_timestamp() AND t.active_to>clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM expert_residency_orders o WHERE o.campaign_quote_id=q.id)) THEN
      RAISE EXCEPTION 'payer_receipt_unavailable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL
    AND NEW.redacted_at<=clock_timestamp() AND NEW.key_id IS NULL AND NEW.ciphertext IS NULL
    AND (to_jsonb(NEW)-ARRAY['key_id','ciphertext','redacted_at'])=(to_jsonb(OLD)-ARRAY['key_id','ciphertext','redacted_at'])
    AND payer_receipt_redaction_due(OLD) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'payer_receipt_immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER payer_receipt_contact_guard BEFORE INSERT OR UPDATE OR DELETE ON payer_receipt_contacts
  FOR EACH ROW EXECUTE FUNCTION protect_payer_receipt_contact();
--> statement-breakpoint
CREATE FUNCTION protect_payer_receipt_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contact payer_receipt_contacts%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'payer_receipt_binding_immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO contact FROM payer_receipt_contacts WHERE id=NEW.contact_id FOR UPDATE;
  IF NOT FOUND OR contact.redacted_at IS NOT NULL OR contact.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'payer_receipt_unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payer_receipt_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON payer_receipt_order_bindings
  FOR EACH ROW EXECUTE FUNCTION protect_payer_receipt_binding();
