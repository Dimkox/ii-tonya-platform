-- Native availability has explicit owner/review authority; observations remain provider facts.
ALTER TABLE expert_card_drafts ADD COLUMN initial_schedule jsonb;
--> statement-breakpoint
ALTER TABLE resident_card_versions ADD COLUMN initial_schedule jsonb;
--> statement-breakpoint
CREATE TABLE resident_schedule_state (
 draft_id uuid PRIMARY KEY REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(rules)='object' AND octet_length(rules::text)<=4000),
 mode text NOT NULL DEFAULT 'live' CHECK(mode IN('live','card')),
 field integer NOT NULL DEFAULT 0 CHECK(field BETWEEN 0 AND 7),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 raw_input text CHECK(octet_length(raw_input)<=64000),
 current_preview uuid,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE TABLE resident_schedule_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 schedule_revision integer NOT NULL CHECK(schedule_revision>=0),
 draft_revision integer NOT NULL CHECK(draft_revision>=0),
 review_id uuid REFERENCES resident_card_versions(review_id) ON DELETE CASCADE,
 raw_input text CHECK(octet_length(raw_input)<=64000),
 profile_digest text NOT NULL CHECK(profile_digest ~ '^[0-9a-f]{64}$'),
 rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='object' AND octet_length(rules::text)<=4000),
 entries jsonb NOT NULL CHECK(jsonb_typeof(entries)='array' AND jsonb_array_length(entries)<=500 AND octet_length(entries::text)<=300000),
 omissions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(omissions)='array' AND octet_length(omissions::text)<=150000),
 errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(errors)='array' AND octet_length(errors::text)<=150000),
 page integer NOT NULL DEFAULT -1 CHECK(page>=-1),
 page_count integer NOT NULL CHECK(page_count BETWEEN 1 AND 500),
 token_digest text CHECK(token_digest ~ '^[0-9a-f]{64}$'),
 confirmed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '1 hour'
);
--> statement-breakpoint
CREATE FUNCTION resident_schedule_preview_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.draft_id,NEW.schedule_revision,NEW.draft_revision,NEW.review_id,NEW.raw_input,NEW.profile_digest,NEW.rules,NEW.entries,NEW.omissions,NEW.errors,NEW.page_count,NEW.created_at,NEW.expires_at) IS DISTINCT FROM (OLD.id,OLD.draft_id,OLD.schedule_revision,OLD.draft_revision,OLD.review_id,OLD.raw_input,OLD.profile_digest,OLD.rules,OLD.entries,OLD.omissions,OLD.errors,OLD.page_count,OLD.created_at,OLD.expires_at) OR OLD.confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'native_preview_immutable'; END IF;
 IF NEW.confirmed_at IS NOT NULL AND (NEW.errors<>'[]'::jsonb OR NEW.page<>NEW.page_count-1 OR NEW.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM resident_schedule_state s JOIN expert_card_drafts d ON d.id=s.draft_id WHERE s.draft_id=NEW.draft_id AND s.current_preview=NEW.id AND s.revision=NEW.schedule_revision AND d.revision=NEW.draft_revision)) THEN RAISE EXCEPTION 'native_preview_incomplete'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_schedule_preview_guard BEFORE UPDATE ON resident_schedule_previews FOR EACH ROW EXECUTE FUNCTION resident_schedule_preview_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_rich_digest(d expert_card_drafts) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(digest((jsonb_build_object('revision',d.revision,'profile',d.rich_profile,'public',d.public_payload,'proposal',d.rich_proposal,'guided',d.rich_guided)||CASE WHEN d.rich_pending_services='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('pending',d.rich_pending_services) END||CASE WHEN d.semantic_tags='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('tags',d.semantic_tags) END||CASE WHEN d.initial_schedule IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('schedule',d.initial_schedule) END)::text,'sha256'),'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION resident_initial_schedule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.rich_profile IS DISTINCT FROM OLD.rich_profile THEN NEW.initial_schedule:=NULL; END IF;
 IF NEW.initial_schedule IS DISTINCT FROM OLD.initial_schedule THEN
  IF NEW.revision<>OLD.revision+1 OR NEW.status<>'collecting' THEN RAISE EXCEPTION 'native_schedule_revision_required'; END IF;
  NEW.owner_confirmed_digest:=NULL; NEW.preview_page:=NULL; NEW.preview_token_digest:=NULL; NEW.preview_content_digest:=NULL;
  IF NEW.initial_schedule IS NOT NULL AND NOT EXISTS(SELECT 1 FROM resident_schedule_previews p WHERE p.id=(NEW.initial_schedule->>'previewId')::uuid AND p.draft_id=NEW.id AND p.draft_revision=OLD.revision AND p.confirmed_at IS NOT NULL AND p.review_id IS NULL AND p.profile_digest=encode(digest(NEW.rich_profile::text,'sha256'),'hex') AND NEW.initial_schedule=jsonb_build_object('previewId',p.id,'rules',p.rules,'entries',p.entries,'omissions',p.omissions)) THEN RAISE EXCEPTION 'native_initial_schedule_source'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_initial_schedule_guard BEFORE UPDATE ON expert_card_drafts FOR EACH ROW EXECUTE FUNCTION resident_initial_schedule_guard();
--> statement-breakpoint
CREATE FUNCTION resident_version_schedule_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN SELECT initial_schedule INTO NEW.initial_schedule FROM expert_card_drafts WHERE id=NEW.draft_id; RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER resident_version_schedule_source BEFORE INSERT ON resident_card_versions FOR EACH ROW EXECUTE FUNCTION resident_version_schedule_source();
--> statement-breakpoint
CREATE TABLE resident_service_mappings (
 draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 rich_service_id uuid NOT NULL,
 expert_service_id uuid NOT NULL UNIQUE REFERENCES expert_services(id),
 PRIMARY KEY(draft_id,rich_service_id)
);
--> statement-breakpoint
CREATE TABLE resident_service_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 review_id uuid NOT NULL REFERENCES resident_card_versions(review_id) ON DELETE CASCADE,
 rich_service_id uuid NOT NULL,
 expert_service_id uuid NOT NULL REFERENCES expert_services(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 5 AND 1440),
 format text NOT NULL CHECK(format IN('ONLINE','OFFLINE','HYBRID')),
 logistics jsonb NOT NULL CHECK(jsonb_typeof(logistics)='object' AND octet_length(logistics::text)<=10000),
 UNIQUE(review_id,rich_service_id)
);
--> statement-breakpoint
CREATE TRIGGER resident_service_version_immutable BEFORE UPDATE ON resident_service_versions FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TABLE resident_schedule_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 preview_id uuid NOT NULL UNIQUE REFERENCES resident_schedule_previews(id) ON DELETE CASCADE,
 review_id uuid NOT NULL REFERENCES resident_card_versions(review_id) ON DELETE CASCADE,
 expert_id uuid NOT NULL REFERENCES experts(id),
 confirmed_at timestamptz NOT NULL,
 valid_until timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE TRIGGER resident_schedule_version_immutable BEFORE UPDATE ON resident_schedule_versions FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TABLE resident_native_slots (
 slot_id uuid PRIMARY KEY REFERENCES slots(id) ON DELETE CASCADE,
 schedule_id uuid NOT NULL REFERENCES resident_schedule_versions(id) ON DELETE CASCADE,
 service_version_id uuid NOT NULL REFERENCES resident_service_versions(id) ON DELETE CASCADE,
 local_start text NOT NULL,
 timezone text NOT NULL,
 buffer_minutes integer NOT NULL CHECK(buffer_minutes BETWEEN 0 AND 240),
 occupied_until timestamptz NOT NULL,
 withdrawn_at timestamptz
);
--> statement-breakpoint
CREATE TABLE resident_schedule_busy (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 expert_id uuid NOT NULL REFERENCES experts(id),
 draft_id uuid NOT NULL REFERENCES expert_card_drafts(id) ON DELETE CASCADE,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE TABLE resident_native_confirmations (
 reservation_id uuid PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
 slot_id uuid NOT NULL REFERENCES resident_native_slots(slot_id) ON DELETE CASCADE,
 service_version_id uuid NOT NULL REFERENCES resident_service_versions(id) ON DELETE CASCADE,
 reservation_version integer NOT NULL CHECK(reservation_version>1),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=15000),
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE TRIGGER resident_native_confirmation_immutable BEFORE UPDATE ON resident_native_confirmations FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE FUNCTION resident_native_admission(target_expert uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM experts e JOIN users u ON u.id=e.user_id JOIN experts_published p ON p.expert_id=e.id AND p.user_id=e.user_id JOIN resident_card_versions v ON v.review_id=p.review_id JOIN expert_card_drafts d ON d.id=v.draft_id
 WHERE e.id=target_expert AND e.active AND e.verified AND u.active AND p.active AND p.review_id=(SELECT latest.review_id FROM resident_card_versions latest WHERE latest.draft_id=d.id ORDER BY latest.revision DESC LIMIT 1)
 AND expert_card_activation_gate_valid(e.user_id,p.review_id) AND EXISTS(SELECT 1 FROM expert_residency_current_coverage(e.id))
 AND NOT EXISTS(SELECT 1 FROM expert_onboarding_applications a WHERE a.user_id=e.user_id AND (a.archived_at IS NOT NULL OR a.archive_until_date IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM expert_residency_lifecycle l WHERE l.expert_id=e.id AND l.status='paused')
 AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds h WHERE h.expert_id=e.id AND h.status='open'))
$$;
--> statement-breakpoint
CREATE FUNCTION resident_native_slot_valid(target uuid, at_time timestamptz) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM resident_native_slots n JOIN slots s ON s.id=n.slot_id JOIN resident_schedule_versions sv ON sv.id=n.schedule_id JOIN resident_service_versions v ON v.id=n.service_version_id JOIN resident_card_versions cv ON cv.review_id=v.review_id
 WHERE n.slot_id=target AND s.provider='resident_native' AND n.withdrawn_at IS NULL AND sv.valid_until>at_time AND s.starts_at<sv.valid_until AND sv.confirmed_at<=at_time
 AND ((v.review_id=(SELECT latest.review_id FROM resident_card_versions latest WHERE latest.draft_id=cv.draft_id ORDER BY latest.revision DESC LIMIT 1) AND sv.id=(SELECT latest.id FROM resident_schedule_versions latest WHERE latest.expert_id=sv.expert_id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)) OR EXISTS(SELECT 1 FROM reservations held WHERE held.slot_id=s.id AND held.status='reserved' AND held.reserved_until>at_time))
 AND resident_native_admission(sv.expert_id)
 AND (EXISTS(SELECT 1 FROM reservations held WHERE held.slot_id=s.id AND held.status='reserved' AND held.reserved_until>at_time) OR NOT EXISTS(SELECT 1 FROM resident_schedule_busy b WHERE b.expert_id=sv.expert_id AND b.starts_at<n.occupied_until AND b.ends_at>s.starts_at)))
