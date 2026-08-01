# Task 17C exact admin workflow report

## Scope delivered

- Replaced the fail-closed application stub with an exact command boundary for
  all MVP-FR-015 operations. The boundary rejects route/command target
  mismatches before calling a port, accepts only normal package sizes
  `500|1000|1500|2000`, and keeps the no-expiry 100-unit intro grant separate.
- Added exact PostgreSQL repository methods for client create/deactivate,
  expert verify/suspend, service activate/deactivate, normal and intro grants,
  package revoke, integration-error resolution, and safety/negative-feedback
  acknowledge/resolve. There is no generic SQL mutation switch.
- Every first execution uses one PostgreSQL transaction containing the Task 17B
  exact approval consume against the transaction handle, domain mutation,
  immutable package/ledger/case fact where relevant, required integration
  outbox, and complete allowed audit. A mutation/audit error rolls all of those
  effects back; a complete denied audit is then appended separately.
- API admin HTTP routes remain unregistered and their existing tests remain
  fail-closed for Task 17D.

## TDD evidence

### RED

- Command:
  `pnpm exec vitest run packages/application/src/admin-service.test.ts`
- Result: 1 file, 7 tests failed. The prior application stub returned
  `Admin workflows are not registered` for exact dispatch, target mismatch,
  package-size, and intro-grant tests.

### GREEN

- Command:
  `pnpm exec vitest run packages/application/src/admin-service.test.ts
  packages/db/src/repositories/admin-approval-repository.test.ts
  tests/repo/admin-workflow-guards.test.ts
  tests/repo/db-schema-parity.test.ts apps/api/src/routes/admin.test.ts`
- Result: 5 files, 23 tests passed.
- The structural tests also require exact repository methods, approval consume
  before mutation before allowed audit inside one transaction, one consolidated
  Task 17C migration, immutable case actions, and no generic mutation switch.

## Package and replay contract

- Normal grants derive one PostgreSQL timestamp and persist both `granted_at`
  and exact `expires_at = granted_at + interval '60 days'`.
- Intro grants use action `package.intro_grant`, exactly 100 units, and no
  expiry.
- Admin package and ledger facts persist immutable approval ID and requester
  session-hash bindings. Replays first fail the one-time consume and then
  require a currently valid server-resolved principal plus exact stored
  approval, session, target, units/kind, and idempotency semantics.
- Revoke locks both the user-owned package and original grant, derives the
  current ledger balance, and appends one non-positive revocation referencing
  `original_entry_id`. Cross-user mutation cannot match the locked target.

## Schema and upgrade

- Consolidated all unpublished generator iterations into one additive
  `0016_task17c_admin_workflows.sql` and one coherent 0016 snapshot/journal
  entry.
- The migration adds `users.active`, bounded admin package contracts, immutable
  admin approval/session bindings, `integration_errors`, and append-only
  `admin_case_actions`.
- The populated-0012 upgrade suite now applies 0013 through 0016 and asserts
  the Task 17B legacy approvals survive while Task 17C defaults/tables exist.
- Safety and feedback resolve actions use the Task 17B assignment mapping and
  re-check the exact `safety_case` or `feedback_queue` assignment at consume.

## PostgreSQL behavioral authority

- `tests/integration/admin-ledger.test.ts` contains 7 behavioral cases:
  concurrent/replayed normal grant with exact expiry and immutable audit;
  intro grant; revoke conservation/replay/cross-user denial; all client,
  expert, service, and integration-error state changes; transaction rollback
  under allowed-audit fault and retry; forged approval denial; assigned
  safety/feedback acknowledgement and resolution with immutable action facts.
- Local command:
  `pnpm exec vitest run tests/integration/admin-ledger.test.ts`
- Result: BLOCKED in `beforeAll` before all seven bodies with
  `Could not find a working container runtime strategy`. This is not counted
  as a passing PostgreSQL gate.
- The suite is wired into GitHub Database Gate as
  `Run atomic admin workflow gate`.

