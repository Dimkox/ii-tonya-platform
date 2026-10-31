-- DRAFT: install only with reviewed 0081+0087 and a separate sender process/login.
-- No PUBLIC capability, no direct table access required by the sender login.
-- Historical receipt helpers and intent triggers resolve public tables by name;
-- public schema CREATE must remain restricted to the trusted migration owner.
-- pg_temp is explicitly last to prevent temporary-table shadowing in delegates.
CREATE FUNCTION early_bird_private.standard_send_snapshot(target_user uuid,target_intent uuid,target_contact uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 LOCK TABLE public.consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 PERFORM 1 FROM public.early_bird_composite_intents WHERE id=target_intent AND user_id=target_user FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Receipt deletion/expiry and all current authority writers must use the same
 -- subject lock. Hold the actual contact row too, rather than only an EXISTS.
 PERFORM 1 FROM public.early_bird_receipt_contacts c JOIN public.early_bird_composite_intents i ON i.choice_id=c.choice_id AND i.user_id=c.user_id
 WHERE i.id=target_intent AND i.user_id=target_user AND c.id=target_contact FOR SHARE OF c;
 SELECT jsonb_build_object('status',i.status,'userId',i.user_id::text,'operationId',i.id::text,'invoiceId',i.invoice_id::text,'priceKind',i.price_kind,'eligible',i.promotion_eligible,'participant',i.participant_kind,'base',i.base_monthly_minor::text,'monthly',i.subscription_minor::text,'total',i.total_minor::text,'quote',to_char(i.quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'idempotencyKey',i.idempotency_key::text,'digest',i.request_digest,
   'ciphertext',r.ciphertext,'keyReference',r.key_reference,
   'offer',to_char(i.base_offer_shown_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'expiry',to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'launch',to_char(i.launch_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'contactAvailable',EXISTS(SELECT 1 FROM public.early_bird_receipt_contacts c WHERE c.id=target_contact AND c.user_id=i.user_id AND c.choice_id=i.choice_id AND c.expires_at>clock_timestamp() AND public.early_bird_receipt_authorized(c.user_id,c.choice_id))) INTO result
 FROM public.early_bird_composite_intents i LEFT JOIN public.early_bird_composite_requests r ON r.intent_id=i.id AND r.user_id=i.user_id AND r.idempotency_key=i.idempotency_key AND r.request_digest=i.request_digest AND r.expires_at>clock_timestamp()
 WHERE i.id=target_intent AND i.user_id=target_user AND i.pricing_policy='wave1_standard_v1' AND i.grant_id IS NULL AND i.price_kind IN ('discounted','full_price') AND i.provider_mode='live' AND i.onboarding_minor=300000 AND i.total_minor=i.onboarding_minor+i.subscription_minor;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION early_bird_private.standard_send_snapshot(uuid,uuid,uuid) FROM PUBLIC;
CREATE FUNCTION early_bird_private.standard_admit_send(target_user uuid,target_intent uuid,target_contact uuid,expected_digest text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; admitted uuid;
BEGIN
 snapshot:=early_bird_private.standard_send_snapshot(target_user,target_intent,target_contact);
 IF snapshot IS NULL OR snapshot->>'status'<>'prepared' OR snapshot->>'contactAvailable'<>'true' OR snapshot->>'digest' IS DISTINCT FROM expected_digest OR snapshot->>'ciphertext' IS NULL THEN RAISE EXCEPTION 'early_bird_send_source_unavailable'; END IF;
 UPDATE public.early_bird_composite_intents SET status='unknown' WHERE id=target_intent AND user_id=target_user AND status='prepared' RETURNING id INTO admitted;
 IF admitted IS NULL THEN RAISE EXCEPTION 'early_bird_send_transition'; END IF;
 RETURN admitted;
END $$;
REVOKE ALL ON FUNCTION early_bird_private.standard_admit_send(uuid,uuid,uuid,text) FROM PUBLIC;
