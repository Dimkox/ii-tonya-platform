-- UUID identity is independent of spelling in immutable source JSON. Preserve
-- the original profile/schedule bytes and every owner/review/digest/time guard.
CREATE OR REPLACE FUNCTION resident_service_version_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; s jsonb;
BEGIN
 SELECT v.profile INTO p FROM resident_card_versions v JOIN resident_service_mappings m ON m.draft_id=v.draft_id AND m.rich_service_id=NEW.rich_service_id AND m.expert_service_id=NEW.expert_service_id WHERE v.review_id=NEW.review_id;
 SELECT value INTO s FROM jsonb_array_elements(p->'services') WHERE (value->>'id')::uuid=NEW.rich_service_id;
 IF s IS NULL OR NEW.title IS DISTINCT FROM s->>'title' OR NEW.duration_minutes IS DISTINCT FROM (s->>'durationMinutes')::integer OR NEW.format IS DISTINCT FROM (CASE WHEN s->>'format'='EVENT' THEN s->>'eventDelivery' ELSE s->>'format' END) OR NEW.logistics IS DISTINCT FROM jsonb_build_object('room',p->'staticRoomLink','address',p->'address','arrival',p->'arrival','map',p->'yandexMapsUrl') THEN RAISE EXCEPTION 'native_service_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_schedule_version_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p resident_schedule_previews; v resident_card_versions;
BEGIN
 SELECT * INTO p FROM resident_schedule_previews WHERE id=NEW.preview_id;
 SELECT * INTO v FROM resident_card_versions WHERE review_id=NEW.review_id;
 IF p.id IS NULL OR p.confirmed_at IS NULL OR p.errors<>'[]'::jsonb OR p.draft_id IS DISTINCT FROM v.draft_id OR NEW.confirmed_at IS DISTINCT FROM p.confirmed_at
 OR p.profile_digest IS DISTINCT FROM encode(digest(v.profile::text,'sha256'),'hex')
 OR ((p.review_id=NEW.review_id) OR (p.review_id IS NULL AND (v.initial_schedule->>'previewId')::uuid=p.id)) IS NOT TRUE
 OR NOT EXISTS(SELECT 1 FROM experts e JOIN expert_card_drafts d ON d.user_id=e.user_id WHERE d.id=p.draft_id AND e.id=NEW.expert_id)
 OR NEW.valid_until IS DISTINCT FROM (((p.rules->>'to')::date+1)::timestamp AT TIME ZONE (p.rules->>'timezone')) THEN RAISE EXCEPTION 'native_schedule_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_native_slot_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL AND EXISTS(SELECT 1 FROM reservations r WHERE r.slot_id=OLD.slot_id AND (r.status='booked' OR (r.status='reserved' AND r.reserved_until>clock_timestamp()))) THEN RAISE EXCEPTION 'native_slot_has_obligation'; END IF;
  IF (NEW.slot_id,NEW.schedule_id,NEW.service_version_id,NEW.local_start,NEW.timezone,NEW.buffer_minutes,NEW.occupied_until) IS DISTINCT FROM (OLD.slot_id,OLD.schedule_id,OLD.service_version_id,OLD.local_start,OLD.timezone,OLD.buffer_minutes,OLD.occupied_until) OR (OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at) THEN RAISE EXCEPTION 'native_slot_immutable'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM resident_schedule_versions sv JOIN resident_schedule_previews p ON p.id=sv.preview_id JOIN resident_service_versions v ON v.id=NEW.service_version_id AND v.review_id=sv.review_id JOIN slots s ON s.id=NEW.slot_id AND s.expert_service_id=v.expert_service_id CROSS JOIN LATERAL jsonb_array_elements(p.entries) entry
   WHERE sv.id=NEW.schedule_id AND s.provider='resident_native' AND s.observed_at IS NULL AND s.capacity=1 AND (entry->>'serviceId')::uuid=v.rich_service_id AND (entry->>'startsAt')::timestamptz=s.starts_at AND (entry->>'endsAt')::timestamptz=s.ends_at AND (entry->>'occupiedUntil')::timestamptz=NEW.occupied_until AND (entry->>'bufferMinutes')::integer=NEW.buffer_minutes AND entry->>'localStart'=NEW.local_start AND entry->>'timezone'=NEW.timezone AND s.ends_at-s.starts_at=v.duration_minutes*interval '1 minute' AND NEW.occupied_until=s.ends_at+NEW.buffer_minutes*interval '1 minute') THEN RAISE EXCEPTION 'native_slot_source'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_materialize_approved_services(target_review uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE NEW resident_card_versions; expert uuid; service uuid; s jsonb;
BEGIN
 SELECT * INTO NEW FROM resident_card_versions WHERE review_id=target_review;
 IF EXISTS(SELECT 1 FROM resident_service_versions WHERE review_id=target_review) THEN RETURN; END IF;
 IF NEW.profile IS NULL THEN RETURN; END IF;
 INSERT INTO experts(user_id) SELECT user_id FROM expert_card_drafts WHERE id=NEW.draft_id ON CONFLICT(user_id) DO NOTHING;
 SELECT e.id INTO expert FROM experts e JOIN expert_card_drafts d ON d.user_id=e.user_id WHERE d.id=NEW.draft_id FOR UPDATE OF e;
 PERFORM pg_advisory_xact_lock(hashtextextended('expert:'||expert::text,0));
 UPDATE resident_native_slots n SET withdrawn_at=clock_timestamp() FROM slots slot JOIN expert_services es ON es.id=slot.expert_service_id WHERE n.slot_id=slot.id AND es.expert_id=expert AND n.withdrawn_at IS NULL AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.slot_id=slot.id AND r.status IN('reserved','booked'));
 FOR s IN SELECT value FROM jsonb_array_elements(NEW.profile->'services') LOOP
  SELECT expert_service_id INTO service FROM resident_service_mappings WHERE draft_id=NEW.draft_id AND rich_service_id=(s->>'id')::uuid;
  IF service IS NULL THEN
   INSERT INTO expert_services(expert_id,name,code,language,duration_minutes,active) VALUES(expert,s->>'title','resident_'||replace(gen_random_uuid()::text,'-',''),'ru',(s->>'durationMinutes')::integer,true) RETURNING id INTO service;
   INSERT INTO resident_service_mappings(draft_id,rich_service_id,expert_service_id) VALUES(NEW.draft_id,(s->>'id')::uuid,service);
  ELSE UPDATE expert_services SET name=s->>'title',duration_minutes=(s->>'durationMinutes')::integer,active=true WHERE id=service AND expert_id=expert;
  END IF;
  INSERT INTO resident_service_versions(review_id,rich_service_id,expert_service_id,title,duration_minutes,format,logistics) VALUES(NEW.review_id,(s->>'id')::uuid,service,s->>'title',(s->>'durationMinutes')::integer,CASE WHEN s->>'format'='EVENT' THEN s->>'eventDelivery' ELSE s->>'format' END,jsonb_build_object('room',NEW.profile->'staticRoomLink','address',NEW.profile->'address','arrival',NEW.profile->'arrival','map',NEW.profile->'yandexMapsUrl'));
 END LOOP;
 UPDATE expert_services es SET active=false FROM resident_service_mappings m WHERE m.expert_service_id=es.id AND m.draft_id=NEW.draft_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.profile->'services') candidate WHERE (candidate->>'id')::uuid=m.rich_service_id);
 IF NEW.initial_schedule IS NOT NULL THEN PERFORM resident_apply_schedule((NEW.initial_schedule->>'previewId')::uuid,NEW.review_id); END IF;
 RETURN;
END $$;
