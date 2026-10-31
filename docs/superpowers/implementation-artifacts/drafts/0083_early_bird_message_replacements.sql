-- Draft: immutable delivery text for an approved wave message that was never sent.
-- Claim stores only a hash. Runtime must keep its random token private in memory,
-- consume this capability before network IO, and never recover it after a crash.
CREATE TABLE early_bird_message_dispatch_claims (
 event_id uuid PRIMARY KEY REFERENCES resident_review_events(id),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE early_bird_message_dispatch_consumptions (
 event_id uuid PRIMARY KEY REFERENCES early_bird_message_dispatch_claims(event_id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION early_bird_message_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'early_bird_claim_immutable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF TG_TABLE_NAME='early_bird_message_dispatch_claims' AND NOT EXISTS(SELECT 1 FROM resident_review_messages m WHERE m.event_id=NEW.event_id AND m.user_id=NEW.user_id AND m.status='pending' AND m.attempts=0) THEN RAISE EXCEPTION 'early_bird_claim_source'; END IF;
 IF TG_TABLE_NAME='early_bird_message_dispatch_consumptions' AND NOT EXISTS(SELECT 1 FROM early_bird_message_dispatch_claims c WHERE c.event_id=NEW.event_id AND c.user_id=NEW.user_id) THEN RAISE EXCEPTION 'early_bird_claim_source'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER early_bird_message_dispatch_claim_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_message_dispatch_claims FOR EACH ROW EXECUTE FUNCTION early_bird_message_claim_guard();
CREATE TRIGGER early_bird_message_dispatch_consumption_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_message_dispatch_consumptions FOR EACH ROW EXECUTE FUNCTION early_bird_message_claim_guard();
CREATE TABLE early_bird_message_replacements (
 event_id uuid PRIMARY KEY REFERENCES resident_review_events(id),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 original_hash text NOT NULL CHECK(original_hash ~ '^[a-f0-9]{64}$'),
 replacement_text text NOT NULL CHECK(length(replacement_text)<=4096 AND octet_length(replacement_text)<=12000),
 replacement_hash text NOT NULL CHECK(replacement_hash=encode(digest(replacement_text,'sha256'),'hex')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION early_bird_message_replacement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text; selected_grant uuid; current_grant uuid; policy text; start_at timestamptz;
BEGIN
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'early_bird_replacement_immutable'; END IF;
 LOCK TABLE consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 SELECT client_start_at INTO start_at FROM early_bird_launch_configs WHERE active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_replacement_source'; END IF;
 SELECT s.grant_id,base.consent_version, 'Здравствуйте!'||E'\n\n'||'Анкета одобрена. Категория: '||CASE e.action WHEN 'APPROVED_BASIC' THEN 'Базовая' ELSE 'Эксклюзивная' END||'. Платформа открыта для клиентов. Актуальные условия участия доступны в /my_tariff.'||CASE coalesce(p.variables->>'tone','standard') WHEN 'warm' THEN E'\n\nСпасибо за уделённое время.' WHEN 'brief' THEN E'\n\nКоманда ии-Тоня.' ELSE '' END INTO selected_grant,policy,expected
 FROM resident_review_messages m JOIN resident_review_events e ON e.id=m.event_id JOIN resident_review_previews p ON p.id=e.preview_id JOIN residents_applications f ON f.id=m.application_id AND f.user_id=m.user_id AND f.is_current AND f.status=e.action JOIN users u ON u.id=m.user_id AND u.active JOIN early_bird_form_bridges b ON b.form_id=f.id AND b.user_id=f.user_id JOIN early_bird_choices c ON c.id=b.choice_id AND c.user_id=b.user_id JOIN expert_sales_bases base ON base.id=c.base_id AND base.user_id=c.user_id JOIN early_bird_positive_price_snapshots s ON s.positive_choice_id=c.positive_choice_id AND s.user_id=c.user_id AND s.base_id=c.base_id
 WHERE m.event_id=NEW.event_id AND m.user_id=NEW.user_id AND ((m.status='pending' AND m.attempts=0) OR (m.status='dispatched' AND m.attempts=1 AND EXISTS(SELECT 1 FROM early_bird_message_dispatch_claims claim WHERE claim.event_id=m.event_id AND claim.user_id=m.user_id AND claim.token_hash=encode(digest(coalesce(current_setting('early_bird.replacement_token',true),''),'sha256'),'hex') AND NOT EXISTS(SELECT 1 FROM early_bird_message_dispatch_consumptions consumed WHERE consumed.event_id=claim.event_id)))) AND e.action IN('APPROVED_BASIC','APPROVED_EXCLUSIVE') AND m.final_hash=e.final_hash AND NEW.original_hash=m.final_hash AND strpos(m.final_text,'Старт для клиентов — ')>0
 FOR SHARE OF m,e,p,f,u,b,c,base,s;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_replacement_source'; END IF;
 SELECT id INTO current_grant FROM owner_test_pricing_grants WHERE user_id=NEW.user_id AND revoked_at IS NULL AND provider_mode='live' FOR SHARE;
 IF current_grant IS DISTINCT FROM selected_grant OR NOT expert_card_current_messaging_authority(NEW.user_id,policy) OR early_bird_current_time()<start_at OR NEW.replacement_text IS DISTINCT FROM expected THEN RAISE EXCEPTION 'early_bird_replacement_source'; END IF;
 NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER early_bird_message_replacement_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_message_replacements FOR EACH ROW EXECUTE FUNCTION early_bird_message_replacement_guard();
CREATE FUNCTION early_bird_message_replacement_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM early_bird_message_replacements WHERE user_id=NEW.user_id;
 DELETE FROM early_bird_message_dispatch_consumptions WHERE user_id=NEW.user_id;
 DELETE FROM early_bird_message_dispatch_claims WHERE user_id=NEW.user_id;
 RETURN NULL;
END $$;
CREATE TRIGGER early_bird_message_replacement_erasure AFTER INSERT ON expert_sales_erased_cohorts FOR EACH ROW EXECUTE FUNCTION early_bird_message_replacement_erasure();

-- The caller's in-memory runtime capability must be consumed before notifier IO.
-- The database verifies the token but cannot prove whether an external call began.
CREATE FUNCTION early_bird_replace_dispatched(target_event uuid,target_user uuid,target_text text,target_token text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF target_token IS NULL OR target_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'early_bird_claim_invalid'; END IF;
 LOCK TABLE consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 IF NOT EXISTS(SELECT 1 FROM early_bird_message_dispatch_claims c JOIN resident_review_messages m ON m.event_id=c.event_id AND m.user_id=c.user_id WHERE c.event_id=target_event AND c.user_id=target_user AND c.token_hash=encode(digest(target_token,'sha256'),'hex') AND m.status='dispatched' AND m.attempts=1 AND NOT EXISTS(SELECT 1 FROM early_bird_message_dispatch_consumptions done WHERE done.event_id=c.event_id)) THEN RAISE EXCEPTION 'early_bird_claim_invalid'; END IF;
 PERFORM set_config('early_bird.replacement_token',target_token,true);
 INSERT INTO early_bird_message_replacements(event_id,user_id,original_hash,replacement_text,replacement_hash) SELECT m.event_id,m.user_id,m.final_hash,target_text,encode(digest(target_text,'sha256'),'hex') FROM resident_review_messages m WHERE m.event_id=target_event AND m.user_id=target_user;
 INSERT INTO early_bird_message_dispatch_consumptions(event_id,user_id) VALUES(target_event,target_user);
 PERFORM set_config('early_bird.replacement_token','',true);
END $$;
