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
