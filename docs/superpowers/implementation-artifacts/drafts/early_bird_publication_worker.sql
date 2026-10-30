-- DRAFT. Install after 0081/0082; grant only to a dedicated isolated worker.
-- This scanner returns opaque IDs only. Existing activation rechecks every
-- qualification, consent, financial and card gate under a serializable subject
-- lock. It creates an inactive expert placeholder before evaluating that gate.
CREATE FUNCTION public.early_bird_publication_scan(batch_size integer, after_user uuid, after_source uuid)
RETURNS TABLE(user_id uuid, source_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF batch_size IS NULL OR batch_size < 1 OR batch_size > 50 OR ((after_user IS NULL) <> (after_source IS NULL)) THEN
  RAISE EXCEPTION 'early_bird_publication_scan_invalid';
 END IF;
 RETURN QUERY
 WITH sources AS (
  SELECT c.user_id,c.intent_id AS source_id,c.starts_at,c.ends_at FROM public.early_bird_effective_coverages c
  UNION ALL
  SELECT c.user_id,c.intent_id,c.starts_at,c.ends_at FROM public.early_bird_deferred_effective_coverages c
 )
 SELECT DISTINCT s.user_id,s.source_id
 FROM sources s
 JOIN public.expert_card_drafts d ON d.user_id=s.user_id AND d.status='approved'
 JOIN public.expert_card_reviews r ON r.id=d.approved_review_id AND r.user_id=d.user_id AND r.action='approve' AND r.revision=d.revision
 JOIN public.resident_card_versions v ON v.draft_id=d.id AND v.review_id=r.id AND v.revision=r.revision AND v.public_payload=r.public_payload
 WHERE s.starts_at<=clock_timestamp() AND s.ends_at>clock_timestamp()
  AND (after_user IS NULL OR (s.user_id,s.source_id)>(after_user,after_source))
  AND public.early_bird_paid_workspace(s.user_id)=d.application_id
  AND v.revision=(SELECT max(latest.revision) FROM public.resident_card_versions latest WHERE latest.draft_id=d.id)
  AND public.expert_card_current_messaging_authority(s.user_id,d.messaging_policy_version)
  AND NOT EXISTS(SELECT 1 FROM public.experts_published p WHERE p.user_id=s.user_id)
 ORDER BY s.user_id,s.source_id LIMIT batch_size;
END $$;
REVOKE ALL ON FUNCTION public.early_bird_publication_scan(integer,uuid,uuid) FROM PUBLIC;

-- A single capability permits exact principal validation without granting
-- direct access to the activation or underlying financial tables.
CREATE FUNCTION public.early_bird_publication_worker(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb; target_user uuid; target_source uuid;
BEGIN
 IF jsonb_typeof(payload)<>'object' THEN RAISE EXCEPTION 'early_bird_publication_payload'; END IF;
 IF operation='scan' THEN
  IF payload - ARRAY['limit','afterUser','afterSource'] <> '{}'::jsonb THEN RAISE EXCEPTION 'early_bird_publication_payload'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('userId',x.user_id,'sourceId',x.source_id) ORDER BY x.user_id,x.source_id),'[]'::jsonb)
   INTO result FROM public.early_bird_publication_scan((payload->>'limit')::integer,(payload->>'afterUser')::uuid,(payload->>'afterSource')::uuid) x;
  RETURN result;
 ELSIF operation='activate' THEN
  IF payload - ARRAY['userId','sourceId'] <> '{}'::jsonb THEN RAISE EXCEPTION 'early_bird_publication_payload'; END IF;
  target_user:=(payload->>'userId')::uuid; target_source:=(payload->>'sourceId')::uuid;
  IF target_user IS NULL OR target_source IS NULL THEN RAISE EXCEPTION 'early_bird_publication_payload'; END IF;
  PERFORM public.early_bird_activate_projection(target_user,target_source);
  RETURN 'true'::jsonb;
 END IF;
 RAISE EXCEPTION 'early_bird_publication_operation';
END $$;
REVOKE ALL ON FUNCTION public.early_bird_publication_worker(text,jsonb) FROM PUBLIC;