$$;
--> statement-breakpoint
CREATE FUNCTION resident_slot_fresh(target uuid, at_time timestamptz) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT CASE WHEN s.provider='resident_native' THEN resident_native_slot_valid(s.id,at_time) ELSE s.observed_at BETWEEN at_time-interval '15 minutes' AND at_time AND NOT EXISTS(SELECT 1 FROM resident_schedule_busy b JOIN expert_services es ON es.expert_id=b.expert_id WHERE es.id=s.expert_service_id AND b.starts_at<s.ends_at AND b.ends_at>s.starts_at) END FROM slots s WHERE s.id=target
$$;
--> statement-breakpoint
CREATE FUNCTION resident_service_version_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; s jsonb;
BEGIN
 SELECT v.profile INTO p FROM resident_card_versions v JOIN resident_service_mappings m ON m.draft_id=v.draft_id AND m.rich_service_id=NEW.rich_service_id AND m.expert_service_id=NEW.expert_service_id WHERE v.review_id=NEW.review_id;
 SELECT value INTO s FROM jsonb_array_elements(p->'services') WHERE value->>'id'=NEW.rich_service_id::text;
 IF s IS NULL OR NEW.title IS DISTINCT FROM s->>'title' OR NEW.duration_minutes IS DISTINCT FROM (s->>'durationMinutes')::integer OR NEW.format IS DISTINCT FROM (CASE WHEN s->>'format'='EVENT' THEN s->>'eventDelivery' ELSE s->>'format' END) OR NEW.logistics IS DISTINCT FROM jsonb_build_object('room',p->'staticRoomLink','address',p->'address','arrival',p->'arrival','map',p->'yandexMapsUrl') THEN RAISE EXCEPTION 'native_service_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_service_version_source BEFORE INSERT ON resident_service_versions FOR EACH ROW EXECUTE FUNCTION resident_service_version_source();
