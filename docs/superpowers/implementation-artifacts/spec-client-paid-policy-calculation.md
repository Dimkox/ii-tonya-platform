---
title: Client paid policy calculation
type: feature
created: 2026-10-10
status: done
baseline_commit: bbad346a93ebd9d498550e9850d2d459d782a4b8
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="Owner approved payment anchor, delegated coupon cap, and requested implementation; standing technical workflow approval applies">

## Intent

Implement the deterministic calculation core required by the new client paid
policy. The current generic payment port returns Promise never and expert
residency checkout owns a different ledger. Reusing expert credits would violate
the product boundary. This slice supplies real, tested arithmetic for subsequent
client-order persistence, not a simulated live checkout or a release claim.

## Boundaries & Constraints

Use a new domain module without changing existing chargeDelta, choosePackage,
client cohort assignment or expert residency calculations. No new provider calls,
credentials, dependencies, schema migration, HTTP capability or activation flag.
Use integer bigint minor monetary units, bounded by PostgreSQL signed bigint.
Only the following versioned terms are supported: policy client_paid_v1;
start 500 messages / 499900 minor; base 1000 / 599900; deep 1500 / 799900;
maximum 2000 / 1099000. All amounts are RUB. Intro is not a sellable SKU.
Package purchase grants coupon value equal to twice its listed paid price.
This grant is distinct from a service coupon discount; no expert referral credits
enter either calculation. The new service quote caps coupon value at20%, rounded
down in minor units; cash plus coupons must equal price exactly.

Package term is60 calendar days from provider-confirmed successful payment,
using fixed GMT+3 without DST; preserve the local clock time and millisecond
precision, not midnight or webhook-receipt time. Under this fixed offset this is
exactly60 times86400000ms. Coupon expiry is45 days from the same payment instant,
per the already accepted DEC-FIN-005. These functions calculate terms only:
callers must verify provider state and atomically persist idempotent grants.
They do not establish payment truth or consent. Never apply this module to
historical grants, legacy/free cohorts or administrative package grants.

## I/O & Edge-Case Matrix

| Input/state                                                         | Expected behavior                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Each of four SKU codes                                              | Return matching immutable version/currency/units/price/x2 coupon value          |
| Unknown SKU, intro, prototype key, non-string at runtime            | Reject with bounded fixed error                                                 |
| Successful payment at a finite date                                 | Compute independent package and coupon expiry dates, leave input untouched      |
| Delayed processing                                                  | Same original paidAt gives same dates; no current clock or first-use dependency |
| Leap day, year boundary, non-midnight GMT+3 time                    | Exact60/45-day interval preserving clock time                                   |
| Invalid or overflowing date, wrong runtime type                     | Reject, never output Invalid Date                                               |
| Price499900, coupon balance999800                                   | Coupon99980, cash399920                                                         |
| Price101, sufficient balance                                        | Coupon20, cash81                                                                |
| Zero coupon balance                                                 | Full cash price                                                                 |
| Insufficient coupon balance                                         | Consume no more than available balance                                          |
| Zero/negative/overflow price, negative/overflow balance, non-bigint | Reject                                                                          |

</frozen-after-approval>

## Code Map

- `packages/domain/src/expert-referral.ts`: existing bigint maximum and defensive
  money/date validation patterns; do not reuse expert quote or change this file.
- `packages/domain/src/billing.ts`: legacy billing behavior; read-only.
- `packages/domain/src/index.ts`: public exports for the new module only.
- `docs/superpowers/implementation-artifacts/fin-client-package-policy.md`:
  approved SKU terms and2026-10-10 payment-anchor/coupon-cap supplement.
- `_bmad-output/specs/spec-owner-update-2026-09-16/.memlog.md`: owner decisions.

## Tasks & Acceptance

- [x] Add `packages/domain/src/client-paid-policy.test.ts` first; observe RED for
      the missing implementation, then exercise every matrix row against real code.
