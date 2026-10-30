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
 apply_expected_start timestamptz, apply_expected_end timestamptz,
 CHECK((apply_expected_start IS NULL AND apply_expected_end IS NULL) OR (apply_expected_start IS NOT NULL AND apply_expected_end IS NOT NULL AND isfinite(apply_expected_start) AND isfinite(apply_expected_end) AND apply_expected_end>apply_expected_start AND apply_action='main_settle')),
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
 -- Provider timestamps can tie; this sequence captures verified insertion order under the subject lock.
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), observation_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 request_id uuid NOT NULL REFERENCES public_expert_payment_requests(id),
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
-- Plan amendment: nonfinancial, typed provider identity ownership across expert products.
-- Claims survive ordinary source/user erasure; only isolated testkit reset truncates them.
CREATE TABLE public_expert_provider_identities (
 object_kind text NOT NULL CHECK(object_kind IN('payment','refund')),
 provider_object_id text NOT NULL CHECK(provider_object_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 source_kind text NOT NULL CHECK(source_kind IN('onboarding','residency','composite','deferred')),
 source_id uuid NOT NULL,
 PRIMARY KEY(object_kind,provider_object_id)
);
REVOKE ALL ON public_expert_provider_identities FROM PUBLIC;
CREATE FUNCTION early_bird_private.public_identity_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'public_provider_identity_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_provider_identity_immutable BEFORE UPDATE OR DELETE ON public_expert_provider_identities FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_immutable();
CREATE FUNCTION early_bird_private.public_identity_claim(target_kind text,target_object text,target_source_kind text,target_source uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- Unique-key arbitration, not snapshot-based absence checks. At stronger isolation
 -- concurrent conflicts may raise serialization_failure; they never admit two owners.
 INSERT INTO public.public_expert_provider_identities(object_kind,provider_object_id,source_kind,source_id)
 VALUES(target_kind,target_object,target_source_kind,target_source)
 ON CONFLICT(object_kind,provider_object_id) DO UPDATE SET source_id=EXCLUDED.source_id
 WHERE public_expert_provider_identities.source_kind=EXCLUDED.source_kind AND public_expert_provider_identities.source_id=EXCLUDED.source_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'public_provider_identity_conflict' USING ERRCODE='23505'; END IF;
END $$;
CREATE FUNCTION early_bird_private.public_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE data jsonb:=to_jsonb(NEW); object_kind text:=TG_ARGV[0]; object_id text:=data->>TG_ARGV[1]; source_kind text:=TG_ARGV[2]; source_id uuid:=(data->>TG_ARGV[3])::uuid;
BEGIN
 IF object_id IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='public_expert_payment_requests' THEN
  object_kind:=CASE WHEN NEW.product='refund' THEN 'refund' ELSE 'payment' END;
  source_kind:=CASE WHEN NEW.product='onboarding' THEN 'onboarding' ELSE 'residency' END;
 ELSIF TG_TABLE_NAME='expert_residency_provider_operations' THEN
  IF NEW.provider<>'yookassa' THEN RETURN NEW; END IF;
  object_kind:=CASE WHEN NEW.operation_kind='create_refund' THEN 'refund' ELSE 'payment' END;
 ELSIF TG_TABLE_NAME='early_bird_refund_binding_registry' THEN source_kind:=NEW.product;
 END IF;
 PERFORM early_bird_private.public_identity_claim(object_kind,object_id,source_kind,source_id);
 RETURN NEW;
END $$;
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON expert_onboarding_payment_operations FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('payment','provider_object_id','onboarding','id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON expert_residency_provider_operations FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('dynamic','provider_object_id','residency','id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON early_bird_verified_bindings FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('payment','provider_object_id','composite','intent_id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON early_bird_payment_successes FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('payment','provider_object_id','composite','intent_id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON early_bird_deferred_verified_bindings FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('payment','provider_id','deferred','invoice_id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON early_bird_deferred_invoices FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('payment','provider_id','deferred','id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON early_bird_verified_refund_bindings FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('refund','provider_refund_id','composite','intent_id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON early_bird_payment_full_refunds FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('refund','provider_refund_id','composite','intent_id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON early_bird_refund_registry FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('refund','provider_refund_id','composite','intent_id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON early_bird_deferred_verified_refund_bindings FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('refund','provider_refund_id','deferred','invoice_id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON early_bird_deferred_refund_facts FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('refund','provider_refund_id','deferred','invoice_id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON early_bird_refund_binding_registry FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('refund','provider_refund_id','dynamic','subject_id');
CREATE TRIGGER public_provider_identity_guard BEFORE INSERT OR UPDATE ON public_expert_payment_requests FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_identity_guard('dynamic','provider_object_id','dynamic','legacy_operation_id');
-- Reject contradictory historical ownership; never silently choose a winner.
DO $$ DECLARE binding record; BEGIN
 FOR binding IN SELECT * FROM (
 SELECT 'payment' object_kind,provider_object_id provider_object_id,'onboarding' source_kind,id source_id FROM public.expert_onboarding_payment_operations WHERE provider_object_id IS NOT NULL
 UNION ALL
 SELECT CASE WHEN operation_kind='create_refund' THEN 'refund' ELSE 'payment' END object_kind,provider_object_id provider_object_id,'residency' source_kind,id source_id FROM public.expert_residency_provider_operations WHERE provider_object_id IS NOT NULL AND provider='yookassa'
 UNION ALL
 SELECT 'payment' object_kind,provider_object_id provider_object_id,'composite' source_kind,intent_id source_id FROM public.early_bird_verified_bindings WHERE provider_object_id IS NOT NULL
 UNION ALL
 SELECT 'payment' object_kind,provider_object_id provider_object_id,'composite' source_kind,intent_id source_id FROM public.early_bird_payment_successes WHERE provider_object_id IS NOT NULL
 UNION ALL
 SELECT 'payment' object_kind,provider_id provider_object_id,'deferred' source_kind,invoice_id source_id FROM public.early_bird_deferred_verified_bindings WHERE provider_id IS NOT NULL
 UNION ALL
 SELECT 'payment' object_kind,provider_id provider_object_id,'deferred' source_kind,id source_id FROM public.early_bird_deferred_invoices WHERE provider_id IS NOT NULL
 UNION ALL
 SELECT 'refund' object_kind,provider_refund_id provider_object_id,'composite' source_kind,intent_id source_id FROM public.early_bird_verified_refund_bindings WHERE provider_refund_id IS NOT NULL
 UNION ALL
 SELECT 'refund' object_kind,provider_refund_id provider_object_id,'composite' source_kind,intent_id source_id FROM public.early_bird_payment_full_refunds WHERE provider_refund_id IS NOT NULL
 UNION ALL
 SELECT 'refund' object_kind,provider_refund_id provider_object_id,'composite' source_kind,intent_id source_id FROM public.early_bird_refund_registry WHERE provider_refund_id IS NOT NULL
 UNION ALL
 SELECT 'refund' object_kind,provider_refund_id provider_object_id,'deferred' source_kind,invoice_id source_id FROM public.early_bird_deferred_verified_refund_bindings WHERE provider_refund_id IS NOT NULL
 UNION ALL
 SELECT 'refund' object_kind,provider_refund_id provider_object_id,'deferred' source_kind,invoice_id source_id FROM public.early_bird_deferred_refund_facts WHERE provider_refund_id IS NOT NULL
 UNION ALL
 SELECT 'refund' object_kind,provider_refund_id provider_object_id,product source_kind,subject_id source_id FROM public.early_bird_refund_binding_registry WHERE provider_refund_id IS NOT NULL
 UNION ALL
 SELECT CASE WHEN product='refund' THEN 'refund' ELSE 'payment' END object_kind,provider_object_id provider_object_id,CASE WHEN product='onboarding' THEN 'onboarding' ELSE 'residency' END source_kind,legacy_operation_id source_id FROM public.public_expert_payment_requests WHERE provider_object_id IS NOT NULL
 ) all_bindings ORDER BY object_kind,provider_object_id,source_kind,source_id LOOP
  PERFORM early_bird_private.public_identity_claim(binding.object_kind,binding.provider_object_id,binding.source_kind,binding.source_id);
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION early_bird_private.public_time(value timestamptz) RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT regexp_replace(to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'([0-9]{3})000Z$','\1Z')
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
    WHERE req.invoice_id=r.invoice_id AND req.legacy_operation_id=r.legacy_operation_id AND obs.provider_object_id=r.parent_payment_id ORDER BY obs.observation_sequence DESC LIMIT 1;
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
 IF target_user IS NULL OR target_source IS NULL OR descriptor IS NULL OR NOT public.expert_jsonb_has_exact_keys(descriptor,ARRAY['requestId','idempotencyKey','kind','legacyDeliveryOperationId','requestDigest','bodyVersion','ciphertext','keyReference','bodyExpiresAt']) THEN RETURN NULL; END IF;
 IF jsonb_typeof(descriptor->'requestDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(descriptor->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(descriptor->'ciphertext') NOT IN('string','null') OR jsonb_typeof(descriptor->'keyReference') NOT IN('string','null') OR jsonb_typeof(descriptor->'bodyExpiresAt') NOT IN('string','null') OR descriptor->'bodyVersion' IS DISTINCT FROM '1'::jsonb OR descriptor->>'requestDigest' !~ '^sha256:[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 r.id:=(descriptor->>'requestId')::uuid; r.idempotency_key:=(descriptor->>'idempotencyKey')::uuid;
 r.kind:=descriptor->>'kind'; r.legacy_operation_id:=(descriptor->>'legacyDeliveryOperationId')::uuid; r.product:=product_name; r.user_id:=target_user; r.contact_id:=target_contact; r.request_digest:=descriptor->>'requestDigest';
 r.snapshot_version:=1; r.currency:='RUB'; r.state:='prepared'; r.created_at:=public.early_bird_current_time();
 r.encrypted_body:=descriptor->>'ciphertext'; r.key_reference:=descriptor->>'keyReference'; r.body_expires_at:=(descriptor->>'bodyExpiresAt')::timestamptz;
 IF r.id IS NULL OR r.idempotency_key IS NULL OR r.kind IS NULL OR NOT((product_name='onboarding' AND r.kind IN('onboarding_create','onboarding_capture','onboarding_cancel')) OR(product_name='main' AND r.kind='main_create') OR(product_name='refund' AND r.kind='main_refund')) THEN RETURN NULL; END IF;
 IF (r.kind='main_create') IS DISTINCT FROM (r.legacy_operation_id IS NOT NULL) OR r.legacy_operation_id=r.id THEN RETURN NULL; END IF;
 IF (r.kind IN('onboarding_capture','onboarding_cancel')) IS DISTINCT FROM (target_contact IS NULL) THEN RETURN NULL; END IF;
 IF target_contact IS NULL AND (r.encrypted_body IS NOT NULL OR r.key_reference IS NOT NULL OR r.body_expires_at IS NOT NULL) THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO old FROM public.public_expert_payment_requests WHERE id=r.id OR idempotency_key=r.idempotency_key LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF old.id=r.id AND old.idempotency_key=r.idempotency_key AND old.user_id=target_user AND old.product=product_name AND old.kind=r.kind
   AND (CASE WHEN product_name='refund' THEN old.legacy_operation_id ELSE old.legacy_source_id END)=target_source
   AND (product_name<>'main' OR old.legacy_operation_id=r.legacy_operation_id)
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
  SELECT a.expires_at,b.quote_id INTO r.payment_deadline,source_quote FROM public.expert_sales_fee_attempts a LEFT JOIN public.expert_sales_form_bridges b ON b.application_id=invoice.application_id AND b.user_id=invoice.user_id WHERE a.invoice_id=invoice.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  r.provider_deadline:=r.payment_deadline;
  IF r.kind<>'onboarding_create' THEN r.parent_payment_id:=onboarding_op.provider_object_id; r.provider_object_id:=r.parent_payment_id; END IF;
  IF EXISTS(SELECT 1 FROM public.expert_sales_provider_requests WHERE invoice_id=invoice.id AND kind=replace(r.kind,'onboarding_','')) THEN RETURN NULL; END IF;
 ELSE
  IF product_name='refund' THEN
   SELECT * INTO op FROM public.expert_residency_provider_operations WHERE id=target_source AND operation_kind='create_refund' AND status='claimed' AND provider_object_id IS NULL FOR UPDATE;
   -- op.request_digest/claim_digest retain immutable financial authorization;
   -- r.request_digest independently binds the encrypted exact provider body.
   IF NOT FOUND OR op.idempotency_key<>r.idempotency_key THEN RETURN NULL; END IF;
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
   IF EXISTS(SELECT 1 FROM public.expert_residency_provider_operations WHERE id=r.legacy_operation_id)
    OR EXISTS(SELECT 1 FROM public.expert_onboarding_payment_operations WHERE id=r.legacy_operation_id)
    OR EXISTS(SELECT 1 FROM public.public_expert_payment_requests WHERE id=r.legacy_operation_id OR legacy_operation_id=r.legacy_operation_id)
    OR EXISTS(SELECT 1 FROM public.early_bird_composite_intents WHERE id=r.legacy_operation_id OR invoice_id=r.legacy_operation_id)
    OR EXISTS(SELECT 1 FROM public.early_bird_deferred_invoices WHERE id=r.legacy_operation_id) THEN RETURN NULL; END IF;
   r.amount_minor:=ord.cash_minor; attempt:=gen_random_uuid();
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
 IF (to_jsonb(NEW)-ARRAY['state','admitted_at','dispatched_at','provider_object_id','encrypted_body','key_reference','apply_attempt_id','apply_observation_id','apply_action','apply_xid','apply_login','apply_expected_start','apply_expected_end']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','admitted_at','dispatched_at','provider_object_id','encrypted_body','key_reference','apply_attempt_id','apply_observation_id','apply_action','apply_xid','apply_login','apply_expected_start','apply_expected_end'])
  OR (OLD.apply_expected_start IS NOT NULL AND ROW(NEW.apply_expected_start,NEW.apply_expected_end) IS DISTINCT FROM ROW(OLD.apply_expected_start,OLD.apply_expected_end))
  OR (OLD.apply_expected_start IS NULL AND NEW.apply_expected_start IS NOT NULL AND (NEW.apply_xid IS DISTINCT FROM pg_current_xact_id() OR NEW.apply_login IS DISTINCT FROM session_user OR NEW.apply_action IS DISTINCT FROM 'main_settle'))
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
 -- Common typed identity ownership includes deferred verified bindings before settlement.
 IF EXISTS(SELECT 1 FROM public.public_expert_provider_identities identity_claim
  WHERE identity_claim.object_kind=CASE WHEN r.product='refund' THEN 'refund' ELSE 'payment' END
   AND identity_claim.provider_object_id=object_id
   AND ROW(identity_claim.source_kind,identity_claim.source_id) IS DISTINCT FROM
       ROW(CASE WHEN r.product='onboarding' THEN 'onboarding' ELSE 'residency' END,r.legacy_operation_id)) THEN RETURN NULL; END IF;
 IF r.product='onboarding' THEN
  UPDATE public.expert_onboarding_payment_operations SET provider_object_id=object_id,status=CASE WHEN status='succeeded' THEN status ELSE 'pending' END WHERE id=r.legacy_operation_id AND(provider_object_id IS NULL OR provider_object_id=object_id);
  UPDATE public.expert_sales_provider_requests SET provider_object_id=object_id WHERE id=r.id AND(provider_object_id IS NULL OR provider_object_id=object_id);
 ELSE UPDATE public.expert_residency_provider_operations SET provider_object_id=object_id,status=CASE WHEN status='succeeded' THEN status ELSE 'pending' END WHERE id=r.legacy_operation_id AND(provider_object_id IS NULL OR provider_object_id=object_id);
 END IF;
 IF r.product='main' THEN UPDATE public.expert_residency_payment_attempts pa SET provider_request_id=object_id,status='pending',updated_at=clock_timestamp() FROM public.expert_residency_provider_operations op WHERE op.id=r.legacy_operation_id AND pa.id=op.payment_attempt_id AND pa.order_id=r.order_id AND pa.status IN('created','pending','unknown_outcome'); END IF;
 UPDATE public.public_expert_payment_requests SET provider_object_id=object_id,state=CASE WHEN state='uncertain' THEN 'bound' ELSE state END WHERE id=r.id RETURNING * INTO r;
 RETURN early_bird_private.public_snapshot(r);
EXCEPTION WHEN unique_violation THEN RETURN NULL;
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
 'evidence',CASE WHEN action_name IS NULL THEN NULL ELSE jsonb_build_object('snapshot',r.snapshot,'observation',o.fact,'legacyEventId','public:'||r.id::text||':'||o.id::text,'expectedPeriod',CASE WHEN r.apply_expected_start IS NULL THEN NULL ELSE jsonb_build_object('startsAt',early_bird_private.public_time(r.apply_expected_start),'endsAt',early_bird_private.public_time(r.apply_expected_end)) END) END)
$$;
-- CREATE and CAPTURE observe one held payment. A completed fee is identified by
-- its immutable source/payment tuple, while its original event/digest remain the
-- canonical evidence. Only a previously COMMITTED fact may acknowledge a no-op.
CREATE FUNCTION early_bird_private.public_onboarding_committed_matches(r public.public_expert_payment_requests,o public.public_expert_payment_observations) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(r.product='onboarding' AND r.kind IN('onboarding_create','onboarding_capture')
  AND o.request_id=r.id AND o.provider_object_id=r.provider_object_id AND o.parent_payment_id IS NOT DISTINCT FROM r.parent_payment_id
  AND o.status='succeeded' AND o.paid AND o.amount_minor=r.amount_minor AND o.currency=r.currency AND o.mode=r.mode
  AND NOT EXISTS(SELECT 1 FROM public.public_expert_payment_resolutions conflict WHERE conflict.request_id=r.id AND conflict.kind='manual_reconciliation')
  AND EXISTS(SELECT 1 FROM public.expert_onboarding_payment_facts f
   JOIN public.expert_onboarding_invoices invoice ON invoice.id=f.invoice_id AND invoice.status='settled'
   JOIN public.expert_onboarding_payment_operations operation ON operation.id=f.operation_id AND operation.invoice_id=f.invoice_id AND operation.status='succeeded'
   JOIN public.public_expert_payment_requests original ON original.invoice_id=f.invoice_id AND original.product='onboarding' AND original.kind IN('onboarding_create','onboarding_capture') AND original.legacy_operation_id=f.operation_id AND original.user_id=f.user_id AND original.provider_object_id=f.provider_object_id
   JOIN public.public_expert_payment_observations origin ON origin.request_id=original.id AND origin.id=original.apply_observation_id AND origin.status='succeeded' AND origin.paid
   JOIN public.public_expert_payment_resolutions admission ON admission.request_id=original.id AND admission.kind='apply_attempt' AND admission.apply_attempt_id=original.apply_attempt_id AND admission.observation_id=origin.id AND admission.action='onboarding_settle'
   WHERE f.invoice_id=r.invoice_id AND f.operation_id=r.legacy_operation_id AND f.user_id=r.user_id AND f.purpose='onboarding'
    AND f.provider_object_id=r.provider_object_id AND f.provider_mode=r.mode AND f.amount_minor=r.amount_minor AND f.currency=r.currency AND f.captured_at=o.provider_captured_at
    -- Guard stores a TOP-LEVEL xid8 even below SAVEPOINT. A visible immutable
    -- fact from that different completed transaction is committed; a distinct
    -- tuple xmin/subxid alone says nothing about its outer commit boundary.
    AND original.apply_action='onboarding_settle' AND original.apply_xid IS NOT NULL
    AND original.apply_xid<>pg_current_xact_id() AND pg_visible_in_snapshot(original.apply_xid,pg_current_snapshot())
    AND origin.provider_object_id=f.provider_object_id AND origin.mode=f.provider_mode AND origin.amount_minor=f.amount_minor AND origin.currency=f.currency AND origin.provider_captured_at=f.captured_at
    AND f.event_id='public:'||original.id::text||':'||origin.id::text AND f.evidence_digest=origin.evidence_digest),false)
$$;
REVOKE ALL ON FUNCTION early_bird_private.public_onboarding_committed_matches(public.public_expert_payment_requests,public.public_expert_payment_observations) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION early_bird_private.public_resolution(target_request uuid,target_observation uuid,expiry boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.public_expert_payment_requests%ROWTYPE; o public.public_expert_payment_observations%ROWTYPE; origin public.public_expert_payment_observations%ROWTYPE; prior public.public_expert_payment_resolutions%ROWTYPE;
 action_name text; disposition_name text; attempt uuid; manual_reason text;
BEGIN
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request FOR UPDATE;
 SELECT * INTO o FROM public.public_expert_payment_observations WHERE id=target_observation AND request_id=r.id AND provider_object_id=r.provider_object_id;
 IF NOT FOUND OR NOT early_bird_private.public_source_valid(r,false) THEN RETURN early_bird_private.public_apply_result(r,o,'not_ready',NULL,NULL); END IF;
 SELECT * INTO prior FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind='manual_reconciliation';
 IF FOUND THEN RETURN early_bird_private.public_apply_result(r,o,'manual_reconciliation',prior.action,prior.apply_attempt_id); END IF;
 SELECT * INTO prior FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind IN('applied','apply_attempt') ORDER BY CASE kind WHEN 'applied' THEN 0 ELSE 1 END LIMIT 1;
 IF FOUND THEN
  IF prior.observation_id<>o.id THEN
   SELECT * INTO origin FROM public.public_expert_payment_observations WHERE id=prior.observation_id AND request_id=r.id AND provider_object_id=r.provider_object_id;
   -- Fresh GET observations retain their own immutable evidence, but do not
   -- replace the event/digest selected by the durable financial attempt. Compare
   -- typed provider facts (including exact microseconds), excluding only the
   -- fresh observation identity, observed_at and its evidence digest.
   IF NOT FOUND OR ROW(o.request_id,o.provider_object_id,o.parent_payment_id,o.status,o.paid,o.amount_minor,o.currency,o.mode,o.provider_created_at,o.provider_captured_at,o.payment_method_type,o.identity)
    IS DISTINCT FROM ROW(origin.request_id,origin.provider_object_id,origin.parent_payment_id,origin.status,origin.paid,origin.amount_minor,origin.currency,origin.mode,origin.provider_created_at,origin.provider_captured_at,origin.payment_method_type,origin.identity) THEN
    INSERT INTO public.public_expert_payment_resolutions(request_id,kind,observation_id,apply_attempt_id,action,provider_object_id,captured_at,payment_deadline,disposition,reason)
    VALUES(r.id,'manual_reconciliation',o.id,prior.apply_attempt_id,prior.action,r.provider_object_id,o.provider_captured_at,r.payment_deadline,'paid_manual_reconciliation','fresh_terminal_fact_conflict') ON CONFLICT DO NOTHING;
    RETURN early_bird_private.public_apply_result(r,o,'manual_reconciliation',prior.action,prior.apply_attempt_id);
   END IF;
   o:=origin;
  END IF;
  IF prior.kind='applied' THEN RETURN early_bird_private.public_apply_result(r,o,'already_applied',prior.action,prior.apply_attempt_id); END IF;
 END IF;
 IF o.status NOT IN('succeeded','canceled') OR (expiry AND o.status<>'canceled') OR r.state NOT IN('bound','resolved') THEN RETURN early_bird_private.public_apply_result(r,o,'not_ready',NULL,NULL); END IF;
 -- A newer contradictory terminal fact is never overwritten. Successful paid evidence wins over expiry.
 IF o.status='canceled' AND EXISTS(SELECT 1 FROM public.public_expert_payment_requests other JOIN public.public_expert_payment_observations paid ON paid.request_id=other.id WHERE other.legacy_source_id=r.legacy_source_id AND other.product=r.product AND paid.status='succeeded') THEN RETURN early_bird_private.public_apply_result(r,o,'manual_reconciliation',NULL,NULL); END IF;
 IF o.status='succeeded' THEN
  action_name:=CASE r.product WHEN 'onboarding' THEN 'onboarding_settle' WHEN 'main' THEN 'main_settle' ELSE 'main_refund' END; disposition_name:='eligible';
  IF r.product<>'refund' AND o.provider_captured_at>r.payment_deadline THEN manual_reason:='capture_after_deadline'; disposition_name:='late_paid_manual_reconciliation'; END IF;
  IF r.product='main' AND EXISTS(SELECT 1 FROM public.expert_residency_orders WHERE id=r.order_id AND(status NOT IN('payment_pending','settled') OR(provider_payment_id IS NOT NULL AND provider_payment_id<>r.provider_object_id))) THEN manual_reason:='financial_source_conflict'; END IF;
  IF r.product='main' AND EXISTS(SELECT 1 FROM public.expert_referral_ledger_entries WHERE order_id=r.order_id AND entry_kind='release' AND source_type<>'residency_settlement') THEN manual_reason:='credit_already_released'; END IF;
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
  IF prior.observation_id<>o.id OR prior.action<>action_name THEN manual_reason:='apply_attempt_conflict'; END IF;
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
DECLARE result jsonb; r public.public_expert_payment_requests%ROWTYPE; o public.public_expert_payment_observations%ROWTYPE;
 expected_start timestamptz; expected_end timestamptz; ord public.expert_residency_orders%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Same subject/coverage lock order as the canonical financial engine, before row locks.
 PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
 IF r.product='main' THEN PERFORM public.early_bird_touch_coverage_epoch(r.user_id); END IF;
 result:=early_bird_private.public_resolution(target_request,target_observation,false);
 IF result->>'kind' IS DISTINCT FROM 'ready_to_apply' OR result->>'applyAttemptId' IS DISTINCT FROM target_attempt::text OR result->>'observationId' IS DISTINCT FROM target_observation::text THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request;
 SELECT * INTO o FROM public.public_expert_payment_observations WHERE id=target_observation;
 IF result->>'action'='main_settle' THEN
  SELECT * INTO ord FROM public.expert_residency_orders WHERE id=r.order_id FOR UPDATE;
  expected_start:=greatest(o.provider_captured_at,
   (SELECT max(residency_ends_at) FROM public.expert_residency_orders WHERE expert_id=ord.expert_id AND status='settled' AND id<>ord.id),
   public.early_bird_active_coverage_end(r.user_id),
   (SELECT max(ends_at) FROM public.early_bird_deferred_effective_coverages WHERE user_id=r.user_id));
  expected_end:=expected_start+make_interval(secs=>ord.duration_seconds);
  IF r.apply_expected_start IS NOT NULL THEN
   -- A committed context is immutable, including a crash between posting and completion.
   IF ord.status<>'settled' AND ROW(expected_start,expected_end) IS DISTINCT FROM ROW(r.apply_expected_start,r.apply_expected_end) THEN
    INSERT INTO public.public_expert_payment_resolutions(request_id,kind,observation_id,apply_attempt_id,action,provider_object_id,captured_at,payment_deadline,disposition,reason)
    VALUES(r.id,'manual_reconciliation',o.id,target_attempt,'main_settle',r.provider_object_id,o.provider_captured_at,r.payment_deadline,'paid_manual_reconciliation','committed_period_conflict') ON CONFLICT DO NOTHING;
    RETURN early_bird_private.public_apply_result(r,o,'manual_reconciliation','main_settle',target_attempt);
   END IF;
   expected_start:=r.apply_expected_start; expected_end:=r.apply_expected_end;
  END IF;
 END IF;
 UPDATE public.public_expert_payment_requests SET apply_attempt_id=target_attempt,apply_observation_id=target_observation,apply_action=result->>'action',apply_xid=pg_current_xact_id(),apply_login=session_user,
  apply_expected_start=expected_start,apply_expected_end=expected_end WHERE id=target_request RETURNING * INTO r;
 RETURN early_bird_private.public_apply_result(r,o,'ready_to_apply',result->>'action',target_attempt);
END $$;
--> statement-breakpoint
-- Called only while the canonical financial transition owns the source row.
-- Subject serialization is shared with prepare/admit/claim; lock requests only afterwards.
CREATE FUNCTION early_bird_private.public_never_sent(target_source uuid,target_user uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE proof_row public.public_expert_payment_requests%ROWTYPE;
BEGIN
 -- Legacy releaseExpiredOrders can arrive holding only an order lock. Never wait
 -- for a subject owner that may itself be waiting for that order; refuse and retry.
 IF NOT pg_try_advisory_xact_lock(hashtextextended(target_user::text,0)) THEN RETURN false; END IF;
 PERFORM 1 FROM public.public_expert_payment_requests WHERE legacy_source_id=target_source ORDER BY id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.public_expert_payment_requests WHERE legacy_source_id=target_source AND
  (user_id<>target_user OR kind NOT IN('main_create','onboarding_create') OR state NOT IN('prepared','abandoned') OR admitted_at IS NOT NULL OR dispatched_at IS NOT NULL OR provider_object_id IS NOT NULL OR parent_payment_id IS NOT NULL OR apply_attempt_id IS NOT NULL))
 OR EXISTS(SELECT 1 FROM public.public_expert_payment_observations o JOIN public.public_expert_payment_requests r ON r.id=o.request_id WHERE r.legacy_source_id=target_source)
 OR EXISTS(SELECT 1 FROM public.early_bird_gateway_claims g JOIN public.public_expert_payment_requests r ON g.intent_id=r.id OR g.idempotency_key=r.idempotency_key WHERE r.legacy_source_id=target_source) THEN RETURN false; END IF;
 FOR proof_row IN SELECT * FROM public.public_expert_payment_requests WHERE legacy_source_id=target_source LOOP
  IF NOT early_bird_private.public_source_valid(proof_row,false) THEN RETURN false; END IF;
 END LOOP;
 SELECT * INTO proof_row FROM public.public_expert_payment_requests WHERE legacy_source_id=target_source LIMIT 1;
 IF proof_row.product='main' THEN
  PERFORM 1 FROM public.expert_residency_provider_operations WHERE order_id=target_source ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.expert_residency_payment_attempts WHERE order_id=target_source ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.expert_residency_orders WHERE id=target_source AND provider_payment_id IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public.expert_residency_provider_event_inbox WHERE order_id=target_source)
   OR EXISTS(SELECT 1 FROM public.expert_residency_provider_operations op WHERE op.order_id=target_source AND
    (op.operation_kind<>'create_payment' OR op.status<>'claimed' OR op.provider_object_id IS NOT NULL OR op.parent_payment_id IS NOT NULL OR op.resolved_at IS NOT NULL OR op.reconciliation_claimed_at IS NOT NULL OR op.recovery_attempt<>0 OR op.recovery_lease_token IS NOT NULL OR op.manual_review_at IS NOT NULL
     OR NOT EXISTS(SELECT 1 FROM public.public_expert_payment_requests req WHERE req.legacy_operation_id=op.id AND req.legacy_source_id=op.order_id AND req.id=op.command_id AND req.request_digest=op.request_digest AND req.idempotency_key=op.idempotency_key)))
   OR EXISTS(SELECT 1 FROM public.expert_residency_payment_attempts pa WHERE pa.order_id=target_source AND
    (pa.status<>'created' OR pa.resolved_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.expert_residency_provider_operations op WHERE op.payment_attempt_id=pa.id AND op.order_id=target_source AND pa.provider_request_id='command:'||op.command_id::text))) THEN RETURN false; END IF;
 ELSE
  PERFORM 1 FROM public.expert_onboarding_payment_operations WHERE invoice_id=target_source FOR UPDATE;
  PERFORM 1 FROM public.expert_sales_provider_requests WHERE invoice_id=target_source ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.expert_onboarding_payment_operations WHERE invoice_id=target_source AND(status<>'created' OR provider_object_id IS NOT NULL))
   OR EXISTS(SELECT 1 FROM public.expert_sales_provider_requests req WHERE req.invoice_id=target_source AND(kind<>'create' OR status NOT IN('prepared','cancelled') OR dispatched_at IS NOT NULL OR provider_object_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.public_expert_payment_requests p WHERE p.id=req.id AND p.invoice_id=req.invoice_id AND p.idempotency_key=req.idempotency_key AND p.request_digest=req.request_digest)))
   OR EXISTS(SELECT 1 FROM public.expert_sales_provider_observations WHERE invoice_id=target_source)
   OR EXISTS(SELECT 1 FROM public.expert_onboarding_payment_facts WHERE invoice_id=target_source) THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $$;
-- Shared expiry predicate. Unknown/admitted provider outcomes preserve reservation.
-- It is a preflight only: the transition trigger rechecks under the same transaction.
CREATE FUNCTION early_bird_private.public_order_expiry_allowed(target_order uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.public_expert_payment_requests%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE legacy_source_id=target_order AND product='main' LIMIT 1;
 IF NOT FOUND THEN RETURN true; END IF;
 IF early_bird_private.public_never_sent(target_order,r.user_id) THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM public.public_expert_payment_requests current_request
  JOIN public.public_expert_payment_observations o ON o.id=current_request.apply_observation_id AND o.request_id=current_request.id
  WHERE current_request.legacy_source_id=target_order AND current_request.product='main' AND current_request.apply_action='release_terminal_unpaid'
   AND current_request.apply_xid=pg_current_xact_id() AND current_request.apply_login=session_user AND o.status='canceled'
   AND NOT EXISTS(SELECT 1 FROM public.public_expert_payment_resolutions conflict WHERE conflict.request_id=current_request.id AND conflict.kind='manual_reconciliation'));
END $$;
REVOKE ALL ON FUNCTION early_bird_private.public_order_expiry_allowed(uuid) FROM PUBLIC;
--> statement-breakpoint
-- Canonical terminating reversal may invalidate credit reserved by a DIFFERENT
-- public order. Derive that narrow authority from real source/allocation facts,
-- never from a canceled payment for the consuming order or a caller-selected delta.
CREATE FUNCTION early_bird_private.public_credit_reversal_source(qualifying_order uuid,consuming_order uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(
 SELECT 1 FROM public.expert_residency_orders source
 JOIN public.expert_first_residency_settlements marker ON marker.qualifying_order_id=source.id
 JOIN public.expert_residency_orders consuming ON consuming.id=consuming_order AND consuming.expert_id=marker.settlement_inviter_expert_id AND consuming.status IN('payment_pending','failed')
 JOIN public.expert_residency_provider_event_inbox reversal ON reversal.order_id=source.id AND reversal.payment_id=source.provider_payment_id AND reversal.currency=source.currency
 WHERE source.id=qualifying_order AND source.id<>consuming.id AND source.status='settled'
  AND marker.eligibility='cancelled_by_refund' AND marker.reason_code='terminating_provider_reversal'
  -- xmin is the actual physical writing transaction, not a caller-set context.
  -- Compare the low32 bits of xid8 so ordinary transaction-ID wrap is supported.
  AND marker.xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)
  AND reversal.xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)
  AND reversal.status='processing' AND reversal.event_kind IN('refunded','charged_back') AND reversal.authenticated AND reversal.identity_version=1
  AND reversal.verification_id IS NOT NULL AND reversal.verifier_key_version IS NOT NULL AND reversal.verified_at IS NOT NULL
  AND reversal.amount_minor>0 AND reversal.amount_minor+coalesce((SELECT sum(prior.amount_minor) FROM public.expert_residency_provider_event_inbox prior WHERE prior.provider=reversal.provider AND prior.payment_id=reversal.payment_id AND prior.status='processed' AND prior.event_kind IN('refunded','charged_back')),0)<=source.cash_minor
  AND(reversal.event_kind='charged_back' OR reversal.amount_minor+coalesce((SELECT sum(prior.amount_minor) FROM public.expert_residency_provider_event_inbox prior WHERE prior.provider=reversal.provider AND prior.payment_id=reversal.payment_id AND prior.status='processed' AND prior.event_kind IN('refunded','charged_back')),0)=source.cash_minor)
  AND EXISTS(SELECT 1 FROM public.expert_residency_payment_attempts original WHERE original.id=marker.qualifying_payment_attempt_id AND original.order_id=source.id AND original.provider=reversal.provider AND original.provider_request_id=reversal.payment_id AND original.status='settled')
  -- Public A needs its own real refund apply context. Legacy A retains its
  -- existing trusted branded-inbox authority; neither borrows B's request.
  AND(NOT EXISTS(SELECT 1 FROM public.public_expert_payment_requests r WHERE r.legacy_source_id=source.id)
   OR EXISTS(SELECT 1 FROM public.public_expert_payment_requests r
    JOIN public.public_expert_payment_observations fact ON fact.id=r.apply_observation_id AND fact.request_id=r.id
    JOIN public.public_expert_payment_resolutions attempt ON attempt.request_id=r.id AND attempt.kind='apply_attempt' AND attempt.apply_attempt_id=r.apply_attempt_id AND attempt.observation_id=fact.id AND attempt.action='main_refund'
    WHERE r.legacy_source_id=source.id AND r.product='refund' AND r.apply_action='main_refund' AND r.apply_xid=pg_current_xact_id() AND r.apply_login=session_user
     AND fact.status='succeeded' AND r.parent_payment_id=reversal.payment_id AND fact.amount_minor=reversal.amount_minor
     AND reversal.external_event_id='public:'||r.id::text||':'||fact.id::text AND reversal.payload_digest=substring(fact.evidence_digest FROM 8)
     AND NOT EXISTS(SELECT 1 FROM public.public_expert_payment_resolutions conflict WHERE conflict.request_id=r.id AND conflict.kind='manual_reconciliation')))
  AND EXISTS(SELECT 1 FROM public.expert_referral_ledger_entries reservation
   JOIN public.expert_referral_ledger_allocations allocation ON allocation.ledger_entry_id=reservation.id AND allocation.expert_id=consuming.expert_id
   JOIN public.expert_referral_reward_grants grant_row ON grant_row.id=allocation.reward_grant_id AND grant_row.expert_id=consuming.expert_id
   WHERE reservation.order_id=consuming.id AND reservation.expert_id=consuming.expert_id AND reservation.entry_kind='reservation'
    AND(grant_row.first_settlement_id=marker.id OR EXISTS(SELECT 1 FROM public.expert_referral_ledger_entries benefit
     JOIN public.expert_referral_ledger_allocations replenishment ON replenishment.ledger_entry_id=benefit.id AND replenishment.reward_grant_id=grant_row.id AND replenishment.expert_id=consuming.expert_id
     WHERE benefit.entry_kind='debt_repayment' AND benefit.source_id=marker.id AND benefit.source_type IN('first_settlement','held_reward_replay') AND benefit.expert_id=consuming.expert_id AND replenishment.amount_minor>0)))
 )
$$;
REVOKE ALL ON FUNCTION early_bird_private.public_credit_reversal_source(uuid,uuid) FROM PUBLIC;
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
  IF ROW(NEW.status,NEW.settled_at,NEW.provider_payment_id,NEW.residency_starts_at,NEW.residency_ends_at) IS NOT DISTINCT FROM ROW(OLD.status,OLD.settled_at,OLD.provider_payment_id,OLD.residency_starts_at,OLD.residency_ends_at) THEN RETURN NEW; END IF;
  source:=NEW.id; expected_action:=CASE WHEN NEW.status='settled' THEN 'main_settle' WHEN NEW.status IN('refunded','charged_back') THEN 'main_refund' ELSE 'release_terminal_unpaid' END;
 ELSIF TG_TABLE_NAME='expert_referral_ledger_entries' THEN
  IF NEW.order_id IS NULL OR NEW.entry_kind NOT IN('release','spend','reversal') THEN RETURN NEW; END IF; source:=NEW.order_id;
 ELSIF TG_TABLE_NAME='expert_residency_provider_event_inbox' THEN
  IF NEW.order_id IS NULL THEN RETURN NEW; END IF; source:=NEW.order_id;
 END IF;
 SELECT * INTO owner_request FROM public.public_expert_payment_requests WHERE legacy_source_id=source LIMIT 1;
 IF NOT FOUND THEN RETURN NEW; END IF;
 -- Derivative credit invalidation is distinct from unpaid expiry. Require the
 -- exact original reservation inverse and canonical deterministic release key.
 IF TG_TABLE_NAME='expert_referral_ledger_entries' AND row_data->>'entry_kind'='release' AND row_data->>'source_type'='provider_reversal' THEN
  SELECT EXISTS(SELECT 1 FROM public.expert_referral_ledger_entries original
   JOIN public.expert_first_residency_settlements marker ON marker.qualifying_order_id=(row_data->>'source_id')::uuid
   WHERE original.id=(row_data->>'original_entry_id')::uuid AND original.order_id=source AND original.entry_kind='reservation' AND original.expert_id=(row_data->>'expert_id')::uuid
    AND(row_data->>'amount_minor')::bigint>0 AND(row_data->>'amount_minor')::bigint=-original.amount_minor-coalesce((SELECT sum(released.amount_minor) FROM public.expert_referral_ledger_entries released WHERE released.original_entry_id=original.id AND released.entry_kind='release'),0)
    AND(row_data->>'idempotency_key'='refund-release:'||marker.id::text||':'||original.id::text OR row_data->>'idempotency_key'='refund-release:'||marker.id::text||':'||original.id::text||':remainder:'||(row_data->>'amount_minor'))
    AND early_bird_private.public_credit_reversal_source(marker.qualifying_order_id,source)) INTO allowed;
  IF allowed THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='expert_residency_orders' AND row_data->>'status'='failed' AND to_jsonb(OLD)->>'status'='payment_pending'
  AND(row_data-ARRAY['status','updated_at'])=(to_jsonb(OLD)-ARRAY['status','updated_at']) THEN
  SELECT EXISTS(SELECT 1 FROM public.expert_referral_ledger_entries released
   WHERE released.order_id=source AND released.expert_id=(row_data->>'expert_id')::uuid AND released.entry_kind='release' AND released.source_type='provider_reversal'
    AND released.xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)
    AND early_bird_private.public_credit_reversal_source(released.source_id,source))
   AND NOT EXISTS(SELECT 1 FROM public.expert_referral_ledger_entries original WHERE original.order_id=source AND original.entry_kind='reservation'
    AND -original.amount_minor<>(SELECT coalesce(sum(released.amount_minor),0) FROM public.expert_referral_ledger_entries released WHERE released.original_entry_id=original.id AND released.entry_kind='release'))
   AND NOT EXISTS(SELECT 1 FROM public.expert_referral_ledger_entries spent WHERE spent.order_id=source AND spent.entry_kind='spend') INTO allowed;
  IF allowed THEN RETURN NEW; END IF;
 END IF;
 -- Local expiry has no provider observation: abandon only a positively proven never-sent cohort.
 IF (TG_TABLE_NAME='expert_residency_orders' AND row_data->>'status'='expired' AND to_jsonb(OLD)->>'status'='payment_pending'
     AND (row_data->>'payment_deadline')::timestamptz<=public.early_bird_current_time())
 OR (TG_TABLE_NAME='expert_onboarding_invoices' AND row_data->>'status'='cancelled' AND to_jsonb(OLD)->>'status'='pending'
     AND EXISTS(SELECT 1 FROM public.expert_sales_fee_attempts WHERE invoice_id=source AND expires_at<=public.early_bird_current_time())) THEN
  IF early_bird_private.public_never_sent(source,owner_request.user_id) THEN
   UPDATE public.public_expert_payment_requests SET state='abandoned' WHERE legacy_source_id=source AND state='prepared';
   RETURN NEW;
  END IF;
 ELSIF TG_TABLE_NAME='expert_referral_ledger_entries' AND row_data->>'entry_kind'='release'
   AND EXISTS(SELECT 1 FROM public.expert_residency_orders WHERE id=source AND status='expired')
   AND NOT EXISTS(SELECT 1 FROM public.public_expert_payment_requests WHERE legacy_source_id=source AND state<>'abandoned') THEN
  IF early_bird_private.public_never_sent(source,owner_request.user_id) THEN RETURN NEW; END IF;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.public_expert_payment_requests r JOIN public.public_expert_payment_observations o ON o.id=r.apply_observation_id AND o.request_id=r.id
  JOIN public.public_expert_payment_resolutions a ON a.request_id=r.id AND a.kind='apply_attempt' AND a.apply_attempt_id=r.apply_attempt_id AND a.observation_id=o.id
  WHERE r.legacy_source_id=source AND r.apply_xid=pg_current_xact_id() AND r.apply_login=session_user
   AND(expected_action IS NULL OR r.apply_action=expected_action)
   AND(a.action=r.apply_action) AND NOT EXISTS(SELECT 1 FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind='manual_reconciliation')
   AND(CASE TG_TABLE_NAME
    WHEN 'expert_onboarding_payment_facts' THEN row_data->>'provider_object_id'=r.provider_object_id AND row_data->>'operation_id'=r.legacy_operation_id::text AND row_data->>'user_id'=r.user_id::text AND row_data->>'amount_minor'=r.amount_minor::text AND(row_data->>'captured_at')::timestamptz=o.provider_captured_at AND row_data->>'provider_mode'=r.mode
    WHEN 'expert_residency_orders' THEN CASE WHEN expected_action='main_settle' THEN row_data->>'provider_payment_id'=r.provider_object_id AND(row_data->>'settled_at')::timestamptz=o.provider_captured_at AND(row_data->>'residency_starts_at')::timestamptz=r.apply_expected_start AND(row_data->>'residency_ends_at')::timestamptz=r.apply_expected_end ELSE true END
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
DECLARE r public.public_expert_payment_requests%ROWTYPE; o public.public_expert_payment_observations%ROWTYPE; a public.public_expert_payment_resolutions%ROWTYPE; legacy_id text; committed_onboarding boolean;
BEGIN
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request FOR UPDATE;
 SELECT * INTO a FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind='apply_attempt' AND apply_attempt_id=target_attempt;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO o FROM public.public_expert_payment_observations WHERE id=a.observation_id;
 IF EXISTS(SELECT 1 FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind='applied' AND apply_attempt_id=target_attempt) THEN RETURN early_bird_private.public_apply_result(r,o,'already_applied',a.action,target_attempt); END IF;
 IF NOT early_bird_private.public_source_valid(r,false) THEN RETURN early_bird_private.public_apply_result(r,o,'not_ready',NULL,NULL); END IF;
 -- A sibling request may already have posted this same held parent. Inspect its
 -- immutable committed fact before requesting another financial transaction.
 -- Preserve the original current-top-level-transaction refusal unconditionally.
 IF r.apply_xid=pg_current_xact_id() THEN RETURN early_bird_private.public_apply_result(r,o,'not_ready',NULL,NULL); END IF;
 -- Reuse the full origin proof, including its top-level XID and immutable
 -- event/digest provenance; do not infer commitment from a tuple's subxid.
 committed_onboarding:=a.action='onboarding_settle' AND EXISTS(SELECT 1 FROM public.public_expert_payment_requests original
  JOIN public.public_expert_payment_observations origin ON origin.id=original.apply_observation_id AND origin.request_id=original.id
  WHERE original.invoice_id=r.invoice_id AND early_bird_private.public_onboarding_committed_matches(original,origin));
 IF (r.apply_attempt_id IS DISTINCT FROM target_attempt OR r.apply_xid IS NULL) AND NOT committed_onboarding THEN RETURN early_bird_private.public_apply_result(r,o,'not_ready',NULL,NULL); END IF;
 IF a.action='onboarding_settle' THEN
  SELECT f.invoice_id::text INTO legacy_id FROM public.expert_onboarding_payment_facts f JOIN public.expert_onboarding_invoices i ON i.id=f.invoice_id AND i.status='settled'
  JOIN public.expert_onboarding_payment_operations op ON op.id=f.operation_id AND op.status='succeeded'
  WHERE f.invoice_id=r.invoice_id AND f.operation_id=r.legacy_operation_id AND f.user_id=r.user_id AND f.provider_object_id=r.provider_object_id AND f.provider_mode=r.mode AND f.amount_minor=r.amount_minor AND f.currency=r.currency AND f.captured_at=o.provider_captured_at AND early_bird_private.public_onboarding_committed_matches(r,o);
 ELSIF a.action IN('main_settle','main_refund') THEN
  SELECT e.id::text INTO legacy_id FROM public.expert_residency_provider_event_inbox e JOIN public.expert_residency_orders ord ON ord.id=e.order_id
  WHERE e.external_event_id='public:'||r.id::text||':'||o.id::text AND e.provider='yookassa' AND e.order_id=r.order_id AND e.amount_minor=r.amount_minor AND e.currency=r.currency AND e.payload_digest=substring(o.evidence_digest FROM 8) AND e.status='processed'
   AND e.payment_id=CASE WHEN r.product='refund' THEN r.parent_payment_id ELSE r.provider_object_id END
   AND((a.action='main_settle' AND e.event_kind='settled' AND ord.status='settled' AND ord.provider_payment_id=r.provider_object_id AND ord.settled_at=o.provider_captured_at AND e.occurred_at=o.provider_captured_at AND ord.residency_starts_at=r.apply_expected_start AND ord.residency_ends_at=r.apply_expected_end AND ord.residency_ends_at=ord.residency_starts_at+make_interval(secs=>ord.duration_seconds))
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
  IF EXISTS(SELECT 1 FROM public.public_expert_payment_requests WHERE contact_id=NEW.id)
   AND NOT EXISTS(SELECT 1 FROM public.early_bird_gateway_contact_state WHERE contact_id=NEW.id AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'public_contact_ack_required'; END IF;
  UPDATE public.public_expert_payment_requests SET encrypted_body=NULL,key_reference=NULL WHERE contact_id=NEW.id AND encrypted_body IS NOT NULL;
  -- Onboarding keeps genuine legacy request evidence, but no retained receipt copy after ACK.
  UPDATE public.expert_sales_provider_requests SET encrypted_body=NULL,key_reference=NULL WHERE contact_id=NEW.id AND encrypted_body IS NOT NULL;
  -- Public main creates no replay copy. Existing authorized refund/main operations may already have one.
  UPDATE public.expert_residency_provider_operations op SET replay_ciphertext=NULL,replay_key_reference=NULL,replay_body_version=NULL,recovery_expires_at=NULL
   WHERE replay_ciphertext IS NOT NULL AND EXISTS(SELECT 1 FROM public.public_expert_payment_requests req WHERE req.contact_id=NEW.id AND req.legacy_operation_id=op.id AND req.product IN('main','refund'));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_contact_cleanup AFTER UPDATE ON payer_receipt_contacts FOR EACH ROW EXECUTE FUNCTION early_bird_private.public_contact_cleanup();
-- Read-only source projection. It confers no prepare/admit/bind/financial authority.
-- Encrypting a receipt needs its exact vault AAD; plaintext never enters this projection.
CREATE FUNCTION early_bird_private.public_source_data(product_name text,target_user uuid,target_source uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_source_id uuid; v_operation_id uuid; v_quote_id uuid; v_expert_id uuid; v_mode_name text; v_amount_value bigint; v_parent_id text;
 v_idempotency uuid; v_digest text; v_deadline timestamptz; v_provider_until timestamptz; v_current_frame boolean; v_contact public.payer_receipt_contacts%ROWTYPE; v_requests jsonb;
BEGIN
 IF target_user IS NULL OR target_source IS NULL THEN RETURN NULL; END IF;
 IF product_name='onboarding' THEN
  SELECT i.id,op.id,b.quote_id,i.provider_mode,i.amount_minor,op.provider_object_id,a.expires_at,a.expires_at
   INTO v_source_id,v_operation_id,v_quote_id,v_mode_name,v_amount_value,v_parent_id,v_deadline,v_provider_until
   FROM public.expert_onboarding_invoices i
   JOIN public.expert_onboarding_payment_operations op ON op.invoice_id=i.id AND op.user_id=i.user_id
   JOIN public.expert_sales_fee_attempts a ON a.invoice_id=i.id AND a.user_id=i.user_id
   LEFT JOIN public.expert_sales_form_bridges b ON b.application_id=i.application_id AND b.user_id=i.user_id
   WHERE i.id=target_source AND i.user_id=target_user AND i.amount_minor=op.amount_minor AND i.provider_mode=op.provider_mode AND i.currency='RUB' AND op.currency='RUB';
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_current_frame:=early_bird_private.public_onboarding_current(v_source_id,target_user);
 ELSE
  IF product_name='refund' THEN
   SELECT o.id,op.id,m.quote_id,o.expert_id,m.provider_mode,op.amount_minor,op.parent_payment_id,op.idempotency_key,op.request_digest,o.payment_deadline,o.provider_deadline
    INTO v_source_id,v_operation_id,v_quote_id,v_expert_id,v_mode_name,v_amount_value,v_parent_id,v_idempotency,v_digest,v_deadline,v_provider_until
    FROM public.expert_residency_provider_operations op
    JOIN public.expert_residency_orders o ON o.id=op.order_id
    JOIN public.experts e ON e.id=o.expert_id AND e.user_id=target_user
    JOIN public.expert_card_main_orders m ON m.order_id=o.id AND m.user_id=e.user_id
    WHERE op.id=target_source AND op.operation_kind='create_refund' AND op.provider='yookassa' AND op.environment_mode=m.provider_mode;
  ELSIF product_name='main' THEN
   SELECT o.id,m.quote_id,o.expert_id,m.provider_mode,o.cash_minor,o.payment_deadline,o.provider_deadline
    INTO v_source_id,v_quote_id,v_expert_id,v_mode_name,v_amount_value,v_deadline,v_provider_until
    FROM public.expert_residency_orders o JOIN public.experts e ON e.id=o.expert_id AND e.user_id=target_user
    JOIN public.expert_card_main_orders m ON m.order_id=o.id AND m.user_id=e.user_id
    JOIN public.expert_card_main_acceptances a ON a.id=m.acceptance_id AND a.user_id=m.user_id AND a.quote_id=m.quote_id
    WHERE o.id=target_source AND o.currency='RUB';
  ELSE RETURN NULL;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_current_frame:=EXISTS(SELECT 1 FROM public.users WHERE id=target_user AND active);
 END IF;
 IF v_amount_value<=0 OR v_mode_name NOT IN('test','live') THEN RETURN NULL; END IF;
 SELECT c.* INTO v_contact FROM public.payer_receipt_contacts c
  WHERE c.user_id=target_user AND c.quote_id=v_quote_id AND c.redacted_at IS NULL AND c.ciphertext IS NOT NULL
   AND c.expires_at>public.early_bird_current_time()
   AND NOT EXISTS(SELECT 1 FROM public.receipt_revocation_outbox WHERE contact_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM public.early_bird_gateway_contact_state WHERE contact_id=c.id AND revoked_at IS NOT NULL)
   AND (product_name='onboarding' OR EXISTS(SELECT 1 FROM public.payer_receipt_order_bindings b WHERE b.order_id=v_source_id AND b.contact_id=c.id AND b.quote_id=c.quote_id AND b.user_id=c.user_id))
  ORDER BY c.captured_at DESC,c.id DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(early_bird_private.public_snapshot(r) ORDER BY r.created_at,r.id),'[]'::jsonb) INTO v_requests
  FROM public.public_expert_payment_requests r WHERE r.product=product_name AND r.user_id=target_user AND
  CASE WHEN product_name='refund' THEN r.legacy_operation_id=target_source ELSE r.legacy_source_id=v_source_id END;
 RETURN jsonb_build_object('version',1,'product',product_name,'userId',target_user,'sourceId',v_source_id,'operationId',v_operation_id,'expertId',v_expert_id,'mode',v_mode_name,'amountMinor',v_amount_value::text,'currency','RUB','parentPaymentId',v_parent_id,'idempotencyKey',v_idempotency,'requestDigest',v_digest,'paymentDeadline',early_bird_private.public_time(v_deadline),'providerDeadline',early_bird_private.public_time(v_provider_until),'current',v_current_frame,'contact',
  CASE WHEN v_contact.id IS NULL THEN NULL ELSE jsonb_build_object('binding',jsonb_build_object('id',v_contact.id,'quoteId',v_contact.quote_id,'userId',v_contact.user_id,'kind',v_contact.kind,'basis',v_contact.basis,'capturedAt',early_bird_private.public_time(v_contact.captured_at),'expiresAt',early_bird_private.public_time(v_contact.expires_at)),'keyId',v_contact.key_id,'ciphertext',v_contact.ciphertext) END,'requests',v_requests);
END $$;
CREATE FUNCTION early_bird_private.public_onboarding_source(target_user uuid,target_source uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_source_data('onboarding',target_user,target_source)
$$;
CREATE FUNCTION early_bird_private.public_main_source(target_user uuid,target_source uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_source_data('main',target_user,target_source)
$$;
CREATE FUNCTION early_bird_private.public_refund_source(target_user uuid,target_source uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_source_data('refund',target_user,target_source)
$$;
-- Internal held-checkout API accepts an invoice created by the manager command, not a UI user/amount.
CREATE FUNCTION early_bird_private.public_onboarding_invoice(target_invoice uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT early_bird_private.public_source_data('onboarding',i.user_id,i.id) FROM public.expert_onboarding_invoices i
 WHERE i.id=target_invoice AND EXISTS(SELECT 1 FROM public.expert_sales_fee_attempts a WHERE a.invoice_id=i.id AND a.user_id=i.user_id)
$$;
CREATE FUNCTION early_bird_private.public_onboarding_pending(batch_limit integer,after_invoice uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM (
  SELECT DISTINCT invoice_id id FROM public.public_expert_payment_requests r WHERE r.product='onboarding'
   AND r.state IN('admitted','uncertain','bound') AND (after_invoice IS NULL OR r.invoice_id>after_invoice)
  ORDER BY invoice_id LIMIT least(50,greatest(1,batch_limit))
 ) candidates
$$;

-- Bounded recovery discovery discloses identifiers only. It cannot admit a send,
-- manufacture a provider fact, or post financial state. UUID cursors rotate past
-- unresolved records; a missing webhook never requires replaying a POST.
CREATE FUNCTION early_bird_private.public_payment_pending(batch_limit integer,after_request uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM (
  SELECT r.id FROM public.public_expert_payment_requests r
  WHERE r.state IN('uncertain','bound') AND (after_request IS NULL OR r.id>after_request)
   AND NOT EXISTS(SELECT 1 FROM public.public_expert_payment_resolutions done WHERE done.request_id=r.id AND done.kind IN('applied','manual_reconciliation'))
  ORDER BY r.id LIMIT least(10,greatest(1,batch_limit))
 ) candidates
$$;
CREATE FUNCTION early_bird_private.public_payment_hint(object_id text,operation_hint uuid,is_refund boolean) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM (
  SELECT r.id FROM public.public_expert_payment_requests r
  WHERE (r.product='refund')=is_refund AND (r.provider_object_id=object_id OR r.legacy_operation_id=operation_hint)
  ORDER BY r.id LIMIT 4
 ) candidates
$$;
-- Only previously authorized, claimed refund commands in a genuine public main
-- cohort are offered to the refund sender. Source/prepare/admit recheck every fact.
CREATE FUNCTION early_bird_private.public_refund_pending(batch_limit integer,after_operation uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'operationId',id) ORDER BY id),'[]'::jsonb) FROM (
  SELECT op.id,e.user_id FROM public.expert_residency_provider_operations op JOIN public.expert_residency_orders o ON o.id=op.order_id JOIN public.experts e ON e.id=o.expert_id
  WHERE op.operation_kind='create_refund' AND op.status='claimed' AND op.provider_object_id IS NULL
   AND (after_operation IS NULL OR op.id>after_operation)
   AND EXISTS(SELECT 1 FROM public.public_expert_payment_requests main WHERE main.order_id=o.id AND main.product='main')
   AND NOT EXISTS(SELECT 1 FROM public.public_expert_payment_requests sent WHERE sent.legacy_operation_id=op.id AND sent.state<>'prepared')
  ORDER BY op.id LIMIT least(10,greatest(1,batch_limit))
 ) commands
$$;
-- Revoke every new capability and helper, including the trusted-processor guard.
-- Task6 provisions exact external LOGIN mappings; this migration guesses no role.
DO $$ DECLARE fn record; BEGIN
 FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='early_bird_private' AND p.proname LIKE 'public_%') OR(n.nspname='public' AND p.proname='public_expert_gateway_claim') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn.signature);
 END LOOP;
END $$;

--> statement-breakpoint
-- Public continuation reuses genuine paid wave onboarding, never a fabricated fee invoice.
CREATE FUNCTION early_bird_private.public_wave_application(target_user uuid) RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(public.early_bird_paid_workspace(target_user),(
 SELECT b.application_id FROM public.early_bird_deferred_accounts i
 JOIN public.early_bird_deferred_invoices ob ON ob.account_id=i.id AND ob.user_id=i.user_id AND ob.stage='onboarding' AND ob.amount_minor=i.onboarding_minor AND ob.captured_at IS NOT NULL
 JOIN public.early_bird_deferred_verified_bindings paid ON paid.invoice_id=ob.id AND paid.user_id=ob.user_id AND paid.provider_id=ob.provider_id AND paid.amount_minor=ob.amount_minor AND paid.evidence_digest=ob.evidence_digest
 JOIN public.early_bird_choices current_choice ON current_choice.id=i.choice_id AND current_choice.user_id=i.user_id
 JOIN public.early_bird_choices approved_choice ON approved_choice.base_id=current_choice.base_id AND approved_choice.user_id=current_choice.user_id
 JOIN public.early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
 JOIN public.expert_onboarding_applications app ON app.id=b.application_id AND app.user_id=b.user_id AND app.verification_status='approved' AND app.archived_at IS NULL AND app.archive_until_date IS NULL
 JOIN public.users u ON u.id=i.user_id AND u.active
 WHERE i.user_id=target_user AND public.early_bird_final_call_refund_free(i.id)
 AND NOT EXISTS(SELECT 1 FROM public.early_bird_coverage_reconciliation WHERE user_id=i.user_id)
 AND NOT EXISTS(SELECT 1 FROM public.early_bird_refund_reconciliation WHERE user_id=i.user_id)
 AND EXISTS(SELECT 1 FROM public.residents_applications f
  JOIN public.expert_verification_decisions d ON d.application_id=b.application_id AND d.user_id=b.user_id AND d.decision='approved'
  JOIN public.resident_review_events re ON re.attempt_id=f.id AND re.manager_id=d.manager_id AND re.session_hash=d.manager_session_hash AND re.action=f.status AND re.action IN('APPROVED_BASIC','APPROVED_EXCLUSIVE')
  WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(public.digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
 ORDER BY i.id LIMIT 1))
 WHERE EXISTS(SELECT 1 FROM public.early_bird_launch_configs WHERE active AND client_start_at<=public.early_bird_current_time())
$$;
REVOKE ALL ON FUNCTION early_bird_private.public_wave_application(uuid) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION expert_card_activation_gate_valid(uuid,uuid) RENAME TO expert_card_activation_before_public_continuation;
CREATE FUNCTION expert_card_activation_gate_valid(target_user uuid,target_review uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE d expert_card_drafts%ROWTYPE; r expert_card_reviews%ROWTYPE; v resident_card_versions%ROWTYPE; assessment jsonb; helper oid; wave_application uuid;
BEGIN
 IF expert_card_activation_before_public_continuation(target_user,target_review) THEN RETURN true; END IF;
 -- Resolve optional private capabilities only after schema permission succeeds.
 IF NOT has_schema_privilege(current_user,'early_bird_private','USAGE') THEN RETURN false; END IF;
 helper:=to_regprocedure('early_bird_private.public_wave_application(uuid)');
 IF helper IS NULL THEN RETURN false; END IF;
 IF NOT has_function_privilege(current_user,helper,'EXECUTE') THEN RETURN false; END IF;
 EXECUTE 'SELECT early_bird_private.public_wave_application($1)' INTO wave_application USING target_user;
 SELECT * INTO d FROM expert_card_drafts WHERE user_id=target_user AND approved_review_id=target_review AND status='approved';
 IF NOT FOUND OR d.application_id IS DISTINCT FROM wave_application
  OR NOT expert_card_current_messaging_authority(target_user,d.messaging_policy_version)
  OR NOT EXISTS(SELECT 1 FROM users WHERE id=target_user AND active)
  OR NOT EXISTS(SELECT 1 FROM channel_identities WHERE user_id=target_user AND provider='telegram' AND bot_key=d.work_bot_key AND external_id=d.work_chat_id AND external_chat_id=d.work_chat_id AND status='active') THEN RETURN false; END IF;
 SELECT * INTO r FROM expert_card_reviews WHERE id=target_review AND draft_id=d.id AND user_id=target_user AND action='approve' AND revision=d.revision AND public_payload=d.public_payload;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO v FROM resident_card_versions WHERE review_id=r.id AND draft_id=d.id AND revision=r.revision;
 IF FOUND THEN assessment:=resident_safety_assess(v.safety_fields,v.revision); RETURN NOT (assessment->>'blocked')::boolean AND assessment=v.safety_proof; END IF;
 assessment:=resident_safety_assess(resident_card_effective_fields(d.id),r.revision);
 RETURN r.safety_proof IS NOT NULL AND NOT (assessment->>'blocked')::boolean AND assessment=r.safety_proof;
END $$;
--> statement-breakpoint
-- Current coverage may bridge only an interval covering this instant, never a
-- disconnected future wave interval. Definer lookup keeps source tables private.
CREATE FUNCTION early_bird_private.public_current_wave_end(target_expert uuid) RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT greatest((SELECT max(c.ends_at) FROM public.early_bird_effective_coverages c JOIN public.experts e ON e.user_id=c.user_id WHERE e.id=target_expert AND c.starts_at<=clock_timestamp() AND c.ends_at>clock_timestamp()),
 (SELECT max(c.ends_at) FROM public.early_bird_deferred_effective_coverages c JOIN public.experts e ON e.user_id=c.user_id WHERE e.id=target_expert AND c.starts_at<=clock_timestamp() AND c.ends_at>clock_timestamp()))
$$;
REVOKE ALL ON FUNCTION early_bird_private.public_current_wave_end(uuid) FROM PUBLIC;
--> statement-breakpoint
-- A queued public continuation can join currently active wave coverage. The returned
-- source is always an actual settled main order; wave history itself stays immutable.
CREATE OR REPLACE FUNCTION expert_residency_current_coverage(target_expert uuid) RETURNS TABLE(source_order_id uuid,ends_at timestamptz) LANGUAGE plpgsql VOLATILE AS $$
DECLARE helper oid;
BEGIN
 IF has_schema_privilege(current_user,'early_bird_private','USAGE') THEN
  helper:=to_regprocedure('early_bird_private.public_current_wave_end(uuid)');
  IF helper IS NOT NULL THEN
   IF has_function_privilege(current_user,helper,'EXECUTE') THEN
    -- Keep the authorized coverage query intact, including its clock/snapshot.
    RETURN QUERY EXECUTE $coverage$
     WITH RECURSIVE instant AS MATERIALIZED(SELECT clock_timestamp() AS at), chain AS (
      SELECT o.id,o.residency_ends_at FROM public.expert_residency_orders o,instant
      WHERE o.expert_id=$1 AND o.status='settled' AND o.residency_ends_at>instant.at AND
       (o.residency_starts_at<=instant.at OR o.residency_starts_at<=early_bird_private.public_current_wave_end($1))
      UNION
      SELECT o.id,o.residency_ends_at FROM public.expert_residency_orders o JOIN chain c ON o.residency_starts_at<=c.residency_ends_at AND o.residency_ends_at>c.residency_ends_at WHERE o.expert_id=$1 AND o.status='settled'
     ) SELECT id,residency_ends_at FROM chain ORDER BY residency_ends_at DESC,id LIMIT 1
    $coverage$ USING target_expert;
    RETURN;
   END IF;
  END IF;
 END IF;
 -- Genuine legacy coverage remains available without private schema/function rights.
 RETURN QUERY
 WITH RECURSIVE instant AS MATERIALIZED(SELECT clock_timestamp() AS at), chain AS (
  SELECT o.id,o.residency_ends_at FROM public.expert_residency_orders o,instant
  WHERE o.expert_id=target_expert AND o.status='settled' AND o.residency_starts_at<=instant.at AND o.residency_ends_at>instant.at
  UNION
  SELECT o.id,o.residency_ends_at FROM public.expert_residency_orders o JOIN chain c ON o.residency_starts_at<=c.residency_ends_at AND o.residency_ends_at>c.residency_ends_at WHERE o.expert_id=target_expert AND o.status='settled'
 ) SELECT id,residency_ends_at FROM chain ORDER BY residency_ends_at DESC,id LIMIT 1;
END
$$;

--> statement-breakpoint
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

 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['review_id','revision','public_digest','public_payload','updated_at','active','next_billing_date','paid_order_id','wave_intent_id'])=(to_jsonb(OLD)-ARRAY['review_id','revision','public_digest','public_payload','updated_at','active','next_billing_date','paid_order_id','wave_intent_id']) AND EXISTS(
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
   SELECT 1 FROM public.expert_residency_current_coverage(NEW.expert_id)))) THEN
  RAISE EXCEPTION 'expert_published_card_source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
-- A paid public continuation is a narrow exception to the resident legacy-price
-- gate. Every quote still passes the existing tariff/profile/arithmetic guards.
CREATE OR REPLACE FUNCTION resident_verification_price_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE helper oid; wave_application uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.rule_version='expert_separated_sales_v3' AND EXISTS(SELECT 1 FROM expert_sales_bases b WHERE b.user_id=NEW.user_id AND b.base_offer_shown_at=NEW.calculation_timestamp) THEN RETURN NEW; END IF;
 IF NEW.rule_version='expert_energy_start_v2' THEN
  IF has_schema_privilege(current_user,'early_bird_private','USAGE') THEN
   helper:=to_regprocedure('early_bird_private.public_wave_application(uuid)');
   IF helper IS NOT NULL THEN
    IF has_function_privilege(current_user,helper,'EXECUTE') THEN
     EXECUTE 'SELECT early_bird_private.public_wave_application($1)' INTO wave_application USING NEW.user_id;
     IF wave_application IS NOT NULL THEN
      IF EXISTS(SELECT 1 FROM expert_card_drafts d WHERE d.user_id=NEW.user_id AND d.application_id=wave_application AND d.status='approved' AND expert_card_activation_gate_valid(d.user_id,d.approved_review_id))
       AND EXISTS(SELECT 1 FROM expert_offer_profile_verifications v WHERE v.user_id=NEW.user_id AND v.profile_revision=(SELECT max(revision) FROM expert_offer_profiles WHERE user_id=NEW.user_id)) THEN RETURN NEW; END IF;
     END IF;
    END IF;
   END IF;
  END IF;
 END IF;
 IF NOT resident_verification_price_allowed(NEW.user_id) THEN RAISE EXCEPTION 'resident_verification_required'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
-- A separated-sales paid main quote is a new quote, not the original unpaid
-- form bridge. Preserve the unpaid authority and admit only the exact immutable
-- paid price plus current canonical card/acceptance. This authority is also used
-- for retention: only a real matching bound order may outlive quote expiry.
CREATE OR REPLACE FUNCTION expert_sales_receipt_authority(quote uuid,owner uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN expert_campaign_quotes q ON q.id=b.quote_id AND q.user_id=b.user_id AND q.rule_version='expert_separated_sales_v3' JOIN expert_sales_selections original ON original.id=b.selection_id JOIN expert_sales_bases base ON base.id=original.base_id AND base.user_id=b.user_id JOIN expert_onboarding_applications a ON a.id=b.application_id AND a.verification_status IN('pending','approved') JOIN users u ON u.id=b.user_id AND u.active WHERE b.quote_id=quote AND b.user_id=owner AND expert_sales_form_valid(b.application_id,b.user_id) AND expert_card_current_messaging_authority(b.user_id,base.consent_version) AND NOT EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=b.user_id))
 OR EXISTS(SELECT 1 FROM expert_campaign_quotes q
 JOIN expert_sales_paid_locks l ON l.invoice_id=q.paid_lock_invoice_id AND l.user_id=q.user_id AND l.selection_id=q.sales_selection_id AND l.final_locked_price=q.price_minor AND l.term_months=q.term_months
 JOIN expert_sales_selections selected ON selected.id=l.selection_id AND selected.user_id=q.user_id AND selected.selected_total_minor=q.price_minor AND selected.term_months=q.term_months
 JOIN expert_sales_bases base ON base.id=selected.base_id AND base.user_id=q.user_id AND base.tariff_version_id=q.tariff_version_id AND base.profile_revision=q.profile_revision
 JOIN expert_onboarding_invoices invoice ON invoice.id=l.invoice_id AND invoice.user_id=q.user_id AND invoice.purpose='onboarding' AND invoice.status='settled'
 JOIN expert_onboarding_payment_facts paid ON paid.invoice_id=invoice.id AND paid.user_id=invoice.user_id AND paid.admission='interview' AND paid.amount_minor=invoice.amount_minor AND paid.currency=invoice.currency AND paid.provider_mode=invoice.provider_mode
 JOIN expert_onboarding_applications app ON app.id=invoice.application_id AND app.user_id=q.user_id AND app.verification_status='approved' AND app.archived_at IS NULL AND app.archive_until_date IS NULL
 JOIN expert_sales_form_bridges bridge ON bridge.application_id=app.id AND bridge.user_id=q.user_id
 JOIN expert_sales_selections original ON original.id=bridge.selection_id AND original.user_id=q.user_id AND original.base_id=selected.base_id
 JOIN users u ON u.id=q.user_id AND u.active
 JOIN expert_card_drafts d ON d.application_id=app.id AND d.user_id=q.user_id AND d.status='approved'
 JOIN expert_card_reviews review ON review.id=d.approved_review_id AND review.draft_id=d.id AND review.user_id=d.user_id AND review.action='approve' AND review.revision=d.revision AND review.public_payload=d.public_payload
 JOIN expert_card_main_acceptances accepted ON accepted.quote_id=q.id AND accepted.user_id=q.user_id AND accepted.application_id=app.id AND accepted.review_id=review.id AND accepted.revision=d.revision AND accepted.public_digest=review.public_digest
 WHERE q.id=quote AND q.user_id=owner AND q.rule_version='expert_separated_sales_v3' AND q.quoted_at<=clock_timestamp()
 AND expert_card_current_messaging_authority(q.user_id,base.consent_version)
 AND expert_card_activation_gate_valid(q.user_id,accepted.review_id) AND expert_campaign_current_profile_valid(q.user_id,q.id)
 AND((q.expires_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM expert_residency_orders o WHERE o.campaign_quote_id=q.id))
  OR EXISTS(SELECT 1 FROM payer_receipt_order_bindings binding
   JOIN payer_receipt_contacts c ON c.id=binding.contact_id AND c.quote_id=binding.quote_id AND c.user_id=binding.user_id AND c.redacted_at IS NULL AND c.expires_at>clock_timestamp()
   JOIN expert_residency_orders o ON o.id=binding.order_id AND o.campaign_quote_id=q.id AND o.expert_id=accepted.expert_id
   JOIN experts e ON e.id=o.expert_id AND e.user_id=q.user_id
   JOIN expert_card_main_orders m ON m.order_id=o.id AND m.acceptance_id=accepted.id AND m.user_id=q.user_id AND m.quote_id=q.id AND m.expert_id=e.id AND m.purpose='main_residency'
   WHERE binding.quote_id=q.id AND binding.user_id=q.user_id)))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payer_receipt_redaction_due(contact payer_receipt_contacts) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM expert_campaign_quotes q WHERE q.id=contact.quote_id AND q.rule_version='expert_separated_sales_v3') THEN
  contact.expires_at<=clock_timestamp() OR NOT expert_sales_receipt_authority(contact.quote_id,contact.user_id)
  -- An unused contact must not borrow another contact's bound retention.
  OR(EXISTS(SELECT 1 FROM expert_campaign_quotes q JOIN expert_residency_orders o ON o.campaign_quote_id=q.id WHERE q.id=contact.quote_id AND q.paid_lock_invoice_id IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM payer_receipt_order_bindings binding
    JOIN expert_residency_orders o ON o.id=binding.order_id AND o.campaign_quote_id=binding.quote_id
    JOIN expert_card_main_orders m ON m.order_id=o.id AND m.quote_id=binding.quote_id AND m.user_id=binding.user_id AND m.expert_id=o.expert_id AND m.purpose='main_residency'
    JOIN experts e ON e.id=o.expert_id AND e.user_id=binding.user_id
    WHERE binding.contact_id=contact.id AND binding.quote_id=contact.quote_id AND binding.user_id=contact.user_id))
 ELSE payer_receipt_redaction_due_v2(contact) END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_payer_receipt_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.redacted_at IS NOT NULL OR NEW.captured_at>clock_timestamp()
   OR EXISTS(SELECT 1 FROM expert_campaign_quotes q WHERE q.id=NEW.quote_id AND q.rule_version='expert_separated_sales_v3' AND q.paid_lock_invoice_id IS NOT NULL
    AND(q.quoted_at>NEW.captured_at OR q.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM expert_residency_orders o WHERE o.campaign_quote_id=q.id)))
   OR(NOT expert_sales_receipt_authority(NEW.quote_id,NEW.user_id) AND NOT EXISTS(
    SELECT 1 FROM expert_campaign_quotes q JOIN users u ON u.id=q.user_id JOIN expert_residency_tariff_versions t ON t.id=q.tariff_version_id
    WHERE q.id=NEW.quote_id AND q.user_id=NEW.user_id AND u.active AND q.rule_version<>'expert_separated_sales_v3' AND q.quoted_at<=NEW.captured_at AND q.expires_at>clock_timestamp()
     AND t.active_from<=clock_timestamp() AND t.active_to>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM expert_residency_orders o WHERE o.campaign_quote_id=q.id))) THEN
   RAISE EXCEPTION 'payer_receipt_unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.redacted_at<=clock_timestamp() AND NEW.key_id IS NULL AND NEW.ciphertext IS NULL
  AND(to_jsonb(NEW)-ARRAY['key_id','ciphertext','redacted_at'])=(to_jsonb(OLD)-ARRAY['key_id','ciphertext','redacted_at']) AND payer_receipt_redaction_due(OLD) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'payer_receipt_immutable' USING ERRCODE='23514';
END $$;
