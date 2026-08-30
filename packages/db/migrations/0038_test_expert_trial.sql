create table test_expert_prompt_assets (
  id uuid primary key default gen_random_uuid(), asset_key text not null, version integer not null,
  sha256 char(64) not null, source_path text not null, status text not null default 'inactive',
  official_contract_evidence text, created_at timestamptz not null default now(),
  constraint test_expert_prompt_id_version_unique unique (id, version),
  constraint test_expert_prompt_key_version_unique unique (asset_key, version),
  constraint test_expert_prompt_key_bounded check (char_length(asset_key) between 1 and 128),
  constraint test_expert_prompt_version_positive check (version > 0),
  constraint test_expert_prompt_digest_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint test_expert_prompt_source_bounded check (char_length(source_path) between 1 and 512 and source_path !~ '[[:cntrl:]]'),
  constraint test_expert_prompt_status_check check (status in ('inactive', 'approved', 'retired')),
  constraint test_expert_prompt_activation_check check (status <> 'approved' or (official_contract_evidence is not null and char_length(official_contract_evidence) between 1 and 512))
);
create table test_expert_campaign_versions (
  id uuid primary key default gen_random_uuid(), code text not null, version integer not null,
  status text not null default 'inactive', cap_units integer not null default 100,
  provider_calls_per_message integer not null default 1, prompt_asset_id uuid, prompt_asset_version integer,
  effective_from timestamptz, effective_to timestamptz, created_at timestamptz not null default now(),
  constraint test_expert_campaign_prompt_asset_fk foreign key (prompt_asset_id, prompt_asset_version) references test_expert_prompt_assets(id, version) on delete restrict,
  constraint test_expert_campaign_code_bounded check (char_length(code) between 1 and 128),
  constraint test_expert_campaign_version_positive check (version > 0),
  constraint test_expert_campaign_status_check check (status in ('inactive', 'active', 'retired')),
  constraint test_expert_campaign_cap_check check (cap_units = 100),
  constraint test_expert_campaign_provider_calls_check check (provider_calls_per_message = 1),
  constraint test_expert_campaign_period_check check (effective_to is null or effective_from is null or effective_to > effective_from),
  constraint test_expert_campaign_prompt_activation_check check (status <> 'active' or (prompt_asset_id is not null and prompt_asset_version is not null and effective_from is not null)),
  constraint test_expert_campaign_code_version_unique unique (code, version)
);
create unique index test_expert_campaign_one_active_idx on test_expert_campaign_versions (code) where status='active';
create function validate_test_expert_initial_status() returns trigger language plpgsql as $$
begin if new.status<>'inactive' then raise exception 'test expert lifecycle must start inactive'; end if; return new; end $$;
create trigger test_expert_prompt_initial_status before insert on test_expert_prompt_assets for each row execute function validate_test_expert_initial_status();
create trigger test_expert_campaign_initial_status before insert on test_expert_campaign_versions for each row execute function validate_test_expert_initial_status();
create function validate_test_expert_campaign_prompt() returns trigger language plpgsql as $$
begin
  if new.status='active' and not exists (
    select 1 from test_expert_prompt_assets p where p.id=new.prompt_asset_id and p.version=new.prompt_asset_version
      and p.status='approved' and p.official_contract_evidence is not null
  ) then raise exception 'test expert campaign prompt is not approved'; end if;
  return new;
end $$;
create trigger test_expert_campaign_prompt_authority before insert or update on test_expert_campaign_versions for each row execute function validate_test_expert_campaign_prompt();
create function reject_test_expert_immutable_mutation() returns trigger language plpgsql as $$ begin raise exception 'test expert immutable fact'; end $$;
create table test_expert_lifecycle_audit_events (
  id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id uuid not null,
  from_status text not null, to_status text not null, created_at timestamptz not null default now(),
  constraint test_expert_lifecycle_entity_type_check check(entity_type in ('prompt','campaign')),
  constraint test_expert_lifecycle_transition_check check(from_status<>to_status)
);
create function validate_test_expert_prompt_transition() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'test expert immutable fact'; end if;
  if (old.id,old.asset_key,old.version,old.sha256,old.source_path,old.official_contract_evidence,old.created_at)
     is distinct from (new.id,new.asset_key,new.version,new.sha256,new.source_path,new.official_contract_evidence,new.created_at)
     or not ((old.status='inactive' and new.status='approved') or (old.status='approved' and new.status='retired'))
  then raise exception 'invalid test expert prompt transition'; end if;
  return new;
end $$;
create function validate_test_expert_campaign_transition() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'test expert immutable fact'; end if;
  if (old.id,old.code,old.version,old.cap_units,old.provider_calls_per_message,old.prompt_asset_id,old.prompt_asset_version,old.effective_from,old.effective_to,old.created_at)
     is distinct from (new.id,new.code,new.version,new.cap_units,new.provider_calls_per_message,new.prompt_asset_id,new.prompt_asset_version,new.effective_from,new.effective_to,new.created_at)
     or not ((old.status='inactive' and new.status='active') or (old.status='active' and new.status='retired'))
  then raise exception 'invalid test expert campaign transition'; end if;
  return new;
