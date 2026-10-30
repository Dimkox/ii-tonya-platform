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
