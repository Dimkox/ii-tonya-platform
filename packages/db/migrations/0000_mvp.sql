create extension if not exists pgcrypto;

create type reservation_status as enum (
  'reserved', 'booked', 'cancelled_by_client', 'cancelled_by_expert',
  'expired', 'completed', 'no_show'
);
create type outbox_status as enum (
  'pending', 'processing', 'unknown_outcome', 'reconciling',
  'succeeded', 'retry_wait', 'dead_letter'
);
create type ledger_entry_kind as enum (
  'grant', 'debit', 'free', 'compensation', 'revocation'
);

create table users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table channel_identities (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id),
  provider text not null, external_id text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table client_profiles (
  user_id uuid primary key references users(id), display_name text, timezone text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table consents (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id),
  consent_type text not null, decision text not null, policy_version text not null,
  created_at timestamptz not null default now()
);

create table experts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id),
  active boolean not null default false, verified boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table expert_services (
  id uuid primary key default gen_random_uuid(), expert_id uuid not null references experts(id),
  name text not null, active boolean not null default true, duration_minutes integer not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table slots (
  id uuid primary key default gen_random_uuid(), expert_service_id uuid not null references expert_services(id),
  provider text not null, external_slot_id text not null, starts_at timestamptz not null,
  ends_at timestamptz not null, capacity integer not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table message_packages (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id),
  granted_messages integer not null, grant_idempotency_key text not null,
  created_at timestamptz not null default now()
);
create table message_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id),
  provider text not null, external_message_id text not null, direction text not null,
  created_at timestamptz not null default now()
);
create table message_ledger_entries (
  id uuid primary key default gen_random_uuid(), package_id uuid not null references message_packages(id),
  entry_kind ledger_entry_kind not null, delta integer not null, direction text not null default 'outbound',
  message_event_id uuid references message_events(id), original_entry_id uuid,
  idempotency_key text not null, created_at timestamptz not null default now()
);

create table reservations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id),
  expert_service_id uuid not null references expert_services(id), status reservation_status not null default 'reserved',
  idempotency_key text not null, reserved_until timestamptz not null, version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table notifications (
  id uuid primary key default gen_random_uuid(), reservation_id uuid not null references reservations(id),
  idempotency_key text not null, callback_token_hash text, callback_claims text,
  callback_expires_at timestamptz, callback_expert_id uuid, callback_action text,
  callback_version integer, callback_consumed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table feedback (
  id uuid primary key default gen_random_uuid(), reservation_id uuid not null references reservations(id),
  user_id uuid not null references users(id), rating integer not null, comment_ref text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table conversation_messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references conversations(id),
  author_type text not null, content_ref text, created_at timestamptz not null default now()
);
create table prompt_versions (
  id uuid primary key default gen_random_uuid(), name text not null, version integer not null,
  content_ref text not null, created_at timestamptz not null default now(),
  constraint prompt_versions_name_version_unique unique(name, version)
);
create table safety_incidents (
  id uuid primary key default gen_random_uuid(), conversation_id uuid references conversations(id),
  reason_code text not null, metadata_hash text not null, created_at timestamptz not null default now()
);
create table human_escalations (
  id uuid primary key default gen_random_uuid(), incident_id uuid not null references safety_incidents(id),
  status text not null, owner_id uuid references users(id), opened_at timestamptz not null,
  acknowledgement_deadline timestamptz not null, acknowledged_at timestamptz, resolved_at timestamptz,
  version integer not null default 1, escalation_reason text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(), actor_type text not null, actor_id uuid not null,
  authenticated_session_id_hash text not null, action text not null, object_type text not null,
  object_id uuid not null, decision text not null, reason_code text not null,
  correlation_id uuid not null, occurred_at timestamptz not null, metadata_hash text not null,
  created_at timestamptz not null default now()
);
create table admin_approvals (
  id uuid primary key default gen_random_uuid(), action text not null, object_type text not null,
  object_id uuid not null, requester_id uuid not null references users(id),
  approver_id uuid not null references users(id), expires_at timestamptz not null,
  nonce text not null, consumed_at timestamptz, created_at timestamptz not null default now(),
  constraint admin_approvals_scope_nonce_unique
    unique(action, object_type, object_id, requester_id, approver_id, nonce)
);
create table privacy_deletion_jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id),
  idempotency_key text not null, status text not null, backup_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint privacy_deletion_jobs_subject_idempotency_unique unique(user_id, idempotency_key)
);
create table privacy_processor_attempts (
  id uuid primary key default gen_random_uuid(), deletion_job_id uuid not null references privacy_deletion_jobs(id),
  processor text not null, status text not null, receipt_ref text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint privacy_processor_attempts_job_processor_unique unique(deletion_job_id, processor)
);

