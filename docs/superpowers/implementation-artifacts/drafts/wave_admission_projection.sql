CREATE OR REPLACE FUNCTION enforce_expert_residency_calendar_pause() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.active AND EXISTS(SELECT 1 FROM public.expert_residency_lifecycle WHERE user_id=NEW.user_id AND status='paused') THEN RAISE EXCEPTION 'residency_paused' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- Qualify legacy helper dependencies for restricted SECURITY DEFINER callers.
CREATE OR REPLACE FUNCTION expert_card_current_messaging_authority(target_user uuid,target_policy text) RETURNS boolean LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.consent_states s JOIN public.consents c ON c.id=s.last_decision_id AND c.user_id=s.user_id AND c.consent_type=s.purpose AND c.decision='granted'
 JOIN public.consent_document_versions d ON d.id=c.document_version_id AND d.id=s.document_version_id
 JOIN public.consent_presentations p ON p.id=c.presentation_id AND p.user_id=c.user_id AND p.purpose=c.consent_type AND p.document_version_id=d.id AND p.channel=c.channel
 WHERE s.user_id=target_user AND s.purpose='client_messaging' AND s.decision='granted' AND s.revision>0
 AND c.policy_version=target_policy AND c.basis='consent' AND c.scope_fields='{}'::jsonb AND c.recipient_id IS NULL AND c.reservation_id IS NULL AND c.text_sha256=d.text_sha256
 AND d.document_key='consent.client_messaging' AND d.status='approved' AND d.effective_at<=clock_timestamp()
 AND d.version=(SELECT max(candidate.version) FROM public.consent_document_versions candidate WHERE candidate.document_key=d.document_key AND candidate.status='approved' AND candidate.effective_at<=clock_timestamp())
 AND (c.policy_version='client-messaging-v'||d.version::text OR c.policy_version='messaging-v'||d.version::text)
 AND p.consumed_at IS NOT NULL AND p.invalidated_at IS NULL AND p.consumed_at>=p.created_at AND p.consumed_at<p.expires_at AND c.created_at>=p.created_at
 AND c.created_at=(SELECT max(candidate.created_at) FROM public.consents candidate WHERE candidate.user_id=c.user_id AND candidate.consent_type=c.consent_type)
 AND coalesce((SELECT bool_and(latest.decision='granted' AND latest.policy_version=target_policy) FROM public.consents latest WHERE latest.user_id=target_user AND latest.consent_type='client_messaging' AND latest.created_at=c.created_at),false))
