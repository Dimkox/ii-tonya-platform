-- Public catalogue extension; historical seed bytes remain unchanged.
ALTER TABLE hashtags_db ADD COLUMN synonym_provenance jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE hashtags_db SET synonyms_json=synonyms_json||'[{"term":"тревога"}]'::jsonb,
 synonym_provenance='[{"term":"тревога","source":"hashtaxonomy-v2.txt section3 exact example","approved":"spec-residency-semantic-tags 2026-10-27"}]'::jsonb WHERE tag_value='тревожность';
--> statement-breakpoint
CREATE FUNCTION resident_tag_normalize(v text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT btrim(regexp_replace(translate(lower(normalize(v,NFKC)),'ё#_','е  '),'[[:space:]]+',' ','g'))
$$;
--> statement-breakpoint
CREATE FUNCTION resident_tag_identity(v text) RETURNS text LANGUAGE sql STABLE STRICT AS $$
 SELECT coalesce((SELECT 'catalogue:'||h.id::text FROM hashtags_db h WHERE resident_tag_normalize(v)=resident_tag_normalize(h.tag_value) OR resident_tag_normalize(v)=resident_tag_normalize(h.display_label) OR EXISTS(SELECT 1 FROM jsonb_array_elements(h.synonyms_json) s WHERE resident_tag_normalize(v)=resident_tag_normalize(s->>'term')) ORDER BY h.id LIMIT 1),'custom:'||resident_tag_normalize(v))
$$;
--> statement-breakpoint
CREATE FUNCTION resident_tag_labels_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE t jsonb;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>20 THEN RETURN false; END IF;
 FOR t IN SELECT value FROM jsonb_array_elements(v) LOOP
  IF jsonb_typeof(t)<>'string' OR length(t#>>'{}')>80 OR length(resident_tag_normalize(t#>>'{}'))<1 OR (t#>>'{}') !~ '^[[:alnum:]#_ +./()-]+$' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
--> statement-breakpoint
ALTER TABLE expert_card_drafts ADD COLUMN semantic_tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(resident_tag_labels_valid(semantic_tags)),
 ADD COLUMN tag_preview jsonb CHECK(tag_preview IS NULL OR (jsonb_typeof(tag_preview)='object' AND octet_length(tag_preview::text)<=20000));
--> statement-breakpoint
CREATE FUNCTION resident_selected_tags(d expert_card_drafts) RETURNS TABLE(identity text,label text) LANGUAGE sql STABLE AS $$
 SELECT DISTINCT resident_tag_identity(t),t FROM (
 SELECT jsonb_array_elements_text(d.semantic_tags) t
 UNION ALL SELECT jsonb_array_elements_text(coalesce(s->'tags','[]')) FROM jsonb_array_elements(coalesce(d.rich_profile->'services','[]')) s
 UNION ALL SELECT jsonb_array_elements_text(coalesce(d.rich_guided->'tags','[]'))
 UNION ALL SELECT jsonb_array_elements_text(coalesce(s->'tags','[]')) FROM jsonb_array_elements(d.rich_pending_services) s
 UNION ALL SELECT h.display_label FROM expert_card_draft_tags dt JOIN hashtags_db h ON h.id=dt.tag_id WHERE dt.draft_id=d.id
 ) x
$$;
--> statement-breakpoint
CREATE TABLE resident_tag_decisions (
 draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision>=0), identity text NOT NULL CHECK(length(identity) BETWEEN 1 AND 200),
 decision text NOT NULL CHECK(decision IN('approve','reject')), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 manager_id uuid NOT NULL REFERENCES users(id), session_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(draft_id,revision,identity)
);
--> statement-breakpoint
CREATE FUNCTION resident_tag_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d expert_card_drafts;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'tag_decision_immutable'; END IF;
 SELECT * INTO d FROM expert_card_drafts WHERE id=NEW.draft_id FOR UPDATE;
 IF d.revision<>NEW.revision OR d.status NOT IN('collecting','changes_requested','manager_review') OR NOT EXISTS(SELECT 1 FROM resident_selected_tags(d) t WHERE t.identity=NEW.identity AND t.identity LIKE 'custom:%') THEN RAISE EXCEPTION 'tag_decision_source'; END IF;
 PERFORM 1 FROM admin_sessions s JOIN users u ON u.id=s.admin_id JOIN admin_role_assignments r ON r.admin_id=s.admin_id AND r.role IN('support','security_admin') WHERE s.session_id_hash=NEW.session_hash AND s.admin_id=NEW.manager_id FOR SHARE OF s,u,r;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM admin_sessions s JOIN users u ON u.id=s.admin_id AND u.active WHERE s.session_id_hash=NEW.session_hash AND s.admin_id=NEW.manager_id AND s.revoked_at IS NULL AND isfinite(s.expires_at) AND isfinite(s.mfa_verified_at) AND s.expires_at>clock_timestamp() AND s.mfa_verified_at<=clock_timestamp() AND s.mfa_verified_at>=clock_timestamp()-interval '15 minutes') THEN RAISE EXCEPTION 'verification_forbidden'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_tag_decision_source BEFORE INSERT OR UPDATE ON resident_tag_decisions FOR EACH ROW EXECUTE FUNCTION resident_tag_decision_guard();
