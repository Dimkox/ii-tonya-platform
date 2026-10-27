# Authenticated saved-quote expert API — author evidence

Status: implemented; author GREEN2 passed; independent review and coordinator run3 pending.

Spec: `docs/superpowers/implementation-artifacts/spec-expert-campaign-api.md`.
Baseline: `690797db64fd80aa1aeccea8003543de470d8c16` on `codex/planerka-api`.
The pre-existing dirty checkout was preserved. No commit, push, deployment,
provider call, migration, financial repository edit or old-test execution occurred.

## Implementation

- New `createExpertCampaignService` uses strict committed request schemas,
  active-owner lookup, immutable quote creation and quote-bound order creation.
  Campaign services have literal `kind: campaign`; existing injected legacy
  consumers remain compatible, including their optional reconciliation field.
- Quotes expose saved identity, anchor, expiry, term and price breakdown unchanged.
  Tariff results replace ambiguous `priceMinor` with `baseMonthlyMinor` and
  `priceKind: base`. Checkout never calculates price or credit.
- No provider returns `payment_unavailable` before order/reservation creation.
  A trusted provider receives saved order ID, cash amount, currency and original
  command key. Only `payment_pending` invokes it; terminal status is preserved.
  Provider exceptions produce a content-free unavailable result.
- Ordinary lifecycle now constructs the real expert API using the existing
  session resolver, campaign quote/order repositories, residency reads and actual
  referral service/repository. A new read-only adapter checks active/verified
  ownership and resolves referral channel identity. Missing session capability
  rejects startup. Default composition supplies no payment provider.
- HTTP routes use strict campaign schemas, no-store, duplicate-authorization
  rejection, an 8192-byte body limit and bounded global/per-IP rate limits.
  Campaign errors map to bounded public 400/403/409/503 results.

## Execution ledger — do not reset allocations

Each file has used **2/3** runs. Run3 belongs to the coordinator after review.

| File                                                       | Run | UTC start | Result                                                                  |
| ---------------------------------------------------------- | --- | --------- | ----------------------------------------------------------------------- |
| `packages/application/src/expert-campaign-service.test.ts` | 1   | 21:31:43  | Collection failure: missing closing brace; 0 tests                      |
| `tests/integration/expert-campaign-api.test.ts`            | 1   | 21:32:36  | Collection failure: root test cannot import `@ii-tonya/config`; 0 tests |
| `packages/application/src/expert-campaign-service.test.ts` | 2   | 21:35:21  | 26/26 PASS, exit0, 0.758s                                               |
| `tests/integration/expert-campaign-api.test.ts`            | 2   | 21:35:22  | 8/8 PASS, exit0, 7.94s                                                  |

Tests were written before implementation, but neither first run reached behavioral
assertions. **There is no behavioral RED evidence.** The collection errors were
fixed without additional runs. No hidden retry or alternate-file cap reset.

Commands: `pnpm exec vitest run <exact file above>`, individually. Integration
used `II_TONYA_TEST_POSTGRES_ADMIN_URL` derived in memory from the retained
`ii-tonya-notification-t2-20261012-postgres-1` container; credentials were not printed
or persisted. The helper created/dropped only its randomly named synthetic test
database. The test asserted actual `server_version_num = 170005`.

Application tests cover owner/unauthenticated denial, strict forged-field
rejection, unchanged quote replay, unavailable capability before order creation,
599400 offer vs 419580 provider cash, command-key retention, six non-pending
statuses, provider exception/retry and bounded storage/domain errors.

PG HTTP tests use ordinary lifecycle dependencies and signed synthetic Telegram
proof. They verify persisted quotes/anchor, identical replay, idempotency conflict,
no order/ledger effects from unavailable checkout, forged/legacy bodies, actual
duplicate headers over local HTTP, absent/client bearer, revoked/inactive/
unverified/remapped ownership, body limits, rate limits and missing-session startup.

## Static verification

- RequireDocker environment preflight passed: Node24.21.0, pnpm11.9.0,
  Docker29.9.0, Compose5.6.0.
- API, application and database builds passed, including declaration generation.
- API, application and database typechecks passed. Test TypeScript check passed.
- Scoped ESLint and Prettier passed; `git diff --check` passed.
- Initial static checks exposed the API's lack of a direct contracts dependency
  and legacy reconciliation excess-property compatibility. Fixed by re-exporting
  the committed schemas through the existing application dependency and making
  legacy reconciliation optional in the API-facing type; no dependency added.

