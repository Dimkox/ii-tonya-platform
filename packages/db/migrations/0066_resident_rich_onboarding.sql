-- Rich mode is irreversible. Historical drafts are preserved; new runtime drafts explicitly opt in.
ALTER TABLE expert_card_drafts ADD COLUMN rich_mode boolean NOT NULL DEFAULT false,
 ADD COLUMN rich_profile jsonb, ADD COLUMN rich_proposal jsonb, ADD COLUMN rich_guided jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(rich_guided)='object' AND octet_length(rich_guided::text)<=16000),
 ADD COLUMN owner_confirmed_digest text, ADD COLUMN preview_page integer,
 ADD COLUMN preview_token_digest text, ADD COLUMN preview_content_digest text,
 ADD COLUMN assistance_requested_at timestamptz, ADD COLUMN assistance_revision integer, ADD COLUMN assistance_resolved_at timestamptz;
--> statement-breakpoint
ALTER TABLE expert_card_reviews ADD COLUMN return_reason text;
--> statement-breakpoint
CREATE FUNCTION resident_rich_https(v text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(length(v)<=2048 AND v ~ '^https://([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}([/?#][^[:space:]\\]*)?$' AND v !~* '^https://([^/]*\.)?(localhost|local|internal|test|invalid)([/#?]|$)',false)
$$;
--> statement-breakpoint
CREATE FUNCTION resident_rich_profile_valid(p jsonb, complete boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s jsonb; v jsonb; n text; mode text; online boolean:=false; offline boolean:=false;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR NOT p ?& ARRAY['fullName','specialization','bio','photos','socialLinks','onlineRoomType','staticRoomLink','address','arrival','yandexMapsUrl','services'] OR (p-ARRAY['fullName','specialization','bio','photos','socialLinks','onlineRoomType','staticRoomLink','address','arrival','yandexMapsUrl','services'])<>'{}' OR octet_length(p::text)>100000 THEN RETURN false; END IF;
 FOREACH n IN ARRAY ARRAY['fullName','specialization','bio','address','arrival'] LOOP
  IF jsonb_typeof(p->n)<>'string' OR length(p->>n)>(CASE n WHEN 'fullName' THEN 160 WHEN 'specialization' THEN 240 WHEN 'address' THEN 1000 ELSE 2000 END) THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_typeof(p->'onlineRoomType')<>'string' OR p->>'onlineRoomType' NOT IN('STATIC_LINK','UNDECIDED') OR jsonb_typeof(p->'photos')<>'array' OR jsonb_array_length(p->'photos')>10 OR jsonb_typeof(p->'socialLinks')<>'array' OR jsonb_array_length(p->'socialLinks')>8 OR jsonb_typeof(p->'services')<>'array' OR jsonb_array_length(p->'services')>8 THEN RETURN false; END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p->'photos') LOOP IF jsonb_typeof(v)<>'string' OR (v#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RETURN false; END IF; END LOOP;
 FOR v IN SELECT value FROM jsonb_array_elements(p->'socialLinks') LOOP IF jsonb_typeof(v)<>'string' OR NOT resident_rich_https(v#>>'{}') THEN RETURN false; END IF; END LOOP;
 FOREACH n IN ARRAY ARRAY['staticRoomLink','yandexMapsUrl'] LOOP IF p->n<>'null'::jsonb AND (jsonb_typeof(p->n)<>'string' OR NOT resident_rich_https(p->>n)) THEN RETURN false; END IF; END LOOP;
 IF p->'yandexMapsUrl'<>'null'::jsonb AND p->>'yandexMapsUrl' NOT LIKE 'https://yandex.ru/maps%' THEN RETURN false; END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p->'services'))<>jsonb_array_length(p->'services') THEN RETURN false; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p->'services') LOOP
  IF jsonb_typeof(s)<>'object' OR NOT s ?& ARRAY['id','title','format','eventDelivery','durationMinutes','price','description','audience','result','expiryDate','detailsUrl','tags'] OR (s-ARRAY['id','title','format','eventDelivery','durationMinutes','price','description','audience','result','expiryDate','detailsUrl','tags'])<>'{}' OR jsonb_typeof(s->'id')<>'string' OR jsonb_typeof(s->'format')<>'string' OR s->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR s->>'format' NOT IN('ONLINE','OFFLINE','HYBRID','EVENT') OR jsonb_typeof(s->'durationMinutes')<>'number' OR s->>'durationMinutes' !~ '^\d+$' OR (s->>'durationMinutes')::numeric NOT BETWEEN 5 AND 1440 THEN RETURN false; END IF;
  FOREACH n IN ARRAY ARRAY['title','description','audience','result'] LOOP IF jsonb_typeof(s->n)<>'string' OR length(s->>n)>(CASE n WHEN 'title' THEN 160 WHEN 'description' THEN 2000 ELSE 1000 END) OR (complete AND length(btrim(s->>n))<(CASE n WHEN 'description' THEN 50 ELSE 1 END)) THEN RETURN false; END IF; END LOOP;
  v:=s->'price'; IF jsonb_typeof(v)<>'object' OR NOT v ?& ARRAY['kind','minRub','maxRub'] OR (v-ARRAY['kind','minRub','maxRub'])<>'{}' OR jsonb_typeof(v->'minRub')<>'string' OR v->>'minRub' !~ '^(0|[1-9][0-9]{0,6})\.[0-9]{2}$' OR v->>'kind' NOT IN('exact','range') THEN RETURN false; END IF;
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
 IF complete AND (length(btrim(p->>'fullName'))<1 OR length(btrim(p->>'specialization'))<1 OR length(btrim(p->>'bio'))<50 OR jsonb_array_length(p->'photos')<3 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p->'photos'))<>jsonb_array_length(p->'photos') OR jsonb_array_length(p->'socialLinks')<1 OR jsonb_array_length(p->'services')<1 OR (online AND (p->>'onlineRoomType'<>'STATIC_LINK' OR p->'staticRoomLink'='null'::jsonb)) OR (offline AND (length(btrim(p->>'address'))=0 OR length(btrim(p->>'arrival'))=0))) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