--> statement-breakpoint
CREATE FUNCTION resident_schedule_version_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p resident_schedule_previews; v resident_card_versions;
BEGIN
 SELECT * INTO p FROM resident_schedule_previews WHERE id=NEW.preview_id;
 SELECT * INTO v FROM resident_card_versions WHERE review_id=NEW.review_id;
 IF p.id IS NULL OR p.confirmed_at IS NULL OR p.errors<>'[]'::jsonb OR p.draft_id IS DISTINCT FROM v.draft_id OR NEW.confirmed_at IS DISTINCT FROM p.confirmed_at
 OR p.profile_digest IS DISTINCT FROM encode(digest(v.profile::text,'sha256'),'hex')
 OR ((p.review_id=NEW.review_id) OR (p.review_id IS NULL AND v.initial_schedule->>'previewId'=p.id::text)) IS NOT TRUE
 OR NOT EXISTS(SELECT 1 FROM experts e JOIN expert_card_drafts d ON d.user_id=e.user_id WHERE d.id=p.draft_id AND e.id=NEW.expert_id)
 OR NEW.valid_until IS DISTINCT FROM (((p.rules->>'to')::date+1)::timestamp AT TIME ZONE (p.rules->>'timezone')) THEN RAISE EXCEPTION 'native_schedule_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_schedule_version_source BEFORE INSERT ON resident_schedule_versions FOR EACH ROW EXECUTE FUNCTION resident_schedule_version_source();