end $$;
create function audit_test_expert_lifecycle_transition() returns trigger language plpgsql as $$
begin insert into test_expert_lifecycle_audit_events(entity_type,entity_id,from_status,to_status)
values(case when tg_table_name='test_expert_prompt_assets' then 'prompt' else 'campaign' end,new.id,old.status,new.status); return new; end $$;
create trigger test_expert_prompt_transition before update or delete on test_expert_prompt_assets for each row execute function validate_test_expert_prompt_transition();
create trigger test_expert_campaign_transition before update or delete on test_expert_campaign_versions for each row execute function validate_test_expert_campaign_transition();
create trigger test_expert_prompt_transition_audit after update on test_expert_prompt_assets for each row execute function audit_test_expert_lifecycle_transition();
create trigger test_expert_campaign_transition_audit after update on test_expert_campaign_versions for each row execute function audit_test_expert_lifecycle_transition();
create trigger test_expert_lifecycle_audit_immutable before update or delete on test_expert_lifecycle_audit_events for each row execute function reject_test_expert_immutable_mutation();
alter table dialogues add constraint dialogues_id_user_bot_chat_unique unique(id,user_id,bot_key,external_chat_id);
create table test_expert_sessions (
  id uuid primary key default gen_random_uuid(), campaign_version_id uuid references test_expert_campaign_versions(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict, dialogue_id uuid not null references dialogues(id) on delete restrict,
  bot_key text not null, external_chat_id text not null, state text not null, version integer not null default 1,
  segment text, name_digest char(64), specialization_digest char(64), copy_version text not null,
  selling_activation text not null default 'inactive', status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint test_expert_session_state_check check (state in ('awaiting_name','awaiting_specialization','awaiting_segment','ready','qualified','closed')),
  constraint test_expert_session_version_positive check (version > 0),
  constraint test_expert_session_segment_check check (segment is null or segment in ('EXPERT','CENTER','ORGANIZER')),
  constraint test_expert_session_digest_check check ((name_digest is null or name_digest ~ '^[0-9a-f]{64}$') and (specialization_digest is null or specialization_digest ~ '^[0-9a-f]{64}$')),
  constraint test_expert_session_scope_bounded check (char_length(bot_key) between 1 and 128 and char_length(external_chat_id) between 1 and 64),
  constraint test_expert_session_copy_bounded check (char_length(copy_version) between 1 and 128),
  constraint test_expert_session_selling_inactive check (selling_activation='inactive'),
  constraint test_expert_session_status_check check (status in ('active','closed')),
  constraint test_expert_session_closed_equivalence_check check ((state='closed')=(status='closed')),
  constraint test_expert_session_progress_check check (
    (state='awaiting_name' and name_digest is null and specialization_digest is null and segment is null) or
    (state='awaiting_specialization' and name_digest is not null and specialization_digest is null and segment is null) or
    (state='awaiting_segment' and name_digest is not null and specialization_digest is not null and segment is null) or
    (state in ('ready','qualified','closed') and name_digest is not null and specialization_digest is not null and segment is not null)
  ),
  constraint test_expert_session_dialogue_scope_fk foreign key(dialogue_id,user_id,bot_key,external_chat_id) references dialogues(id,user_id,bot_key,external_chat_id) on delete restrict
);
create unique index test_expert_session_one_active_scope_idx on test_expert_sessions(bot_key,external_chat_id) where status='active';
create index test_expert_sessions_user_idx on test_expert_sessions(user_id,created_at);
create table test_expert_deterministic_requests (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references test_expert_sessions(id) on delete restrict,
  outbox_id uuid not null references integration_outbox(id) on delete restrict, bot_key text not null,
  request_key text not null, request_digest char(64) not null, created_at timestamptz not null default now(),
  constraint test_expert_deterministic_scope_key_unique unique(bot_key,request_key),
  constraint test_expert_deterministic_bot_bounded check(char_length(bot_key) between 1 and 128),
  constraint test_expert_deterministic_key_bounded check(char_length(request_key) between 1 and 128),
  constraint test_expert_deterministic_digest_check check(request_digest ~ '^[0-9a-f]{64}$')
);
create trigger test_expert_deterministic_immutable before update or delete on test_expert_deterministic_requests for each row execute function reject_test_expert_immutable_mutation();
create table test_expert_redemptions (
  id uuid primary key default gen_random_uuid(), campaign_version_id uuid not null references test_expert_campaign_versions(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict, redemption_idempotency_key text not null,
  granted_units integer not null default 100, consumed_units integer not null default 0, reserved_units integer not null default 0, created_at timestamptz not null default now(),
  constraint test_expert_redemption_key_bounded check (char_length(redemption_idempotency_key) between 1 and 128),
  constraint test_expert_redemption_granted_check check (granted_units = 100),
  constraint test_expert_redemption_nonnegative_check check (consumed_units >= 0 and reserved_units >= 0),
  constraint test_expert_redemption_capacity_check check (consumed_units + reserved_units <= granted_units),
  constraint test_expert_redemption_units_even_check check (consumed_units % 2 = 0 and reserved_units % 2 = 0)
  ,constraint test_expert_redemption_key_unique unique(redemption_idempotency_key)
  ,constraint test_expert_redemption_scope_unique unique(id,campaign_version_id,user_id)
);
alter table test_expert_sessions add column redemption_id uuid;
alter table test_expert_sessions add constraint test_expert_session_redemption_scope_fk foreign key(redemption_id,campaign_version_id,user_id) references test_expert_redemptions(id,campaign_version_id,user_id) on delete restrict;
alter table test_expert_sessions add constraint test_expert_session_qualified_authority_check check(state<>'qualified' or (campaign_version_id is not null and redemption_id is not null));
create table test_expert_reservations (
  id uuid primary key default gen_random_uuid(), redemption_id uuid not null references test_expert_redemptions(id) on delete restrict,
  request_key text not null, request_digest text not null, units integer not null default 2, status text not null default 'reserved', provider_request_id text, created_at timestamptz not null default now(),
  constraint test_expert_reservation_request_unique unique (redemption_id, request_key),
  constraint test_expert_reservation_key_bounded check (char_length(request_key) between 1 and 128),
  constraint test_expert_reservation_digest_check check (request_digest ~ '^[0-9a-f]{64}$'),
  constraint test_expert_reservation_units_check check (units = 2),
  constraint test_expert_reservation_status_check check (status in ('reserved', 'unknown', 'applied', 'not_applied'))
);
create table test_expert_outcomes (
  id uuid primary key default gen_random_uuid(), reservation_id uuid not null references test_expert_reservations(id) on delete restrict,
  outcome text not null, provider_request_id text, recorded_at timestamptz not null default now(),
  constraint test_expert_outcome_value_check check (outcome in ('unknown', 'applied', 'not_applied')),
  constraint test_expert_outcome_reservation_unique unique (reservation_id, outcome)
);
create table test_expert_audit_events (
  id uuid primary key default gen_random_uuid(), redemption_id uuid not null references test_expert_redemptions(id) on delete restrict,
  reservation_id uuid references test_expert_reservations(id) on delete restrict, event_type text not null, event_digest text, created_at timestamptz not null default now(),
  constraint test_expert_audit_type_bounded check (char_length(event_type) between 1 and 64),
  constraint test_expert_audit_digest_check check (event_digest is null or event_digest ~ '^[0-9a-f]{64}$')
);
create index test_expert_redemptions_user_idx on test_expert_redemptions(user_id, campaign_version_id);
create index test_expert_reservations_redemption_status_idx on test_expert_reservations(redemption_id, status, created_at);
create index test_expert_reservations_unknown_global_idx on test_expert_reservations(created_at,id) where status in ('reserved','unknown');
create unique index test_expert_reservations_provider_request_idx on test_expert_reservations(provider_request_id) where provider_request_id is not null;
create index test_expert_outcomes_reservation_idx on test_expert_outcomes(reservation_id, recorded_at);
create unique index test_expert_outcomes_unknown_unique on test_expert_outcomes(reservation_id) where outcome='unknown';
create unique index test_expert_outcomes_terminal_unique on test_expert_outcomes(reservation_id) where outcome in ('applied','not_applied');
create index test_expert_audit_redemption_idx on test_expert_audit_events(redemption_id, created_at);
alter table test_expert_reservations add constraint test_expert_reservation_provider_request_check check (
  (status in ('unknown','applied') and provider_request_id ~ '^sha256:[0-9a-f]{64}$')
  or (status in ('reserved','not_applied') and (provider_request_id is null or provider_request_id ~ '^sha256:[0-9a-f]{64}$'))
);
alter table test_expert_outcomes add constraint test_expert_outcome_provider_request_check check (
  (outcome in ('unknown','applied') and provider_request_id ~ '^sha256:[0-9a-f]{64}$')
  or (outcome='not_applied' and (provider_request_id is null or provider_request_id ~ '^sha256:[0-9a-f]{64}$'))
);
create trigger test_expert_audit_immutable before update or delete on test_expert_audit_events for each row execute function reject_test_expert_immutable_mutation();
revoke all on test_expert_prompt_assets, test_expert_campaign_versions, test_expert_lifecycle_audit_events, test_expert_sessions, test_expert_deterministic_requests, test_expert_redemptions, test_expert_reservations, test_expert_outcomes, test_expert_audit_events from public;
