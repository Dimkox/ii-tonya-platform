-- DRAFT: after verified composite/deferred publication. Existing material jobs
-- require legacy review identities and generic outbox workers claim unknown
-- topics, so a small dedicated once-per-user/version ledger avoids both bypasses.
CREATE TABLE public.early_bird_launch_kit_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 -- Preserve once-only history across expert/profile replacement for the same user.
 expert_id uuid NOT NULL,
 content_version text NOT NULL CHECK(content_version='early-bird-launch.v1'),
 payload_digest text NOT NULL CHECK(payload_digest='sha256:68ae1b75b98db4ab821e3f41dfe2f2100ac440c75a559d9b33faeb543edb5ff1'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','dispatched','delivered','uncertain','cancelled')),
 attempt_id uuid, dispatched_at timestamptz, message_ids jsonb, finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(user_id,content_version),
 CHECK((status='pending' AND attempt_id IS NULL AND dispatched_at IS NULL AND message_ids IS NULL AND finished_at IS NULL)
 OR(status='dispatched' AND attempt_id IS NOT NULL AND dispatched_at IS NOT NULL AND message_ids IS NULL AND finished_at IS NULL)
 OR(status IN('uncertain','cancelled') AND attempt_id IS NOT NULL AND dispatched_at IS NOT NULL AND message_ids IS NULL AND finished_at IS NOT NULL)
 OR(status='delivered' AND attempt_id IS NOT NULL AND dispatched_at IS NOT NULL AND message_ids IS NOT NULL AND jsonb_typeof(message_ids)='array' AND jsonb_array_length(message_ids)=2 AND finished_at IS NOT NULL))
);
REVOKE ALL ON public.early_bird_launch_kit_jobs FROM PUBLIC;

CREATE FUNCTION public.early_bird_launch_kit_eligible(target_user uuid,target_expert uuid,target_bot text,target_policy text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.early_bird_launch_configs cfg
 JOIN public.experts_published p ON p.user_id=target_user AND p.expert_id=target_expert AND p.active AND p.wave_intent_id IS NOT NULL
 JOIN public.experts e ON e.id=p.expert_id AND e.user_id=p.user_id AND e.active AND e.verified
 JOIN public.users u ON u.id=p.user_id AND u.active
 JOIN public.expert_card_drafts d ON d.id=p.draft_id AND d.user_id=p.user_id
 WHERE cfg.active AND cfg.client_start_at<=clock_timestamp()
  AND d.messaging_policy_version=target_policy AND public.expert_card_current_messaging_authority(p.user_id,target_policy)
  AND public.early_bird_current_publication_valid(p.expert_id)
  AND NOT EXISTS(SELECT 1 FROM public.expert_sales_erased_cohorts WHERE user_id=p.user_id)
  AND(SELECT count(*) FROM public.channel_identities ci WHERE ci.user_id=p.user_id AND ci.provider='telegram' AND ci.bot_key=target_bot AND ci.status='active' AND ci.external_id=ci.external_chat_id)=1)
$$;
REVOKE ALL ON FUNCTION public.early_bird_launch_kit_eligible(uuid,uuid,text,text) FROM PUBLIC;