- [x] Implement `packages/domain/src/client-paid-policy.ts` exporting
      `getClientPaidPackage(code: string)`,
      `clientPaidGrantTerms(code: string, paidAt: Date)` and
      `quoteClientService(priceMinor: bigint, availableCouponMinor: bigint)`.
      Grant terms include the package terms, packageExpiresAt and couponExpiresAt.
      Quotes return couponMinor and cashMinor. Do not return shared mutable Date
      instances or mutable shared product definitions. Do not accept client-supplied
      prices or cap overrides in the package lookup/service cap policy.
- [x] Export these functions and useful associated types from the domain index.
- [x] Verify focused tests, domain build/typecheck, tests typecheck, scoped lint,
      formatting and whitespace. Report exact commands/results and remaining work.

Given a delayed/repeated payment event with the same SKU/paidAt, calculation
must return identical terms and must not move expiry forward. This does not
prove database idempotency; that remains an explicit next implementation slice.
Given valid bounded monetary inputs, the quote preserves total price and never
exceeds the20% cap or available coupon balance. Given any existing billing
consumer, its implementation and cohort assignment remain unchanged.

## Execution and Verification

One implementer owns only the new domain module/test and index exports; do not
edit this spec, migration history, docs or other billing consumers. Do not run
network calls, provider actions, broad/full suites, exhausted browser tests,
push, deployment or additional agents. Run the new focused test RED/GREEN,
prefer at most3 invocations. Use repository Node24/pnpm11.9.0 and existing deps.
Rebuild domain dist before checks that import the packaged domain entrypoint.
Record any pre-existing failures without weakening checks. Coordinator will
independently review and integrate this local slice. No live activation or
commercial completion may be claimed from pure calculation tests.

## Spec Change Log

2026-10-10: Initial calculation-only contract derived from owner decisions recorded
in baseline bbad346a93ebd9d498550e9850d2d459d782a4b8. No behavior amendments.

## Verification Evidence

Implementer observed missing-module RED, then 53/53 GREEN with
`pnpm exec vitest run packages/domain/src/client-paid-policy.test.ts`.
Coordinator final invocation also passed 53/53. Focused budget: 3/3 consumed.
Implementer reported successful domain build/typecheck, tests typecheck,
scoped ESLint and Prettier checks. Coordinator confirmed `git diff --check`.
Outputs are in the agent tool transcripts; no separate log files were retained.

Coordinator imported all three functions from the built domain public entrypoint:
explicit coupon values 999800/1199800/1599800/2198000 minor, payment expiry and
101-minor quote assertions passed. No remote calls or writes were involved.

Independent blind, edge-case and verification-gap reviews completed. No blocking
calculation defect was accepted. Mutable independent Date objects are intentional;
no shared definitions or input dates are mutated. Database date bounds, persisted
purchase versions, provider amount/currency/order matching, eligible coupon
balances and expiry consumption are integration obligations, not implemented here.
This module accepts validated calculation inputs; it does not authorize payment,
coupon spending, pricing changes or grants. Documentation-state findings are
resolved here; public-entrypoint and explicit grant examples were checked above.

## Activation Follow-up

TASK-FIN-021 is not complete. Before enabling client payments, implement separate
client orders/provider operations, immutable purchase terms, verified settlement,
transactional one-time package/coupon grants, receipt contact handling and the
authenticated checkout route. Verify duplicate/delayed events, amount/currency
mismatch, cancellation/refund recovery and rollback. Never reuse expert ledgers.
No production setting was changed by this calculation slice.

## Suggested Review Order

- Read the versioned package definitions and immutable lookup result.
  [client-paid-policy.ts:27](../../../packages/domain/src/client-paid-policy.ts#L27)
- Check payment-anchored expiry and overflow rejection.
  [client-paid-policy.ts:65](../../../packages/domain/src/client-paid-policy.ts#L65)
- Check integer monetary bounds and fixed coupon ceiling.
  [client-paid-policy.ts:87](../../../packages/domain/src/client-paid-policy.ts#L87)
- Review invalid inputs, golden values and independent expiry objects.
  [client-paid-policy.test.ts:11](../../../packages/domain/src/client-paid-policy.test.ts#L11)
- Confirm the public domain exports.
  [index.ts:4](../../../packages/domain/src/index.ts#L4)