## Final static and build gates

- `pnpm lint`: passed.
- `pnpm typecheck`: passed for all 10 checked workspace projects.
- `pnpm build`: passed for all 10 built workspace projects.
- `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`:
  passed with `Everything's fine`.
- `pnpm exec drizzle-kit generate --name task17c_final_no_diff --config
  packages/db/drizzle.config.ts`: `No schema changes, nothing to migrate`.
- `git diff --check`: passed.

## Transition-integrity and application-result P1 remediation

### RED

- Added application tests proving denied and allowed/replayed workflow results
  must cross the service boundary unchanged.
- Added a migration guard for a dedicated human-escalation transition trigger,
  deletion rejection, version increments, and all established status edges.
- Command:
  `pnpm exec vitest run packages/application/src/admin-service.test.ts
  tests/repo/admin-workflow-guards.test.ts`
- Result before implementation: 3 failed and 14 passed. Both application
  results were `undefined`, and migration 0016 had no transition-integrity
  function.

### GREEN

- `AdminWorkflowPort` and `AdminService` now use one exact discriminated
  `AdminWorkflowResult<T>` contract with per-operation result payloads.
  Every service method returns the repository result, so
  `approval_denied` cannot collapse into apparent `undefined` success.
- Migration 0016 replaces the removed broad handoff append-only trigger with
  `enforce_human_escalation_transition`. Direct DELETE is always rejected;
  identity, incident, opened/deadline/reason/created facts stay immutable;
  version advances exactly once; `updated_at` advances; owner and transition
  timestamps are constrained.
- The only accepted edges are `opened -> assigned`,
  `assigned -> acknowledged`, `assigned -> escalated` after the SLA deadline,
  and `acknowledged|escalated -> resolved`.
- The PostgreSQL suite now has 11 cases and directly covers deletion,
  immutable rewrites, skipped transitions, wrong versions, both assignment
  owner conventions, acknowledgement, SLA escalation, and resolution.
- Focused command:
  `pnpm exec vitest run packages/application/src/admin-service.test.ts
  packages/db/src/repositories/admin-approval-repository.test.ts
  tests/repo/admin-workflow-guards.test.ts
  tests/repo/db-schema-parity.test.ts apps/api/src/routes/admin.test.ts`
- Result: 5 files and 30 tests passed.
- Local PostgreSQL command:
  `pnpm exec vitest run tests/integration/admin-ledger.test.ts`
- Result: BLOCKED in `beforeAll`; all 11 bodies were skipped because
  Testcontainers reported `Could not find a working container runtime
  strategy`. This remains a required GitHub Database Gate.

### Final gates

- `pnpm typecheck`: passed for all 10 checked workspace projects.
- `pnpm lint`: passed.
- `pnpm build`: passed for all 10 built workspace projects.
- Drizzle metadata check: passed with `Everything's fine`.
- Drizzle generation: `No schema changes, nothing to migrate`.

## Database Gate run 30696346265 remediation

- GitHub Actions run `30696346265` executed commit `53117b4` and failed in
  `Run verified catalog integration gate` before the atomic Task 17C workflow
  gate could run.
- The failed reservation row used fixed
  `reserved_until = 2026-08-01T10:00:00Z`, while PostgreSQL assigned
  `created_at = 2026-08-01T10:47:22.690161Z`. This violated
  `reservations_deadline_after_creation` with SQLSTATE `23514`.
- A narrow scan of `tests/integration/catalog-repository.test.ts` found only
  this reservation deadline coupled to a fixed wall-clock value. Other fixed
  timestamps in the suite define the catalog business-time scenario.
- The test-only reservation insert now derives expiry from PostgreSQL as
  `clock_timestamp() + interval '1 hour'`; no host clock, production code, or
  schema changed.
- TDD regression guard RED: 1 of 1 failed before the edit. GREEN: 1 of 1
  passed afterward.