$$;
CREATE OR REPLACE FUNCTION public.resident_safety_normalize(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT lower(regexp_replace(translate(normalize(value,NFKC), E'\t\n\r'||chr(160)||chr(8239), '     '), '[[:space:]]+', ' ', 'g') COLLATE "C.utf8")
$$;
CREATE OR REPLACE FUNCTION public.resident_safety_compile(source text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE s text:=source; bounded boolean:=false; alternatives text[]; branch text; atoms jsonb; result jsonb:='[]'; literal text; i integer; c text; atom_count integer;
BEGIN
 IF octet_length(s)>512 OR length(s)=0 THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
 IF left(s,2)='\b' AND right(s,2)='\b' THEN bounded:=true; s:=substr(s,3,length(s)-4); END IF;
 IF left(s,1)='(' AND right(s,1)=')' THEN s:=substr(s,2,length(s)-2); END IF;
 alternatives:=string_to_array(s,'|');
 IF cardinality(alternatives)>16 THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
 FOREACH branch IN ARRAY alternatives LOOP
  IF branch='' THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
  atoms:='[]'; literal:=''; i:=1; atom_count:=0;
  WHILE i<=length(branch) LOOP
   c:=substr(branch,i,1);
   IF substr(branch,i,3)='\s+' OR substr(branch,i,3)='\d+' OR substr(branch,i,4)='[км]' THEN
    IF literal<>'' THEN atoms:=atoms||jsonb_build_array(jsonb_build_object('literal',public.resident_safety_normalize(literal))); literal:=''; END IF;
    IF substr(branch,i,3)='\s+' THEN atoms:=atoms||'[{"space":true}]'; i:=i+3;
    ELSIF substr(branch,i,3)='\d+' THEN
     IF branch NOT IN('доходность\s+\d+%','заработок\s+\d+[км]\s+в\s+день','заработок\s+\d+[км]\s+в\s+неделю','заработок\s+\d+[км]\s+в\s+месяц') THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
     atoms:=atoms||'[{"digits":true}]'; i:=i+3;
    ELSE atoms:=atoms||'[{"unit":true}]'; i:=i+4; END IF;
   ELSIF c='\' THEN
    IF substr(branch,i+1,1) NOT IN('.','/','#','%','-','_') THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
    literal:=literal||substr(branch,i+1,1); i:=i+2;
   ELSIF c IN('(',')','[',']','{','}','*','+','?','^','$','.') OR ascii(c)<32 THEN RAISE EXCEPTION 'resident_safety_invalid_pattern';
   ELSE literal:=literal||c; i:=i+1; END IF;
  END LOOP;
  IF literal<>'' THEN atoms:=atoms||jsonb_build_array(jsonb_build_object('literal',public.resident_safety_normalize(literal))); END IF;
  atom_count:=jsonb_array_length(atoms);
  IF atom_count=0 OR atom_count>16 OR NOT (atoms->0 ? 'literal') OR atoms->0->>'literal'='' THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
  result:=result||jsonb_build_array(atoms);
 END LOOP;
 RETURN jsonb_build_object('bounded',bounded,'alternatives',result);
END $$;
CREATE OR REPLACE FUNCTION public.resident_safety_matches_normalized(value text, program jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE s text:=value; branch jsonb; atom jsonb; prefix text; cursor_pos integer; start_pos integer; offset_pos integer; digit_start integer; ok boolean; steps integer:=0; word_left boolean; word_right boolean;
BEGIN
 IF octet_length(value)>64000 THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
 FOR branch IN SELECT jsonb_array_elements(program->'alternatives') LOOP
  prefix:=branch->0->>'literal'; offset_pos:=1;
  LOOP
   start_pos:=strpos(substr(s,offset_pos),prefix); EXIT WHEN start_pos=0;
   start_pos:=start_pos+offset_pos-1; cursor_pos:=start_pos; ok:=true;
   FOR atom IN SELECT jsonb_array_elements(branch) LOOP
    steps:=steps+1; IF steps>131072 THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
    IF atom ? 'literal' THEN
     IF substr(s,cursor_pos,length(atom->>'literal'))<>atom->>'literal' THEN ok:=false; EXIT; END IF;
     cursor_pos:=cursor_pos+length(atom->>'literal');
    ELSIF atom ? 'space' THEN
     IF substr(s,cursor_pos,1)<>' ' THEN ok:=false; EXIT; END IF; cursor_pos:=cursor_pos+1;
    ELSIF atom ? 'digits' THEN
     digit_start:=cursor_pos;
     WHILE substr(s,cursor_pos,1) IN('0','1','2','3','4','5','6','7','8','9') LOOP cursor_pos:=cursor_pos+1; END LOOP;
     IF cursor_pos=digit_start THEN ok:=false; EXIT; END IF;
    ELSIF atom ? 'unit' THEN
     IF substr(s,cursor_pos,1) NOT IN('к','м') THEN ok:=false; EXIT; END IF; cursor_pos:=cursor_pos+1;
    ELSE RAISE EXCEPTION 'resident_safety_corrupt_program'; END IF;
   END LOOP;
   IF ok AND (NOT (program->>'bounded')::boolean OR
    ((start_pos=1 OR substr(s,start_pos-1,1) COLLATE "C.utf8" !~ '[[:alnum:]_]') AND
     (cursor_pos>length(s) OR substr(s,cursor_pos,1) COLLATE "C.utf8" !~ '[[:alnum:]_]'))) THEN RETURN true; END IF;
   offset_pos:=start_pos+1;
  END LOOP;
 END LOOP;
 RETURN false;
END $$;
CREATE OR REPLACE FUNCTION resident_safety_assess(fields jsonb, revision integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE active_policy uuid; activation_id uuid; activation_generation bigint; engine_name text; r record; f record; issues jsonb:='[]'; normalized text; normalized_fields jsonb; letters integer; capitals integer; bytes bigint; n integer;
BEGIN
 SELECT a.policy_id,a.publication_id,publication.generation,p.engine INTO active_policy,activation_id,activation_generation,engine_name FROM public.resident_safety_active a JOIN public.resident_safety_policies p ON p.id=a.policy_id AND p.published_at IS NOT NULL JOIN public.resident_safety_publications publication ON publication.id=a.publication_id AND publication.policy_id=a.policy_id WHERE a.id=1 FOR SHARE OF a;
 IF active_policy IS NULL OR engine_name<>'resident_safe_regex_v1' THEN RAISE EXCEPTION 'resident_safety_policy_unavailable'; END IF;
 IF jsonb_typeof(fields)<>'object' THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
 SELECT count(*),sum(octet_length(value)) INTO n,bytes FROM jsonb_each_text(fields);
 IF n>125 OR bytes>2097152 OR EXISTS(SELECT 1 FROM jsonb_each(fields) WHERE jsonb_typeof(value)<>'string' OR octet_length(key)>100) THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
 SELECT coalesce(jsonb_object_agg(key,public.resident_safety_normalize(value)),'{}') INTO normalized_fields FROM jsonb_each_text(fields);
 SELECT count(*) INTO n FROM public.forbidden_patterns WHERE policy_id=active_policy AND is_active;
 IF n<1 OR n>256 THEN RAISE EXCEPTION 'resident_safety_policy_unavailable'; END IF;
 FOR r IN SELECT * FROM public.forbidden_patterns WHERE policy_id=active_policy AND is_active ORDER BY id LOOP
  IF r.compiled IS DISTINCT FROM public.resident_safety_compile(r.pattern_regex) THEN RAISE EXCEPTION 'resident_safety_policy_corrupt'; END IF;
  FOR f IN SELECT * FROM jsonb_each_text(normalized_fields) LOOP
   IF public.resident_safety_matches_normalized(f.value,r.compiled) THEN issues:=issues||jsonb_build_array(jsonb_build_object('field',f.key,'ruleId',r.id,'severity',r.severity_level,'reason',r.error_message_template)); END IF;
  END LOOP;
 END LOOP;
 FOR f IN SELECT * FROM jsonb_each_text(fields) LOOP
  IF octet_length(f.value)>64000 THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
  normalized:=normalize(f.value,NFKC);
  IF translate(normalized,chr(173)||chr(8203)||chr(8204)||chr(8205)||chr(8206)||chr(8207)||chr(8234)||chr(8235)||chr(8236)||chr(8237)||chr(8238)||chr(8288)||chr(8294)||chr(8295)||chr(8296)||chr(8297)||chr(65279),'') IS DISTINCT FROM normalized THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('field',f.key,'ruleId',null,'severity','BLOCKER','reason','Уберите невидимые управляющие символы и повторите ввод обычным текстом.'));
  END IF;
  SELECT count(*) FILTER(WHERE lower(c COLLATE "C.utf8")<>upper(c COLLATE "C.utf8")), count(*) FILTER(WHERE lower(c COLLATE "C.utf8")<>upper(c COLLATE "C.utf8") AND c=upper(c COLLATE "C.utf8")) INTO letters,capitals FROM regexp_split_to_table(normalized,'') c;
  IF capitals*2>letters THEN issues:=issues||jsonb_build_array(jsonb_build_object('field',f.key,'ruleId',null,'severity','WARNING','reason','Пожалуйста, используйте обычный регистр. КАПС воспринимается как крик.')); END IF;
 END LOOP;
 RETURN jsonb_build_object('policyId',active_policy,'publicationId',activation_id,'generation',activation_generation::text,'revision',revision,'digest',encode(public.digest(jsonb_build_object('fields',fields,'revision',revision,'policy',active_policy,'publication',activation_id)::text,'sha256'),'hex'),'issues',issues,'blocked',EXISTS(SELECT 1 FROM jsonb_array_elements(issues) i WHERE i->>'severity'='BLOCKER'));
END $$;
-- DRAFT: discovery only; this view is not an authorization to publish.
-- Production publication still requires an immutable admission, guarded
-- projection, isolated writer and atomic refund/reprojection.
CREATE VIEW early_bird_admission_candidates AS
SELECT s.intent_id,s.user_id,e.id AS expert_id,d.id AS draft_id,r.id AS review_id,
       r.revision,r.public_digest,r.public_payload,c.starts_at,c.ends_at
FROM early_bird_payment_successes s
JOIN early_bird_effective_coverages c ON c.intent_id=s.intent_id
JOIN early_bird_composite_intents i ON i.id=s.intent_id AND i.user_id=s.user_id
JOIN early_bird_choices choice ON choice.id=i.choice_id AND choice.user_id=i.user_id
JOIN early_bird_choices approved_choice ON approved_choice.base_id=choice.base_id AND approved_choice.user_id=choice.user_id
JOIN early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
JOIN expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=i.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL
JOIN expert_card_drafts d ON d.application_id=a.id AND d.user_id=i.user_id
JOIN resident_card_versions v ON v.draft_id=d.id
JOIN expert_card_reviews r ON r.id=v.review_id AND r.user_id=i.user_id AND r.action='approve' AND r.revision=v.revision AND r.public_payload=v.public_payload
JOIN users u ON u.id=i.user_id AND u.active
JOIN experts e ON e.user_id=u.id
WHERE c.starts_at<=clock_timestamp() AND c.ends_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM residents_applications f JOIN expert_verification_decisions vd ON vd.application_id=b.application_id AND vd.user_id=b.user_id AND vd.decision='approved' JOIN resident_review_events re ON re.attempt_id=f.id AND re.manager_id=vd.manager_id AND re.session_hash=vd.manager_session_hash AND re.action=f.status AND re.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
 AND v.revision=(SELECT max(latest.revision) FROM resident_card_versions latest WHERE latest.draft_id=d.id)
 AND expert_card_current_messaging_authority(i.user_id,d.messaging_policy_version)
 AND EXISTS(SELECT 1 FROM channel_identities ci WHERE ci.user_id=i.user_id AND ci.provider='telegram' AND ci.bot_key=d.work_bot_key AND ci.external_id=d.work_chat_id AND ci.external_chat_id=d.work_chat_id AND ci.status='active')
 AND resident_safety_assess(v.safety_fields,v.revision)=v.safety_proof
 AND NOT (v.safety_proof->>'blocked')::boolean
 AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds h WHERE h.expert_id=e.id AND h.status='open')
 AND NOT EXISTS(SELECT 1 FROM expert_residency_lifecycle l WHERE l.expert_id=e.id AND l.status='paused')
 AND NOT EXISTS(SELECT 1 FROM early_bird_coverage_reconciliation pending WHERE pending.user_id=i.user_id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_refund_reconciliation pending WHERE pending.user_id=i.user_id);
REVOKE ALL ON early_bird_admission_candidates FROM PUBLIC;

-- A historical admission is distinct from the live eligibility view. It is
-- never enough on its own to expose a card; every read must re-evaluate live
-- coverage and all consent/safety/hold conditions.
CREATE TABLE early_bird_admissions (
 intent_id uuid NOT NULL REFERENCES early_bird_payment_successes(intent_id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 expert_id uuid NOT NULL,
 draft_id uuid NOT NULL,
 review_id uuid NOT NULL,
 revision integer NOT NULL,
 public_digest text NOT NULL,
 admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(intent_id,review_id)
);
REVOKE ALL ON early_bird_admissions FROM PUBLIC;
CREATE FUNCTION early_bird_guard_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.early_bird_admission_candidates c
   WHERE c.intent_id=NEW.intent_id AND c.user_id=NEW.user_id AND c.expert_id=NEW.expert_id
     AND c.draft_id=NEW.draft_id AND c.review_id=NEW.review_id AND c.revision=NEW.revision
     AND c.public_digest=NEW.public_digest) THEN
   RAISE EXCEPTION 'early_bird_admission_source';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER early_bird_admission_source BEFORE INSERT ON early_bird_admissions FOR EACH ROW EXECUTE FUNCTION early_bird_guard_admission();
CREATE TRIGGER early_bird_admission_immutable BEFORE UPDATE OR DELETE ON early_bird_admissions FOR EACH ROW EXECUTE FUNCTION early_bird_success_immutable();
REVOKE ALL ON FUNCTION early_bird_guard_admission() FROM PUBLIC;

-- DRAFT ONLY. Keep legacy guard unchanged after the additional wave branch.
ALTER TABLE experts_published ALTER COLUMN paid_order_id DROP NOT NULL;
ALTER TABLE experts_published ADD COLUMN wave_intent_id uuid REFERENCES early_bird_payment_successes(intent_id) ON DELETE CASCADE;
ALTER TABLE experts_published ADD CONSTRAINT expert_published_exact_payment_source CHECK ((paid_order_id IS NULL) <> (wave_intent_id IS NULL));
CREATE OR REPLACE FUNCTION enforce_expert_published_card_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN

 IF TG_OP='UPDATE' AND NOT NEW.active AND (to_jsonb(NEW)-ARRAY['active','updated_at'])=(to_jsonb(OLD)-ARRAY['active','updated_at']) THEN RETURN NEW; END IF;
 -- Wave sources must match immutable admission and current, unrevoked
 -- eligibility, including reviewed payload, coverage, consent and safety.
 IF NEW.wave_intent_id IS NOT NULL AND NEW.paid_order_id IS NULL THEN
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.expert_card_drafts d WHERE d.id=NEW.draft_id AND d.user_id=NEW.user_id AND d.status='approved' AND d.approved_review_id=NEW.review_id AND d.revision=NEW.revision) THEN RAISE EXCEPTION 'expert_published_wave_source' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM public.early_bird_admissions a JOIN public.early_bird_admission_candidates c ON c.intent_id=a.intent_id AND c.user_id=a.user_id AND c.expert_id=a.expert_id AND c.draft_id=a.draft_id AND c.review_id=a.review_id AND c.revision=a.revision AND c.public_digest=a.public_digest JOIN public.expert_card_drafts d ON d.id=a.draft_id
   WHERE EXISTS(SELECT 1 FROM public.experts verified_expert WHERE verified_expert.id=NEW.expert_id AND verified_expert.user_id=NEW.user_id AND verified_expert.active AND verified_expert.verified) AND a.intent_id=NEW.wave_intent_id AND a.user_id=NEW.user_id AND a.expert_id=NEW.expert_id AND a.draft_id=NEW.draft_id AND a.review_id=NEW.review_id AND a.revision=NEW.revision AND a.public_digest=NEW.public_digest AND c.public_payload=NEW.public_payload AND d.application_id=NEW.application_audit_id AND c.ends_at=NEW.next_billing_date) THEN
    RAISE EXCEPTION 'expert_published_wave_source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;

 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['review_id','revision','public_digest','public_payload','updated_at','active','next_billing_date','paid_order_id'])=(to_jsonb(OLD)-ARRAY['review_id','revision','public_digest','public_payload','updated_at','active','next_billing_date','paid_order_id']) AND EXISTS(
 SELECT 1 FROM public.resident_card_versions v JOIN public.expert_card_reviews r ON r.id=v.review_id JOIN public.expert_card_drafts d ON d.id=v.draft_id AND ((r.id=(SELECT latest.review_id FROM public.resident_card_versions latest WHERE latest.draft_id=d.id ORDER BY latest.revision DESC LIMIT 1)) OR (r.id=OLD.review_id AND NEW.review_id=OLD.review_id))
 JOIN public.expert_card_main_orders m ON m.order_id=NEW.paid_order_id AND m.user_id=NEW.user_id AND m.expert_id=NEW.expert_id
 JOIN public.expert_main_activation_admissions a ON a.order_id=m.order_id AND a.review_audit_id=m.review_audit_id AND a.public_digest=m.public_digest
 WHERE v.review_id=NEW.review_id AND v.draft_id=NEW.draft_id AND v.revision=NEW.revision AND r.public_digest=NEW.public_digest AND r.public_payload=NEW.public_payload AND r.user_id=NEW.user_id AND public.expert_card_activation_gate_valid(NEW.user_id,NEW.review_id) AND EXISTS(SELECT 1 FROM public.expert_residency_current_coverage(NEW.expert_id) c WHERE c.source_order_id=NEW.paid_order_id AND c.ends_at=NEW.next_billing_date) AND (NOT NEW.active OR (EXISTS(SELECT 1 FROM public.experts e WHERE e.id=NEW.expert_id AND e.user_id=NEW.user_id AND e.active AND e.verified) AND NOT EXISTS(SELECT 1 FROM public.expert_referral_abuse_holds WHERE expert_id=NEW.expert_id AND status='open') AND NOT EXISTS(SELECT 1 FROM public.expert_residency_lifecycle WHERE expert_id=NEW.expert_id AND status='paused')))
 ) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NOT NEW.active AND (to_jsonb(NEW)-ARRAY['active','updated_at'])=(to_jsonb(OLD)-ARRAY['active','updated_at']) THEN RETURN NEW; END IF;
 IF NEW.draft_id IS NULL OR NEW.review_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.experts e JOIN public.users u ON u.id=e.user_id AND u.active JOIN public.expert_card_reviews r ON r.id=NEW.review_id
   JOIN public.expert_card_drafts d ON d.id=NEW.draft_id AND d.approved_review_id=r.id AND d.revision=r.revision
   JOIN public.expert_residency_orders o ON o.id=NEW.paid_order_id AND o.expert_id=e.id AND o.status='settled'
   JOIN public.expert_card_main_orders m ON m.order_id=o.id AND m.expert_id=e.id AND m.user_id=NEW.user_id AND m.review_id=r.id AND m.revision=NEW.revision AND m.public_digest=NEW.public_digest
   WHERE public.expert_card_activation_gate_valid(NEW.user_id,NEW.review_id) AND e.id=NEW.expert_id AND e.user_id=NEW.user_id AND e.active AND e.verified AND d.user_id=e.user_id
     AND EXISTS(SELECT 1 FROM public.expert_main_activation_admissions admission WHERE admission.order_id=o.id AND admission.user_id=NEW.user_id AND admission.expert_id=NEW.expert_id AND admission.quote_id=m.quote_id AND admission.application_audit_id=NEW.application_audit_id AND admission.review_audit_id=m.review_audit_id AND admission.public_digest=NEW.public_digest)
     AND d.application_id=NEW.application_audit_id AND r.action='approve' AND r.revision=NEW.revision
     AND r.public_digest=NEW.public_digest AND r.public_payload=NEW.public_payload AND o.residency_ends_at=NEW.next_billing_date)
 OR (NEW.active AND (NEW.next_billing_date<=clock_timestamp() OR NOT EXISTS(
   SELECT 1 FROM public.expert_residency_orders o WHERE o.expert_id=NEW.expert_id AND o.status='settled' AND o.residency_starts_at<=clock_timestamp() AND o.residency_ends_at>clock_timestamp()))) THEN
  RAISE EXCEPTION 'expert_published_card_source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Single read-time authority for wave listings and native reservations. A
