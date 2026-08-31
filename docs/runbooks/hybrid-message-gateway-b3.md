# B3 budget controls runbook

Keep `SELARTI_COST_ADMISSION_ENABLED=false` and `CLIENT_HYBRID_ROUTING_ENABLED=false` until B2 provider gates and an approved policy are present. Inspect only bounded aggregates:

```sql
select period_start, count(*) reservations, sum(reserved_rub_minor) reserved_rub_minor from selarti_cost_reservations group by period_start order by period_start desc limit 12;
select outcome, count(*), sum(amount_rub_minor) from selarti_budget_alerts where created_at >= now()-interval '30 days' group by outcome;
select kind, count(*), sum(amount_rub_minor) from selarti_cost_adjustments group by kind;
```

For rollback, disable hybrid routing and cost admission, restart the API, and leave 0036 facts intact. Unknown outcomes retain their reservation; reconcile them to a definite `not_applied` or provider usage fact before re-enabling. Policies are immutable: recover forward with a newly approved, future-effective version; never update/delete an existing policy or reservation.

The future live Selarti dispatcher must call `PostgresSelartiBudgetRepository.recordOutcome`; the capability emits metrics only after its transaction commits. No dispatcher/provider binding is activated in B3.
