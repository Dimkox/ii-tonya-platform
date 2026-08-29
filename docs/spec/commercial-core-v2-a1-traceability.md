# Commercial Core V2 A1 traceability

| Requirement                                                               | Evidence                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audited V2 admission and immutable concurrent assignment                  | `tests/integration/commercial-core-v2-a1.test.ts`; migration `0032_commercial_core_v2_a1.sql`; `client_commercial_policy.control_v2`; defaults false                                        |
| Audited START tariff and immutable commercial snapshots                   | same test; `expert_residency.tariff_create_v2`; V2 tariff/order constraints in migration                                                                                                    |
| Pre-0032 upgrade/backfill compatibility and fresh-user admission boundary | `tests/integration/expert-referral-migration-upgrade.test.ts` — `commercial core 0032 upgrade compatibility` / `backfills the legacy client cohort without changing legacy financial facts` |
| Active A1 checkout does not call a disabled provider capability           | `tests/integration/commercial-core-v2-a1.test.ts` — active `payment_pending` checkout with `providerSpy` untouched                                                                          |
| Zero-package inbound is free and provider-neutral                         | same test; `PostgresMessageRepository.completeInbound({ billingPolicy: "free" })`; provider-operation count remains zero                                                                    |
| Credit is capped at exactly 30%                                           | same test asserts `117000/390000` and `credit_cap_bps=3000`                                                                                                                                 |

All controls and live-provider flags default to `false`. Migrations create schema only: no production tariff is seeded, no provider is activated, and no live gate is claimed. Expert-referral 30-day maturity is A2; it is not implemented or activated by A1.

Known external gates remain blocked: Trust CI, Database Gate, and branch push are controller-owned and unavailable in this task.
