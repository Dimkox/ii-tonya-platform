-- DRAFT ONLY. Provision a dedicated read-only role separately; no PUBLIC access.
CREATE FUNCTION early_bird_private.find_verified_payment(target_kind text,target_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF target_kind NOT IN ('invoice','provider','operation') OR target_id IS NULL THEN RAISE EXCEPTION 'early_bird_verified_reader_invalid'; END IF;
 SELECT jsonb_build_object('invoiceId',i.invoice_id::text,'userId',i.user_id::text,'operationId',i.id::text,'providerObjectId',b.provider_object_id,'pricingPolicy',i.pricing_policy,'priceKind',i.price_kind,'mode',i.provider_mode,'onboardingMinor',i.onboarding_minor::text,'subscriptionMinor',i.subscription_minor::text,'totalMinor',i.total_minor::text,'baseOfferShownAt',to_char(i.base_offer_shown_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char(i.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'launchAt',to_char(i.launch_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || CASE WHEN i.pricing_policy='owner_test_10_20_v1' THEN jsonb_build_object('grantId',i.grant_id::text) ELSE '{}'::jsonb END
 INTO result FROM public.early_bird_composite_intents i JOIN public.early_bird_verified_bindings b ON b.intent_id=i.id AND b.user_id=i.user_id
 WHERE (target_kind='invoice' AND i.invoice_id::text=target_id) OR (target_kind='provider' AND b.provider_object_id=target_id) OR (target_kind='operation' AND i.id::text=target_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION early_bird_private.find_verified_payment(text,text) FROM PUBLIC;
