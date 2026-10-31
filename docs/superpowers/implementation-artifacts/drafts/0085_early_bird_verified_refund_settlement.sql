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