CREATE FUNCTION public.early_bird_launch_kit_worker(operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target_bot text; target_policy text; target_user uuid; target_job uuid; target_attempt uuid; chosen public.early_bird_launch_kit_jobs%ROWTYPE; result jsonb; batch integer; changed integer; candidate record;
BEGIN
 PERFORM public.early_bird_final_call_check_schema();
 IF payload IS NULL OR jsonb_typeof(payload)<>'object' THEN RAISE EXCEPTION 'early_bird_launch_kit_request'; END IF;
 target_bot:=payload->>'botKey'; target_policy:=payload->>'messagingPolicyVersion';
 IF operation IN('enqueue','claim','resume') AND(coalesce(length(target_bot),0) NOT BETWEEN 1 AND 128 OR coalesce(length(target_policy),0) NOT BETWEEN 1 AND 128) THEN RAISE EXCEPTION 'early_bird_launch_kit_request'; END IF;
 IF operation='enqueue' THEN
  IF payload-ARRAY['limit','botKey','messagingPolicyVersion']<>'{}'::jsonb OR NOT(payload ? 'limit') OR jsonb_typeof(payload->'limit') IS DISTINCT FROM 'number' OR (payload->>'limit')!~'^[1-9][0-9]?$' THEN RAISE EXCEPTION 'early_bird_launch_kit_request'; END IF;
  batch:=(payload->>'limit')::integer; IF batch>50 THEN RAISE EXCEPTION 'early_bird_launch_kit_request'; END IF;
  LOCK TABLE public.consent_document_versions IN SHARE MODE;
  changed:=0;
  FOR candidate IN
   SELECT p.user_id,p.expert_id FROM public.experts_published p
   WHERE public.early_bird_launch_kit_eligible(p.user_id,p.expert_id,target_bot,target_policy)
    AND NOT EXISTS(SELECT 1 FROM public.early_bird_launch_kit_jobs j WHERE j.user_id=p.user_id AND j.content_version='early-bird-launch.v1')
   ORDER BY p.user_id,p.expert_id LIMIT batch
  LOOP
   -- The scan is not authority. Serialize with erasure/withdrawal and acquire
   -- a fresh volatile SQL snapshot after any wait before persisting identity.
   PERFORM pg_advisory_xact_lock(hashtextextended(candidate.user_id::text,0));
   IF public.early_bird_launch_kit_eligible(candidate.user_id,candidate.expert_id,target_bot,target_policy) THEN
    INSERT INTO public.early_bird_launch_kit_jobs(user_id,expert_id,content_version,payload_digest)
     VALUES(candidate.user_id,candidate.expert_id,'early-bird-launch.v1','sha256:68ae1b75b98db4ab821e3f41dfe2f2100ac440c75a559d9b33faeb543edb5ff1')
     ON CONFLICT(user_id,content_version) DO NOTHING;
    IF FOUND THEN changed:=changed+1; END IF;
   END IF;
  END LOOP;
  RETURN to_jsonb(changed);
 END IF;
 IF operation='claim' THEN
  IF payload-ARRAY['attemptId','botKey','messagingPolicyVersion']<>'{}'::jsonb THEN RAISE EXCEPTION 'early_bird_launch_kit_request'; END IF;
  target_attempt:=(payload->>'attemptId')::uuid; IF target_attempt IS NULL THEN RAISE EXCEPTION 'early_bird_launch_kit_request'; END IF;
  SELECT j.* INTO chosen FROM public.early_bird_launch_kit_jobs j WHERE j.status='pending' AND public.early_bird_launch_kit_eligible(j.user_id,j.expert_id,target_bot,target_policy) ORDER BY j.created_at,j.id LIMIT 1;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  LOCK TABLE public.consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(chosen.user_id::text,0));
  UPDATE public.early_bird_launch_kit_jobs j SET status='dispatched',attempt_id=target_attempt,dispatched_at=clock_timestamp()
   WHERE j.id=chosen.id AND j.status='pending' AND public.early_bird_launch_kit_eligible(j.user_id,j.expert_id,target_bot,target_policy) RETURNING j.* INTO chosen;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  RETURN jsonb_build_object('jobId',chosen.id,'userId',chosen.user_id,'attemptId',target_attempt,'contentVersion',chosen.content_version,'payloadDigest',chosen.payload_digest);
 END IF;
 IF operation NOT IN('resume','finish') THEN RAISE EXCEPTION 'early_bird_launch_kit_request'; END IF;
 target_job:=(payload->>'jobId')::uuid; target_user:=(payload->>'userId')::uuid; target_attempt:=(payload->>'attemptId')::uuid;
 IF target_job IS NULL OR target_user IS NULL OR target_attempt IS NULL THEN RAISE EXCEPTION 'early_bird_launch_kit_request'; END IF;
 LOCK TABLE public.consent_document_versions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO chosen FROM public.early_bird_launch_kit_jobs WHERE id=target_job AND user_id=target_user AND attempt_id=target_attempt AND status='dispatched' FOR UPDATE;
 IF NOT FOUND THEN RETURN CASE WHEN operation='resume' THEN 'null'::jsonb ELSE 'false'::jsonb END; END IF;
 IF operation='finish' THEN
  IF payload-ARRAY['jobId','userId','attemptId','result','messageIds']<>'{}'::jsonb OR payload->>'result' IS NULL OR payload->>'result' NOT IN('delivered','uncertain','cancelled') THEN RAISE EXCEPTION 'early_bird_launch_kit_receipt'; END IF;
  IF payload->>'result'='delivered' THEN
   IF jsonb_typeof(payload->'messageIds') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'messageIds')<>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'messageIds') value WHERE jsonb_typeof(value)<>'string' OR (value#>>'{}')!~'^[1-9][0-9]{0,19}$') OR(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(payload->'messageIds') value)<>2 THEN RAISE EXCEPTION 'early_bird_launch_kit_receipt'; END IF;
  ELSIF payload ? 'messageIds' THEN RAISE EXCEPTION 'early_bird_launch_kit_receipt'; END IF;
  UPDATE public.early_bird_launch_kit_jobs SET status=payload->>'result',message_ids=CASE WHEN payload->>'result'='delivered' THEN payload->'messageIds' ELSE NULL END,finished_at=clock_timestamp() WHERE id=chosen.id;
  RETURN 'true'::jsonb;
 END IF;
 IF payload-ARRAY['jobId','userId','attemptId','botKey','messagingPolicyVersion']<>'{}'::jsonb THEN RAISE EXCEPTION 'early_bird_launch_kit_request'; END IF;
 IF NOT public.early_bird_launch_kit_eligible(target_user,chosen.expert_id,target_bot,target_policy) THEN RETURN 'null'::jsonb; END IF;
 -- Locks are held in the outer worker transaction during the bounded send.
 PERFORM 1 FROM public.early_bird_launch_configs WHERE active AND client_start_at<=clock_timestamp() FOR SHARE;
 SELECT jsonb_build_object('chatId',ci.external_chat_id,'contentVersion',chosen.content_version,'payloadDigest',chosen.payload_digest) INTO result
  FROM public.experts_published p JOIN public.experts e ON e.id=p.expert_id AND e.user_id=p.user_id JOIN public.users u ON u.id=p.user_id
  JOIN public.expert_card_drafts d ON d.id=p.draft_id AND d.user_id=p.user_id
  JOIN public.channel_identities ci ON ci.user_id=p.user_id AND ci.provider='telegram' AND ci.bot_key=target_bot AND ci.status='active' AND ci.external_id=ci.external_chat_id
  WHERE p.user_id=target_user AND p.expert_id=chosen.expert_id AND public.early_bird_launch_kit_eligible(p.user_id,p.expert_id,target_bot,target_policy)
  FOR SHARE OF p,e,u,d,ci;
 RETURN coalesce(result,'null'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.early_bird_launch_kit_worker(text,jsonb) FROM PUBLIC;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ii_tonya_wave_launch_kit_worker') THEN CREATE ROLE ii_tonya_wave_launch_kit_worker NOLOGIN NOINHERIT; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.early_bird_launch_kit_worker(text,jsonb) TO ii_tonya_wave_launch_kit_worker;
CREATE FUNCTION public.early_bird_launch_kit_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN DELETE FROM public.early_bird_launch_kit_jobs WHERE user_id=NEW.user_id; RETURN NULL; END $$;
REVOKE ALL ON FUNCTION public.early_bird_launch_kit_erasure() FROM PUBLIC;
CREATE TRIGGER early_bird_launch_kit_erasure AFTER INSERT ON public.expert_sales_erased_cohorts FOR EACH ROW EXECUTE FUNCTION public.early_bird_launch_kit_erasure();