- Focused repository gates: 3 files and 16 tests passed.
- `pnpm typecheck`: passed for all 10 checked workspace projects.
- `pnpm lint`: passed.
- The catalog PostgreSQL test was attempted locally but could not start a
  container runtime; its body was skipped. The existing unconditional
  `afterAll` then also observed undefined setup state. CI remains the
  authoritative PostgreSQL rerun.
- Build was not repeated because this isolated change affects test SQL only;
  the prior build at commit `53117b4` passed.

## Boundaries

- No credentials, secrets, live bindings, raw authorization headers, raw
  feedback/conversation text, or profile payloads were added.
- PostgreSQL behavior is still pending the GitHub Database Gate because the
  local machine has no working Testcontainers runtime.

## Independent-review P1 remediation

### RED

- Added four structural tests for the missing replay validator, normal-admin
  revoke provenance, authoritative alert state transitions, and safe legacy
  upgrade classification/FKs.
- Command:
  `pnpm exec vitest run tests/repo/admin-workflow-guards.test.ts`
- Result: 4 of 7 tests failed on the four missing contracts.

### GREEN

- Added `PostgresAdminApprovalRepository.validateConsumedApprovalReplay`.
  Grant and revoke replay now share this one validator, which rechecks current
  DB-clock requester and approver sessions/MFA, exact current required role,
  requester identity/session binding, consumed approval ID, action, mapped
  object type/ID, canonical payload hash, nonce, and object assignment.
- Revoke now locks and accepts only a nonlegacy `kind='admin'` package created
  by the workflow and its original positive grant with matching immutable
  package provenance. Paid, intro, legacy, unbound, and mismatched-provenance
  packages roll the consume back and receive only a denied audit.
- Safety acknowledgement is `assigned -> acknowledged`; resolution is
  `acknowledged|escalated -> resolved`. Feedback acknowledgement is
  `escalated -> acknowledged`; resolution is `acknowledged -> resolved`.
  Each transition locks the row, updates authoritative status/timestamps/
  version in the approval transaction, and appends one immutable case action.
- Regenerated one coherent unpublished 0016 snapshot. The migration explicitly
  backfills only existing admin/intro packages and original grant facts as
  legacy while temporarily disabling their append-only update triggers. New
  legacy markers are rejected. New admin/intro packages require approval and
  session FKs plus exact consumed approval provenance; paid rows must remain
  unbound. A ledger trigger enforces package/original-grant provenance and
  exact consumed revoke approval provenance.
- Focused GREEN command:
  `pnpm exec vitest run tests/repo/admin-workflow-guards.test.ts
  packages/db/src/repositories/admin-approval-repository.test.ts
  tests/repo/db-schema-parity.test.ts packages/application/src/admin-service.test.ts
  apps/api/src/routes/admin.test.ts`
- Result: 5 files, 27 tests passed.

### Expanded PostgreSQL authority

- The admin workflow suite now has 9 cases. It adds replay denial after
  entitlement-role revocation while another role remains, changed
  nonce/action/object/payload denial, paid/intro revoke rollback, safety state
  order, concurrent transition serialization, transition rollback under audit
  failure, and authoritative state/timestamp/version assertions.
- The populated upgrade case now seeds arbitrary pre-0016 admin and intro
  sizes/expiry plus ledger rows, proves exact preservation and explicit legacy
  classification, and tests migration-only marker rejection, approval-bound
  paid rejection, and session FK rejection.
- Local combined command:
  `pnpm exec vitest run tests/integration/admin-ledger.test.ts
  tests/integration/admin-approval.test.ts`
- Result: both files failed in `beforeAll`; all 15 test bodies were skipped
  because Testcontainers reported
  `Could not find a working container runtime strategy`.

### Final remediation gates

- Focused tests: passed, 5 files and 27 tests.
- `pnpm typecheck`: passed for all 10 checked workspace projects.
- `pnpm lint`: passed.
- `pnpm build`: passed for all 10 built workspace projects.
- Drizzle metadata check: passed.
- Drizzle final generation: `No schema changes, nothing to migrate`.
- `git diff --check`: passed.

