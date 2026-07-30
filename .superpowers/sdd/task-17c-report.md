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
