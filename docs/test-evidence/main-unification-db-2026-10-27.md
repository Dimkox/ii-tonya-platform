# Main unification: database reconciliation evidence — 2026-10-27

This is source integration evidence. It does not authorize deployment, database
mutation outside the disposable test instance, or provider/payment activation.
The coordinator records the final reviewed commit and aggregate result separately.

## Canonical migration history

The integrated journal preserves the residency tip's original SQL and metadata
through `0069_resident_semantic_tags`. It appends byte-identical copies of the
other branches' SQL:

| Canonical migration              | Original branch migration             |
| -------------------------------- | ------------------------------------- |
| `0070_planerka_availability`     | RC `0051_planerka_availability`       |
| `0071_lifecycle_scheduler_c1`    | main `0039_lifecycle_scheduler_c1`    |
| `0072_booking_waitlist_d1`       | main `0040_booking_waitlist_d1`       |
| `0073_booking_reschedule_replay` | main `0041_booking_reschedule_replay` |

Original SQL bytes, original paths, source commits and SHA-256 values remain in
`packages/db/migrations/history/{rc,main}-before-unification/manifest.json` and
its adjacent archived SQL. No historical SQL body was rewritten. Canonical journal
SHA-256 is `a3e589e564641129dc592202e39155a2e66d3434e1a09ff56316fc7dd39f56ed`.

`migrateDb` compares every applied Drizzle row's hash and timestamp with the exact
canonical prefix before invoking the migrator. Existing old-main and RC-availability
histories diverge from this journal and fail with
`migration_history_reconciliation_required`. Unknown, reordered and retimestamped
histories fail as well. **Existing deployed RC databases must receive a separately
reviewed operator reconciliation before this candidate can be deployed.** No
production reconciliation was attempted. Fresh and canonical-prefix databases
retain the ordinary migration path.

## PostgreSQL-derived state

Environment preflight passed with Node 24.22.1, pnpm 11.9.0, Docker 29.9.2 and
Compose 5.6.1. The reconstruction used an owned disposable
`postgres:17.5-bookworm` container and synthetic credentials only.

All canonical SQL through `0073` replayed successfully on a fresh PostgreSQL
17.5 database. After each appended migration, pinned Drizzle Kit 0.31.10
`introspect` wrote to a separate fresh ignored scratch directory. Its generated
SQL was never executed. `normalizeMigrationSnapshot` corrected the snapshots
against independent positional constraint/index catalogue reads. Committed
snapshots, complete SQL-object supplements and per-input hash manifests bind
states 0070–0073. The last state contains 218 tables, 158 user functions and
196 non-internal triggers. This closes no grandfathered historical gaps and
introduces no new missing snapshot.

This fresh reconstruction is actual PostgreSQL evidence; the focused migration
preflight test below uses mocks and is not an existing-deployment upgrade proof.

## Mutation compatibility corrections

Independent review identified three unsafe combinations of the branches:

- Restored waitlist join/promotion and local reschedule now recheck current
  residency visibility, so archived or paused target experts cannot gain bookings.
- A reservation with any Planerka operation cannot use local reschedule. Its
  durable provider request retains ownership of its original slot; pending,
  sending and booked operations require a dedicated reconciliation workflow.
- Lifecycle delivery composition was corrected by the separate implementation
  owner and is evidenced by that owner's focused tests.

The provider fixture now models an availability refresh after mapping insertion,
which intentionally invalidates observations. This change does not weaken the
production freshness predicate.

## Focused verification and consumed budgets

All commands ran from the integration worktree. PostgreSQL commands used the
owned disposable 17.5 instance via `II_TONYA_TEST_POSTGRES_ADMIN_URL`; the testkit
created and removed a separate database per fixture.

