# Expert settlement authority — 2026-10-12

## Coordinator final verification —19:38–19:39UTC

This section supersedes earlier pending-run counts below. Source review by Kant
closed the two late-payment P1 findings, accepted exact outer GET forwarding,
and requested two P2 refinements: exact per-grant assertions and correction of
the runbook's unavailable fields. Both refinements were applied before the final
settlement run. No provider calls, production writes, commit or deployment.

Fresh development preflight with RequireDocker passed (session76724). Retained
container image postgres:17.5-bookworm, IP192.168.112.2 and actual server170005
were verified. Tests used isolated synthetic databases.

| Focused file                                                | Final invocation                 | Result                                                        |
| ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| apps/api/src/routes/expert-payment-operator-queries.test.ts | run3,19:38:21,3.81s,session87436 | 22/22 passed,exit0; includes five actual outer-buildApp cases |
| tests/integration/expert-payment-operator-queries.test.ts   | PG3,19:38:22,5.90s,session45756  | 10/10 passed,exit0                                            |
| tests/integration/expert-settlement-authority.test.ts       | PG3,19:39:25,9.03s,session21772  | 8 passed,1 failed,exit1                                       |

All three files have consumed3/3 invocations. Commands were separate focused
Vitest calls, not a full or multipath suite. No additional run is authorized yet.

The failed settlement assertion at line486 expects JavaScript Date objects for
raw SQL occurred_at/verified_at/processed_at. PostgreSQL returned timestamp
strings instead. Expected occurred_at2026-08-03T00:00:00.000Z versus actual
2026-08-03 00:00:00+00; verified_at similarly matched the time but not its JS
representation. processed_at was2026-10-12 19:39:33.568+00, not a Date instance.
Later assertions in that case were not reached. Do not claim the whole file
passed or infer its remaining replay/worker assertions from the eight others.

The eight passing cases include distinct-order consecutive intervals for legacy
and V2, different-expert progress, both referral policies, both multi-grant expiry
orderings with exact original grant IDs and inverse amounts, and rollback/retry.
The implementer confirmed raw execute returns TIMESTAMPTZ as strings. The test
now compares occurred_at and verified_at exactly in SQL; processed_at must be
finite and lie between the payment deadline and the database clock. No financial
code changed. Static types/lint/diff passed; the correction has NOT been rerun.
One additional focused run was requested from the owner; no answer yet.
Kant independently accepted the exact SQL timestamp assertions, original
reservation/grant inverse mapping and corrected runbook after this change.
That source acceptance does not replace the pending execution.
The new operator API/DB results do not prove published usability, actual provider
refund or full commercial-product readiness.

Status: both original defects reproduced; isolation/clock and atomic expiry/release
candidates implemented, not GREEN-verified. Paid-after-expiry operator visibility
remains BLOCKED pending the reviewed route described below. Not release evidence.
Owned files are the settlement repository, the additionally authorized
expert-residency-repository.ts, the new focused
`tests/integration/expert-settlement-authority.test.ts`, and this evidence file.
Baseline: `690797db64fd80aa1aeccea8003543de470d8c16`, branch `codex/planerka-api`.
All unrelated shared changes, including Harvey's migration0047, remain untouched.

## Environment and target

`pwsh -File scripts/check-development-environment.ps1 -RequireDocker` passed:
Node24.21.0, pnpm11.9.0, Docker29.9.0, Compose5.6.0; no failures/warnings.
Read-only target verification returned database/user `ii_tonya`, server address
`192.168.112.2`, server_version_num `170005`, isolation `read committed`.
Docker inspect matched the retained
`ii-tonya-notification-t2-20261012-postgres-1`, image `postgres:17.5-bookworm`.
The testkit created a separate randomly named synthetic database. No provider,
production, migration-generation, deployment, commit or nested-agent operation.

## Lock analysis / minimal candidate

- Settlement currently locks its inbox and individual order, reads expert without
  a row lock, reads the maximum settled end, updates that order, then acquires
  reservation/referral/control locks. Legacy reward handling locks the two expert
  rows sorted by ID after control. The retry wrapper only retries40001.
- Checkout explicitly uses SERIALIZABLE, then control FOR UPDATE, expert advisory,
  order/eligibility/grants. Reusing its advisory early in settlement, followed by
  the existing late control lock, would introduce control/advisory inversion.
- Reversal locks inbox/order/payment, then first marker/maturity and sorted expert
  rows before grant/ledger work. It does not acquire the checkout advisory.
  Referral issuance uses control before its separate issuance advisory/expert.
