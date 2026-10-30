-- Draft only. Wave contacts are separate from legacy quote/order contacts.
CREATE TABLE early_bird_receipt_contacts (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 choice_id uuid NOT NULL,
 idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
 captured_at timestamptz NOT NULL CHECK(isfinite(captured_at) AND captured_at=date_trunc('milliseconds',captured_at)),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at=date_trunc('milliseconds',expires_at) AND expires_at>captured_at AND expires_at<=captured_at+interval '12 hours'),
 key_id text NOT NULL CHECK(key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 ciphertext text NOT NULL CHECK(ciphertext ~ '^prc1\.[A-Za-z0-9_-]+$' AND length(ciphertext) BETWEEN 45 AND 405),
 FOREIGN KEY(choice_id,user_id) REFERENCES early_bird_choices(id,user_id) ON DELETE CASCADE,
 UNIQUE(user_id,idempotency_key), UNIQUE(choice_id,user_id)
);
REVOKE ALL ON TABLE early_bird_receipt_contacts FROM PUBLIC;
CREATE FUNCTION early_bird_receipt_authorized(target_user uuid,target_choice uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM early_bird_choices c JOIN expert_sales_bases b ON b.id=c.base_id AND b.user_id=c.user_id JOIN users u ON u.id=c.user_id
   WHERE c.id=target_choice AND c.user_id=target_user AND c.choice='now' AND u.active
     AND NOT EXISTS(SELECT 1 FROM expert_sales_erased_cohorts erased WHERE erased.user_id=c.user_id)
     AND c.id=(SELECT latest.id FROM early_bird_choices latest WHERE latest.user_id=c.user_id AND latest.base_id=c.base_id ORDER BY latest.decision_no DESC LIMIT 1)
     AND early_bird_wave_active(early_bird_current_time()) AND early_bird_composite_qualification(c.user_id,c.id)
     AND expert_card_current_messaging_authority(c.user_id,b.consent_version))
$$;
-- Expired bodies may be discarded even after a provider outcome becomes unknown.
-- The opaque intent/settlement metadata remains available for reconciliation.
CREATE OR REPLACE FUNCTION early_bird_composite_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  LOCK TABLE consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.user_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id) OR EXISTS(SELECT 1 FROM early_bird_composite_intents WHERE id=OLD.intent_id AND status='prepared') OR OLD.expires_at<=clock_timestamp() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'early_bird_request_immutable';
 END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'early_bird_request_immutable'; END IF;
 LOCK TABLE consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.expires_at<=clock_timestamp() OR NEW.expires_at>clock_timestamp()+interval '23 hours' OR NOT EXISTS(SELECT 1 FROM early_bird_composite_intents i WHERE i.id=NEW.intent_id AND i.user_id=NEW.user_id AND i.status='prepared' AND i.idempotency_key=NEW.idempotency_key AND i.request_digest=NEW.request_digest) THEN RAISE EXCEPTION 'early_bird_request_source'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION early_bird_receipt_contact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   LOCK TABLE consent_document_versions IN SHARE MODE;
   PERFORM pg_advisory_xact_lock(hashtextextended(OLD.user_id::text,0));
   IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id) THEN RETURN OLD; END IF;
   IF OLD.expires_at<=clock_timestamp() THEN
     UPDATE early_bird_composite_intents SET status='abandoned' WHERE user_id=OLD.user_id AND choice_id=OLD.choice_id AND status='prepared';
     DELETE FROM early_bird_composite_requests WHERE user_id=OLD.user_id AND expires_at<=clock_timestamp();
     RETURN OLD;
   END IF;
   RAISE EXCEPTION 'early_bird_receipt_immutable';
 END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'early_bird_receipt_immutable'; END IF;
 LOCK TABLE consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.captured_at>clock_timestamp() OR NEW.expires_at<=clock_timestamp() OR NOT early_bird_receipt_authorized(NEW.user_id,NEW.choice_id) THEN RAISE EXCEPTION 'early_bird_receipt_source'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER early_bird_receipt_contact_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_receipt_contacts FOR EACH ROW EXECUTE FUNCTION early_bird_receipt_contact_guard();
CREATE FUNCTION early_bird_receipt_erase() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 DELETE FROM early_bird_composite_intents WHERE user_id=NEW.user_id;
 DELETE FROM early_bird_receipt_contacts WHERE user_id=NEW.user_id;
 RETURN NEW;
END $$;
CREATE TRIGGER early_bird_receipt_erase AFTER INSERT ON expert_sales_erased_cohorts FOR EACH ROW EXECUTE FUNCTION early_bird_receipt_erase();
