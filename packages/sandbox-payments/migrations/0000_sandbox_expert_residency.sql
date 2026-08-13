create table sandbox_expert_residency_environment (
  singleton boolean primary key default true check (singleton),
  marker text not null check (marker = 'ii_tonya_sandbox_v1')
);

create table sandbox_expert_residency_payments (
  payment_id text primary key check (payment_id ~ '^sandbox_payment_[A-Za-z0-9_-]{22,128}$'),
  order_id uuid not null unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency = 'RUB'),
  checkout_url text not null,
  state text not null check (state in ('created','settled','refunded')),
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp()
);

create table sandbox_expert_residency_commands (
  command_id text primary key
    check (command_id ~ '^sandbox_command_[A-Za-z0-9_-]{22,128}$'),
  payment_id text not null references sandbox_expert_residency_payments(payment_id),
  command_kind text not null check (command_kind in ('checkout','transition')),
  idempotency_key text not null check (
    length(idempotency_key) between 1 and 200 and
    idempotency_key ~ '^[A-Za-z0-9_.:-]+$'
  ),
  payload_digest text not null
    check (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default transaction_timestamp(),
  unique (command_kind, idempotency_key)
);

create index sandbox_commands_payment_idx
  on sandbox_expert_residency_commands(payment_id);

create table sandbox_expert_residency_events (
  event_id text primary key
    check (event_id ~ '^sandbox_event_[A-Za-z0-9_-]{22,128}$'),
  payment_id text not null references sandbox_expert_residency_payments(payment_id),
  transition_kind text not null check (transition_kind in ('settled','refunded')),
  payload_digest text not null
    check (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  correlation_id text not null check (
    length(correlation_id) between 1 and 200 and
    correlation_id ~ '^[A-Za-z0-9_.:-]+$'
  ),
  occurred_at timestamptz not null default transaction_timestamp(),
  processed_at timestamptz,
  check (processed_at is null or processed_at >= occurred_at)
);

create index sandbox_events_payment_pending_idx
  on sandbox_expert_residency_events(payment_id, occurred_at, event_id)
  where processed_at is null;

create function sandbox_expert_residency_command_append_only()
returns trigger language plpgsql as $$
begin
  raise exception using
    errcode = '55000',
    constraint = 'sandbox_commands_append_only',
    message = 'sandbox command history is append-only';
end
$$;

create trigger sandbox_commands_append_only
before update or delete on sandbox_expert_residency_commands
for each row execute function sandbox_expert_residency_command_append_only();

create function sandbox_expert_residency_event_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and
     old.processed_at is null and
     new.processed_at is not null and
     row(old.event_id, old.payment_id, old.transition_kind,
         old.payload_digest, old.payload, old.correlation_id, old.occurred_at)
       is not distinct from
     row(new.event_id, new.payment_id, new.transition_kind,
         new.payload_digest, new.payload, new.correlation_id, new.occurred_at)
  then
    return new;
  end if;
  raise exception using
    errcode = '55000',
    constraint = 'sandbox_events_append_only',
    message = 'sandbox provider event history is append-only';
end
$$;

create trigger sandbox_events_append_only
before update or delete on sandbox_expert_residency_events
for each row execute function sandbox_expert_residency_event_append_only();

insert into sandbox_expert_residency_environment (singleton, marker)
values (true, 'ii_tonya_sandbox_v1');