- Applied after genuine RED2: explicit SERIALIZABLE at settlement transaction start,
  using existing bounded40001 retry, plus a fresh database clock after order-lock
  waits. This introduces no early expert/advisory lock and preserves current row
  lock ordering. It still requires behavioral validation before acceptance.

## Focused invocation accounting

Two focused invocations have been used. Coordinator approved corrected RED2,
then implementation/static, reserving GREEN3 for coordinator after independent
review. GREEN3 has NOT run. No full suite, multipath command, old/exhausted file
or repeat command.

Command (synthetic URL supplied through the authorized environment variable):

```sh
II_TONYA_TEST_POSTGRES_ADMIN_URL='<authorized synthetic PG17.5 URL>' pnpm exec vitest run tests/integration/expert-settlement-authority.test.ts
```

Run1 started19:07:22UTC, duration95.02s, exit1: **3 passed /4 failed (7 tests)**,
plus afterAll timeout and one unhandled connection error during cleanup.

- Genuine behavioral RED: legacy two-order interval test expected the delayed
  order to start `2026-10-14T19:07:26.515Z`, but it started
  `2026-10-13T19:07:26.515Z`. Both settlements had read the same previous end.
- Two V2 cases failed fixture setup: duration86400 violated the existing
  `expert_tariff_v2_combination` constraint. This is NOT behavioral RED.
- Deadline case timed out: blocker FOR UPDATE prevented the inbox INSERT's FK
  KEY SHARE before the test's order-query boundary was reached. No deadline
  behavioral RED was obtained.
- Different-expert progress, legacy referral treatment/replay, and forced
  post-write rollback/retry assertions passed. The overall run is NOT accepted
  because of the fixture/cleanup errors.

Recovery terminated only the idle blocker backend in this invocation's exact
synthetic database. This caused the reported connection error. After the runner
exited and a read-only check confirmed zero clients, its leftover database
`ii_tonya_test_69e3236dfd854a909499fb1093ec591b` was dropped. Its synthetic facts
are reproducible from this test; the retained PG container/admin database and
other agents' databases were not removed.

## Test-only corrections after run1

- Use the required2592000-second V2 duration,86400 for legacy.
- Block with FOR NO KEY UPDATE, allowing the inbox FK check while still blocking
  the actual settlement FOR UPDATE query.
- Bound gate arrival to3seconds, below test timeout; always release gate and
  release the blocker connection even if rollback errors.
- All gate SQL is forwarded unchanged to real PostgreSQL. No disabled constraints
  or fabricated financial results; fixtures use real referral issue/redemption,
  checkout, verified synthetic payment events, and settlement.

Pre-run shared tests typecheck and new-file lint passed. After these corrections,
new-file Prettier/ESLint, evidence Prettier, `git diff --check`, and final shared
tests typecheck (`pnpm exec tsc --noEmit -p tsconfig.tests.json`) passed.
These static results preceded corrected RED2.

## Corrected RED2 and candidate diff

Same command/file/environment, started19:11:29UTC, duration8.44s (tests5.63s),
exit1: **3 failed /4 passed (7 tests)**. No fixture failures, hook timeouts or
unhandled errors. All three failures occurred before production modification:

- Legacy delayed settlement start: expected2026-10-14T19:11:33.478Z,
  actual2026-10-13T19:11:33.478Z (one paid day overlapped).
- V2 delayed settlement start: expected2026-12-11T19:11:33.822Z,
  actual2026-11-11T19:11:33.822Z (30 paid days overlapped).
- Deadline: actual settlement resolved successfully after blocker release beyond
  the DB deadline, so expected EXPERT_RESIDENCY_PAYMENT_EXPIRED was absent.
- Different-expert progress, v1/v2 referral treatment with replay, and forced
  post-write rollback with clean retry passed.

The initial isolation/clock production diff was7 additions /1 deletion, all in settle():

```diff
+ // Different orders lock different rows. Protect the max-residency read
+ // from write skew and retry the entire settlement on 40001. Taking the
+ // checkout expert advisory here would invert its control-first order.
+ await tx.execute(sql`set transaction isolation level serializable`);
...
- sql`select transaction_timestamp() as now`,
+ // Transaction-start time can precede an inbox/order lock wait and is
+ // not authority to settle an order whose deadline has since elapsed.
+ sql`select clock_timestamp() as now`,
```

At that initial handoff there was no reward-policy, reverse(), checkout, migration or helper modification. Existing
40001 retry wraps the entire settlement, including its inbox and interval read.
No new advisory/expert/global lock. This is not a claim that current lock ordering
across every historical operation is deadlock-free.

