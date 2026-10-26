-- Versioned sales-first intake; preserve historical financial and submission authority.
CREATE FUNCTION resident_verification_draft_v2_valid(d jsonb, complete boolean DEFAULT false, education_requirement text DEFAULT 'optional') RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v jsonb; item jsonb; roles jsonb; prohibited text := U&'[\0001-\0008\000B-\001F\007F-\009F]';
BEGIN
 IF d IS NULL OR jsonb_typeof(d)<>'object' OR octet_length(d::text)>100000 THEN RETURN false; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(d) LOOP
  IF jsonb_typeof(v)='string' AND v#>>'{}' ~ prohibited THEN RETURN false; END IF;
  IF k IN ('primaryRole','category','tax') THEN
   IF jsonb_typeof(v)<>'string' THEN RETURN false; END IF;
   IF k='primaryRole' AND v#>>'{}' NOT IN ('EXPERT','CENTER','ORGANIZER','EDU_PROJECT','ESOTERIC','OTHER') THEN RETURN false; END IF;
   IF k='category' AND v#>>'{}' NOT IN ('BASIC','EXCLUSIVE','BOTH') THEN RETURN false; END IF;
   IF k='tax' AND v#>>'{}' NOT IN ('SELF_EMPLOYED','IP','LLC','INDIVIDUAL_NO_STATUS') THEN RETURN false; END IF;
  ELSIF k IN ('roles','socialLinks','amenities','education','propertyEvidence','tourMedia','licence') THEN
   IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>(CASE WHEN k='roles' THEN 6 ELSE 10 END) THEN RETURN false; END IF;
   IF k='roles' AND jsonb_array_length(v)=0 THEN RETURN false; END IF;
   IF k IN ('roles','socialLinks','amenities') AND (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(v)) THEN RETURN false; END IF;
   FOR item IN SELECT * FROM jsonb_array_elements(v) LOOP
    IF k IN ('education','propertyEvidence','tourMedia','licence') THEN
     IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['kind','fileId','mimeType','size'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) key WHERE key NOT IN ('kind','fileId','mimeType','size','caption')) THEN RETURN false; END IF;
     IF jsonb_typeof(item->'kind')<>'string' OR item->>'kind' NOT IN ('photo','document','video') OR jsonb_typeof(item->'fileId')<>'string' OR (length(item->>'fileId') NOT BETWEEN 1 AND 512 OR item->>'fileId' !~ '^[A-Za-z0-9_-]+$') OR (jsonb_typeof(item->'mimeType')<>'null' AND (jsonb_typeof(item->'mimeType')<>'string' OR item->>'mimeType' NOT IN ('image/jpeg','image/png','application/pdf','video/mp4','application/vnd.openxmlformats-officedocument.wordprocessingml.document'))) OR (item->>'kind'='photo' AND item->>'mimeType'<>'image/jpeg') OR (jsonb_typeof(item->'size')<>'null' AND (jsonb_typeof(item->'size')<>'number' OR item->>'size' !~ '^[0-9]+$' OR (item->>'size')::numeric NOT BETWEEN 1 AND 20971520)) THEN RETURN false; END IF;
     IF (k='tourMedia' AND item->>'kind'<>'photo' AND coalesce(item->>'mimeType','') NOT IN('image/jpeg','image/png','video/mp4')) OR (item->>'kind'='video' AND (coalesce(item->>'mimeType','')<>'video/mp4' OR jsonb_typeof(item->'size')='null')) OR (item->>'mimeType'='application/vnd.openxmlformats-officedocument.wordprocessingml.document' AND jsonb_typeof(item->'size')='null') THEN RETURN false; END IF;
     IF item ? 'caption' AND (jsonb_typeof(item->'caption')<>'string' OR length(item->>'caption')>3000 OR item->>'caption' ~ prohibited) THEN RETURN false; END IF;
    ELSE
     IF jsonb_typeof(item)<>'string' OR item#>>'{}' ~ prohibited THEN RETURN false; END IF;
     IF k='roles' AND item#>>'{}' NOT IN ('EXPERT','CENTER','ORGANIZER','EDU_PROJECT','ESOTERIC','OTHER') THEN RETURN false; END IF;
     IF k='socialLinks' AND (length(item#>>'{}')>500 OR item#>>'{}' !~* '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?([/?#][^[:space:]\\]*)?$') THEN RETURN false; END IF;
     IF k='amenities' AND length(btrim(item#>>'{}')) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
    END IF;
   END LOOP;
  ELSIF k IN ('city','motivation','specialization','path','cases','methods','premisesType','eventFormat','programme','speakers','pastEvents','projectName','teachingTeam','graduateReviews') THEN
   IF jsonb_typeof(v)<>'string' OR length(btrim(v#>>'{}'))<1 OR length(v#>>'{}')>(CASE WHEN k='city' THEN 120 WHEN k='specialization' THEN 300 ELSE 3000 END) THEN RETURN false; END IF;
  ELSIF k IN ('capacity','experienceYears') THEN
   IF jsonb_typeof(v)<>'number' OR v#>>'{}' !~ '^[0-9]+$' OR (v#>>'{}')::numeric NOT BETWEEN (CASE WHEN k='experienceYears' THEN 0 ELSE 1 END) AND (CASE WHEN k='experienceYears' THEN 100 ELSE 100000 END) THEN RETURN false; END IF;
  ELSIF k='averageCheckMinor' THEN
   IF jsonb_typeof(v)<>'string' OR v#>>'{}' !~ '^(0|[1-9][0-9]{0,11})$' THEN RETURN false; END IF;
  ELSE RETURN false;
  END IF;
 END LOOP;
 roles:=d->'roles';
 IF d ? 'primaryRole' AND d ? 'roles' AND NOT roles ? (d->>'primaryRole') THEN RETURN false; END IF;
 IF complete THEN
  IF NOT d ?& ARRAY['primaryRole','roles','category','tax','city','socialLinks','motivation'] OR jsonb_array_length(d->'socialLinks')=0 THEN RETURN false; END IF;
  IF roles ? 'EXPERT' AND NOT d ?& ARRAY['specialization','averageCheckMinor','methods','experienceYears','cases'] THEN RETURN false; END IF;
  IF roles ? 'CENTER' AND (NOT d ?& ARRAY['propertyEvidence','capacity','amenities','premisesType','tourMedia'] OR jsonb_array_length(d->'propertyEvidence')=0 OR jsonb_array_length(d->'amenities')=0 OR jsonb_array_length(d->'tourMedia')=0) THEN RETURN false; END IF;
  IF roles ? 'ORGANIZER' AND NOT d ?& ARRAY['eventFormat','programme','speakers','pastEvents'] THEN RETURN false; END IF;
  IF roles ? 'EDU_PROJECT' AND NOT d ?& ARRAY['projectName','teachingTeam','graduateReviews'] THEN RETURN false; END IF;
  IF (roles ? 'ESOTERIC' OR roles ? 'OTHER') AND NOT d ?& ARRAY['path','cases'] THEN RETURN false; END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

--> statement-breakpoint
-- Keep v1 validation unchanged, including its submitted bytes and required policy.
CREATE FUNCTION resident_verification_version_valid(d jsonb,v integer,complete boolean DEFAULT false,education text DEFAULT 'optional') RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT CASE v WHEN 1 THEN resident_verification_draft_valid(d,complete,education) WHEN 2 THEN resident_verification_draft_v2_valid(d,complete,education) ELSE false END $$;
ALTER TABLE residents_applications DROP CONSTRAINT residents_applications_user_id_key,
 DROP CONSTRAINT residents_applications_form_version_check,
 DROP CONSTRAINT residents_applications_draft_check,
 DROP CONSTRAINT resident_verification_submission,
 DROP CONSTRAINT residents_applications_current_field_check,
 ADD COLUMN is_current boolean NOT NULL DEFAULT true,
 ADD COLUMN attempt_number integer NOT NULL DEFAULT 1 CHECK(attempt_number>0),
 ADD COLUMN submitted_revision integer,
 ADD COLUMN check_generation integer NOT NULL DEFAULT 0 CHECK(check_generation>=0),
 ADD COLUMN active_request_id uuid,
 ALTER COLUMN form_version SET DEFAULT 2,
 ALTER COLUMN policy_version SET DEFAULT 'resident_form_v2',
 ALTER COLUMN education_requirement SET DEFAULT 'optional',
 ADD CONSTRAINT residents_applications_form_version_check CHECK(form_version IN(1,2)),
 ADD CONSTRAINT residents_applications_draft_check CHECK(resident_verification_version_valid(draft,form_version)),
 ADD CONSTRAINT resident_verification_submission CHECK((submitted_at IS NULL AND submitted_draft IS NULL AND status='PENDING_DOCS' AND progress='FORM_FILLING') OR (submitted_at IS NOT NULL AND isfinite(submitted_at) AND submitted_draft IS NOT NULL AND resident_verification_version_valid(submitted_draft,form_version,true,education_requirement) AND status<>'PENDING_DOCS')),
 ADD CONSTRAINT residents_applications_current_field_check CHECK(current_field IN('roles','primaryRole','category','tax','city','socialLinks','motivation','specialization','averageCheckMinor','education','propertyEvidence','capacity','amenities','path','cases','methods','experienceYears','premisesType','tourMedia','eventFormat','programme','speakers','pastEvents','projectName','licence','teachingTeam','graduateReviews'));
DROP TRIGGER resident_verification_write_guard ON residents_applications;
UPDATE residents_applications f SET submitted_revision=w.submitted_revision,check_generation=1 FROM resident_verification_check_work w WHERE w.application_id=f.id;
CREATE UNIQUE INDEX resident_verification_current_owner ON residents_applications(user_id) WHERE is_current;
CREATE UNIQUE INDEX resident_verification_owner_attempt ON residents_applications(user_id,attempt_number);
--> statement-breakpoint
CREATE TABLE resident_message_templates (
 key_name text NOT NULL,version integer NOT NULL CHECK(version>0),category text NOT NULL CHECK(category IN('REJECT_SOFT','REJECT_HARD','INFO_REQUEST','REFUND_NOTICE')),body_text text NOT NULL,variables_list jsonb NOT NULL CHECK(jsonb_typeof(variables_list)='array'),is_active boolean NOT NULL DEFAULT true,PRIMARY KEY(key_name,version)
);
CREATE TRIGGER resident_message_templates_immutable BEFORE UPDATE OR DELETE ON resident_message_templates FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TABLE resident_review_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL REFERENCES residents_applications(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id),manager_id uuid NOT NULL REFERENCES users(id),session_hash text NOT NULL REFERENCES admin_sessions(session_id_hash),revision integer NOT NULL,generation integer NOT NULL,template_key text NOT NULL,template_version integer NOT NULL,action text NOT NULL CHECK(action IN('APPROVED_BASIC','APPROVED_EXCLUSIVE','REJECT_SOFT','REJECT_HARD','INFO_REQUESTED')),reason_code text NOT NULL,questions jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(questions)='array' AND jsonb_array_length(questions)<=10),final_text text NOT NULL CHECK(octet_length(final_text)<=12000 AND length(final_text)<=4096),final_hash text NOT NULL CHECK(final_hash=encode(digest(final_text,'sha256'),'hex')),variables jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',UNIQUE(id,application_id)
);
-- The audit has no applicant text or channel identifiers. Deleting private payloads
-- leaves only exact hashes and attempt/source proof for financial audit.
CREATE TABLE resident_review_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL,preview_id uuid NOT NULL UNIQUE,manager_id uuid NOT NULL REFERENCES users(id),session_hash text NOT NULL,source_revision integer NOT NULL,source_generation integer NOT NULL,submitted_revision integer NOT NULL,submitted_digest text NOT NULL,action text NOT NULL,reason_code text NOT NULL,template_key text NOT NULL,template_version integer NOT NULL,final_hash text NOT NULL CHECK(final_hash ~ '^[0-9a-f]{64}$'),deadline timestamptz,reapply_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER resident_review_events_immutable BEFORE UPDATE OR DELETE ON resident_review_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TABLE resident_information_requests (
 id uuid PRIMARY KEY REFERENCES resident_review_events(id),application_id uuid NOT NULL REFERENCES residents_applications(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id),questions jsonb NOT NULL CHECK(jsonb_typeof(questions)='array' AND jsonb_array_length(questions) BETWEEN 1 AND 10),deadline timestamptz NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN('open','completed','timeout','superseded')),completed_at timestamptz
);
CREATE TABLE resident_check_generations (
 application_id uuid NOT NULL REFERENCES residents_applications(id) ON DELETE CASCADE,generation integer NOT NULL,submitted_revision integer NOT NULL,supplement_revision integer NOT NULL,request_id uuid REFERENCES resident_information_requests(id) ON DELETE CASCADE,status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','manual_review','cancelled')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(application_id,generation)
);
INSERT INTO resident_check_generations(application_id,generation,submitted_revision,supplement_revision) SELECT id,check_generation,submitted_revision,revision FROM residents_applications WHERE submitted_revision IS NOT NULL;
ALTER TABLE resident_verification_application_updates ADD COLUMN request_id uuid REFERENCES resident_information_requests(id) ON DELETE CASCADE;
CREATE TABLE resident_review_messages (
 event_id uuid PRIMARY KEY REFERENCES resident_review_events(id),application_id uuid NOT NULL REFERENCES residents_applications(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id),consent_version text NOT NULL,final_text text NOT NULL,final_hash text NOT NULL CHECK(final_hash=encode(digest(final_text,'sha256'),'hex')),status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','dispatched','delivered','cancelled','unknown')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),receipt text,dispatched_at timestamptz,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX resident_review_messages_pending ON resident_review_messages(created_at) WHERE status='pending';
--> statement-breakpoint
CREATE FUNCTION resident_review_event_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p resident_review_previews; f residents_applications;
BEGIN
 SELECT * INTO p FROM resident_review_previews WHERE id=NEW.preview_id FOR UPDATE;
 SELECT * INTO f FROM residents_applications WHERE id=p.application_id FOR UPDATE;
 IF p.id IS NULL OR f.id IS NULL OR NOT f.is_current OR f.status<>'UNDER_REVIEW' OR NOT expert_card_manager_authority_valid(NEW.manager_id,NEW.session_hash) OR p.manager_id<>NEW.manager_id OR p.session_hash<>NEW.session_hash OR p.revision<>f.revision OR p.generation<>f.check_generation OR p.expires_at<=clock_timestamp() OR NEW.attempt_id<>f.id OR NEW.action<>p.action OR NEW.reason_code<>p.reason_code OR NEW.final_hash<>p.final_hash OR NEW.template_key<>p.template_key OR NEW.template_version<>p.template_version THEN RAISE EXCEPTION 'resident_preview_stale'; END IF;
 IF NEW.action='REJECT_SOFT' AND NEW.reason_code='REJECT_INSUFFICIENT_PROOF' AND NOT EXISTS(SELECT 1 FROM resident_information_requests r JOIN resident_check_generations g ON g.application_id=r.application_id AND g.request_id=r.id AND g.generation=f.check_generation WHERE r.application_id=f.id AND r.status IN('completed','timeout')) THEN RAISE EXCEPTION 'resident_information_first'; END IF;
 NEW.created_at:=clock_timestamp(); NEW.source_revision:=f.revision; NEW.source_generation:=f.check_generation; NEW.submitted_revision:=f.submitted_revision; NEW.submitted_digest:=encode(digest(f.submitted_draft::text,'sha256'),'hex');
 NEW.deadline:=CASE WHEN NEW.action='INFO_REQUESTED' THEN NEW.created_at+interval '48 hours' END;
 NEW.reapply_at:=CASE WHEN NEW.action='REJECT_SOFT' THEN NEW.created_at+interval '1 month' END;
 RETURN NEW;
END $$;
CREATE TRIGGER resident_review_event_source BEFORE INSERT ON resident_review_events FOR EACH ROW EXECUTE FUNCTION resident_review_event_source();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_verification_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM channel_identities ci JOIN users u ON u.id=ci.user_id AND u.active WHERE ci.id=NEW.channel_identity_id AND ci.user_id=NEW.user_id AND ci.provider='telegram' AND ci.status='active' AND ci.bot_key=NEW.bot_key AND ci.external_id=NEW.telegram_user_id AND ci.external_chat_id=NEW.chat_id) THEN RAISE EXCEPTION 'resident_identity_unavailable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING_DOCS' OR NEW.progress<>'FORM_FILLING' OR NEW.revision<>0 OR NEW.submitted_at IS NOT NULL OR NOT NEW.is_current THEN RAISE EXCEPTION 'resident_initial_state_invalid'; END IF;
  IF NEW.attempt_number>1 AND (NOT EXISTS(SELECT 1 FROM residents_applications previous_form JOIN resident_review_events e ON e.attempt_id=previous_form.id AND e.action='REJECT_SOFT' AND e.reapply_at<=clock_timestamp() WHERE previous_form.user_id=NEW.user_id AND previous_form.attempt_number=NEW.attempt_number-1 AND NOT previous_form.is_current AND previous_form.status='REJECTED') OR EXISTS(SELECT 1 FROM expert_onboarding_payment_facts WHERE user_id=NEW.user_id) OR EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=NEW.user_id)) THEN RAISE EXCEPTION 'resident_reapply_unavailable'; END IF;
  NEW.created_at:=clock_timestamp();
  INSERT INTO resident_verification_cohorts(user_id) VALUES(NEW.user_id) ON CONFLICT DO NOTHING;
 ELSE
  IF ROW(OLD.user_id,OLD.bot_id,OLD.bot_key,OLD.channel_identity_id,OLD.created_at,OLD.policy_version,OLD.education_requirement,OLD.telegram_user_id,OLD.chat_id,OLD.form_version,OLD.attempt_number) IS DISTINCT FROM ROW(NEW.user_id,NEW.bot_id,NEW.bot_key,NEW.channel_identity_id,NEW.created_at,NEW.policy_version,NEW.education_requirement,NEW.telegram_user_id,NEW.chat_id,NEW.form_version,NEW.attempt_number) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'resident_revision_invalid'; END IF;
  IF NOT OLD.is_current OR (OLD.is_current AND NOT NEW.is_current AND (OLD.status<>'REJECTED' OR NOT EXISTS(SELECT 1 FROM resident_review_events WHERE attempt_id=OLD.id AND action='REJECT_SOFT' AND reapply_at<=clock_timestamp()))) THEN RAISE EXCEPTION 'resident_attempt_frozen'; END IF;
  IF OLD.submitted_at IS NOT NULL AND ROW(OLD.draft,OLD.submitted_draft,OLD.submitted_at,OLD.submitted_revision) IS DISTINCT FROM ROW(NEW.draft,NEW.submitted_draft,NEW.submitted_at,NEW.submitted_revision) THEN RAISE EXCEPTION 'resident_submission_frozen'; END IF;
  IF OLD.submitted_at IS NOT NULL AND NEW.check_generation<>OLD.check_generation AND (NEW.check_generation<>OLD.check_generation+1 OR NOT EXISTS(SELECT 1 FROM resident_check_generations g JOIN resident_information_requests r ON r.id=g.request_id WHERE g.application_id=OLD.id AND g.generation=NEW.check_generation AND r.id=OLD.active_request_id AND r.status IN('completed','timeout'))) THEN RAISE EXCEPTION 'resident_check_generation_source'; END IF;
  IF OLD.status<>NEW.status THEN
   IF NEW.status IN('APPROVED_BASIC','APPROVED_EXCLUSIVE','REJECTED','INFO_REQUESTED') AND NOT EXISTS(SELECT 1 FROM resident_review_events e WHERE e.attempt_id=OLD.id AND e.source_revision=OLD.revision AND e.source_generation=OLD.check_generation AND (e.action=NEW.status OR (NEW.status='REJECTED' AND e.action IN('REJECT_SOFT','REJECT_HARD')))) THEN RAISE EXCEPTION 'resident_manager_decisions_unavailable'; END IF;
   IF NEW.status='UNDER_REVIEW' AND OLD.status<>'PENDING_DOCS' AND (OLD.status<>'INFO_REQUESTED' OR NOT EXISTS(SELECT 1 FROM resident_information_requests WHERE id=OLD.active_request_id AND application_id=OLD.id AND status IN('completed','timeout'))) THEN RAISE EXCEPTION 'resident_review_source'; END IF;
  END IF;
  IF OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL THEN NEW.submitted_at:=clock_timestamp(); NEW.submitted_revision:=NEW.revision; NEW.check_generation:=1; END IF;
 END IF;
 IF NEW.submitted_at IS NOT NULL AND NEW.draft<>NEW.submitted_draft THEN RAISE EXCEPTION 'resident_submission_invalid'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER resident_verification_write_guard BEFORE INSERT OR UPDATE ON residents_applications FOR EACH ROW EXECUTE FUNCTION resident_verification_write_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_verification_stage_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN UPDATE users SET current_verification_stage=coalesce((SELECT progress FROM residents_applications WHERE user_id=OLD.user_id AND is_current),'NONE') WHERE id=OLD.user_id; RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL THEN
 INSERT INTO resident_verification_check_work(application_id,user_id,submitted_revision) VALUES(NEW.id,NEW.user_id,NEW.submitted_revision);
 INSERT INTO resident_check_generations(application_id,generation,submitted_revision,supplement_revision) VALUES(NEW.id,1,NEW.submitted_revision,NEW.revision);
 END IF;
 IF NEW.is_current THEN UPDATE users SET current_verification_stage=NEW.progress WHERE id=NEW.user_id; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
-- Preserve frozen source identity independently of genuine manager lifecycle.
CREATE OR REPLACE FUNCTION expert_sales_form_valid(application uuid,owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN residents_applications f ON f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND f.submitted_at=b.submitted_at AND f.submitted_revision=b.submitted_revision AND encode(digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest WHERE b.application_id=application AND b.user_id=owner AND (f.status='UNDER_REVIEW' OR (f.status IN('APPROVED_BASIC','APPROVED_EXCLUSIVE') AND EXISTS(SELECT 1 FROM resident_review_events e WHERE e.attempt_id=f.id AND e.action=f.status AND e.submitted_revision=b.submitted_revision AND e.submitted_digest=b.submitted_digest))))
$$;
CREATE FUNCTION resident_terminal_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN residents_applications f ON f.id=b.form_id WHERE b.application_id=NEW.application_id AND f.form_version=2) AND NOT EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN residents_applications f ON f.id=b.form_id AND f.is_current JOIN resident_review_events e ON e.attempt_id=f.id AND e.source_revision=f.revision-1 AND e.manager_id=NEW.manager_id AND e.session_hash=NEW.manager_session_hash WHERE b.application_id=NEW.application_id AND ((NEW.decision='approved' AND e.action IN('APPROVED_BASIC','APPROVED_EXCLUSIVE')) OR (NEW.decision='rejected' AND e.action IN('REJECT_SOFT','REJECT_HARD')))) THEN RAISE EXCEPTION 'resident_preview_required'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER resident_terminal_decision_guard BEFORE INSERT ON expert_verification_decisions FOR EACH ROW EXECUTE FUNCTION resident_terminal_decision_guard();

--> statement-breakpoint
ALTER TABLE resident_verification_requests DROP CONSTRAINT resident_verification_requests_operation_check,ADD CONSTRAINT resident_verification_requests_operation_check CHECK(operation IN('start','patch','submit','followup','question','complete','reapply'));

--> statement-breakpoint
INSERT INTO resident_message_templates(key_name,version,category,body_text,variables_list) VALUES('REJECT_NICHE_MISMATCH',1,'REJECT_SOFT','{NAME}, здравствуйте!

Мы внимательно изучили вашу заявку на участие в проекте ии-Тоня.

На данном этапе мы формируем базу специалистов, чья экспертиза и формат работы максимально точно соответствуют текущим запросам нашей аудитории и внутренним стандартам качества сервиса.

К сожалению, ваше предложение пока не прошло этот фильтр. Это не оценка вашего профессионализма или ценности ваших услуг, а вопрос специфического совпадения с задачами платформы сейчас.

Мы сохранили ваши контакты в закрытом листе ожидания. Если наши критерии изменятся или появятся новые направления сотрудничества, мы свяжемся с вами первыми.

Желаем вам процветания в вашей практике! 🙏','["NAME", "REAPPLY_AT"]');
INSERT INTO resident_message_templates(key_name,version,category,body_text,variables_list) VALUES('REJECT_INSUFFICIENT_PROOF',1,'REJECT_SOFT','{NAME}, спасибо за интерес к проекту ии-Тоня.

Для обеспечения безопасности и высокого уровня доверия наших клиентов мы предъявляем строгие требования к подтверждению квалификации резидентов.

В ходе проверки мы не смогли убедиться в достаточности предоставленных материалов (документов об образовании, активных кейсов или живого присутствия в социальных сетях), чтобы рекомендовать вас клиентам без рисков.

Если вы решите дополнить свой портфель новыми сертификатами, опубликовать больше отзывов или активизировать ведение соцсетей — будем рады рассмотреть вашу повторную заявку через 1 месяц.

Успехов в развитии вашего бренда! 💜','["NAME", "REAPPLY_AT"]');
INSERT INTO resident_message_templates(key_name,version,category,body_text,variables_list) VALUES('REJECT_LEGAL_VIOLATION',1,'REJECT_HARD','{NAME}, здравствуйте.

Благодарим за обращение.

После анализа вашей заявки мы вынуждены отказать в размещении. Проект ии-Тоня работает исключительно в сфере немедицинского саморазвития и оздоровления. Услуги, предполагающие медицинское вмешательство, диагностику заболеваний или гарантирование конкретных финансовых/карьерных результатов, выходят за рамки нашего регламента и требований законодательства РФ.

Это решение окончательное и связано с защитой интересов наших пользователей.

Рекомендуем искать площадки, специализирующиеся на вашем профиле.

С уважением, команда ии-Тоня.','["NAME"]');
INSERT INTO resident_message_templates(key_name,version,category,body_text,variables_list) VALUES('REQ_INFO_GENERIC',1,'INFO_REQUEST','{NAME}, ваша заявка принята в работу!

Чтобы принять справедливое решение и предложить вам оптимальные условия участия, нам нужно уточнить пару моментов. Пожалуйста, ответьте на следующие вопросы:

{QUESTIONS_LIST}

Также, если у вас есть дополнительные материалы (презентация, ссылка на подробный прайс, видео-знакомство), пришлите их сюда.

⏳ Срок ответа: 48 часов. После этого мы продолжим проверку.

Спасибо за сотрудничество! 🤝','["NAME", "QUESTIONS_ARRAY", "DEADLINE"]');
INSERT INTO resident_message_templates(key_name,version,category,body_text,variables_list) VALUES('REJECT_POST_PAYMENT_REFUND',1,'REFUND_NOTICE','{NAME}, добрый день.

Мы завершили модерацию вашей карточки. К сожалению, выявлены существенные расхождения между заявленными данными и фактической деятельностью / требованиями безопасности проекта.

В связи с этим мы не можем продолжить сотрудничество и разместить вашу карточку в базе знаний.

Возврат средств за онбординг осуществляется согласно оферте (в течение 10 рабочих дней на реквизиты, указанные при оплате).

Приносим искренние извинения за доставленные неудобства. Данная мера необходима для поддержания высокого стандарта сервиса для наших клиентов.

С уважением, руководитель отдела качества ии-Тоня.','["NAME"]');
--> statement-breakpoint
ALTER TABLE expert_onboarding_applications DROP CONSTRAINT expert_onboarding_user_unique;
CREATE UNIQUE INDEX expert_onboarding_current_user_unique ON expert_onboarding_applications(user_id) WHERE verification_status<>'rejected';
CREATE FUNCTION resident_financial_attempt_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF EXISTS(SELECT 1 FROM expert_onboarding_applications WHERE user_id=NEW.user_id) AND (NOT EXISTS(SELECT 1 FROM residents_applications f JOIN resident_review_events e ON e.action='REJECT_SOFT' AND e.reapply_at<=clock_timestamp() JOIN residents_applications previous_form ON previous_form.id=e.attempt_id AND previous_form.user_id=f.user_id AND previous_form.attempt_number=f.attempt_number-1 WHERE f.user_id=NEW.user_id AND f.is_current AND f.attempt_number>1 AND f.status='UNDER_REVIEW' AND f.submitted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM expert_sales_form_bridges WHERE form_id=f.id)) OR EXISTS(SELECT 1 FROM expert_onboarding_payment_facts WHERE user_id=NEW.user_id) OR EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=NEW.user_id)) THEN RAISE EXCEPTION 'resident_reapply_unavailable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER resident_financial_attempt_source BEFORE INSERT ON expert_onboarding_applications FOR EACH ROW EXECUTE FUNCTION resident_financial_attempt_source();
CREATE TRIGGER resident_review_previews_immutable BEFORE UPDATE ON resident_review_previews FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

--> statement-breakpoint
ALTER TABLE resident_verification_application_updates ADD COLUMN question_number integer CHECK(question_number BETWEEN 1 AND 10);
--> statement-breakpoint
CREATE TABLE resident_review_recoveries (
 event_id uuid PRIMARY KEY REFERENCES resident_review_events(id),manager_id uuid NOT NULL REFERENCES users(id),session_hash text NOT NULL,action text NOT NULL DEFAULT 'closed_without_resend' CHECK(action='closed_without_resend'),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION resident_review_recovery_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT expert_card_manager_authority_valid(NEW.manager_id,NEW.session_hash) OR NOT EXISTS(SELECT 1 FROM resident_review_messages WHERE event_id=NEW.event_id AND status IN('dispatched','unknown')) THEN RAISE EXCEPTION 'resident_recovery_unavailable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER resident_review_recovery_source BEFORE INSERT ON resident_review_recoveries FOR EACH ROW EXECUTE FUNCTION resident_review_recovery_source();
CREATE TRIGGER resident_review_recoveries_immutable BEFORE UPDATE OR DELETE ON resident_review_recoveries FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
-- V2 supplements accept the same bounded references; v1 callers retain their
-- original validation in the version-dispatched repository.
CREATE OR REPLACE FUNCTION resident_verification_followup_valid(a jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 IF a IS NULL OR jsonb_typeof(a)<>'object' OR octet_length(a::text)>100000 OR NOT(a ? 'answer' OR a ? 'documents') OR EXISTS(SELECT 1 FROM jsonb_object_keys(a) key WHERE key NOT IN('answer','documents')) THEN RETURN false; END IF;
 IF a ? 'answer' AND (jsonb_typeof(a->'answer')<>'string' OR length(btrim(a->>'answer',E' \t\r\n')) NOT BETWEEN 1 AND 3000 OR a->>'answer' ~ U&'[\0001-\0008\000B-\001F\007F-\009F]') THEN RETURN false; END IF;
 IF a ? 'documents' AND (jsonb_typeof(a->'documents')<>'array' OR jsonb_array_length(a->'documents') NOT BETWEEN 1 AND 10 OR NOT resident_verification_draft_v2_valid(jsonb_build_object('education',a->'documents'))) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
ALTER TABLE expert_promo_manager_work DROP CONSTRAINT expert_promo_manager_work_user_id_key;
CREATE UNIQUE INDEX expert_promo_manager_current_owner ON expert_promo_manager_work(user_id) WHERE status='pending';
