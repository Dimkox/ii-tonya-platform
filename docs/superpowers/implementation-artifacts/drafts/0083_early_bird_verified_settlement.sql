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