ALTER TABLE expert_card_drafts ADD CONSTRAINT resident_rich_shape CHECK (coalesce((NOT rich_mode AND rich_profile IS NULL AND rich_proposal IS NULL) OR (rich_mode AND resident_rich_profile_valid(rich_profile)),false));
--> statement-breakpoint
CREATE TABLE resident_card_versions (
 review_id uuid PRIMARY KEY REFERENCES expert_card_reviews(id) ON DELETE CASCADE,
 draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 revision integer NOT NULL, profile jsonb CHECK(profile IS NULL OR resident_rich_profile_valid(profile,true)),
 public_payload jsonb NOT NULL, safety_fields jsonb NOT NULL, safety_proof jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(draft_id,revision)
);
--> statement-breakpoint
CREATE TRIGGER resident_card_version_immutable BEFORE UPDATE ON resident_card_versions FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TABLE resident_card_media (
 id uuid PRIMARY KEY REFERENCES resident_object_deletions(custody_id),
 draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 source_reference text NOT NULL, size integer NOT NULL CHECK(size BETWEEN 1 AND 20971520),
 mime_type text NOT NULL CHECK(mime_type IN('image/jpeg','image/png')),
 state text NOT NULL DEFAULT 'allocated' CHECK(state IN('allocated','inflight','unknown','verified','unavailable')),
 sha256 text CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 UNIQUE(draft_id,source_reference), CHECK(state<>'verified' OR sha256 IS NOT NULL)
);
--> statement-breakpoint
CREATE FUNCTION resident_card_media_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE resident_object_deletions SET erased=true,delete_state='pending',updated_at=clock_timestamp() WHERE custody_id=OLD.id; RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER resident_card_media_erase BEFORE DELETE ON resident_card_media FOR EACH ROW EXECUTE FUNCTION resident_card_media_erasure();
--> statement-breakpoint
CREATE FUNCTION resident_rich_digest(d expert_card_drafts) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(digest(jsonb_build_object('revision',d.revision,'profile',d.rich_profile,'public',d.public_payload,'proposal',d.rich_proposal,'guided',d.rich_guided)::text,'sha256'),'hex')
$$;
--> statement-breakpoint
ALTER FUNCTION resident_card_effective_fields(uuid) RENAME TO resident_card_legacy_fields;
--> statement-breakpoint
CREATE FUNCTION resident_card_effective_fields(target uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE result jsonb; g jsonb; p jsonb; s jsonb; i integer:=0;
BEGIN
 result:=resident_card_legacy_fields(target);
 SELECT rich_profile,rich_guided INTO p,g FROM expert_card_drafts WHERE id=target;
 IF p IS NOT NULL THEN
  result:=result||jsonb_build_object('rich:guided',g::text)||jsonb_build_object('rich:profile',(p-'services'-'photos')::text);
  FOR s IN SELECT value FROM jsonb_array_elements(p->'services') LOOP result:=result||jsonb_build_object('rich:service:'||i,s::text); i:=i+1; END LOOP;
 END IF;
 RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_rich_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessment jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.rich_mode AND NOT NEW.rich_mode THEN RAISE EXCEPTION 'rich_mode_irreversible'; END IF;
 IF NOT NEW.rich_mode THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.rich_profile IS DISTINCT FROM OLD.rich_profile OR NEW.rich_guided IS DISTINCT FROM OLD.rich_guided OR NEW.rich_proposal IS DISTINCT FROM OLD.rich_proposal OR NEW.public_payload IS DISTINCT FROM OLD.public_payload OR NEW.revision<>OLD.revision) THEN
  NEW.owner_confirmed_digest:=NULL; NEW.preview_page:=NULL; NEW.preview_token_digest:=NULL; NEW.preview_content_digest:=NULL;
 END IF;
 IF NEW.status IN('manager_review','approved') THEN
  IF NEW.rich_guided<>'{}'::jsonb OR NOT resident_rich_profile_valid(NEW.rich_profile,true) OR NEW.owner_confirmed_digest IS DISTINCT FROM resident_rich_digest(NEW) THEN RAISE EXCEPTION 'rich_owner_confirmation_required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.rich_profile->'photos') p WHERE NOT EXISTS(SELECT 1 FROM resident_card_media m JOIN resident_object_deletions o ON o.custody_id=m.id AND NOT o.erased AND o.write_state='settled' WHERE m.id=p::uuid AND m.draft_id=NEW.id AND m.state='verified')) THEN RAISE EXCEPTION 'rich_photo_custody_required'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_rich_draft_source BEFORE INSERT OR UPDATE ON expert_card_drafts FOR EACH ROW EXECUTE FUNCTION resident_rich_draft_guard();
