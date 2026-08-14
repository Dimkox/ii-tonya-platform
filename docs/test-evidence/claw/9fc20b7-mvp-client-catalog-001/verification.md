# MVP-CLIENT-CATALOG-001 Claw verification

- Date: 2026-08-14
- Exact main base: `b6763dd`
- Tested production source: `9fc20b7f163af3ec9ef273f14e7034d44c37c473`
- Branch: `codex/mvp-client-catalog-001`
- Retained container: `ii-tonya-test-yookassa` (left Up)
- PostgreSQL: the single configured Claw test server; no connection value was logged

## Final focused gate

The gate used the brand-new
`tests/integration/client-catalog-final-gate.test.ts` file against exact committed
production source `9fc20b7`.

The first collection attempt executed zero tests because a root integration test
could not resolve the API package-private `fastify` dependency. The already-covered
HTTP subcase was removed from this integration-only gate; no production source was
changed. The permitted causal rerun passed:

- test files: 1 passed / 1
- tests: 2 passed / 2
- duration: 15.27 seconds
- covered: joint flag composition, public catalog-only materialization, owner/foreign
  isolation, privacy-export minimization, zero ledger delta, database-clock expiry,
  terminal outbox/tombstone/index purge, and retention-first subject erasure

Before the gate the retained container was Up, no Vitest process was active, and
PostgreSQL reported `test_databases=0` and `test_sessions=0`. After the gate and test
teardown PostgreSQL again reported both values as zero.

## Task and review evidence

- Task 1: repository/boundary 2/2 and real PostgreSQL 3/3; commit `21e2cca`.
- Task 2: application/resolver 21/21; commit `85e7809`.
- Task 3: server 10/10 and route/config 33/33; commit `76b4872`.
- Task 4: worker/composite allowlist 23/23; commit `4b88a2b`.
- Task 5: retention/privacy/metrics 9/9; commit `f97cab6`.
- Adversarial remediation: 11/11, then 5/5, then 1/1 real-PostgreSQL closure.
- Affected builds passed after each source change. The final source-changing build
  gate passed for `@ii-tonya/db` and `@ii-tonya/app-worker`.
- Independent static adversarial review at `9fc20b7` returned `READY: YES`, with no
  remaining Critical or Important finding.

Successful suites were not repeated. Only causal RED suites were rerun after their
specific fixes.

## Cleanup and release boundary

The scoped retained-source backup was restored and `tar -d` reported no difference
for backed-up paths. Task-created remote tests/source, temporary DB-check code,
affected generated `dist` directories, and the scoped backup/list artifacts were
removed. The two pre-existing Task 4 RED tests were restored. No Vitest process
remained, and `ii-tonya-test-yookassa` remained Up.

This evidence does not authorize feature activation, deployment, provider access,
GitHub Actions, image publication, push, or merge. Both catalog-related feature
flags remain false by default.
