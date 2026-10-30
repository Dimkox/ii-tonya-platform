-- DRAFT ONLY. No grants, provider dispatch or production migration are included.
-- Only an independently verified provider principal may bind and settle a payment.
CREATE TABLE early_bird_deferred_accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  base_id uuid NOT NULL,
  choice_id uuid NOT NULL,
  grant_id uuid,
  config_id uuid NOT NULL REFERENCES early_bird_launch_configs(id),
  policy_version text NOT NULL,
  onboarding_minor bigint NOT NULL CHECK(onboarding_minor > 0),
  subscription_minor bigint NOT NULL CHECK(subscription_minor > 0),
  launch_at timestamptz NOT NULL CHECK(isfinite(launch_at)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,user_id),
  FOREIGN KEY(base_id,user_id) REFERENCES expert_sales_bases(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(choice_id,user_id) REFERENCES early_bird_choices(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(grant_id,user_id) REFERENCES owner_test_pricing_grants(id,user_id) ON DELETE CASCADE,
  CHECK((policy_version='wave1_standard_v1' AND grant_id IS NULL AND onboarding_minor=300000)
     OR (policy_version='owner_test_10_20_v1' AND grant_id IS NOT NULL AND onboarding_minor=1000 AND subscription_minor=2000))
);
CREATE TABLE early_bird_deferred_invoices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  stage text NOT NULL CHECK(stage IN ('onboarding','subscription')),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  idempotency_key uuid NOT NULL UNIQUE,
  provider_id text UNIQUE CHECK(provider_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  evidence_digest text CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  captured_at timestamptz CHECK(isfinite(captured_at)),
  UNIQUE(account_id,stage),
  FOREIGN KEY(account_id,user_id) REFERENCES early_bird_deferred_accounts(id,user_id) ON DELETE CASCADE,
  CHECK ((provider_id IS NULL AND evidence_digest IS NULL AND captured_at IS NULL)
      OR (provider_id IS NOT NULL AND evidence_digest IS NOT NULL AND captured_at IS NOT NULL))
);
REVOKE ALL ON early_bird_deferred_accounts, early_bird_deferred_invoices FROM PUBLIC;

-- All security-definer capabilities are revoked by default. No role is granted them here.
CREATE FUNCTION early_bird_deferred_prepare(target_account uuid, target_user uuid, target_base uuid, target_choice uuid, target_config uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snap public.early_bird_positive_price_snapshots%ROWTYPE; prior public.early_bird_deferred_accounts%ROWTYPE; launch_time timestamptz;
BEGIN
  LOCK TABLE public.consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
  SELECT s.* INTO snap FROM public.early_bird_choices c
  JOIN public.early_bird_positive_price_snapshots s ON s.positive_choice_id=c.positive_choice_id AND s.user_id=c.user_id AND s.base_id=c.base_id
  JOIN public.expert_sales_bases b ON b.id=c.base_id AND b.user_id=c.user_id
  JOIN public.users u ON u.id=c.user_id AND u.active
  WHERE c.id=target_choice AND c.user_id=target_user AND c.base_id=target_base AND c.choice='later'
    AND c.id=(SELECT id FROM public.early_bird_choices WHERE base_id=target_base ORDER BY decision_no DESC LIMIT 1)
    AND public.expert_card_current_messaging_authority(target_user,b.consent_version)
  FOR SHARE OF c,s,b,u;
  IF NOT FOUND OR NOT public.early_bird_composite_qualification(target_user,target_choice) THEN RAISE EXCEPTION 'early_bird_deferred_source'; END IF;
  SELECT client_start_at INTO launch_time FROM public.early_bird_launch_configs WHERE id=target_config AND active AND phase='WAVE_1_EARLY_BIRD' FOR SHARE;
  IF NOT FOUND OR NOT public.early_bird_wave_active(public.early_bird_current_time()) THEN RAISE EXCEPTION 'early_bird_deferred_phase'; END IF;
  IF (SELECT id FROM public.owner_test_pricing_grants WHERE user_id=target_user AND revoked_at IS NULL AND provider_mode='live' FOR SHARE) IS DISTINCT FROM snap.grant_id THEN RAISE EXCEPTION 'early_bird_deferred_grant'; END IF;
  IF EXISTS(SELECT 1 FROM public.early_bird_composite_intents WHERE user_id=target_user AND status IN ('prepared','unknown','settled')) OR EXISTS(SELECT 1 FROM public.expert_onboarding_invoices WHERE user_id=target_user) OR EXISTS(SELECT 1 FROM public.expert_sales_paid_locks WHERE user_id=target_user) THEN RAISE EXCEPTION 'early_bird_deferred_existing'; END IF;
  SELECT * INTO prior FROM public.early_bird_deferred_accounts WHERE user_id=target_user FOR UPDATE;
  IF FOUND THEN
    IF prior.id=target_account AND prior.base_id=target_base AND prior.choice_id=target_choice AND prior.config_id=target_config AND prior.grant_id IS NOT DISTINCT FROM snap.grant_id AND prior.policy_version=snap.policy_version AND prior.onboarding_minor=snap.onboarding_minor AND prior.subscription_minor=snap.base_monthly_minor AND prior.launch_at=launch_time THEN RETURN; END IF;
    RAISE EXCEPTION 'early_bird_deferred_account_conflict';
  END IF;
  INSERT INTO public.early_bird_deferred_accounts(id,user_id,base_id,choice_id,grant_id,config_id,policy_version,onboarding_minor,subscription_minor,launch_at)
  VALUES(target_account,target_user,target_base,target_choice,snap.grant_id,target_config,snap.policy_version,snap.onboarding_minor,snap.base_monthly_minor,launch_time);
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_prepare(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION early_bird_deferred_invoice(target_account uuid,target_user uuid,target_invoice uuid,target_key uuid,target_stage text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.early_bird_deferred_accounts%ROWTYPE; existing public.early_bird_deferred_invoices%ROWTYPE; amount bigint;
BEGIN
  LOCK TABLE public.consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
  SELECT * INTO a FROM public.early_bird_deferred_accounts WHERE id=target_account AND user_id=target_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_deferred_account'; END IF;
  PERFORM 1 FROM public.early_bird_launch_configs cfg JOIN public.expert_sales_bases b ON b.id=a.base_id AND b.user_id=a.user_id JOIN public.users u ON u.id=a.user_id JOIN public.early_bird_choices c ON c.id=a.choice_id AND c.user_id=a.user_id WHERE cfg.id=a.config_id FOR SHARE OF cfg,b,u,c;
  IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_deferred_authority'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.early_bird_launch_configs cfg JOIN public.expert_sales_bases b ON b.id=a.base_id AND b.user_id=a.user_id JOIN public.users u ON u.id=a.user_id AND u.active JOIN public.early_bird_choices c ON c.id=a.choice_id AND c.base_id=a.base_id AND c.user_id=a.user_id
      WHERE cfg.id=a.config_id AND cfg.active AND cfg.phase='WAVE_1_EARLY_BIRD' AND cfg.client_start_at=a.launch_at
        AND public.early_bird_current_time()<a.launch_at AND public.early_bird_wave_active(public.early_bird_current_time())
        AND c.choice='later' AND c.id=(SELECT id FROM public.early_bird_choices WHERE base_id=a.base_id ORDER BY decision_no DESC LIMIT 1)
        AND public.expert_card_current_messaging_authority(a.user_id,b.consent_version))
     OR NOT public.early_bird_composite_qualification(a.user_id,a.choice_id)
     OR (SELECT id FROM public.owner_test_pricing_grants WHERE user_id=a.user_id AND revoked_at IS NULL AND provider_mode='live' FOR SHARE) IS DISTINCT FROM a.grant_id
     OR EXISTS(SELECT 1 FROM public.early_bird_composite_intents WHERE user_id=a.user_id AND status IN ('prepared','unknown','settled'))
     OR EXISTS(SELECT 1 FROM public.expert_onboarding_invoices WHERE user_id=a.user_id)
     OR EXISTS(SELECT 1 FROM public.expert_sales_paid_locks WHERE user_id=a.user_id)
  THEN RAISE EXCEPTION 'early_bird_deferred_authority'; END IF;
  SELECT * INTO existing FROM public.early_bird_deferred_invoices WHERE account_id=a.id AND stage=target_stage;
  IF FOUND THEN
    IF existing.id=target_invoice AND existing.idempotency_key=target_key THEN RETURN existing.amount_minor; END IF;
    RAISE EXCEPTION 'early_bird_deferred_invoice_conflict';
  END IF;
  IF target_stage='onboarding' THEN amount:=a.onboarding_minor;
  ELSIF target_stage='subscription' THEN
    IF NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_invoices WHERE account_id=a.id AND stage='onboarding' AND captured_at IS NOT NULL) THEN RAISE EXCEPTION 'early_bird_deferred_onboarding_unpaid'; END IF;
    amount:=a.subscription_minor;
  ELSE RAISE EXCEPTION 'early_bird_deferred_stage'; END IF;
  INSERT INTO public.early_bird_deferred_invoices(id,account_id,user_id,stage,amount_minor,idempotency_key) VALUES(target_invoice,a.id,target_user,target_stage,amount,target_key);
  RETURN amount;
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_invoice(uuid,uuid,uuid,uuid,text) FROM PUBLIC;

-- Separate provider-verifier capability. Binding must follow an authenticated provider fetch;
-- a checkout creator is never authorized to execute this function.
CREATE TABLE early_bird_deferred_verified_bindings (
  invoice_id uuid PRIMARY KEY REFERENCES early_bird_deferred_invoices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  provider_id text NOT NULL UNIQUE CHECK(provider_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$')
);
REVOKE ALL ON early_bird_deferred_verified_bindings FROM PUBLIC;
CREATE FUNCTION early_bird_deferred_bind_verified(target_invoice uuid,target_user uuid,target_provider text,target_amount bigint,target_evidence text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original public.early_bird_deferred_invoices%ROWTYPE; prior public.early_bird_deferred_verified_bindings%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
  SELECT * INTO original FROM public.early_bird_deferred_invoices WHERE id=target_invoice AND user_id=target_user FOR UPDATE;
  IF NOT FOUND OR original.amount_minor<>target_amount OR target_provider IS NULL OR target_provider !~ '^[A-Za-z0-9_-]{1,64}$' OR target_evidence IS NULL OR target_evidence !~ '^sha256:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'early_bird_deferred_binding'; END IF;
  SELECT * INTO prior FROM public.early_bird_deferred_verified_bindings WHERE invoice_id=target_invoice;
  IF FOUND THEN
    IF prior.user_id=target_user AND prior.provider_id=target_provider AND prior.amount_minor=target_amount AND prior.evidence_digest=target_evidence THEN RETURN; END IF;
    RAISE EXCEPTION 'early_bird_deferred_binding_conflict';
  END IF;
  INSERT INTO public.early_bird_deferred_verified_bindings VALUES(target_invoice,target_user,target_provider,target_amount,target_evidence);
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_bind_verified(uuid,uuid,text,bigint,text) FROM PUBLIC;

-- This accepts verified facts only: the ungranted capability must be held solely by a
-- verifier that has independently fetched and validated the exact provider payment.
CREATE FUNCTION early_bird_deferred_commit_verified(target_invoice uuid,target_user uuid,target_provider text,target_amount bigint,target_evidence text,target_captured timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old public.early_bird_deferred_invoices%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
  SELECT * INTO old FROM public.early_bird_deferred_invoices WHERE id=target_invoice AND user_id=target_user FOR UPDATE;
  IF NOT FOUND OR old.amount_minor<>target_amount OR target_provider !~ '^[A-Za-z0-9_-]{1,64}$' OR target_evidence !~ '^sha256:[a-f0-9]{64}$' OR target_captured IS NULL OR NOT isfinite(target_captured) OR target_captured>clock_timestamp() THEN RAISE EXCEPTION 'early_bird_deferred_evidence'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_verified_bindings b WHERE b.invoice_id=target_invoice AND b.user_id=target_user AND b.provider_id=target_provider AND b.amount_minor=target_amount AND b.evidence_digest=target_evidence) THEN RAISE EXCEPTION 'early_bird_deferred_binding'; END IF;
  IF old.captured_at IS NOT NULL THEN
    IF old.provider_id=target_provider AND old.evidence_digest=target_evidence AND old.captured_at=target_captured THEN RETURN; END IF;
    RAISE EXCEPTION 'early_bird_deferred_conflict';
  END IF;
  UPDATE public.early_bird_deferred_invoices SET provider_id=target_provider,evidence_digest=target_evidence,captured_at=target_captured WHERE id=target_invoice;
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_commit_verified(uuid,uuid,text,bigint,text,timestamptz) FROM PUBLIC;

-- Symmetric exclusion: competing flows take the same subject lock before insert.
CREATE FUNCTION early_bird_deferred_block_competing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  LOCK TABLE consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  IF EXISTS(SELECT 1 FROM early_bird_deferred_accounts WHERE user_id=NEW.user_id) THEN RAISE EXCEPTION 'early_bird_deferred_competing'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER early_bird_deferred_block_composite BEFORE INSERT ON early_bird_composite_intents FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_block_competing();
CREATE TRIGGER early_bird_deferred_block_legacy_invoice BEFORE INSERT ON expert_onboarding_invoices FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_block_competing();
CREATE TRIGGER early_bird_deferred_block_legacy_paid BEFORE INSERT ON expert_sales_paid_locks FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_block_competing();

-- Once a deferred invoice exists, switching to an immediate discounted choice could
-- admit overlapping provider payments. Keep the choice fixed through reconciliation.
CREATE FUNCTION early_bird_deferred_block_new_choice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  LOCK TABLE consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  IF EXISTS(SELECT 1 FROM early_bird_deferred_invoices WHERE user_id=NEW.user_id) THEN RAISE EXCEPTION 'early_bird_deferred_choice_locked'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER early_bird_deferred_choice_lock BEFORE INSERT ON early_bird_choices FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_block_new_choice();

-- The only reader granted to a verifier process returns a non-sensitive immutable
-- snapshot; a provider object ID must still come from an independently verified GET.
CREATE FUNCTION early_bird_deferred_read_invoice(target_invoice uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('invoiceId',i.id::text,'userId',i.user_id::text,'operationId',i.id::text,
   'grantId',a.grant_id::text,'policy',a.policy_version,'stage',i.stage,'amountMinor',i.amount_minor::text,
   'mode','live','launchAt',to_char(a.launch_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 FROM public.early_bird_deferred_invoices i JOIN public.early_bird_deferred_accounts a ON a.id=i.account_id AND a.user_id=i.user_id
 WHERE i.id=target_invoice
$$;
REVOKE ALL ON FUNCTION early_bird_deferred_read_invoice(uuid) FROM PUBLIC;

-- Receipt and request data are ciphertext only. This draft supplies no privileges.
ALTER TABLE early_bird_deferred_invoices ADD COLUMN dispatch_started_at timestamptz;
CREATE TABLE early_bird_deferred_receipt_contacts (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 account_id uuid NOT NULL,
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
 captured_at timestamptz NOT NULL CHECK(isfinite(captured_at)),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>captured_at AND expires_at<=captured_at+interval '12 hours'),
 key_id text NOT NULL CHECK(key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 ciphertext text NOT NULL CHECK(ciphertext ~ '^prc1\.[A-Za-z0-9_-]+$' AND length(ciphertext) BETWEEN 45 AND 405),
 UNIQUE(id,user_id), UNIQUE(user_id,idempotency_key),
 FOREIGN KEY(account_id,user_id) REFERENCES early_bird_deferred_accounts(id,user_id) ON DELETE CASCADE
);
CREATE TABLE early_bird_deferred_requests (
 invoice_id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 receipt_contact_id uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[a-f0-9]{64}$'),
 ciphertext text NOT NULL CHECK(length(ciphertext) BETWEEN 1 AND 262144),
 key_reference text NOT NULL CHECK(key_reference ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$'),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
 FOREIGN KEY(invoice_id) REFERENCES early_bird_deferred_invoices(id) ON DELETE CASCADE,
 FOREIGN KEY(receipt_contact_id,user_id) REFERENCES early_bird_deferred_receipt_contacts(id,user_id) ON DELETE CASCADE
);
REVOKE ALL ON early_bird_deferred_receipt_contacts, early_bird_deferred_requests FROM PUBLIC;
-- Opaque replay marker prevents an expired capture event from being reused after cleanup.
CREATE TABLE early_bird_deferred_receipt_tombstones (capture_hash text PRIMARY KEY CHECK(capture_hash ~ '^[0-9a-f]{64}$'));
REVOKE ALL ON early_bird_deferred_receipt_tombstones FROM PUBLIC;
CREATE FUNCTION early_bird_deferred_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id) OR OLD.expires_at<=clock_timestamp() THEN INSERT INTO early_bird_deferred_receipt_tombstones(capture_hash) VALUES(encode(public.digest(OLD.user_id::text || ':' || OLD.idempotency_key,'sha256'),'hex')) ON CONFLICT DO NOTHING; RETURN OLD; END IF;
   RAISE EXCEPTION 'early_bird_deferred_receipt_immutable';
 END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'early_bird_deferred_receipt_immutable'; END IF;
 LOCK TABLE consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.captured_at>clock_timestamp() OR NEW.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM early_bird_deferred_receipt_tombstones WHERE capture_hash=encode(public.digest(NEW.user_id::text || ':' || NEW.idempotency_key,'sha256'),'hex')) OR NOT EXISTS(
   SELECT 1 FROM early_bird_deferred_accounts a JOIN expert_sales_bases b ON b.id=a.base_id AND b.user_id=a.user_id JOIN early_bird_choices c ON c.id=a.choice_id AND c.user_id=a.user_id JOIN users u ON u.id=a.user_id AND u.active
   WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id AND c.choice='later' AND c.id=(SELECT id FROM early_bird_choices WHERE base_id=a.base_id ORDER BY decision_no DESC LIMIT 1)
     AND early_bird_wave_active(early_bird_current_time()) AND early_bird_composite_qualification(a.user_id,a.choice_id) AND expert_card_current_messaging_authority(a.user_id,b.consent_version)) THEN RAISE EXCEPTION 'early_bird_deferred_receipt_source'; END IF;
 INSERT INTO early_bird_deferred_receipt_tombstones(capture_hash) VALUES(encode(public.digest(NEW.user_id::text || ':' || NEW.idempotency_key,'sha256'),'hex'));
 RETURN NEW;
END $$;
CREATE TRIGGER early_bird_deferred_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_deferred_receipt_contacts FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_receipt_guard();
CREATE FUNCTION early_bird_deferred_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id) OR OLD.expires_at<=clock_timestamp()) THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'early_bird_deferred_request_immutable'; END IF;
 LOCK TABLE consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.expires_at<=clock_timestamp() OR NEW.expires_at>clock_timestamp()+interval '12 hours' OR NOT EXISTS(
  SELECT 1 FROM early_bird_deferred_invoices i JOIN early_bird_deferred_receipt_contacts c ON c.id=NEW.receipt_contact_id AND c.user_id=i.user_id AND c.account_id=i.account_id
  WHERE i.id=NEW.invoice_id AND i.user_id=NEW.user_id AND i.dispatch_started_at IS NULL AND c.expires_at>clock_timestamp() AND NEW.expires_at<=c.expires_at)
 THEN RAISE EXCEPTION 'early_bird_deferred_request_source'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER early_bird_deferred_request_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_deferred_requests FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_request_guard();
CREATE FUNCTION early_bird_deferred_erase_contacts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN DELETE FROM early_bird_deferred_receipt_contacts WHERE user_id=NEW.user_id; RETURN NULL; END $$;
CREATE TRIGGER early_bird_deferred_erase_contacts AFTER INSERT ON expert_sales_erased_cohorts FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_erase_contacts();

-- Atomically admits exactly one first dispatch after a fresh financial and receipt
-- authorization check. Returns ciphertext only. Callers must authenticate/decrypt
-- and rebuild the fiscal request; an uncertain dispatch is never resent.
CREATE FUNCTION early_bird_deferred_admit_send(target_user uuid,target_invoice uuid,target_contact uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.early_bird_deferred_invoices%ROWTYPE; request public.early_bird_deferred_requests%ROWTYPE; contact public.early_bird_deferred_receipt_contacts%ROWTYPE;
BEGIN
 LOCK TABLE public.consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO i FROM public.early_bird_deferred_invoices WHERE id=target_invoice AND user_id=target_user FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF i.dispatch_started_at IS NOT NULL THEN RETURN jsonb_build_object('kind','reconcile','invoiceId',i.id::text); END IF;
 PERFORM public.early_bird_deferred_invoice(i.account_id,i.user_id,i.id,i.idempotency_key,i.stage);
 SELECT * INTO request FROM public.early_bird_deferred_requests WHERE invoice_id=i.id AND user_id=target_user AND receipt_contact_id=target_contact FOR SHARE;
 IF NOT FOUND OR request.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 SELECT * INTO contact FROM public.early_bird_deferred_receipt_contacts WHERE id=target_contact AND user_id=target_user AND account_id=i.account_id FOR SHARE;
 IF NOT FOUND OR contact.expires_at<=clock_timestamp() OR i.captured_at IS NOT NULL THEN RETURN NULL; END IF;
 UPDATE public.early_bird_deferred_invoices SET dispatch_started_at=clock_timestamp() WHERE id=i.id;
 RETURN jsonb_build_object('kind','initial_send_admitted','userId',i.user_id::text,'invoiceId',i.id::text,'operationId',i.id::text,'receiptContactId',contact.id::text,'idempotencyKey',i.idempotency_key::text,'amountMinor',i.amount_minor::text,'stage',i.stage,'digest',request.request_digest,'ciphertext',request.ciphertext,'keyReference',request.key_reference);
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_admit_send(uuid,uuid,uuid) FROM PUBLIC;

-- Opaque lookup only; it is not an authorization to send or expose a URL.
CREATE FUNCTION early_bird_deferred_read_bound(target_invoice uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('invoiceId',i.id::text,'userId',i.user_id::text,'providerId',b.provider_id)
 FROM public.early_bird_deferred_invoices i JOIN public.early_bird_deferred_verified_bindings b ON b.invoice_id=i.id AND b.user_id=i.user_id
 WHERE i.id=target_invoice AND NOT EXISTS(SELECT 1 FROM public.expert_sales_erased_cohorts erased WHERE erased.user_id=i.user_id)
$$;
REVOKE ALL ON FUNCTION early_bird_deferred_read_bound(uuid) FROM PUBLIC;

-- Route a provider notification to an already independently bound invoice. A
-- successful capture is intentionally not required: the webhook establishes it.
CREATE FUNCTION early_bird_deferred_payment_lookup(target_provider text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF target_provider IS NULL OR target_provider !~ '^[A-Za-z0-9_-]{1,64}$' THEN RAISE EXCEPTION 'early_bird_deferred_payment_lookup_invalid'; END IF;
 SELECT jsonb_build_object('invoiceId',i.id::text,'providerId',b.provider_id) INTO result
 FROM public.early_bird_deferred_verified_bindings b
 JOIN public.early_bird_deferred_invoices i ON i.id=b.invoice_id AND i.user_id=b.user_id
 WHERE b.provider_id=target_provider AND i.dispatch_started_at IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM public.expert_sales_erased_cohorts e WHERE e.user_id=i.user_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_payment_lookup(text) FROM PUBLIC;
