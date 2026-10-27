# AC-015 local implementation evidence

## Coordinator review, recovery and demo catalogue

Owner explicitly authorized one additional recovery invocation with "делай".
Run4 passed1/1 on ComposePostgreSQL170005 after the documented fixture fix,
including authenticated valid-CSRF creation rejection, capability reporting,
receipt continuity, revocation denial and job-link persistence across restart.
Log: /tmp/ii-tonya-erasure-recovery.mUaKl9/recovery-run4.log. The single exception
is consumed. This supersedes the unresolved verification caveat below without
discarding its failed-run evidence. It is still not a live rollback drill.

Latest verification caveat: after run2 passed, the recovery test was strengthened
to exercise authenticated creation denial with valid CSRF. Run3 failed because
the new fixture omitted botUsername, so the session probe returned unavailable.
The fixture now supplies the bot name and a canonical session token. This final
version has NOT been rerun: logical recovery PG budget3/3 is exhausted. An
explicit one-run exception was requested from the owner; no reply recorded yet.
Run2 remains evidence only for the earlier sessionless recovery scenario, not
the final augmented test. Failure: recovery-run3.log in the same directory.

Independent reviewer Planck found unbounded user/job lock waits and missing
receipt-preserving release recovery evidence. Popper owns the bounded-wait fix
and its new contention regression; the original erasure PG file remains3/3
exhausted. No new rollout is claimed by this document.

Coordinator added `CLIENT_ERASURE_REQUESTS_ENABLED=false` as an independent
default-closed creation gate. Server service and browser route/capability all
use it. Keep the existing privacy flag enabled to preserve other rights during
recovery. New config test RED1 then GREEN1; existing config24/24, API2/2,
config build, API typecheck and scoped lint/diff checks passed.

`apps/api/src/routes/erasure-recovery.integration.test.ts` uses real isolated
Compose PostgreSQL17.5 and two fresh Fastify instances over preserved data.
It verifies stable accepted request ID/status, unchanged rows and job links,
revoked receipt denial, sessionless reads and closed creation while privacy
remains enabled. Logical run1 failed module collection because Fastify is an
API-owned dependency; moving the file into that workspace preserved the budget.
Run2 passed1/1; one invocation remains. Evidence:
`/tmp/ii-tonya-erasure-recovery.mUaKl9/recovery-run2.log`. The dedicated fixture
was removed after verification. This is application recovery evidence, not a
live host or signed-artifact rollback drill.

Owner subsequently requested fictional catalogue content, superseding the
earlier empty-display decision. Six clearly labelled display-only cards are
separate from real inventory and have no booking/payment actions, IDs or provider
records. Catalogue render test RED1/6 then GREEN6/6. Real Chrome initially passed
without CSS; strengthening to actual CSS exposed a long-heading overflow. Scoped
catalogue heading wrapping/sizing fixed it; final Chrome1/1 passed. Three browser
invocations used, budget exhausted. Final log:
`/tmp/ii-tonya-demo-catalog-browser-final.log`. Web/tests typechecks, scoped lint,
formatting and final web build passed. Reviewer inspected the demo changes and
CSS fix with no additional defect; this is not deployed catalogue evidence.

Base: `7278bab8548638eedd26fe2b401369b4de7c9bd9`.
Implementation is uncommitted and not deployed. Coordinator owns independent
review, AGENT-STATUS.md and the production audit.

Environment check with RequireDocker passed Node24.21.0/pnpm11.9.0 and Compose.
New isolated Compose PostgreSQL17.5 fixture used only synthetic subjects.

Focused results:

- Application receipt/service: 12/12; initial new-module collection failure,
  then GREEN. Digest binding, token rejection, owner guard, disabled creation,
  minimal states and proof failure are covered.
- Browser API: initial status-route RED404, then1/1, expanded final2/2. Includes
  explicit confirmation, owner CSRF, replay/conflict and sessionless status.
- Browser client: RED2 (missing methods), then GREEN2/2; lost response retains
  the same generated token. No automatic write replay.
- Real headless Chrome: final1/1. First two runs failed a Cyrillic assertion
  because the synthetic page omitted UTF-8. The corrected fixture passed
  confirmation/download gating, same-token retry, sessionless status, no browser
  storage and narrow-window overflow checks. This is synthetic HTTP evidence,
  not real Telegram login or real-user acceptance. Browser budget3/3 exhausted.
