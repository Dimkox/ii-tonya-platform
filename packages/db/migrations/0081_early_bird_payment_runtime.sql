-- Candidate segment 1: docs/superpowers/implementation-artifacts/drafts/0081_early_bird_composite.sql
-- Draft only. This records a prepared intent; it is not a provider request or proof of payment.
CREATE TABLE early_bird_composite_intents (
  id uuid PRIMARY KEY CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  invoice_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_id uuid NOT NULL,
  choice_id uuid NOT NULL,
  grant_id uuid,
  config_id uuid NOT NULL REFERENCES early_bird_launch_configs(id),
  pricing_policy text NOT NULL CHECK (pricing_policy IN ('wave1_standard_v1','owner_test_10_20_v1')),
  provider_mode text NOT NULL DEFAULT 'live' CHECK(provider_mode IN ('test','live')),
  price_kind text NOT NULL DEFAULT 'full_price' CHECK (price_kind IN ('fixed_test','discounted','full_price')),
  promotion_eligible boolean NOT NULL DEFAULT false,
  base_monthly_minor bigint NOT NULL DEFAULT 0 CHECK (base_monthly_minor BETWEEN 0 AND 999999999999),
  participant_kind text NOT NULL DEFAULT 'expert' CHECK (participant_kind IN ('expert','space')),
  rule_version text NOT NULL DEFAULT 'expert_separated_sales_v3' CHECK (rule_version='expert_separated_sales_v3'),
  quoted_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(quoted_at)),
  idempotency_key uuid NOT NULL UNIQUE CHECK (idempotency_key::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  onboarding_minor bigint NOT NULL CHECK (onboarding_minor IN (1000,300000)),
  subscription_minor bigint NOT NULL CHECK (subscription_minor>0 AND subscription_minor<=999999999999),
  total_minor bigint NOT NULL CHECK (total_minor<=999999999999 AND total_minor=onboarding_minor+subscription_minor),
  base_offer_shown_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  launch_at timestamptz NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','unknown','abandoned','settled','refunded')),
  dispatch_marked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id,user_id),
  FOREIGN KEY (base_id,user_id) REFERENCES expert_sales_bases(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY (choice_id,user_id) REFERENCES early_bird_choices(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY (grant_id,user_id) REFERENCES owner_test_pricing_grants(id,user_id) ON DELETE CASCADE,
  CHECK (isfinite(base_offer_shown_at) AND expires_at=base_offer_shown_at+interval '240 hours'),
  CHECK ((status IN ('unknown','settled','refunded') AND dispatch_marked_at IS NOT NULL AND isfinite(dispatch_marked_at)) OR (status IN ('prepared','abandoned') AND dispatch_marked_at IS NULL)),
  CHECK ((pricing_policy='owner_test_10_20_v1' AND grant_id IS NOT NULL AND provider_mode='live') OR (pricing_policy='wave1_standard_v1' AND grant_id IS NULL))
);
CREATE UNIQUE INDEX early_bird_one_composite_intent_per_user ON early_bird_composite_intents(user_id) WHERE status IN ('prepared','unknown','settled');
CREATE TABLE early_bird_intent_tombstones (
  intent_hash text PRIMARY KEY,
  invoice_hash text NOT NULL UNIQUE,
  idempotency_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(intent_hash ~ '^[0-9a-f]{64}$' AND invoice_hash ~ '^[0-9a-f]{64}$' AND idempotency_hash ~ '^[0-9a-f]{64}$')
);
CREATE TRIGGER early_bird_intent_tombstones_immutable BEFORE UPDATE OR DELETE ON early_bird_intent_tombstones FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
-- Retain only opaque payment identifiers and amount for manual reconciliation of an
-- already-started unknown provider outcome after the subject is erased.
CREATE TABLE early_bird_unknown_recovery (
  intent_id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL UNIQUE,
  idempotency_key uuid NOT NULL UNIQUE,
  total_minor bigint NOT NULL CHECK (total_minor>0 AND total_minor<=999999999999),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER early_bird_unknown_recovery_immutable BEFORE UPDATE OR DELETE ON early_bird_unknown_recovery FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
-- The request contains only sealed bytes. The sender must authenticate/decrypt,
-- recalculate digest and verify exact metadata and receipt before any network call.
CREATE TABLE early_bird_composite_requests (
  intent_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL UNIQUE,
  request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
  body_version integer NOT NULL CHECK(body_version=1),
  ciphertext text NOT NULL CHECK(length(ciphertext) BETWEEN 1 AND 262144),
  key_reference text NOT NULL CHECK(key_reference ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$'),
  expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
  FOREIGN KEY(intent_id,user_id) REFERENCES early_bird_composite_intents(id,user_id) ON DELETE CASCADE
);
CREATE FUNCTION early_bird_composite_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    LOCK TABLE consent_document_versions IN SHARE MODE;
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.user_id::text,0));
    IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id) OR EXISTS(SELECT 1 FROM early_bird_composite_intents WHERE id=OLD.intent_id AND status='prepared') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'early_bird_request_immutable';
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'early_bird_request_immutable'; END IF;
  LOCK TABLE consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  IF NEW.expires_at<=clock_timestamp() OR NEW.expires_at>clock_timestamp()+interval '23 hours' OR NOT EXISTS(SELECT 1 FROM early_bird_composite_intents i WHERE i.id=NEW.intent_id AND i.user_id=NEW.user_id AND i.status='prepared' AND i.idempotency_key=NEW.idempotency_key AND i.request_digest=NEW.request_digest) THEN RAISE EXCEPTION 'early_bird_request_source'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER early_bird_composite_request_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_composite_requests FOR EACH ROW EXECUTE FUNCTION early_bird_composite_request_guard();
-- Qualification is the approved, current wave form with an actual manager decision.
CREATE FUNCTION early_bird_composite_qualification(target_user uuid,target_choice uuid) RETURNS boolean LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.early_bird_form_bridges b JOIN public.early_bird_choices approved_choice ON approved_choice.id=b.choice_id AND approved_choice.user_id=b.user_id JOIN public.early_bird_choices current_choice ON current_choice.id=target_choice AND current_choice.user_id=b.user_id AND current_choice.base_id=approved_choice.base_id JOIN public.residents_applications f ON f.id=b.form_id AND f.user_id=b.user_id AND f.is_current JOIN public.expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=b.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL JOIN public.expert_verification_decisions d ON d.application_id=a.id AND d.user_id=a.user_id AND d.decision='approved' JOIN public.resident_review_events e ON e.attempt_id=f.id AND e.manager_id=d.manager_id AND e.session_hash=d.manager_session_hash AND e.action=f.status AND e.action IN('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE b.user_id=target_user AND e.submitted_revision=b.submitted_revision AND e.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(public.digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
$$;
CREATE FUNCTION early_bird_composite_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quote_now timestamptz; base_amount bigint; owner_kind text;
BEGIN
  IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM public.expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN
    IF OLD.status='unknown' THEN
      INSERT INTO early_bird_unknown_recovery(intent_id,invoice_id,idempotency_key,total_minor) VALUES(OLD.id,OLD.invoice_id,OLD.idempotency_key,OLD.total_minor);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='unknown' AND NEW.status='settled' AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(OLD.user_id::text,0));
    IF NOT EXISTS(SELECT 1 FROM public.early_bird_payment_successes f WHERE f.intent_id=OLD.id AND f.user_id=OLD.user_id AND f.disposition='eligible') THEN RAISE EXCEPTION 'early_bird_intent_terminal_source'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='settled' AND NEW.status='refunded' AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(OLD.user_id::text,0));
    IF NOT EXISTS(SELECT 1 FROM public.early_bird_payment_full_refunds f WHERE f.intent_id=OLD.id AND f.user_id=OLD.user_id AND f.amount_minor=OLD.total_minor) THEN RAISE EXCEPTION 'early_bird_intent_terminal_source'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status='prepared' AND NEW.status='unknown'
    AND (to_jsonb(NEW)-ARRAY['status','dispatch_marked_at'])=(to_jsonb(OLD)-ARRAY['status','dispatch_marked_at']) THEN
    LOCK TABLE consent_document_versions IN SHARE MODE;
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.user_id::text,0));
    PERFORM 1 FROM early_bird_launch_configs cfg WHERE cfg.id=OLD.config_id AND cfg.active AND cfg.phase='WAVE_1_EARLY_BIRD' FOR SHARE;
    IF OLD.grant_id IS NOT NULL THEN
      PERFORM 1 FROM owner_test_pricing_grants g WHERE g.id=OLD.grant_id AND g.user_id=OLD.user_id AND g.revoked_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_intent_dispatch_source'; END IF;
    END IF;
    IF (SELECT id FROM owner_test_pricing_grants WHERE user_id=OLD.user_id AND revoked_at IS NULL AND provider_mode='live' FOR SHARE) IS DISTINCT FROM OLD.grant_id THEN RAISE EXCEPTION 'early_bird_intent_dispatch_source'; END IF;
    PERFORM 1 FROM early_bird_form_bridges bridge JOIN residents_applications form ON form.id=bridge.form_id JOIN expert_onboarding_applications app ON app.id=bridge.application_id WHERE bridge.user_id=OLD.user_id AND EXISTS(SELECT 1 FROM early_bird_choices approved_choice JOIN early_bird_choices current_choice ON current_choice.base_id=approved_choice.base_id AND current_choice.user_id=approved_choice.user_id WHERE approved_choice.id=bridge.choice_id AND current_choice.id=OLD.choice_id) FOR SHARE OF bridge,form,app;
    IF NOT FOUND OR NOT early_bird_composite_qualification(OLD.user_id,OLD.choice_id) THEN RAISE EXCEPTION 'early_bird_intent_qualification'; END IF;
    PERFORM 1 FROM early_bird_composite_requests r WHERE r.intent_id=OLD.id AND r.user_id=OLD.user_id AND r.idempotency_key=OLD.idempotency_key AND r.request_digest=OLD.request_digest AND r.expires_at>clock_timestamp() FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_intent_dispatch_source'; END IF;
    IF NOT early_bird_wave_active(early_bird_current_time()) OR NOT EXISTS (SELECT 1 FROM early_bird_launch_configs cfg WHERE cfg.id=OLD.config_id AND cfg.active AND cfg.phase='WAVE_1_EARLY_BIRD') OR NOT EXISTS (
      SELECT 1 FROM users u JOIN expert_sales_bases b ON b.id=OLD.base_id AND b.user_id=u.id JOIN early_bird_choices c ON c.id=OLD.choice_id AND c.user_id=u.id AND c.base_id=b.id
      WHERE u.id=OLD.user_id AND u.active AND c.choice='now'
        AND c.id=(SELECT id FROM early_bird_choices WHERE base_id=b.id ORDER BY decision_no DESC LIMIT 1)
        AND c.positive_choice_id=(SELECT id FROM expert_sales_choices WHERE base_id=b.id ORDER BY revision DESC LIMIT 1)
        AND expert_card_current_messaging_authority(u.id,b.consent_version)
        AND (OLD.price_kind<>'discounted' OR early_bird_current_time()<OLD.expires_at)
        AND NOT EXISTS(SELECT 1 FROM expert_onboarding_invoices WHERE user_id=u.id)
        AND (OLD.grant_id IS NULL OR EXISTS(SELECT 1 FROM owner_test_pricing_grants g WHERE g.id=OLD.grant_id AND g.user_id=u.id AND g.revoked_at IS NULL))
    ) THEN RAISE EXCEPTION 'early_bird_intent_dispatch_source'; END IF;
    -- Repeat clock-dependent checks after every lock wait.
    IF NOT EXISTS(SELECT 1 FROM early_bird_composite_requests r WHERE r.intent_id=OLD.id AND r.expires_at>clock_timestamp())
      OR NOT early_bird_wave_active(early_bird_current_time())
      OR (OLD.price_kind='discounted' AND early_bird_current_time()>=OLD.expires_at)
      THEN RAISE EXCEPTION 'early_bird_intent_dispatch_source'; END IF;
    NEW.dispatch_marked_at:=clock_timestamp();
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status='prepared' AND NEW.status='abandoned'
    AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.user_id::text,0));
    -- Only safe while no provider send has begun; unknown cannot be abandoned.
    DELETE FROM early_bird_composite_requests WHERE intent_id=OLD.id;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'early_bird_intent_immutable'; END IF;
  LOCK TABLE consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  PERFORM 1 FROM early_bird_launch_configs cfg WHERE cfg.id=NEW.config_id AND cfg.active AND cfg.phase='WAVE_1_EARLY_BIRD' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_intent_phase'; END IF;
  PERFORM 1 FROM users u JOIN expert_sales_bases b ON b.id=NEW.base_id AND b.user_id=u.id JOIN early_bird_choices c ON c.id=NEW.choice_id AND c.base_id=b.id AND c.user_id=u.id
    WHERE u.id=NEW.user_id AND u.active FOR SHARE OF u,b,c;
  IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_intent_source'; END IF;
  IF NEW.grant_id IS NOT NULL THEN
    PERFORM 1 FROM owner_test_pricing_grants g WHERE g.id=NEW.grant_id AND g.user_id=NEW.user_id AND g.revoked_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_intent_source'; END IF;
  END IF;
  PERFORM 1 FROM early_bird_choices c JOIN early_bird_positive_price_snapshots s ON s.positive_choice_id=c.positive_choice_id AND s.user_id=c.user_id AND s.base_id=c.base_id WHERE c.id=NEW.choice_id AND s.policy_version=NEW.pricing_policy AND s.grant_id IS NOT DISTINCT FROM NEW.grant_id AND s.onboarding_minor=NEW.onboarding_minor FOR SHARE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_intent_snapshot_stale'; END IF;
  IF (SELECT id FROM owner_test_pricing_grants WHERE user_id=NEW.user_id AND revoked_at IS NULL AND provider_mode='live' FOR SHARE) IS DISTINCT FROM NEW.grant_id THEN RAISE EXCEPTION 'early_bird_intent_snapshot_stale'; END IF;
  PERFORM 1 FROM early_bird_form_bridges bridge JOIN residents_applications form ON form.id=bridge.form_id JOIN expert_onboarding_applications app ON app.id=bridge.application_id WHERE bridge.user_id=NEW.user_id AND EXISTS(SELECT 1 FROM early_bird_choices approved_choice JOIN early_bird_choices current_choice ON current_choice.base_id=approved_choice.base_id AND current_choice.user_id=approved_choice.user_id WHERE approved_choice.id=bridge.choice_id AND current_choice.id=NEW.choice_id) FOR SHARE OF bridge,form,app;
  IF NOT FOUND OR NOT early_bird_composite_qualification(NEW.user_id,NEW.choice_id) THEN RAISE EXCEPTION 'early_bird_intent_qualification'; END IF;
  quote_now:=early_bird_current_time();
  SELECT base_tariff_amount,participant_kind INTO base_amount,owner_kind FROM expert_sales_bases WHERE id=NEW.base_id AND user_id=NEW.user_id;
  IF NEW.status <> 'prepared' OR NOT early_bird_wave_active(quote_now) OR NOT EXISTS (
    SELECT 1 FROM early_bird_launch_configs cfg JOIN expert_sales_bases b ON b.id=NEW.base_id JOIN users u ON u.id=b.user_id JOIN early_bird_choices c ON c.id=NEW.choice_id AND c.base_id=b.id AND c.user_id=u.id
    WHERE cfg.id=NEW.config_id AND cfg.active AND cfg.phase='WAVE_1_EARLY_BIRD' AND cfg.client_start_at=NEW.launch_at
      AND cfg.promo_deadline_days=10 AND u.id=NEW.user_id AND u.active AND b.base_offer_shown_at=NEW.base_offer_shown_at
      AND c.choice='now' AND c.id=(SELECT id FROM early_bird_choices WHERE base_id=b.id ORDER BY decision_no DESC LIMIT 1)
      AND c.positive_choice_id=(SELECT id FROM expert_sales_choices WHERE base_id=b.id ORDER BY revision DESC LIMIT 1)
      AND expert_card_current_messaging_authority(NEW.user_id,b.consent_version)
      AND NOT EXISTS(SELECT 1 FROM expert_onboarding_invoices WHERE user_id=NEW.user_id)
      AND NOT EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=NEW.user_id)
      AND ((NEW.pricing_policy='wave1_standard_v1' AND NEW.grant_id IS NULL AND NEW.onboarding_minor=300000
        AND NEW.subscription_minor=greatest(500000,(b.base_tariff_amount*(10000-CASE
          WHEN quote_now<b.base_offer_shown_at+interval '96 hours' THEN 4000
          WHEN quote_now<b.base_offer_shown_at+interval '168 hours' THEN 3000
          WHEN quote_now<b.base_offer_shown_at+interval '240 hours' THEN 2000 ELSE 0 END)+5000)/10000))
       OR (NEW.pricing_policy='owner_test_10_20_v1' AND NEW.onboarding_minor=1000 AND NEW.subscription_minor=2000
        AND EXISTS(SELECT 1 FROM owner_test_pricing_grants g WHERE g.id=NEW.grant_id AND g.user_id=NEW.user_id AND g.revoked_at IS NULL AND g.provider_mode='live' AND g.policy_version=NEW.pricing_policy)))
  ) THEN RAISE EXCEPTION 'early_bird_intent_source'; END IF;
  IF quote_now<NEW.base_offer_shown_at THEN RAISE EXCEPTION 'early_bird_intent_clock_invalid'; END IF;
  NEW.base_monthly_minor:=base_amount; NEW.participant_kind:=owner_kind; NEW.rule_version:='expert_separated_sales_v3'; NEW.quoted_at:=quote_now;
  NEW.promotion_eligible:=quote_now<NEW.expires_at;
  NEW.price_kind:=CASE WHEN NEW.pricing_policy='owner_test_10_20_v1' THEN 'fixed_test' WHEN NEW.subscription_minor<base_amount THEN 'discounted' ELSE 'full_price' END;
  NEW.created_at:=clock_timestamp();
  INSERT INTO early_bird_intent_tombstones(intent_hash,invoice_hash,idempotency_hash) VALUES(encode(digest(NEW.id::text,'sha256'),'hex'),encode(digest(NEW.invoice_id::text,'sha256'),'hex'),encode(digest(NEW.idempotency_key::text,'sha256'),'hex'));
  RETURN NEW;
END $$;
CREATE TRIGGER early_bird_composite_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_composite_intents FOR EACH ROW EXECUTE FUNCTION early_bird_composite_intent_guard();
CREATE FUNCTION early_bird_composite_block_legacy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  IF EXISTS(SELECT 1 FROM early_bird_composite_intents WHERE user_id=NEW.user_id AND status IN ('prepared','unknown','settled')) THEN RAISE EXCEPTION 'early_bird_legacy_sale_blocked'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER early_bird_composite_block_choice BEFORE INSERT ON expert_sales_choices FOR EACH ROW EXECUTE FUNCTION early_bird_composite_block_legacy();
CREATE TRIGGER early_bird_composite_block_invoice BEFORE INSERT ON expert_onboarding_invoices FOR EACH ROW EXECUTE FUNCTION early_bird_composite_block_legacy();