--> statement-breakpoint
CREATE FUNCTION resident_tag_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.semantic_tags IS DISTINCT FROM OLD.semantic_tags THEN
  IF NEW.revision<=OLD.revision OR NEW.status NOT IN('collecting','changes_requested') THEN RAISE EXCEPTION 'tag_revision_required'; END IF;
  NEW.owner_confirmed_digest:=NULL; NEW.preview_page:=NULL; NEW.preview_token_digest:=NULL; NEW.preview_content_digest:=NULL; NEW.approved_review_id:=NULL;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.revision<>OLD.revision OR NEW.rich_profile IS DISTINCT FROM OLD.rich_profile OR NEW.rich_guided IS DISTINCT FROM OLD.rich_guided OR NEW.rich_pending_services IS DISTINCT FROM OLD.rich_pending_services OR NEW.semantic_tags IS DISTINCT FROM OLD.semantic_tags) THEN NEW.tag_preview:=NULL; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_tag_before_write BEFORE INSERT OR UPDATE ON expert_card_drafts FOR EACH ROW EXECUTE FUNCTION resident_tag_before_write();
--> statement-breakpoint
-- Repair comparisons retain every non-selection answer and count scoped occurrences.
CREATE FUNCTION resident_tag_nonselection_content(d expert_card_drafts) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT (to_jsonb(d)-ARRAY['semantic_tags','tag_preview','revision','status','owner_confirmed_digest','preview_page','preview_token_digest','preview_content_digest','approved_review_id','updated_at']) || jsonb_build_object(
 'rich_profile',CASE WHEN d.rich_profile IS NULL THEN NULL ELSE jsonb_set(d.rich_profile,'{services}',coalesce((SELECT jsonb_agg(s-'tags' ORDER BY n) FROM jsonb_array_elements(d.rich_profile->'services') WITH ORDINALITY a(s,n)),'[]')) END,
 'rich_guided',d.rich_guided-'tags','rich_pending_services',coalesce((SELECT jsonb_agg(s-'tags' ORDER BY n) FROM jsonb_array_elements(d.rich_pending_services) WITH ORDINALITY a(s,n)),'[]'))
$$;
--> statement-breakpoint
CREATE FUNCTION resident_tag_selection_items(d expert_card_drafts) RETURNS TABLE(scope text,label text) LANGUAGE sql STABLE AS $$
 SELECT 'profile',jsonb_array_elements_text(d.semantic_tags)
 UNION ALL SELECT 'guided',jsonb_array_elements_text(coalesce(d.rich_guided->'tags','[]'))
 UNION ALL SELECT 'service:'||n,jsonb_array_elements_text(coalesce(s->'tags','[]')) FROM jsonb_array_elements(coalesce(d.rich_profile->'services','[]')) WITH ORDINALITY a(s,n)
 UNION ALL SELECT 'pending:'||n,jsonb_array_elements_text(coalesce(s->'tags','[]')) FROM jsonb_array_elements(d.rich_pending_services) WITH ORDINALITY a(s,n)
 UNION ALL SELECT 'catalogue:'||h.id,h.display_label FROM expert_card_draft_tags t JOIN hashtags_db h ON h.id=t.tag_id WHERE t.draft_id=d.id