--> statement-breakpoint
CREATE FUNCTION resident_native_slot_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL AND EXISTS(SELECT 1 FROM reservations r WHERE r.slot_id=OLD.slot_id AND (r.status='booked' OR (r.status='reserved' AND r.reserved_until>clock_timestamp()))) THEN RAISE EXCEPTION 'native_slot_has_obligation'; END IF;
  IF (NEW.slot_id,NEW.schedule_id,NEW.service_version_id,NEW.local_start,NEW.timezone,NEW.buffer_minutes,NEW.occupied_until) IS DISTINCT FROM (OLD.slot_id,OLD.schedule_id,OLD.service_version_id,OLD.local_start,OLD.timezone,OLD.buffer_minutes,OLD.occupied_until) OR (OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at) THEN RAISE EXCEPTION 'native_slot_immutable'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM resident_schedule_versions sv JOIN resident_schedule_previews p ON p.id=sv.preview_id JOIN resident_service_versions v ON v.id=NEW.service_version_id AND v.review_id=sv.review_id JOIN slots s ON s.id=NEW.slot_id AND s.expert_service_id=v.expert_service_id CROSS JOIN LATERAL jsonb_array_elements(p.entries) entry
   WHERE sv.id=NEW.schedule_id AND s.provider='resident_native' AND s.observed_at IS NULL AND s.capacity=1 AND entry->>'serviceId'=v.rich_service_id::text AND (entry->>'startsAt')::timestamptz=s.starts_at AND (entry->>'endsAt')::timestamptz=s.ends_at AND (entry->>'occupiedUntil')::timestamptz=NEW.occupied_until AND (entry->>'bufferMinutes')::integer=NEW.buffer_minutes AND entry->>'localStart'=NEW.local_start AND entry->>'timezone'=NEW.timezone AND s.ends_at-s.starts_at=v.duration_minutes*interval '1 minute' AND NEW.occupied_until=s.ends_at+NEW.buffer_minutes*interval '1 minute') THEN RAISE EXCEPTION 'native_slot_source'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_native_slot_source BEFORE INSERT OR UPDATE ON resident_native_slots FOR EACH ROW EXECUTE FUNCTION resident_native_slot_source();
