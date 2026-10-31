-- Review reconciliation gets opaque identifiers, never payment-writing grants.
CREATE FUNCTION public.early_bird_worker_review_list(after_event uuid, batch_limit integer)
RETURNS TABLE(application_id uuid,event_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 100 THEN RAISE EXCEPTION 'early_bird_review_invalid'; END IF;
 RETURN QUERY
 SELECT bridge.application_id,e.id
 FROM public.resident_review_events e
 JOIN public.early_bird_form_bridges bridge ON bridge.form_id=e.attempt_id
 JOIN public.users u ON u.id=bridge.user_id AND u.active
 JOIN public.residents_applications f ON f.id=bridge.form_id AND f.user_id=bridge.user_id AND f.is_current AND f.status=e.action
 JOIN public.expert_verification_decisions d ON d.application_id=bridge.application_id AND d.user_id=bridge.user_id AND d.decision='approved' AND d.manager_id=e.manager_id AND d.manager_session_hash=e.session_hash
 JOIN LATERAL (SELECT c.id,c.choice FROM public.early_bird_choices c JOIN public.early_bird_choices initial ON initial.id=bridge.choice_id AND initial.user_id=bridge.user_id WHERE c.user_id=bridge.user_id AND c.base_id=initial.base_id ORDER BY c.decision_no DESC LIMIT 1) current_choice ON current_choice.choice='later'
 WHERE e.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') AND e.submitted_revision=bridge.submitted_revision AND e.submitted_digest=bridge.submitted_digest
  AND (after_event IS NULL OR e.id>after_event) AND public.early_bird_wave_active(public.early_bird_current_time()) AND public.early_bird_composite_qualification(bridge.user_id,current_choice.id)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_accounts i WHERE i.user_id=bridge.user_id)
 ORDER BY e.id LIMIT batch_limit;
END $$;
CREATE FUNCTION public.early_bird_worker_review_resolve(target_application uuid,target_event uuid)
RETURNS TABLE(user_id uuid,base_id uuid,choice_id uuid,config_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target_user uuid; n integer;
BEGIN
 IF target_application IS NULL OR target_event IS NULL THEN RETURN; END IF;
 SELECT count(*), min(bridge.user_id::text)::uuid INTO n,target_user FROM public.resident_review_events e JOIN public.early_bird_form_bridges bridge ON bridge.form_id=e.attempt_id WHERE e.id=target_event AND bridge.application_id=target_application;
 IF n<>1 THEN RETURN; END IF;
 LOCK TABLE public.consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 RETURN QUERY
 SELECT bridge.user_id,c.base_id,c.id,cfg.id FROM public.resident_review_events e
 JOIN public.early_bird_form_bridges bridge ON bridge.form_id=e.attempt_id
 JOIN public.users u ON u.id=bridge.user_id AND u.active
 JOIN public.residents_applications f ON f.id=bridge.form_id AND f.user_id=u.id AND f.is_current AND f.status=e.action
 JOIN public.expert_verification_decisions d ON d.application_id=bridge.application_id AND d.user_id=u.id AND d.decision='approved' AND d.manager_id=e.manager_id AND d.manager_session_hash=e.session_hash
 JOIN public.early_bird_choices initial ON initial.id=bridge.choice_id AND initial.user_id=u.id
 JOIN public.early_bird_choices c ON c.base_id=initial.base_id AND c.user_id=u.id
 JOIN public.expert_sales_bases b ON b.id=c.base_id AND b.user_id=u.id
 JOIN public.early_bird_launch_configs cfg ON cfg.active AND cfg.phase='WAVE_1_EARLY_BIRD'
 WHERE e.id=target_event AND bridge.application_id=target_application AND bridge.user_id=target_user AND e.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') AND e.submitted_revision=bridge.submitted_revision AND e.submitted_digest=bridge.submitted_digest AND c.choice='later' AND c.id=(SELECT latest.id FROM public.early_bird_choices latest WHERE latest.base_id=b.id ORDER BY latest.decision_no DESC LIMIT 1) AND public.early_bird_wave_active(public.early_bird_current_time()) AND public.early_bird_composite_qualification(u.id,c.id) AND public.expert_card_current_messaging_authority(u.id,b.consent_version)
 LIMIT 2 FOR SHARE OF e,bridge,u,f,d,c,b,cfg;
END $$;
REVOKE ALL ON FUNCTION public.early_bird_worker_review_list(uuid,integer),public.early_bird_worker_review_resolve(uuid,uuid) FROM PUBLIC;