$$;
--> statement-breakpoint
CREATE FUNCTION resident_tag_obsolete(label text) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 RETURN EXISTS(SELECT 1 FROM hashtags_db h WHERE resident_tag_identity(label)='catalogue:'||h.id::text AND NOT h.is_active)
 OR (resident_safety_assess(jsonb_build_object('tag',label),0)->>'blocked')::boolean;
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_tag_repair_allowed(previous expert_card_drafts,current_draft expert_card_drafts) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT current_draft.status IN('collecting','changes_requested') AND current_draft.owner_confirmed_digest IS NULL
 AND resident_tag_nonselection_content(previous)=resident_tag_nonselection_content(current_draft)
 AND NOT EXISTS(SELECT * FROM resident_tag_selection_items(current_draft) EXCEPT ALL SELECT * FROM resident_tag_selection_items(previous))
 AND EXISTS(SELECT 1 FROM (SELECT * FROM resident_tag_selection_items(previous) EXCEPT ALL SELECT * FROM resident_tag_selection_items(current_draft)) removed WHERE resident_tag_obsolete(label))
$$;
--> statement-breakpoint
CREATE FUNCTION resident_tag_unselected_safe(d expert_card_drafts) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE fields jsonb:='{}'; f record;
BEGIN
 FOR f IN SELECT * FROM jsonb_each_text(resident_card_pre_semantic_fields(d.id)) LOOP
  IF f.key LIKE 'tag:%' THEN CONTINUE; END IF;
  fields:=fields||jsonb_build_object(f.key,CASE WHEN f.key='rich:guided' OR f.key LIKE 'rich:service:%' OR f.key LIKE 'rich:pending:%' THEN (f.value::jsonb-'tags')::text ELSE f.value END);
 END LOOP;
 RETURN NOT (resident_safety_assess(fields,d.revision)->>'blocked')::boolean;
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_tag_aggregate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d expert_card_drafts; total integer; old_total integer; assessment jsonb; selected jsonb; decreasing boolean:=false; invalid_selection boolean; repair boolean:=false;
BEGIN
 IF TG_TABLE_NAME='expert_card_drafts' THEN
  -- A read-only proposal may expose obsolete/over-limit selections for removal,
  -- but it cannot change owner/manager confirmation or selected content.
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['tag_preview','updated_at'])=(to_jsonb(OLD)-ARRAY['tag_preview','updated_at']) THEN RETURN NULL; END IF;
  -- Immutable approved history may exceed the new aggregate20. It is not rewritten.
  IF TG_OP='UPDATE' AND NEW.status='approved' AND OLD.status='approved' AND NEW.revision=OLD.revision AND NEW.rich_profile IS NOT DISTINCT FROM OLD.rich_profile AND NEW.rich_guided IS NOT DISTINCT FROM OLD.rich_guided AND NEW.rich_pending_services IS NOT DISTINCT FROM OLD.rich_pending_services AND NEW.semantic_tags=OLD.semantic_tags THEN RETURN NULL; END IF;
  -- Reopening changes no selected content. Any catalogue DELETE is independently
  -- checked with its authoritative OLD row. Equal-value content assignments still
  -- fire the separate strict trigger and cannot confirm an invalid selection.
  IF TG_NAME='resident_tag_aggregate_status' AND TG_OP='UPDATE' AND OLD.status='approved' AND NEW.status='collecting' AND NEW.revision=OLD.revision+1 AND NEW.owner_confirmed_digest IS NULL AND NEW.approved_review_id IS NULL
   AND (to_jsonb(NEW)-ARRAY['revision','status','owner_confirmed_digest','approved_review_id','tag_preview','preview_page','preview_token_digest','preview_content_digest','updated_at'])=(to_jsonb(OLD)-ARRAY['revision','status','owner_confirmed_digest','approved_review_id','tag_preview','preview_page','preview_token_digest','preview_content_digest','updated_at']) THEN RETURN NULL; END IF;
  SELECT * INTO d FROM expert_card_drafts WHERE id=NEW.id FOR UPDATE;
 ELSE SELECT * INTO d FROM expert_card_drafts WHERE id=coalesce(NEW.draft_id,OLD.draft_id) FOR UPDATE;
 END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT count(DISTINCT identity),jsonb_build_object('selected:tags',coalesce(jsonb_agg(jsonb_build_object('identity',identity,'label',label) ORDER BY identity,label),'[]')::text) INTO total,selected FROM resident_selected_tags(d);
 IF EXISTS(SELECT 1 FROM resident_selected_tags(d) t WHERE NOT resident_tag_labels_valid(jsonb_build_array(t.label))) THEN RAISE EXCEPTION 'card_invalid_tags'; END IF;
 IF total>20 THEN
  -- Grandfathered history can be reduced across several scopes without a deadlock.
  -- Only subset removals (or preview-only reads) are allowed; confirmation/review
  -- and any addition remain blocked until the total is at most20.
  IF TG_TABLE_NAME='expert_card_drafts' AND TG_OP='UPDATE' AND d.status IN('collecting','changes_requested') AND d.owner_confirmed_digest IS NULL THEN
   SELECT count(DISTINCT identity) INTO old_total FROM resident_selected_tags(OLD);
   decreasing:=(old_total>total AND NOT EXISTS(SELECT * FROM resident_tag_selection_items(d) EXCEPT ALL SELECT * FROM resident_tag_selection_items(OLD))) OR resident_tag_repair_allowed(OLD,d);
   decreasing:=decreasing OR (old_total=total AND NEW.revision=OLD.revision AND NEW.status=OLD.status AND NEW.rich_profile IS NOT DISTINCT FROM OLD.rich_profile AND NEW.rich_guided IS NOT DISTINCT FROM OLD.rich_guided AND NEW.rich_pending_services IS NOT DISTINCT FROM OLD.rich_pending_services AND NEW.semantic_tags=OLD.semantic_tags AND NEW.public_payload IS NOT DISTINCT FROM OLD.public_payload AND NEW.owner_confirmed_digest IS NOT DISTINCT FROM OLD.owner_confirmed_digest);
  END IF;
  IF TG_TABLE_NAME='expert_card_drafts' THEN decreasing:=decreasing AND resident_tag_nonselection_content(OLD)=resident_tag_nonselection_content(d);
  ELSIF TG_OP='DELETE' AND d.status IN('collecting','changes_requested') AND d.owner_confirmed_digest IS NULL THEN decreasing:=resident_tag_unselected_safe(d); END IF;
  IF NOT decreasing THEN RAISE EXCEPTION 'card_tag_aggregate_limit:%/20; reduce selections explicitly',total; END IF;
 END IF;
 invalid_selection:=EXISTS(SELECT 1 FROM resident_selected_tags(d) t JOIN hashtags_db h ON t.identity='catalogue:'||h.id::text WHERE NOT h.is_active);
 assessment:=resident_safety_assess(selected,d.revision);
 IF invalid_selection OR (assessment->>'blocked')::boolean THEN
  IF TG_TABLE_NAME='expert_card_drafts' AND TG_OP='UPDATE' THEN
   repair:=resident_tag_repair_allowed(OLD,d);
  ELSIF TG_TABLE_NAME='expert_card_draft_tags' AND TG_OP='DELETE' THEN
   repair:=d.status IN('collecting','changes_requested') AND d.owner_confirmed_digest IS NULL
    AND resident_tag_obsolete((SELECT display_label FROM hashtags_db WHERE id=OLD.tag_id));
  END IF;
  IF repair AND resident_tag_unselected_safe(d) THEN RETURN NULL; END IF;
  IF invalid_selection THEN RAISE EXCEPTION 'card_inactive_tag'; END IF;
  RAISE EXCEPTION 'resident_safety_write_blocked';
 END IF;
 IF d.status='approved' AND EXISTS(SELECT 1 FROM resident_selected_tags(d) t WHERE t.identity LIKE 'custom:%' AND NOT EXISTS(SELECT 1 FROM resident_tag_decisions c WHERE c.draft_id=d.id AND c.revision=d.revision AND c.identity=t.identity AND c.decision='approve')) THEN RAISE EXCEPTION 'card_custom_tags_pending'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
