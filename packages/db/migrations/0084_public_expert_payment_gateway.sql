-- Public delivery/evidence authority. Canonical TypeScript remains the financial poster.
-- No roles, merchant secrets, financial ledger or provider facts are created here.
CREATE TABLE public_expert_payment_requests (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 product text NOT NULL CHECK(product IN('onboarding','main','refund')),
 kind text NOT NULL CHECK(kind IN('onboarding_create','onboarding_capture','onboarding_cancel','main_create','main_refund')),
 legacy_source_id uuid NOT NULL, legacy_operation_id uuid NOT NULL,
 invoice_id uuid REFERENCES expert_onboarding_invoices(id), order_id uuid REFERENCES expert_residency_orders(id),
 parent_payment_id text CHECK(parent_payment_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 mode text NOT NULL CHECK(mode IN('test','live')), amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 999999999999),
 currency text NOT NULL DEFAULT 'RUB' CHECK(currency='RUB'), idempotency_key uuid NOT NULL UNIQUE,
 contact_id uuid REFERENCES payer_receipt_contacts(id), request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[a-f0-9]{64}$'),
 snapshot_version integer NOT NULL DEFAULT 1 CHECK(snapshot_version=1), snapshot jsonb NOT NULL,
 encrypted_body text, key_reference text, body_expires_at timestamptz,
 payment_deadline timestamptz NOT NULL, provider_deadline timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','admitted','uncertain','bound','resolved','abandoned')),
 admitted_at timestamptz, dispatched_at timestamptz, provider_object_id text CHECK(provider_object_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 created_at timestamptz NOT NULL DEFAULT early_bird_current_time(),
 -- Mutable transaction context, separate from immutable evidence. Only apply_guard sets it.
 apply_attempt_id uuid, apply_observation_id uuid, apply_action text, apply_xid xid8, apply_login name,
 UNIQUE(legacy_operation_id,kind),
 CHECK((product='onboarding' AND kind LIKE 'onboarding_%' AND invoice_id=legacy_source_id AND order_id IS NULL AND amount_minor=300000)
   OR(product='main' AND kind='main_create' AND order_id=legacy_source_id AND invoice_id IS NULL)
   OR(product='refund' AND kind='main_refund' AND order_id=legacy_source_id AND invoice_id IS NULL)),
 CHECK((kind IN('onboarding_capture','onboarding_cancel') AND contact_id IS NULL AND parent_payment_id IS NOT NULL AND encrypted_body IS NULL AND key_reference IS NULL AND body_expires_at IS NULL)
   OR(kind IN('onboarding_create','main_create','main_refund') AND contact_id IS NOT NULL AND body_expires_at IS NOT NULL AND ((encrypted_body IS NULL AND key_reference IS NULL) OR(length(encrypted_body) BETWEEN 1 AND 262144 AND key_reference ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$')))),
 CHECK((kind IN('onboarding_create','main_create') AND parent_payment_id IS NULL) OR(kind IN('onboarding_capture','onboarding_cancel','main_refund') AND parent_payment_id IS NOT NULL)),
 CHECK(isfinite(created_at) AND isfinite(payment_deadline) AND isfinite(provider_deadline) AND payment_deadline<=provider_deadline),
 CHECK(body_expires_at IS NULL OR isfinite(body_expires_at))
);
CREATE UNIQUE INDEX public_expert_parent_mutation_inflight ON public_expert_payment_requests(parent_payment_id)
 WHERE kind IN('onboarding_capture','onboarding_cancel') AND state IN('admitted','uncertain','bound');
CREATE TABLE public_expert_payment_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public_expert_payment_requests(id),
 provider_object_id text NOT NULL, parent_payment_id text, status text NOT NULL CHECK(status IN('pending','waiting_for_capture','succeeded','canceled')),
 paid boolean, amount_minor bigint NOT NULL, currency text NOT NULL CHECK(currency='RUB'), mode text NOT NULL CHECK(mode IN('test','live')),
 provider_created_at timestamptz NOT NULL, provider_captured_at timestamptz, payment_method_type text,
 identity jsonb NOT NULL, evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL, fact jsonb NOT NULL,
 UNIQUE(request_id,evidence_digest), CHECK(isfinite(provider_created_at) AND isfinite(observed_at) AND provider_created_at<=observed_at),
 CHECK(provider_captured_at IS NULL OR(isfinite(provider_captured_at) AND provider_created_at<=provider_captured_at AND provider_captured_at<=observed_at))
);
ALTER TABLE public_expert_payment_requests ADD CONSTRAINT public_expert_apply_observation_fk FOREIGN KEY(apply_observation_id) REFERENCES public_expert_payment_observations(id);
CREATE TABLE public_expert_payment_resolutions (
 request_id uuid NOT NULL REFERENCES public_expert_payment_requests(id), kind text NOT NULL CHECK(kind IN('apply_attempt','applied','manual_reconciliation')),
 observation_id uuid NOT NULL REFERENCES public_expert_payment_observations(id), apply_attempt_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('onboarding_settle','main_settle','main_refund','release_terminal_unpaid')),
 legacy_fact_id text, provider_object_id text NOT NULL, captured_at timestamptz, payment_deadline timestamptz NOT NULL,
 disposition text NOT NULL CHECK(disposition IN('eligible','terminal_unpaid','paid_manual_reconciliation','late_paid_manual_reconciliation')),
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT early_bird_current_time(), PRIMARY KEY(request_id,kind)
);
CREATE TRIGGER public_expert_observations_immutable BEFORE UPDATE OR DELETE ON public_expert_payment_observations FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER public_expert_resolutions_immutable BEFORE UPDATE OR DELETE ON public_expert_payment_resolutions FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
REVOKE ALL ON public_expert_payment_requests,public_expert_payment_observations,public_expert_payment_resolutions FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION early_bird_private.public_time(value timestamptz) RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
CREATE FUNCTION early_bird_private.public_snapshot(r public.public_expert_payment_requests) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT r.snapshot || jsonb_build_object('state',r.state,'providerObjectId',r.provider_object_id,'envelope',CASE WHEN r.encrypted_body IS NULL THEN NULL ELSE jsonb_build_object('ciphertext',r.encrypted_body,'keyReference',r.key_reference) END)
$$;
CREATE FUNCTION early_bird_private.public_onboarding_current(target_invoice uuid,target_user uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.expert_onboarding_invoices i
 JOIN public.expert_sales_fee_attempts a ON a.invoice_id=i.id AND a.user_id=i.user_id
 JOIN public.expert_onboarding_applications app ON app.id=i.application_id AND app.user_id=i.user_id
 JOIN public.expert_sales_selections s ON s.id=a.selection_id AND s.user_id=i.user_id
 JOIN public.expert_sales_bases b ON b.id=s.base_id AND b.user_id=i.user_id
 JOIN public.users u ON u.id=i.user_id
 WHERE i.id=target_invoice AND i.user_id=target_user AND i.status='pending' AND a.expires_at>public.early_bird_current_time()
 AND u.active AND app.verification_status='approved' AND app.archived_at IS NULL AND app.archive_until_date IS NULL
 AND public.expert_sales_form_valid(i.application_id,i.user_id) AND public.expert_card_current_messaging_authority(i.user_id,b.consent_version)
 AND NOT EXISTS(SELECT 1 FROM public.expert_sales_paid_locks WHERE user_id=i.user_id)
 AND a.selection_id=(SELECT id FROM public.expert_sales_selections WHERE user_id=i.user_id ORDER BY selected_at DESC,id DESC LIMIT 1))
$$;
CREATE FUNCTION early_bird_private.public_source_valid(r public.public_expert_payment_requests,for_send boolean) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_frame boolean; now_at timestamptz; parent_fact public.public_expert_payment_observations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
 IF r.product='onboarding' THEN
  PERFORM 1 FROM public.expert_onboarding_invoices i JOIN public.expert_onboarding_payment_operations op ON op.invoice_id=i.id
   WHERE i.id=r.invoice_id AND i.user_id=r.user_id AND op.id=r.legacy_operation_id AND op.user_id=r.user_id
   AND i.amount_minor=r.amount_minor AND op.amount_minor=r.amount_minor AND i.provider_mode=r.mode AND op.provider_mode=r.mode
   AND i.currency=r.currency AND op.currency=r.currency FOR UPDATE OF i,op;
  IF NOT FOUND THEN RETURN false; END IF;
  IF r.parent_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.expert_onboarding_payment_operations WHERE id=r.legacy_operation_id AND provider_object_id=r.parent_payment_id) THEN RETURN false; END IF;
 ELSE
  PERFORM 1 FROM public.expert_residency_orders o JOIN public.experts e ON e.id=o.expert_id
  JOIN public.expert_residency_provider_operations op ON op.order_id=o.id
  JOIN public.expert_residency_payment_attempts pa ON pa.id=op.payment_attempt_id AND pa.order_id=o.id
  JOIN public.expert_card_main_orders m ON m.order_id=o.id AND m.user_id=e.user_id
  WHERE o.id=r.order_id AND e.user_id=r.user_id AND op.id=r.legacy_operation_id AND op.environment_mode=r.mode AND m.provider_mode=r.mode
   AND op.amount_minor=r.amount_minor AND op.currency=r.currency AND op.idempotency_key=r.idempotency_key
   AND op.parent_payment_id IS NOT DISTINCT FROM r.parent_payment_id
   AND ((r.product='main' AND op.operation_kind='create_payment' AND o.cash_minor=r.amount_minor AND pa.expected_amount_minor=r.amount_minor)
    OR(r.product='refund' AND op.operation_kind='create_refund' AND pa.provider_request_id=r.parent_payment_id AND o.provider_payment_id=r.parent_payment_id)) FOR UPDATE OF o,op,pa;
  IF NOT FOUND THEN RETURN false; END IF;
 END IF;
 IF NOT for_send THEN RETURN true; END IF;
 -- Configuration is still required after lock waits; cancellation is cleanup, not new acquisition.
 IF r.kind IN('onboarding_create','main_create') THEN
  PERFORM 1 FROM public.early_bird_launch_configs WHERE active FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.early_bird_launch_configs WHERE active AND client_start_at<=public.early_bird_current_time()) THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=r.user_id AND active) THEN RETURN false; END IF;
 END IF;
 IF r.product='onboarding' THEN
  current_frame:=early_bird_private.public_onboarding_current(r.invoice_id,r.user_id);
  IF r.kind='onboarding_cancel' THEN IF current_frame THEN RETURN false; END IF;
  ELSIF NOT current_frame THEN RETURN false; END IF;
  IF r.kind IN('onboarding_capture','onboarding_cancel') THEN
   SELECT obs.* INTO parent_fact FROM public.public_expert_payment_observations obs JOIN public.public_expert_payment_requests req ON req.id=obs.request_id
    WHERE req.invoice_id=r.invoice_id AND req.legacy_operation_id=r.legacy_operation_id AND obs.provider_object_id=r.parent_payment_id ORDER BY obs.observed_at DESC,obs.id DESC LIMIT 1;
   IF NOT FOUND OR parent_fact.status<>'waiting_for_capture' OR parent_fact.payment_method_type IS DISTINCT FROM 'bank_card'
    OR parent_fact.observed_at<public.early_bird_current_time()-interval '30 seconds' THEN RETURN false; END IF;
   IF EXISTS(SELECT 1 FROM public.public_expert_payment_requests other WHERE other.parent_payment_id=r.parent_payment_id AND other.id<>r.id AND other.kind IN('onboarding_capture','onboarding_cancel') AND other.state IN('admitted','uncertain','bound')) THEN RETURN false; END IF;
  ELSIF EXISTS(SELECT 1 FROM public.expert_onboarding_payment_operations WHERE id=r.legacy_operation_id AND provider_object_id IS NOT NULL) THEN RETURN false;
  END IF;
 ELSE
  IF r.product='main' THEN
   IF NOT EXISTS(SELECT 1 FROM public.expert_residency_orders o JOIN public.expert_card_main_orders m ON m.order_id=o.id
    JOIN public.expert_card_main_acceptances a ON a.id=m.acceptance_id AND a.user_id=m.user_id AND a.quote_id=m.quote_id
    JOIN public.expert_card_reviews review ON review.id=m.review_id AND review.user_id=m.user_id AND review.action='approve' AND review.revision=m.revision AND review.public_digest=m.public_digest
    WHERE o.id=r.order_id AND o.status='payment_pending' AND o.provider_payment_id IS NULL
    AND o.payment_deadline>public.early_bird_current_time() AND o.provider_deadline>public.early_bird_current_time()
    AND public.expert_campaign_current_profile_valid(r.user_id,m.quote_id)) THEN RETURN false; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.expert_residency_payment_attempts pa JOIN public.expert_residency_provider_operations op ON op.payment_attempt_id=pa.id
    WHERE op.id=r.legacy_operation_id AND pa.status='settled' AND pa.provider_request_id=r.parent_payment_id) THEN RETURN false; END IF;
   -- Existing operations already reserve every refund command, including unknowns.
   IF (SELECT coalesce(sum(op.amount_minor),0) FROM public.expert_residency_provider_operations op WHERE op.parent_payment_id=r.parent_payment_id AND op.operation_kind='create_refund' AND op.status NOT IN('canceled','failed'))
      >(SELECT cash_minor FROM public.expert_residency_orders WHERE id=r.order_id) THEN RETURN false; END IF;
  END IF;
 END IF;
 IF r.contact_id IS NOT NULL THEN
  PERFORM 1 FROM public.payer_receipt_contacts c WHERE c.id=r.contact_id AND c.user_id=r.user_id FOR SHARE;
  now_at:=public.early_bird_current_time();
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.payer_receipt_contacts c WHERE c.id=r.contact_id AND c.user_id=r.user_id AND c.redacted_at IS NULL AND c.ciphertext IS NOT NULL AND c.expires_at>now_at)
   OR r.encrypted_body IS NULL OR r.body_expires_at<=now_at OR r.body_expires_at>r.created_at+interval '23 hours'
   OR EXISTS(SELECT 1 FROM public.early_bird_gateway_contact_state WHERE contact_id=r.contact_id AND revoked_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public.receipt_revocation_outbox WHERE contact_id=r.contact_id) THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION early_bird_private.public_prepare(product_name text,target_user uuid,target_source uuid,target_contact uuid,descriptor jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.public_expert_payment_requests%ROWTYPE; old public.public_expert_payment_requests%ROWTYPE;
 invoice public.expert_onboarding_invoices%ROWTYPE; onboarding_op public.expert_onboarding_payment_operations%ROWTYPE;
 op public.expert_residency_provider_operations%ROWTYPE; ord public.expert_residency_orders%ROWTYPE; main public.expert_card_main_orders%ROWTYPE;
 attempt uuid; source_quote uuid;
BEGIN
 IF target_user IS NULL OR target_source IS NULL OR descriptor IS NULL OR NOT public.expert_jsonb_has_exact_keys(descriptor,ARRAY['requestId','idempotencyKey','kind','requestDigest','bodyVersion','ciphertext','keyReference','bodyExpiresAt']) THEN RETURN NULL; END IF;
 IF jsonb_typeof(descriptor->'requestDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(descriptor->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(descriptor->'ciphertext') NOT IN('string','null') OR jsonb_typeof(descriptor->'keyReference') NOT IN('string','null') OR jsonb_typeof(descriptor->'bodyExpiresAt') NOT IN('string','null') OR descriptor->'bodyVersion' IS DISTINCT FROM '1'::jsonb OR descriptor->>'requestDigest' !~ '^sha256:[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 r.id:=(descriptor->>'requestId')::uuid; r.idempotency_key:=(descriptor->>'idempotencyKey')::uuid;
 r.kind:=descriptor->>'kind'; r.product:=product_name; r.user_id:=target_user; r.contact_id:=target_contact; r.request_digest:=descriptor->>'requestDigest';
 r.snapshot_version:=1; r.currency:='RUB'; r.state:='prepared'; r.created_at:=public.early_bird_current_time();
 r.encrypted_body:=descriptor->>'ciphertext'; r.key_reference:=descriptor->>'keyReference'; r.body_expires_at:=(descriptor->>'bodyExpiresAt')::timestamptz;
 IF r.id IS NULL OR r.idempotency_key IS NULL OR r.kind IS NULL OR NOT((product_name='onboarding' AND r.kind IN('onboarding_create','onboarding_capture','onboarding_cancel')) OR(product_name='main' AND r.kind='main_create') OR(product_name='refund' AND r.kind='main_refund')) THEN RETURN NULL; END IF;
 IF (r.kind IN('onboarding_capture','onboarding_cancel')) IS DISTINCT FROM (target_contact IS NULL) THEN RETURN NULL; END IF;
 IF target_contact IS NULL AND (r.encrypted_body IS NOT NULL OR r.key_reference IS NOT NULL OR r.body_expires_at IS NOT NULL) THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO old FROM public.public_expert_payment_requests WHERE id=r.id OR idempotency_key=r.idempotency_key LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF old.id=r.id AND old.idempotency_key=r.idempotency_key AND old.user_id=target_user AND old.product=product_name AND old.kind=r.kind
   AND (CASE WHEN product_name='refund' THEN old.legacy_operation_id ELSE old.legacy_source_id END)=target_source
   AND old.contact_id IS NOT DISTINCT FROM target_contact AND old.request_digest=r.request_digest
   AND old.encrypted_body IS NOT DISTINCT FROM r.encrypted_body AND old.key_reference IS NOT DISTINCT FROM r.key_reference AND old.body_expires_at IS NOT DISTINCT FROM r.body_expires_at
   THEN RETURN early_bird_private.public_snapshot(old); END IF;
  RETURN NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM public.early_bird_composite_intents WHERE (product_name='onboarding' AND user_id=target_user) OR id=r.id OR invoice_id=r.id OR idempotency_key=r.idempotency_key)
 OR EXISTS(SELECT 1 FROM public.early_bird_deferred_invoices WHERE (product_name='onboarding' AND user_id=target_user) OR id=r.id OR idempotency_key=r.idempotency_key)
 OR EXISTS(SELECT 1 FROM public.expert_sales_provider_requests WHERE id=r.id OR idempotency_key=r.idempotency_key)
 OR EXISTS(SELECT 1 FROM public.expert_onboarding_payment_operations WHERE id=r.id)
 OR EXISTS(SELECT 1 FROM public.expert_residency_provider_operations WHERE id=r.id OR(idempotency_key=r.idempotency_key AND NOT(product_name='refund' AND id=target_source)))
 THEN RETURN NULL; END IF;
 IF product_name='onboarding' THEN
  SELECT * INTO invoice FROM public.expert_onboarding_invoices WHERE id=target_source AND user_id=target_user FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO onboarding_op FROM public.expert_onboarding_payment_operations WHERE invoice_id=invoice.id AND user_id=target_user FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  r.invoice_id:=invoice.id; r.legacy_source_id:=invoice.id; r.legacy_operation_id:=onboarding_op.id;
  r.mode:=invoice.provider_mode; r.amount_minor:=invoice.amount_minor;
  SELECT a.expires_at,b.quote_id INTO r.payment_deadline,source_quote FROM public.expert_sales_fee_attempts a JOIN public.expert_sales_form_bridges b ON b.application_id=invoice.application_id AND b.user_id=invoice.user_id WHERE a.invoice_id=invoice.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  r.provider_deadline:=r.payment_deadline;
  IF r.kind<>'onboarding_create' THEN r.parent_payment_id:=onboarding_op.provider_object_id; r.provider_object_id:=r.parent_payment_id; END IF;
  IF EXISTS(SELECT 1 FROM public.expert_sales_provider_requests WHERE invoice_id=invoice.id AND kind=replace(r.kind,'onboarding_','')) THEN RETURN NULL; END IF;
 ELSE
  IF product_name='refund' THEN
   SELECT * INTO op FROM public.expert_residency_provider_operations WHERE id=target_source AND operation_kind='create_refund' AND status='claimed' AND provider_object_id IS NULL FOR UPDATE;
   IF NOT FOUND OR op.idempotency_key<>r.idempotency_key OR op.request_digest<>r.request_digest THEN RETURN NULL; END IF;
   SELECT * INTO ord FROM public.expert_residency_orders WHERE id=op.order_id FOR UPDATE;
  ELSE
   SELECT * INTO ord FROM public.expert_residency_orders WHERE id=target_source FOR UPDATE;
  END IF;
  IF ord.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO main FROM public.expert_card_main_orders WHERE order_id=ord.id AND user_id=target_user FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  r.order_id:=ord.id; r.legacy_source_id:=ord.id; r.mode:=main.provider_mode; r.payment_deadline:=ord.payment_deadline; r.provider_deadline:=ord.provider_deadline; source_quote:=main.quote_id;
  IF product_name='main' THEN
   IF EXISTS(SELECT 1 FROM public.expert_residency_provider_operations WHERE order_id=ord.id AND operation_kind='create_payment') THEN RETURN NULL; END IF;
   r.amount_minor:=ord.cash_minor; r.legacy_operation_id:=gen_random_uuid(); attempt:=gen_random_uuid();
   -- These are delivery records only, atomically linked to the public request below.
   INSERT INTO public.expert_residency_payment_attempts(id,order_id,provider,provider_request_id,expected_amount_minor,currency,status,idempotency_key)
    VALUES(attempt,ord.id,'yookassa','command:'||r.id::text,r.amount_minor,'RUB','created','public:'||r.id::text);
   INSERT INTO public.expert_residency_provider_operations(id,command_id,order_id,payment_attempt_id,operation_kind,environment_mode,amount_minor,currency,request_digest,claim_digest,idempotency_key,status)
    VALUES(r.legacy_operation_id,r.id,ord.id,attempt,'create_payment',r.mode,r.amount_minor,'RUB',r.request_digest,r.request_digest,r.idempotency_key,'claimed');
  ELSE r.legacy_operation_id:=op.id; r.amount_minor:=op.amount_minor; r.parent_payment_id:=op.parent_payment_id; END IF;
 END IF;
 IF r.product='main' AND NOT EXISTS(SELECT 1 FROM public.payer_receipt_order_bindings WHERE order_id=r.order_id AND contact_id=r.contact_id AND user_id=r.user_id AND quote_id=source_quote) THEN RAISE EXCEPTION 'public_prepare_unavailable'; END IF;
 IF r.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.payer_receipt_contacts WHERE id=r.contact_id AND user_id=target_user AND quote_id=source_quote) THEN RAISE EXCEPTION 'public_prepare_unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.public_expert_payment_requests WHERE legacy_operation_id=r.legacy_operation_id AND kind=r.kind) OR NOT early_bird_private.public_source_valid(r,true) THEN RAISE EXCEPTION 'public_prepare_unavailable'; END IF;
 r.snapshot:=jsonb_build_object('version',1,'requestId',r.id,'userId',r.user_id,'product',r.product,'kind',r.kind,'legacySourceId',r.legacy_source_id,'legacyOperationId',r.legacy_operation_id,'mode',r.mode,'amountMinor',r.amount_minor::text,'currency',r.currency,'idempotencyKey',r.idempotency_key,'contactId',r.contact_id,'parentPaymentId',r.parent_payment_id,'requestDigest',r.request_digest,'bodyVersion',1,'bodyExpiresAt',early_bird_private.public_time(r.body_expires_at),'paymentDeadline',early_bird_private.public_time(r.payment_deadline),'providerDeadline',early_bird_private.public_time(r.provider_deadline),'createdAt',early_bird_private.public_time(r.created_at));
 INSERT INTO public.public_expert_payment_requests SELECT r.*;
 IF r.product='onboarding' THEN
  INSERT INTO public.expert_sales_provider_requests(id,invoice_id,kind,idempotency_key,request_body,encrypted_body,key_reference,request_digest,body_expires_at,contact_id,provider_object_id)
   VALUES(r.id,r.invoice_id,replace(r.kind,'onboarding_',''),r.idempotency_key,CASE r.kind WHEN 'onboarding_capture' THEN '{"amount":{"value":"3000.00","currency":"RUB"}}' WHEN 'onboarding_cancel' THEN '{}' ELSE NULL END,r.encrypted_body,r.key_reference,r.request_digest,r.body_expires_at,r.contact_id,r.parent_payment_id);
 END IF;
 RETURN early_bird_private.public_snapshot(r);
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR unique_violation OR check_violation THEN RETURN NULL;
 WHEN raise_exception THEN IF SQLERRM='public_prepare_unavailable' THEN RETURN NULL; ELSE RAISE; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION early_bird_private.public_request_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'public_request_immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','admitted_at','dispatched_at','provider_object_id','encrypted_body','key_reference','apply_attempt_id','apply_observation_id','apply_action','apply_xid','apply_login']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','admitted_at','dispatched_at','provider_object_id','encrypted_body','key_reference','apply_attempt_id','apply_observation_id','apply_action','apply_xid','apply_login'])
  OR (OLD.provider_object_id IS NOT NULL AND NEW.provider_object_id IS DISTINCT FROM OLD.provider_object_id)
  OR (OLD.admitted_at IS NOT NULL AND NEW.admitted_at IS DISTINCT FROM OLD.admitted_at)
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
  OR (NEW.encrypted_body IS NOT NULL AND NEW.encrypted_body IS DISTINCT FROM OLD.encrypted_body)
  OR (NEW.key_reference IS NOT NULL AND NEW.key_reference IS DISTINCT FROM OLD.key_reference)
  OR (NEW.state<>OLD.state AND NOT((OLD.state='prepared' AND NEW.state IN('admitted','abandoned')) OR(OLD.state='admitted' AND NEW.state='uncertain') OR(OLD.state='uncertain' AND NEW.state='bound') OR(OLD.state='bound' AND NEW.state='resolved')))
 THEN RAISE EXCEPTION 'public_request_immutable'; END IF;
 IF OLD.encrypted_body IS NOT NULL AND NEW.encrypted_body IS NULL AND NOT EXISTS(SELECT 1 FROM public.early_bird_gateway_contact_state WHERE contact_id=OLD.contact_id AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'public_contact_ack_required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_expert_request_guard BEFORE UPDATE OR DELETE ON public_expert_payment_requests FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_request_guard();
CREATE FUNCTION early_bird_private.public_admit(product_name text,target_user uuid,target_request uuid,target_digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.public_expert_payment_requests%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request AND user_id=target_user AND product=product_name FOR UPDATE;
 IF NOT FOUND OR r.state<>'prepared' OR r.request_digest IS DISTINCT FROM target_digest OR NOT early_bird_private.public_source_valid(r,true) THEN RETURN NULL; END IF;
 UPDATE public.public_expert_payment_requests SET state='admitted',admitted_at=public.early_bird_current_time() WHERE id=r.id RETURNING * INTO r;
 IF r.product<>'onboarding' THEN UPDATE public.expert_residency_provider_operations SET status='unknown_outcome' WHERE id=r.legacy_operation_id AND status='claimed';
  IF NOT FOUND THEN RAISE EXCEPTION 'public_delivery_already_started'; END IF;
 END IF;
 RETURN early_bird_private.public_snapshot(r);
END $$;
CREATE FUNCTION public.public_expert_gateway_claim(target_user uuid,target_request uuid,target_contact uuid,target_idempotency uuid,target_digest text,target_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.public_expert_payment_requests%ROWTYPE; revoked timestamptz;
BEGIN
 IF target_user IS NULL OR target_request IS NULL OR target_idempotency IS NULL OR target_digest IS NULL OR target_kind IS NULL THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 IF target_contact IS NOT NULL THEN
  INSERT INTO public.early_bird_gateway_contact_state(contact_id) VALUES(target_contact) ON CONFLICT DO NOTHING;
  SELECT revoked_at INTO revoked FROM public.early_bird_gateway_contact_state WHERE contact_id=target_contact FOR UPDATE;
  IF revoked IS NOT NULL OR EXISTS(SELECT 1 FROM public.receipt_revocation_outbox WHERE contact_id=target_contact) THEN RETURN NULL; END IF;
 END IF;
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request AND user_id=target_user FOR UPDATE;
 IF NOT FOUND OR r.state<>'admitted' OR r.kind<>target_kind OR r.idempotency_key<>target_idempotency OR r.request_digest<>target_digest OR r.contact_id IS DISTINCT FROM target_contact OR NOT early_bird_private.public_source_valid(r,true) THEN RETURN NULL; END IF;
 UPDATE public.public_expert_payment_requests SET state='uncertain',dispatched_at=public.early_bird_current_time() WHERE id=r.id RETURNING * INTO r;
 IF r.product='onboarding' THEN UPDATE public.expert_sales_provider_requests SET status='dispatched',dispatched_at=r.dispatched_at WHERE id=r.id AND status='prepared';
  IF NOT FOUND THEN RAISE EXCEPTION 'public_delivery_already_started'; END IF;
 END IF;
 RETURN early_bird_private.public_snapshot(r);
END $$;
--> statement-breakpoint
CREATE FUNCTION early_bird_private.public_fact_valid(r public.public_expert_payment_requests,object_id text,target_fact jsonb) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE created timestamptz; captured timestamptz; observed timestamptz; purpose text;
BEGIN
 IF target_fact IS NULL OR NOT public.expert_jsonb_has_exact_keys(target_fact,ARRAY['version','requestId','providerObjectId','parentPaymentId','status','paid','amountMinor','currency','mode','providerCreatedAt','providerCapturedAt','paymentMethodType','identity','evidenceDigest','observedAt']) THEN RETURN false; END IF;
 IF target_fact->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(target_fact->'status') IS DISTINCT FROM 'string' OR jsonb_typeof(target_fact->'amountMinor') IS DISTINCT FROM 'string' OR jsonb_typeof(target_fact->'evidenceDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(target_fact->'paymentMethodType') NOT IN('null','string') OR length(target_fact->>'paymentMethodType')>64 OR target_fact->>'requestId' IS DISTINCT FROM r.id::text OR target_fact->>'providerObjectId' IS DISTINCT FROM object_id OR object_id !~ '^[A-Za-z0-9_-]{1,64}$'
  OR target_fact->>'parentPaymentId' IS DISTINCT FROM r.parent_payment_id OR target_fact->>'amountMinor' IS DISTINCT FROM r.amount_minor::text OR target_fact->>'currency' IS DISTINCT FROM 'RUB' OR target_fact->>'mode' IS DISTINCT FROM r.mode
  OR target_fact->>'evidenceDigest' !~ '^sha256:[a-f0-9]{64}$' OR target_fact->>'status' NOT IN('pending','waiting_for_capture','succeeded','canceled')
  OR NOT public.expert_jsonb_has_exact_keys(target_fact->'identity',ARRAY['purpose','operationId','orderId','userId']) THEN RETURN false; END IF;
 purpose:=CASE r.product WHEN 'onboarding' THEN 'onboarding' WHEN 'main' THEN 'main_residency' ELSE 'public_main_refund' END;
 IF target_fact->'identity' IS DISTINCT FROM jsonb_build_object('purpose',purpose,'operationId',r.legacy_operation_id::text,'orderId',r.legacy_source_id::text,'userId',r.user_id::text) THEN RETURN false; END IF;
 created:=(target_fact->>'providerCreatedAt')::timestamptz; captured:=(target_fact->>'providerCapturedAt')::timestamptz; observed:=(target_fact->>'observedAt')::timestamptz;
 IF created IS NULL OR observed IS NULL OR NOT isfinite(created) OR NOT isfinite(observed) OR created>observed OR observed>public.early_bird_current_time()
  OR observed<public.early_bird_current_time()-interval '30 seconds' OR (r.kind NOT IN('onboarding_capture','onboarding_cancel') AND created<r.created_at-interval '1 minute') THEN RETURN false; END IF;
 IF r.product='refund' THEN
  -- Refund mode is independently verified against the bound parent by the isolated verifier.
  -- Refunds have no payment paid/captured/method facts of their own.
  IF target_fact->'paid'<>'null'::jsonb OR captured IS NOT NULL OR target_fact->'paymentMethodType'<>'null'::jsonb OR target_fact->>'status'='waiting_for_capture' THEN RETURN false; END IF;
 ELSE
  IF jsonb_typeof(target_fact->'paid')<>'boolean' OR (target_fact->>'paid')::boolean IS DISTINCT FROM (target_fact->>'status' IN('waiting_for_capture','succeeded')) THEN RETURN false; END IF;
  IF target_fact->>'status'='succeeded' THEN
   IF captured IS NULL OR NOT isfinite(captured) OR captured<created OR captured>observed THEN RETURN false; END IF;
  ELSIF captured IS NOT NULL THEN RETURN false; END IF;
  IF r.product='onboarding' AND target_fact->>'status' IN('waiting_for_capture','succeeded') AND target_fact->>'paymentMethodType' IS DISTINCT FROM 'bank_card' THEN RETURN false; END IF;
  IF r.product='main' AND target_fact->>'status'='waiting_for_capture' THEN RETURN false; END IF;
 END IF;
 IF r.parent_payment_id IS NOT NULL AND r.product='onboarding' AND object_id<>r.parent_payment_id THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.public_expert_payment_observations old WHERE old.request_id=r.id AND
  (old.provider_object_id<>object_id OR old.provider_created_at<>created OR(old.provider_captured_at IS NOT NULL AND old.provider_captured_at IS DISTINCT FROM captured)
  OR(old.status IN('succeeded','canceled') AND old.status<>target_fact->>'status'))) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN RETURN false;
END $$;
CREATE FUNCTION early_bird_private.public_payment_candidate(target_request uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_snapshot(r) FROM public.public_expert_payment_requests r WHERE id=target_request AND state IN('uncertain','bound','resolved')
$$;
CREATE FUNCTION early_bird_private.public_payment_bound(target_request uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_snapshot(r) FROM public.public_expert_payment_requests r WHERE id=target_request AND provider_object_id IS NOT NULL AND state IN('uncertain','bound','resolved')
$$;
CREATE FUNCTION early_bird_private.public_payment_bind(target_request uuid,object_id text,proof jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.public_expert_payment_requests%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request FOR UPDATE;
 IF r.state NOT IN('uncertain','bound','resolved') OR (r.provider_object_id IS NOT NULL AND r.provider_object_id<>object_id)
  OR NOT public.expert_jsonb_has_exact_keys(proof,ARRAY['version','complete','exactCandidates','observation']) OR proof->'version' IS DISTINCT FROM '1'::jsonb OR proof->'complete'<>'true'::jsonb OR proof->'exactCandidates'<>'1'::jsonb
  OR NOT early_bird_private.public_fact_valid(r,object_id,proof->'observation') OR NOT early_bird_private.public_source_valid(r,false) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.public_expert_payment_requests other WHERE other.provider_object_id=object_id AND other.id<>r.id AND NOT(other.product='onboarding' AND r.product='onboarding' AND other.legacy_operation_id=r.legacy_operation_id))
 OR EXISTS(SELECT 1 FROM public.expert_residency_provider_operations op WHERE op.provider_object_id=object_id AND op.id<>r.legacy_operation_id)
 OR EXISTS(SELECT 1 FROM public.expert_onboarding_payment_operations op WHERE op.provider_object_id=object_id AND op.id<>r.legacy_operation_id)
 OR EXISTS(SELECT 1 FROM public.early_bird_payment_successes WHERE provider_object_id=object_id)
 OR EXISTS(SELECT 1 FROM public.early_bird_verified_bindings WHERE provider_object_id=object_id)
 OR EXISTS(SELECT 1 FROM public.early_bird_deferred_invoices WHERE provider_id=object_id)
 THEN RETURN NULL; END IF;
 IF r.product='onboarding' THEN
  UPDATE public.expert_onboarding_payment_operations SET provider_object_id=object_id,status=CASE WHEN status='succeeded' THEN status ELSE 'pending' END WHERE id=r.legacy_operation_id AND(provider_object_id IS NULL OR provider_object_id=object_id);
  UPDATE public.expert_sales_provider_requests SET provider_object_id=object_id WHERE id=r.id AND(provider_object_id IS NULL OR provider_object_id=object_id);
 ELSE UPDATE public.expert_residency_provider_operations SET provider_object_id=object_id,status=CASE WHEN status='succeeded' THEN status ELSE 'pending' END WHERE id=r.legacy_operation_id AND(provider_object_id IS NULL OR provider_object_id=object_id);
 END IF;
 IF r.product='main' THEN UPDATE public.expert_residency_payment_attempts pa SET provider_request_id=object_id,status='pending',updated_at=clock_timestamp() FROM public.expert_residency_provider_operations op WHERE op.id=r.legacy_operation_id AND pa.id=op.payment_attempt_id AND pa.order_id=r.order_id AND pa.status IN('created','pending','unknown_outcome'); END IF;
 UPDATE public.public_expert_payment_requests SET provider_object_id=object_id,state=CASE WHEN state='uncertain' THEN 'bound' ELSE state END WHERE id=r.id RETURNING * INTO r;
 RETURN early_bird_private.public_snapshot(r);
END $$;
CREATE FUNCTION early_bird_private.public_payment_observe(target_request uuid,object_id text,target_fact jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.public_expert_payment_requests%ROWTYPE; previous public.public_expert_payment_observations%ROWTYPE; observation_id uuid;
BEGIN
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request FOR UPDATE;
 IF r.state NOT IN('uncertain','bound','resolved') OR r.provider_object_id IS DISTINCT FROM object_id THEN RETURN NULL; END IF;
 SELECT * INTO previous FROM public.public_expert_payment_observations WHERE request_id=r.id AND evidence_digest=target_fact->>'evidenceDigest';
 IF FOUND THEN IF previous.fact=target_fact THEN RETURN previous.id; ELSE RETURN NULL; END IF; END IF;
 IF NOT early_bird_private.public_fact_valid(r,object_id,target_fact) OR NOT early_bird_private.public_source_valid(r,false) THEN RETURN NULL; END IF;
 INSERT INTO public.public_expert_payment_observations(request_id,provider_object_id,parent_payment_id,status,paid,amount_minor,currency,mode,provider_created_at,provider_captured_at,payment_method_type,identity,evidence_digest,observed_at,fact)
 VALUES(r.id,object_id,r.parent_payment_id,target_fact->>'status',(target_fact->>'paid')::boolean,r.amount_minor,r.currency,r.mode,(target_fact->>'providerCreatedAt')::timestamptz,(target_fact->>'providerCapturedAt')::timestamptz,target_fact->>'paymentMethodType',target_fact->'identity',target_fact->>'evidenceDigest',(target_fact->>'observedAt')::timestamptz,target_fact) RETURNING id INTO observation_id;
 IF r.product='onboarding' THEN
  INSERT INTO public.expert_sales_provider_observations(invoice_id,provider_object_id,status,evidence_digest,observed_at) VALUES(r.invoice_id,object_id,target_fact->>'status',target_fact->>'evidenceDigest',(target_fact->>'observedAt')::timestamptz) ON CONFLICT DO NOTHING;
 END IF;
 IF r.state='uncertain' THEN UPDATE public.public_expert_payment_requests SET state='bound' WHERE id=r.id; END IF;
 RETURN observation_id;
END $$;
--> statement-breakpoint
CREATE FUNCTION early_bird_private.public_apply_result(r public.public_expert_payment_requests,o public.public_expert_payment_observations,result_kind text,action_name text,attempt uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('version',1,'kind',result_kind,'requestId',r.id,'observationId',o.id,'legacySourceId',r.legacy_source_id,'legacyOperationId',r.legacy_operation_id,'providerObjectId',r.provider_object_id,'action',action_name,'applyAttemptId',attempt,
 'evidence',CASE WHEN action_name IS NULL THEN NULL ELSE jsonb_build_object('snapshot',r.snapshot,'observation',o.fact,'legacyEventId','public:'||r.id::text||':'||o.id::text) END)
$$;
CREATE FUNCTION early_bird_private.public_resolution(target_request uuid,target_observation uuid,expiry boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.public_expert_payment_requests%ROWTYPE; o public.public_expert_payment_observations%ROWTYPE; prior public.public_expert_payment_resolutions%ROWTYPE;
 action_name text; disposition_name text; attempt uuid; manual_reason text;
BEGIN
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request FOR UPDATE;
 SELECT * INTO o FROM public.public_expert_payment_observations WHERE id=target_observation AND request_id=r.id AND provider_object_id=r.provider_object_id;
 IF NOT FOUND OR NOT early_bird_private.public_source_valid(r,false) THEN RETURN early_bird_private.public_apply_result(r,o,'not_ready',NULL,NULL); END IF;
 SELECT * INTO prior FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind='applied';
 IF FOUND THEN
  IF prior.observation_id=o.id THEN RETURN early_bird_private.public_apply_result(r,o,'already_applied',prior.action,prior.apply_attempt_id); END IF;
  RETURN early_bird_private.public_apply_result(r,o,'manual_reconciliation',NULL,NULL);
 END IF;
 IF o.status NOT IN('succeeded','canceled') OR (expiry AND o.status<>'canceled') OR r.state NOT IN('bound','resolved') THEN RETURN early_bird_private.public_apply_result(r,o,'not_ready',NULL,NULL); END IF;
 -- A newer contradictory terminal fact is never overwritten. Successful paid evidence wins over expiry.
 IF o.status='canceled' AND EXISTS(SELECT 1 FROM public.public_expert_payment_requests other JOIN public.public_expert_payment_observations paid ON paid.request_id=other.id WHERE other.legacy_source_id=r.legacy_source_id AND other.product=r.product AND paid.status='succeeded') THEN RETURN early_bird_private.public_apply_result(r,o,'manual_reconciliation',NULL,NULL); END IF;
 IF o.status='succeeded' THEN
  action_name:=CASE r.product WHEN 'onboarding' THEN 'onboarding_settle' WHEN 'main' THEN 'main_settle' ELSE 'main_refund' END; disposition_name:='eligible';
  IF r.product<>'refund' AND o.provider_captured_at>r.payment_deadline THEN manual_reason:='capture_after_deadline'; disposition_name:='late_paid_manual_reconciliation'; END IF;
  IF r.product='main' AND EXISTS(SELECT 1 FROM public.expert_residency_orders WHERE id=r.order_id AND(status NOT IN('payment_pending','settled') OR(provider_payment_id IS NOT NULL AND provider_payment_id<>r.provider_object_id))) THEN manual_reason:='financial_source_conflict'; END IF;
  IF r.product='main' AND EXISTS(SELECT 1 FROM public.expert_referral_ledger_entries WHERE order_id=r.order_id AND entry_kind='release') THEN manual_reason:='credit_already_released'; END IF;
  IF r.product='onboarding' AND NOT EXISTS(SELECT 1 FROM public.public_expert_payment_requests capture JOIN public.public_expert_payment_observations held ON held.provider_object_id=capture.parent_payment_id
    JOIN public.public_expert_payment_requests original ON original.id=held.request_id AND original.invoice_id=capture.invoice_id
    WHERE capture.invoice_id=r.invoice_id AND capture.kind='onboarding_capture' AND capture.dispatched_at IS NOT NULL AND capture.dispatched_at<=o.provider_captured_at AND capture.dispatched_at<capture.payment_deadline
    AND held.status='waiting_for_capture' AND held.payment_method_type='bank_card' AND held.observed_at<=capture.dispatched_at) THEN manual_reason:='capture_unproven'; END IF;
 ELSE action_name:='release_terminal_unpaid'; disposition_name:='terminal_unpaid';
  IF r.product='refund' THEN RETURN early_bird_private.public_apply_result(r,o,'not_ready',NULL,NULL); END IF;
  IF r.product='main' AND EXISTS(SELECT 1 FROM public.expert_residency_orders WHERE id=r.order_id AND status IN('settled','refunded','charged_back')) THEN RETURN early_bird_private.public_apply_result(r,o,'manual_reconciliation',NULL,NULL); END IF;
 END IF;
 SELECT * INTO prior FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind='apply_attempt';
 IF FOUND THEN
  IF prior.observation_id<>o.id OR prior.action<>action_name THEN RETURN early_bird_private.public_apply_result(r,o,'manual_reconciliation',NULL,NULL); END IF;
  attempt:=prior.apply_attempt_id;
 ELSE attempt:=gen_random_uuid(); END IF;
 IF manual_reason IS NOT NULL THEN
  INSERT INTO public.public_expert_payment_resolutions(request_id,kind,observation_id,apply_attempt_id,action,provider_object_id,captured_at,payment_deadline,disposition,reason)
  VALUES(r.id,'manual_reconciliation',o.id,attempt,action_name,r.provider_object_id,o.provider_captured_at,r.payment_deadline,CASE WHEN disposition_name='late_paid_manual_reconciliation' THEN disposition_name ELSE 'paid_manual_reconciliation' END,manual_reason) ON CONFLICT DO NOTHING;
  RETURN early_bird_private.public_apply_result(r,o,'manual_reconciliation',action_name,attempt);
 END IF;
 IF EXISTS(SELECT 1 FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind='manual_reconciliation') THEN RETURN early_bird_private.public_apply_result(r,o,'manual_reconciliation',action_name,attempt); END IF;
 INSERT INTO public.public_expert_payment_resolutions(request_id,kind,observation_id,apply_attempt_id,action,provider_object_id,captured_at,payment_deadline,disposition,reason)
 VALUES(r.id,'apply_attempt',o.id,attempt,action_name,r.provider_object_id,o.provider_captured_at,r.payment_deadline,disposition_name,'verified_terminal_fact') ON CONFLICT DO NOTHING;
 RETURN early_bird_private.public_apply_result(r,o,'ready_to_apply',action_name,attempt);
END $$;
CREATE FUNCTION early_bird_private.public_payment_resolve(target_request uuid,target_observation uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_resolution(target_request,target_observation,false)
$$;
CREATE FUNCTION early_bird_private.public_payment_expire(target_request uuid,target_observation uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_resolution(target_request,target_observation,true)
$$;
CREATE FUNCTION early_bird_private.public_payment_apply_guard(target_request uuid,target_observation uuid,target_attempt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 result:=early_bird_private.public_resolution(target_request,target_observation,false);
 IF result->>'kind' IS DISTINCT FROM 'ready_to_apply' OR result->>'applyAttemptId' IS DISTINCT FROM target_attempt::text THEN RETURN NULL; END IF;
 UPDATE public.public_expert_payment_requests SET apply_attempt_id=target_attempt,apply_observation_id=target_observation,apply_action=result->>'action',apply_xid=pg_current_xact_id(),apply_login=session_user WHERE id=target_request;
 RETURN result;
END $$;
--> statement-breakpoint
-- Protect canonical posting and release even when an old batch/command bypasses the new runner.
CREATE FUNCTION early_bird_private.public_financial_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source uuid; allowed boolean; expected_action text; row_data jsonb; owner_request public.public_expert_payment_requests%ROWTYPE;
BEGIN
 row_data:=to_jsonb(NEW);
 IF TG_TABLE_NAME='expert_onboarding_payment_facts' THEN source:=NEW.invoice_id; expected_action:='onboarding_settle';
 ELSIF TG_TABLE_NAME='expert_onboarding_invoices' THEN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  source:=NEW.id; expected_action:=CASE NEW.status WHEN 'settled' THEN 'onboarding_settle' ELSE 'release_terminal_unpaid' END;
 ELSIF TG_TABLE_NAME='expert_residency_orders' THEN
  IF ROW(NEW.status,NEW.residency_starts_at,NEW.residency_ends_at) IS NOT DISTINCT FROM ROW(OLD.status,OLD.residency_starts_at,OLD.residency_ends_at) THEN RETURN NEW; END IF;
  source:=NEW.id; expected_action:=CASE WHEN NEW.status='settled' THEN 'main_settle' WHEN NEW.status IN('refunded','charged_back') THEN 'main_refund' ELSE 'release_terminal_unpaid' END;
 ELSIF TG_TABLE_NAME='expert_referral_ledger_entries' THEN
  IF NEW.order_id IS NULL OR NEW.entry_kind NOT IN('release','spend','reversal') THEN RETURN NEW; END IF; source:=NEW.order_id;
 ELSIF TG_TABLE_NAME='expert_residency_provider_event_inbox' THEN
  IF NEW.order_id IS NULL THEN RETURN NEW; END IF; source:=NEW.order_id;
 END IF;
 SELECT * INTO owner_request FROM public.public_expert_payment_requests WHERE legacy_source_id=source LIMIT 1;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT EXISTS(SELECT 1 FROM public.public_expert_payment_requests r JOIN public.public_expert_payment_observations o ON o.id=r.apply_observation_id AND o.request_id=r.id
  JOIN public.public_expert_payment_resolutions a ON a.request_id=r.id AND a.kind='apply_attempt' AND a.apply_attempt_id=r.apply_attempt_id AND a.observation_id=o.id
  WHERE r.legacy_source_id=source AND r.apply_xid=pg_current_xact_id() AND r.apply_login=session_user
   AND(expected_action IS NULL OR r.apply_action=expected_action)
   AND(a.action=r.apply_action) AND NOT EXISTS(SELECT 1 FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind='manual_reconciliation')
   AND(CASE TG_TABLE_NAME
    WHEN 'expert_onboarding_payment_facts' THEN row_data->>'provider_object_id'=r.provider_object_id AND row_data->>'operation_id'=r.legacy_operation_id::text AND row_data->>'user_id'=r.user_id::text AND row_data->>'amount_minor'=r.amount_minor::text AND(row_data->>'captured_at')::timestamptz=o.provider_captured_at AND row_data->>'provider_mode'=r.mode
    WHEN 'expert_residency_orders' THEN CASE WHEN expected_action='main_settle' THEN row_data->>'provider_payment_id'=r.provider_object_id AND(row_data->>'residency_starts_at')::timestamptz>=o.provider_captured_at ELSE true END
    WHEN 'expert_residency_provider_event_inbox' THEN row_data->>'external_event_id'='public:'||r.id::text||':'||o.id::text AND row_data->>'payload_digest'=substring(o.evidence_digest FROM 8) AND row_data->>'amount_minor'=r.amount_minor::text AND row_data->>'payment_id'=CASE WHEN r.product='refund' THEN r.parent_payment_id ELSE r.provider_object_id END
    ELSE true END)) INTO allowed;
 IF NOT allowed THEN RAISE EXCEPTION 'public_financial_apply_context_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_onboarding_fact_guard BEFORE INSERT ON expert_onboarding_payment_facts FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_financial_guard();
CREATE TRIGGER public_onboarding_state_guard BEFORE UPDATE ON expert_onboarding_invoices FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_financial_guard();
CREATE TRIGGER public_main_state_guard BEFORE UPDATE ON expert_residency_orders FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_financial_guard();
CREATE TRIGGER public_credit_state_guard BEFORE INSERT ON expert_referral_ledger_entries FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_financial_guard();
CREATE TRIGGER public_inbox_fact_guard BEFORE INSERT OR UPDATE ON expert_residency_provider_event_inbox FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_financial_guard();
CREATE FUNCTION early_bird_private.public_payment_complete(target_request uuid,target_attempt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.public_expert_payment_requests%ROWTYPE; o public.public_expert_payment_observations%ROWTYPE; a public.public_expert_payment_resolutions%ROWTYPE; legacy_id text;
BEGIN
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request FOR UPDATE;
 SELECT * INTO a FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind='apply_attempt' AND apply_attempt_id=target_attempt;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO o FROM public.public_expert_payment_observations WHERE id=a.observation_id;
 IF EXISTS(SELECT 1 FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind='applied' AND apply_attempt_id=target_attempt) THEN RETURN early_bird_private.public_apply_result(r,o,'already_applied',a.action,target_attempt); END IF;
 IF r.apply_attempt_id IS DISTINCT FROM target_attempt OR r.apply_xid IS NULL OR r.apply_xid=pg_current_xact_id() OR NOT early_bird_private.public_source_valid(r,false) THEN RETURN early_bird_private.public_apply_result(r,o,'not_ready',NULL,NULL); END IF;
 IF a.action='onboarding_settle' THEN
  SELECT f.invoice_id::text INTO legacy_id FROM public.expert_onboarding_payment_facts f JOIN public.expert_onboarding_invoices i ON i.id=f.invoice_id AND i.status='settled'
  JOIN public.expert_onboarding_payment_operations op ON op.id=f.operation_id AND op.status='succeeded'
  WHERE f.invoice_id=r.invoice_id AND f.operation_id=r.legacy_operation_id AND f.user_id=r.user_id AND f.provider_object_id=r.provider_object_id AND f.provider_mode=r.mode AND f.amount_minor=r.amount_minor AND f.currency=r.currency AND f.captured_at=o.provider_captured_at AND f.evidence_digest=o.evidence_digest;
 ELSIF a.action IN('main_settle','main_refund') THEN
  SELECT e.id::text INTO legacy_id FROM public.expert_residency_provider_event_inbox e JOIN public.expert_residency_orders ord ON ord.id=e.order_id
  WHERE e.external_event_id='public:'||r.id::text||':'||o.id::text AND e.provider='yookassa' AND e.order_id=r.order_id AND e.amount_minor=r.amount_minor AND e.currency=r.currency AND e.payload_digest=substring(o.evidence_digest FROM 8) AND e.status='processed'
   AND e.payment_id=CASE WHEN r.product='refund' THEN r.parent_payment_id ELSE r.provider_object_id END
   AND((a.action='main_settle' AND e.event_kind='settled' AND ord.status='settled' AND ord.provider_payment_id=r.provider_object_id AND e.occurred_at=o.provider_captured_at AND ord.residency_starts_at>=o.provider_captured_at AND ord.residency_ends_at=ord.residency_starts_at+make_interval(secs=>ord.duration_seconds))
    OR(a.action='main_refund' AND e.event_kind='refunded' AND e.result_code IN('terminated','partial_refund')));
 ELSE
  IF r.product='onboarding' THEN SELECT id::text INTO legacy_id FROM public.expert_onboarding_invoices WHERE id=r.invoice_id AND status='cancelled' AND NOT EXISTS(SELECT 1 FROM public.expert_onboarding_payment_facts WHERE invoice_id=r.invoice_id);
  ELSE SELECT id::text INTO legacy_id FROM public.expert_residency_orders ord WHERE id=r.order_id AND status='expired' AND NOT EXISTS(SELECT 1 FROM public.expert_residency_payment_attempts WHERE order_id=r.order_id AND status='settled')
   AND NOT EXISTS(SELECT 1 FROM public.expert_referral_ledger_entries reservation WHERE reservation.order_id=r.order_id AND reservation.entry_kind='reservation' AND NOT EXISTS(SELECT 1 FROM public.expert_referral_ledger_entries released WHERE released.original_entry_id=reservation.id AND released.entry_kind='release'));
  END IF;
 END IF;
 IF legacy_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.expert_onboarding_payment_facts WHERE invoice_id=r.invoice_id)
   OR (a.action='main_settle' AND EXISTS(SELECT 1 FROM public.expert_residency_orders WHERE id=r.order_id AND status IN('settled','refunded','charged_back')))
   OR EXISTS(SELECT 1 FROM public.expert_residency_provider_event_inbox WHERE external_event_id='public:'||r.id::text||':'||o.id::text AND status='processed') THEN
   INSERT INTO public.public_expert_payment_resolutions(request_id,kind,observation_id,apply_attempt_id,action,provider_object_id,captured_at,payment_deadline,disposition,reason)
   VALUES(r.id,'manual_reconciliation',o.id,target_attempt,a.action,r.provider_object_id,o.provider_captured_at,r.payment_deadline,'paid_manual_reconciliation','canonical_fact_conflict') ON CONFLICT DO NOTHING;
   RETURN early_bird_private.public_apply_result(r,o,'manual_reconciliation',a.action,target_attempt);
  END IF;
  RETURN early_bird_private.public_apply_result(r,o,'not_ready',NULL,NULL);
 END IF;
 INSERT INTO public.public_expert_payment_resolutions(request_id,kind,observation_id,apply_attempt_id,action,legacy_fact_id,provider_object_id,captured_at,payment_deadline,disposition,reason)
 VALUES(r.id,'applied',o.id,target_attempt,a.action,legacy_id,r.provider_object_id,o.provider_captured_at,r.payment_deadline,a.disposition,'canonical_commit_verified');
 UPDATE public.public_expert_payment_requests SET state='resolved' WHERE id=r.id AND state='bound';
 RETURN early_bird_private.public_apply_result(r,o,'already_applied',a.action,target_attempt);
END $$;

CREATE FUNCTION early_bird_private.public_onboarding_prepare(target_user uuid,target_source uuid,target_contact uuid,descriptor jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_prepare('onboarding',target_user,target_source,target_contact,descriptor)
$$;
CREATE FUNCTION early_bird_private.public_onboarding_snapshot(target_user uuid,target_request uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_snapshot(r) FROM public.public_expert_payment_requests r WHERE id=target_request AND user_id=target_user AND product='onboarding'
$$;
CREATE FUNCTION early_bird_private.public_onboarding_admit(target_user uuid,target_request uuid,target_digest text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_admit('onboarding',target_user,target_request,target_digest)
$$;

CREATE FUNCTION early_bird_private.public_main_prepare(target_user uuid,target_source uuid,target_contact uuid,descriptor jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_prepare('main',target_user,target_source,target_contact,descriptor)
$$;
CREATE FUNCTION early_bird_private.public_main_snapshot(target_user uuid,target_request uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_snapshot(r) FROM public.public_expert_payment_requests r WHERE id=target_request AND user_id=target_user AND product='main'
$$;
CREATE FUNCTION early_bird_private.public_main_admit(target_user uuid,target_request uuid,target_digest text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_admit('main',target_user,target_request,target_digest)
$$;

CREATE FUNCTION early_bird_private.public_refund_prepare(target_user uuid,target_source uuid,target_contact uuid,descriptor jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_prepare('refund',target_user,target_source,target_contact,descriptor)
$$;
CREATE FUNCTION early_bird_private.public_refund_snapshot(target_user uuid,target_request uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_snapshot(r) FROM public.public_expert_payment_requests r WHERE id=target_request AND user_id=target_user AND product='refund'
$$;
CREATE FUNCTION early_bird_private.public_refund_admit(target_user uuid,target_request uuid,target_digest text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_admit('refund',target_user,target_request,target_digest)
$$;

CREATE FUNCTION early_bird_private.public_contact_cleanup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.redacted_at IS NOT NULL AND OLD.redacted_at IS NULL THEN
  UPDATE public.public_expert_payment_requests SET encrypted_body=NULL,key_reference=NULL WHERE contact_id=NEW.id AND encrypted_body IS NOT NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_contact_cleanup AFTER UPDATE ON payer_receipt_contacts FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_contact_cleanup();
-- Revoke every new capability and helper, including the trusted-processor guard.
-- Task6 provisions exact external LOGIN mappings; this migration guesses no role.
DO $$ DECLARE fn record; BEGIN
 FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='early_bird_private' AND p.proname LIKE 'public_%') OR(n.nspname='public' AND p.proname='public_expert_gateway_claim') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn.signature);
 END LOOP;
END $$;
