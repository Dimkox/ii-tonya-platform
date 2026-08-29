# Expert referral maturity A2 traceability

| Requirement | Evidence |
|---|---|
| New eligible first settlement creates no immediate credit | settlement repository maturity insert and `rewardGranted=false` |
| Exact 30-day clock and immutable terminal facts | additive migration `0033_expert_referral_maturity_a2.sql` |
| Bounded idempotent due processing | worker repository ordered `FOR UPDATE SKIP LOCKED` and serializable recheck |
| Historical facts preserved | migration 0033 adds schema only; no historical backfill |

Client coupons and group-event commissions remain deferred until Release D provider
contracts exist. Live providers and external Trust CI remain release gates.
