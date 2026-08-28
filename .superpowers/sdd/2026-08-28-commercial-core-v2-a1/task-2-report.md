# Task 2 report

Status: complete locally; commit created below.

## Files changed

- `packages/db/migrations/0032_commercial_core_v2_a1.sql`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/src/schema/commercial-policy.ts`
- `packages/db/src/schema/expert-residency.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/index.ts`
- `packages/db/src/testkit/postgres.ts`
- `tests/integration/commercial-core-v2-migration.test.ts`

The migration adds audited policy controls, append-only policy assignments, policy/cap/entitlement snapshots, legacy defaults, V2 cap enforcement, money conservation, and journal entry 32. No seed or approved offer was added.

## Evidence

- Genuine RED: the first focused run failed both tests because the new columns/tables were absent. The intended insert reached PostgreSQL SQLSTATE `42703` (`commercial_policy_version` did not exist).
- GREEN: `/tmp/ii-tonya-corepack.FN4Qho/pnpm exec vitest run tests/integration/commercial-core-v2-migration.test.ts` — 2 tests passed.
- Migration compatibility: `/tmp/ii-tonya-corepack.FN4Qho/pnpm exec vitest run tests/integration/yookassa-migration-upgrade.test.ts` — 1 test passed.
- Typecheck: `/tmp/ii-tonya-corepack.FN4Qho/pnpm --filter @ii-tonya/db exec tsc --noEmit` — passed.
- Formatting: Prettier run on all touched TypeScript/JSON files.
- Diff hygiene: `git diff --check` — passed.

## Self-review

SQL and Drizzle expose matching text policy/entitlement values and defaults. The order cap uses basis-point arithmetic, V2 requires 3000 bps, limits and entitlement values are checked, and cash plus credit equals price. Assignment UPDATE/DELETE triggers are installed before testkit cleanup, and cleanup truncates assignments before their user dependency.

## Concerns

The repository worktree does not contain `scripts/grok_status.py` or `scripts/grok_verify.py`, so those adaptive-delivery checks could not be run from this worktree. The focused migration test verifies the schema contract and rejection path; it does not insert a fully foreign-key-backed legacy tariff/order fixture.
