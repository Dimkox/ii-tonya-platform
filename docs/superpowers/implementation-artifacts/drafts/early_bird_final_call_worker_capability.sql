-- DRAFT: one least-privilege entrypoint for the final-call worker. Requires the
-- verified final-call authority and queue. No application/table grants are made.
CREATE FUNCTION public.early_bird_final_call_worker(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cfg public.early_bird_launch_configs%ROWTYPE; notice public.early_bird_final_call_queue%ROWTYPE;
 target_user uuid; target_notice uuid; target_attempt uuid; target_kind text; outcome text; receipt_message text; data jsonb; row_id uuid; batch integer;
BEGIN
 PERFORM public.early_bird_final_call_check_schema();
 IF payload IS NULL OR jsonb_typeof(payload)<>'object' THEN RAISE EXCEPTION 'early_bird_final_call_request'; END IF;
 IF operation IN('scan','exclude') THEN
  IF NOT(payload ? 'limit') OR payload-ARRAY['limit']<>'{}'::jsonb OR jsonb_typeof(payload->'limit')<>'number' OR (payload->>'limit')!~'^[1-9][0-9]?$' THEN RAISE EXCEPTION 'early_bird_final_call_request'; END IF;
  batch:=(payload->>'limit')::integer;
  IF batch>50 THEN RAISE EXCEPTION 'early_bird_final_call_request'; END IF;
  IF operation='exclude' THEN RETURN to_jsonb(public.early_bird_final_call_exclude(batch)); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('userId',s.user_id,'kind',s.kind,'configId',s.config_id,'scheduledAt',s.scheduled_at) ORDER BY s.user_id,s.kind),'[]'::jsonb) INTO data FROM public.early_bird_final_call_scan(batch) s;
  RETURN data;
 END IF;
 IF operation='enqueue' THEN
  IF payload-ARRAY['userId','kind','configId','scheduledAt']<>'{}'::jsonb OR NOT(payload ?& ARRAY['userId','kind','configId','scheduledAt']) THEN RAISE EXCEPTION 'early_bird_final_call_request'; END IF;
  RETURN to_jsonb(public.early_bird_final_call_enqueue((payload->>'userId')::uuid,payload->>'kind',(payload->>'configId')::uuid,(payload->>'scheduledAt')::timestamptz));
 END IF;
 IF operation='claim' THEN
  IF payload-ARRAY['attemptId']<>'{}'::jsonb OR NOT(payload ? 'attemptId') THEN RAISE EXCEPTION 'early_bird_final_call_request'; END IF;
  target_attempt:=(payload->>'attemptId')::uuid;
  IF target_attempt IS NULL THEN RAISE EXCEPTION 'early_bird_final_call_request'; END IF;
  SELECT * INTO cfg FROM public.early_bird_launch_configs WHERE active FOR SHARE;
  IF NOT FOUND OR cfg.phase<>'WAVE_1_EARLY_BIRD' OR public.early_bird_current_time()<cfg.final_call_trigger_at OR public.early_bird_current_time()>=cfg.client_start_at THEN RETURN 'null'::jsonb; END IF;
  SELECT q.* INTO notice FROM public.early_bird_final_call_queue q WHERE q.config_version=cfg.id::text AND q.trigger_at=cfg.final_call_trigger_at AND q.client_start_at=cfg.client_start_at
   AND ((q.status='pending' AND q.available_at<=public.early_bird_current_time()) OR(q.status='preparing' AND q.prepared_until<=clock_timestamp()))
   AND public.early_bird_final_call_eligible(q.user_id,cfg.id) ORDER BY q.created_at,q.id LIMIT 1;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(notice.user_id::text,0));
  WITH chosen AS (
   SELECT q.id FROM public.early_bird_final_call_queue q WHERE q.id=notice.id AND q.config_version=cfg.id::text AND q.trigger_at=cfg.final_call_trigger_at AND q.client_start_at=cfg.client_start_at
    AND ((q.status='pending' AND q.available_at<=public.early_bird_current_time()) OR(q.status='preparing' AND q.prepared_until<=clock_timestamp()))
    AND public.early_bird_final_call_eligible(q.user_id,cfg.id)
   ORDER BY q.created_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1
  ) UPDATE public.early_bird_final_call_queue q SET status='preparing',attempt_id=target_attempt,prepared_until=clock_timestamp()+interval '60 seconds'
   FROM chosen WHERE q.id=chosen.id RETURNING q.* INTO notice;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  RETURN jsonb_build_object('noticeId',notice.id,'attemptId',target_attempt,'userId',notice.user_id,'kind',notice.kind);
 END IF;
 IF operation NOT IN('dispatch','finish','resume') THEN RAISE EXCEPTION 'early_bird_final_call_request'; END IF;
 IF payload-ARRAY['noticeId','attemptId','userId','kind','result','messageId','botKey','messagingPolicyVersion']<>'{}'::jsonb OR NOT(payload ?& ARRAY['noticeId','attemptId','userId','kind']) THEN RAISE EXCEPTION 'early_bird_final_call_request'; END IF;
 target_notice:=(payload->>'noticeId')::uuid; target_attempt:=(payload->>'attemptId')::uuid; target_user:=(payload->>'userId')::uuid; target_kind:=payload->>'kind';
 IF target_user IS NULL OR target_notice IS NULL OR target_attempt IS NULL OR target_kind NOT IN('first','repeat') THEN RAISE EXCEPTION 'early_bird_final_call_request'; END IF;
 LOCK TABLE public.consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 IF operation='finish' THEN
  outcome:=payload->>'result'; receipt_message:=payload->>'messageId';
  IF outcome IS NULL OR outcome NOT IN('delivered','cancelled','retry','uncertain') OR (outcome='delivered' AND(receipt_message IS NULL OR receipt_message!~'^[1-9][0-9]{0,19}$')) OR(outcome<>'delivered' AND receipt_message IS NOT NULL) THEN RAISE EXCEPTION 'early_bird_final_call_receipt'; END IF;
  UPDATE public.early_bird_final_call_queue q SET status=CASE WHEN outcome='retry' THEN 'pending' ELSE outcome END,message_id=receipt_message,prepared_until=NULL,
   delivered_at=CASE WHEN outcome='delivered' THEN clock_timestamp() ELSE NULL END,
   available_at=CASE WHEN outcome='retry' THEN q.trigger_at+(floor(extract(epoch FROM(public.early_bird_current_time()-q.trigger_at))/86400)::bigint+1)*interval '1 day' ELSE q.available_at END,
   attempt_id=CASE WHEN outcome='retry' THEN NULL ELSE q.attempt_id END
  WHERE q.id=target_notice AND q.user_id=target_user AND q.kind=target_kind AND q.attempt_id=target_attempt AND(
   (outcome IN('retry','cancelled') AND q.status='preparing' AND q.prepared_until>clock_timestamp()) OR(outcome IN('delivered','uncertain') AND q.status='dispatched')) RETURNING q.id INTO row_id;
  RETURN to_jsonb(row_id IS NOT NULL);
 END IF;
 SELECT * INTO cfg FROM public.early_bird_launch_configs WHERE active FOR SHARE;
 IF NOT FOUND OR cfg.phase<>'WAVE_1_EARLY_BIRD' THEN RETURN CASE WHEN operation='resume' THEN 'null'::jsonb ELSE 'false'::jsonb END; END IF;
 IF operation='dispatch' THEN
  UPDATE public.early_bird_final_call_queue q SET status='dispatched',prepared_until=NULL
  WHERE q.id=target_notice AND q.user_id=target_user AND q.kind=target_kind AND q.attempt_id=target_attempt AND q.status='preparing' AND q.prepared_until>clock_timestamp()
   AND q.config_version=cfg.id::text AND q.trigger_at=cfg.final_call_trigger_at AND q.client_start_at=cfg.client_start_at
   AND public.early_bird_final_call_eligible(target_user,cfg.id) RETURNING q.id INTO row_id;
  RETURN to_jsonb(row_id IS NOT NULL);
 END IF;
 IF NOT(payload ?& ARRAY['botKey','messagingPolicyVersion']) THEN RAISE EXCEPTION 'early_bird_final_call_request'; END IF;
 SELECT jsonb_agg(to_jsonb(current_notice)) INTO data FROM (
  SELECT ci.external_chat_id AS "chatId",a.subscription_minor::text AS "subscriptionMinor",(extract(epoch FROM a.launch_at)*1000)::bigint::text AS "clientStartMs",a.base_id::text AS "baseId",c.revision
  FROM public.early_bird_final_call_queue q JOIN public.early_bird_deferred_accounts a ON a.user_id=q.user_id
  JOIN public.early_bird_choices c ON c.id=a.choice_id AND c.user_id=a.user_id JOIN public.expert_sales_bases b ON b.id=a.base_id AND b.user_id=a.user_id
  JOIN public.channel_identities ci ON ci.user_id=q.user_id AND ci.provider='telegram' AND ci.status='active' AND ci.bot_key=payload->>'botKey' AND ci.external_chat_id=ci.external_id
  WHERE q.id=target_notice AND q.user_id=target_user AND q.kind=target_kind AND q.status='dispatched' AND q.attempt_id=target_attempt
   AND q.config_version=cfg.id::text AND q.trigger_at=cfg.final_call_trigger_at AND q.client_start_at=cfg.client_start_at
   AND b.consent_version=payload->>'messagingPolicyVersion' AND public.expert_card_current_messaging_authority(target_user,payload->>'messagingPolicyVersion')
   AND public.early_bird_final_call_eligible(q.user_id,a.config_id)
   AND(q.kind='first' OR(EXISTS(SELECT 1 FROM public.early_bird_final_call_policy WHERE config_id=a.config_id AND repeat_without_engagement)
    AND NOT EXISTS(SELECT 1 FROM public.early_bird_final_call_engagements e JOIN public.early_bird_final_call_queue f ON f.user_id=e.user_id AND f.kind='first' AND f.status='delivered' WHERE e.user_id=q.user_id AND e.config_id=a.config_id AND e.engaged_at>=f.created_at)))
  FOR SHARE OF q,a,c,b,ci
 ) current_notice;
 IF data IS NULL OR jsonb_array_length(data)<>1 THEN RETURN 'null'::jsonb; END IF;
 RETURN data->0;
END $$;
REVOKE ALL ON FUNCTION public.early_bird_final_call_worker(text,jsonb) FROM PUBLIC;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ii_tonya_wave_final_call_worker') THEN
  CREATE ROLE ii_tonya_wave_final_call_worker NOLOGIN NOINHERIT;
 END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.early_bird_final_call_worker(text,jsonb) TO ii_tonya_wave_final_call_worker;


-- API-only port: the primary application owner invokes this only after its
-- authenticated Telegram scope resolves a genuine Pay click. No PUBLIC or
-- worker-role execute grant is provided.
CREATE FUNCTION public.early_bird_final_call_engage(target_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.early_bird_final_call_check_schema();
 LOCK TABLE public.consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 INSERT INTO public.early_bird_final_call_engagements(user_id,config_id)
  SELECT target_user,c.id FROM public.early_bird_launch_configs c WHERE c.active AND public.early_bird_final_call_eligible(target_user,c.id)
  ON CONFLICT(user_id,config_id) DO UPDATE SET engaged_at=clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION public.early_bird_final_call_engage(uuid) FROM PUBLIC;
