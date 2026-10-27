# Residency offer correction verification

Local development only on `codex/phase1-owner-plan-20261023`. No push,
deployment, provider activation, paid call or production mutation occurred. The
frozen contract is [the correction specification](../superpowers/implementation-artifacts/spec-residency-offer-corrections.md).
PostgreSQL evidence uses disposable databases on the existing task-owned
PostgreSQL17.5 loopback cluster. Credentials and URLs are not recorded.

## Implemented boundaries

V1 arithmetic, historical source assets and paid snapshots remain immutable. V2
uses versioned owner qualifications, approved category rates, independent monthly
and package rounding, and the earliest authoritative first-offer anchor. It keeps
the96/168/240-hour boundaries,30/90-day periods and separately bounded day10 TTL.
Space rates require explicit trusted approval.

The fixed onboarding fee is300000 kopecks. Durable database bindings route
`ONBOARDING_FEE` and `MAIN_SUBSCRIPTION`; webhook metadata cannot choose the path.
Main invoices require current approved card, paid fee, confirmed application
promotion, original consent and genuine owner terms. Scheduled authorizations
retain their original real selection and cannot fabricate Telegram requests or
explicit acceptances. Current profile and latest-selection checks also protect
recovery and settlement. Local expiry never claims pending YooKassa cancellation.

Generic materials and promotion proof run before card approval. Missing templates
remain honestly waiting with the required copy and no delivery receipt. Generic
transport requires an explicit application scope; its digest and request identity
bind purpose, application and payload. Uncertain sends remain quarantined.

Owned promo menu reads and15-minute refresh work before an application, fee or
work handoff. Reminders use verified promo identity and original consent, include
real prices/expiry, and never expose an early main link. Read-time refresh avoids
showing new stages with old prices. Erasure clears delivery receipts/links and
cancels pending work without rewriting delivered facts or financial admissions.

An immutable activation admission distinguishes paid financial truth from access.
Denied stale-fact payments cannot later acquire access through projection repair;
previously admitted paid periods survive qualification changes. Legitimate future
prepaid intervals retain admission without immediate publication. V1 compatibility
uses exact accepted main-order and timely canonical settlement provenance, not
arbitrary settled balances. It preserves historical restoration semantics rather
than claiming to prove every old dynamic admission decision; current card,
original consent, identity and safety gates still apply. V2 is never backfilled.

## Executed checks

Actual logs, including failed attempts, are retained in ignored
`.superpowers/sdd/residency-offer-corrections-20261023/` and their original
`/tmp/residency-*` paths.

| Area                            | Executed result                                                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calculator                      | 64/64; exact boundaries, separate rounding/floors, space and Date-limit cases                                                                                                                             |
| Prompt and AI ingress           | 31 prompt and12 ingress cases; typed owned context, ownership snapshots, ordinary-server injection and legacy-price suppression; additional server injection1/1                                           |
| Manager Telegram                | 9 service,6 route,3 transport,5 PostgreSQL cases; original staff role/MFA, one-use pairing, signed scoped callbacks and current profile                                                                   |
| Staff profile recovery          | 17 service,11 web client,9 view and11 API cases; no new onboarding decision or fee                                                                                                                        |
| Purpose routing                 | 5 route and2 repository cases; forged/ambiguous metadata cannot select payment authority                                                                                                                  |
| V2 persistence                  | 3 initial PostgreSQL cases plus extended-tariff TTL RED→GREEN1/1                                                                                                                                          |
| Scheduled financial authority   | 4 PostgreSQL cases; genuine schedule, replay, supersession, verified-profile changes and raw-SQL alternate-checkout denial                                                                                |
| Activation admission            | Final3/3 PostgreSQL cases; duplicate events preserve periods, unverified profile changes retain admitted access, stale-fact money gets no access, actual V1 provenance predicate and projection repair    |
| Future and late financial truth | 1 future/refund-gap case verifies durable future admission;2 real-adapter deadline/withdrawal races retain expired money without activation                                                               |
| Automatic offers                | Final10/10 PostgreSQL cases; before-cron freshness, same-slot profile change, fairness, original consent, actual promo reminders, preapplication24h/3h,15-minute scheduling and actual privacy processing |
| Parallel materials              | 8/8 PostgreSQL cases; fee-parallel proof, no fake receipt, two-referral readiness, real delivery/quarantine, fairness and caller-mutation snapshot                                                        |
| Transport                       | 27 real adapter cases plus final application-context1/1; promo/work routing6/6; exact promo config17/17                                                                                                   |
| Archive admission               | 3/3 PostgreSQL cases in real catalogue/search/booking paths                                                                                                                                               |
| Worker                          | 9 offer-service,2 transport/config and1 actual runtime composition cases                                                                                                                                  |
| Build/types/lint                | Full workspace build passed; relevant integrations declaration rebuild passed; complete package and test typecheck passed; scoped lint and whitespace passed                                              |
| Repository guards               | First full59-file run:541 passed,5 failed. Exact tracked scope subsequently130/130 and independent exact inventory10/10 passed. Final aggregate clean-SHA gate belongs to coordinator.                    |

Two unchanged native fault-drill cases in the first repository run exceeded the
unchanged5000ms deadline while the22-worker run overlapped unrelated host CPU
load. Focused checks use installed Vitest's min/max forks and threads set to1;
they retain all case assertions and deadlines. Both isolated native cases passed1/1. The coordinator's final aggregate
uses the same local resource isolation, never a test bypass.

## Failure diagnosis and independent review

Retained failures exposed and corrected: SQL setup syntax, profile key validation,
a fixture tariff validity cap, an overly broad24-hour CHECK, stale-profile and
selection recovery, a raw-SQL V2 checkout bypass, queue starvation and async caller
mutation. A real-adapter run found that generic revision0 needed an explicit
application protocol; body-only hashing was then replaced by scoped hashing.
One legacy predicate test had duplicate standalone SELECT column names; mapping
through the actual INSERT target aliases fixed the test without changing SQL.
The privacy test now preserves a true delivered fact while clearing its receipt.

Independent read-only financial and materials/archive reviewers rechecked their
remediations and inspected passing logs. Live V2 admission and material transport
scopes pass. The historical V1 policy assumption is explicitly recorded above and
in the coordinator record. Reviewers made no implementation edits.

Exact14-relation/3-route/3-artifact registration, content pins and negative probes
are documented in [the guard registration](../spec/residency-offer-corrections-guard-registration.md).
Final snapshot56 and the exact SQL supplement were replayed/introspected on
PostgreSQL170005; see [persistence provenance](residency-offer-persistence-2026-10-23.md).

## Final boundary

Local implementation3466408a passed all seven clean-commit gate checks with diagnostic log retention; repository tests553/553. Earlier canonical gate failures and diagnostic limitations are retained in the coordinator record.
External strict first-send checkout custody remains an explicitly injected,
default-off capability; missing reviewed capability never yields a payment link.
Live merchant, provider, public webhook and production release acceptance remain
separate gates. No hosted CI or production readiness is claimed here.