Post-implementation ESLint, Prettier and diff check passed. DB typecheck passed.
Shared tests typecheck failed outside ownership:
`tests/integration/expert-campaign-quotes.test.ts(3,33): TS2307 Cannot find module
'pg' or its corresponding type declarations.` That concurrent file was not
edited. No further PG run by the implementer.

## Initial scope discrepancy and subsequent authorization

The approved story expects rejection/rollback followed by the existing expiry
worker releasing credit once. Original ERR-FR-031 / settlement step4 states
expiry/release is atomic under the settlement order lock. Existing code throws
and rolls back; releaseExpiredOrders is a separate transaction. This fix must not
claim that stronger atomic-expiry requirement is satisfied or silently change
provider-paid-time policy. The new test explicitly distinguishes rejection from
the later worker release; the discrepancy requires coordinator disposition.

No existing transaction-safe expiry/release helper was found. The exported
releaseAmountFromReservation() is only arithmetic; releaseExpiredOrders() opens
its own transaction and selects a batch. Calling it from settlement would not
atomically commit with the locked order, and may wait on settlement's own lock.

Minimal expansion proposed at the initial handoff (subsequently authorized):

1. Add ownership of packages/db/src/repositories/expert-residency-repository.ts
   only. Extract its per-order expiry/release into an exported helper accepting
   the existing transaction, locked order identity and fresh DB timestamp. Keep
   release keys `release:<reservationId>`, source type residency_order, inverse
   per-grant allocations and worker idempotency unchanged. Worker calls the helper
   within its existing transaction; settlement calls it under its order lock.
2. In the already-owned settlement file, return an internal expired outcome from
   the transaction rather than throwing inside it. Atomically persist expiry,
   release and a rejected inbox result; map the committed outcome to the existing
   public EXPERT_RESIDENCY_PAYMENT_EXPIRED exception outside the transaction.
   Preserve exact rejected-event replay identity and prevent repeated releases.
3. Strengthen the owned deadline test to require expired/released BEFORE invoking
   the worker, and worker0/0 afterwards; add rollback of release failure and
   rejected-event replay assertions. Current worker-only expectations are not
   acceptance evidence for this stronger requirement. These changed assertions
   would not have pre-fix behavioral evidence from RED2; report that explicitly
   and agree verification sequencing before consuming the final run.

## Current atomic candidate (no additional PG invocation)

The coordinator authorized the extra repository and implementation without another
implementer test run. TDD evidence above remains unchanged: the new atomic, replay,
multigrant and rollback assertions have NOT individually been observed RED or GREEN.
The current file has9 cases, not the7 executed in RED2.

- expireLockedExpertResidencyOrder(tx, order, deadlineClock) uses the caller's
  transaction and locked order. Worker keeps its transaction_timestamp selection,
  batch count, release:<reservationId> keys, source_type residency_order and inverse
  per-grant allocations. It opens no nested transaction and emits no new outbox.
- Settlement retains SERIALIZABLE/40001 whole-transaction retry. Fresh deadline
  comparison now occurs inside SQL, avoiding JavaScript millisecond truncation.
  Expiry, releases/allocations and rejected inbox commit together; the public
  EXPERT_RESIDENCY_PAYMENT_EXPIRED exception is thrown outside the committed
  transaction/retry wrapper. Any SQL failure still rolls the entire unit back.
- Already-expired orders (including a worker winning before a40001 retry) pass
  exact cash/currency verification before persisting the verified payment as a
  rejected settlement fact. No second release, entitlement, attempt or refund.
- Same-event rejection replay checks the full original verified identity first,
  then returns the same public error without changing the inbox. Altered identity
  remains a conflict. Unrelated invalid order states remain rejected/rolled back.
- V2 maturity remains30days, now anchored to the same fresh settlement timestamp
  as its order/first marker, rather than the older transaction-start timestamp.
- The deadline case requires committed expired/release before any worker call,
  unchanged verified inbox facts on replay/conflict, and zero settled outbox.
  Two additional cases fail after real release allocations have been written,
  assert rollback, then retry via settlement or worker. They use two real100000
  grants and a150000 reservation, verifying100000/50000 inverse allocations.
  Worker-first retry must retain the subsequent verified paid fact.

DB/shared tests typechecks passed after the initial atomic candidate; the previous
foreign quote-test pg-import error was gone. Latest worker-first/multigrant edits
also passed DB/shared tests typechecks, owned-file ESLint, formatting and diff
check. No PG run3 by implementer.

## Kant P1: paid-after-expiry operator route (OPEN)

