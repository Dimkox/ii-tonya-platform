create unique index test_expert_campaign_one_active_idx
  on test_expert_campaign_versions (code) where status='active';

alter table test_expert_reservations
  add constraint test_expert_reservation_provider_request_check check (
    (status in ('unknown','applied') and provider_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
    or (status in ('reserved','not_applied') and (provider_request_id is null or provider_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'))
  );

alter table test_expert_outcomes
  add constraint test_expert_outcome_provider_request_check check (
    (outcome in ('unknown','applied') and provider_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
    or (outcome='not_applied' and (provider_request_id is null or provider_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'))
  );

create index test_expert_reservations_unknown_global_idx
  on test_expert_reservations (created_at,id) where status='unknown';
create unique index test_expert_reservations_provider_request_idx
  on test_expert_reservations (provider_request_id) where provider_request_id is not null;