-- Selection/answer/confirmation writes are checked even when SET assigns an equal
-- value. A catalogue deletion separately validates its OLD tag; its revision-only
-- housekeeping cannot add content or confirm a card and does not need this trigger.
CREATE CONSTRAINT TRIGGER resident_tag_aggregate_draft AFTER INSERT OR UPDATE OF semantic_tags,rich_mode,rich_profile,rich_guided,rich_pending_services,rich_proposal,owner_confirmed_digest,public_payload,input_mode,document_proposal,document_import_revision,user_id,application_id,messaging_policy_version,work_bot_id,work_bot_key,work_chat_id ON expert_card_drafts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION resident_tag_aggregate_guard();
CREATE CONSTRAINT TRIGGER resident_tag_aggregate_status AFTER UPDATE OF status ON expert_card_drafts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION resident_tag_aggregate_guard();
CREATE CONSTRAINT TRIGGER resident_tag_aggregate_selection AFTER INSERT OR UPDATE OR DELETE ON expert_card_draft_tags DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION resident_tag_aggregate_guard();
--> statement-breakpoint
ALTER FUNCTION resident_card_effective_fields(uuid) RENAME TO resident_card_pre_semantic_fields;
CREATE FUNCTION resident_card_effective_fields(target uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE d expert_card_drafts; fields jsonb;
BEGIN
 SELECT * INTO d FROM expert_card_drafts WHERE id=target;
 SELECT jsonb_build_object('selected:tags',coalesce(jsonb_agg(jsonb_build_object('identity',identity,'label',label) ORDER BY identity,label),'[]')::text) INTO fields FROM resident_selected_tags(d);
 RETURN resident_card_pre_semantic_fields(target)||fields;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_rich_digest(d expert_card_drafts) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(digest((jsonb_build_object('revision',d.revision,'profile',d.rich_profile,'public',d.public_payload,'proposal',d.rich_proposal,'guided',d.rich_guided)||CASE WHEN d.rich_pending_services='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('pending',d.rich_pending_services) END||CASE WHEN d.semantic_tags='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('tags',d.semantic_tags) END)::text,'sha256'),'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION resident_tag_cache_valid(c jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r jsonb; v jsonb; norm double precision; x double precision;
BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR octet_length(c::text)>10000000 OR jsonb_typeof(c->'vectors') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'vectors') NOT BETWEEN 1 AND 16384 THEN RETURN false; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(c->'vectors') LOOP
  IF jsonb_typeof(r->'vector') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'vector')<>300 THEN RETURN false; END IF;
  norm:=0;
  FOR v IN SELECT value FROM jsonb_array_elements(r->'vector') LOOP
   IF jsonb_typeof(v)<>'number' THEN RETURN false; END IF;
   x:=(v#>>'{}')::double precision;
   IF x NOT BETWEEN -1 AND 1 THEN RETURN false; END IF;
   norm:=norm+x*x;
  END LOOP;
  IF abs(norm-1)>.0001 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE TABLE tag_embeddings_cache (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 generation text NOT NULL CHECK(generation~'^[0-9a-f]{64}$'), model_digest text NOT NULL CHECK(model_digest~'^[0-9a-f]{64}$'),
 taxonomy_digest text NOT NULL CHECK(taxonomy_digest~'^[0-9a-f]{64}$'),
 cache jsonb NOT NULL CHECK(resident_tag_cache_valid(cache)),
 CHECK(cache->>'generation' IS NOT DISTINCT FROM generation AND cache->>'model' IS NOT DISTINCT FROM model_digest)
);

--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_rich_write_safety() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fields jsonb; s jsonb; i integer:=0; assessment jsonb;
BEGIN
 IF NOT NEW.rich_mode OR (TG_OP='UPDATE' AND NEW.rich_profile IS NOT DISTINCT FROM OLD.rich_profile AND NEW.rich_guided IS NOT DISTINCT FROM OLD.rich_guided AND NEW.rich_pending_services IS NOT DISTINCT FROM OLD.rich_pending_services) THEN RETURN NEW; END IF;
 fields:=jsonb_build_object('rich:guided',NEW.rich_guided::text)||jsonb_build_object('rich:profile',(NEW.rich_profile-'services'-'photos')::text);
 FOR s IN SELECT value FROM jsonb_array_elements(NEW.rich_profile->'services') LOOP fields:=fields||jsonb_build_object('rich:service:'||i,s::text); i:=i+1; END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(NEW.rich_pending_services) LOOP fields:=fields||jsonb_build_object('rich:pending:'||i,s::text); i:=i+1; END LOOP;
 assessment:=resident_safety_assess(fields,NEW.revision);
 IF (assessment->>'blocked')::boolean AND NOT (TG_OP='UPDATE' AND resident_tag_repair_allowed(OLD,NEW) AND resident_tag_unselected_safe(OLD)) THEN RAISE EXCEPTION 'resident_safety_write_blocked'; END IF;
 RETURN NEW;
END $$;