## Review and remaining gates

Author source review checked trusted input construction, provider ordering,
terminal status handling, ordinary resolver composition and safe error mapping.
This is self-review, **not independent acceptance**. The spec forbids nested agents;
no independent reviewer was launched. Coordinator independent review/run3 remain.

Coordinator reports Kant independent source review started. Before coordinator
run3, two additional cases were added to the SAME PG file, with no test execution:

- Ordinary signed-session tariff GET asserts `priceKind: base`,
  `baseMonthlyMinor: 999000`, absence of ambiguous `priceMinor`/`cashMinor`,
  no-store and zero financial writes; a subsequent quote asserts the distinct
  saved offer `priceMinor: 599400`.
- Ordinary lifecycle with referral enabled and a synthetic key resolver redeems
  a real repository-issued HMAC code over signed-session HTTP. Assertions check
  unauthenticated zero-binding denial, persisted code/referral/owner IDs, redeemed
  code status, actual summary route response, no-store and zero orders/ledger.

PG source now has10 cases; last executed result remains8/8. Both file budgets
remain2/3. These new assertions are UNRUN and do not establish behavioral RED or
GREEN evidence. No product-code defect was identified during test design, and no
product code changed in this addition. Legacy runtime tests were not rerun.
The complete product still requires browser controls, quote-bound Telegram,
verified receipt contacts and actual YooKassa composition/reconciliation.
Existing financial87 and corrected auth PG/browser cases remain unverified by
this increment. No release-readiness or human-acceptance claim.

## Kant P2 tariff eligibility correction — source only

Confirmed: the legacy residency tariff reader applies LIMIT20 without campaign
eligibility, so legacy90-day prices could be labelled monthly and twenty earlier
legacy rows could hide V2 offers. Corrected only the owned new read adapter and
its composition call. The financial residency repository remains unchanged.

The new reader checks the durable feature control inside a repeatable-read
transaction, rechecks active/verified expert and active user, then filters active
`expert_residency_v2`, RUB and2592000-second tariffs BEFORE ordering/LIMIT20.
Application ownership and environment guards remain in place.

Same-file unrun additions: two service cases cover base-label projection and
durable disabled result, with the wrong-owner case strengthened to require no
tariff-port invocation. Two PG cases prove twenty earlier active legacy90-day
rows occupy the old query's first20 while the campaign endpoint returns only V2,
and prove feature-disabled/unverified-owner denial. This also excludes legacy
90-day prices from the monthly offer list.

Current source: service28 and PG12 cases. **No tests executed for this correction**;
last executions remain26/26 and8/8 before the added cases/correction. Both budgets
remain2/3; main retains final3 after review. No behavioral RED claim.

## Coordinator final3 — 21:43 UTC

Kant source re-review accepted the campaign tariff P2 correction: eligibility
filter precedes LIMIT20 and ordinary composition uses that reader. No remaining
concrete scoped issue found. Review performed no tests or edits.

- Service session51593 exit0,21:43:53,duration600ms:28/28 PASS.
- PG/HTTP session39896 exit1,21:43:55,duration9.55s:11/12 PASS.
  The base-label case expected displayName PRO, while actual canonical V2 name is
  Про. Main confirmed testkit/expert-referral.ts:450 merges the committed V2 tuple
  over caller fixture input; contracts/expert-residency-tariffs.ts:17 specifies Про.
  Main corrected fixture input and literal expectation to Про. This does not
  change product code or monetary assertions. The corrected case is UNRUN.

Both new files now3/3 EXHAUSTED. No further run without owner permission. Passing
PG cases include legacy-before-limit filtering, durable control, HMAC referral,
ordinary quote replay, unavailable checkout zero writes, malformed authority and
rate/body limits. Assertions after the failed displayName comparison in that one
case were not reached; do not claim12/12 or full API acceptance.

Correction static verification passed: DB build/declarations, API and DB
typechecks, full test TypeScript check, scoped ESLint/Prettier and diff whitespace.
The first test-typecheck overlapped the DB build's dist cleanup and reported a
missing DB declaration in the old session test; rerunning the static check after
the build completed passed. Neither invocation executed tests.