CREATE TRIGGER early_bird_composite_block_wave_choice BEFORE INSERT ON early_bird_choices FOR EACH ROW EXECUTE FUNCTION early_bird_composite_block_legacy();
-- Draft: this capability must be granted only to the dedicated trusted verifier
-- connection. A fresh GET, branded application proof and owner/privilege checks
-- are required in the composition before use. It conveys no settlement fact.
CREATE TABLE early_bird_verified_bindings (
 intent_id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 provider_object_id text NOT NULL UNIQUE CHECK(provider_object_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
 bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(intent_id,user_id) REFERENCES early_bird_composite_intents(id,user_id) ON DELETE CASCADE
);
REVOKE ALL ON TABLE early_bird_verified_bindings FROM PUBLIC;
-- Candidate observations are append-only provenance, never settlement authority.
CREATE TABLE early_bird_candidate_observations (
 intent_id uuid NOT NULL REFERENCES early_bird_verified_bindings(intent_id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(intent_id,evidence_digest)
);
REVOKE ALL ON TABLE early_bird_candidate_observations FROM PUBLIC;
CREATE FUNCTION early_bird_candidate_observation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM public.expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'early_bird_observation_immutable';
END $$;
CREATE TRIGGER early_bird_candidate_observation_immutable BEFORE UPDATE OR DELETE ON early_bird_candidate_observations FOR EACH ROW EXECUTE FUNCTION early_bird_candidate_observation_immutable();

CREATE SCHEMA early_bird_private;
REVOKE ALL ON SCHEMA early_bird_private FROM PUBLIC;
CREATE FUNCTION early_bird_private.bind_verified(target_intent uuid,target_user uuid,target_provider text,target_evidence text,target_snapshot jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.early_bird_verified_bindings%ROWTYPE; expected_snapshot jsonb;
BEGIN
 IF target_provider IS NULL OR target_provider !~ '^[A-Za-z0-9_-]{1,64}$' OR target_evidence IS NULL OR target_evidence !~ '^sha256:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'early_bird_binding_invalid'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_user::text,0));
 PERFORM 1 FROM public.early_bird_composite_intents WHERE id=target_intent AND user_id=target_user AND status='unknown' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_binding_source'; END IF;
 SELECT jsonb_build_object('invoiceId',i.invoice_id::text,'userId',i.user_id::text,'operationId',i.id::text,'grantId',i.grant_id::text,'pricingPolicy',i.pricing_policy,'priceKind',i.price_kind,'mode',i.provider_mode,'onboardingMinor',i.onboarding_minor::text,'subscriptionMinor',i.subscription_minor::text,'totalMinor',i.total_minor::text,'baseOfferShownAt',to_char(i.base_offer_shown_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'launchAt',to_char(i.launch_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'baseMonthlyMinor',CASE WHEN i.pricing_policy='wave1_standard_v1' THEN i.base_monthly_minor::text END,'ruleVersion',CASE WHEN i.pricing_policy='wave1_standard_v1' THEN i.rule_version END,'participantKind',CASE WHEN i.pricing_policy='wave1_standard_v1' THEN i.participant_kind END,'promotionEligible',CASE WHEN i.pricing_policy='wave1_standard_v1' THEN i.promotion_eligible END,'quotedAt',CASE WHEN i.pricing_policy='wave1_standard_v1' THEN to_char(i.quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) INTO expected_snapshot FROM public.early_bird_composite_intents i WHERE i.id=target_intent AND i.user_id=target_user;
 IF target_snapshot IS DISTINCT FROM expected_snapshot THEN RAISE EXCEPTION 'early_bird_binding_snapshot_conflict'; END IF;
 SELECT * INTO prior FROM public.early_bird_verified_bindings WHERE intent_id=target_intent FOR UPDATE;
 IF FOUND THEN
   IF prior.user_id<>target_user OR prior.provider_object_id<>target_provider THEN RAISE EXCEPTION 'early_bird_binding_conflict'; END IF;
 ELSE
   INSERT INTO public.early_bird_verified_bindings(intent_id,user_id,provider_object_id,evidence_digest) VALUES(target_intent,target_user,target_provider,target_evidence);
 END IF;
 INSERT INTO public.early_bird_candidate_observations(intent_id,user_id,evidence_digest) VALUES(target_intent,target_user,target_evidence) ON CONFLICT(intent_id,evidence_digest) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION early_bird_private.bind_verified(uuid,uuid,text,text,jsonb) FROM PUBLIC;
-- Role provisioning and grants are deliberately external to the migration.
-- Without an explicitly provisioned capability, no non-owner can call bind.
-- Separate read-only capability for the provider verifier. A grant is provisioned
-- externally on an isolated login; direct table SELECT is not required.
CREATE FUNCTION early_bird_private.find_candidate_intent(target_intent uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('invoiceId',i.invoice_id::text,'userId',i.user_id::text,'operationId',i.id::text,'pricingPolicy',i.pricing_policy,'priceKind',i.price_kind,'mode',i.provider_mode,'onboardingMinor',i.onboarding_minor::text,'subscriptionMinor',i.subscription_minor::text,'totalMinor',i.total_minor::text,'baseOfferShownAt',to_char(i.base_offer_shown_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'launchAt',to_char(i.launch_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || CASE WHEN i.pricing_policy='owner_test_10_20_v1' THEN jsonb_build_object('grantId',i.grant_id::text) ELSE jsonb_build_object('baseMonthlyMinor',i.base_monthly_minor::text,'ruleVersion',i.rule_version,'participantKind',i.participant_kind,'promotionEligible',i.promotion_eligible,'quotedAt',to_char(i.quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END FROM public.early_bird_composite_intents i WHERE i.id=target_intent AND i.status='unknown'
$$;
REVOKE ALL ON FUNCTION early_bird_private.find_candidate_intent(uuid) FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 2: docs/superpowers/implementation-artifacts/drafts/0082_early_bird_settlement.sql
-- DRAFT ONLY: capability is unavailable to PUBLIC and requires a separately
-- provisioned verifier principal and verified provider GET before invocation.
-- This records a financial fact; it does not publish a card, create a legacy
-- payment event, or independently authorize an entitlement.
-- Every writer that extends coverage must touch the same subject epoch after
-- taking the subject lock. A serializable writer with a snapshot acquired
-- before an overlapping wave payment is then forced to retry with fresh data.
CREATE TABLE early_bird_coverage_epochs (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision>0)
);
REVOKE ALL ON TABLE early_bird_coverage_epochs FROM PUBLIC;
CREATE FUNCTION early_bird_touch_coverage_epoch(target_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
  INSERT INTO public.early_bird_coverage_epochs(user_id,revision) VALUES(target_user,1)
    ON CONFLICT(user_id) DO UPDATE SET revision=public.early_bird_coverage_epochs.revision+1;
END $$;
REVOKE ALL ON FUNCTION early_bird_touch_coverage_epoch(uuid) FROM PUBLIC;
CREATE TABLE early_bird_payment_successes (
  intent_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  provider_object_id text NOT NULL UNIQUE CHECK (provider_object_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  captured_at timestamptz NOT NULL CHECK (isfinite(captured_at)),
  disposition text NOT NULL CHECK (disposition IN ('eligible','reconcile')),
  starts_at timestamptz,
  ends_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(intent_id,user_id) REFERENCES early_bird_composite_intents(id,user_id) ON DELETE CASCADE,
  CHECK ((disposition='reconcile' AND starts_at IS NULL AND ends_at IS NULL)
      OR (disposition='eligible' AND starts_at IS NOT NULL AND ends_at=starts_at+interval '2592000 seconds'))
);
REVOKE ALL ON TABLE early_bird_payment_successes FROM PUBLIC;
CREATE TABLE early_bird_payment_full_refunds (
  intent_id uuid PRIMARY KEY REFERENCES early_bird_payment_successes(intent_id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  provider_refund_id text NOT NULL UNIQUE CHECK (provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor>0),
  occurred_at timestamptz NOT NULL CHECK (isfinite(occurred_at)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE early_bird_payment_full_refunds FROM PUBLIC;
-- Append-only schedule revisions preserve the original verified financial fact.
CREATE TABLE early_bird_coverage_revisions (
 intent_id uuid NOT NULL REFERENCES early_bird_payment_successes(intent_id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 revision bigint NOT NULL CHECK (revision > 0),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL CHECK (ends_at=starts_at+interval '2592000 seconds'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (intent_id, revision)
);
REVOKE ALL ON TABLE early_bird_coverage_revisions FROM PUBLIC;
CREATE VIEW early_bird_effective_coverages AS
 SELECT s.intent_id,s.user_id,coalesce(r.starts_at,s.starts_at) starts_at,coalesce(r.ends_at,s.ends_at) ends_at
 FROM early_bird_payment_successes s
 LEFT JOIN LATERAL (SELECT starts_at,ends_at FROM early_bird_coverage_revisions r WHERE r.intent_id=s.intent_id ORDER BY revision DESC LIMIT 1) r ON true
 WHERE s.disposition='eligible' AND NOT EXISTS (SELECT 1 FROM early_bird_payment_full_refunds f WHERE f.intent_id=s.intent_id);
REVOKE ALL ON early_bird_effective_coverages FROM PUBLIC;
-- Pending records block new automatic coverage until a reviewed operator repairs
-- the dependent legacy schedule and its projection. The refund fact itself is
-- retained even while reconciliation is pending.
CREATE TABLE early_bird_coverage_reconciliation (
 intent_id uuid NOT NULL REFERENCES early_bird_payment_full_refunds(intent_id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 order_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(intent_id,order_id)
);
REVOKE ALL ON TABLE early_bird_coverage_reconciliation FROM PUBLIC;
-- DRAFT: only the separately provisioned provider-verifier principal may call
-- this after fetching both provider objects and checking their exact binding.
CREATE TABLE early_bird_refund_reconciliation (
 operation_id uuid PRIMARY KEY,
 intent_id uuid NOT NULL,
 user_id uuid NOT NULL,
 provider_payment_id text NOT NULL CHECK(provider_payment_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 provider_refund_id text NOT NULL UNIQUE CHECK(provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 amount_minor bigint NOT NULL CHECK(amount_minor > 0),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(intent_id,user_id) REFERENCES early_bird_composite_intents(id,user_id) ON DELETE CASCADE
);
REVOKE ALL ON TABLE early_bird_refund_reconciliation FROM PUBLIC;
-- Quarantined financial state must not be exposed as usable coverage.
CREATE OR REPLACE VIEW early_bird_effective_coverages AS
 SELECT s.intent_id,s.user_id,coalesce(r.starts_at,s.starts_at) starts_at,coalesce(r.ends_at,s.ends_at) ends_at
 FROM early_bird_payment_successes s
 LEFT JOIN LATERAL (SELECT starts_at,ends_at FROM early_bird_coverage_revisions r WHERE r.intent_id=s.intent_id ORDER BY revision DESC LIMIT 1) r ON true
 WHERE s.disposition='eligible' AND NOT EXISTS (SELECT 1 FROM early_bird_payment_full_refunds f WHERE f.intent_id=s.intent_id)
 AND NOT EXISTS (SELECT 1 FROM early_bird_refund_reconciliation q WHERE q.user_id=s.user_id);

-- Common provider-ID namespace across full and partial refunds. Entries are
-- inserted in the same transaction as the corresponding financial fact.
CREATE TABLE early_bird_refund_registry (
 provider_refund_id text PRIMARY KEY CHECK(provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 intent_id uuid NOT NULL,
 user_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor > 0),
 FOREIGN KEY(intent_id,user_id) REFERENCES early_bird_composite_intents(id,user_id) ON DELETE CASCADE
);
REVOKE ALL ON TABLE early_bird_refund_registry FROM PUBLIC;
CREATE FUNCTION early_bird_record_refund_reconciliation(target_operation uuid,target_intent uuid,target_user uuid,target_payment text,target_refund text,target_amount bigint,target_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original public.early_bird_composite_intents%ROWTYPE; prior public.early_bird_refund_reconciliation%ROWTYPE;
BEGIN
 IF target_operation IS NULL OR target_intent IS NULL OR target_user IS NULL OR target_payment IS NULL OR target_payment !~ '^[A-Za-z0-9_-]{1,64}$' OR target_refund IS NULL OR target_refund !~ '^[A-Za-z0-9_-]{1,64}$' OR target_amount IS NULL OR target_amount<=0 OR target_evidence IS NULL OR target_evidence !~ '^sha256:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'early_bird_refund_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO original FROM public.early_bird_composite_intents WHERE id=target_intent AND user_id=target_user FOR UPDATE;
 IF NOT FOUND OR target_amount>=original.total_minor OR EXISTS(SELECT 1 FROM public.early_bird_payment_full_refunds WHERE intent_id=target_intent OR provider_refund_id=target_refund) OR NOT EXISTS(SELECT 1 FROM public.early_bird_verified_bindings WHERE intent_id=target_intent AND user_id=target_user AND provider_object_id=target_payment) THEN RAISE EXCEPTION 'early_bird_refund_source'; END IF;
 SELECT * INTO prior FROM public.early_bird_refund_reconciliation WHERE operation_id=target_operation OR provider_refund_id=target_refund FOR UPDATE;
 IF FOUND THEN
  IF prior.operation_id<>target_operation OR prior.intent_id<>target_intent OR prior.user_id<>target_user OR prior.provider_payment_id<>target_payment OR prior.provider_refund_id<>target_refund OR prior.amount_minor<>target_amount OR prior.evidence_digest<>target_evidence THEN RAISE EXCEPTION 'early_bird_refund_conflict'; END IF;
  RETURN;
 END IF;
 IF coalesce((SELECT sum(amount_minor) FROM public.early_bird_refund_registry WHERE intent_id=target_intent),0)+target_amount > original.total_minor THEN RAISE EXCEPTION 'early_bird_refund_total_exceeded'; END IF;
 INSERT INTO public.early_bird_refund_registry(provider_refund_id,intent_id,user_id,amount_minor) VALUES(target_refund,target_intent,target_user,target_amount);
 INSERT INTO public.early_bird_refund_reconciliation(operation_id,intent_id,user_id,provider_payment_id,provider_refund_id,amount_minor,evidence_digest) VALUES(target_operation,target_intent,target_user,target_payment,target_refund,target_amount,target_evidence);
 PERFORM public.early_bird_touch_coverage_epoch(target_user);
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.experts_published') AND attname='wave_intent_id' AND NOT attisdropped) AND to_regprocedure('public.early_bird_deactivate_partial_refund_projection(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'early_bird_projection_capability_incomplete'; END IF;
 IF to_regprocedure('public.early_bird_deactivate_partial_refund_projection(uuid,uuid)') IS NOT NULL THEN EXECUTE 'SELECT public.early_bird_deactivate_partial_refund_projection($1,$2)' USING target_user,target_intent; END IF;
END $$;
REVOKE ALL ON FUNCTION early_bird_record_refund_reconciliation(uuid,uuid,uuid,text,text,bigint,text) FROM PUBLIC;
CREATE FUNCTION early_bird_active_coverage_end(target_user uuid) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result timestamptz;
BEGIN
 IF EXISTS(SELECT 1 FROM public.early_bird_coverage_reconciliation WHERE user_id=target_user) OR EXISTS(SELECT 1 FROM public.early_bird_refund_reconciliation WHERE user_id=target_user) THEN RAISE EXCEPTION 'early_bird_coverage_reconciliation_required'; END IF;
 SELECT max(s.ends_at) INTO result FROM public.early_bird_effective_coverages s WHERE s.user_id=target_user;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION early_bird_active_coverage_end(uuid) FROM PUBLIC;
CREATE FUNCTION early_bird_success_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'early_bird_success_immutable';
END $$;
CREATE TRIGGER early_bird_success_immutable BEFORE UPDATE OR DELETE ON early_bird_payment_successes FOR EACH ROW EXECUTE FUNCTION early_bird_success_immutable();
CREATE TRIGGER early_bird_full_refund_immutable BEFORE UPDATE OR DELETE ON early_bird_payment_full_refunds FOR EACH ROW EXECUTE FUNCTION early_bird_success_immutable();
CREATE TRIGGER early_bird_refund_registry_immutable BEFORE UPDATE OR DELETE ON early_bird_refund_registry FOR EACH ROW EXECUTE FUNCTION early_bird_success_immutable();
CREATE TRIGGER early_bird_refund_reconciliation_immutable BEFORE UPDATE OR DELETE ON early_bird_refund_reconciliation FOR EACH ROW EXECUTE FUNCTION early_bird_success_immutable();
CREATE TRIGGER early_bird_coverage_revision_immutable BEFORE UPDATE OR DELETE ON early_bird_coverage_revisions FOR EACH ROW EXECUTE FUNCTION early_bird_success_immutable();
-- Caller holds the subject lock and has advanced the shared epoch. Never rewrite
-- a started interval; that case requires explicit reconciliation.
CREATE FUNCTION early_bird_reflow_after_legacy_refund(target_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row record; prior_end timestamptz; proposed timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT max(o.residency_ends_at) INTO prior_end FROM public.expert_residency_orders o JOIN public.experts e ON e.id=o.expert_id WHERE e.user_id=target_user AND o.status='settled';
 FOR row IN SELECT s.intent_id,s.recorded_at,c.starts_at,c.ends_at,i.launch_at FROM public.early_bird_payment_successes s JOIN public.early_bird_effective_coverages c ON c.intent_id=s.intent_id JOIN public.early_bird_composite_intents i ON i.id=s.intent_id WHERE s.user_id=target_user ORDER BY s.recorded_at,s.intent_id LOOP
   proposed:=greatest(row.launch_at,clock_timestamp(),coalesce(prior_end,row.launch_at));
   IF proposed < row.starts_at AND row.starts_at > clock_timestamp() THEN
     INSERT INTO public.early_bird_coverage_revisions(intent_id,user_id,revision,starts_at,ends_at)
       SELECT row.intent_id,target_user,coalesce(max(revision),0)+1,proposed,proposed+interval '2592000 seconds' FROM public.early_bird_coverage_revisions WHERE intent_id=row.intent_id;
     row.ends_at:=proposed+interval '2592000 seconds';
   END IF;
   prior_end:=greatest(prior_end,row.ends_at);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION early_bird_reflow_after_legacy_refund(uuid) FROM PUBLIC;
CREATE FUNCTION early_bird_record_success(target_intent uuid,target_user uuid,target_provider text,target_evidence text,target_captured timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original public.early_bird_composite_intents%ROWTYPE; prior public.early_bird_payment_successes%ROWTYPE; outcome text; begin_at timestamptz; previous_end timestamptz;
BEGIN
  IF target_intent IS NULL OR target_user IS NULL OR target_provider IS NULL OR target_provider !~ '^[A-Za-z0-9_-]{1,64}$' OR target_evidence IS NULL OR target_evidence !~ '^sha256:[a-f0-9]{64}$' OR target_captured IS NULL OR NOT isfinite(target_captured) OR target_captured>clock_timestamp() THEN RAISE EXCEPTION 'early_bird_success_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
  SELECT * INTO original FROM public.early_bird_composite_intents WHERE id=target_intent AND user_id=target_user AND status IN ('unknown','settled','refunded') FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.early_bird_verified_bindings WHERE intent_id=target_intent AND user_id=target_user AND provider_object_id=target_provider) THEN RAISE EXCEPTION 'early_bird_success_source'; END IF;
  IF target_captured<original.base_offer_shown_at THEN RAISE EXCEPTION 'early_bird_success_invalid'; END IF;
  SELECT * INTO prior FROM public.early_bird_payment_successes WHERE intent_id=target_intent FOR UPDATE;
  IF FOUND THEN
    IF prior.user_id<>target_user OR prior.provider_object_id<>target_provider OR prior.evidence_digest<>target_evidence OR prior.captured_at<>target_captured THEN RAISE EXCEPTION 'early_bird_success_conflict'; END IF;
    RETURN;
  END IF;
  IF original.status<>'unknown' THEN RAISE EXCEPTION 'early_bird_success_source'; END IF;
  outcome:=CASE WHEN target_captured>=original.launch_at OR (original.price_kind='discounted' AND target_captured>=original.expires_at) THEN 'reconcile' ELSE 'eligible' END;
  IF outcome='eligible' THEN
    PERFORM public.early_bird_touch_coverage_epoch(target_user);
    SELECT greatest(
      (SELECT max(o.residency_ends_at) FROM public.expert_residency_orders o JOIN public.experts e ON e.id=o.expert_id WHERE e.user_id=target_user AND o.status='settled'),
      public.early_bird_active_coverage_end(target_user)
    ) INTO previous_end;
    begin_at:=greatest(target_captured,original.launch_at,coalesce(previous_end,original.launch_at));
  END IF;
  INSERT INTO public.early_bird_payment_successes(intent_id,user_id,provider_object_id,evidence_digest,captured_at,disposition,starts_at,ends_at)
    VALUES(target_intent,target_user,target_provider,target_evidence,target_captured,outcome,begin_at,CASE WHEN begin_at IS NOT NULL THEN begin_at+interval '2592000 seconds' END);
  IF outcome='eligible' THEN UPDATE public.early_bird_composite_intents SET status='settled' WHERE id=target_intent; END IF;
END $$;
REVOKE ALL ON FUNCTION early_bird_record_success(uuid,uuid,text,text,timestamptz) FROM PUBLIC;

-- Full refunds only. A trusted, isolated verifier must validate the provider
-- refund and payment before calling; partial/ambiguous refunds remain manual.
CREATE FUNCTION early_bird_record_full_refund(target_intent uuid,target_user uuid,target_refund text,target_evidence text,target_amount bigint,target_occurred timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original public.early_bird_composite_intents%ROWTYPE; success public.early_bird_payment_successes%ROWTYPE; prior public.early_bird_payment_full_refunds%ROWTYPE; effective_end timestamptz; first_observed timestamptz;
BEGIN
 IF target_intent IS NULL OR target_user IS NULL OR target_refund IS NULL OR target_refund !~ '^[A-Za-z0-9_-]{1,64}$' OR target_evidence IS NULL OR target_evidence !~ '^sha256:[a-f0-9]{64}$' OR target_occurred IS NULL OR NOT isfinite(target_occurred) OR target_occurred>clock_timestamp() THEN RAISE EXCEPTION 'early_bird_refund_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO original FROM public.early_bird_composite_intents WHERE id=target_intent AND user_id=target_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_refund_source'; END IF;
 SELECT * INTO success FROM public.early_bird_payment_successes WHERE intent_id=target_intent AND user_id=target_user FOR UPDATE;
 IF NOT FOUND OR target_amount IS DISTINCT FROM original.total_minor OR target_occurred<success.captured_at THEN RAISE EXCEPTION 'early_bird_refund_source'; END IF;
 IF EXISTS(SELECT 1 FROM public.early_bird_refund_reconciliation WHERE intent_id=target_intent OR provider_refund_id=target_refund) THEN RAISE EXCEPTION 'early_bird_refund_reconciliation_required'; END IF;
 SELECT * INTO prior FROM public.early_bird_payment_full_refunds WHERE intent_id=target_intent FOR UPDATE;
 IF FOUND THEN
   IF prior.user_id<>target_user OR prior.provider_refund_id<>target_refund OR prior.evidence_digest<>target_evidence OR prior.amount_minor<>target_amount THEN RAISE EXCEPTION 'early_bird_refund_conflict'; END IF;
   RETURN;
 END IF;
 first_observed:=clock_timestamp();
 IF first_observed < success.captured_at THEN RAISE EXCEPTION 'early_bird_refund_source'; END IF;
 SELECT ends_at INTO effective_end FROM public.early_bird_effective_coverages WHERE intent_id=target_intent;
 PERFORM public.early_bird_touch_coverage_epoch(target_user);
 INSERT INTO public.early_bird_refund_registry(provider_refund_id,intent_id,user_id,amount_minor) VALUES(target_refund,target_intent,target_user,target_amount);
 INSERT INTO public.early_bird_payment_full_refunds(intent_id,user_id,provider_refund_id,evidence_digest,amount_minor,occurred_at) VALUES(target_intent,target_user,target_refund,target_evidence,target_amount,first_observed);
 IF success.disposition='eligible' THEN UPDATE public.early_bird_composite_intents SET status='refunded' WHERE id=target_intent; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.experts_published') AND attname='wave_intent_id' AND NOT attisdropped) AND to_regprocedure('public.early_bird_deactivate_refunded_projection(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'early_bird_projection_capability_incomplete'; END IF;
 IF to_regprocedure('public.early_bird_deactivate_refunded_projection(uuid,uuid)') IS NOT NULL THEN
   EXECUTE 'SELECT public.early_bird_deactivate_refunded_projection($1,$2)' USING target_user,target_intent;
 END IF;
 INSERT INTO public.early_bird_coverage_reconciliation(intent_id,user_id,order_id)
 SELECT target_intent,target_user,(to_jsonb(o)->>'id')::uuid FROM public.expert_residency_orders o JOIN public.experts e ON e.id=o.expert_id
 WHERE e.user_id=target_user AND o.status='settled' AND (to_jsonb(o)->>'residency_starts_at')::timestamptz >= effective_end;
 PERFORM public.early_bird_reflow_after_legacy_refund(target_user);
END $$;
REVOKE ALL ON FUNCTION early_bird_record_full_refund(uuid,uuid,text,text,bigint,timestamptz) FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 3: docs/superpowers/implementation-artifacts/drafts/0083_early_bird_verified_settlement.sql
-- DRAFT ONLY: this capability is not granted to any production principal.
-- A separately reviewed provider-verifier principal is required before use.
CREATE FUNCTION early_bird_commit_verified_payment(target_snapshot jsonb, target_evidence text, target_captured timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original public.early_bird_composite_intents%ROWTYPE; expected jsonb; target_intent uuid; target_user uuid;
BEGIN
 IF target_snapshot IS NULL OR jsonb_typeof(target_snapshot)<>'object' THEN RAISE EXCEPTION 'early_bird_settlement_binding_invalid'; END IF;
 target_intent:=(target_snapshot->>'operationId')::uuid;
 target_user:=(target_snapshot->>'userId')::uuid;
 IF target_intent IS NULL OR target_user IS NULL THEN RAISE EXCEPTION 'early_bird_settlement_binding_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT i.* INTO original FROM public.early_bird_composite_intents i JOIN public.early_bird_verified_bindings b ON b.intent_id=i.id AND b.user_id=i.user_id WHERE i.id=target_intent AND i.user_id=target_user AND b.provider_object_id=target_snapshot->>'providerObjectId' FOR UPDATE OF i;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_settlement_binding_mismatch'; END IF;
 expected:=jsonb_build_object('invoiceId',original.invoice_id::text,'userId',original.user_id::text,'operationId',original.id::text,'providerObjectId',target_snapshot->>'providerObjectId','pricingPolicy',original.pricing_policy,'priceKind',original.price_kind,'mode',original.provider_mode,'grantId',original.grant_id::text,'onboardingMinor',original.onboarding_minor::text,'subscriptionMinor',original.subscription_minor::text,'totalMinor',original.total_minor::text,'baseOfferShownAt',to_char(original.base_offer_shown_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char(original.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'launchAt',to_char(original.launch_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 IF target_snapshot IS DISTINCT FROM expected THEN RAISE EXCEPTION 'early_bird_settlement_binding_mismatch'; END IF;
 PERFORM public.early_bird_record_success(target_intent,target_user,target_snapshot->>'providerObjectId',target_evidence,target_captured);
END $$;
REVOKE ALL ON FUNCTION early_bird_commit_verified_payment(jsonb,text,timestamptz) FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 4: docs/superpowers/implementation-artifacts/drafts/0084_early_bird_verified_payment_reader.sql
-- DRAFT ONLY. Provision a dedicated read-only role separately; no PUBLIC access.
CREATE FUNCTION early_bird_private.find_verified_payment(target_kind text,target_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF target_kind NOT IN ('invoice','provider','operation') OR target_id IS NULL THEN RAISE EXCEPTION 'early_bird_verified_reader_invalid'; END IF;
 SELECT jsonb_build_object('invoiceId',i.invoice_id::text,'userId',i.user_id::text,'operationId',i.id::text,'providerObjectId',b.provider_object_id,'pricingPolicy',i.pricing_policy,'priceKind',i.price_kind,'mode',i.provider_mode,'onboardingMinor',i.onboarding_minor::text,'subscriptionMinor',i.subscription_minor::text,'totalMinor',i.total_minor::text,'baseOfferShownAt',to_char(i.base_offer_shown_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char(i.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'launchAt',to_char(i.launch_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || CASE WHEN i.pricing_policy='owner_test_10_20_v1' THEN jsonb_build_object('grantId',i.grant_id::text) ELSE '{}'::jsonb END
 INTO result FROM public.early_bird_composite_intents i JOIN public.early_bird_verified_bindings b ON b.intent_id=i.id AND b.user_id=i.user_id
 WHERE (target_kind='invoice' AND i.invoice_id::text=target_id) OR (target_kind='provider' AND b.provider_object_id=target_id) OR (target_kind='operation' AND i.id::text=target_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION early_bird_private.find_verified_payment(text,text) FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 5: docs/superpowers/implementation-artifacts/drafts/0085_early_bird_verified_refund_settlement.sql
-- DRAFT ONLY: no grants or production composition. Binding creation requires a
-- separate reviewed provider-observation capability, not yet provided here.
CREATE TABLE early_bird_verified_refund_bindings (
 operation_id uuid PRIMARY KEY,
 intent_id uuid NOT NULL,
 user_id uuid NOT NULL,
 provider_payment_id text NOT NULL CHECK(provider_payment_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 provider_refund_id text NOT NULL UNIQUE CHECK(provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 FOREIGN KEY(intent_id,user_id) REFERENCES early_bird_composite_intents(id,user_id) ON DELETE CASCADE
);
REVOKE ALL ON TABLE early_bird_verified_refund_bindings FROM PUBLIC;
CREATE TRIGGER early_bird_verified_refund_binding_immutable BEFORE UPDATE OR DELETE ON early_bird_verified_refund_bindings FOR EACH ROW EXECUTE FUNCTION early_bird_success_immutable();
CREATE FUNCTION early_bird_commit_verified_refund(target_snapshot jsonb,target_amount bigint,target_evidence text,target_provider_created timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original public.early_bird_composite_intents%ROWTYPE; expected jsonb; target_intent uuid; target_user uuid; target_operation uuid;
BEGIN
 IF target_snapshot IS NULL OR jsonb_typeof(target_snapshot)<>'object' THEN RAISE EXCEPTION 'early_bird_refund_binding_invalid'; END IF;
 target_intent:=(target_snapshot->>'operationId')::uuid; target_user:=(target_snapshot->>'userId')::uuid; target_operation:=(target_snapshot->>'refundOperationId')::uuid;
 IF target_intent IS NULL OR target_user IS NULL OR target_operation IS NULL THEN RAISE EXCEPTION 'early_bird_refund_binding_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT i.* INTO original FROM public.early_bird_composite_intents i
 JOIN public.early_bird_verified_bindings p ON p.intent_id=i.id AND p.user_id=i.user_id
 JOIN public.early_bird_verified_refund_bindings r ON r.intent_id=i.id AND r.user_id=i.user_id AND r.provider_payment_id=p.provider_object_id
 WHERE i.id=target_intent AND i.user_id=target_user AND r.operation_id=target_operation AND r.provider_refund_id=target_snapshot->>'refundId' AND p.provider_object_id=target_snapshot->>'paymentId' FOR UPDATE OF i;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_refund_binding_mismatch'; END IF;
 expected:=jsonb_build_object('invoiceId',original.invoice_id::text,'userId',original.user_id::text,'operationId',original.id::text,'refundOperationId',target_operation::text,'paymentId',target_snapshot->>'paymentId','refundId',target_snapshot->>'refundId','pricingPolicy',original.pricing_policy,'priceKind',original.price_kind,'mode',original.provider_mode,'grantId',original.grant_id::text,'totalMinor',original.total_minor::text);
 IF target_snapshot IS DISTINCT FROM expected OR target_amount IS NULL OR target_amount<=0 OR target_amount>original.total_minor THEN RAISE EXCEPTION 'early_bird_refund_binding_mismatch'; END IF;
 IF target_amount=original.total_minor THEN
  PERFORM public.early_bird_record_full_refund(target_intent,target_user,target_snapshot->>'refundId',target_evidence,target_amount,target_provider_created);
 ELSE
  PERFORM public.early_bird_record_refund_reconciliation(target_operation,target_intent,target_user,target_snapshot->>'paymentId',target_snapshot->>'refundId',target_amount,target_evidence);
 END IF;
END $$;
REVOKE ALL ON FUNCTION early_bird_commit_verified_refund(jsonb,bigint,text,timestamptz) FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 6: docs/superpowers/implementation-artifacts/drafts/0086_early_bird_verified_refund_binding.sql
-- DRAFT ONLY. Bind may be called only by a separately reviewed provider
-- verifier principal after independent GETs. Role grants are not provisioned.
CREATE FUNCTION early_bird_bind_verified_refund(target_snapshot jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.early_bird_composite_intents%ROWTYPE; prior public.early_bird_verified_refund_bindings%ROWTYPE; expected jsonb; intent uuid; subject uuid; operation uuid;
BEGIN
 IF target_snapshot IS NULL OR jsonb_typeof(target_snapshot)<>'object' THEN RAISE EXCEPTION 'early_bird_refund_binding_invalid'; END IF;
 intent:=(target_snapshot->>'operationId')::uuid; subject:=(target_snapshot->>'userId')::uuid; operation:=(target_snapshot->>'refundOperationId')::uuid;
 IF intent IS NULL OR subject IS NULL OR operation IS NULL THEN RAISE EXCEPTION 'early_bird_refund_binding_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(subject::text,0));
 SELECT i0.* INTO i FROM public.early_bird_composite_intents i0 JOIN public.early_bird_verified_bindings p ON p.intent_id=i0.id AND p.user_id=i0.user_id WHERE i0.id=intent AND i0.user_id=subject AND p.provider_object_id=target_snapshot->>'paymentId' FOR UPDATE OF i0;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_refund_binding_mismatch'; END IF;
 expected:=jsonb_build_object('invoiceId',i.invoice_id::text,'userId',i.user_id::text,'operationId',i.id::text,'refundOperationId',operation::text,'paymentId',target_snapshot->>'paymentId','refundId',target_snapshot->>'refundId','pricingPolicy',i.pricing_policy,'priceKind',i.price_kind,'mode',i.provider_mode,'grantId',i.grant_id::text,'totalMinor',i.total_minor::text);
 IF target_snapshot IS DISTINCT FROM expected OR target_snapshot->>'refundId' IS NULL OR target_snapshot->>'refundId' !~ '^[A-Za-z0-9_-]{1,64}$' THEN RAISE EXCEPTION 'early_bird_refund_binding_mismatch'; END IF;
 SELECT * INTO prior FROM public.early_bird_verified_refund_bindings WHERE provider_refund_id=target_snapshot->>'refundId' OR operation_id=operation FOR UPDATE;
 IF FOUND THEN
  IF prior.operation_id<>operation OR prior.intent_id<>intent OR prior.user_id<>subject OR prior.provider_payment_id<>target_snapshot->>'paymentId' OR prior.provider_refund_id<>target_snapshot->>'refundId' THEN RAISE EXCEPTION 'early_bird_refund_binding_conflict'; END IF;
  RETURN;
 END IF;
 INSERT INTO public.early_bird_verified_refund_bindings(operation_id,intent_id,user_id,provider_payment_id,provider_refund_id) VALUES(operation,intent,subject,target_snapshot->>'paymentId',target_snapshot->>'refundId');
END $$;
REVOKE ALL ON FUNCTION early_bird_bind_verified_refund(jsonb) FROM PUBLIC;
CREATE FUNCTION early_bird_read_verified_refund(target_refund text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('invoiceId',i.invoice_id::text,'userId',i.user_id::text,'operationId',i.id::text,'refundOperationId',r.operation_id::text,'paymentId',r.provider_payment_id,'refundId',r.provider_refund_id,'pricingPolicy',i.pricing_policy,'priceKind',i.price_kind,'mode',i.provider_mode,'totalMinor',i.total_minor::text) || CASE WHEN i.pricing_policy='owner_test_10_20_v1' THEN jsonb_build_object('grantId',i.grant_id::text) ELSE '{}'::jsonb END
 FROM public.early_bird_verified_refund_bindings r JOIN public.early_bird_composite_intents i ON i.id=r.intent_id AND i.user_id=r.user_id JOIN public.early_bird_verified_bindings p ON p.intent_id=i.id AND p.user_id=i.user_id AND p.provider_object_id=r.provider_payment_id WHERE r.provider_refund_id=target_refund
$$;
REVOKE ALL ON FUNCTION early_bird_read_verified_refund(text) FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 7: docs/superpowers/implementation-artifacts/drafts/0087_early_bird_receipt_contacts.sql
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
--> statement-breakpoint
-- Candidate segment 8: docs/superpowers/implementation-artifacts/drafts/early_bird_owner_send_capability.sql
-- DRAFT: install only with reviewed 0081+0087 and a separate sender process/login.
-- No PUBLIC capability, no direct table access required by the sender login.
-- Historical receipt helpers and intent triggers resolve public tables by name;
-- public schema CREATE must remain restricted to the trusted migration owner.
-- pg_temp is explicitly last to prevent temporary-table shadowing in delegates.
CREATE FUNCTION early_bird_private.owner_send_snapshot(target_user uuid,target_intent uuid,target_contact uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 LOCK TABLE public.consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 PERFORM 1 FROM public.early_bird_composite_intents WHERE id=target_intent AND user_id=target_user FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Receipt deletion/expiry and all current authority writers must use the same
 -- subject lock. Hold the actual contact row too, rather than only an EXISTS.
 PERFORM 1 FROM public.early_bird_receipt_contacts c JOIN public.early_bird_composite_intents i ON i.choice_id=c.choice_id AND i.user_id=c.user_id
 WHERE i.id=target_intent AND i.user_id=target_user AND c.id=target_contact FOR SHARE OF c;
 SELECT jsonb_build_object('status',i.status,'userId',i.user_id::text,'operationId',i.id::text,'invoiceId',i.invoice_id::text,'grantId',i.grant_id::text,'idempotencyKey',i.idempotency_key::text,'digest',i.request_digest,
   'ciphertext',r.ciphertext,'keyReference',r.key_reference,
   'offer',to_char(i.base_offer_shown_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'expiry',to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'launch',to_char(i.launch_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'contactAvailable',EXISTS(SELECT 1 FROM public.early_bird_receipt_contacts c WHERE c.id=target_contact AND c.user_id=i.user_id AND c.choice_id=i.choice_id AND c.expires_at>clock_timestamp() AND public.early_bird_receipt_authorized(c.user_id,c.choice_id))) INTO result
 FROM public.early_bird_composite_intents i LEFT JOIN public.early_bird_composite_requests r ON r.intent_id=i.id AND r.user_id=i.user_id AND r.idempotency_key=i.idempotency_key AND r.request_digest=i.request_digest AND r.expires_at>clock_timestamp()
 WHERE i.id=target_intent AND i.user_id=target_user AND i.pricing_policy='owner_test_10_20_v1' AND i.price_kind='fixed_test' AND i.provider_mode='live' AND i.onboarding_minor=1000 AND i.subscription_minor=2000 AND i.total_minor=3000;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION early_bird_private.owner_send_snapshot(uuid,uuid,uuid) FROM PUBLIC;
CREATE FUNCTION early_bird_private.owner_admit_send(target_user uuid,target_intent uuid,target_contact uuid,expected_digest text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; admitted uuid;
BEGIN
 snapshot:=early_bird_private.owner_send_snapshot(target_user,target_intent,target_contact);
 IF snapshot IS NULL OR snapshot->>'status'<>'prepared' OR snapshot->>'contactAvailable'<>'true' OR snapshot->>'digest' IS DISTINCT FROM expected_digest OR snapshot->>'ciphertext' IS NULL THEN RAISE EXCEPTION 'early_bird_send_source_unavailable'; END IF;
 UPDATE public.early_bird_composite_intents SET status='unknown' WHERE id=target_intent AND user_id=target_user AND status='prepared' RETURNING id INTO admitted;
 IF admitted IS NULL THEN RAISE EXCEPTION 'early_bird_send_transition'; END IF;
 RETURN admitted;
END $$;
REVOKE ALL ON FUNCTION early_bird_private.owner_admit_send(uuid,uuid,uuid,text) FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 9: docs/superpowers/implementation-artifacts/drafts/early_bird_standard_send_capability.sql
-- DRAFT: install only with reviewed 0081+0087 and a separate sender process/login.
-- No PUBLIC capability, no direct table access required by the sender login.
-- Historical receipt helpers and intent triggers resolve public tables by name;
-- public schema CREATE must remain restricted to the trusted migration owner.
-- pg_temp is explicitly last to prevent temporary-table shadowing in delegates.
CREATE FUNCTION early_bird_private.standard_send_snapshot(target_user uuid,target_intent uuid,target_contact uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 LOCK TABLE public.consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 PERFORM 1 FROM public.early_bird_composite_intents WHERE id=target_intent AND user_id=target_user FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Receipt deletion/expiry and all current authority writers must use the same
 -- subject lock. Hold the actual contact row too, rather than only an EXISTS.
 PERFORM 1 FROM public.early_bird_receipt_contacts c JOIN public.early_bird_composite_intents i ON i.choice_id=c.choice_id AND i.user_id=c.user_id
 WHERE i.id=target_intent AND i.user_id=target_user AND c.id=target_contact FOR SHARE OF c;
 SELECT jsonb_build_object('status',i.status,'userId',i.user_id::text,'operationId',i.id::text,'invoiceId',i.invoice_id::text,'priceKind',i.price_kind,'eligible',i.promotion_eligible,'participant',i.participant_kind,'base',i.base_monthly_minor::text,'monthly',i.subscription_minor::text,'total',i.total_minor::text,'quote',to_char(i.quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'idempotencyKey',i.idempotency_key::text,'digest',i.request_digest,
   'ciphertext',r.ciphertext,'keyReference',r.key_reference,
   'offer',to_char(i.base_offer_shown_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'expiry',to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'launch',to_char(i.launch_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'contactAvailable',EXISTS(SELECT 1 FROM public.early_bird_receipt_contacts c WHERE c.id=target_contact AND c.user_id=i.user_id AND c.choice_id=i.choice_id AND c.expires_at>clock_timestamp() AND public.early_bird_receipt_authorized(c.user_id,c.choice_id))) INTO result
 FROM public.early_bird_composite_intents i LEFT JOIN public.early_bird_composite_requests r ON r.intent_id=i.id AND r.user_id=i.user_id AND r.idempotency_key=i.idempotency_key AND r.request_digest=i.request_digest AND r.expires_at>clock_timestamp()
 WHERE i.id=target_intent AND i.user_id=target_user AND i.pricing_policy='wave1_standard_v1' AND i.grant_id IS NULL AND i.price_kind IN ('discounted','full_price') AND i.provider_mode='live' AND i.onboarding_minor=300000 AND i.total_minor=i.onboarding_minor+i.subscription_minor;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION early_bird_private.standard_send_snapshot(uuid,uuid,uuid) FROM PUBLIC;
CREATE FUNCTION early_bird_private.standard_admit_send(target_user uuid,target_intent uuid,target_contact uuid,expected_digest text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; admitted uuid;
BEGIN
 snapshot:=early_bird_private.standard_send_snapshot(target_user,target_intent,target_contact);
 IF snapshot IS NULL OR snapshot->>'status'<>'prepared' OR snapshot->>'contactAvailable'<>'true' OR snapshot->>'digest' IS DISTINCT FROM expected_digest OR snapshot->>'ciphertext' IS NULL THEN RAISE EXCEPTION 'early_bird_send_source_unavailable'; END IF;
 UPDATE public.early_bird_composite_intents SET status='unknown' WHERE id=target_intent AND user_id=target_user AND status='prepared' RETURNING id INTO admitted;
 IF admitted IS NULL THEN RAISE EXCEPTION 'early_bird_send_transition'; END IF;
 RETURN admitted;
END $$;
REVOKE ALL ON FUNCTION early_bird_private.standard_admit_send(uuid,uuid,uuid,text) FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 10: docs/superpowers/implementation-artifacts/drafts/early_bird_gateway_authority.sql
-- Draft only; install and grants require review. No raw receipt is retained.
-- Lock order: gateway_contact_state row only. Never take the application's
-- subject advisory lock: the API may hold it while awaiting revoke ACK.
CREATE TABLE public.early_bird_gateway_contact_state (
 contact_id uuid PRIMARY KEY,
 revoked_at timestamptz
);
CREATE TABLE public.early_bird_gateway_claims (
 intent_id uuid PRIMARY KEY,
 contact_id uuid NOT NULL,
 idempotency_key uuid NOT NULL UNIQUE,
 request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.early_bird_gateway_contact_state, public.early_bird_gateway_claims FROM PUBLIC;

CREATE FUNCTION public.early_bird_gateway_revoke(target_contact uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF target_contact IS NULL THEN RETURN false; END IF;
 INSERT INTO public.early_bird_gateway_contact_state(contact_id,revoked_at)
 VALUES(target_contact,clock_timestamp())
 ON CONFLICT(contact_id) DO UPDATE SET revoked_at=COALESCE(public.early_bird_gateway_contact_state.revoked_at,EXCLUDED.revoked_at);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.early_bird_gateway_revoke(uuid) FROM PUBLIC;

CREATE FUNCTION public.early_bird_gateway_claim(target_user uuid,target_intent uuid,target_contact uuid,target_idempotency uuid,target_digest text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE revoked timestamptz; composite_match boolean; deferred_match boolean := false;
BEGIN
 IF target_user IS NULL OR target_intent IS NULL OR target_contact IS NULL OR target_idempotency IS NULL OR target_digest IS NULL THEN RETURN false; END IF;
 INSERT INTO public.early_bird_gateway_contact_state(contact_id) VALUES(target_contact) ON CONFLICT DO NOTHING;
 SELECT revoked_at INTO revoked FROM public.early_bird_gateway_contact_state WHERE contact_id=target_contact FOR UPDATE;
 IF revoked IS NOT NULL OR EXISTS (SELECT 1 FROM public.receipt_revocation_outbox WHERE contact_id=target_contact) THEN RETURN false; END IF;
 SELECT EXISTS (
  SELECT 1 FROM public.early_bird_composite_intents i
  JOIN public.early_bird_composite_requests r ON r.intent_id=i.id AND r.user_id=i.user_id
  JOIN public.early_bird_receipt_contacts c ON c.user_id=i.user_id AND c.choice_id=i.choice_id
  WHERE i.id=target_intent AND i.user_id=target_user AND i.status='unknown'
   AND i.idempotency_key=target_idempotency AND r.idempotency_key=target_idempotency
   AND i.request_digest=target_digest AND r.request_digest=target_digest
   AND c.id=target_contact AND c.expires_at>clock_timestamp() AND r.expires_at>clock_timestamp()
   AND public.early_bird_receipt_authorized(i.user_id,i.choice_id)
 ) INTO composite_match;
 IF to_regclass('public.early_bird_deferred_invoices') IS NOT NULL THEN
  -- Reject ambiguous IDs even if the competing record is not authorized.
  IF composite_match AND EXISTS (SELECT 1 FROM public.early_bird_deferred_invoices WHERE id=target_intent OR idempotency_key=target_idempotency) THEN RETURN false; END IF;
  SELECT EXISTS (
   SELECT 1 FROM public.early_bird_deferred_invoices i
   JOIN public.early_bird_deferred_accounts a ON a.id=i.account_id AND a.user_id=i.user_id
   JOIN public.early_bird_deferred_requests r ON r.invoice_id=i.id AND r.user_id=i.user_id
   JOIN public.early_bird_deferred_receipt_contacts c ON c.id=r.receipt_contact_id AND c.user_id=i.user_id AND c.account_id=a.id
   JOIN public.expert_sales_bases b ON b.id=a.base_id AND b.user_id=a.user_id
   JOIN public.early_bird_choices choice ON choice.id=a.choice_id AND choice.user_id=a.user_id
   JOIN public.users u ON u.id=a.user_id AND u.active
   JOIN public.early_bird_launch_configs cfg ON cfg.id=a.config_id
   WHERE i.id=target_intent AND i.user_id=target_user AND i.idempotency_key=target_idempotency
     AND i.dispatch_started_at IS NOT NULL AND i.captured_at IS NULL
     AND r.request_digest=target_digest AND r.receipt_contact_id=target_contact
     AND c.expires_at>clock_timestamp() AND r.expires_at>clock_timestamp()
     AND cfg.active AND cfg.phase='WAVE_1_EARLY_BIRD' AND cfg.client_start_at=a.launch_at
     AND public.early_bird_current_time()<a.launch_at AND public.early_bird_wave_active(public.early_bird_current_time())
     AND choice.choice='later' AND choice.id=(SELECT id FROM public.early_bird_choices WHERE base_id=a.base_id ORDER BY decision_no DESC LIMIT 1)
     AND public.expert_card_current_messaging_authority(a.user_id,b.consent_version)
     AND public.early_bird_composite_qualification(a.user_id,a.choice_id)
     AND (SELECT id FROM public.owner_test_pricing_grants WHERE user_id=a.user_id AND revoked_at IS NULL AND provider_mode='live') IS NOT DISTINCT FROM a.grant_id
     AND ((i.stage='onboarding' AND i.amount_minor=a.onboarding_minor) OR
       (i.stage='subscription' AND i.amount_minor=a.subscription_minor AND EXISTS (SELECT 1 FROM public.early_bird_deferred_invoices paid WHERE paid.account_id=a.id AND paid.stage='onboarding' AND paid.captured_at IS NOT NULL)))
     AND NOT EXISTS (SELECT 1 FROM public.expert_sales_erased_cohorts erased WHERE erased.user_id=a.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.early_bird_composite_intents other WHERE other.id=target_intent OR other.idempotency_key=target_idempotency OR (other.user_id=a.user_id AND other.status IN ('prepared','unknown','settled')))
     AND NOT EXISTS (SELECT 1 FROM public.expert_onboarding_invoices WHERE user_id=a.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.expert_sales_paid_locks WHERE user_id=a.user_id)
  ) INTO deferred_match;
 END IF;
 IF NOT composite_match AND NOT deferred_match THEN RETURN false; END IF;
 INSERT INTO public.early_bird_gateway_claims(intent_id,contact_id,idempotency_key,request_digest)
 VALUES(target_intent,target_contact,target_idempotency,target_digest) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.early_bird_gateway_claim(uuid,uuid,uuid,uuid,text) FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 11: docs/superpowers/implementation-artifacts/drafts/receipt_revocation_outbox.sql
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
--> statement-breakpoint
-- Candidate segment 12: docs/superpowers/implementation-artifacts/drafts/0088_early_bird_deferred_payments.sql
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
--> statement-breakpoint
-- Candidate segment 13: docs/superpowers/implementation-artifacts/drafts/0089_early_bird_deferred_refunds.sql
-- DRAFT ONLY. Requires 0082 and 0088. No grants or role creation.
-- Keep one global provider-refund namespace shared with composite payments.
ALTER TABLE early_bird_deferred_invoices ADD CONSTRAINT early_bird_deferred_invoice_identity UNIQUE(id,user_id);
ALTER TABLE early_bird_refund_registry ALTER COLUMN intent_id DROP NOT NULL;
ALTER TABLE early_bird_refund_registry ADD COLUMN deferred_invoice_id uuid;
ALTER TABLE early_bird_refund_registry ADD CONSTRAINT early_bird_refund_registry_deferred_fk FOREIGN KEY(deferred_invoice_id,user_id) REFERENCES early_bird_deferred_invoices(id,user_id) ON DELETE CASCADE;
ALTER TABLE early_bird_refund_registry ADD CONSTRAINT early_bird_refund_registry_exact_source CHECK ((intent_id IS NOT NULL)::integer + (deferred_invoice_id IS NOT NULL)::integer = 1);
CREATE TABLE early_bird_deferred_verified_refund_bindings (
 provider_refund_id text PRIMARY KEY CHECK(provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 invoice_id uuid NOT NULL,
 user_id uuid NOT NULL,
 provider_payment_id text NOT NULL CHECK(provider_payment_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 amount_minor bigint NOT NULL CHECK(amount_minor > 0),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(invoice_id,user_id) REFERENCES early_bird_deferred_invoices(id,user_id) ON DELETE CASCADE
);
-- Reserve provider refund IDs at binding time across both products, even while pending.
CREATE TABLE early_bird_refund_binding_registry (
 provider_refund_id text PRIMARY KEY CHECK(provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 product text NOT NULL CHECK(product IN ('composite','deferred')),
 user_id uuid NOT NULL,
 subject_id uuid NOT NULL
);
REVOKE ALL ON early_bird_refund_binding_registry FROM PUBLIC;
INSERT INTO early_bird_refund_binding_registry(provider_refund_id,product,user_id,subject_id)
 SELECT provider_refund_id,'composite',user_id,intent_id FROM early_bird_verified_refund_bindings;
INSERT INTO early_bird_refund_binding_registry(provider_refund_id,product,user_id,subject_id)
 SELECT provider_refund_id,'deferred',user_id,invoice_id FROM early_bird_deferred_verified_refund_bindings;
CREATE FUNCTION early_bird_refund_binding_registry_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN DELETE FROM public.early_bird_refund_binding_registry WHERE user_id=NEW.user_id; RETURN NULL; END $$;
CREATE TRIGGER early_bird_refund_binding_registry_erasure AFTER INSERT ON expert_sales_erased_cohorts FOR EACH ROW EXECUTE FUNCTION early_bird_refund_binding_registry_erasure();
CREATE FUNCTION early_bird_refund_binding_registry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject uuid; kind text;
BEGIN
 IF TG_TABLE_NAME='early_bird_deferred_verified_refund_bindings' THEN subject:=NEW.invoice_id; kind:='deferred'; ELSE subject:=NEW.intent_id; kind:='composite'; END IF;
 INSERT INTO public.early_bird_refund_binding_registry(provider_refund_id,product,user_id,subject_id) VALUES(NEW.provider_refund_id,kind,NEW.user_id,subject) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_refund_binding_global_conflict'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER early_bird_deferred_refund_global_binding BEFORE INSERT ON early_bird_deferred_verified_refund_bindings FOR EACH ROW EXECUTE FUNCTION early_bird_refund_binding_registry_guard();
CREATE TRIGGER early_bird_composite_refund_global_binding BEFORE INSERT ON early_bird_verified_refund_bindings FOR EACH ROW EXECUTE FUNCTION early_bird_refund_binding_registry_guard();
CREATE TABLE early_bird_deferred_refund_resolutions (
 provider_refund_id text PRIMARY KEY REFERENCES early_bird_deferred_verified_refund_bindings(provider_refund_id) ON DELETE CASCADE,
 invoice_id uuid NOT NULL,
 user_id uuid NOT NULL,
 disposition text NOT NULL CHECK(disposition='canceled'),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(invoice_id,user_id) REFERENCES early_bird_deferred_invoices(id,user_id) ON DELETE CASCADE
);
CREATE TABLE early_bird_deferred_refund_facts (
 provider_refund_id text PRIMARY KEY REFERENCES early_bird_deferred_verified_refund_bindings(provider_refund_id) ON DELETE CASCADE,
 invoice_id uuid NOT NULL,
 user_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor > 0),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
 FOREIGN KEY(invoice_id,user_id) REFERENCES early_bird_deferred_invoices(id,user_id) ON DELETE CASCADE
);
CREATE TABLE early_bird_deferred_refund_reconciliation (
 provider_refund_id text PRIMARY KEY REFERENCES early_bird_deferred_refund_facts(provider_refund_id) ON DELETE CASCADE,
 invoice_id uuid NOT NULL,
 user_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(invoice_id,user_id) REFERENCES early_bird_deferred_invoices(id,user_id) ON DELETE CASCADE
);
REVOKE ALL ON early_bird_deferred_verified_refund_bindings,early_bird_deferred_refund_facts,early_bird_deferred_refund_reconciliation,early_bird_deferred_refund_resolutions FROM PUBLIC;
CREATE FUNCTION early_bird_deferred_refund_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'early_bird_deferred_refund_immutable';
END $$;
CREATE TRIGGER early_bird_deferred_refund_binding_immutable BEFORE UPDATE OR DELETE ON early_bird_deferred_verified_refund_bindings FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_refund_immutable();
CREATE TRIGGER early_bird_deferred_refund_fact_immutable BEFORE UPDATE OR DELETE ON early_bird_deferred_refund_facts FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_refund_immutable();
CREATE TRIGGER early_bird_deferred_refund_reconciliation_immutable BEFORE UPDATE OR DELETE ON early_bird_deferred_refund_reconciliation FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_refund_immutable();
CREATE TRIGGER early_bird_deferred_refund_resolution_immutable BEFORE UPDATE OR DELETE ON early_bird_deferred_refund_resolutions FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_refund_immutable();

-- Dedicated protected resolver returns only the captured, bound payment snapshot.
CREATE FUNCTION early_bird_deferred_refund_payment(target_provider text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('invoiceId',i.id::text,'userId',i.user_id::text,'operationId',i.id::text,'grantId',a.grant_id::text,'policy',a.policy_version,'stage',i.stage,'amountMinor',i.amount_minor::text,'mode','live','launchAt',to_char(a.launch_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'providerId',i.provider_id)
 FROM public.early_bird_deferred_invoices i JOIN public.early_bird_deferred_accounts a ON a.id=i.account_id AND a.user_id=i.user_id JOIN public.early_bird_deferred_verified_bindings b ON b.invoice_id=i.id AND b.user_id=i.user_id AND b.provider_id=i.provider_id AND b.evidence_digest=i.evidence_digest
 WHERE i.provider_id=target_provider AND i.captured_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.expert_sales_erased_cohorts e WHERE e.user_id=i.user_id)
$$;
REVOKE ALL ON FUNCTION early_bird_deferred_refund_payment(text) FROM PUBLIC;

-- Only a separate independently verified provider principal may invoke these.
CREATE FUNCTION early_bird_deferred_bind_refund(target_invoice uuid,target_user uuid,target_payment text,target_refund text,target_amount bigint,target_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.early_bird_deferred_invoices%ROWTYPE; old public.early_bird_deferred_verified_refund_bindings%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO i FROM public.early_bird_deferred_invoices WHERE id=target_invoice AND user_id=target_user AND provider_id=target_payment AND captured_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR target_refund IS NULL OR target_refund !~ '^[A-Za-z0-9_-]{1,64}$' OR target_amount IS NULL OR target_amount<=0 OR target_amount>i.amount_minor OR target_evidence IS NULL OR target_evidence !~ '^sha256:[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_verified_bindings b WHERE b.invoice_id=i.id AND b.user_id=i.user_id AND b.provider_id=i.provider_id AND b.evidence_digest=i.evidence_digest) THEN RAISE EXCEPTION 'early_bird_deferred_refund_binding'; END IF;
 SELECT * INTO old FROM public.early_bird_deferred_verified_refund_bindings WHERE provider_refund_id=target_refund FOR UPDATE;
 IF FOUND THEN
  IF old.invoice_id=target_invoice AND old.user_id=target_user AND old.provider_payment_id=target_payment AND old.amount_minor=target_amount AND old.evidence_digest=target_evidence THEN RETURN; END IF;
  RAISE EXCEPTION 'early_bird_deferred_refund_conflict';
 END IF;
 IF EXISTS(SELECT 1 FROM public.early_bird_refund_registry WHERE provider_refund_id=target_refund) OR EXISTS(SELECT 1 FROM public.early_bird_verified_refund_bindings WHERE provider_refund_id=target_refund) THEN RAISE EXCEPTION 'early_bird_deferred_refund_conflict'; END IF;
 INSERT INTO public.early_bird_deferred_verified_refund_bindings(provider_refund_id,invoice_id,user_id,provider_payment_id,amount_minor,evidence_digest) VALUES(target_refund,target_invoice,target_user,target_payment,target_amount,target_evidence);
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_bind_refund(uuid,uuid,text,text,bigint,text) FROM PUBLIC;

CREATE FUNCTION early_bird_deferred_commit_refund(target_invoice uuid,target_user uuid,target_payment text,target_refund text,target_amount bigint,target_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.early_bird_deferred_invoices%ROWTYPE; old public.early_bird_deferred_refund_facts%ROWTYPE; refunded bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO i FROM public.early_bird_deferred_invoices WHERE id=target_invoice AND user_id=target_user AND provider_id=target_payment AND captured_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_verified_refund_bindings r WHERE r.invoice_id=target_invoice AND r.user_id=target_user AND r.provider_payment_id=target_payment AND r.provider_refund_id=target_refund AND r.amount_minor=target_amount AND r.evidence_digest=target_evidence) THEN RAISE EXCEPTION 'early_bird_deferred_refund_binding'; END IF;
 IF EXISTS(SELECT 1 FROM public.early_bird_deferred_refund_resolutions WHERE provider_refund_id=target_refund) THEN RAISE EXCEPTION 'early_bird_deferred_refund_canceled'; END IF;
 SELECT * INTO old FROM public.early_bird_deferred_refund_facts WHERE provider_refund_id=target_refund FOR UPDATE;
 IF FOUND THEN
  IF old.invoice_id=target_invoice AND old.user_id=target_user AND old.amount_minor=target_amount AND old.evidence_digest=target_evidence THEN RETURN; END IF;
  RAISE EXCEPTION 'early_bird_deferred_refund_conflict';
 END IF;
 SELECT coalesce(sum(amount_minor),0) INTO refunded FROM public.early_bird_deferred_refund_facts WHERE invoice_id=target_invoice AND user_id=target_user;
 IF target_amount IS NULL OR target_amount<=0 OR refunded+target_amount>i.amount_minor THEN RAISE EXCEPTION 'early_bird_deferred_refund_amount'; END IF;
 INSERT INTO public.early_bird_refund_registry(provider_refund_id,intent_id,deferred_invoice_id,user_id,amount_minor) VALUES(target_refund,NULL,target_invoice,target_user,target_amount);
 INSERT INTO public.early_bird_deferred_refund_facts(provider_refund_id,invoice_id,user_id,amount_minor,evidence_digest) VALUES(target_refund,target_invoice,target_user,target_amount,target_evidence);
 IF target_amount<i.amount_minor THEN INSERT INTO public.early_bird_deferred_refund_reconciliation(provider_refund_id,invoice_id,user_id,amount_minor) VALUES(target_refund,target_invoice,target_user,target_amount); END IF;
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_commit_refund(uuid,uuid,text,text,bigint,text) FROM PUBLIC;
-- Separate verified terminal cancellation permits recovery from a canceled
-- pending refund, but never overrides a recorded successful refund.
CREATE FUNCTION early_bird_deferred_cancel_refund(target_invoice uuid,target_user uuid,target_payment text,target_refund text,target_amount bigint,target_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.early_bird_deferred_verified_refund_bindings%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 PERFORM 1 FROM public.early_bird_deferred_invoices WHERE id=target_invoice AND user_id=target_user AND provider_id=target_payment FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_deferred_refund_binding'; END IF;
 SELECT * INTO prior FROM public.early_bird_deferred_verified_refund_bindings WHERE provider_refund_id=target_refund FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF prior.invoice_id<>target_invoice OR prior.user_id<>target_user OR prior.provider_payment_id<>target_payment OR prior.amount_minor<>target_amount OR prior.evidence_digest<>target_evidence OR EXISTS(SELECT 1 FROM public.early_bird_deferred_refund_facts WHERE provider_refund_id=target_refund) THEN RAISE EXCEPTION 'early_bird_deferred_refund_conflict'; END IF;
 INSERT INTO public.early_bird_deferred_refund_resolutions(provider_refund_id,invoice_id,user_id,disposition,evidence_digest) VALUES(target_refund,target_invoice,target_user,'canceled',target_evidence) ON CONFLICT(provider_refund_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_cancel_refund(uuid,uuid,text,text,bigint,text) FROM PUBLIC;

-- Block starting the next stage as soon as any independently observed refund
-- exists for this account. Cancellation/reconciliation requires a reviewed path.
CREATE FUNCTION early_bird_deferred_refund_blocks_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.stage='subscription' AND EXISTS(SELECT 1 FROM public.early_bird_deferred_invoices i JOIN public.early_bird_deferred_verified_refund_bindings r ON r.invoice_id=i.id AND r.user_id=i.user_id WHERE i.account_id=NEW.account_id AND i.user_id=NEW.user_id AND NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_refund_resolutions resolved WHERE resolved.provider_refund_id=r.provider_refund_id AND resolved.invoice_id=r.invoice_id AND resolved.user_id=r.user_id)) THEN RAISE EXCEPTION 'early_bird_deferred_refund_pending'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER early_bird_deferred_refund_blocks_invoice BEFORE INSERT ON early_bird_deferred_invoices FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_refund_blocks_invoice();
--> statement-breakpoint
-- Candidate segment 14: docs/superpowers/implementation-artifacts/drafts/0077_early_bird_final_call.sql
CREATE TABLE early_bird_final_call_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('first','repeat')),
 config_version text NOT NULL CHECK (config_version ~ '^[A-Za-z0-9_-]{1,64}$'),
 trigger_at timestamptz NOT NULL,
 client_start_at timestamptz NOT NULL,
 scheduled_at timestamptz NOT NULL,
 available_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','dispatched','delivered','cancelled','uncertain')),
 attempt_id uuid,
 prepared_until timestamptz,
 message_id text,
 delivered_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (isfinite(trigger_at) AND isfinite(client_start_at) AND isfinite(scheduled_at) AND isfinite(available_at) AND isfinite(created_at)),
 CHECK (trigger_at < client_start_at AND scheduled_at >= trigger_at AND scheduled_at < client_start_at AND available_at >= scheduled_at),
 CHECK (mod(extract(epoch from scheduled_at-trigger_at)::numeric,86400)=0),
 CHECK ((status='pending' AND attempt_id IS NULL AND prepared_until IS NULL AND message_id IS NULL AND delivered_at IS NULL)
 OR (status='preparing' AND attempt_id IS NOT NULL AND prepared_until IS NOT NULL AND isfinite(prepared_until) AND message_id IS NULL AND delivered_at IS NULL)
 OR (status IN ('dispatched','uncertain') AND attempt_id IS NOT NULL AND prepared_until IS NULL AND message_id IS NULL AND delivered_at IS NULL)
 OR (status='cancelled' AND prepared_until IS NULL AND message_id IS NULL AND delivered_at IS NULL)
 OR (status='delivered' AND attempt_id IS NOT NULL AND prepared_until IS NULL AND message_id IS NOT NULL AND message_id ~ '^[1-9][0-9]{0,19}$' AND delivered_at IS NOT NULL AND isfinite(delivered_at) AND delivered_at >= created_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX early_bird_final_call_one_active ON early_bird_final_call_queue(user_id,kind) WHERE status IN ('pending','preparing','dispatched','delivered','uncertain');
--> statement-breakpoint
CREATE INDEX early_bird_final_call_ready ON early_bird_final_call_queue(status,available_at,created_at,id);
--> statement-breakpoint
CREATE FUNCTION early_bird_final_call_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE first_time timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN
   IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'early_bird_final_call_immutable';
 END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.status <> 'pending' OR NEW.attempt_id IS NOT NULL OR NEW.message_id IS NOT NULL OR NEW.delivered_at IS NOT NULL OR NEW.prepared_until IS NOT NULL THEN RAISE EXCEPTION 'early_bird_final_call_initial_state'; END IF;
   IF NEW.kind='repeat' THEN
     SELECT delivered_at INTO first_time FROM early_bird_final_call_queue WHERE user_id=NEW.user_id AND kind='first' AND status='delivered' FOR SHARE;
     IF first_time IS NULL OR NEW.scheduled_at < first_time+interval '72 hours' THEN RAISE EXCEPTION 'early_bird_final_call_repeat_source'; END IF;
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.kind IS DISTINCT FROM OLD.kind
 OR NEW.config_version IS DISTINCT FROM OLD.config_version OR NEW.trigger_at IS DISTINCT FROM OLD.trigger_at
 OR NEW.client_start_at IS DISTINCT FROM OLD.client_start_at OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
 OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'early_bird_final_call_immutable'; END IF;
 IF OLD.status IN ('delivered','cancelled','uncertain') THEN RAISE EXCEPTION 'early_bird_final_call_terminal'; END IF;
 IF NEW.status='preparing' AND (early_bird_current_time()<NEW.trigger_at OR early_bird_current_time()>=NEW.client_start_at) THEN RAISE EXCEPTION 'early_bird_final_call_window'; END IF;
 IF NEW.status='preparing' AND NOT ((OLD.status='pending' AND OLD.available_at<=early_bird_current_time()) OR (OLD.status='preparing' AND OLD.prepared_until<=clock_timestamp())) THEN RAISE EXCEPTION 'early_bird_final_call_lease'; END IF;
 IF NEW.status='preparing' AND (NEW.attempt_id IS NULL OR NEW.attempt_id IS NOT DISTINCT FROM OLD.attempt_id OR NEW.available_at IS DISTINCT FROM OLD.available_at) THEN RAISE EXCEPTION 'early_bird_final_call_lease'; END IF;
 IF OLD.status='preparing' AND NEW.status<>'preparing' AND ((OLD.prepared_until<=clock_timestamp() AND NEW.status<>'cancelled') OR (NEW.status<>'pending' AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id)) THEN RAISE EXCEPTION 'early_bird_final_call_lease'; END IF;
 IF NEW.status='dispatched' AND (early_bird_current_time()<NEW.trigger_at OR early_bird_current_time()>=NEW.client_start_at) THEN RAISE EXCEPTION 'early_bird_final_call_window'; END IF;
 IF OLD.status='dispatched' AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id THEN RAISE EXCEPTION 'early_bird_final_call_attempt'; END IF;
 IF NEW.status='pending' AND (NEW.available_at<=early_bird_current_time() OR mod(extract(epoch from NEW.available_at-NEW.trigger_at)::numeric,86400)<>0) THEN RAISE EXCEPTION 'early_bird_final_call_retry_tick'; END IF;
 IF NEW.status<>'pending' AND NEW.available_at IS DISTINCT FROM OLD.available_at THEN RAISE EXCEPTION 'early_bird_final_call_available'; END IF;
 IF NOT ((OLD.status='pending' AND NEW.status IN ('preparing','cancelled'))
 OR (OLD.status='preparing' AND NEW.status IN ('preparing','pending','dispatched','cancelled'))
 OR (OLD.status='dispatched' AND NEW.status IN ('delivered','uncertain'))) THEN RAISE EXCEPTION 'early_bird_final_call_transition'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER early_bird_final_call_guard BEFORE INSERT OR UPDATE OR DELETE ON early_bird_final_call_queue FOR EACH ROW EXECUTE FUNCTION early_bird_final_call_guard();
--> statement-breakpoint
CREATE FUNCTION early_bird_final_call_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN DELETE FROM early_bird_final_call_queue WHERE user_id=NEW.user_id; RETURN NULL; END $$;
--> statement-breakpoint
CREATE TRIGGER early_bird_final_call_erasure AFTER INSERT ON expert_sales_erased_cohorts FOR EACH ROW EXECUTE FUNCTION early_bird_final_call_erasure();
--> statement-breakpoint
CREATE FUNCTION early_bird_final_call_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- No ONBOARDING_ONLY payment authority exists yet. A later reviewed migration
 -- must replace this gate when authoritative state and checkout exist.
 RAISE EXCEPTION 'early_bird_final_call_authority_unavailable';
END $$;
--> statement-breakpoint
CREATE TRIGGER early_bird_final_call_admission BEFORE INSERT ON early_bird_final_call_queue FOR EACH ROW EXECUTE FUNCTION early_bird_final_call_admission();
--> statement-breakpoint
-- Candidate segment 15: docs/superpowers/implementation-artifacts/drafts/early_bird_final_call_authority.sql
-- DRAFT: apply after 0077 final-call queue, 0088 deferred payments and 0089 refunds.
-- Owner approved repeat only if unpaid and no Pay click after 72 hours.
-- Telegram has no read receipts; clicks do not prove that a message was opened.
CREATE TABLE early_bird_final_call_policy (
 config_id uuid PRIMARY KEY REFERENCES early_bird_launch_configs(id),
 repeat_without_engagement boolean NOT NULL DEFAULT false
);
INSERT INTO early_bird_final_call_policy SELECT id,true FROM early_bird_launch_configs WHERE active AND phase='WAVE_1_EARLY_BIRD';
REVOKE ALL ON early_bird_final_call_policy FROM PUBLIC;
CREATE FUNCTION early_bird_final_call_check_schema() RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF has_schema_privilege('public','public','CREATE') OR EXISTS(
  SELECT 1 FROM pg_roles r CROSS JOIN pg_namespace n WHERE n.nspname='public' AND NOT r.rolsuper
   AND NOT pg_has_role(r.oid,n.nspowner,'MEMBER') AND has_schema_privilege(r.oid,n.oid,'CREATE')
 ) THEN RAISE EXCEPTION 'early_bird_final_call_untrusted_schema'; END IF;
END $$;
REVOKE ALL ON FUNCTION early_bird_final_call_check_schema() FROM PUBLIC;
CREATE FUNCTION early_bird_final_call_wave_policy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.early_bird_final_call_check_schema();
 IF NEW.active AND NEW.phase='WAVE_1_EARLY_BIRD' THEN
  INSERT INTO public.early_bird_final_call_policy(config_id,repeat_without_engagement) VALUES(NEW.id,true);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION early_bird_final_call_wave_policy() FROM PUBLIC;
CREATE TRIGGER early_bird_final_call_wave_policy AFTER INSERT ON early_bird_launch_configs FOR EACH ROW EXECUTE FUNCTION early_bird_final_call_wave_policy();
CREATE TABLE early_bird_final_call_engagements (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 config_id uuid NOT NULL REFERENCES early_bird_launch_configs(id),
 engaged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,config_id)
);
REVOKE ALL ON early_bird_final_call_engagements FROM PUBLIC;
CREATE TABLE early_bird_wave_one_exclusions (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL UNIQUE REFERENCES early_bird_deferred_accounts(id) ON DELETE CASCADE,
 excluded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL DEFAULT 'EXCLUDED_FROM_WAVE_1' CHECK(reason='EXCLUDED_FROM_WAVE_1')
);
REVOKE ALL ON early_bird_wave_one_exclusions FROM PUBLIC;

CREATE FUNCTION early_bird_final_call_refund_free(target_account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_invoices i
  WHERE i.account_id=target_account AND (
   EXISTS(SELECT 1 FROM public.early_bird_deferred_refund_facts f WHERE f.invoice_id=i.id AND f.user_id=i.user_id)
   OR EXISTS(SELECT 1 FROM public.early_bird_deferred_refund_reconciliation r WHERE r.invoice_id=i.id AND r.user_id=i.user_id)
   OR EXISTS(SELECT 1 FROM public.early_bird_deferred_verified_refund_bindings b WHERE b.invoice_id=i.id AND b.user_id=i.user_id
     AND NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_refund_resolutions resolved WHERE resolved.provider_refund_id=b.provider_refund_id AND resolved.invoice_id=b.invoice_id AND resolved.user_id=b.user_id AND resolved.disposition='canceled'))
  ))
$$;
REVOKE ALL ON FUNCTION early_bird_final_call_refund_free(uuid) FROM PUBLIC;

CREATE FUNCTION early_bird_final_call_eligible(target_user uuid,target_config uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.early_bird_final_call_check_schema();
 RETURN EXISTS(
  SELECT 1 FROM public.early_bird_deferred_accounts a
  JOIN public.users u ON u.id=a.user_id AND u.active
  JOIN public.expert_sales_bases b ON b.id=a.base_id AND b.user_id=a.user_id
  JOIN public.early_bird_choices c ON c.id=a.choice_id AND c.user_id=a.user_id AND c.base_id=a.base_id
  JOIN public.early_bird_launch_configs cfg ON cfg.id=a.config_id AND cfg.id=target_config
  JOIN public.early_bird_deferred_invoices paid ON paid.account_id=a.id AND paid.user_id=a.user_id AND paid.stage='onboarding' AND paid.captured_at IS NOT NULL AND paid.amount_minor=a.onboarding_minor
  JOIN public.early_bird_deferred_verified_bindings proof ON proof.invoice_id=paid.id AND proof.user_id=paid.user_id AND proof.provider_id=paid.provider_id AND proof.amount_minor=paid.amount_minor AND proof.evidence_digest=paid.evidence_digest
  WHERE a.user_id=target_user AND cfg.active AND cfg.phase='WAVE_1_EARLY_BIRD' AND cfg.client_start_at=a.launch_at
   AND public.early_bird_current_time()>=cfg.final_call_trigger_at AND public.early_bird_current_time()<a.launch_at
   AND c.choice='later' AND c.id=(SELECT id FROM public.early_bird_choices WHERE base_id=a.base_id ORDER BY decision_no DESC LIMIT 1)
   AND public.expert_card_current_messaging_authority(a.user_id,b.consent_version)
   AND public.early_bird_composite_qualification(a.user_id,a.choice_id)
   AND NOT EXISTS(SELECT 1 FROM public.expert_sales_erased_cohorts WHERE user_id=a.user_id)
   AND NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_invoices WHERE account_id=a.id AND stage='subscription' AND captured_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM public.early_bird_wave_one_exclusions WHERE user_id=a.user_id)
   AND public.early_bird_final_call_refund_free(a.id)
 );
END $$;
REVOKE ALL ON FUNCTION early_bird_final_call_eligible(uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION early_bird_final_call_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cfg public.early_bird_launch_configs%ROWTYPE; first_time timestamptz; first_created timestamptz;
BEGIN
 PERFORM public.early_bird_final_call_check_schema();
 IF TG_OP='UPDATE' AND NEW.status NOT IN('preparing','dispatched') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 SELECT * INTO cfg FROM public.early_bird_launch_configs WHERE active FOR SHARE;
 IF NOT FOUND OR NEW.config_version<>cfg.id::text OR NEW.trigger_at<>cfg.final_call_trigger_at OR NEW.client_start_at<>cfg.client_start_at
  OR NOT public.early_bird_final_call_eligible(NEW.user_id,cfg.id) THEN RAISE EXCEPTION 'early_bird_final_call_not_eligible'; END IF;
 IF NEW.kind='repeat' THEN
  IF NOT EXISTS(SELECT 1 FROM public.early_bird_final_call_policy WHERE config_id=cfg.id AND repeat_without_engagement) THEN RAISE EXCEPTION 'early_bird_repeat_policy_unapproved'; END IF;
  SELECT delivered_at,created_at INTO first_time,first_created FROM public.early_bird_final_call_queue WHERE user_id=NEW.user_id AND kind='first' AND status='delivered' FOR SHARE;
  IF first_time IS NULL OR NEW.scheduled_at<first_time+interval '72 hours'
   OR EXISTS(SELECT 1 FROM public.early_bird_final_call_engagements WHERE user_id=NEW.user_id AND config_id=cfg.id AND engaged_at>=first_created)
   THEN RAISE EXCEPTION 'early_bird_final_call_repeat_ineligible'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION early_bird_final_call_admission() FROM PUBLIC;
DROP TRIGGER early_bird_final_call_admission ON early_bird_final_call_queue;
CREATE TRIGGER early_bird_final_call_admission BEFORE INSERT OR UPDATE ON early_bird_final_call_queue FOR EACH ROW EXECUTE FUNCTION early_bird_final_call_admission();

-- Limit is applied only after removing ineligible, already scheduled and engaged
-- accounts. UUID order makes subsequent scans advance without a mutable cursor.
CREATE FUNCTION early_bird_final_call_scan(batch_size integer) RETURNS TABLE(user_id uuid,kind text,config_id uuid,trigger_at timestamptz,launch_at timestamptz,scheduled_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT a.user_id, candidate.kind,cfg.id,cfg.final_call_trigger_at,cfg.client_start_at,candidate.tick
 FROM public.early_bird_deferred_accounts a JOIN public.early_bird_launch_configs cfg ON cfg.id=a.config_id AND cfg.active
 LEFT JOIN public.early_bird_final_call_queue first_notice ON first_notice.user_id=a.user_id AND first_notice.kind='first' AND first_notice.status='delivered'
 CROSS JOIN LATERAL (
  SELECT 'first'::text kind,cfg.final_call_trigger_at tick
   WHERE NOT EXISTS(SELECT 1 FROM public.early_bird_final_call_queue q WHERE q.user_id=a.user_id AND q.kind='first' AND q.status<>'cancelled')
  UNION ALL
  SELECT 'repeat'::text,cfg.final_call_trigger_at+ceil(extract(epoch FROM(first_notice.delivered_at+interval '72 hours'-cfg.final_call_trigger_at))/86400)*interval '1 day'
   WHERE first_notice.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.early_bird_final_call_policy WHERE config_id=cfg.id AND repeat_without_engagement)
    AND NOT EXISTS(SELECT 1 FROM public.early_bird_final_call_queue q WHERE q.user_id=a.user_id AND q.kind='repeat' AND q.status<>'cancelled')
    AND NOT EXISTS(SELECT 1 FROM public.early_bird_final_call_engagements e WHERE e.user_id=a.user_id AND e.config_id=cfg.id AND e.engaged_at>=first_notice.created_at)
 ) candidate
 WHERE public.early_bird_final_call_eligible(a.user_id,cfg.id) AND candidate.tick<=public.early_bird_current_time() AND candidate.tick<cfg.client_start_at
 ORDER BY a.user_id,candidate.kind LIMIT greatest(0,least(batch_size,50))
$$;
REVOKE ALL ON FUNCTION early_bird_final_call_scan(integer) FROM PUBLIC;

CREATE FUNCTION early_bird_final_call_enqueue(target_user uuid,target_kind text,target_config uuid,target_tick timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cfg public.early_bird_launch_configs%ROWTYPE; inserted uuid;
BEGIN
 PERFORM public.early_bird_final_call_check_schema();
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO cfg FROM public.early_bird_launch_configs WHERE id=target_config AND active FOR SHARE;
 IF NOT FOUND OR NOT public.early_bird_final_call_eligible(target_user,target_config) OR target_tick>public.early_bird_current_time() THEN RETURN false; END IF;
 INSERT INTO public.early_bird_final_call_queue(user_id,kind,config_version,trigger_at,client_start_at,scheduled_at,available_at)
 VALUES(target_user,target_kind,cfg.id::text,cfg.final_call_trigger_at,cfg.client_start_at,target_tick,target_tick)
 ON CONFLICT DO NOTHING RETURNING id INTO inserted;
 RETURN inserted IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION early_bird_final_call_enqueue(uuid,text,uuid,timestamptz) FROM PUBLIC;

-- Exclusion is a wave admission fact, not deletion of an expert account or a
-- refund decision. A later standard onboarding procedure may publish again.
CREATE FUNCTION early_bird_final_call_exclude(batch_size integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate record; changed integer:=0;
BEGIN
 PERFORM public.early_bird_final_call_check_schema();
 FOR candidate IN SELECT a.id,a.user_id FROM public.early_bird_deferred_accounts a
  WHERE a.launch_at<=public.early_bird_current_time()
   AND EXISTS(SELECT 1 FROM public.early_bird_deferred_invoices i JOIN public.early_bird_deferred_verified_bindings p ON p.invoice_id=i.id AND p.user_id=i.user_id AND p.provider_id=i.provider_id AND p.amount_minor=i.amount_minor AND p.evidence_digest=i.evidence_digest WHERE i.account_id=a.id AND i.stage='onboarding' AND i.captured_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_invoices paid JOIN public.early_bird_deferred_verified_bindings proof ON proof.invoice_id=paid.id AND proof.user_id=paid.user_id AND proof.provider_id=paid.provider_id AND proof.amount_minor=paid.amount_minor AND proof.evidence_digest=paid.evidence_digest WHERE paid.account_id=a.id AND paid.stage='subscription' AND paid.captured_at<a.launch_at AND public.early_bird_final_call_refund_free(a.id))
   AND NOT EXISTS(SELECT 1 FROM public.early_bird_wave_one_exclusions WHERE user_id=a.user_id)
  ORDER BY a.user_id LIMIT greatest(0,least(batch_size,50))
 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(candidate.user_id::text,0));
  IF EXISTS(SELECT 1 FROM public.early_bird_deferred_accounts a JOIN public.early_bird_deferred_invoices paid ON paid.account_id=a.id JOIN public.early_bird_deferred_verified_bindings proof ON proof.invoice_id=paid.id AND proof.user_id=paid.user_id AND proof.provider_id=paid.provider_id AND proof.amount_minor=paid.amount_minor AND proof.evidence_digest=paid.evidence_digest WHERE a.id=candidate.id AND paid.stage='subscription' AND paid.captured_at<a.launch_at AND public.early_bird_final_call_refund_free(a.id)) THEN CONTINUE; END IF;
  INSERT INTO public.early_bird_wave_one_exclusions(user_id,account_id) VALUES(candidate.user_id,candidate.id) ON CONFLICT DO NOTHING;
  IF FOUND THEN
   UPDATE public.experts_published SET active=false,updated_at=clock_timestamp() WHERE user_id=candidate.user_id AND active;
   UPDATE public.early_bird_final_call_queue SET status='cancelled',prepared_until=NULL WHERE user_id=candidate.user_id AND status IN('pending','preparing');
   changed:=changed+1;
  END IF;
 END LOOP;
 RETURN changed;
END $$;
REVOKE ALL ON FUNCTION early_bird_final_call_exclude(integer) FROM PUBLIC;

-- A delayed webhook for an actually timely subscription payment is not evidence
-- of an unpaid resident. Remove the exclusion only with matching verified facts;
-- publishing still requires the separate reviewed coverage/publication gate.
CREATE FUNCTION early_bird_final_call_late_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.stage='subscription' AND NEW.captured_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM public.early_bird_deferred_accounts a JOIN public.early_bird_deferred_verified_bindings p ON p.invoice_id=NEW.id AND p.user_id=NEW.user_id AND p.provider_id=NEW.provider_id AND p.amount_minor=NEW.amount_minor AND p.evidence_digest=NEW.evidence_digest
    WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id AND NEW.captured_at<a.launch_at AND public.early_bird_final_call_refund_free(a.id))
 THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  DELETE FROM public.early_bird_wave_one_exclusions WHERE account_id=NEW.account_id AND user_id=NEW.user_id;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION early_bird_final_call_late_evidence() FROM PUBLIC;
CREATE TRIGGER early_bird_final_call_late_evidence AFTER INSERT OR UPDATE OF captured_at ON early_bird_deferred_invoices FOR EACH ROW EXECUTE FUNCTION early_bird_final_call_late_evidence();
CREATE OR REPLACE FUNCTION early_bird_final_call_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.early_bird_final_call_check_schema();
 DELETE FROM public.early_bird_final_call_queue WHERE user_id=NEW.user_id;
 DELETE FROM public.early_bird_final_call_engagements WHERE user_id=NEW.user_id;
 DELETE FROM public.early_bird_wave_one_exclusions WHERE user_id=NEW.user_id;
 RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION early_bird_final_call_erasure() FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 16: docs/superpowers/implementation-artifacts/drafts/wave_workspace_gate.sql
-- DRAFT ONLY. Workspace eligibility is not publication authority. The caller
-- must hold the user's consent-subject lock and recheck messaging consent.
CREATE FUNCTION early_bird_paid_workspace(target_user uuid) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT b.application_id
 FROM public.early_bird_payment_successes s
 JOIN public.early_bird_composite_intents i ON i.id=s.intent_id AND i.user_id=s.user_id
 JOIN public.early_bird_choices current_choice ON current_choice.id=i.choice_id AND current_choice.user_id=i.user_id
 JOIN public.early_bird_choices approved_choice ON approved_choice.base_id=current_choice.base_id AND approved_choice.user_id=current_choice.user_id
 JOIN public.early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
 JOIN public.expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=b.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL
 JOIN public.users u ON u.id=i.user_id AND u.active
 WHERE i.user_id=target_user AND s.disposition='eligible'
  AND EXISTS(SELECT 1 FROM public.residents_applications f JOIN public.expert_verification_decisions d ON d.application_id=b.application_id AND d.user_id=b.user_id AND d.decision='approved' JOIN public.resident_review_events re ON re.attempt_id=f.id AND re.manager_id=d.manager_id AND re.session_hash=d.manager_session_hash AND re.action=f.status AND re.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(public.digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_payment_full_refunds r WHERE r.intent_id=s.intent_id)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_coverage_reconciliation q WHERE q.user_id=i.user_id)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_refund_reconciliation q WHERE q.user_id=i.user_id)
 ORDER BY s.recorded_at,s.intent_id LIMIT 1
$$;
REVOKE ALL ON FUNCTION early_bird_paid_workspace(uuid) FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 17: docs/superpowers/implementation-artifacts/drafts/wave_admission_projection.sql
CREATE OR REPLACE FUNCTION enforce_expert_residency_calendar_pause() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.active AND EXISTS(SELECT 1 FROM public.expert_residency_lifecycle WHERE user_id=NEW.user_id AND status='paused') THEN RAISE EXCEPTION 'residency_paused' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- Qualify legacy helper dependencies for restricted SECURITY DEFINER callers.
CREATE OR REPLACE FUNCTION expert_card_current_messaging_authority(target_user uuid,target_policy text) RETURNS boolean LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.consent_states s JOIN public.consents c ON c.id=s.last_decision_id AND c.user_id=s.user_id AND c.consent_type=s.purpose AND c.decision='granted'
 JOIN public.consent_document_versions d ON d.id=c.document_version_id AND d.id=s.document_version_id
 JOIN public.consent_presentations p ON p.id=c.presentation_id AND p.user_id=c.user_id AND p.purpose=c.consent_type AND p.document_version_id=d.id AND p.channel=c.channel
 WHERE s.user_id=target_user AND s.purpose='client_messaging' AND s.decision='granted' AND s.revision>0
 AND c.policy_version=target_policy AND c.basis='consent' AND c.scope_fields='{}'::jsonb AND c.recipient_id IS NULL AND c.reservation_id IS NULL AND c.text_sha256=d.text_sha256
 AND d.document_key='consent.client_messaging' AND d.status='approved' AND d.effective_at<=clock_timestamp()
 AND d.version=(SELECT max(candidate.version) FROM public.consent_document_versions candidate WHERE candidate.document_key=d.document_key AND candidate.status='approved' AND candidate.effective_at<=clock_timestamp())
 AND (c.policy_version='client-messaging-v'||d.version::text OR c.policy_version='messaging-v'||d.version::text)
 AND p.consumed_at IS NOT NULL AND p.invalidated_at IS NULL AND p.consumed_at>=p.created_at AND p.consumed_at<p.expires_at AND c.created_at>=p.created_at
 AND c.created_at=(SELECT max(candidate.created_at) FROM public.consents candidate WHERE candidate.user_id=c.user_id AND candidate.consent_type=c.consent_type)
 AND coalesce((SELECT bool_and(latest.decision='granted' AND latest.policy_version=target_policy) FROM public.consents latest WHERE latest.user_id=target_user AND latest.consent_type='client_messaging' AND latest.created_at=c.created_at),false))
$$;
CREATE OR REPLACE FUNCTION public.resident_safety_normalize(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT lower(regexp_replace(translate(normalize(value,NFKC), E'\t\n\r'||chr(160)||chr(8239), '     '), '[[:space:]]+', ' ', 'g') COLLATE "C.utf8")
$$;
CREATE OR REPLACE FUNCTION public.resident_safety_compile(source text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE s text:=source; bounded boolean:=false; alternatives text[]; branch text; atoms jsonb; result jsonb:='[]'; literal text; i integer; c text; atom_count integer;
BEGIN
 IF octet_length(s)>512 OR length(s)=0 THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
 IF left(s,2)='\b' AND right(s,2)='\b' THEN bounded:=true; s:=substr(s,3,length(s)-4); END IF;
 IF left(s,1)='(' AND right(s,1)=')' THEN s:=substr(s,2,length(s)-2); END IF;
 alternatives:=string_to_array(s,'|');
 IF cardinality(alternatives)>16 THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
 FOREACH branch IN ARRAY alternatives LOOP
  IF branch='' THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
  atoms:='[]'; literal:=''; i:=1; atom_count:=0;
  WHILE i<=length(branch) LOOP
   c:=substr(branch,i,1);
   IF substr(branch,i,3)='\s+' OR substr(branch,i,3)='\d+' OR substr(branch,i,4)='[км]' THEN
    IF literal<>'' THEN atoms:=atoms||jsonb_build_array(jsonb_build_object('literal',public.resident_safety_normalize(literal))); literal:=''; END IF;
    IF substr(branch,i,3)='\s+' THEN atoms:=atoms||'[{"space":true}]'; i:=i+3;
    ELSIF substr(branch,i,3)='\d+' THEN
     IF branch NOT IN('доходность\s+\d+%','заработок\s+\d+[км]\s+в\s+день','заработок\s+\d+[км]\s+в\s+неделю','заработок\s+\d+[км]\s+в\s+месяц') THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
     atoms:=atoms||'[{"digits":true}]'; i:=i+3;
    ELSE atoms:=atoms||'[{"unit":true}]'; i:=i+4; END IF;
   ELSIF c='\' THEN
    IF substr(branch,i+1,1) NOT IN('.','/','#','%','-','_') THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
    literal:=literal||substr(branch,i+1,1); i:=i+2;
   ELSIF c IN('(',')','[',']','{','}','*','+','?','^','$','.') OR ascii(c)<32 THEN RAISE EXCEPTION 'resident_safety_invalid_pattern';
   ELSE literal:=literal||c; i:=i+1; END IF;
  END LOOP;
  IF literal<>'' THEN atoms:=atoms||jsonb_build_array(jsonb_build_object('literal',public.resident_safety_normalize(literal))); END IF;
  atom_count:=jsonb_array_length(atoms);
  IF atom_count=0 OR atom_count>16 OR NOT (atoms->0 ? 'literal') OR atoms->0->>'literal'='' THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
  result:=result||jsonb_build_array(atoms);
 END LOOP;
 RETURN jsonb_build_object('bounded',bounded,'alternatives',result);
END $$;
CREATE OR REPLACE FUNCTION public.resident_safety_matches_normalized(value text, program jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE s text:=value; branch jsonb; atom jsonb; prefix text; cursor_pos integer; start_pos integer; offset_pos integer; digit_start integer; ok boolean; steps integer:=0; word_left boolean; word_right boolean;
BEGIN
 IF octet_length(value)>64000 THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
 FOR branch IN SELECT jsonb_array_elements(program->'alternatives') LOOP
  prefix:=branch->0->>'literal'; offset_pos:=1;
  LOOP
   start_pos:=strpos(substr(s,offset_pos),prefix); EXIT WHEN start_pos=0;
   start_pos:=start_pos+offset_pos-1; cursor_pos:=start_pos; ok:=true;
   FOR atom IN SELECT jsonb_array_elements(branch) LOOP
    steps:=steps+1; IF steps>131072 THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
    IF atom ? 'literal' THEN
     IF substr(s,cursor_pos,length(atom->>'literal'))<>atom->>'literal' THEN ok:=false; EXIT; END IF;
     cursor_pos:=cursor_pos+length(atom->>'literal');
    ELSIF atom ? 'space' THEN
     IF substr(s,cursor_pos,1)<>' ' THEN ok:=false; EXIT; END IF; cursor_pos:=cursor_pos+1;
    ELSIF atom ? 'digits' THEN
     digit_start:=cursor_pos;
     WHILE substr(s,cursor_pos,1) IN('0','1','2','3','4','5','6','7','8','9') LOOP cursor_pos:=cursor_pos+1; END LOOP;
     IF cursor_pos=digit_start THEN ok:=false; EXIT; END IF;
    ELSIF atom ? 'unit' THEN
     IF substr(s,cursor_pos,1) NOT IN('к','м') THEN ok:=false; EXIT; END IF; cursor_pos:=cursor_pos+1;
    ELSE RAISE EXCEPTION 'resident_safety_corrupt_program'; END IF;
   END LOOP;
   IF ok AND (NOT (program->>'bounded')::boolean OR
    ((start_pos=1 OR substr(s,start_pos-1,1) COLLATE "C.utf8" !~ '[[:alnum:]_]') AND
     (cursor_pos>length(s) OR substr(s,cursor_pos,1) COLLATE "C.utf8" !~ '[[:alnum:]_]'))) THEN RETURN true; END IF;
   offset_pos:=start_pos+1;
  END LOOP;
 END LOOP;
 RETURN false;
END $$;
CREATE OR REPLACE FUNCTION resident_safety_assess(fields jsonb, revision integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE active_policy uuid; activation_id uuid; activation_generation bigint; engine_name text; r record; f record; issues jsonb:='[]'; normalized text; normalized_fields jsonb; letters integer; capitals integer; bytes bigint; n integer;
BEGIN
 SELECT a.policy_id,a.publication_id,publication.generation,p.engine INTO active_policy,activation_id,activation_generation,engine_name FROM public.resident_safety_active a JOIN public.resident_safety_policies p ON p.id=a.policy_id AND p.published_at IS NOT NULL JOIN public.resident_safety_publications publication ON publication.id=a.publication_id AND publication.policy_id=a.policy_id WHERE a.id=1 FOR SHARE OF a;
 IF active_policy IS NULL OR engine_name<>'resident_safe_regex_v1' THEN RAISE EXCEPTION 'resident_safety_policy_unavailable'; END IF;
 IF jsonb_typeof(fields)<>'object' THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
 SELECT count(*),sum(octet_length(value)) INTO n,bytes FROM jsonb_each_text(fields);
 IF n>125 OR bytes>2097152 OR EXISTS(SELECT 1 FROM jsonb_each(fields) WHERE jsonb_typeof(value)<>'string' OR octet_length(key)>100) THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
 SELECT coalesce(jsonb_object_agg(key,public.resident_safety_normalize(value)),'{}') INTO normalized_fields FROM jsonb_each_text(fields);
 SELECT count(*) INTO n FROM public.forbidden_patterns WHERE policy_id=active_policy AND is_active;
 IF n<1 OR n>256 THEN RAISE EXCEPTION 'resident_safety_policy_unavailable'; END IF;
 FOR r IN SELECT * FROM public.forbidden_patterns WHERE policy_id=active_policy AND is_active ORDER BY id LOOP
  IF r.compiled IS DISTINCT FROM public.resident_safety_compile(r.pattern_regex) THEN RAISE EXCEPTION 'resident_safety_policy_corrupt'; END IF;
  FOR f IN SELECT * FROM jsonb_each_text(normalized_fields) LOOP
   IF public.resident_safety_matches_normalized(f.value,r.compiled) THEN issues:=issues||jsonb_build_array(jsonb_build_object('field',f.key,'ruleId',r.id,'severity',r.severity_level,'reason',r.error_message_template)); END IF;
  END LOOP;
 END LOOP;
 FOR f IN SELECT * FROM jsonb_each_text(fields) LOOP
  IF octet_length(f.value)>64000 THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
  normalized:=normalize(f.value,NFKC);
  IF translate(normalized,chr(173)||chr(8203)||chr(8204)||chr(8205)||chr(8206)||chr(8207)||chr(8234)||chr(8235)||chr(8236)||chr(8237)||chr(8238)||chr(8288)||chr(8294)||chr(8295)||chr(8296)||chr(8297)||chr(65279),'') IS DISTINCT FROM normalized THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('field',f.key,'ruleId',null,'severity','BLOCKER','reason','Уберите невидимые управляющие символы и повторите ввод обычным текстом.'));
  END IF;
  SELECT count(*) FILTER(WHERE lower(c COLLATE "C.utf8")<>upper(c COLLATE "C.utf8")), count(*) FILTER(WHERE lower(c COLLATE "C.utf8")<>upper(c COLLATE "C.utf8") AND c=upper(c COLLATE "C.utf8")) INTO letters,capitals FROM regexp_split_to_table(normalized,'') c;
  IF capitals*2>letters THEN issues:=issues||jsonb_build_array(jsonb_build_object('field',f.key,'ruleId',null,'severity','WARNING','reason','Пожалуйста, используйте обычный регистр. КАПС воспринимается как крик.')); END IF;
 END LOOP;
 RETURN jsonb_build_object('policyId',active_policy,'publicationId',activation_id,'generation',activation_generation::text,'revision',revision,'digest',encode(public.digest(jsonb_build_object('fields',fields,'revision',revision,'policy',active_policy,'publication',activation_id)::text,'sha256'),'hex'),'issues',issues,'blocked',EXISTS(SELECT 1 FROM jsonb_array_elements(issues) i WHERE i->>'severity'='BLOCKER'));
END $$;
-- DRAFT: discovery only; this view is not an authorization to publish.
-- Production publication still requires an immutable admission, guarded
-- projection, isolated writer and atomic refund/reprojection.
CREATE VIEW early_bird_admission_candidates AS
SELECT s.intent_id,s.user_id,e.id AS expert_id,d.id AS draft_id,r.id AS review_id,
       r.revision,r.public_digest,r.public_payload,c.starts_at,c.ends_at
FROM early_bird_payment_successes s
JOIN early_bird_effective_coverages c ON c.intent_id=s.intent_id
JOIN early_bird_composite_intents i ON i.id=s.intent_id AND i.user_id=s.user_id
JOIN early_bird_choices choice ON choice.id=i.choice_id AND choice.user_id=i.user_id
JOIN early_bird_choices approved_choice ON approved_choice.base_id=choice.base_id AND approved_choice.user_id=choice.user_id
JOIN early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
JOIN expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=i.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL
JOIN expert_card_drafts d ON d.application_id=a.id AND d.user_id=i.user_id
JOIN resident_card_versions v ON v.draft_id=d.id
JOIN expert_card_reviews r ON r.id=v.review_id AND r.user_id=i.user_id AND r.action='approve' AND r.revision=v.revision AND r.public_payload=v.public_payload
JOIN users u ON u.id=i.user_id AND u.active
JOIN experts e ON e.user_id=u.id
WHERE c.starts_at<=clock_timestamp() AND c.ends_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM residents_applications f JOIN expert_verification_decisions vd ON vd.application_id=b.application_id AND vd.user_id=b.user_id AND vd.decision='approved' JOIN resident_review_events re ON re.attempt_id=f.id AND re.manager_id=vd.manager_id AND re.session_hash=vd.manager_session_hash AND re.action=f.status AND re.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
 AND v.revision=(SELECT max(latest.revision) FROM resident_card_versions latest WHERE latest.draft_id=d.id)
 AND expert_card_current_messaging_authority(i.user_id,d.messaging_policy_version)
 AND EXISTS(SELECT 1 FROM channel_identities ci WHERE ci.user_id=i.user_id AND ci.provider='telegram' AND ci.bot_key=d.work_bot_key AND ci.external_id=d.work_chat_id AND ci.external_chat_id=d.work_chat_id AND ci.status='active')
 AND resident_safety_assess(v.safety_fields,v.revision)=v.safety_proof
 AND NOT (v.safety_proof->>'blocked')::boolean
 AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds h WHERE h.expert_id=e.id AND h.status='open')
 AND NOT EXISTS(SELECT 1 FROM expert_residency_lifecycle l WHERE l.expert_id=e.id AND l.status='paused')
 AND NOT EXISTS(SELECT 1 FROM early_bird_coverage_reconciliation pending WHERE pending.user_id=i.user_id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_refund_reconciliation pending WHERE pending.user_id=i.user_id);
REVOKE ALL ON early_bird_admission_candidates FROM PUBLIC;

-- A historical admission is distinct from the live eligibility view. It is
-- never enough on its own to expose a card; every read must re-evaluate live
-- coverage and all consent/safety/hold conditions.
CREATE TABLE early_bird_admissions (
 intent_id uuid NOT NULL REFERENCES early_bird_payment_successes(intent_id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 expert_id uuid NOT NULL,
 draft_id uuid NOT NULL,
 review_id uuid NOT NULL,
 revision integer NOT NULL,
 public_digest text NOT NULL,
 admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(intent_id,review_id)
);
REVOKE ALL ON early_bird_admissions FROM PUBLIC;
CREATE FUNCTION early_bird_guard_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.early_bird_admission_candidates c
   WHERE c.intent_id=NEW.intent_id AND c.user_id=NEW.user_id AND c.expert_id=NEW.expert_id
     AND c.draft_id=NEW.draft_id AND c.review_id=NEW.review_id AND c.revision=NEW.revision
     AND c.public_digest=NEW.public_digest) THEN
   RAISE EXCEPTION 'early_bird_admission_source';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER early_bird_admission_source BEFORE INSERT ON early_bird_admissions FOR EACH ROW EXECUTE FUNCTION early_bird_guard_admission();
CREATE TRIGGER early_bird_admission_immutable BEFORE UPDATE OR DELETE ON early_bird_admissions FOR EACH ROW EXECUTE FUNCTION early_bird_success_immutable();
REVOKE ALL ON FUNCTION early_bird_guard_admission() FROM PUBLIC;

-- DRAFT ONLY. Keep legacy guard unchanged after the additional wave branch.
ALTER TABLE experts_published ALTER COLUMN paid_order_id DROP NOT NULL;
ALTER TABLE experts_published ADD COLUMN wave_intent_id uuid REFERENCES early_bird_payment_successes(intent_id) ON DELETE CASCADE;
ALTER TABLE experts_published ADD CONSTRAINT expert_published_exact_payment_source CHECK ((paid_order_id IS NULL) <> (wave_intent_id IS NULL));
CREATE OR REPLACE FUNCTION enforce_expert_published_card_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN

 IF TG_OP='UPDATE' AND NOT NEW.active AND (to_jsonb(NEW)-ARRAY['active','updated_at'])=(to_jsonb(OLD)-ARRAY['active','updated_at']) THEN RETURN NEW; END IF;
 -- Wave sources must match immutable admission and current, unrevoked
 -- eligibility, including reviewed payload, coverage, consent and safety.
 IF NEW.wave_intent_id IS NOT NULL AND NEW.paid_order_id IS NULL THEN
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.expert_card_drafts d WHERE d.id=NEW.draft_id AND d.user_id=NEW.user_id AND d.status='approved' AND d.approved_review_id=NEW.review_id AND d.revision=NEW.revision) THEN RAISE EXCEPTION 'expert_published_wave_source' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM public.early_bird_admissions a JOIN public.early_bird_admission_candidates c ON c.intent_id=a.intent_id AND c.user_id=a.user_id AND c.expert_id=a.expert_id AND c.draft_id=a.draft_id AND c.review_id=a.review_id AND c.revision=a.revision AND c.public_digest=a.public_digest JOIN public.expert_card_drafts d ON d.id=a.draft_id
   WHERE EXISTS(SELECT 1 FROM public.experts verified_expert WHERE verified_expert.id=NEW.expert_id AND verified_expert.user_id=NEW.user_id AND verified_expert.active AND verified_expert.verified) AND a.intent_id=NEW.wave_intent_id AND a.user_id=NEW.user_id AND a.expert_id=NEW.expert_id AND a.draft_id=NEW.draft_id AND a.review_id=NEW.review_id AND a.revision=NEW.revision AND a.public_digest=NEW.public_digest AND c.public_payload=NEW.public_payload AND d.application_id=NEW.application_audit_id AND c.ends_at=NEW.next_billing_date) THEN
    RAISE EXCEPTION 'expert_published_wave_source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;

 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['review_id','revision','public_digest','public_payload','updated_at','active','next_billing_date','paid_order_id'])=(to_jsonb(OLD)-ARRAY['review_id','revision','public_digest','public_payload','updated_at','active','next_billing_date','paid_order_id']) AND EXISTS(
 SELECT 1 FROM public.resident_card_versions v JOIN public.expert_card_reviews r ON r.id=v.review_id JOIN public.expert_card_drafts d ON d.id=v.draft_id AND ((r.id=(SELECT latest.review_id FROM public.resident_card_versions latest WHERE latest.draft_id=d.id ORDER BY latest.revision DESC LIMIT 1)) OR (r.id=OLD.review_id AND NEW.review_id=OLD.review_id))
 JOIN public.expert_card_main_orders m ON m.order_id=NEW.paid_order_id AND m.user_id=NEW.user_id AND m.expert_id=NEW.expert_id
 JOIN public.expert_main_activation_admissions a ON a.order_id=m.order_id AND a.review_audit_id=m.review_audit_id AND a.public_digest=m.public_digest
 WHERE v.review_id=NEW.review_id AND v.draft_id=NEW.draft_id AND v.revision=NEW.revision AND r.public_digest=NEW.public_digest AND r.public_payload=NEW.public_payload AND r.user_id=NEW.user_id AND public.expert_card_activation_gate_valid(NEW.user_id,NEW.review_id) AND EXISTS(SELECT 1 FROM public.expert_residency_current_coverage(NEW.expert_id) c WHERE c.source_order_id=NEW.paid_order_id AND c.ends_at=NEW.next_billing_date) AND (NOT NEW.active OR (EXISTS(SELECT 1 FROM public.experts e WHERE e.id=NEW.expert_id AND e.user_id=NEW.user_id AND e.active AND e.verified) AND NOT EXISTS(SELECT 1 FROM public.expert_referral_abuse_holds WHERE expert_id=NEW.expert_id AND status='open') AND NOT EXISTS(SELECT 1 FROM public.expert_residency_lifecycle WHERE expert_id=NEW.expert_id AND status='paused')))
 ) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NOT NEW.active AND (to_jsonb(NEW)-ARRAY['active','updated_at'])=(to_jsonb(OLD)-ARRAY['active','updated_at']) THEN RETURN NEW; END IF;
 IF NEW.draft_id IS NULL OR NEW.review_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.experts e JOIN public.users u ON u.id=e.user_id AND u.active JOIN public.expert_card_reviews r ON r.id=NEW.review_id
   JOIN public.expert_card_drafts d ON d.id=NEW.draft_id AND d.approved_review_id=r.id AND d.revision=r.revision
   JOIN public.expert_residency_orders o ON o.id=NEW.paid_order_id AND o.expert_id=e.id AND o.status='settled'
   JOIN public.expert_card_main_orders m ON m.order_id=o.id AND m.expert_id=e.id AND m.user_id=NEW.user_id AND m.review_id=r.id AND m.revision=NEW.revision AND m.public_digest=NEW.public_digest
   WHERE public.expert_card_activation_gate_valid(NEW.user_id,NEW.review_id) AND e.id=NEW.expert_id AND e.user_id=NEW.user_id AND e.active AND e.verified AND d.user_id=e.user_id
     AND EXISTS(SELECT 1 FROM public.expert_main_activation_admissions admission WHERE admission.order_id=o.id AND admission.user_id=NEW.user_id AND admission.expert_id=NEW.expert_id AND admission.quote_id=m.quote_id AND admission.application_audit_id=NEW.application_audit_id AND admission.review_audit_id=m.review_audit_id AND admission.public_digest=NEW.public_digest)
     AND d.application_id=NEW.application_audit_id AND r.action='approve' AND r.revision=NEW.revision
     AND r.public_digest=NEW.public_digest AND r.public_payload=NEW.public_payload AND o.residency_ends_at=NEW.next_billing_date)
 OR (NEW.active AND (NEW.next_billing_date<=clock_timestamp() OR NOT EXISTS(
   SELECT 1 FROM public.expert_residency_orders o WHERE o.expert_id=NEW.expert_id AND o.status='settled' AND o.residency_starts_at<=clock_timestamp() AND o.residency_ends_at>clock_timestamp()))) THEN
  RAISE EXCEPTION 'expert_published_card_source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Single read-time authority for wave listings and native reservations. A
-- persisted active projection is never sufficient after refund or revocation.
CREATE FUNCTION early_bird_current_publication_valid(target_expert uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.experts_published p
  JOIN public.early_bird_admissions a ON a.intent_id=p.wave_intent_id
  JOIN public.early_bird_admission_candidates c ON c.intent_id=a.intent_id AND c.user_id=a.user_id AND c.expert_id=a.expert_id AND c.draft_id=a.draft_id AND c.review_id=a.review_id AND c.revision=a.revision AND c.public_digest=a.public_digest
  JOIN public.expert_card_drafts d ON d.id=a.draft_id
  JOIN public.experts e ON e.id=p.expert_id AND e.user_id=p.user_id AND e.active AND e.verified
  WHERE p.expert_id=target_expert AND p.active AND p.paid_order_id IS NULL
   AND p.user_id=a.user_id AND p.expert_id=a.expert_id AND p.draft_id=a.draft_id AND p.review_id=a.review_id
   AND p.revision=a.revision AND p.public_digest=a.public_digest AND p.public_payload=c.public_payload
   AND p.application_audit_id=d.application_id AND p.next_billing_date=c.ends_at)
$$;
REVOKE ALL ON FUNCTION early_bird_current_publication_valid(uuid) FROM PUBLIC;

-- Dynamic guarded dispatch prevents PostgreSQL from checking the restricted
-- wave function privilege for ordinary legacy-only database principals.
CREATE FUNCTION early_bird_native_wave_allowed(target_expert uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE allowed boolean;
BEGIN
 IF NOT has_function_privilege(current_user,'public.early_bird_current_publication_valid(uuid)','EXECUTE') THEN RETURN false; END IF;
 EXECUTE 'SELECT public.early_bird_current_publication_valid($1)' INTO allowed USING target_expert;
 RETURN coalesce(allowed,false);
END $$;
CREATE OR REPLACE FUNCTION resident_native_admission(target_expert uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM experts e JOIN users u ON u.id=e.user_id JOIN experts_published p ON p.expert_id=e.id AND p.user_id=e.user_id JOIN resident_card_versions v ON v.review_id=p.review_id JOIN expert_card_drafts d ON d.id=v.draft_id
 WHERE e.id=target_expert AND e.active AND e.verified AND u.active AND p.active AND p.review_id=(SELECT latest.review_id FROM resident_card_versions latest WHERE latest.draft_id=d.id ORDER BY latest.revision DESC LIMIT 1)
 AND ((expert_card_activation_gate_valid(e.user_id,p.review_id) AND EXISTS(SELECT 1 FROM expert_residency_current_coverage(e.id))) OR early_bird_native_wave_allowed(e.id))
 AND NOT EXISTS(SELECT 1 FROM expert_onboarding_applications a WHERE a.user_id=e.user_id AND (a.archived_at IS NOT NULL OR a.archive_until_date IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM expert_residency_lifecycle l WHERE l.expert_id=e.id AND l.status='paused')
 AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds h WHERE h.expert_id=e.id AND h.status='open'))
$$;

-- Revocation is idempotent and never manufactures a legacy paid order.
-- Restoring an alternative legacy source requires its existing guarded flow.
CREATE FUNCTION early_bird_deactivate_refunded_projection(target_user uuid,target_intent uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.early_bird_payment_full_refunds f WHERE f.intent_id=target_intent AND f.user_id=target_user) THEN RAISE EXCEPTION 'early_bird_projection_refund_required'; END IF;
 UPDATE public.experts_published SET active=false,updated_at=clock_timestamp()
 WHERE user_id=target_user AND wave_intent_id=target_intent AND active;
END $$;
REVOKE ALL ON FUNCTION early_bird_deactivate_refunded_projection(uuid,uuid) FROM PUBLIC;

-- Isolated activation capability; no PUBLIC grants. This must run in a fresh
-- serializable transaction with retry and under the same subject/epoch lock as
-- refund and consent changes. Existing published identities are left for the
-- established guarded re-projection flow.
CREATE FUNCTION early_bird_activate_projection(target_user uuid,target_intent uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c record; existing public.early_bird_admissions%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation') <> 'serializable' THEN RAISE EXCEPTION 'early_bird_projection_serializable_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 PERFORM public.early_bird_touch_coverage_epoch(target_user);
 IF public.early_bird_paid_workspace(target_user) IS NULL THEN RAISE EXCEPTION 'early_bird_projection_not_eligible'; END IF;
 INSERT INTO public.experts(user_id,active,verified) VALUES(target_user,false,false) ON CONFLICT(user_id) DO NOTHING;
 SELECT candidate.* INTO c FROM public.early_bird_admission_candidates candidate JOIN public.expert_card_drafts d ON d.id=candidate.draft_id AND d.user_id=candidate.user_id AND d.status='approved' AND d.approved_review_id=candidate.review_id AND d.revision=candidate.revision WHERE candidate.intent_id=target_intent AND candidate.user_id=target_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_projection_not_eligible'; END IF;
 SELECT * INTO existing FROM public.early_bird_admissions WHERE intent_id=target_intent AND review_id=c.review_id;
 IF FOUND AND (existing.user_id<>c.user_id OR existing.expert_id<>c.expert_id OR existing.draft_id<>c.draft_id OR existing.review_id<>c.review_id OR existing.revision<>c.revision OR existing.public_digest<>c.public_digest) THEN RAISE EXCEPTION 'early_bird_admission_conflict'; END IF;
 IF EXISTS(SELECT 1 FROM public.experts_published WHERE expert_id=c.expert_id) THEN
   IF EXISTS(SELECT 1 FROM public.experts_published WHERE expert_id=c.expert_id AND wave_intent_id=target_intent) AND public.early_bird_current_publication_valid(c.expert_id) THEN RETURN; END IF;
   RAISE EXCEPTION 'early_bird_projection_existing_requires_reconciliation';
 END IF;
 UPDATE public.experts SET active=true,verified=true,public_display_name=c.public_payload->>'displayName',updated_at=clock_timestamp() WHERE id=c.expert_id AND user_id=c.user_id;
 INSERT INTO public.early_bird_admissions(intent_id,user_id,expert_id,draft_id,review_id,revision,public_digest)
 VALUES(c.intent_id,c.user_id,c.expert_id,c.draft_id,c.review_id,c.revision,c.public_digest) ON CONFLICT(intent_id,review_id) DO NOTHING;
 INSERT INTO public.experts_published(expert_id,user_id,application_audit_id,draft_id,review_id,revision,public_payload,public_digest,paid_order_id,wave_intent_id,next_billing_date,active)
 SELECT c.expert_id,c.user_id,d.application_id,c.draft_id,c.review_id,c.revision,c.public_payload,c.public_digest,NULL,c.intent_id,c.ends_at,true FROM public.expert_card_drafts d WHERE d.id=c.draft_id;
END $$;
REVOKE ALL ON FUNCTION early_bird_activate_projection(uuid,uuid) FROM PUBLIC;

-- Refresh is serialized with refunds and consent revocation by the subject
-- lock. Every new review gets its own immutable admission row.
CREATE FUNCTION early_bird_refresh_projection(target_user uuid,target_review uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c record; previous public.experts_published%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO previous FROM public.experts_published WHERE user_id=target_user AND wave_intent_id IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT candidate.* INTO c FROM public.early_bird_admission_candidates candidate JOIN public.expert_card_drafts d ON d.id=candidate.draft_id AND d.user_id=candidate.user_id AND d.status='approved' AND d.approved_review_id=candidate.review_id AND d.revision=candidate.revision WHERE candidate.intent_id=previous.wave_intent_id AND candidate.user_id=target_user AND candidate.review_id=target_review;
 IF NOT FOUND THEN
  UPDATE public.experts_published SET active=false,updated_at=clock_timestamp() WHERE expert_id=previous.expert_id;
  RETURN;
 END IF;
 INSERT INTO public.early_bird_admissions(intent_id,user_id,expert_id,draft_id,review_id,revision,public_digest) VALUES(c.intent_id,c.user_id,c.expert_id,c.draft_id,c.review_id,c.revision,c.public_digest) ON CONFLICT(intent_id,review_id) DO NOTHING;
 UPDATE public.experts_published SET review_id=c.review_id,revision=c.revision,public_payload=c.public_payload,public_digest=c.public_digest,next_billing_date=c.ends_at,active=true,updated_at=clock_timestamp() WHERE expert_id=c.expert_id AND wave_intent_id=c.intent_id;
END $$;
REVOKE ALL ON FUNCTION early_bird_refresh_projection(uuid,uuid) FROM PUBLIC;

-- A verified partial refund makes the entire user wave projection unavailable
-- until a reviewed reconciliation establishes the correct remaining coverage.
CREATE FUNCTION early_bird_deactivate_partial_refund_projection(target_user uuid,target_intent uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.early_bird_refund_reconciliation q WHERE q.user_id=target_user AND q.intent_id=target_intent) THEN RAISE EXCEPTION 'early_bird_partial_refund_required'; END IF;
 UPDATE public.experts_published SET active=false,updated_at=clock_timestamp() WHERE user_id=target_user AND wave_intent_id IS NOT NULL AND active;
END $$;
REVOKE ALL ON FUNCTION early_bird_deactivate_partial_refund_projection(uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
-- Candidate segment 18: docs/superpowers/implementation-artifacts/drafts/deferred_wave_publication.sql
-- DRAFT. Install only after wave admission, deferred payments, final-call and
-- verified deferred refund migrations. The deployment remains fail closed.
-- The account UUID is the deferred source key; collisions with composite keys
-- are rejected at lookup. Both captured facts must match verifier bindings.
CREATE VIEW early_bird_deferred_effective_coverages AS
 SELECT a.id AS intent_id,a.user_id,a.launch_at AS starts_at,
        a.launch_at + interval '2592000 seconds' AS ends_at
 FROM early_bird_deferred_accounts a
 JOIN early_bird_deferred_invoices ob ON ob.account_id=a.id AND ob.user_id=a.user_id AND ob.stage='onboarding' AND ob.amount_minor=a.onboarding_minor AND ob.captured_at IS NOT NULL
 JOIN early_bird_deferred_verified_bindings op ON op.invoice_id=ob.id AND op.user_id=ob.user_id AND op.provider_id=ob.provider_id AND op.amount_minor=ob.amount_minor AND op.evidence_digest=ob.evidence_digest
 JOIN early_bird_deferred_invoices sub ON sub.account_id=a.id AND sub.user_id=a.user_id AND sub.stage='subscription' AND sub.amount_minor=a.subscription_minor AND sub.captured_at IS NOT NULL AND sub.captured_at<a.launch_at
 JOIN early_bird_deferred_verified_bindings sp ON sp.invoice_id=sub.id AND sp.user_id=sub.user_id AND sp.provider_id=sub.provider_id AND sp.amount_minor=sub.amount_minor AND sp.evidence_digest=sub.evidence_digest
 WHERE NOT EXISTS(SELECT 1 FROM early_bird_wave_one_exclusions x WHERE x.user_id=a.user_id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_composite_intents collision WHERE collision.id=a.id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_refund_facts r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_refund_reconciliation r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_verified_refund_bindings r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_refund_resolutions resolved WHERE resolved.provider_refund_id=r.provider_refund_id AND resolved.invoice_id=r.invoice_id AND resolved.user_id=r.user_id AND resolved.disposition='canceled'));
REVOKE ALL ON early_bird_deferred_effective_coverages FROM PUBLIC;

-- Onboarding payment alone permits the resident to prepare their card. It is
-- never publication coverage; only the two-payment view above can publish.
CREATE VIEW early_bird_deferred_onboarded AS
 SELECT a.id AS intent_id,a.user_id
 FROM early_bird_deferred_accounts a
 JOIN early_bird_deferred_invoices ob ON ob.account_id=a.id AND ob.user_id=a.user_id AND ob.stage='onboarding' AND ob.amount_minor=a.onboarding_minor AND ob.captured_at IS NOT NULL
 JOIN early_bird_deferred_verified_bindings proof ON proof.invoice_id=ob.id AND proof.user_id=ob.user_id AND proof.provider_id=ob.provider_id AND proof.amount_minor=ob.amount_minor AND proof.evidence_digest=ob.evidence_digest
 WHERE NOT EXISTS(SELECT 1 FROM early_bird_wave_one_exclusions x WHERE x.user_id=a.user_id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_refund_facts r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_refund_reconciliation r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_verified_refund_bindings r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_refund_resolutions resolved WHERE resolved.provider_refund_id=r.provider_refund_id AND resolved.invoice_id=r.invoice_id AND resolved.user_id=r.user_id AND resolved.disposition='canceled'));
REVOKE ALL ON early_bird_deferred_onboarded FROM PUBLIC;

-- Existing guard trigger verifies every admission against the live candidate
-- view. Its UUID now addresses either a composite intent or deferred account.
ALTER TABLE early_bird_admissions DROP CONSTRAINT early_bird_admissions_intent_id_fkey;
ALTER TABLE experts_published DROP CONSTRAINT experts_published_wave_intent_id_fkey;

CREATE OR REPLACE VIEW early_bird_admission_candidates AS
SELECT s.intent_id,s.user_id,e.id AS expert_id,d.id AS draft_id,r.id AS review_id,
       r.revision,r.public_digest,r.public_payload,c.starts_at,c.ends_at
FROM early_bird_payment_successes s
JOIN early_bird_effective_coverages c ON c.intent_id=s.intent_id
JOIN early_bird_composite_intents i ON i.id=s.intent_id AND i.user_id=s.user_id
JOIN early_bird_choices choice ON choice.id=i.choice_id AND choice.user_id=i.user_id
JOIN early_bird_choices approved_choice ON approved_choice.base_id=choice.base_id AND approved_choice.user_id=choice.user_id
JOIN early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
JOIN expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=i.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL
JOIN expert_card_drafts d ON d.application_id=a.id AND d.user_id=i.user_id
JOIN resident_card_versions v ON v.draft_id=d.id
JOIN expert_card_reviews r ON r.id=v.review_id AND r.user_id=i.user_id AND r.action='approve' AND r.revision=v.revision AND r.public_payload=v.public_payload
JOIN users u ON u.id=i.user_id AND u.active
JOIN experts e ON e.user_id=u.id
WHERE c.starts_at<=clock_timestamp() AND c.ends_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM residents_applications f JOIN expert_verification_decisions vd ON vd.application_id=b.application_id AND vd.user_id=b.user_id AND vd.decision='approved' JOIN resident_review_events re ON re.attempt_id=f.id AND re.manager_id=vd.manager_id AND re.session_hash=vd.manager_session_hash AND re.action=f.status AND re.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
 AND v.revision=(SELECT max(latest.revision) FROM resident_card_versions latest WHERE latest.draft_id=d.id)
 AND expert_card_current_messaging_authority(i.user_id,d.messaging_policy_version)
 AND EXISTS(SELECT 1 FROM channel_identities ci WHERE ci.user_id=i.user_id AND ci.provider='telegram' AND ci.bot_key=d.work_bot_key AND ci.external_id=d.work_chat_id AND ci.external_chat_id=d.work_chat_id AND ci.status='active')
 AND resident_safety_assess(v.safety_fields,v.revision)=v.safety_proof
 AND NOT (v.safety_proof->>'blocked')::boolean
 AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds h WHERE h.expert_id=e.id AND h.status='open')
 AND NOT EXISTS(SELECT 1 FROM expert_residency_lifecycle l WHERE l.expert_id=e.id AND l.status='paused')
 AND NOT EXISTS(SELECT 1 FROM early_bird_coverage_reconciliation pending WHERE pending.user_id=i.user_id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_refund_reconciliation pending WHERE pending.user_id=i.user_id)
UNION ALL
SELECT c.intent_id,c.user_id,e.id AS expert_id,d.id AS draft_id,r.id AS review_id,
       r.revision,r.public_digest,r.public_payload,c.starts_at,c.ends_at
FROM early_bird_deferred_effective_coverages c
JOIN early_bird_deferred_accounts i ON i.id=c.intent_id AND i.user_id=c.user_id
JOIN early_bird_choices choice ON choice.id=i.choice_id AND choice.user_id=i.user_id
JOIN early_bird_choices approved_choice ON approved_choice.base_id=choice.base_id AND approved_choice.user_id=choice.user_id
JOIN early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
JOIN expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=i.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL
JOIN expert_card_drafts d ON d.application_id=a.id AND d.user_id=i.user_id
JOIN resident_card_versions v ON v.draft_id=d.id
JOIN expert_card_reviews r ON r.id=v.review_id AND r.user_id=i.user_id AND r.action='approve' AND r.revision=v.revision AND r.public_payload=v.public_payload
JOIN users u ON u.id=i.user_id AND u.active
JOIN experts e ON e.user_id=u.id
WHERE c.starts_at<=clock_timestamp() AND c.ends_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM residents_applications f JOIN expert_verification_decisions vd ON vd.application_id=b.application_id AND vd.user_id=b.user_id AND vd.decision='approved' JOIN resident_review_events re ON re.attempt_id=f.id AND re.manager_id=vd.manager_id AND re.session_hash=vd.manager_session_hash AND re.action=f.status AND re.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
 AND v.revision=(SELECT max(latest.revision) FROM resident_card_versions latest WHERE latest.draft_id=d.id)
 AND expert_card_current_messaging_authority(i.user_id,d.messaging_policy_version)
 AND EXISTS(SELECT 1 FROM channel_identities ci WHERE ci.user_id=i.user_id AND ci.provider='telegram' AND ci.bot_key=d.work_bot_key AND ci.external_id=d.work_chat_id AND ci.external_chat_id=d.work_chat_id AND ci.status='active')
 AND resident_safety_assess(v.safety_fields,v.revision)=v.safety_proof
 AND NOT (v.safety_proof->>'blocked')::boolean
 AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds h WHERE h.expert_id=e.id AND h.status='open')
 AND NOT EXISTS(SELECT 1 FROM expert_residency_lifecycle l WHERE l.expert_id=e.id AND l.status='paused')
 AND NOT EXISTS(SELECT 1 FROM early_bird_coverage_reconciliation pending WHERE pending.user_id=i.user_id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_refund_reconciliation pending WHERE pending.user_id=i.user_id);

CREATE OR REPLACE FUNCTION early_bird_paid_workspace(target_user uuid) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(( SELECT b.application_id
 FROM public.early_bird_payment_successes s
 JOIN public.early_bird_composite_intents i ON i.id=s.intent_id AND i.user_id=s.user_id
 JOIN public.early_bird_choices current_choice ON current_choice.id=i.choice_id AND current_choice.user_id=i.user_id
 JOIN public.early_bird_choices approved_choice ON approved_choice.base_id=current_choice.base_id AND approved_choice.user_id=current_choice.user_id
 JOIN public.early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
 JOIN public.expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=b.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL
 JOIN public.users u ON u.id=i.user_id AND u.active
 WHERE i.user_id=target_user AND s.disposition='eligible'
  AND EXISTS(SELECT 1 FROM public.residents_applications f JOIN public.expert_verification_decisions d ON d.application_id=b.application_id AND d.user_id=b.user_id AND d.decision='approved' JOIN public.resident_review_events re ON re.attempt_id=f.id AND re.manager_id=d.manager_id AND re.session_hash=d.manager_session_hash AND re.action=f.status AND re.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(public.digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_payment_full_refunds r WHERE r.intent_id=s.intent_id)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_coverage_reconciliation q WHERE q.user_id=i.user_id)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_refund_reconciliation q WHERE q.user_id=i.user_id)
 ORDER BY s.recorded_at,s.intent_id LIMIT 1), (SELECT b.application_id
 FROM public.early_bird_deferred_onboarded s
 JOIN public.early_bird_deferred_accounts i ON i.id=s.intent_id AND i.user_id=s.user_id
 JOIN public.early_bird_choices current_choice ON current_choice.id=i.choice_id AND current_choice.user_id=i.user_id
 JOIN public.early_bird_choices approved_choice ON approved_choice.base_id=current_choice.base_id AND approved_choice.user_id=current_choice.user_id
 JOIN public.early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
 JOIN public.expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=b.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL
 JOIN public.users u ON u.id=i.user_id AND u.active
 WHERE i.user_id=target_user
  AND EXISTS(SELECT 1 FROM public.residents_applications f JOIN public.expert_verification_decisions d ON d.application_id=b.application_id AND d.user_id=b.user_id AND d.decision='approved' JOIN public.resident_review_events re ON re.attempt_id=f.id AND re.manager_id=d.manager_id AND re.session_hash=d.manager_session_hash AND re.action=f.status AND re.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(public.digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_coverage_reconciliation q WHERE q.user_id=i.user_id)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_refund_reconciliation q WHERE q.user_id=i.user_id)
 ORDER BY s.intent_id LIMIT 1))
$$;
--> statement-breakpoint
-- Candidate segment 19: docs/superpowers/implementation-artifacts/drafts/0083_early_bird_message_replacements.sql
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
--> statement-breakpoint