## DB-clock transition timestamp P1 remediation

### RED

- Added a structural guard requiring one captured PostgreSQL
  `clock_timestamp()` inside the handoff transition trigger and explicit
  DB-clock SLA/future-time checks.
- Added real PostgreSQL rejection cases for early SLA escalation forged with
  a future `NEW.updated_at`, acknowledgement before assignment time,
  resolution before acknowledgement/escalation, and future assignment or
  acknowledgement timestamps.
- Command: `pnpm exec vitest run tests/repo/admin-workflow-guards.test.ts`.
- Result before implementation: 1 failed and 7 passed because the trigger did
  not capture an authoritative database transition time.

### GREEN

- `enforce_human_escalation_transition` captures exactly one
  `transition_now := clock_timestamp()` per trigger invocation.
- SLA eligibility now depends only on `transition_now` against the immutable
  acknowledgement deadline. A caller-supplied future `NEW.updated_at` cannot
  manufacture expiry.
- Every transition requires `NEW.updated_at >= OLD.updated_at` and
  `NEW.updated_at <= transition_now`. New acknowledgement and resolution
  timestamps are bounded by their prior transition, the new `updated_at`, and
  `transition_now`; prior transition timestamps remain immutable.
- Focused result: 5 files and 30 tests passed.
- PostgreSQL suite: 12 cases present; local execution remains BLOCKED in
  `beforeAll`, with all 12 bodies skipped because no working Testcontainers
  runtime is available.
- `pnpm typecheck`: passed for all 10 checked workspace projects.
- `pnpm lint`: passed.
- `pnpm build`: passed for all 10 built workspace projects.
- Drizzle metadata check: passed with `Everything's fine`.
- Drizzle generation: `No schema changes, nothing to migrate`.

## Database Gate run 30696624634 remediation

- GitHub Actions run `30696624634` executed commit `90972a0`. The catalog
  gate passed, then `Repeat message-ledger concurrency gate` failed before
  later gates could run.
- Twelve message-ledger cases passed. The ordering case alone failed with
  SQLSTATE `23514` because its old generic fixture directly inserted an
  `intro` package with 1 unit, a non-null expiry, and no consumed approval or
  requester-session provenance. Migration 0016 correctly rejected it.
- Direct `admin`/`intro` inserts elsewhere in DB-gate integration suites were
  reviewed. The remaining instances in `admin-approval.test.ts` deliberately
  exercise populated-migration preservation or negative constraint checks.
- The ordering case now creates its intro package through the production
  workflow: two distinct current entitlement-admin sessions, approval
  request, distinct approval, and
  `PostgresAdminRepository.grantIntroPackage`. The result is a legitimate
  100-unit, no-expiry intro grant with immutable approval/session provenance.
- Direct fixtures in that case are now hardcoded to `paid`; the original
  assertion that paid ordering wins before intro remains unchanged.
- TDD structural guard RED: 1 of 1 failed. GREEN: 1 of 1 passed.
- Focused repository gates: 4 files and 17 tests passed.
- `pnpm typecheck`: passed for all 10 checked workspace projects.
- `pnpm lint`: passed.
- The 13-case PostgreSQL suite was attempted locally, but all bodies were
  skipped because no working Testcontainers runtime was available. CI remains
  the authoritative behavioral rerun.
- Build was not repeated because this remediation changes integration/support
  test code only; no production or schema file changed.

## Database Gate run 30696960145 timestamp assertion remediation

- GitHub Actions run `30696960145` executed commit `3ca1367`. Schema,
  catalog, message-ledger, and feedback gates passed. Five of six admin IAM
  cases passed; the populated 0012 upgrade alone failed because the raw
  PostgreSQL result returned `timestamptz` as a string while the test required
  a JavaScript `Date` instance.
