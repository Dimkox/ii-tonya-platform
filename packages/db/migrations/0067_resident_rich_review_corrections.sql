-- R5/R7: canonical UUID identity and explicit JSON discriminator types.
CREATE OR REPLACE FUNCTION resident_rich_profile_valid(p jsonb, complete boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s jsonb; v jsonb; n text; mode text; online boolean:=false; offline boolean:=false;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR NOT p ?& ARRAY['fullName','specialization','bio','photos','socialLinks','onlineRoomType','staticRoomLink','address','arrival','yandexMapsUrl','services'] OR (p-ARRAY['fullName','specialization','bio','photos','socialLinks','onlineRoomType','staticRoomLink','address','arrival','yandexMapsUrl','services'])<>'{}' OR octet_length(p::text)>100000 THEN RETURN false; END IF;
 FOREACH n IN ARRAY ARRAY['fullName','specialization','bio','address','arrival'] LOOP
  IF jsonb_typeof(p->n)<>'string' OR length(p->>n)>(CASE n WHEN 'fullName' THEN 160 WHEN 'specialization' THEN 240 WHEN 'address' THEN 1000 ELSE 2000 END) THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_typeof(p->'onlineRoomType')<>'string' OR p->>'onlineRoomType' NOT IN('STATIC_LINK','UNDECIDED') OR jsonb_typeof(p->'photos')<>'array' OR jsonb_array_length(p->'photos')>10 OR jsonb_typeof(p->'socialLinks')<>'array' OR jsonb_array_length(p->'socialLinks')>8 OR jsonb_typeof(p->'services')<>'array' OR jsonb_array_length(p->'services')>8 THEN RETURN false; END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p->'photos') LOOP IF jsonb_typeof(v)<>'string' OR (v#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RETURN false; END IF; END LOOP;
 IF (SELECT count(DISTINCT lower(value#>>'{}')) FROM jsonb_array_elements(p->'photos'))<>jsonb_array_length(p->'photos') THEN RETURN false; END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p->'socialLinks') LOOP IF jsonb_typeof(v)<>'string' OR NOT resident_rich_https(v#>>'{}') THEN RETURN false; END IF; END LOOP;
 FOREACH n IN ARRAY ARRAY['staticRoomLink','yandexMapsUrl'] LOOP IF p->n<>'null'::jsonb AND (jsonb_typeof(p->n)<>'string' OR NOT resident_rich_https(p->>n)) THEN RETURN false; END IF; END LOOP;
 IF p->'yandexMapsUrl'<>'null'::jsonb AND p->>'yandexMapsUrl' NOT LIKE 'https://yandex.ru/maps%' THEN RETURN false; END IF;
 IF (SELECT count(DISTINCT lower(value->>'id')) FROM jsonb_array_elements(p->'services'))<>jsonb_array_length(p->'services') THEN RETURN false; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p->'services') LOOP
  IF jsonb_typeof(s)<>'object' OR NOT s ?& ARRAY['id','title','format','eventDelivery','durationMinutes','price','description','audience','result','expiryDate','detailsUrl','tags'] OR (s-ARRAY['id','title','format','eventDelivery','durationMinutes','price','description','audience','result','expiryDate','detailsUrl','tags'])<>'{}' OR jsonb_typeof(s->'id')<>'string' OR jsonb_typeof(s->'format')<>'string' OR s->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR s->>'format' NOT IN('ONLINE','OFFLINE','HYBRID','EVENT') OR jsonb_typeof(s->'durationMinutes')<>'number' OR s->>'durationMinutes' !~ '^\d+$' OR (s->>'durationMinutes')::numeric NOT BETWEEN 5 AND 1440 THEN RETURN false; END IF;
  FOREACH n IN ARRAY ARRAY['title','description','audience','result'] LOOP IF jsonb_typeof(s->n)<>'string' OR length(s->>n)>(CASE n WHEN 'title' THEN 160 WHEN 'description' THEN 2000 ELSE 1000 END) OR (complete AND length(btrim(s->>n))<(CASE n WHEN 'description' THEN 50 ELSE 1 END)) THEN RETURN false; END IF; END LOOP;
  v:=s->'price'; IF jsonb_typeof(v)<>'object' OR NOT v ?& ARRAY['kind','minRub','maxRub'] OR (v-ARRAY['kind','minRub','maxRub'])<>'{}' OR jsonb_typeof(v->'minRub')<>'string' OR v->>'minRub' !~ '^(0|[1-9][0-9]{0,6})\.[0-9]{2}$' OR jsonb_typeof(v->'kind') IS DISTINCT FROM 'string' OR v->>'kind' NOT IN('exact','range') THEN RETURN false; END IF;
  IF v->>'kind'='exact' THEN IF v->'maxRub'<>'null'::jsonb THEN RETURN false; END IF;
  ELSE IF jsonb_typeof(v->'maxRub')<>'string' OR v->>'maxRub' !~ '^(0|[1-9][0-9]{0,6})\.[0-9]{2}$' THEN RETURN false; END IF; IF (v->>'maxRub')::numeric<(v->>'minRub')::numeric THEN RETURN false; END IF; END IF;
  IF s->'expiryDate'<>'null'::jsonb THEN IF jsonb_typeof(s->'expiryDate')<>'string' OR s->>'expiryDate' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' OR to_char((s->>'expiryDate')::date,'YYYY-MM-DD')<>s->>'expiryDate' THEN RETURN false; END IF; END IF;
  IF s->'detailsUrl'<>'null'::jsonb AND (jsonb_typeof(s->'detailsUrl')<>'string' OR NOT resident_rich_https(s->>'detailsUrl')) THEN RETURN false; END IF;
  IF jsonb_typeof(s->'tags')<>'array' OR jsonb_array_length(s->'tags')>20 OR (complete AND jsonb_array_length(s->'tags')=0) OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(s->'tags'))<>jsonb_array_length(s->'tags') THEN RETURN false; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(s->'tags') LOOP IF jsonb_typeof(v)<>'string' OR length(v#>>'{}') NOT BETWEEN 1 AND 80 THEN RETURN false; END IF; END LOOP;
  IF s->'eventDelivery'<>'null'::jsonb AND s->>'eventDelivery' NOT IN('ONLINE','OFFLINE','HYBRID') THEN RETURN false; END IF;
  mode:=CASE WHEN s->>'format'='EVENT' THEN s->>'eventDelivery' ELSE s->>'format' END;
  IF complete AND mode IS NULL THEN RETURN false; END IF;
  online:=online OR coalesce(mode IN('ONLINE','HYBRID'),false); offline:=offline OR coalesce(mode IN('OFFLINE','HYBRID'),false);
 END LOOP;
 IF complete AND (length(btrim(p->>'fullName'))<1 OR length(btrim(p->>'specialization'))<1 OR length(btrim(p->>'bio'))<50 OR jsonb_array_length(p->'photos')<3 OR (SELECT count(DISTINCT lower(value#>>'{}')) FROM jsonb_array_elements(p->'photos'))<>jsonb_array_length(p->'photos') OR jsonb_array_length(p->'socialLinks')<1 OR jsonb_array_length(p->'services')<1 OR (online AND (p->>'onlineRoomType'<>'STATIC_LINK' OR p->'staticRoomLink'='null'::jsonb)) OR (offline AND (length(btrim(p->>'address'))=0 OR length(btrim(p->>'arrival'))=0))) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

--> statement-breakpoint
ALTER TABLE expert_card_drafts ADD COLUMN rich_pending_services jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT resident_rich_pending_services_shape CHECK(jsonb_typeof(rich_pending_services)='array' AND jsonb_array_length(rich_pending_services)<=8 AND octet_length(rich_pending_services::text)<=95000);

--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_rich_digest(d expert_card_drafts) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(digest((jsonb_build_object('revision',d.revision,'profile',d.rich_profile,'public',d.public_payload,'proposal',d.rich_proposal,'guided',d.rich_guided)||CASE WHEN d.rich_pending_services='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('pending',d.rich_pending_services) END)::text,'sha256'),'hex')
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_card_effective_fields(target uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE result jsonb; g jsonb; p jsonb; pending jsonb; s jsonb; i integer:=0;
BEGIN
 result:=resident_card_legacy_fields(target);
 SELECT rich_profile,rich_guided,rich_pending_services INTO p,g,pending FROM expert_card_drafts WHERE id=target;
 IF p IS NOT NULL THEN
  result:=result||jsonb_build_object('rich:guided',g::text)||jsonb_build_object('rich:profile',(p-'services'-'photos')::text);
  FOR s IN SELECT value FROM jsonb_array_elements(p->'services') LOOP result:=result||jsonb_build_object('rich:service:'||i,s::text); i:=i+1; END LOOP;
 END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(pending) LOOP result:=result||jsonb_build_object('rich:pending:'||i,s::text); i:=i+1; END LOOP;
 RETURN result;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_rich_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessment jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.rich_mode AND NOT NEW.rich_mode THEN RAISE EXCEPTION 'rich_mode_irreversible'; END IF;
 IF NOT NEW.rich_mode THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.rich_profile IS DISTINCT FROM OLD.rich_profile OR NEW.rich_pending_services IS DISTINCT FROM OLD.rich_pending_services OR NEW.rich_guided IS DISTINCT FROM OLD.rich_guided OR NEW.rich_proposal IS DISTINCT FROM OLD.rich_proposal OR NEW.public_payload IS DISTINCT FROM OLD.public_payload OR NEW.revision<>OLD.revision) THEN
  NEW.owner_confirmed_digest:=NULL; NEW.preview_page:=NULL; NEW.preview_token_digest:=NULL; NEW.preview_content_digest:=NULL;
 END IF;
 IF NEW.status IN('manager_review','approved') THEN
  IF NEW.rich_pending_services<>'[]'::jsonb OR NEW.rich_guided<>'{}'::jsonb OR NOT resident_rich_profile_valid(NEW.rich_profile,true) OR NEW.owner_confirmed_digest IS DISTINCT FROM resident_rich_digest(NEW) THEN RAISE EXCEPTION 'rich_owner_confirmation_required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.rich_profile->'photos') p WHERE NOT EXISTS(SELECT 1 FROM resident_card_media m JOIN resident_object_deletions o ON o.custody_id=m.id AND NOT o.erased AND o.write_state='settled' WHERE m.id=p::uuid AND m.draft_id=NEW.id AND m.state='verified')) THEN RAISE EXCEPTION 'rich_photo_custody_required'; END IF;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_rich_write_safety() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fields jsonb; s jsonb; i integer:=0; assessment jsonb;
BEGIN
 IF NOT NEW.rich_mode OR (TG_OP='UPDATE' AND NEW.rich_profile IS NOT DISTINCT FROM OLD.rich_profile AND NEW.rich_guided IS NOT DISTINCT FROM OLD.rich_guided AND NEW.rich_pending_services IS NOT DISTINCT FROM OLD.rich_pending_services) THEN RETURN NEW; END IF;
 fields:=jsonb_build_object('rich:guided',NEW.rich_guided::text)||jsonb_build_object('rich:profile',(NEW.rich_profile-'services'-'photos')::text);
 FOR s IN SELECT value FROM jsonb_array_elements(NEW.rich_profile->'services') LOOP fields:=fields||jsonb_build_object('rich:service:'||i,s::text); i:=i+1; END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(NEW.rich_pending_services) LOOP fields:=fields||jsonb_build_object('rich:pending:'||i,s::text); i:=i+1; END LOOP;
 assessment:=resident_safety_assess(fields,NEW.revision);
 IF (assessment->>'blocked')::boolean THEN RAISE EXCEPTION 'resident_safety_write_blocked'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_card_main_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.application_id IS NULL OR NEW.review_id IS NULL OR NOT expert_campaign_current_profile_valid(NEW.user_id,NEW.quote_id) OR NOT expert_card_activation_gate_valid(NEW.user_id,NEW.review_id)
 OR NOT EXISTS(SELECT 1 FROM expert_card_drafts d JOIN expert_card_reviews r ON r.id=coalesce((SELECT v.review_id FROM resident_card_versions v WHERE v.draft_id=d.id ORDER BY v.revision DESC LIMIT 1),d.approved_review_id)
   JOIN expert_campaign_quotes q ON q.id=NEW.quote_id AND q.user_id=NEW.user_id
   JOIN experts e ON e.id=NEW.expert_id AND e.user_id=NEW.user_id
   WHERE d.application_id=NEW.application_id AND d.user_id=NEW.user_id AND r.id=NEW.review_id
     AND r.revision=NEW.revision AND r.public_digest=NEW.public_digest AND q.quoted_at<=clock_timestamp() AND q.expires_at>clock_timestamp()
     AND (q.rule_version='expert_energy_start_v1' OR (q.rule_version='expert_separated_sales_v3' AND EXISTS(SELECT 1 FROM expert_sales_paid_locks l WHERE l.user_id=q.user_id AND l.invoice_id=q.paid_lock_invoice_id AND l.selection_id=q.sales_selection_id)) OR (q.rule_version='expert_energy_start_v2' AND q.profile_revision=(SELECT max(revision) FROM expert_offer_profiles WHERE user_id=NEW.user_id) AND EXISTS(SELECT 1 FROM expert_offer_profile_verifications pv WHERE pv.user_id=NEW.user_id AND pv.profile_revision=q.profile_revision)))) THEN
  RAISE EXCEPTION 'expert_card_main_acceptance_source' USING ERRCODE='23514';
 END IF;
 IF NEW.acceptance_source='schedule' AND NOT EXISTS(SELECT 1 FROM expert_offer_schedules s JOIN expert_campaign_quotes q ON q.id=NEW.quote_id JOIN expert_card_main_acceptances original ON original.id=s.original_acceptance_id AND original.acceptance_source='explicit'
 WHERE s.id=NEW.offer_schedule_id AND s.id=(SELECT latest.id FROM expert_offer_schedules latest WHERE latest.user_id=NEW.user_id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1) AND s.user_id=NEW.user_id AND s.application_id=NEW.application_id AND s.expert_id=NEW.expert_id AND s.review_id=NEW.review_id AND s.revision=NEW.revision AND s.public_digest=NEW.public_digest AND s.tariff_version_id=q.tariff_version_id AND s.term_months=q.term_months AND s.profile_revision=q.profile_revision) THEN RAISE EXCEPTION 'expert_offer_schedule_binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
