# Client paid settlement — local evidence

Baseline: `ab4cd4a7d30ccbf4a58997f0aabbe23d45b2f01b`.
Branch: `codex/client-paid-policy-20261010`.
Scope: immutable client orders, provider binding and atomic package/coupon grants.
This document is not production release evidence.

Final local result: repository14/14, migration-state2/2, repository-integrity14/14
passed. DB build, DB/tests typechecks, scoped ESLint, Prettier and whitespace
checks passed. Independent verification reviewer confirmed accepted coverage
fixes. The owned final Compose container, network and synthetic volume were
removed; the pre-existing shared test container and all production data remain.

## Environment

`pwsh -File scripts/check-development-environment.ps1 -RequireDocker` passed:
Node24.21.0, pnpm11.9.0, Docker29.8.2, Compose5.6.0, PowerShell7.6.6.
Existing isolated PostgreSQL17.5 container is used only to create disposable
databases. No production credentials or customer data enter these tests.

## Verification record

The following initial failures are retained as history, not the final result.

- Migration-state test invocation1: expected RED, missing0042 snapshot and
  SQL-object supplement. SQL replay through existing0041 completed on170005.
- SQL replay and normalized introspection through0042 passed on170005:
  105 tables,677 constraints,299 indexes. Generated state is linked to0041 and
  bound by SHA-256 to all43 input migrations; no generated SQL was executed.
- Migration-state invocation2 passed2/2 (including independent replay and
  catalog comparison). Budget2/3 used. Command:
  `node .superpowers/sdd/2026-10-05-client-async-authority/run-pg.mjs tests/integration/client-paid-migration-state.test.ts`.
- `pnpm exec vitest run tests/repo/migration-history-integrity.test.ts tests/repo/migration-state-baseline.test.ts`
  passed14/14. The task's one multipath invocation is consumed.
- Final Prettier normalization changed only snapshot/supplement JSON formatting;
  manifest hashes were refreshed. Direct SHA-256 assertions verified both final
  artifact bytes and all43 SQL inputs; final JSON formatting check passed.
- Repository invocation1: missing-module RED, no tests collected. Invocation2:
  setup assertion read the wrong column from SHOW server_version; all7 skipped.
  Corrected query to alias current_setting('server_version') as version.
- Repository invocation3:6/7 passed. The successful-settlement test reached
  grant-count checks but failed comparing timestamp strings to Date instances.
  Corrected the test to normalize returned strings with new Date. No production
  code, SQL or schema changed after this run. Later contradictory-replay assertions
  in that test were not reached. Correction is NOT verified by execution.
- Repository budget3/3 exhausted; one additional invocation requested from owner.
  Do not rerun, rename or split tests to bypass this limit. Commands used Vitest
  on `packages/db/src/repositories/client-paid-order-repository.test.ts`, with a
  disposable Compose17.5 administrator URL (not retained here). Tool transcript
  chunks:94f9a4,848de0,9d7113. No standalone log files were saved.
- Implementer reports domain/DB builds, DB/tests typechecks, scoped lint/format
  and whitespace passed. Coordinator repeated DB and tests typechecks successfully.
  No completion claim.

## Review triage

Owner explicitly authorized one additional PostgreSQL invocation after review.
Invocation4 passed14/14 at2026-10-10 15:38:19UTC, including all four SKUs, replay
conflicts, both binding races, input mutation and both rollback/recovery points.
Command: `node .superpowers/sdd/2026-10-10-client-paid-settlement/run-final.mjs`.
Log: `.superpowers/sdd/2026-10-10-client-paid-settlement/run4.log` (local ignored).
This consumes the one exception; further executions are not authorized.
An owned Compose project `ii-tonya-paid-final-20261010` with the committed
postgres17.5-bookworm service supplied only disposable synthetic test databases.

Three independent reviewers completed read-only review. Accepted test patches:
all four SKU settlements, rollback at final settlement insertion, contradictory
binding races and caller input mutation. These improve direct coverage without
changing production behavior; all passed in the authorized extra run.

Other findings were evaluated against this repository-only boundary: provider
truth authentication is intentionally outside this module; DB-superuser writes
are not an exposed client API. Direct SQL can insert an orphan coupon or a
reserved-prefix package without going through this repository. This is a known
data-integrity limitation for future composition: do not add alternate writers
or treat arbitrary coupon rows as verified paid benefits. Settlement reads must
remain authoritative. Extending deferred cross-table enforcement is not claimed.
Current SQL pins version1 price/units/coupons and exact60/45-day expiry, so future
policy changes require a new version and migration rather than editing history.
Lock-wait limits and mapping database errors at the future HTTP boundary still
need operational composition. No endpoint exposes these errors today.

## Remaining release work

The generic payment port still has no client checkout implementation. Do not
activate it or reuse expert-owned provider operations. Next composition must
authenticate the customer, read immutable order terms, retrieve provider truth,
match payment metadata/amount/currency/mode and supply original capturedAt.
Receipt contact consent, uncertain provider outcomes, reconciliation and refund
handling remain separate acceptance work. Coupon grants alone do not implement
spending or balance display. Existing client cohort rules remain unchanged.

## Recovery

This change does not alter runtime configuration or existing migration files.
Do not apply migration0042 to production based on local evidence alone. No down
migration is proposed: after actual payments, purchase and grant facts must be
retained. A later release plan must retain compatible readers and stop new
checkout admission while reconciling outstanding provider operations.