- Worker runner: initial new-module collection failure, then1/1; missing
  execution capability does no work, individual failures remain pending.
- PostgreSQL request file: run1 collection failure, run2 GREEN3/3, final
  GREEN4/4. Budget3/3 exhausted. Covers concurrent uniqueness, replacement,
  foreign-job rejection, inactive/revoked receipt handling, atomic actual local
  erasure binding/replay, pending capture failure and verified backup projection.
  Processor/backup evidence in this test is explicitly synthetic.
- SQL reconstruction:101 tables,648 constraints,286 indexes; normalized
  introspection and SQL-only supplement captured from PostgreSQL170005.

Logs are retained under `.superpowers/sdd/2026-10-09-erasure-requests/`:
`pg-final.log`, `api-final.log`, `web-client-green.log`, `browser.log`,
`browser-2.log`, `browser-3.log`, `worker-red.log`, `worker-green.log`,
`reconstruction.log`, build/typecheck logs and repository guard logs. Early
service/API/PG invocations are in the tool transcript only. Failed logs remain.

The single tests/repo run passed440/444; failures were the new unique-constraint
inventory, table count and two journal hash pins. Exact additive inventory/hash
updates were made; final focused results are recorded in the handoff.
Focused correction results: schema parity12/12, migration history8/8,
scope boundary123/123, in `repo-schema-final.log`, `repo-history-final.log`,
and `repo-scope-final.log`. No aggregate rerun.
Application/DB/worker/API/web builds, relevant application/DB/API/worker/web
typechecks and tests typecheck passed. Scoped ESLint and git diff whitespace
checks passed; empty successful logs are retained alongside failed checks.
Initial tests-typecheck failures were test-double literal widening, corrected
with literal types. No exhausted legacy test or full suite was run.

Outstanding: independent review; production execution adapters/current-policy
binding; authentic target/processor/backup evidence and custody; the existing
post-certification child-work invariant and restore/policy workflow; RC signing,
deployment, live status verification and real-user acceptance. See
[execution and recovery contract](../operations/erasure-requests.md).

## P1 follow-up: bounded database contention

The independent reviewer identified unbounded subject/job locks. The request
repository now runs accept, owner read, receipt read, pending selection and verified
job reads in transactions with PostgreSQL `lock_timeout=1000ms` and
`statement_timeout=2000ms`. Storage failures are sanitized only after rollback.
No Promise.race abandons active database work. Verified job reads hold the parent
job lock and pass the same transaction to workflow `getJob`, including terminal
child-work and backup-proof checks. Standalone workflow getJob also sets these
transaction-local limits. This bounds SQL statements/lock waits, not pool checkout
or network connection establishment; shared pool policy remains outside this fix.

New `tests/integration/erasure-request-contention.test.ts`:

- Invocation1: behavioral RED0/3. Subject, job and request-table locks blocked
  until the fixture's six-second safety unlock; each incorrectly returned success.
- Invocation2: GREEN3/3 on Compose PostgreSQL170005. Subject case1059ms,
  job case1038ms; three independent read boundaries under a table lock3029ms total.
- Uses a single-connection repository pool, separate lock-holder connections,
  checks sanitized failure before unlock, no residual active transaction/query,
  restored session timeout defaults, unrelated-owner progress and recovery.
- New file budget2/3 used. Original erasure-requests.test.ts remains3/3 exhausted
  and was not run. No aggregate repo/full suite was run for this fix.

Logs: `contention-pg-red.log`, `contention-pg-green.log`,
`contention-{db,api,worker}-build.log`, `contention-*-types*.log`,
`contention-lint*.log`, `contention-format*.log`, `contention-diff-check.log`
under the existing ledger directory. An initial prefer-const lint finding and
format warning are preserved; the correction is declaration/formatting only.
Final DB/API/app-worker builds, DB and tests typechecks, scoped ESLint,
Prettier and whitespace checks exited0. Only the owned contention fixture,
volume and network were removed; cleanup is logged in
`contention-fixture-cleanup.log`. The coordinator's recovery fixture and test
were not touched. No third contention invocation was consumed.

Receipt-preserving operational recovery still requires the coordinator's tested
recovery artifact/procedure. The coordinator reports a separate status-only
recovery integration test GREEN1/1 and an independent creation flag; this fix
does not rerun that test, certify operational rollout/rollback, or replace that
release prerequisite. Genuine execution/provider/backup/custody and legal
prerequisites remain unchanged. No push or deployment.