Confirmed: expert-referral-worker-repository.ts listReconciliationBatch reads only
settled/refunded/charged_back payment_attempts. A rejected inbox with no attempt
will not be selected. Do not invent a settled/refunded attempt to enter that queue.

Existing integration_errors has an actual approved resolution workflow:
PostgresAdminRepository.resolveIntegrationError (admin-repository.ts)
updates open to resolved inside executeApproved; admin-service.ts and routes/admin.ts
expose integration_error.resolve through support approvals/audit. However scoped
search found no operator list/detail/read route for discovering integration_errors.
Consequently a naked error INSERT is not accepted as complete operator visibility.

Proposed minimal next assignment, not implemented:

- Atomically insert one integration_errors row for the inbox's first terminal
  expiry rejection, including the worker-first case. Use a truthful fixed reason
  expert_residency_reconciliation_paid_after_deadline, provider expert_residency,
  and a deterministic hash binding to the retained verified inbox identity.
  Same-event replay must not recreate even a resolved error. No provider call,
  automatic refund, entitlement or fake outbox/classification.
- Add a support-authorized, bounded read/list/detail path for these existing
  integration errors, projecting safe order/payment evidence by the deterministic
  binding. Reuse the existing approved resolve action; resolution means closing
  the operator incident, NOT proof of refund or entitlement settlement.
- This requires separately assigned admin read/API/application files and focused
  auth/visibility tests; source ownership does not currently permit those edits.
  If explicit FK linkage is required rather than hash-derived linkage, allocate
  a new nullable inbox FK/unique constraint migration after Harvey's0047; no
  migration number or schema change has been claimed here.

Until that route is reviewed/authorized and verified, operator surfacing and overall
task completion remain blocked. No alert INSERT or out-of-scope edit has been made.
Independent review of the extracted helper and coordinator GREEN3 remain required.

## Approved operator extension: first focused executions

Ownership was subsequently expanded to admin-repository.ts, application/admin-service.ts,
API routes/admin.ts and minimal server.ts query wiring, plus two new focused tests.
Coordinator owns the operations runbook. Proposed exact read paths:
`GET /v1/admin/expert-residency/late-payments` and
`GET /v1/admin/expert-residency/late-payments/:errorId`.

2026-10-12 preflight RequireDocker passed (Node24.21.0, pnpm11.9.0).
Read-only target check confirmed database/user ii_tonya, server192.168.112.2,
server_version_num170005 before running the new PG file. No provider calls.

- PG operator run1, start19:29:15UTC, duration6.06s:
  `II_TONYA_TEST_POSTGRES_ADMIN_URL=<approved retained synthetic target> pnpm exec vitest run tests/integration/expert-payment-operator-queries.test.ts`.
  10failed/0passed: seven cases reached missing listLatePayments method;
  three payment-fixture cases failed constraint expert_order_deadline_after_creation
  (23514) BEFORE the intended signal assertions. These three are NOT behavioral
  RED for the atomic signal. No collection failure or unhandled cleanup error.
  Fixed fixture deadline from DBclock minus1second to current DBclock, preserving
  creation-before-deadline constraint and existing production semantics. Not rerun.
- API operator run1, start19:29:16UTC, duration3.63s:
  `pnpm exec vitest run apps/api/src/routes/expert-payment-operator-queries.test.ts`.
  17failed/0passed: missing GET routes returned404, including actual server composition.
  The missing-detail case additionally lacked the required safe not_found response.

No operator production implementation yet. To obtain genuine atomic-signal RED,
the corrected PG fixture needs run2 BEFORE signal code. This differs from the
approved RED1/GREEN2/reserve3 sequence; request a bounded resequence to corrected
RED2, implementation/static, coordinator GREEN3. Do not silently consume reserve3
or claim the fixture failures prove missing atomic signal. Existing settlement
file remains2/3 untouched. Both new test processes exited; none left running.

## Operator candidate implemented after corrected RED2

Coordinator approved the unchanged three-run budget resequence: corrected PG RED2,
implementation/static, coordinator GREEN3. No extra run authorized or taken.

- Admin PG run2, start19:30:33UTC, duration5.77s, **10failed/0passed**:
  both expiry orderings now reach the intended missing-signal assertion
  (expected1 integration_errors row, actual0). Altered-hash case likewise reaches
  missing signal; seven cases reach absent query methods. No fixture/collection
  failure. Command/target are identical to run1. This file is now **2/3**.
