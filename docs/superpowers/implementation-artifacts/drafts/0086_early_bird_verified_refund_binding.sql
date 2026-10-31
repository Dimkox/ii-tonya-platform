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
