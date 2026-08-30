create table test_expert_campaign_versions (
  id uuid primary key default gen_random_uuid(), code text not null, version integer not null,
  status text not null default 'inactive', cap_units integer not null default 100,
  provider_calls_per_message integer not null default 1, prompt_version text,
  effective_from timestamptz, effective_to timestamptz, created_at timestamptz not null default now(),
  constraint test_expert_campaign_code_bounded check (char_length(code) between 1 and 128),
  constraint test_expert_campaign_version_positive check (version > 0),
  constraint test_expert_campaign_status_check check (status in ('inactive', 'active', 'retired')),
  constraint test_expert_campaign_cap_check check (cap_units = 100),
  constraint test_expert_campaign_provider_calls_check check (provider_calls_per_message = 1),
  constraint test_expert_campaign_period_check check (effective_to is null or effective_from is null or effective_to > effective_from),
  constraint test_expert_campaign_code_version_unique unique (code, version)
);
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
create index test_expert_outcomes_reservation_idx on test_expert_outcomes(reservation_id, recorded_at);
create index test_expert_audit_redemption_idx on test_expert_audit_events(redemption_id, created_at);
revoke all on test_expert_campaign_versions, test_expert_redemptions, test_expert_reservations, test_expert_outcomes, test_expert_audit_events from public;