--> statement-breakpoint
CREATE FUNCTION resident_apply_schedule(target_preview uuid,target_review uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE p resident_schedule_previews; v resident_card_versions; expert uuid; schedule uuid; entry jsonb; service resident_service_versions; slot uuid;
BEGIN
 SELECT * INTO p FROM resident_schedule_previews WHERE id=target_preview FOR UPDATE;
 SELECT * INTO v FROM resident_card_versions WHERE review_id=target_review;
 SELECT e.id INTO expert FROM experts e JOIN expert_card_drafts d ON d.user_id=e.user_id WHERE d.id=v.draft_id FOR UPDATE OF e;
 IF expert IS NULL THEN RAISE EXCEPTION 'native_expert_missing'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('expert:'||expert::text,0));
 SELECT id INTO schedule FROM resident_schedule_versions WHERE preview_id=p.id;
 IF schedule IS NOT NULL THEN RETURN schedule; END IF;
 INSERT INTO resident_schedule_versions(preview_id,review_id,expert_id,confirmed_at,valid_until) VALUES(p.id,v.review_id,expert,p.confirmed_at,((p.rules->>'to')::date+1)::timestamp AT TIME ZONE (p.rules->>'timezone')) RETURNING id INTO schedule;
 -- Withdraw authority, never overwrite/cancel/move held or booked appointments.
 UPDATE resident_native_slots n SET withdrawn_at=clock_timestamp() FROM slots s JOIN expert_services es ON es.id=s.expert_service_id WHERE n.slot_id=s.id AND es.expert_id=expert AND n.withdrawn_at IS NULL AND s.starts_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.slot_id=s.id AND r.status IN('reserved','booked'));
 FOR entry IN SELECT value FROM jsonb_array_elements(p.entries) LOOP
  SELECT * INTO service FROM resident_service_versions WHERE review_id=v.review_id AND rich_service_id=(entry->>'serviceId')::uuid;
  IF service.id IS NULL THEN RAISE EXCEPTION 'native_service_missing'; END IF;
  IF (entry->>'startsAt')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'native_preview_expired_interval'; END IF;
  IF EXISTS(SELECT 1 FROM reservations r JOIN slots s ON s.id=r.slot_id LEFT JOIN resident_native_slots n ON n.slot_id=s.id WHERE r.expert_id=expert AND r.status IN('reserved','booked') AND s.starts_at<(entry->>'occupiedUntil')::timestamptz AND coalesce(n.occupied_until,s.ends_at)>(entry->>'startsAt')::timestamptz) OR EXISTS(SELECT 1 FROM resident_schedule_busy b WHERE b.expert_id=expert AND b.starts_at<(entry->>'occupiedUntil')::timestamptz AND b.ends_at>(entry->>'startsAt')::timestamptz) THEN RAISE EXCEPTION 'native_preview_conflicts_changed'; END IF;
  INSERT INTO slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,capacity) VALUES(service.expert_service_id,'resident_native',schedule::text||':'||service.id::text||':'||(entry->>'startsAt'),(entry->>'startsAt')::timestamptz,(entry->>'endsAt')::timestamptz,1) RETURNING id INTO slot;
  INSERT INTO resident_native_slots(slot_id,schedule_id,service_version_id,local_start,timezone,buffer_minutes,occupied_until) VALUES(slot,schedule,service.id,entry->>'localStart',entry->>'timezone',(entry->>'bufferMinutes')::integer,(entry->>'occupiedUntil')::timestamptz);
 END LOOP;
 RETURN schedule;
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_materialize_approved_services(target_review uuid) RETURNS void LANGUAGE plpgsql AS $$
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
 UPDATE expert_services es SET active=false FROM resident_service_mappings m WHERE m.expert_service_id=es.id AND m.draft_id=NEW.draft_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.profile->'services') candidate WHERE candidate->>'id'=m.rich_service_id::text);
 IF NEW.initial_schedule IS NOT NULL THEN PERFORM resident_apply_schedule((NEW.initial_schedule->>'previewId')::uuid,NEW.review_id); END IF;
 RETURN;
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_approved_services() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM resident_materialize_approved_services(NEW.review_id); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER resident_approved_services AFTER INSERT ON resident_card_versions FOR EACH ROW EXECUTE FUNCTION resident_approved_services();
--> statement-breakpoint
CREATE FUNCTION resident_native_confirmation_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r reservations; n resident_native_slots; v resident_service_versions; s slots;
BEGIN
 NEW.confirmed_at:=clock_timestamp();
 SELECT * INTO r FROM reservations WHERE id=NEW.reservation_id FOR UPDATE;
 SELECT * INTO n FROM resident_native_slots WHERE slot_id=r.slot_id;
 SELECT * INTO v FROM resident_service_versions WHERE id=n.service_version_id;
 SELECT * INTO s FROM slots WHERE id=r.slot_id;
 IF r.id IS NULL OR n.slot_id IS NULL OR r.status<>'reserved' OR r.reserved_until<=clock_timestamp() OR NOT resident_native_slot_valid(r.slot_id,clock_timestamp()) OR NEW.slot_id IS DISTINCT FROM r.slot_id OR NEW.service_version_id IS DISTINCT FROM n.service_version_id OR NEW.reservation_version<>r.version+1 OR NEW.snapshot IS DISTINCT FROM jsonb_build_object('serviceId',v.expert_service_id,'title',v.title,'durationMinutes',v.duration_minutes,'bufferMinutes',n.buffer_minutes,'timezone',n.timezone,'localStart',n.local_start,'startsAt',s.starts_at,'endsAt',s.ends_at,'format',v.format,'logistics',v.logistics) THEN RAISE EXCEPTION 'native_confirmation_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_native_confirmation_source BEFORE INSERT ON resident_native_confirmations FOR EACH ROW EXECUTE FUNCTION resident_native_confirmation_source();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION planerka_reservation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='booked' AND OLD.status<>'booked' AND NOT EXISTS(SELECT 1 FROM planerka_booking_operations WHERE reservation_id=NEW.id AND state='booked' AND provider_uid IS NOT NULL AND NOT cancel_requested)
 AND NOT EXISTS(SELECT 1 FROM resident_native_confirmations c JOIN resident_native_slots n ON n.slot_id=c.slot_id JOIN slots s ON s.id=n.slot_id WHERE c.reservation_id=NEW.id AND c.slot_id=NEW.slot_id AND c.reservation_version=NEW.version AND OLD.status='reserved' AND OLD.reserved_until>clock_timestamp() AND s.provider='resident_native' AND resident_native_slot_valid(s.id,clock_timestamp())) THEN RAISE EXCEPTION 'planerka_confirmation_required'; END IF;
 IF NEW.status IN('cancelled_by_client','cancelled_by_expert','expired') AND NEW.status IS DISTINCT FROM OLD.status THEN
  UPDATE planerka_booking_operations SET cancel_requested=true,state=CASE WHEN state='pending' THEN 'cancelled' WHEN state='booked' THEN 'cancel_pending' ELSE state END,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE reservation_id=NEW.id;
 END IF;
 IF NEW.status IN('completed','no_show') AND OLD.status='booked' THEN UPDATE planerka_booking_operations SET state='finished',updated_at=clock_timestamp() WHERE reservation_id=NEW.id AND state='booked'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TABLE resident_native_logistics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reservation_id uuid NOT NULL REFERENCES resident_native_confirmations(reservation_id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN('online','offline')),
 due_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','unknown','delivered','suppressed')),
 attempt_id uuid,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 lease_until timestamptz,
 receipt jsonb CHECK(receipt IS NULL OR (jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=1000)),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(reservation_id,kind)
);
--> statement-breakpoint
CREATE FUNCTION resident_native_logistics_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.snapshot->>'format' IN('ONLINE','HYBRID') THEN INSERT INTO resident_native_logistics(reservation_id,kind,due_at) VALUES(NEW.reservation_id,'online',(NEW.snapshot->>'startsAt')::timestamptz-interval '30 minutes'); END IF;
 IF NEW.snapshot->>'format' IN('OFFLINE','HYBRID') THEN INSERT INTO resident_native_logistics(reservation_id,kind,due_at) VALUES(NEW.reservation_id,'offline',NEW.confirmed_at); END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_native_logistics_capture AFTER INSERT ON resident_native_confirmations FOR EACH ROW EXECUTE FUNCTION resident_native_logistics_capture();
