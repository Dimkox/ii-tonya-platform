DROP VIEW "public"."expert_referral_balances";--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" DROP CONSTRAINT "expert_provider_event_processing_result";--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "processing_result_code" text;--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "processing_result" jsonb;--> statement-breakpoint
UPDATE "expert_residency_provider_event_inbox"
SET "processing_result_code" = 'legacy_unreconstructable'
WHERE "processing_status" IN ('processed', 'failed');--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ADD CONSTRAINT "expert_provider_event_result_code_bounded" CHECK ("expert_residency_provider_event_inbox"."processing_result_code" is null
        or length("expert_residency_provider_event_inbox"."processing_result_code") between 1 and 64);--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ADD CONSTRAINT "expert_provider_event_processing_result" CHECK (
        ("expert_residency_provider_event_inbox"."processing_status" in ('pending', 'processing')
          and "expert_residency_provider_event_inbox"."processed_at" is null
          and "expert_residency_provider_event_inbox"."processing_result_digest" is null
          and "expert_residency_provider_event_inbox"."processing_result_code" is null
          and "expert_residency_provider_event_inbox"."processing_result" is null)
        or ("expert_residency_provider_event_inbox"."processing_status" = 'failed'
          and "expert_residency_provider_event_inbox"."processed_at" is not null
          and "expert_residency_provider_event_inbox"."processing_result_digest" is not null
          and "expert_residency_provider_event_inbox"."processing_result_code" is not null
          and "expert_residency_provider_event_inbox"."processing_result" is null)
        or ("expert_residency_provider_event_inbox"."processing_status" = 'processed'
          and "expert_residency_provider_event_inbox"."processed_at" is not null
          and "expert_residency_provider_event_inbox"."processing_result_digest" is not null
          and "expert_residency_provider_event_inbox"."processing_result_code" is not null
          and ("expert_residency_provider_event_inbox"."processing_result" is not null
            or "expert_residency_provider_event_inbox"."processing_result_code" = 'legacy_unreconstructable'))
      );--> statement-breakpoint
CREATE VIEW "public"."expert_referral_balances" AS (
  with debt_offsets as (
    select reversal.source_id as grant_id,
      coalesce(sum(repayment.amount_minor), 0)::bigint as repaid_minor
    from expert_referral_ledger_entries repayment
    join expert_referral_ledger_entries reversal
      on reversal.id = repayment.original_entry_id
      and reversal.entry_kind = 'reversal'
    where repayment.entry_kind = 'debt_repayment'
    group by reversal.source_id
  ), grant_positions as (
    select
      g.id as grant_id,
      g.inviter_expert_id as expert_id,
      g.expires_at,
      coalesce(sum(
        case
          when l.entry_kind = 'release' then 0
          when l.entry_kind = 'debt_repayment' then -a.amount_minor
          when l.entry_kind = 'reservation' and exists (
            select 1
            from expert_referral_ledger_entries terminal
            where terminal.original_entry_id = l.id
              and terminal.entry_kind in ('release', 'spend')
          ) then 0
          when l.amount_minor < 0 then -a.amount_minor
          else a.amount_minor
        end
      ), 0)::bigint + coalesce(debt_offsets.repaid_minor, 0)::bigint as net_minor
    from expert_referral_reward_grants g
    left join expert_referral_ledger_allocations a on a.reward_grant_id = g.id
    left join expert_referral_ledger_entries l on l.id = a.ledger_entry_id
    left join debt_offsets on debt_offsets.grant_id = g.id
    group by g.id, g.inviter_expert_id, g.expires_at, debt_offsets.repaid_minor
  ), account_positions as (
    select
      e.id as expert_id,
      coalesce(sum(
        case
          when p.expires_at > statement_timestamp()
          then greatest(p.net_minor, 0)
          else 0
        end
      ), 0)::bigint as current_credit_minor,
      coalesce(sum(greatest(-p.net_minor, 0)), 0)::bigint as debt_minor,
      min(p.expires_at) filter (
        where p.expires_at > statement_timestamp() and p.net_minor > 0
      ) as nearest_expiry_at
    from experts e
    left join grant_positions p on p.expert_id = e.id
    group by e.id
  ), active_reservations as (
    select
      l.account_expert_id as expert_id,
      coalesce(sum(a.amount_minor), 0)::bigint as reserved_minor
    from expert_referral_ledger_entries l
    join expert_referral_ledger_allocations a on a.ledger_entry_id = l.id
    join expert_referral_reward_grants g on g.id = a.reward_grant_id
    where l.entry_kind = 'reservation'
      and g.expires_at > statement_timestamp()
      and not exists (
        select 1
        from expert_referral_ledger_entries terminal
        join expert_referral_ledger_allocations terminal_allocation
          on terminal_allocation.ledger_entry_id = terminal.id
          and terminal_allocation.reward_grant_id = a.reward_grant_id
        where terminal.original_entry_id = l.id
          and terminal.entry_kind in ('release', 'spend')
      )
    group by l.account_expert_id
  ), lifetime_totals as (
    select
      e.id as expert_id,
      coalesce(sum(l.amount_minor) filter (where l.entry_kind = 'reward_grant'), 0)::bigint as lifetime_granted_minor,
      coalesce(sum(-l.amount_minor) filter (where l.entry_kind = 'spend'), 0)::bigint as lifetime_spent_minor,
      coalesce(sum(-l.amount_minor) filter (where l.entry_kind = 'expiry'), 0)::bigint as lifetime_expired_minor
    from experts e
    left join expert_referral_ledger_entries l on l.account_expert_id = e.id
    group by e.id
  )
  select
    p.expert_id,
    case when p.debt_minor > 0 then 0 else p.current_credit_minor end::bigint as spendable_balance_minor,
    coalesce(r.reserved_minor, 0)::bigint as reserved_balance_minor,
    p.debt_minor,
    p.nearest_expiry_at,
    l.lifetime_granted_minor,
    l.lifetime_spent_minor,
    l.lifetime_expired_minor
  from account_positions p
  join lifetime_totals l on l.expert_id = p.expert_id
  left join active_reservations r on r.expert_id = p.expert_id
);