| Command                                                                                                  | Runs consumed | Final result                                             |
| -------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------- |
| `pnpm exec vitest run packages/db/src/migration-history.test.ts`                                         | 1             | 8/8 passed; exit 0; 1.79 s                               |
| `pnpm exec vitest run tests/integration/residency-waitlist-admission.test.ts`                            | 3             | 4/4 passed; exit 0; 4.37 s                               |
| `pnpm exec vitest run tests/integration/planerka-booking-workflow.test.ts -t 'refuses local reschedule'` | 3             | 3/3 selected passed, 16 existing skipped; exit 0; 5.35 s |

The first residency run reproduced archived-expert waitlist admission; subsequent
cases encountered a shared fixture's repeated Telegram identity. The second run
passed three cases and exposed a repeated synthetic booking handle. Unique
fixture identities/handles were repaired; run three passed all four cases.

The first two provider runs stopped at `fixture_unavailable:stale_slot` because
mapping insertion invalidated the fixture observation. They did not reproduce the
provider mutation defect. After the fixture refresh and fail-closed guard, run
three passed the pending/sending/booked assertions, including unchanged provider
and reservation state. No stronger RED claim is made for these three cases.

The two PostgreSQL files above exhausted their three-invocation budgets and were
excluded from the coordinator's single aggregate invocation. Their full existing
file contents were not separately rerun. No fourth invocation is authorized by
this evidence. Formatting and focused whitespace checks passed. Aggregate tests,
complete build/typecheck/lint and final commit review belong to coordinator evidence.

The disposable container remains running until the coordinator finishes its
aggregate verification; it contains synthetic data only.

## Corrections following the single aggregate invocation

The initial aggregate result is retained by the coordinator. It exposed additional
historical fixture assumptions, corrected in tests only:

- Campaign user-deactivation triggers now hold the same subject advisory lock as
  checkout. The competing-authority test previously waited for a later user-row
  SELECT that could not be reached while its blocker remained open. Its gate now
  observes the first real subject-advisory wait; tariff-row coverage remains.
  Production lock timeouts, three-attempt bounds and isolation are unchanged.
- The historical expired-order fixture set a deadline one second before the real
  clock on an order created less than one second earlier. That contradicted the
  existing `expert_order_deadline_after_creation` CHECK. Its privileged fixture
  now ages creation two seconds and deadline one second together, preserving
  `created_at < payment_deadline < now` and all production constraints.
- Booking-concurrency mapping setup now restores its original synthetic historical
  observation after the mapping write invalidates it. Real production mapping
  invalidation and freshness checks remain enforced.
- The Planerka availability catalogue assertion previously read migration0051,
  now occupied by the canonical onboarding history. It now compares the complete
  reconstructed database with canonical0073, including predecessor0072, all input
  hashes, supported snapshot fields and the full SQL-only catalogue. Availability
  index and table assertions remain explicit.

Each corrected file ran once in full against an isolated database on the owned
PostgreSQL17.5 instance. Each has consumed two invocations including its initial
aggregate run, below the three-run bound:

| Command                                                                 | Focused result      | Duration |
| ----------------------------------------------------------------------- | ------------------- | -------- |
| `pnpm exec vitest run tests/integration/expert-campaign-orders.test.ts` | 87/87 passed, exit0 | 93.88s   |
| `pnpm exec vitest run tests/integration/booking-concurrency.test.ts`    | 18/18 passed, exit0 | 15.26s   |
| `pnpm exec vitest run tests/integration/planerka-availability.test.ts`  | 54/54 passed, exit0 | 75.85s   |

The final availability test independently introspected the actual full database
and matched canonical0073 exactly after catalogue normalization; that assertion
took32.965s. Local logs are retained in ignored task scratch. No second aggregate
suite was run for these corrections.

The aggregate also exposed an obsolete literal schema inventory (106 expected
relations). The canonical0073 database has218 base tables and5 views; every
previously expected name remains present. The test now pins the complete literal
223-relation union inventory from the independently verified database-derived
state. No schema or migration was changed. Its second invocation,
`pnpm exec vitest run tests/integration/schema.test.ts`, passed7/7 with exit0 in
21.66s against an isolated PostgreSQL17.5 database. It has one focused invocation
and the original aggregate invocation (two total).

