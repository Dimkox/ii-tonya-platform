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
