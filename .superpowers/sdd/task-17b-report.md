# Task 17B IAM and approval lifecycle report

## Scope delivered

- Added additive migration `0015_admin_iam.sql` and a coherent Drizzle
  snapshot for platform admin sessions, explicit role assignments, explicit
  safety/feedback object assignments, approval lifecycle checks, and approval
  nonce uniqueness that does not depend on nullable `approver_id`.
- Added `PostgresAdminApprovalRepository`. Its public commands accept platform
  session hashes, never actor/requester/approver IDs. PostgreSQL resolves the
  authenticated identities and authoritative clock.
- MFA is accepted only when it is not in the future and no more than 15
  minutes old according to `clock_timestamp()`. Session expiry, revocation,
  current role assignments, stored session/MFA bindings, action, object type,
  object ID, canonical payload SHA-256, nonce, distinct identities, unused
  state, and five-minute expiry are checked in the persisted lifecycle.
- Approval consumption is one conditional `UPDATE ... RETURNING`; concurrent
  executions can consume a bound approval at most once.
- Canonical payload serialization rejects unsupported values and sorts every
  object level before hashing. Raw payloads are not stored in approvals.
- Existing domain/admin mutation routes and `AdminService` remain
  unregistered and fail closed. No grants, revokes, catalog changes,
  discounts, notification operations, credentials, or live bindings were
  added.

## TDD evidence

### RED

- Command:
  `pnpm exec vitest run packages/db/src/repositories/admin-approval-repository.test.ts`
- Result: failed before implementation because
  `admin-approval-repository.js` did not exist. This established the canonical
  payload/hash contract before production code.
- The behavioral PostgreSQL test was authored for server session resolution,
  stale/future MFA, role checks, requester/approver separation, five-minute
  expiry, forged ID, action/object/payload/nonce changes, concurrent consume,
  consumed nonce replay, object assignment, and populated-0012 migration.

### GREEN

- Command:
  `pnpm exec vitest run packages/db/src/repositories/admin-approval-repository.test.ts`
- Result: 1 file, 2 tests passed.
- Command:
  `pnpm exec vitest run packages/db/src/repositories/admin-approval-repository.test.ts tests/repo/db-schema-parity.test.ts packages/application/src/admin-service.test.ts apps/api/src/routes/admin.test.ts tests/integration/admin-ledger.test.ts`
- Result: 5 files, 19 tests passed. The application/API/admin repository
  fail-closed tests remain green.

## PostgreSQL behavioral authority

- Command: `pnpm exec vitest run tests/integration/admin-approval.test.ts`
- Local result: blocked in `beforeAll` before all five test bodies with
  `Could not find a working container runtime strategy`.
- This is not counted as a passing PostgreSQL gate. The suite is connected to
  `.github/workflows/db-gate.yml` as `Run admin approval IAM gate`.
- The suite includes a fresh populated-0012 database, applies 0013, 0014, and
  0015, and verifies that the legacy approval survives while `approved_at`,
  payload binding, and repaired nonce uniqueness are installed.

## Static and build gates

- `pnpm typecheck`: passed for all 10 workspace projects.
- `pnpm lint`: passed.
- `pnpm build`: passed for the 10 built workspace projects.
- `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`:
  passed with `Everything's fine`.
- `pnpm exec drizzle-kit generate --name task17b_final_no_diff --config
  packages/db/drizzle.config.ts`: reported `No schema changes, nothing to
  migrate`.
- `git diff --check`: passed.

## Remaining boundary

- PostgreSQL behavior still requires the GitHub DB gate because the local
  machine has no working Testcontainers runtime.
- Task 17C/17D must compose approval consume, exact domain mutation, and allow
  audit in one database transaction before any admin mutation route can be
  registered.
