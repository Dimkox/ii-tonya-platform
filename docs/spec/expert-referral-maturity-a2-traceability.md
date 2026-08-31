# Expert referral maturity A2 traceability

| Requirement                                                                              | Evidence                                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| New eligible V2 first settlement creates no immediate credit; legacy creates no maturity | settlement repository branch and PostgreSQL matrix                                                                |
| Exact 30-day clock and immutable terminal facts                                          | additive migration `0033_expert_referral_maturity_a2.sql`                                                         |
| Lease-fenced bounded due processing                                                      | claim returns `(id, lease_token)`; processing re-locks the sequential financial prefix and validates a live lease |
| Due-time eligibility and convergence                                                     | matrix covers expert/referral/abuse recheck, stale leases and existing linked grant convergence                   |
| Fixed-cardinality telemetry                                                              | worker runtime and observability tests cover examined/granted/cancelled/retry/failed                              |
| Historical facts preserved                                                               | migration 0033 adds schema only; no historical backfill                                                           |

Client coupons and group-event commissions remain deferred until Release D provider
contracts exist. Live providers and external Trust CI remain release gates.