--> statement-breakpoint
CREATE FUNCTION resident_native_logistics_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM resident_native_confirmations c WHERE c.reservation_id=NEW.reservation_id AND ((NEW.kind='online' AND c.snapshot->>'format' IN('ONLINE','HYBRID') AND NEW.due_at=(c.snapshot->>'startsAt')::timestamptz-interval '30 minutes') OR (NEW.kind='offline' AND c.snapshot->>'format' IN('OFFLINE','HYBRID') AND NEW.due_at=c.confirmed_at))) THEN RAISE EXCEPTION 'native_logistics_source'; END IF;
 ELSE
  IF (NEW.id,NEW.reservation_id,NEW.kind,NEW.due_at) IS DISTINCT FROM (OLD.id,OLD.reservation_id,OLD.kind,OLD.due_at) OR (OLD.state IN('delivered','suppressed') AND NEW IS DISTINCT FROM OLD) OR (OLD.state='unknown' AND NEW.state NOT IN('unknown','delivered','suppressed')) THEN RAISE EXCEPTION 'native_logistics_immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_native_logistics_guard BEFORE INSERT OR UPDATE ON resident_native_logistics FOR EACH ROW EXECUTE FUNCTION resident_native_logistics_guard();
--> statement-breakpoint
CREATE FUNCTION resident_native_slot_times_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM resident_native_slots WHERE slot_id=OLD.id) AND (NEW.id,NEW.expert_service_id,NEW.provider,NEW.external_slot_id,NEW.starts_at,NEW.ends_at,NEW.observed_at,NEW.capacity) IS DISTINCT FROM (OLD.id,OLD.expert_service_id,OLD.provider,OLD.external_slot_id,OLD.starts_at,OLD.ends_at,OLD.observed_at,OLD.capacity) THEN RAISE EXCEPTION 'native_slot_immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_native_slot_times_guard BEFORE UPDATE ON slots FOR EACH ROW EXECUTE FUNCTION resident_native_slot_times_guard();
--> statement-breakpoint
CREATE FUNCTION resident_native_obligation(target_expert uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM reservations r JOIN resident_native_confirmations c ON c.reservation_id=r.id AND c.slot_id=r.slot_id JOIN experts e ON e.id=r.expert_id JOIN users u ON u.id=e.user_id JOIN slots s ON s.id=r.slot_id WHERE e.id=target_expert AND u.active AND e.verified AND EXISTS(SELECT 1 FROM expert_card_drafts d WHERE d.user_id=u.id AND expert_card_current_messaging_authority(u.id,d.messaging_policy_version)) AND r.status='booked' AND s.ends_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds h WHERE h.expert_id=e.id AND h.status='open'))
$$;

