# ER-TG-003 Expert Telegram Residency Checkout Traceability

Status: provider-neutral implementation complete locally; final direct Claw gate and
independent review pending. The capability remains default-off through
`EXPERT_TELEGRAM_CHECKOUT_ENABLED=false`. No live Telegram or payment provider is activated.

| Requirement | Implementation | Verification | Mandatory gate | Recovery or rollback | Owner |
| --- | --- | --- | --- | --- | --- |
| ER-TG-003-R1 | config loader, API gating, server-derived ingress factory | config, app, server, and ingress-factory focused tests | final direct Claw focused gate and independent review pending | keep checkout flag false; remove injected checkout capability | Operations |
| ER-TG-003-R2 | command processor, `xr1` issuer, Telegram quote adapter | processor, token, and adapter focused tests | final direct Claw focused gate pending | disable checkout flag; existing quotes remain read-only | Application owner |
| ER-TG-003-R3 | fresh principal resolution, MAC inspection, active ownership joins in callback repository | capability, webhook, and real-PostgreSQL callback tests | real-PostgreSQL callback suite pending on Claw | deny callback generically; never reveal retained outcome | Security |
| ER-TG-003-R4 | `ExpertResidencyService.checkout` capability adapter with stored tariff UUID and token-hash idempotency | capability exact-argument and replay tests | independent service-boundary review pending | retain terminal unknown; reconcile through the same application idempotency | Finance application owner |
| ER-TG-003-R5 | migration 0026 state machine, lease/fence repository, terminal replay | schema parity, unit recovery, and PostgreSQL concurrency tests | real-PostgreSQL callback suite pending on Claw | wait for lease expiry; reclaim once with the same token hash | Database owner |
| ER-TG-003-R6 | webhook inbox, mutation, link delivery, and callback acknowledgement use separate keys and states | webhook applied/ambiguous-delivery regressions | final direct Claw focused gate pending | release failed delivery claim; replay stored outcome with the same delivery key | Operations |
| ER-TG-003-R7 | bounded HTTPS validation, logging-disabled adapter, expiry cleanup worker | adapter, repository cleanup, worker, and migration constraint tests | real-PostgreSQL cleanup assertion pending on Claw | run bounded cleanup; keep feature disabled if URL retention cannot be verified | Security and Operations |
| ER-TG-003-R8 | isolated `xr1` branch and payment-provider-free Telegram modules | scope guards, webhook namespace regression, and static builds | independent provider-isolation review pending | revert ER-TG-003 commits; migrations remain additive and forward-compatible | Security |

Release evidence is valid only for one exact commit. Local GREEN commands are development
evidence, not staging or production approval. GitHub Actions are not used. Production and
live-provider activation require separate explicit authorization.
