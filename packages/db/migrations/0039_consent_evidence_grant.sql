-- 0039_consent_evidence_grant.sql
-- ТЗ по ПД от 2026-09-21: EVID-01…04 (состав доказательства решения), CONS-01/02 (одна цель —
-- одно решение), EGRESS-03 (монотонная ревизия как будущий барьер отзыва), DATA-01 (строка
-- реестра). Только аддитивные изменения: `consents` остаётся единственным журналом фактов
-- решений, параллельной базы согласий нет (SCOPE-01).
--
-- Проверки над `consents` добавляются как NOT VALID: существующие строки исторических окружений
-- не должны ронять деплой; отбор «история не противоречит правилу» выполняется отдельно
-- (VACUUM-подобный шаг в эксплуатации), а не молча в этом файле.

-- 1. Монотонный порядок вставки: два решения с одинаковым created_at больше нельзя перепутать.
alter table "consents"
  add column if not exists "sequence" bigint generated always as identity,
  add column if not exists "channel" text,
  add column if not exists "scope_fields" jsonb,
  add column if not exists "document_version_id" uuid,
  add column if not exists "presentation_id" uuid,
  add column if not exists "prior_decision_id" uuid,
  add column if not exists "recipient_id" uuid,
  add column if not exists "reservation_id" uuid,
  add column if not exists "text_sha256" text,
  add column if not exists "basis" text;

-- 2. Версии документов: тело неизменяемо и всегда согласовано со своим хешем (EVID-01, EVID-02).
create table if not exists "consent_document_versions" (
  id uuid primary key default gen_random_uuid(),
  document_key text not null,
  version integer not null,
  title text not null,
  body text not null,
  text_sha256 char(64) not null,
  status text not null default 'inactive',
  effective_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz not null default now(),
  constraint consent_document_key_version_unique unique (document_key, version),
  constraint consent_document_key_bounded check (char_length(document_key) between 1 and 128),
  constraint consent_document_version_positive check (version > 0),
  constraint consent_document_title_bounded check (char_length(title) between 1 and 256),
  constraint consent_document_body_bounded check (char_length(body) between 1 and 65536),
  constraint consent_document_digest_check check (text_sha256 ~ '^[0-9a-f]{64}$'),
  constraint consent_document_body_matches_digest check (
    text_sha256 = encode(digest(body, 'sha256'), 'hex')
  ),
  constraint consent_document_status_check check (status in ('inactive', 'approved', 'retired')),
  constraint consent_document_approval_check check (
    status <> 'approved' or (approved_at is not null and char_length(approved_by) between 1 and 128)
  ),
  constraint consent_document_transition_audit_required check (
    status <> 'retired' or approved_at is not null
  )
);
create trigger consent_document_versions_append_only before update or delete on consent_document_versions
  for each row execute function reject_append_only_change();

-- 3. Предъявление: кому, что и под какой версией показали; одноразовый токен, срок, эпоха отзыва.
create table if not exists "consent_presentations" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete restrict,
  session_key text,
  purpose text not null,
  document_version_id uuid not null references consent_document_versions(id) on delete restrict,
  token_digest text not null,
  channel text not null,
  revoke_epoch bigint not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  constraint consent_presentations_subject_check check (
    (user_id is not null) <> (session_key is not null)
  ),
  constraint consent_presentations_session_bounded check (
    session_key is null or char_length(session_key) between 8 and 128
  ),
  constraint consent_presentations_purpose_bounded check (char_length(purpose) between 1 and 64),
  constraint consent_presentations_token_digest_check check (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint consent_presentations_channel_check check (channel in ('web', 'telegram')),
  constraint consent_presentations_expiry_check check (expires_at > created_at),
  constraint consent_presentations_epoch_check check (revoke_epoch >= 0)
);
create unique index if not exists consent_presentations_token_unique
  on consent_presentations (token_digest);
create index if not exists consent_presentations_subject_idx
  on consent_presentations (user_id, purpose, created_at desc);

-- 4. Проекция текущего состояния с монотонной ревизией (EVID-03): журнал остаётся append-only,
-- «текущее» больше не выводится двумя несовместимыми способами на чтении.
create table if not exists "consent_states" (
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null,
  decision text not null,
  document_version_id uuid references consent_document_versions(id) on delete restrict,
  last_decision_id uuid references consents(id) on delete restrict,
  revision bigint not null,
  updated_at timestamptz not null default now(),
  constraint consent_states_pkey primary key (user_id, purpose),
  constraint consent_states_last_decision_fk foreign key (last_decision_id)
    references consents(id) on delete restrict,
  constraint consent_states_purpose_bounded check (char_length(purpose) between 1 and 64),
  constraint consent_states_decision_check check (decision in ('granted', 'denied', 'revoked')),
  constraint consent_states_revision_positive check (revision > 0)
);

-- 5. Правила над самим журналом решений.
alter table "consents"
  add constraint "consents_decision_known" check (decision in ('granted', 'denied', 'revoked')) not valid,
  add constraint "consents_channel_known" check (channel is null or channel in ('web', 'telegram')) not valid,
  add constraint "consents_text_sha256_shape" check (text_sha256 is null or text_sha256 ~ '^[0-9a-f]{64}$') not valid,
  add constraint "consents_evidence_document_fk" foreign key (document_version_id)
    references consent_document_versions(id) on delete restrict not valid,
  add constraint "consents_evidence_presentation_fk" foreign key (presentation_id)
    references consent_presentations(id) on delete restrict not valid,
  add constraint "consents_no_self_reference" check (prior_decision_id is null or prior_decision_id <> id) not valid;

create index if not exists consents_subject_purpose_order_idx
  on consents (user_id, consent_type, created_at desc, "sequence" desc);
