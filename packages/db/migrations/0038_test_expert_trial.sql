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
create function validate_test_expert_campaign_prompt() returns trigger language plpgsql as $$
begin
  if new.status='active' and not exists (
    select 1 from test_expert_prompt_assets p where p.id=new.prompt_asset_id and p.version=new.prompt_asset_version
      and p.status='approved' and p.official_contract_evidence is not null
  ) then raise exception 'test expert campaign prompt is not approved'; end if;
  return new;
end $$;
create trigger test_expert_campaign_prompt_authority before insert on test_expert_campaign_versions for each row execute function validate_test_expert_campaign_prompt();
create function reject_test_expert_immutable_mutation() returns trigger language plpgsql as $$ begin raise exception 'test expert immutable fact'; end $$;
create trigger test_expert_prompt_immutable before update or delete on test_expert_prompt_assets for each row execute function reject_test_expert_immutable_mutation();
create trigger test_expert_campaign_immutable before update or delete on test_expert_campaign_versions for each row execute function reject_test_expert_immutable_mutation();
create table test_expert_sessions (
  id uuid primary key default gen_random_uuid(), campaign_version_id uuid references test_expert_campaign_versions(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict, dialogue_id uuid not null references dialogues(id) on delete restrict,
  bot_key text not null, external_chat_id text not null, state text not null, version integer not null default 1,
  segment text, name_digest char(64), specialization_digest char(64), copy_version text not null,
  selling_activation text not null default 'inactive', status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint test_expert_session_state_check check (state in ('awaiting_name','awaiting_specialization','awaiting_segment','qualified','closed')),
  constraint test_expert_session_version_positive check (version > 0),
  constraint test_expert_session_segment_check check (segment is null or segment in ('EXPERT','CENTER','ORGANIZER')),
  constraint test_expert_session_digest_check check ((name_digest is null or name_digest ~ '^[0-9a-f]{64}$') and (specialization_digest is null or specialization_digest ~ '^[0-9a-f]{64}$')),
  constraint test_expert_session_scope_bounded check (char_length(bot_key) between 1 and 128 and char_length(external_chat_id) between 1 and 64),
  constraint test_expert_session_copy_bounded check (char_length(copy_version) between 1 and 128),
  constraint test_expert_session_selling_inactive check (selling_activation='inactive'),
  constraint test_expert_session_status_check check (status in ('active','closed')),
  constraint test_expert_session_qualified_check check (state <> 'qualified' or segment is not null)
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
  user_id uuid not null references users(id) on delete restrict, redemption_idempotency_key text not null unique,
  granted_units integer not null default 100, consumed_units integer not null default 0, reserved_units integer not null default 0, created_at timestamptz not null default now(),
  constraint test_expert_redemption_key_bounded check (char_length(redemption_idempotency_key) between 1 and 128),
  constraint test_expert_redemption_granted_check check (granted_units = 100),
  constraint test_expert_redemption_nonnegative_check check (consumed_units >= 0 and reserved_units >= 0),
  constraint test_expert_redemption_capacity_check check (consumed_units + reserved_units <= granted_units),
  constraint test_expert_redemption_units_even_check check (consumed_units % 2 = 0 and reserved_units % 2 = 0)
);
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
revoke all on test_expert_prompt_assets, test_expert_campaign_versions, test_expert_sessions, test_expert_deterministic_requests, test_expert_redemptions, test_expert_reservations, test_expert_outcomes, test_expert_audit_events from public;