Two Telegram callback cancellation fixtures also attempted to transition directly
to `booked` without the bound provider confirmation required by migration0043.
They now seed an explicit synthetic historical booked Planerka operation with its
own UID before the reservation update. The confirmation trigger remains enabled;
no production code or SQL was changed. The entire
`tests/integration/telegram-callback-repository.test.ts` passed14/14, exit0,
12.38s on its second invocation (initial aggregate plus one focused run).

The D1 lifecycle replay fixture received the same explicit synthetic historical
provider confirmation before its direct `booked` transition. Replay still returns
the immutable original reschedule result without mutating the now-confirmed
booking. `booking-lifecycle-d1.test.ts` passed5/5, exit0,12.53s on invocation2.

The historical refund fixture previously attributed the inviter's credit
reservation to the invitee's already-settled qualifying order. That impossible
ownership/status combination was not a cancellable pending consuming purchase.
The fixture now creates a separate inviter-owned pending consuming order with the
same valid legacy snapshot,20000 reserved credit and the remaining cash price.
Its ledger reservation points to that order. All database financial guards remain
enabled, the expected30000 debt is unchanged, and an additional assertion proves
the pending consuming order becomes failed. Concurrent provider reversal/replay
still produces exactly one reversal and one reservation release.
`expert-residency-refund-reversal.test.ts` passed4/4, exit0,9.27s on invocation2.
Neither correction changed production code, migrations or expected money rules.

The Planerka migration-state test retains an exact SQL replay through0043 and its
unchanged historical snapshot/SQL-only catalogue assertions. Only subsequent
current-repository behavior cases now replay the remaining canonical44–73
migrations before invoking current code, whose residency visibility predicates
require those relations. Genuine pre0043 booked rows still remain quarantined
without a fabricated provider UID, and their terminal/cancellation/pagination
expectations are unchanged. `planerka-migration-state.test.ts` passed7/7, exit0,
14.32s on invocation2, including the original independent0043 introspection check.

Protected client-booking expectations now match the separately admitted provider
workflow: local reserve and cancellation each create one exact Telegram event,
without a fabricated generic Planerka outbox job. A local-only cancellation/replay
explicitly returns `providerCancellationPending:false`. The test pins both exact
remaining topic names, one reservation/receipt/audit under concurrency and unchanged
foreign/absent denials. `client-booking-repository.test.ts` passed3/3, exit0,4.18s
on invocation2. Only test expectations changed; provider production authority did
not change.

## MVP smoke harness alignment

The test-only MVP harness is imported only by `tests/e2e/mvp-smoke.test.ts`.
It now uses a current relative synthetic clock (preserving the exact30-day500-unit
grant, two dialogue debits and498-unit remainder), seeds a verified synthetic
Planerka mapping before its observation, and distinguishes expert approval from
provider confirmation. The harness drives real PostgreSQL operation claims,
account admission, send admission and exact request/UID-bound completion before
reporting booked. Cancellation similarly uses the real recovery claim,
cancellation admission and persisted completion before reporting cancelled.
Provider responses remain explicitly synthetic; no HTTP/live provider request is
performed. Production provider guards, real-time checks and account rate bounds
remain enabled.

Focused invocation2 completed the positive customer/reconciliation journey but
exposed the old destructive negative-control deletion of a cancellation outbox
row now referenced by retained operator diagnostics. The final negative control
changes exactly one targeted synthetic row to a noncanonical notification topic,
preserving diagnostic foreign keys while proving the required canonical
notification is missing. It verifies that exactly one row was targeted. All
original missing-notification, missing-send and reconciliation-mismatch negative
assertions remain.

Focused invocation3 of `pnpm exec vitest run tests/e2e/mvp-smoke.test.ts` passed1/1,
exit0,9.87s. The file has exhausted its three-invocation budget including the
original aggregate run; do not run it again without explicit owner authorization.
Only the test and its test-only support harness changed.
