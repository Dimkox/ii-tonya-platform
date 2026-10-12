# Local handoff runtime evidence

Scope: local job scheduling in `apps/worker/src/runtime.ts`, production wrapper
and actual main factory composition. Database boundary is a test double; real
journal validation requires separate PostgreSQL evidence. No provider calls,
production mutation or release claim.

New logical test file: `apps/worker/src/booking-handoff-runtime.test.ts`.

| Invocation | UTC start | Result |
| --- | --- | --- |
| 1 | 2026-10-12 18:22:37 | 2 behavioral failures,1 pass: runtime lacked local withdrawal report/call |
| 2 | 2026-10-12 18:22:59 | 3/3 pass,2.23s total |
| 3 | 2026-10-12 18:27:00 | 6/6 pass,3.48s total; invocation allowance exhausted |

Tests verify local processing with no notification sender, production-wrapper
forwarding and no new local job after shutdown starts. A fetch spy checks zero
HTTP in the direct runtime case. The injected job is a bounded test dependency,
not evidence of real journal validation or actual main factory composition.

McClintock requested ordering and in-flight shutdown regressions. Added deferred
safety→revocation→notification ordering and both success/rejection resource-close
cases. Reviewer source-closed both findings before run3. Worker typecheck and
changed main/runtime/test ESLint passed. Existing exhausted files were not rerun.

## Actual main factory composition

Distinct new logical file `apps/worker/src/booking-handoff-composition.test.ts`
tests the previously untested entrypoint, not copied runtime or old PG coverage.

| Invocation | UTC start | Result |
| --- | --- | --- |
| 1 | 2026-10-12 18:25:29 | Fixture/build failure: stale DB package lacked new export; not behavioral RED |
| 2 | 2026-10-12 18:26:07 | Behavioral RED: main did not compose the local job |
| 3 | 2026-10-12 18:26:42 | 1/1 pass,2.53s total; invocation allowance exhausted |

DB ESM+DTS rebuilt before invocation2. Main now creates the real repository on
the shared DB, schedules `consumePending(20)` independently of external flags,
and closes the DB. Test uses the actual consumer's empty-candidate query, verifies
zero HTTP and the result report, while unrelated jobs are stubbed. No transaction
or nonempty-source processing claim follows from this composition test. Reviewer
accepted main source wiring before run3.

Remaining: DB implementation/review and PostgreSQL evidence; final exact-candidate
verification. Retention policy and full commercial release remain open.
