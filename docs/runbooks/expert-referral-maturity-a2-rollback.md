# Expert referral maturity A2 rollback

Disable new referral reward grants through the audited feature switch, then stop and
drain the maturity worker. Preserve all pending, granted, cancelled, settlement, grant,
ledger, allocation, refund, and debt facts; never delete or rewrite them.

The switch operation is an audited, dual-controlled application command; this document
does not provide a direct production mutation command. Observe disablement and drain with
read-only probes:

```sql
select control_key, version, reward_grants_enabled, updated_at
from expert_referral_feature_controls where control_key='expert_referrals';

select count(*) filter (where status='pending') as pending,
       count(*) filter (where status='pending' and matures_at <= transaction_timestamp()) as due,
       count(*) filter (where status='pending' and lease_until < transaction_timestamp()) as stale_leases,
       count(*) filter (where status='granted') as granted,
       count(*) filter (where status='cancelled') as cancelled
from expert_referral_reward_maturities;

select date_trunc('minute', resolved_at) as minute, status, count(*)
from expert_referral_reward_maturities
where resolved_at >= transaction_timestamp() - interval '30 minutes'
group by 1,2 order by 1,2;

select count(*) as recoverable_expired_leases
from expert_referral_reward_maturities
where status='pending' and lease_token is not null
  and lease_until < transaction_timestamp();
```

After disablement, alert if terminal counts continue increasing for two worker polling
intervals, any lease remains live beyond five minutes plus one polling interval, stale
leases increase across three observations, or due pending count grows for three
consecutive observations. A stale lease is recoverable by the normal bounded claimant;
never clear it manually.

Verify that no new transitions occur and that the append-only reversal/debt path remains
available for already granted rewards. Forward recovery requires healthy lease recovery,
zero unexplained failures, a newly approved feature-control version, and fresh exact-SHA
verification before restarting the bounded worker. This runbook does not authorize
provider activation or production writes.
