-- resident_safe_regex_v1 is a bounded token language, never a database regex.
CREATE TABLE resident_safety_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), engine text NOT NULL DEFAULT 'resident_safe_regex_v1',
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
-- Every activation is a new authorized, immutable fact, including rollback.
CREATE TABLE resident_safety_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_id uuid NOT NULL REFERENCES resident_safety_policies(id),
 generation bigint GENERATED ALWAYS AS IDENTITY UNIQUE, manager_id uuid REFERENCES users(id),
 manager_session_hash text REFERENCES admin_sessions(session_id_hash),
 transaction_id bigint NOT NULL DEFAULT txid_current(), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
ALTER TABLE resident_safety_policies ADD COLUMN first_publication_id uuid REFERENCES resident_safety_publications(id);
--> statement-breakpoint
CREATE TABLE forbidden_patterns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_id uuid NOT NULL REFERENCES resident_safety_policies(id),
 pattern_regex text NOT NULL, category text NOT NULL CHECK(category IN('MEDICAL_CLAIM','FINANCIAL_GUARANTEE','POLITICAL_RELIGIOUS','HATE_SPEECH','SPAM_SCAM')),
 severity_level text NOT NULL CHECK(severity_level IN('BLOCKER','WARNING')), error_message_template text NOT NULL CHECK(length(error_message_template) BETWEEN 1 AND 1000),
 is_active boolean NOT NULL DEFAULT true, compiled jsonb, provenance text NOT NULL, positive_witness text NOT NULL
);
--> statement-breakpoint
CREATE TABLE resident_safety_active (id integer PRIMARY KEY CHECK(id=1), policy_id uuid NOT NULL REFERENCES resident_safety_policies(id), publication_id uuid NOT NULL REFERENCES resident_safety_publications(id));
--> statement-breakpoint
CREATE FUNCTION resident_safety_normalize(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT lower(regexp_replace(translate(normalize(value,NFKC), E'\t\n\r'||chr(160)||chr(8239), '     '), '[[:space:]]+', ' ', 'g') COLLATE "C.utf8")
$$;
--> statement-breakpoint
CREATE FUNCTION resident_safety_compile(source text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT AS $$
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
    IF literal<>'' THEN atoms:=atoms||jsonb_build_array(jsonb_build_object('literal',resident_safety_normalize(literal))); literal:=''; END IF;
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
  IF literal<>'' THEN atoms:=atoms||jsonb_build_array(jsonb_build_object('literal',resident_safety_normalize(literal))); END IF;
  atom_count:=jsonb_array_length(atoms);
  IF atom_count=0 OR atom_count>16 OR NOT (atoms->0 ? 'literal') OR atoms->0->>'literal'='' THEN RAISE EXCEPTION 'resident_safety_invalid_pattern'; END IF;
  result:=result||jsonb_build_array(atoms);
 END LOOP;
 RETURN jsonb_build_object('bounded',bounded,'alternatives',result);
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_safety_matches_normalized(value text, program jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
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
--> statement-breakpoint
CREATE FUNCTION resident_safety_matches(value text, program jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT resident_safety_matches_normalized(resident_safety_normalize(value),program)
$$;
--> statement-breakpoint
CREATE FUNCTION resident_safety_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='resident_safety_policies' AND TG_OP='INSERT' THEN
  IF NEW.published_at IS NOT NULL OR NEW.first_publication_id IS NOT NULL THEN RAISE EXCEPTION 'resident_safety_publication_required'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='forbidden_patterns' THEN target:=COALESCE(NEW.policy_id,OLD.policy_id); ELSE target:=COALESCE(NEW.id,OLD.id); END IF;
 IF TG_TABLE_NAME='forbidden_patterns' AND TG_OP='UPDATE' THEN
  IF OLD.policy_id IS DISTINCT FROM NEW.policy_id THEN RAISE EXCEPTION 'resident_safety_policy_immutable'; END IF;
 END IF;
 PERFORM 1 FROM resident_safety_policies WHERE id=target FOR UPDATE;
 IF EXISTS(SELECT 1 FROM resident_safety_policies WHERE id=target AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'resident_safety_policy_immutable'; END IF;
 IF TG_TABLE_NAME='resident_safety_policies' AND TG_OP='UPDATE' THEN
  IF (NEW.published_at IS NOT NULL OR NEW.first_publication_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM resident_safety_publications a WHERE a.id=NEW.first_publication_id AND a.policy_id=NEW.id AND a.transaction_id=txid_current()) THEN RAISE EXCEPTION 'resident_safety_publication_required'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_safety_rules_immutable BEFORE INSERT OR UPDATE OR DELETE ON forbidden_patterns FOR EACH ROW EXECUTE FUNCTION resident_safety_policy_guard();
--> statement-breakpoint
CREATE TRIGGER resident_safety_policy_immutable BEFORE INSERT OR UPDATE OR DELETE ON resident_safety_policies FOR EACH ROW EXECUTE FUNCTION resident_safety_policy_guard();
--> statement-breakpoint
CREATE FUNCTION resident_safety_publish(target uuid, manager uuid, session_hash text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO resident_safety_publications(policy_id,manager_id,manager_session_hash) VALUES(target,manager,session_hash);
END $$;
--> statement-breakpoint
CREATE TABLE resident_card_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id), entry_id uuid NOT NULL REFERENCES expert_card_entries(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision>0), text_content text NOT NULL CHECK(length(text_content) BETWEEN 1 AND 4000), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(draft_id,revision)
);
--> statement-breakpoint
CREATE TRIGGER resident_card_corrections_immutable BEFORE UPDATE ON resident_card_corrections FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE FUNCTION resident_card_correction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM expert_card_entries e JOIN expert_card_drafts d ON d.id=e.draft_id WHERE e.id=NEW.entry_id AND e.kind='text' AND e.user_id=NEW.user_id AND e.draft_id=NEW.draft_id AND d.user_id=NEW.user_id AND d.revision+1=NEW.revision AND d.status IN('collecting','changes_requested') AND expert_card_current_messaging_authority(d.user_id,d.messaging_policy_version)) THEN RAISE EXCEPTION 'resident_card_correction_source'; END IF;
 IF (SELECT count(*) FROM resident_card_corrections WHERE draft_id=NEW.draft_id)>=10000 THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_card_correction_source BEFORE INSERT ON resident_card_corrections FOR EACH ROW EXECUTE FUNCTION resident_card_correction_guard();
--> statement-breakpoint
CREATE TABLE resident_safety_outcomes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 request_key text NOT NULL, blocked boolean NOT NULL, policy_id uuid NOT NULL REFERENCES resident_safety_policies(id), revision integer NOT NULL,
 issues jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(user_id,request_key)
);
--> statement-breakpoint
CREATE TABLE security_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 outcome_id uuid NOT NULL REFERENCES resident_safety_outcomes(id) ON DELETE CASCADE, field_name text NOT NULL, matched_pattern_id uuid REFERENCES forbidden_patterns(id),
 policy_id uuid NOT NULL REFERENCES resident_safety_policies(id), revision integer NOT NULL, action_taken text NOT NULL CHECK(action_taken IN('Blocked','Warned')), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE TRIGGER resident_safety_outcomes_immutable BEFORE UPDATE ON resident_safety_outcomes FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER security_logs_immutable BEFORE UPDATE ON security_logs FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE FUNCTION resident_card_effective_fields(target uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE result jsonb;
BEGIN
 PERFORM h.id FROM hashtags_db h JOIN expert_card_draft_tags t ON t.tag_id=h.id WHERE t.draft_id=target FOR SHARE OF h;
 SELECT coalesce(jsonb_object_agg(field,value),'{}') INTO result FROM (
  SELECT 'entry:'||e.id::text field,coalesce((SELECT c.text_content FROM resident_card_corrections c WHERE c.entry_id=e.id ORDER BY c.revision DESC LIMIT 1),e.text_content) value FROM expert_card_entries e WHERE e.draft_id=target AND e.kind='text'
  UNION ALL SELECT 'document_proposal',document_proposal->>'content' FROM expert_card_drafts WHERE id=target AND document_proposal IS NOT NULL
  UNION ALL SELECT 'public:'||j.key,j.value FROM expert_card_drafts d CROSS JOIN LATERAL jsonb_each_text(coalesce(d.public_payload,'{}')) j WHERE d.id=target
  UNION ALL SELECT 'tag:'||h.id::text,h.tag_value||' '||h.display_label FROM expert_card_draft_tags t JOIN hashtags_db h ON h.id=t.tag_id WHERE t.draft_id=target
 ) f;
 RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_safety_assess(fields jsonb, revision integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE active_policy uuid; activation_id uuid; activation_generation bigint; engine_name text; r record; f record; issues jsonb:='[]'; normalized text; normalized_fields jsonb; letters integer; capitals integer; bytes bigint; n integer;
BEGIN
 SELECT a.policy_id,a.publication_id,publication.generation,p.engine INTO active_policy,activation_id,activation_generation,engine_name FROM resident_safety_active a JOIN resident_safety_policies p ON p.id=a.policy_id AND p.published_at IS NOT NULL JOIN resident_safety_publications publication ON publication.id=a.publication_id AND publication.policy_id=a.policy_id WHERE a.id=1 FOR SHARE OF a;
 IF active_policy IS NULL OR engine_name<>'resident_safe_regex_v1' THEN RAISE EXCEPTION 'resident_safety_policy_unavailable'; END IF;
 IF jsonb_typeof(fields)<>'object' THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
 SELECT count(*),sum(octet_length(value)) INTO n,bytes FROM jsonb_each_text(fields);
 IF n>125 OR bytes>2097152 OR EXISTS(SELECT 1 FROM jsonb_each(fields) WHERE jsonb_typeof(value)<>'string' OR octet_length(key)>100) THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
 SELECT coalesce(jsonb_object_agg(key,resident_safety_normalize(value)),'{}') INTO normalized_fields FROM jsonb_each_text(fields);
 SELECT count(*) INTO n FROM forbidden_patterns WHERE policy_id=active_policy AND is_active;
 IF n<1 OR n>256 THEN RAISE EXCEPTION 'resident_safety_policy_unavailable'; END IF;
 FOR r IN SELECT * FROM forbidden_patterns WHERE policy_id=active_policy AND is_active ORDER BY id LOOP
  IF r.compiled IS DISTINCT FROM resident_safety_compile(r.pattern_regex) THEN RAISE EXCEPTION 'resident_safety_policy_corrupt'; END IF;
  FOR f IN SELECT * FROM jsonb_each_text(normalized_fields) LOOP
   IF resident_safety_matches_normalized(f.value,r.compiled) THEN issues:=issues||jsonb_build_array(jsonb_build_object('field',f.key,'ruleId',r.id,'severity',r.severity_level,'reason',r.error_message_template)); END IF;
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
 RETURN jsonb_build_object('policyId',active_policy,'publicationId',activation_id,'generation',activation_generation::text,'revision',revision,'digest',encode(digest(jsonb_build_object('fields',fields,'revision',revision,'policy',active_policy,'publication',activation_id)::text,'sha256'),'hex'),'issues',issues,'blocked',EXISTS(SELECT 1 FROM jsonb_array_elements(issues) i WHERE i->>'severity'='BLOCKER'));
END $$;
--> statement-breakpoint
ALTER TABLE expert_card_reviews ADD COLUMN safety_proof jsonb,ADD COLUMN warning_acknowledgment text;
--> statement-breakpoint
CREATE FUNCTION resident_card_review_safety_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessment jsonb;
BEGIN
 IF NEW.action='approve' THEN
  assessment:=resident_safety_assess(resident_card_effective_fields(NEW.draft_id),NEW.revision);
  IF (assessment->>'blocked')::boolean OR (jsonb_array_length(assessment->'issues')>0 AND NEW.warning_acknowledgment IS DISTINCT FROM assessment->>'digest') THEN RAISE EXCEPTION 'resident_safety_review_required'; END IF;
  NEW.safety_proof:=assessment;
 ELSE NEW.safety_proof:=NULL; NEW.warning_acknowledgment:=NULL; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_card_review_safety BEFORE INSERT ON expert_card_reviews FOR EACH ROW EXECUTE FUNCTION resident_card_review_safety_guard();
--> statement-breakpoint
CREATE FUNCTION expert_card_activation_gate_before_safety(target_user uuid,target_review uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 WITH authority_epoch AS MATERIALIZED (SELECT revision FROM expert_card_consent_epoch WHERE id=1 FOR SHARE)
 SELECT EXISTS(SELECT 1 FROM authority_epoch CROSS JOIN expert_card_drafts d JOIN users u ON u.id=d.user_id AND u.active=true
 JOIN expert_onboarding_applications a ON a.id=d.application_id AND a.user_id=d.user_id AND a.verification_status='approved'
 JOIN expert_onboarding_invoices i ON i.application_id=a.id AND i.user_id=d.user_id AND i.purpose='onboarding' AND i.status='settled'
 JOIN expert_onboarding_payment_facts f ON f.invoice_id=i.id AND f.user_id=d.user_id AND f.admission='interview'
 JOIN expert_card_reviews r ON r.id=d.approved_review_id AND r.draft_id=d.id AND r.user_id=d.user_id AND r.revision=d.revision AND r.action='approve' AND r.public_payload=d.public_payload
 LEFT JOIN expert_card_material_jobs j ON j.review_id=r.id AND j.draft_id=d.id AND j.user_id=d.user_id AND j.revision=d.revision AND j.status='delivered' AND j.delivery_receipt IS NOT NULL AND j.target_bot_id=d.work_bot_id AND j.target_chat_id=d.work_chat_id
 LEFT JOIN expert_card_material_templates t ON t.id=j.template_id AND t.content_version=j.content_version AND t.status='approved' AND j.expected_message_count=1+jsonb_array_length(t.assets)
 LEFT JOIN expert_card_promo_confirmations p ON p.review_id=r.id AND p.draft_id=d.id AND p.user_id=d.user_id AND p.revision=d.revision AND p.proof_digest=expert_card_proof_digest(d.id,r.id)
 WHERE d.user_id=target_user AND r.id=target_review AND d.status='approved' AND expert_card_current_messaging_authority(d.user_id,d.messaging_policy_version)

 AND EXISTS(SELECT 1 FROM channel_identities ci WHERE ci.user_id=d.user_id AND ci.provider='telegram' AND ci.bot_key=d.work_bot_key AND ci.external_id=d.work_chat_id AND ci.external_chat_id=d.work_chat_id AND ci.status='active')
 AND ((j.id IS NOT NULL AND t.id IS NOT NULL AND p.id IS NOT NULL AND EXISTS(SELECT 1 FROM expert_card_promo_proofs proof WHERE proof.review_id=r.id AND proof.draft_id=d.id)) OR EXISTS(SELECT 1 FROM expert_application_promo_confirmations ap WHERE ap.application_id=a.id AND ap.user_id=d.user_id AND ap.proof_digest=(SELECT 'sha256:'||encode(digest(coalesce(string_agg(proof.id::text||':'||proof.kind||':'||proof.reference,E'\n' ORDER BY proof.created_at,proof.id),''),'sha256'),'hex') FROM expert_application_promo_proofs proof WHERE proof.application_id=a.id AND proof.user_id=d.user_id) AND EXISTS(SELECT 1 FROM expert_application_promo_proofs proof WHERE proof.application_id=a.id AND proof.user_id=d.user_id))))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION expert_card_activation_gate_valid(target_user uuid,target_review uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE r record; assessment jsonb;
BEGIN
 IF target_review IS NULL THEN RETURN false; END IF;
 SELECT * INTO r FROM expert_card_reviews WHERE id=target_review AND user_id=target_user AND action='approve';
 IF NOT FOUND OR r.safety_proof IS NULL THEN RETURN false; END IF;
 assessment:=resident_safety_assess(resident_card_effective_fields(r.draft_id),r.revision);
 IF (assessment->>'blocked')::boolean OR r.safety_proof IS DISTINCT FROM assessment THEN RETURN false; END IF;
 RETURN expert_card_activation_gate_before_safety(target_user,target_review);
END $$;

--> statement-breakpoint
-- Source content-safety-filter.txt A-D plus explicit forbidden tags.
-- Quarantine: malformed «все остальные во\nlаке»: TODO: Wait for Content Spec.
INSERT INTO resident_safety_policies(id) VALUES('61000000-0000-4000-8000-000000000001');
--> statement-breakpoint
INSERT INTO forbidden_patterns(policy_id,pattern_regex,category,severity_level,error_message_template,provenance,positive_witness) VALUES
('61000000-0000-4000-8000-000000000001','\b(вылечу|вылечи|вылечю)\b','MEDICAL_CLAIM','BLOCKER','Уберите обещания лечения и медицинские гарантии. Опишите, с какой темой вы помогаете работать.','content-safety-filter.txt: source rule 1','вылечу рак'),
('61000000-0000-4000-8000-000000000001','\b(избавлю\s+от\s+рака|избавлю\s+от\s+рак|избавлю\s+от\s+диабета|избавлю\s+от\s+диабет|избавлю\s+от\s+гепатита|избавлю\s+от\s+гепатит|избавлю\s+от\s+вич|избавлю\s+от\s+спида|избавлю\s+от\s+спид|избавлю\s+от\s+туберкулеза|избавлю\s+от\s+туберкулез|избавлю\s+от\s+онкологии|избавлю\s+от\s+онкология)\b','MEDICAL_CLAIM','BLOCKER','Уберите обещания лечения и медицинские гарантии. Опишите, с какой темой вы помогаете работать.','content-safety-filter.txt: source rule 2','избавлю от рака'),
('61000000-0000-4000-8000-000000000001','\b(гарантирую\s+результат|гарантирую\s+исцеление|гарантирую\s+излечение)\b','MEDICAL_CLAIM','BLOCKER','Уберите обещания лечения и медицинские гарантии. Опишите, с какой темой вы помогаете работать.','content-safety-filter.txt: source rule 3','гарантирую результат'),
('61000000-0000-4000-8000-000000000001','\b100%\s+эффект\b','MEDICAL_CLAIM','BLOCKER','Уберите обещания лечения и медицинские гарантии. Опишите, с какой темой вы помогаете работать.','content-safety-filter.txt: source rule 4','100% эффект'),
('61000000-0000-4000-8000-000000000001','\bпоможет\s+всегда\b','MEDICAL_CLAIM','BLOCKER','Уберите обещания лечения и медицинские гарантии. Опишите, с какой темой вы помогаете работать.','content-safety-filter.txt: source rule 5','поможет всегда'),
('61000000-0000-4000-8000-000000000001','\bпоставлю\s+диагноз\b','MEDICAL_CLAIM','BLOCKER','Уберите обещания лечения и медицинские гарантии. Опишите, с какой темой вы помогаете работать.','content-safety-filter.txt: source rule 6','поставлю диагноз'),
('61000000-0000-4000-8000-000000000001','\bназначу\s+лекарства\b','MEDICAL_CLAIM','BLOCKER','Уберите обещания лечения и медицинские гарантии. Опишите, с какой темой вы помогаете работать.','content-safety-filter.txt: source rule 7','назначу лекарства'),
('61000000-0000-4000-8000-000000000001','\bпропишу\s+таблетки\b','MEDICAL_CLAIM','BLOCKER','Уберите обещания лечения и медицинские гарантии. Опишите, с какой темой вы помогаете работать.','content-safety-filter.txt: source rule 8','пропишу таблетки'),
('61000000-0000-4000-8000-000000000001','\bмедикаментозное\s+лечение\b','MEDICAL_CLAIM','BLOCKER','Уберите обещания лечения и медицинские гарантии. Опишите, с какой темой вы помогаете работать.','content-safety-filter.txt: source rule 9','медикаментозное лечение'),
('61000000-0000-4000-8000-000000000001','\b(лучше\s+чем\s+врач|замена\s+лекарств|отмена\s+препаратов)\b','MEDICAL_CLAIM','BLOCKER','Уберите обещания лечения и медицинские гарантии. Опишите, с какой темой вы помогаете работать.','content-safety-filter.txt: source rule 10','замена лекарств'),
('61000000-0000-4000-8000-000000000001','\b(заработок\s+\d+[км]\s+в\s+день|заработок\s+\d+[км]\s+в\s+неделю|заработок\s+\d+[км]\s+в\s+месяц)\b','FINANCIAL_GUARANTEE','BLOCKER','Обещания быстрого обогащения и гарантированного дохода запрещены. Уберите гарантию.','content-safety-filter.txt: source rule 11','заработок 100к в день'),
('61000000-0000-4000-8000-000000000001','\bлегкие\s+деньги\b','FINANCIAL_GUARANTEE','BLOCKER','Обещания быстрого обогащения и гарантированного дохода запрещены. Уберите гарантию.','content-safety-filter.txt: source rule 12','легкие деньги'),
('61000000-0000-4000-8000-000000000001','\bсекрет\s+богатства\b','FINANCIAL_GUARANTEE','BLOCKER','Обещания быстрого обогащения и гарантированного дохода запрещены. Уберите гарантию.','content-safety-filter.txt: source rule 13','секрет богатства'),
('61000000-0000-4000-8000-000000000001','\bдоходность\s+\d+%\b','FINANCIAL_GUARANTEE','BLOCKER','Обещания быстрого обогащения и гарантированного дохода запрещены. Уберите гарантию.','content-safety-filter.txt: source rule 14','доходность 100%'),
('61000000-0000-4000-8000-000000000001','\bгарантированный\s+доход\b','FINANCIAL_GUARANTEE','BLOCKER','Обещания быстрого обогащения и гарантированного дохода запрещены. Уберите гарантию.','content-safety-filter.txt: source rule 15','гарантированный доход'),
('61000000-0000-4000-8000-000000000001','\bбезрисковые\s+инвестиции\b','FINANCIAL_GUARANTEE','BLOCKER','Обещания быстрого обогащения и гарантированного дохода запрещены. Уберите гарантию.','content-safety-filter.txt: source rule 16','безрисковые инвестиции'),
('61000000-0000-4000-8000-000000000001','\bкрипто\s+сигналы\s+100%\b','FINANCIAL_GUARANTEE','BLOCKER','Обещания быстрого обогащения и гарантированного дохода запрещены. Уберите гарантию.','content-safety-filter.txt: source rule 17','крипто сигналы 100%'),
('61000000-0000-4000-8000-000000000001','\b(схема\s+обогащения|пирамида|mlm\s+структура|сетевой\s+маркетинг\s+гарантия)\b','FINANCIAL_GUARANTEE','BLOCKER','Обещания быстрого обогащения и гарантированного дохода запрещены. Уберите гарантию.','content-safety-filter.txt: source rule 18','MLM структура'),
('61000000-0000-4000-8000-000000000001','\bтолько\s+мы\s+спасем\b','POLITICAL_RELIGIOUS','WARNING','Чувствительная формулировка требует личного рассмотрения менеджером.','content-safety-filter.txt: source rule 19','только мы спасем'),
('61000000-0000-4000-8000-000000000001','\b(религиозная\s+истина\s+единственная|религиозная\s+истина\s+единственнaя)\b','POLITICAL_RELIGIOUS','WARNING','Чувствительная формулировка требует личного рассмотрения менеджером.','content-safety-filter.txt: source rule 20','религиозная истина единственнaя'),
('61000000-0000-4000-8000-000000000001','\b(голосуйте\s+за|бойкот|санкции\s+против|революция)\b','POLITICAL_RELIGIOUS','WARNING','Чувствительная формулировка требует личного рассмотрения менеджером.','content-safety-filter.txt: source rule 21','голосуйте за'),
('61000000-0000-4000-8000-000000000001','\b(приворот|отворот|порча|сглаз\s+снятие|воздействие\s+на\s+волю)\b','POLITICAL_RELIGIOUS','WARNING','Чувствительная формулировка требует личного рассмотрения менеджером.','content-safety-filter.txt: source rule 22','#приворот'),
('61000000-0000-4000-8000-000000000001','\bжиды\b','HATE_SPEECH','BLOCKER','Использование оскорбительной лексики запрещено. Измените формулировку.','content-safety-filter.txt: source rule 23','жиды'),
('61000000-0000-4000-8000-000000000001','\bпидорасы\b','HATE_SPEECH','BLOCKER','Использование оскорбительной лексики запрещено. Измените формулировку.','content-safety-filter.txt: source rule 24','пидорасы'),
('61000000-0000-4000-8000-000000000001','\bшлюхи\b','HATE_SPEECH','BLOCKER','Использование оскорбительной лексики запрещено. Измените формулировку.','content-safety-filter.txt: source rule 25','шлюхи'),
('61000000-0000-4000-8000-000000000001','\bуроды\b','HATE_SPEECH','BLOCKER','Использование оскорбительной лексики запрещено. Измените формулировку.','content-safety-filter.txt: source rule 26','уроды'),
('61000000-0000-4000-8000-000000000001','\bдеграданты\b','HATE_SPEECH','BLOCKER','Использование оскорбительной лексики запрещено. Измените формулировку.','content-safety-filter.txt: source rule 27','деграданты'),
('61000000-0000-4000-8000-000000000001','bit\.ly','SPAM_SCAM','BLOCKER','Уберите запрещённый тег, сокращатель ссылки или приглашение в стороннюю группу.','content-safety-filter.txt: source rule 28','bit.lyexample'),
('61000000-0000-4000-8000-000000000001','tinyurl','SPAM_SCAM','BLOCKER','Уберите запрещённый тег, сокращатель ссылки или приглашение в стороннюю группу.','content-safety-filter.txt: source rule 29','tinyurlexample'),
('61000000-0000-4000-8000-000000000001','cut\.cc','SPAM_SCAM','BLOCKER','Уберите запрещённый тег, сокращатель ссылки или приглашение в стороннюю группу.','content-safety-filter.txt: source rule 30','cut.ccexample'),
('61000000-0000-4000-8000-000000000001','t\.me/joinchat/','SPAM_SCAM','BLOCKER','Уберите запрещённый тег, сокращатель ссылки или приглашение в стороннюю группу.','content-safety-filter.txt: source rule 31','t.me/joinchat/example'),
('61000000-0000-4000-8000-000000000001','#лечениерака','SPAM_SCAM','BLOCKER','Уберите запрещённый тег, сокращатель ссылки или приглашение в стороннюю группу.','content-safety-filter.txt: source rule 32','#лечениерака'),
('61000000-0000-4000-8000-000000000001','#быстрые_деньги','SPAM_SCAM','BLOCKER','Уберите запрещённый тег, сокращатель ссылки или приглашение в стороннюю группу.','content-safety-filter.txt: source rule 33','#быстрые_деньги'),
('61000000-0000-4000-8000-000000000001','\b(избавлю\s+от\s+туберкулёза|избавлю\s+от\s+туберкулёз)\b','MEDICAL_CLAIM','BLOCKER','Уберите обещания лечения и медицинские гарантии. Опишите, с какой темой вы помогаете работать.','content-safety-filter.txt: source rule 34','избавлю от туберкулёза'),
('61000000-0000-4000-8000-000000000001','\bлёгкие\s+деньги\b','FINANCIAL_GUARANTEE','BLOCKER','Обещания быстрого обогащения и гарантированного дохода запрещены. Уберите гарантию.','content-safety-filter.txt: source rule 35','лёгкие деньги');
--> statement-breakpoint
UPDATE forbidden_patterns SET compiled=resident_safety_compile(pattern_regex) WHERE policy_id='61000000-0000-4000-8000-000000000001';
--> statement-breakpoint
-- The sole bootstrap publication precedes installation of the authorization triggers.
INSERT INTO resident_safety_publications(id,policy_id) VALUES('61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001');
--> statement-breakpoint
UPDATE resident_safety_policies SET published_at=clock_timestamp(),first_publication_id='61000000-0000-4000-8000-000000000002' WHERE id='61000000-0000-4000-8000-000000000001';
--> statement-breakpoint
INSERT INTO resident_safety_active(id,policy_id,publication_id) VALUES(1,'61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002');
--> statement-breakpoint
CREATE FUNCTION resident_safety_subject_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM expert_card_drafts d JOIN users u ON u.id=d.user_id AND u.active WHERE d.id=NEW.draft_id AND d.user_id=NEW.user_id) THEN RAISE EXCEPTION 'resident_safety_subject_unavailable'; END IF;
 IF TG_TABLE_NAME='security_logs' THEN
  IF NOT EXISTS(SELECT 1 FROM resident_safety_outcomes o WHERE o.id=NEW.outcome_id AND o.user_id=NEW.user_id AND o.draft_id=NEW.draft_id AND o.policy_id=NEW.policy_id AND o.revision=NEW.revision) THEN RAISE EXCEPTION 'resident_safety_incident_source'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_safety_outcome_subject BEFORE INSERT ON resident_safety_outcomes FOR EACH ROW EXECUTE FUNCTION resident_safety_subject_guard();
--> statement-breakpoint
CREATE TRIGGER resident_safety_log_subject BEFORE INSERT ON security_logs FOR EACH ROW EXECUTE FUNCTION resident_safety_subject_guard();
--> statement-breakpoint
CREATE FUNCTION resident_safety_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; n integer; next_generation bigint; old_generation bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'resident_safety_publication_required'; END IF;
 SELECT generation INTO next_generation FROM resident_safety_publications WHERE id=NEW.publication_id AND policy_id=NEW.policy_id AND transaction_id=txid_current();
 IF TG_OP='UPDATE' THEN SELECT generation INTO old_generation FROM resident_safety_publications WHERE id=OLD.publication_id; END IF;
 IF next_generation IS NULL OR next_generation IS DISTINCT FROM (SELECT max(generation) FROM resident_safety_publications) OR (TG_OP='UPDATE' AND next_generation<=old_generation) THEN RAISE EXCEPTION 'resident_safety_publication_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM resident_safety_policies WHERE id=NEW.policy_id AND engine='resident_safe_regex_v1' AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'resident_safety_policy_invalid'; END IF;
 SELECT count(*) INTO n FROM forbidden_patterns WHERE policy_id=NEW.policy_id AND is_active;
 IF n<1 OR n>256 THEN RAISE EXCEPTION 'resident_safety_policy_invalid'; END IF;
 FOR r IN SELECT * FROM forbidden_patterns WHERE policy_id=NEW.policy_id LOOP
  IF r.compiled IS DISTINCT FROM resident_safety_compile(r.pattern_regex) OR NOT resident_safety_matches(r.positive_witness,r.compiled) THEN RAISE EXCEPTION 'resident_safety_policy_invalid'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_safety_active_valid BEFORE INSERT OR UPDATE OR DELETE ON resident_safety_active FOR EACH ROW EXECUTE FUNCTION resident_safety_activation_guard();

--> statement-breakpoint
CREATE FUNCTION resident_safety_publication_authorize() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; compiled_rule jsonb; n integer; already_published boolean;
BEGIN
 IF NEW.manager_id IS NULL OR NEW.manager_session_hash IS NULL OR NOT expert_card_manager_authority_valid(NEW.manager_id,NEW.manager_session_hash) THEN RAISE EXCEPTION 'resident_safety_policy_forbidden'; END IF;
 PERFORM 1 FROM admin_sessions s JOIN admin_role_assignments a ON a.admin_id=s.admin_id WHERE s.session_id_hash=NEW.manager_session_hash AND s.admin_id=NEW.manager_id AND a.role='security_admin' FOR SHARE OF s,a;
 IF NOT FOUND OR NOT expert_card_manager_authority_valid(NEW.manager_id,NEW.manager_session_hash) THEN RAISE EXCEPTION 'resident_safety_policy_forbidden'; END IF;
 PERFORM 1 FROM resident_safety_active WHERE id=1 FOR UPDATE;
 SELECT published_at IS NOT NULL INTO already_published FROM resident_safety_policies WHERE id=NEW.policy_id AND engine='resident_safe_regex_v1' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'resident_safety_policy_invalid'; END IF;
 SELECT count(*) INTO n FROM forbidden_patterns WHERE policy_id=NEW.policy_id AND is_active;
 IF n<1 OR n>256 THEN RAISE EXCEPTION 'resident_safety_policy_invalid'; END IF;
 FOR r IN SELECT * FROM forbidden_patterns WHERE policy_id=NEW.policy_id LOOP
  compiled_rule:=resident_safety_compile(r.pattern_regex);
  IF NOT resident_safety_matches(r.positive_witness,compiled_rule) THEN RAISE EXCEPTION 'resident_safety_witness_invalid'; END IF;
  IF already_published THEN
   IF r.compiled IS DISTINCT FROM compiled_rule THEN RAISE EXCEPTION 'resident_safety_policy_corrupt'; END IF;
  ELSE UPDATE forbidden_patterns SET compiled=compiled_rule WHERE id=r.id;
  END IF;
 END LOOP;
 NEW.transaction_id:=txid_current(); NEW.created_at:=clock_timestamp();
 NEW.generation:=nextval(pg_get_serial_sequence('resident_safety_publications','generation'));
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_safety_publication_apply() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE resident_safety_policies SET published_at=NEW.created_at,first_publication_id=NEW.id WHERE id=NEW.policy_id AND published_at IS NULL;
 INSERT INTO resident_safety_active(id,policy_id,publication_id) VALUES(1,NEW.policy_id,NEW.id) ON CONFLICT(id) DO UPDATE SET policy_id=excluded.policy_id,publication_id=excluded.publication_id;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_safety_publication_authorize BEFORE INSERT ON resident_safety_publications FOR EACH ROW EXECUTE FUNCTION resident_safety_publication_authorize();
--> statement-breakpoint
CREATE TRIGGER resident_safety_publication_apply AFTER INSERT ON resident_safety_publications FOR EACH ROW EXECUTE FUNCTION resident_safety_publication_apply();
--> statement-breakpoint
CREATE TRIGGER resident_safety_publication_immutable BEFORE UPDATE OR DELETE ON resident_safety_publications FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TABLE resident_card_proposal_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id), revision integer NOT NULL CHECK(revision>0),
 previous_proposal jsonb NOT NULL, replacement_proposal jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(draft_id,revision)
);
--> statement-breakpoint
CREATE FUNCTION resident_card_proposal_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM expert_card_drafts d JOIN users u ON u.id=d.user_id AND u.active WHERE d.id=NEW.draft_id AND d.user_id=NEW.user_id AND d.revision+1=NEW.revision AND d.document_proposal=NEW.previous_proposal AND d.status IN('collecting','changes_requested') AND expert_card_current_messaging_authority(d.user_id,d.messaging_policy_version)) THEN RAISE EXCEPTION 'resident_card_proposal_source'; END IF;
 IF (SELECT count(*) FROM resident_card_proposal_changes WHERE draft_id=NEW.draft_id)>=10000 THEN RAISE EXCEPTION 'resident_safety_budget'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_card_proposal_source BEFORE INSERT ON resident_card_proposal_changes FOR EACH ROW EXECUTE FUNCTION resident_card_proposal_change_guard();
--> statement-breakpoint
CREATE TRIGGER resident_card_proposal_immutable BEFORE UPDATE ON resident_card_proposal_changes FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