- API run2, start19:33:17UTC, duration3.39s, **17/17PASS**. Same focused command.
  Covers authenticated admin sub-app HTTP, role/missing-query/DB-denial failures,
  no-store, strict list parameters, missing-bound-detail404, sanitized exceptions,
  and real server dependency -> application -> actual repository execution.
  It does NOT exercise the outer buildApp forwarding layer; see blocker below.
- DB/application builds passed. DB/application/API typechecks and shared
  tsconfig.tests.json typecheck passed. ESLint over all six owned production files
  and three focused test files passed. git diff --check passed. No full suite,
  old focused suite, provider call or settlement PG rerun.

The PG workflow assertion was strengthened after RED2 to close the signal through
the existing real dual-support request/approve/resolve workflow instead of raw SQL.
This strengthened assertion has NOT run and is not claimed independently RED.
No object assignment is introduced for integration_error; no resolution code was
changed. Both PG files require coordinator final3 after independent review.

### Production contract and dependencies

- First verified late-payment rejection inserts provider expert_residency,
  reason **expert_residency_paid_after_deadline**, status open in integration_errors
  in the SAME transaction as terminal inbox/expiry/release. Same-event terminal
  replay returns before INSERT, including after operational resolution. No attempt,
  refund, activation, fake outbox or new migration is introduced.
- New local module dependency: provider-inbox repository imports the shared SQL
  binding and fixed reason from admin-repository.ts. No package dependency added.
  SHA256 uses JSON framing, exact inbox/payment/order/amount/currency/digest and
  verification identity, epoch timestamps; no connection-timezone string binding.
- Read methods recheck session expiry/revocation, nonfuture MFA within15minutes,
  and support role in the same SQL statement as reading data. List requires explicit
  integer limit1..100, defaults open, supports resolved and paired microsecond
  createdAt/UUID descending keyset cursor. Detail requires matching authenticated
  rejected settled inbox and binding; broken/missing binding returns no item.
- Safe detail adds only inboxId/orderId/provider/paymentId/amountMinor/currency to
  the list summary. No verification identifiers, raw payload/digest, session hash,
  customer identity or chat data is projected. Operational resolution is not refund.
- Exact candidate GET paths: /v1/admin/expert-residency/late-payments and
  /v1/admin/expert-residency/late-payments/:errorId. All sub-app responses no-store;
  unauthorized401, forbidden403, invalid400, missing query503, missing binding404,
  unexpected errors sanitized500. Server injects actual PostgresAdminRepository.

### Actual runtime forwarding blocker (not release complete)

Source inspection after API GREEN2 found apps/api/src/app.ts builds admin sub-app
but forwards generic /v1/admin/* only with POST (line653 at inspection). Its one
specific existing admin GET is expert-referrals/inventory and targets another app.
Thus passing adminService alone does NOT publish these new GET routes in buildApp.
Required minimal extension: authorize app.ts edits for two exact GET forwarders
to the existing admin instance, retaining status/headers/rawPayload and existing
onClose. Add an outer buildApp regression in the same new API test file. No broad
admin wildcard expansion is needed. app.ts has not been edited by this implementer.
Coordinator owns runbook; it has not been edited here. Owned candidate source is
stable for independent review, but complete operator runtime acceptance is blocked
on that forwarding change and both reserved final PG runs.

## Authorized outer composition correction

Coordinator explicitly authorized minimal app.ts forwarding and test-first source
assertions WITHOUT another execution. Before editing production, added five cases
to the SAME API file: real buildApp list with encoded microsecond cursor/status/
limit and bearer-session propagation; safe detail body/status/no-store; paired
list/detail denials for anonymous, nonsupport, DB-denied, and unavailable query.
They use real buildApp/admin sub-app/application service, with synthetic read ports;
the earlier test separately exercises actual server -> actual repository binding.
These five assertions are unrun, not claimed independently RED or GREEN. The file
now contains22 cases; prior GREEN2 covers only its original17.

app.ts now registers ONLY the two exact GET route patterns, forwarding original
URL/query/headers to the existing admin instance and preserving status, headers
(except content-length, matching existing convention), and raw response payload.
Original POST routes, expert inventory forwarding and sub-app close hooks remain
unchanged. Unrelated dirty booking-callback edits preserved. Source runtime
forwarding blocker above is superseded; actual verification remains pending.

No test executed for this correction. API and both PG files remain2/3; coordinator
owns each final3 AFTER independent review. Runbook remains coordinator-owned.
Post-correction API typecheck and shared tests typecheck passed; ESLint on app.ts
and the changed API test passed; git diff --check passed. No active test/tool
process remains. Owned source is stable for Kant review, not release accepted.