- The inert legacy intro fixture now uses the fixed expiry
  `2036-08-10T00:00:00Z`. The preservation query asserts database booleans for
  exact timestamp equality and the separate admin-null case, avoiding any
  dependency on driver timestamp representation.
- Existing assertions for row identity, units, kind, legacy status, approval
  and requester-session provenance, source reference, and ledger delta remain
  intact. A narrow scan found no other raw timestamp `Date` matcher in this
  upgrade suite.
- TDD structural guard RED: 1 of 1 failed. GREEN: 1 of 1 passed.
- Focused repository gates: 5 files and 18 tests passed.
- `pnpm typecheck`: passed for all 10 checked workspace projects.
- `pnpm lint`: passed.
- The six-case PostgreSQL suite was attempted locally, but all bodies were
  skipped because no working Testcontainers runtime was available. CI remains
  the authoritative behavioral rerun.
- Build was not repeated because this remediation changes test/report files
  only; no production or schema file changed.

## Database Gate run 30697327313 prepared-statement remediation

- GitHub Actions run `30697327313` executed commit `8fb5980`. All pre-admin
  gates and the admin IAM gate passed. The atomic admin workflow suite ran all
  12 cases: 6 passed and 6 failed.
- Every failure shared SQLSTATE `42601`, `cannot insert multiple commands into
  a prepared statement`. The failures originated from test setup rather than
  production or migration SQL.
- A full-file structural scan found four multi-command prepared templates:
  safety-alert seeding, the role swap, the final safety setup, and the final
  feedback setup. They contained 10 commands total and now execute as 10
  ordered single-command prepared calls, preserving parent-before-child and
  insert-before-delete setup semantics.
- The regression guard counts top-level commands while excluding quoted SQL
  strings and dollar-quoted function bodies; it is not a blanket semicolon
  prohibition. RED found all four templates; GREEN found none.
- Focused repository gates: 4 files and 11 tests passed.
- `pnpm typecheck`: passed for all 10 checked workspace projects.
- `pnpm lint`: passed.
- The 12-case PostgreSQL suite was attempted locally, but all bodies were
  skipped because no working Testcontainers runtime was available. CI remains
  the authoritative behavioral rerun.
- Build was not repeated because this remediation changes test/report files
  only; no production or schema file changed.

## Database Gate run 30697656518 adapter-assertion remediation

- GitHub Actions run `30697656518` executed commit `79556ee`. Every pre-admin
  gate and the admin IAM gate passed. The atomic admin suite ran all 12 cases:
  8 passed and 4 failed after the relevant triggers and workflows executed.
- The four failures were test-adapter mismatches. Drizzle exposes direct
  trigger failures as a `Failed query` wrapper, while 10 direct handoff checks
  matched only the inner message. Raw PostgreSQL timestamps in two state
  assertions were strings, while the test required JavaScript `Date` objects.
- All 10 direct handoff rejection checks now use the existing bounded,
  cycle-safe cause-chain assertion through a local async helper. Each check
  requires exact SQLSTATE `P0001` and the exact trigger message without
  stringifying the wrapper, cause, or SQL.
- Both state queries now project `acknowledged_at is not null` and
  `resolved_at is not null` as booleans. Assertions for IDs, statuses,
  versions, action counts, and feedback state remain unchanged.
- TDD adapter guard RED: 2 of 2 failed. GREEN: 2 of 2 passed. A narrow scan
  found no remaining direct inner-message handoff check, `expect.any(Date)`,
  or `Date | null` assertion type in `admin-ledger.test.ts`.
- Focused repository/support gates: 4 files and 13 tests passed.
- `pnpm typecheck`: passed for all 10 checked workspace projects.
- `pnpm lint`: passed.
- The 12-case PostgreSQL suite was attempted locally, but all bodies were
  skipped because no working Testcontainers runtime was available. CI remains
  the authoritative behavioral rerun.
- Build was not repeated because this remediation changes test/report files
  only; no production or schema file changed.
