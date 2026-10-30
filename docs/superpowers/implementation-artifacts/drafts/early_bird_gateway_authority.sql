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
-- Provision a distinct NOLOGIN capability and LOGIN gateway principal separately;
-- grant only these functions after verifying no direct table or owner privileges.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='ii_tonya_wave_gateway') THEN
  CREATE ROLE ii_tonya_wave_gateway NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 ELSIF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='ii_tonya_wave_gateway' AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
  RAISE EXCEPTION 'unsafe gateway capability role';
 END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.early_bird_gateway_revoke(uuid), public.early_bird_gateway_claim(uuid,uuid,uuid,uuid,text) TO ii_tonya_wave_gateway;
