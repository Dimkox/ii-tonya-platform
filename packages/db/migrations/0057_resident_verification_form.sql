-- Separate pre-price intake; no financial rows or prompt history are rewritten.
CREATE FUNCTION resident_verification_draft_valid(d jsonb, complete boolean DEFAULT false, education_requirement text DEFAULT 'unknown_manual_review') RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v jsonb; item jsonb; roles jsonb;
BEGIN
 IF d IS NULL OR jsonb_typeof(d)<>'object' OR octet_length(d::text)>100000 THEN RETURN false; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(d) LOOP
  IF k IN ('primaryRole','category','tax') THEN
   IF jsonb_typeof(v)<>'string' THEN RETURN false; END IF;
   IF k='primaryRole' AND v#>>'{}' NOT IN ('EXPERT','CENTER','ORGANIZER','EDU_PROJECT','ESOTERIC','OTHER') THEN RETURN false; END IF;
   IF k='category' AND v#>>'{}' NOT IN ('BASIC','EXCLUSIVE','BOTH') THEN RETURN false; END IF;
   IF k='tax' AND v#>>'{}' NOT IN ('SELF_EMPLOYED','IP','LLC','INDIVIDUAL') THEN RETURN false; END IF;
  ELSIF k IN ('roles','socialLinks','amenities','education','propertyEvidence') THEN
   IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>(CASE WHEN k='roles' THEN 6 ELSE 10 END) THEN RETURN false; END IF;
   IF k='roles' AND jsonb_array_length(v)=0 THEN RETURN false; END IF;
   IF k IN ('roles','socialLinks','amenities') AND (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(v)) THEN RETURN false; END IF;
   FOR item IN SELECT * FROM jsonb_array_elements(v) LOOP
    IF k IN ('education','propertyEvidence') THEN
     IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['kind','fileId','mimeType','size'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) key WHERE key NOT IN ('kind','fileId','mimeType','size','caption')) THEN RETURN false; END IF;
     IF jsonb_typeof(item->'kind')<>'string' OR item->>'kind' NOT IN ('photo','document') OR jsonb_typeof(item->'fileId')<>'string' OR (length(item->>'fileId') NOT BETWEEN 1 AND 512 OR item->>'fileId' !~ '^[A-Za-z0-9_-]+$') OR (jsonb_typeof(item->'mimeType')<>'null' AND (jsonb_typeof(item->'mimeType')<>'string' OR item->>'mimeType' NOT IN ('image/jpeg','image/png','application/pdf'))) OR (item->>'kind'='photo' AND item->>'mimeType'<>'image/jpeg') OR (jsonb_typeof(item->'size')<>'null' AND (jsonb_typeof(item->'size')<>'number' OR item->>'size' !~ '^[0-9]+$' OR (item->>'size')::numeric NOT BETWEEN 1 AND 20971520)) THEN RETURN false; END IF;
     IF item ? 'caption' AND (jsonb_typeof(item->'caption')<>'string' OR length(item->>'caption')>3000) THEN RETURN false; END IF;
    ELSE
     IF jsonb_typeof(item)<>'string' THEN RETURN false; END IF;
     IF k='roles' AND item#>>'{}' NOT IN ('EXPERT','CENTER','ORGANIZER','EDU_PROJECT','ESOTERIC','OTHER') THEN RETURN false; END IF;
     IF k='socialLinks' AND (length(item#>>'{}')>500 OR item#>>'{}' !~ '^https://[^/@[:space:]]+[^[:space:]]*$') THEN RETURN false; END IF;
     IF k='amenities' AND length(btrim(item#>>'{}')) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
    END IF;
   END LOOP;
  ELSIF k IN ('city','motivation','specialization','path','cases') THEN
   IF jsonb_typeof(v)<>'string' OR length(btrim(v#>>'{}'))<1 OR length(v#>>'{}')>(CASE WHEN k='city' THEN 120 WHEN k='specialization' THEN 300 ELSE 3000 END) THEN RETURN false; END IF;
  ELSIF k='capacity' THEN
   IF jsonb_typeof(v)<>'number' OR v#>>'{}' !~ '^[0-9]+$' OR (v#>>'{}')::numeric NOT BETWEEN 1 AND 100000 THEN RETURN false; END IF;
  ELSIF k='averageCheckMinor' THEN
   IF jsonb_typeof(v)<>'string' OR v#>>'{}' !~ '^(0|[1-9][0-9]{0,11})$' THEN RETURN false; END IF;
  ELSE RETURN false;
  END IF;
 END LOOP;
 roles:=d->'roles';
 IF d ? 'primaryRole' AND d ? 'roles' AND NOT roles ? (d->>'primaryRole') THEN RETURN false; END IF;
 IF complete THEN
  IF NOT d ?& ARRAY['primaryRole','roles','category','tax','city','socialLinks','motivation'] OR jsonb_array_length(d->'socialLinks')=0 THEN RETURN false; END IF;
  IF roles ? 'EXPERT' AND NOT d ?& ARRAY['specialization','averageCheckMinor'] THEN RETURN false; END IF;
  IF roles ? 'EXPERT' AND education_requirement='required' AND (NOT d ? 'education' OR jsonb_array_length(d->'education')=0) THEN RETURN false; END IF;
  IF roles ? 'CENTER' AND (NOT d ?& ARRAY['propertyEvidence','capacity','amenities'] OR jsonb_array_length(d->'propertyEvidence')=0 OR jsonb_array_length(d->'amenities')=0) THEN RETURN false; END IF;
  IF (roles ? 'ESOTERIC' OR roles ? 'OTHER') AND NOT d ?& ARRAY['path','cases'] THEN RETURN false; END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_verification_social_projection(links jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_object_agg(platform,urls),'{}'::jsonb) FROM (SELECT lower(substring(value#>>'{}' from '^https://([^/:?#]+)')) platform,jsonb_agg(value) urls FROM jsonb_array_elements(coalesce(links,'[]'::jsonb)) GROUP BY 1) grouped
$$;
--> statement-breakpoint
ALTER TABLE channel_identities ADD CONSTRAINT channel_identity_resident_owner UNIQUE(id,user_id);
--> statement-breakpoint
CREATE TABLE resident_verification_cohorts (user_id uuid PRIMARY KEY REFERENCES users(id), enrolled_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE residents_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 bot_id text NOT NULL CHECK(bot_id ~ '^[1-9][0-9]{0,15}$'), bot_key text NOT NULL CHECK(length(bot_key) BETWEEN 1 AND 128),
 channel_identity_id uuid NOT NULL,
 telegram_user_id text NOT NULL CHECK(telegram_user_id ~ '^[1-9][0-9]{0,19}$'), chat_id text NOT NULL CHECK(chat_id=telegram_user_id),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), form_version integer NOT NULL DEFAULT 1 CHECK(form_version=1), policy_version text NOT NULL DEFAULT 'resident_education_unknown_v1' CHECK(policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 education_requirement text NOT NULL DEFAULT 'unknown_manual_review' CHECK(education_requirement IN ('required','optional','unknown_manual_review')),
 draft jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(resident_verification_draft_valid(draft)),
 role_type text GENERATED ALWAYS AS (draft->>'primaryRole') STORED,
 target_category text GENERATED ALWAYS AS (draft->>'category') STORED,
 tax_status text GENERATED ALWAYS AS (draft->>'tax') STORED,
 location_city text GENERATED ALWAYS AS (draft->>'city') STORED,
 social_links_json jsonb GENERATED ALWAYS AS (resident_verification_social_projection(draft->'socialLinks')) STORED,
 motivation_text text GENERATED ALWAYS AS (draft->>'motivation') STORED,
 education_refs_json jsonb GENERATED ALWAYS AS (draft->'education') STORED,
 property_refs_json jsonb GENERATED ALWAYS AS (draft->'propertyEvidence') STORED,
 system_check_result jsonb NOT NULL DEFAULT '{"education":"unknown","social":"pending","upload":"pending_upload"}'::jsonb CHECK(system_check_result='{"education":"unknown","social":"pending","upload":"pending_upload"}'::jsonb),
 manager_notes text CHECK(manager_notes IS NULL),
 current_field text CHECK(current_field IN ('roles','primaryRole','category','tax','city','socialLinks','motivation','specialization','averageCheckMinor','education','propertyEvidence','capacity','amenities','path','cases')),
 status text NOT NULL DEFAULT 'PENDING_DOCS' CHECK(status IN ('PENDING_DOCS','UNDER_REVIEW','INFO_REQUESTED','APPROVED_BASIC','APPROVED_EXCLUSIVE','REJECTED')),
 progress text NOT NULL DEFAULT 'FORM_FILLING' CHECK(progress IN ('NONE','FORM_FILLING','AUTO_CHECK','MANAGER_REVIEW','DONE')),
 submitted_draft jsonb, submitted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT resident_verification_submission CHECK ((submitted_at IS NULL AND submitted_draft IS NULL AND status='PENDING_DOCS' AND progress='FORM_FILLING') OR (submitted_at IS NOT NULL AND isfinite(submitted_at) AND submitted_draft IS NOT NULL AND resident_verification_draft_valid(submitted_draft,true,education_requirement) AND status<>'PENDING_DOCS')),
 FOREIGN KEY(channel_identity_id,user_id) REFERENCES channel_identities(id,user_id),
 UNIQUE(id,user_id)
);
--> statement-breakpoint
CREATE TABLE resident_verification_application_updates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL, user_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0), kind text NOT NULL CHECK(kind IN ('patch','submit','followup','question')), answers jsonb NOT NULL CHECK(jsonb_typeof(answers)='object' AND octet_length(answers::text)<=100000), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(application_id,user_id) REFERENCES residents_applications(id,user_id) ON DELETE CASCADE, UNIQUE(application_id,revision)
);
--> statement-breakpoint
CREATE TABLE resident_verification_check_work (
 application_id uuid PRIMARY KEY, user_id uuid NOT NULL, submitted_revision integer NOT NULL CHECK(submitted_revision>0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','cancelled')),
 education_result text NOT NULL DEFAULT 'unknown' CHECK(education_result='unknown'), social_result text NOT NULL DEFAULT 'pending' CHECK(social_result='pending'), upload_state text NOT NULL DEFAULT 'pending_upload' CHECK(upload_state='pending_upload'), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(application_id,user_id) REFERENCES residents_applications(id,user_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE resident_verification_requests (
 bot_id text NOT NULL, bot_key text NOT NULL, request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200), user_id uuid REFERENCES users(id), request_digest text, operation text NOT NULL CHECK(operation IN ('start','patch','submit','followup','question')), result jsonb, erased_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(bot_id,bot_key,request_key),
 CONSTRAINT resident_verification_request_erasure CHECK ((user_id IS NOT NULL AND request_digest ~ '^[0-9a-f]{64}$' AND request_digest IS NOT NULL AND result IS NOT NULL AND erased_at IS NULL) OR (user_id IS NULL AND request_digest IS NULL AND result IS NULL AND erased_at IS NOT NULL))
);
--> statement-breakpoint
CREATE FUNCTION resident_verification_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM channel_identities ci JOIN users u ON u.id=ci.user_id AND u.active WHERE ci.id=NEW.channel_identity_id AND ci.user_id=NEW.user_id AND ci.provider='telegram' AND ci.status='active' AND ci.bot_key=NEW.bot_key AND ci.external_id=NEW.telegram_user_id AND ci.external_chat_id=NEW.chat_id) THEN RAISE EXCEPTION 'resident_identity_unavailable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING_DOCS' OR NEW.progress<>'FORM_FILLING' OR NEW.revision<>0 OR NEW.submitted_at IS NOT NULL THEN RAISE EXCEPTION 'resident_initial_state_invalid'; END IF;
  NEW.created_at:=clock_timestamp();
  INSERT INTO resident_verification_cohorts(user_id) VALUES(NEW.user_id) ON CONFLICT DO NOTHING;
 END IF;
 NEW.updated_at:=clock_timestamp();
 IF TG_OP='UPDATE' AND OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL THEN NEW.submitted_at:=clock_timestamp(); END IF;
 IF NEW.status IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE','REJECTED','INFO_REQUESTED') THEN RAISE EXCEPTION 'resident_manager_decisions_unavailable'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.user_id<>NEW.user_id OR OLD.bot_id<>NEW.bot_id OR OLD.bot_key<>NEW.bot_key OR OLD.channel_identity_id<>NEW.channel_identity_id OR OLD.created_at<>NEW.created_at OR OLD.policy_version<>NEW.policy_version OR OLD.education_requirement<>NEW.education_requirement OR OLD.telegram_user_id<>NEW.telegram_user_id OR OLD.chat_id<>NEW.chat_id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'resident_revision_invalid'; END IF;
  IF OLD.submitted_at IS NOT NULL AND (OLD.draft IS DISTINCT FROM NEW.draft OR OLD.submitted_draft IS DISTINCT FROM NEW.submitted_draft OR OLD.submitted_at IS DISTINCT FROM NEW.submitted_at OR OLD.status<>NEW.status OR OLD.progress<>NEW.progress) THEN RAISE EXCEPTION 'resident_submission_frozen'; END IF;
 END IF;
 IF NEW.submitted_at IS NOT NULL AND (NEW.draft<>NEW.submitted_draft OR NEW.status<>'UNDER_REVIEW' OR NEW.progress<>'AUTO_CHECK') THEN RAISE EXCEPTION 'resident_submission_invalid'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_verification_write_guard BEFORE INSERT OR UPDATE ON residents_applications FOR EACH ROW EXECUTE FUNCTION resident_verification_write_guard();
--> statement-breakpoint
-- Intake rows permanently fence price creation in this increment. A later reviewed
-- manager provenance migration must replace this predicate; a status string cannot.
CREATE FUNCTION resident_verification_price_allowed(owner_id uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$ SELECT NOT EXISTS(SELECT 1 FROM resident_verification_cohorts WHERE user_id=owner_id) $$;
--> statement-breakpoint
CREATE FUNCTION resident_verification_price_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT resident_verification_price_allowed(NEW.user_id) THEN RAISE EXCEPTION 'resident_verification_required'; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_verification_anchor_guard BEFORE INSERT ON expert_campaign_anchors FOR EACH ROW EXECUTE FUNCTION resident_verification_price_guard();
--> statement-breakpoint
CREATE TRIGGER resident_verification_quote_guard BEFORE INSERT ON expert_campaign_quotes FOR EACH ROW EXECUTE FUNCTION resident_verification_price_guard();

--> statement-breakpoint
CREATE INDEX residents_application_role_status_idx ON residents_applications(role_type,status);
--> statement-breakpoint
CREATE INDEX residents_application_telegram_idx ON residents_applications(bot_id,bot_key,telegram_user_id);
--> statement-breakpoint
CREATE FUNCTION erase_resident_verification_subject(subject uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(subject::text,0));
 DELETE FROM residents_applications WHERE user_id=subject;
 UPDATE resident_verification_requests SET user_id=NULL,request_digest=NULL,result=NULL,erased_at=clock_timestamp() WHERE user_id=subject;
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_verification_consent_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM erase_resident_verification_subject(NEW.user_id); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_verification_consent_cleanup AFTER INSERT ON consents FOR EACH ROW WHEN(NEW.consent_type='client_messaging' AND NEW.decision IN ('denied','revoked')) EXECUTE FUNCTION resident_verification_consent_cleanup();

--> statement-breakpoint
ALTER TABLE users ADD COLUMN current_verification_stage text NOT NULL DEFAULT 'NONE' CHECK(current_verification_stage IN ('NONE','FORM_FILLING','AUTO_CHECK','MANAGER_REVIEW','DONE'));
--> statement-breakpoint
CREATE FUNCTION resident_verification_stage_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN UPDATE users SET current_verification_stage='NONE' WHERE id=OLD.user_id; RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL THEN INSERT INTO resident_verification_check_work(application_id,user_id,submitted_revision) VALUES(NEW.id,NEW.user_id,NEW.revision); END IF;
 UPDATE users SET current_verification_stage=NEW.progress WHERE id=NEW.user_id; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_verification_stage_projection AFTER INSERT OR UPDATE OR DELETE ON residents_applications FOR EACH ROW EXECUTE FUNCTION resident_verification_stage_projection();