--> statement-breakpoint
CREATE FUNCTION resident_rich_review_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d expert_card_drafts;
BEGIN
 SELECT * INTO d FROM expert_card_drafts WHERE id=NEW.draft_id FOR UPDATE;
 IF NOT d.rich_mode THEN RETURN NEW; END IF;
 IF NEW.action='return_changes' AND coalesce(length(btrim(NEW.return_reason)),0) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'rich_return_reason_required'; END IF;
 IF NEW.action='approve' THEN
  IF d.status<>'manager_review' OR d.revision<>NEW.revision OR d.public_payload IS DISTINCT FROM NEW.public_payload OR d.owner_confirmed_digest IS DISTINCT FROM resident_rich_digest(d) OR NOT resident_rich_profile_valid(d.rich_profile,true) THEN RAISE EXCEPTION 'rich_review_source'; END IF;
  INSERT INTO resident_card_versions(review_id,draft_id,revision,profile,public_payload,safety_fields,safety_proof) VALUES(NEW.id,d.id,d.revision,d.rich_profile,NEW.public_payload,resident_card_effective_fields(d.id),NEW.safety_proof);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_rich_review_version AFTER INSERT ON expert_card_reviews FOR EACH ROW EXECUTE FUNCTION resident_rich_review_version();
--> statement-breakpoint
ALTER FUNCTION expert_card_activation_gate_valid(uuid,uuid) RENAME TO expert_card_legacy_activation_gate;
--> statement-breakpoint
CREATE FUNCTION expert_card_activation_gate_valid(target_user uuid,target_review uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE v resident_card_versions; d expert_card_drafts; a jsonb;
BEGIN
 SELECT * INTO v FROM resident_card_versions WHERE review_id=target_review;
 IF NOT FOUND THEN RETURN expert_card_legacy_activation_gate(target_user,target_review); END IF;
 SELECT * INTO d FROM expert_card_drafts WHERE id=v.draft_id AND user_id=target_user;
 IF NOT FOUND OR NOT expert_card_current_messaging_authority(target_user,d.messaging_policy_version) OR NOT EXISTS(SELECT 1 FROM users WHERE id=target_user AND active) OR NOT EXISTS(SELECT 1 FROM channel_identities WHERE user_id=target_user AND provider='telegram' AND bot_key=d.work_bot_key AND external_id=d.work_chat_id AND external_chat_id=d.work_chat_id AND status='active') THEN RETURN false; END IF;
 a:=resident_safety_assess(v.safety_fields,v.revision);
 IF (a->>'blocked')::boolean OR a IS DISTINCT FROM v.safety_proof THEN RETURN false; END IF;
 -- Paid acquisition proof is historical and immutable. Updating content never creates another charge/campaign.
 IF EXISTS(SELECT 1 FROM experts_published p JOIN expert_card_main_orders m ON m.order_id=p.paid_order_id AND m.user_id=p.user_id JOIN expert_main_activation_admissions admission ON admission.order_id=m.order_id AND admission.review_audit_id=m.review_audit_id AND admission.public_digest=m.public_digest WHERE p.draft_id=d.id AND p.user_id=target_user) THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM expert_onboarding_applications ap JOIN expert_onboarding_invoices i ON i.application_id=ap.id AND i.status='settled' JOIN expert_onboarding_payment_facts f ON f.invoice_id=i.id AND f.admission='interview' WHERE ap.id=d.application_id AND ap.user_id=target_user AND ap.verification_status='approved' AND ap.archived_at IS NULL AND ap.archive_until_date IS NULL)
 AND (EXISTS(SELECT 1 FROM expert_card_material_jobs j JOIN expert_card_material_templates t ON t.id=j.template_id AND t.content_version=j.content_version AND t.status='approved' WHERE j.review_id=target_review AND j.status='delivered' AND j.delivery_receipt IS NOT NULL AND j.user_id=target_user) OR EXISTS(SELECT 1 FROM expert_application_material_jobs j JOIN expert_card_material_templates t ON t.id=j.template_id AND t.content_version=j.content_version AND t.status='approved' WHERE j.application_id=d.application_id AND j.user_id=target_user AND j.status='delivered' AND j.delivery_receipt IS NOT NULL))
 AND EXISTS(SELECT 1 FROM expert_application_promo_confirmations p WHERE p.application_id=d.application_id AND p.user_id=target_user AND p.proof_digest=(SELECT 'sha256:'||encode(digest(coalesce(string_agg(id::text||':'||kind||':'||reference,E'\n' ORDER BY created_at,id),''),'sha256'),'hex') FROM expert_application_promo_proofs WHERE application_id=d.application_id AND user_id=target_user))
 AND EXISTS(SELECT 1 FROM expert_application_promo_proofs WHERE application_id=d.application_id AND user_id=target_user);
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_rich_write_safety() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fields jsonb; s jsonb; i integer:=0; assessment jsonb;
BEGIN
 IF NOT NEW.rich_mode OR (TG_OP='UPDATE' AND NEW.rich_profile IS NOT DISTINCT FROM OLD.rich_profile AND NEW.rich_guided IS NOT DISTINCT FROM OLD.rich_guided) THEN RETURN NEW; END IF;
 fields:=jsonb_build_object('rich:guided',NEW.rich_guided::text)||jsonb_build_object('rich:profile',(NEW.rich_profile-'services'-'photos')::text);
 FOR s IN SELECT value FROM jsonb_array_elements(NEW.rich_profile->'services') LOOP fields:=fields||jsonb_build_object('rich:service:'||i,s::text); i:=i+1; END LOOP;
 assessment:=resident_safety_assess(fields,NEW.revision);
 IF (assessment->>'blocked')::boolean THEN RAISE EXCEPTION 'resident_safety_write_blocked'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_rich_write_safety BEFORE INSERT OR UPDATE ON expert_card_drafts FOR EACH ROW EXECUTE FUNCTION resident_rich_write_safety();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_published_card_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN

 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['review_id','revision','public_digest','public_payload','updated_at','active','next_billing_date','paid_order_id'])=(to_jsonb(OLD)-ARRAY['review_id','revision','public_digest','public_payload','updated_at','active','next_billing_date','paid_order_id']) AND EXISTS(
 SELECT 1 FROM resident_card_versions v JOIN expert_card_reviews r ON r.id=v.review_id JOIN expert_card_drafts d ON d.id=v.draft_id AND ((d.approved_review_id=r.id AND d.status='approved') OR (r.id=OLD.review_id AND NEW.review_id=OLD.review_id))
 JOIN expert_card_main_orders m ON m.order_id=NEW.paid_order_id AND m.user_id=NEW.user_id AND m.expert_id=NEW.expert_id
 JOIN expert_main_activation_admissions a ON a.order_id=m.order_id AND a.review_audit_id=m.review_audit_id AND a.public_digest=m.public_digest
 WHERE v.review_id=NEW.review_id AND v.draft_id=NEW.draft_id AND v.revision=NEW.revision AND r.public_digest=NEW.public_digest AND r.public_payload=NEW.public_payload AND r.user_id=NEW.user_id AND expert_card_activation_gate_valid(NEW.user_id,NEW.review_id) AND EXISTS(SELECT 1 FROM expert_residency_current_coverage(NEW.expert_id) c WHERE c.source_order_id=NEW.paid_order_id AND c.ends_at=NEW.next_billing_date) AND (NOT NEW.active OR (EXISTS(SELECT 1 FROM experts e WHERE e.id=NEW.expert_id AND e.user_id=NEW.user_id AND e.active AND e.verified) AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds WHERE expert_id=NEW.expert_id AND status='open') AND NOT EXISTS(SELECT 1 FROM expert_residency_lifecycle WHERE expert_id=NEW.expert_id AND status='paused')))
 ) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NOT NEW.active AND (to_jsonb(NEW)-ARRAY['active','updated_at'])=(to_jsonb(OLD)-ARRAY['active','updated_at']) THEN RETURN NEW; END IF;
 IF NEW.draft_id IS NULL OR NEW.review_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM experts e JOIN users u ON u.id=e.user_id AND u.active JOIN expert_card_reviews r ON r.id=NEW.review_id
   JOIN expert_card_drafts d ON d.id=NEW.draft_id AND d.approved_review_id=r.id AND d.revision=r.revision
   JOIN expert_residency_orders o ON o.id=NEW.paid_order_id AND o.expert_id=e.id AND o.status='settled'
   JOIN expert_card_main_orders m ON m.order_id=o.id AND m.expert_id=e.id AND m.user_id=NEW.user_id AND m.review_id=r.id AND m.revision=NEW.revision AND m.public_digest=NEW.public_digest
   WHERE expert_card_activation_gate_valid(NEW.user_id,NEW.review_id) AND e.id=NEW.expert_id AND e.user_id=NEW.user_id AND e.active AND e.verified AND d.user_id=e.user_id
     AND EXISTS(SELECT 1 FROM expert_main_activation_admissions admission WHERE admission.order_id=o.id AND admission.user_id=NEW.user_id AND admission.expert_id=NEW.expert_id AND admission.quote_id=m.quote_id AND admission.application_audit_id=NEW.application_audit_id AND admission.review_audit_id=m.review_audit_id AND admission.public_digest=NEW.public_digest)
     AND d.application_id=NEW.application_audit_id AND r.action='approve' AND r.revision=NEW.revision
     AND r.public_digest=NEW.public_digest AND r.public_payload=NEW.public_payload AND o.residency_ends_at=NEW.next_billing_date)
 OR (NEW.active AND (NEW.next_billing_date<=clock_timestamp() OR NOT EXISTS(
   SELECT 1 FROM expert_residency_orders o WHERE o.expert_id=NEW.expert_id AND o.status='settled' AND o.residency_starts_at<=clock_timestamp() AND o.residency_ends_at>clock_timestamp()))) THEN
  RAISE EXCEPTION 'expert_published_card_source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_card_version_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM expert_card_reviews r JOIN expert_card_drafts d ON d.id=r.draft_id WHERE r.id=NEW.review_id AND r.draft_id=NEW.draft_id AND r.revision=NEW.revision AND r.action='approve' AND r.public_payload=NEW.public_payload AND r.safety_proof=NEW.safety_proof AND NEW.safety_fields=resident_card_effective_fields(d.id) AND ((NOT d.rich_mode AND NEW.profile IS NULL AND d.status='approved') OR (d.rich_mode AND NEW.profile=d.rich_profile AND d.owner_confirmed_digest=resident_rich_digest(d) AND d.status='manager_review'))) THEN RAISE EXCEPTION 'rich_version_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_card_version_source BEFORE INSERT ON resident_card_versions FOR EACH ROW EXECUTE FUNCTION resident_card_version_source();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_card_main_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.application_id IS NULL OR NEW.review_id IS NULL OR NOT expert_campaign_current_profile_valid(NEW.user_id,NEW.quote_id) OR NOT expert_card_activation_gate_valid(NEW.user_id,NEW.review_id)
 OR NOT EXISTS(SELECT 1 FROM expert_card_drafts d JOIN expert_card_reviews r ON r.id=coalesce(d.approved_review_id,(SELECT p.review_id FROM experts_published p JOIN resident_card_versions v ON v.review_id=p.review_id WHERE p.draft_id=d.id))
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
