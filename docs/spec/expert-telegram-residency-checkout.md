# ER-TG-003 Expert Telegram Residency Checkout Traceability

Status: provider-neutral implementation is present locally, but the release gate is not
green. The single permitted direct Claw attempt at `32cbb79eb2528b330fed577cb724db38adfec9dd`
passed 166 of 168 tests across 15 files. Both failures exposed PostgreSQL error `2201B`
from the migration 0026 URL regular-expression bound. Subsequent independent review found
missing journal registration, retry-terminal handling, late-URL persistence, SQL `NULL` and
scheme-case gaps, and non-idempotent callback reissuance. These findings are remediated in
the branch with migration 0026 registered, deterministic domain-separated issuance,
conflict-safe same-binding persistence, retryable `busy`/`processing`, late-ready downgrade,
and a non-null case-insensitive HTTPS constraint. The new focused local set passes 57 of 57
tests across six files, and independent re-review at
`e81eeff158aee3ed7ae580ad146607ab864f5c7c` reported no Critical or Important findings.
At that same reviewed SHA, one post-fix focused Claw run of
`tests/integration/expert-telegram-residency-callback.test.ts` passed 7 of 7 tests in one file
(3.25 seconds total; 660 milliseconds in tests). It covers the prior failures plus
concurrency, deactivation, late-ready downgrade, non-null URL, and uppercase HTTPS cases.
This focused remediation evidence closes the two observed PostgreSQL failures; it is not a
repeat or substitute for the broad 168-test gate. A future authorized exact-SHA broad gate
remains mandatory. The capability remains default-off through
`EXPERT_TELEGRAM_CHECKOUT_ENABLED=false`. No live Telegram or payment provider is activated.

| Requirement  | Implementation                                                                                                                      | Verification                                                                                | Mandatory gate                                                                           | Recovery or rollback                                                            | Owner                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------- |
| ER-TG-003-R1 | config loader, API gating, server-derived ingress factory                                                                           | config, app, server, and ingress-factory focused tests                                      | independent review complete; future exact-SHA broad Claw gate pending                    | keep checkout flag false; remove injected checkout capability                   | Operations                |
| ER-TG-003-R2 | command processor, deterministic domain-separated `xr1` issuer, conflict-safe same-binding persistence, Telegram quote adapter      | processor, retry-idempotency token/SQL, and adapter focused tests                           | independent review complete; future exact-SHA broad Claw gate pending                    | disable checkout flag; existing quotes remain read-only                         | Application owner         |
| ER-TG-003-R3 | fresh principal resolution, MAC inspection, active ownership joins in callback repository                                           | capability, webhook, and real-PostgreSQL callback tests                                     | reviewed exact-SHA focused Claw PostgreSQL remediation passed 7/7                        | deny callback generically; never reveal retained outcome                        | Security                  |
| ER-TG-003-R4 | `ExpertResidencyService.checkout` capability adapter with stored tariff UUID and token-hash idempotency                             | capability exact-argument and replay tests                                                  | independent service-boundary review complete                                             | retain terminal unknown; reconcile through the same application idempotency     | Finance application owner |
| ER-TG-003-R5 | registered migration 0026 state machine, lease/fence repository, terminal replay                                                    | journal/schema parity, unit recovery, and PostgreSQL concurrency tests                      | reviewed exact-SHA focused Claw PostgreSQL remediation passed 7/7                        | wait for lease expiry; reclaim once with the same token hash                    | Database owner            |
| ER-TG-003-R6 | webhook inbox, mutation, link delivery, and callback acknowledgement use separate keys and states; busy/processing remain retryable | webhook applied, busy/processing replay, and ambiguous-delivery regressions                 | future exact-SHA broad Claw gate pending                                                 | release failed delivery claim; replay stored outcome with the same delivery key | Operations                |
| ER-TG-003-R7 | bounded non-null case-insensitive HTTPS constraint, late-ready downgrade, logging-disabled adapter, expiry cleanup worker           | adapter, repository SQL guards, cleanup, worker, migration constraint, and PostgreSQL cases | reviewed exact-SHA focused Claw late/NULL/uppercase/cleanup cases passed 7/7             | run bounded cleanup; keep feature disabled if URL retention cannot be verified  | Security and Operations   |
| ER-TG-003-R8 | isolated `xr1` branch and payment-provider-free Telegram modules                                                                    | scope guards, webhook namespace regression, and static builds                               | independent provider-isolation review complete; future exact-SHA broad Claw gate pending | revert ER-TG-003 commits; migrations remain additive and forward-compatible     | Security                  |

Release evidence is valid only for one exact commit. The broad 166/168 result at `32cbb79`
remains failure diagnostic evidence. The focused 7/7 result at reviewed `e81eeff` verifies
the remediated PostgreSQL file only and must not be represented as 168/168. Local GREEN
commands are development evidence, not staging or production approval. GitHub Actions are
not used. Production and live-provider activation require separate explicit authorization.