--> statement-breakpoint
CREATE FUNCTION resident_service_mapping_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' OR NOT EXISTS(SELECT 1 FROM expert_card_drafts d JOIN experts e ON e.user_id=d.user_id JOIN expert_services es ON es.expert_id=e.id WHERE d.id=NEW.draft_id AND es.id=NEW.expert_service_id) THEN RAISE EXCEPTION 'native_mapping_owner'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_service_mapping_source BEFORE INSERT OR UPDATE ON resident_service_mappings FOR EACH ROW EXECUTE FUNCTION resident_service_mapping_source();
--> statement-breakpoint
CREATE INDEX resident_native_logistics_due ON resident_native_logistics(due_at,id) WHERE state='pending';
--> statement-breakpoint
CREATE INDEX resident_native_slots_schedule ON resident_native_slots(schedule_id);
--> statement-breakpoint
CREATE INDEX resident_schedule_busy_expert ON resident_schedule_busy(expert_id,starts_at,ends_at);
--> statement-breakpoint
-- Existing approved rich residents can edit availability without reopening card review.
DO $$
DECLARE v record;
BEGIN
 FOR v IN SELECT DISTINCT ON(draft_id) review_id FROM resident_card_versions WHERE profile IS NOT NULL ORDER BY draft_id,revision DESC LOOP
  PERFORM resident_materialize_approved_services(v.review_id);
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION resident_native_reservation_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM resident_native_slots WHERE slot_id=OLD.slot_id) AND (NEW.id,NEW.slot_id,NEW.expert_id,NEW.expert_service_id,NEW.user_id) IS DISTINCT FROM (OLD.id,OLD.slot_id,OLD.expert_id,OLD.expert_service_id,OLD.user_id) THEN RAISE EXCEPTION 'native_appointment_identity_immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_native_reservation_identity_guard BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION resident_native_reservation_identity_guard();
