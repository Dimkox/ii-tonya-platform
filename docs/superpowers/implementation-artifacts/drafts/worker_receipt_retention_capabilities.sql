-- Apply under the reviewed migration owner. A worker gets EXECUTE only, never
-- DELETE on contacts or UPDATE on financial tables. Gateway revoke is committed
-- independently before its ACK; the predicate below enforces this in the DB.
CREATE FUNCTION public.early_bird_wave_retention_list(batch_limit integer)
RETURNS TABLE(id uuid, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF batch_limit < 1 OR batch_limit > 100 OR batch_limit IS NULL THEN
  RAISE EXCEPTION 'early_bird_retention_invalid';
 END IF;
 RETURN QUERY SELECT r.id,r.user_id FROM public.early_bird_receipt_contacts r
 WHERE r.expires_at <= clock_timestamp() ORDER BY r.expires_at,r.id LIMIT batch_limit;
END $$;
CREATE FUNCTION public.early_bird_deferred_retention_list(batch_limit integer)
RETURNS TABLE(id uuid, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF batch_limit < 1 OR batch_limit > 100 OR batch_limit IS NULL THEN
  RAISE EXCEPTION 'early_bird_retention_invalid';
 END IF;
 RETURN QUERY SELECT r.id,r.user_id FROM public.early_bird_deferred_receipt_contacts r
 WHERE r.expires_at <= clock_timestamp() ORDER BY r.expires_at,r.id LIMIT batch_limit;
END $$;
CREATE FUNCTION public.early_bird_wave_retention_expire(target_id uuid, target_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF target_id IS NULL OR target_user IS NULL THEN RAISE EXCEPTION 'early_bird_retention_invalid'; END IF;
 LOCK TABLE public.consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 DELETE FROM public.early_bird_receipt_contacts r WHERE r.id=target_id AND r.user_id=target_user
  AND r.expires_at <= clock_timestamp() AND EXISTS (
   SELECT 1 FROM public.early_bird_gateway_contact_state g WHERE g.contact_id=r.id AND g.revoked_at IS NOT NULL);
 RETURN FOUND;
END $$;
CREATE FUNCTION public.early_bird_deferred_retention_expire(target_id uuid, target_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF target_id IS NULL OR target_user IS NULL THEN RAISE EXCEPTION 'early_bird_retention_invalid'; END IF;
 LOCK TABLE public.consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 DELETE FROM public.early_bird_deferred_receipt_contacts r WHERE r.id=target_id AND r.user_id=target_user
  AND r.expires_at <= clock_timestamp() AND EXISTS (
   SELECT 1 FROM public.early_bird_gateway_contact_state g WHERE g.contact_id=r.id AND g.revoked_at IS NOT NULL);
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.early_bird_wave_retention_list(integer), public.early_bird_deferred_retention_list(integer), public.early_bird_wave_retention_expire(uuid,uuid), public.early_bird_deferred_retention_expire(uuid,uuid) FROM PUBLIC;
