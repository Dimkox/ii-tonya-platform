-- A public terminal financial completion must also finish its exact legacy
-- delivery projection. No source/financial fact or dispatch authority changes.
CREATE FUNCTION early_bird_private.public_sync_sales_terminal(target_request uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.public_expert_payment_requests%ROWTYPE;
 a public.public_expert_payment_resolutions%ROWTYPE;
 o public.public_expert_payment_observations%ROWTYPE;
 legacy public.expert_sales_provider_requests%ROWTYPE;
 changed integer;
BEGIN
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request;
 IF NOT FOUND OR r.product<>'onboarding' THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
 SELECT * INTO r FROM public.public_expert_payment_requests WHERE id=target_request FOR UPDATE;
 IF r.product<>'onboarding' OR r.invoice_id IS NULL OR r.kind NOT IN('onboarding_create','onboarding_capture','onboarding_cancel')
  OR r.state NOT IN('bound','resolved') OR r.provider_object_id IS NULL THEN RETURN 0; END IF;
 SELECT * INTO a FROM public.public_expert_payment_resolutions WHERE request_id=r.id AND kind='applied';
 IF NOT FOUND OR a.provider_object_id<>r.provider_object_id OR a.payment_deadline<>r.payment_deadline
  OR a.legacy_fact_id IS DISTINCT FROM r.invoice_id::text
  OR NOT EXISTS(SELECT 1 FROM public.public_expert_payment_resolutions attempt
   WHERE attempt.request_id=r.id AND attempt.kind='apply_attempt' AND attempt.apply_attempt_id=a.apply_attempt_id
    AND attempt.observation_id=a.observation_id AND attempt.action=a.action AND attempt.provider_object_id=a.provider_object_id)
  OR EXISTS(SELECT 1 FROM public.public_expert_payment_resolutions conflict
   JOIN public.public_expert_payment_requests sibling ON sibling.id=conflict.request_id
   WHERE sibling.invoice_id=r.invoice_id AND conflict.kind='manual_reconciliation') THEN RETURN 0; END IF;
 SELECT * INTO o FROM public.public_expert_payment_observations WHERE id=a.observation_id AND request_id=r.id;
 IF NOT FOUND OR o.provider_object_id<>r.provider_object_id OR o.parent_payment_id IS DISTINCT FROM r.parent_payment_id
  OR o.amount_minor<>r.amount_minor OR o.currency<>r.currency OR o.mode<>r.mode
  OR o.provider_captured_at IS DISTINCT FROM a.captured_at
  OR o.identity IS DISTINCT FROM jsonb_build_object('purpose','onboarding','operationId',r.legacy_operation_id::text,'orderId',r.invoice_id::text,'userId',r.user_id::text)
  OR NOT early_bird_private.public_source_valid(r,false) THEN RETURN 0; END IF;
 -- Completion itself follows the committed canonical transaction. Do not infer
 -- commitment from a nested tuple xmin or caller-supplied session context.
 IF a.action='release_terminal_unpaid' THEN
  IF a.disposition<>'terminal_unpaid' OR o.status<>'canceled' OR o.paid IS DISTINCT FROM false OR o.provider_captured_at IS NOT NULL
   OR r.apply_attempt_id IS DISTINCT FROM a.apply_attempt_id OR r.apply_observation_id IS DISTINCT FROM o.id
   OR r.apply_action IS DISTINCT FROM a.action OR r.apply_xid IS NULL OR r.apply_xid=pg_current_xact_id()
   OR NOT pg_visible_in_snapshot(r.apply_xid,pg_current_snapshot())
   OR NOT EXISTS(SELECT 1 FROM public.expert_onboarding_invoices i
    JOIN public.expert_onboarding_payment_operations op ON op.invoice_id=i.id AND op.id=r.legacy_operation_id
    WHERE i.id=r.invoice_id AND i.user_id=r.user_id AND i.status='cancelled' AND op.status='cancelled'
     AND op.provider_object_id=r.provider_object_id)
   OR EXISTS(SELECT 1 FROM public.expert_onboarding_payment_facts WHERE invoice_id=r.invoice_id)
   OR EXISTS(SELECT 1 FROM public.public_expert_payment_observations paid
    JOIN public.public_expert_payment_requests sibling ON sibling.id=paid.request_id
    WHERE sibling.invoice_id=r.invoice_id AND paid.status='succeeded') THEN RETURN 0; END IF;
 ELSIF a.action='onboarding_settle' THEN
  IF a.disposition<>'eligible' OR NOT early_bird_private.public_onboarding_committed_matches(r,o) THEN RETURN 0; END IF;
 ELSE RETURN 0;
 END IF;
 SELECT * INTO legacy FROM public.expert_sales_provider_requests WHERE id=r.id FOR UPDATE;
 IF NOT FOUND OR legacy.status<>'dispatched' OR legacy.invoice_id<>r.invoice_id
  OR legacy.kind<>replace(r.kind,'onboarding_','') OR legacy.idempotency_key<>r.idempotency_key
  OR legacy.request_digest<>r.request_digest OR legacy.dispatched_at IS DISTINCT FROM r.dispatched_at
  OR (legacy.provider_object_id IS NOT NULL AND legacy.provider_object_id<>r.provider_object_id) THEN RETURN 0; END IF;
 -- An unknown sibling remains dispatched until its OWN applied marker exists.
 -- Preserve immutable source, body, key, digest and original dispatch instant.
 UPDATE public.expert_sales_provider_requests SET status=CASE WHEN legacy.kind='capture' AND o.status='canceled' THEN 'cancelled' ELSE 'observed' END,
  provider_object_id=coalesce(provider_object_id,r.provider_object_id) WHERE id=legacy.id AND status='dispatched';
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed;
END $$;
REVOKE ALL ON FUNCTION early_bird_private.public_sync_sales_terminal(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION early_bird_private.public_sync_sales_terminal_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- This AFTER INSERT runs before public_payment_complete changes bound→resolved.
 PERFORM early_bird_private.public_sync_sales_terminal(NEW.request_id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION early_bird_private.public_sync_sales_terminal_trigger() FROM PUBLIC;
CREATE TRIGGER public_sales_terminal_projection AFTER INSERT ON public_expert_payment_resolutions
 FOR EACH ROW WHEN(NEW.kind='applied') EXECUTE FUNCTION early_bird_private.public_sync_sales_terminal_trigger();
--> statement-breakpoint
-- Repair actual old committed outcomes under the same locks and exact proof.
-- No legacy-only request or merely observed/pending public request qualifies.
DO $$ DECLARE candidate record; BEGIN
 FOR candidate IN SELECT r.user_id,r.id FROM public.public_expert_payment_requests r
  JOIN public.public_expert_payment_resolutions a ON a.request_id=r.id AND a.kind='applied'
  WHERE r.product='onboarding' ORDER BY r.user_id,r.id
 LOOP PERFORM early_bird_private.public_sync_sales_terminal(candidate.id); END LOOP;
END $$;