create table integration_inbox (
  id uuid primary key default gen_random_uuid(), provider text not null, external_event_id text not null,
  payload_hash text not null, normalized_identifier text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table integration_outbox (
  id uuid primary key default gen_random_uuid(), idempotency_key text not null,
  status outbox_status not null default 'pending', reconciliation_key text not null,
  attempt integer not null default 0, reconciliation_attempt integer not null default 0,
  dispatch_owner_id text, lease_until timestamptz, reconciliation_owner_id text,
  reconciliation_lease_until timestamptz, last_normalized_reason text, payload_hash text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table delivery_attempts (
  id uuid primary key default gen_random_uuid(), outbox_id uuid not null references integration_outbox(id),
  attempt integer not null, provider text not null, outcome text not null, normalized_reason text,
  created_at timestamptz not null default now()
);
create table dead_letters (
  id uuid primary key default gen_random_uuid(), outbox_id uuid not null references integration_outbox(id),
  reason text not null, payload_hash text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table provider_cursors (
  id uuid primary key default gen_random_uuid(), provider text not null, cursor text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint provider_cursors_provider_unique unique(provider)
);
create table reconciliation_runs (
  id uuid primary key default gen_random_uuid(), provider text not null, started_at timestamptz not null,
  completed_at timestamptz, created_at timestamptz not null default now()
);
create table reconciliation_mismatches (
  id uuid primary key default gen_random_uuid(), reconciliation_run_id uuid not null references reconciliation_runs(id),
  outbox_id uuid references integration_outbox(id), reason text not null, created_at timestamptz not null default now()
);
create table projection_checkpoints (
  id uuid primary key default gen_random_uuid(), projection text not null, position text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint projection_checkpoints_projection_unique unique(projection)
);

alter table channel_identities
  add constraint channel_identities_provider_external_unique unique (provider, external_id);
alter table slots
  add constraint slots_provider_external_unique unique (provider, external_slot_id),
  add constraint slots_capacity_positive check (capacity > 0);
alter table message_packages
  add constraint message_packages_grant_positive check (granted_messages > 0),
  add constraint message_packages_grant_idempotency_unique unique (grant_idempotency_key);
alter table message_events
  add constraint message_events_provider_external_unique unique (provider, external_message_id);
alter table message_ledger_entries
  add constraint message_ledger_idempotency_unique unique (idempotency_key),
  add constraint message_ledger_original_entry_fk
    foreign key (original_entry_id) references message_ledger_entries(id),
  add constraint message_ledger_delta_matches_kind check (
    (entry_kind = 'grant' and delta > 0 and message_event_id is null and original_entry_id is null)
    or (entry_kind = 'debit' and delta = -1 and message_event_id is not null and original_entry_id is null)
    or (entry_kind = 'free' and delta = 0 and message_event_id is not null and original_entry_id is null)
    or (entry_kind = 'compensation' and delta = 1 and message_event_id is null and original_entry_id is not null)
    or (entry_kind = 'revocation' and delta <= 0 and message_event_id is null and original_entry_id is not null)
  );
create unique index message_ledger_message_fact_once
  on message_ledger_entries(message_event_id, direction)
  where message_event_id is not null and entry_kind in ('debit', 'free');
create unique index message_ledger_grant_once_per_package
  on message_ledger_entries(package_id)
  where entry_kind = 'grant';
create unique index message_ledger_compensation_once_per_original
  on message_ledger_entries(original_entry_id)
  where entry_kind = 'compensation';
create unique index message_ledger_revocation_once_per_package_grant
  on message_ledger_entries(package_id, original_entry_id)
  where entry_kind = 'revocation';
alter table reservations
  add constraint reservations_idempotency_unique unique (idempotency_key),
  add constraint reservations_version_positive check (version > 0),
  add constraint reservations_deadline_after_creation check (reserved_until > created_at);
alter table notifications
  add constraint notifications_idempotency_unique unique (idempotency_key);
create unique index notifications_callback_token_hash_unique on notifications(callback_token_hash)
  where callback_token_hash is not null;
alter table integration_inbox
  add constraint integration_inbox_provider_event_unique unique (provider, external_event_id);
alter table integration_outbox
  add constraint integration_outbox_idempotency_unique unique (idempotency_key),
  add constraint integration_outbox_reconciliation_key_present check (
    length(reconciliation_key) > 0
  ),
  add constraint integration_outbox_attempts_nonnegative check (
    attempt >= 0 and reconciliation_attempt >= 0
  );
create index integration_outbox_dispatch_lease
  on integration_outbox(status, lease_until)
  where status = 'processing';
create index integration_outbox_reconciliation_lease
  on integration_outbox(status, reconciliation_lease_until)
  where status = 'reconciling';

create view package_balances as
select p.id as package_id, p.user_id, coalesce(sum(l.delta), 0)::integer as balance
from message_packages p
left join message_ledger_entries l on l.package_id = p.id
group by p.id, p.user_id;

create function reject_append_only_change() returns trigger language plpgsql as $$
begin
  raise exception 'append-only facts cannot be changed' using errcode = '55000';
end;
$$;
create trigger message_packages_append_only before update or delete on message_packages
  for each row execute function reject_append_only_change();
create trigger message_ledger_entries_append_only before update or delete on message_ledger_entries
  for each row execute function reject_append_only_change();
create trigger consents_append_only before update or delete on consents
  for each row execute function reject_append_only_change();
create trigger audit_events_append_only before update or delete on audit_events
  for each row execute function reject_append_only_change();
create trigger safety_incidents_append_only before update or delete on safety_incidents
  for each row execute function reject_append_only_change();
create trigger human_escalations_append_only before update or delete on human_escalations
  for each row execute function reject_append_only_change();
create trigger prompt_versions_append_only before update or delete on prompt_versions
  for each row execute function reject_append_only_change();
create trigger delivery_attempts_append_only before update or delete on delivery_attempts
  for each row execute function reject_append_only_change();
create trigger reconciliation_mismatches_append_only before update or delete on reconciliation_mismatches
  for each row execute function reject_append_only_change();