-- persisted active projection is never sufficient after refund or revocation.
CREATE FUNCTION early_bird_current_publication_valid(target_expert uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.experts_published p
  JOIN public.early_bird_admissions a ON a.intent_id=p.wave_intent_id
  JOIN public.early_bird_admission_candidates c ON c.intent_id=a.intent_id AND c.user_id=a.user_id AND c.expert_id=a.expert_id AND c.draft_id=a.draft_id AND c.review_id=a.review_id AND c.revision=a.revision AND c.public_digest=a.public_digest
  JOIN public.expert_card_drafts d ON d.id=a.draft_id
  JOIN public.experts e ON e.id=p.expert_id AND e.user_id=p.user_id AND e.active AND e.verified
  WHERE p.expert_id=target_expert AND p.active AND p.paid_order_id IS NULL
   AND p.user_id=a.user_id AND p.expert_id=a.expert_id AND p.draft_id=a.draft_id AND p.review_id=a.review_id
   AND p.revision=a.revision AND p.public_digest=a.public_digest AND p.public_payload=c.public_payload
   AND p.application_audit_id=d.application_id AND p.next_billing_date=c.ends_at)
$$;
REVOKE ALL ON FUNCTION early_bird_current_publication_valid(uuid) FROM PUBLIC;

-- Dynamic guarded dispatch prevents PostgreSQL from checking the restricted
-- wave function privilege for ordinary legacy-only database principals.
CREATE FUNCTION early_bird_native_wave_allowed(target_expert uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE allowed boolean;
BEGIN
 IF NOT has_function_privilege(current_user,'public.early_bird_current_publication_valid(uuid)','EXECUTE') THEN RETURN false; END IF;
 EXECUTE 'SELECT public.early_bird_current_publication_valid($1)' INTO allowed USING target_expert;
 RETURN coalesce(allowed,false);
END $$;
CREATE OR REPLACE FUNCTION resident_native_admission(target_expert uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM experts e JOIN users u ON u.id=e.user_id JOIN experts_published p ON p.expert_id=e.id AND p.user_id=e.user_id JOIN resident_card_versions v ON v.review_id=p.review_id JOIN expert_card_drafts d ON d.id=v.draft_id
 WHERE e.id=target_expert AND e.active AND e.verified AND u.active AND p.active AND p.review_id=(SELECT latest.review_id FROM resident_card_versions latest WHERE latest.draft_id=d.id ORDER BY latest.revision DESC LIMIT 1)
 AND ((expert_card_activation_gate_valid(e.user_id,p.review_id) AND EXISTS(SELECT 1 FROM expert_residency_current_coverage(e.id))) OR early_bird_native_wave_allowed(e.id))
 AND NOT EXISTS(SELECT 1 FROM expert_onboarding_applications a WHERE a.user_id=e.user_id AND (a.archived_at IS NOT NULL OR a.archive_until_date IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM expert_residency_lifecycle l WHERE l.expert_id=e.id AND l.status='paused')
 AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds h WHERE h.expert_id=e.id AND h.status='open'))
$$;

-- Revocation is idempotent and never manufactures a legacy paid order.
-- Restoring an alternative legacy source requires its existing guarded flow.
CREATE FUNCTION early_bird_deactivate_refunded_projection(target_user uuid,target_intent uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.early_bird_payment_full_refunds f WHERE f.intent_id=target_intent AND f.user_id=target_user) THEN RAISE EXCEPTION 'early_bird_projection_refund_required'; END IF;
 UPDATE public.experts_published SET active=false,updated_at=clock_timestamp()
 WHERE user_id=target_user AND wave_intent_id=target_intent AND active;
END $$;
REVOKE ALL ON FUNCTION early_bird_deactivate_refunded_projection(uuid,uuid) FROM PUBLIC;

-- Isolated activation capability; no PUBLIC grants. This must run in a fresh
-- serializable transaction with retry and under the same subject/epoch lock as
-- refund and consent changes. Existing published identities are left for the
-- established guarded re-projection flow.
CREATE FUNCTION early_bird_activate_projection(target_user uuid,target_intent uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c record; existing public.early_bird_admissions%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation') <> 'serializable' THEN RAISE EXCEPTION 'early_bird_projection_serializable_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 PERFORM public.early_bird_touch_coverage_epoch(target_user);
 IF public.early_bird_paid_workspace(target_user) IS NULL THEN RAISE EXCEPTION 'early_bird_projection_not_eligible'; END IF;
 INSERT INTO public.experts(user_id,active,verified) VALUES(target_user,false,false) ON CONFLICT(user_id) DO NOTHING;
 SELECT candidate.* INTO c FROM public.early_bird_admission_candidates candidate JOIN public.expert_card_drafts d ON d.id=candidate.draft_id AND d.user_id=candidate.user_id AND d.status='approved' AND d.approved_review_id=candidate.review_id AND d.revision=candidate.revision WHERE candidate.intent_id=target_intent AND candidate.user_id=target_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_projection_not_eligible'; END IF;
 SELECT * INTO existing FROM public.early_bird_admissions WHERE intent_id=target_intent AND review_id=c.review_id;
 IF FOUND AND (existing.user_id<>c.user_id OR existing.expert_id<>c.expert_id OR existing.draft_id<>c.draft_id OR existing.review_id<>c.review_id OR existing.revision<>c.revision OR existing.public_digest<>c.public_digest) THEN RAISE EXCEPTION 'early_bird_admission_conflict'; END IF;
 IF EXISTS(SELECT 1 FROM public.experts_published WHERE expert_id=c.expert_id) THEN
   IF EXISTS(SELECT 1 FROM public.experts_published WHERE expert_id=c.expert_id AND wave_intent_id=target_intent) AND public.early_bird_current_publication_valid(c.expert_id) THEN RETURN; END IF;
   RAISE EXCEPTION 'early_bird_projection_existing_requires_reconciliation';
 END IF;
 UPDATE public.experts SET active=true,verified=true,public_display_name=c.public_payload->>'displayName',updated_at=clock_timestamp() WHERE id=c.expert_id AND user_id=c.user_id;
 INSERT INTO public.early_bird_admissions(intent_id,user_id,expert_id,draft_id,review_id,revision,public_digest)
 VALUES(c.intent_id,c.user_id,c.expert_id,c.draft_id,c.review_id,c.revision,c.public_digest) ON CONFLICT(intent_id,review_id) DO NOTHING;
 INSERT INTO public.experts_published(expert_id,user_id,application_audit_id,draft_id,review_id,revision,public_payload,public_digest,paid_order_id,wave_intent_id,next_billing_date,active)
 SELECT c.expert_id,c.user_id,d.application_id,c.draft_id,c.review_id,c.revision,c.public_payload,c.public_digest,NULL,c.intent_id,c.ends_at,true FROM public.expert_card_drafts d WHERE d.id=c.draft_id;
END $$;
REVOKE ALL ON FUNCTION early_bird_activate_projection(uuid,uuid) FROM PUBLIC;

-- Refresh is serialized with refunds and consent revocation by the subject
-- lock. Every new review gets its own immutable admission row.
CREATE FUNCTION early_bird_refresh_projection(target_user uuid,target_review uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c record; previous public.experts_published%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO previous FROM public.experts_published WHERE user_id=target_user AND wave_intent_id IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT candidate.* INTO c FROM public.early_bird_admission_candidates candidate JOIN public.expert_card_drafts d ON d.id=candidate.draft_id AND d.user_id=candidate.user_id AND d.status='approved' AND d.approved_review_id=candidate.review_id AND d.revision=candidate.revision WHERE candidate.intent_id=previous.wave_intent_id AND candidate.user_id=target_user AND candidate.review_id=target_review;
 IF NOT FOUND THEN
  UPDATE public.experts_published SET active=false,updated_at=clock_timestamp() WHERE expert_id=previous.expert_id;
  RETURN;
 END IF;
 INSERT INTO public.early_bird_admissions(intent_id,user_id,expert_id,draft_id,review_id,revision,public_digest) VALUES(c.intent_id,c.user_id,c.expert_id,c.draft_id,c.review_id,c.revision,c.public_digest) ON CONFLICT(intent_id,review_id) DO NOTHING;
 UPDATE public.experts_published SET review_id=c.review_id,revision=c.revision,public_payload=c.public_payload,public_digest=c.public_digest,next_billing_date=c.ends_at,active=true,updated_at=clock_timestamp() WHERE expert_id=c.expert_id AND wave_intent_id=c.intent_id;
END $$;
REVOKE ALL ON FUNCTION early_bird_refresh_projection(uuid,uuid) FROM PUBLIC;

-- A verified partial refund makes the entire user wave projection unavailable
-- until a reviewed reconciliation establishes the correct remaining coverage.
CREATE FUNCTION early_bird_deactivate_partial_refund_projection(target_user uuid,target_intent uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.early_bird_refund_reconciliation q WHERE q.user_id=target_user AND q.intent_id=target_intent) THEN RAISE EXCEPTION 'early_bird_partial_refund_required'; END IF;
 UPDATE public.experts_published SET active=false,updated_at=clock_timestamp() WHERE user_id=target_user AND wave_intent_id IS NOT NULL AND active;
END $$;
REVOKE ALL ON FUNCTION early_bird_deactivate_partial_refund_projection(uuid,uuid) FROM PUBLIC;
