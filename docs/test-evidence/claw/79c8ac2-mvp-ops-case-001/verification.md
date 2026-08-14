# MVP-OPS-CASE-001 Claw verification

Date: 2026-08-14

Status: **GREEN for the focused operator-case inbox scope.** This evidence is
not staging or production authorization.

## Candidate identity

- Branch: `codex/mvp-ops-case-001`
- Base: `caf0a931e399fccbfc41d521c48b2bfcd4889211`
- Final tested code revision: `79c8ac224dc2a21ad2902d5cf7dc64afab7c183c`
- Environment: retained Claw test container and the existing app-stack
  PostgreSQL, using direct `/seed` binaries and no dependency install.

## Build and focused gate

The initial broad focused command at `d77c5a9` completed its direct build
closure, then exposed four failures. Green files were not repeated. The
failure/remediation chain was:

1. Three test-contract defects: an explicit `null` fixture was collapsed to a
   default principal, a substring assertion matched `case_reason_code`, and a
   sorted Drizzle name expectation had the wrong order. At `a66a7d9`, the
   targeted route/boundary/parity command passed **3/3 files and 17/17 tests**.
2. PostgreSQL migration setup rejected a future-dated legacy fixture because
   the new default `updated_at` preceded `created_at`. Migration `0028` now
  performs a monotonic `greatest(updated_at, created_at)` backfill before its
   lifecycle CHECK. The first real-PostgreSQL test then passed and was not
   repeated after later changes outside that worker/materialization path.
3. The second PostgreSQL test exposed a real query defect: binding a JavaScript
   array produced a PostgreSQL record that could not cast to `text[]`. Both
   role-filtered queries now build a validated, parameterized
   `array[$1,...]::text[]` through Drizzle `sql.join`.
4. The driver returned `timestamptz` projections as strings. The repository now
   validates and normalizes every projected timestamp to `Date`, including the
   timestamp bound into the transition audit.
5. Targeted `-t` execution exposed hidden fixture order and clock dependencies.
   The pagination test now idempotently materializes its own pending sources
   and uses one explicit past UTC timeline with `created_at = updated_at` for
   the newest delivery case.

At exact final revision `79c8ac2`, the controller reran only the previously
failing PostgreSQL test name:

- `paginates role-scoped unresolved cases and audits first transitions only`:
  **1/1 passed**;
- duration: **3.00 seconds**; test execution: **77 ms**;
- the other PostgreSQL test was deliberately skipped because it was already
  green after the migration fix and no later commit changed its exercised
  worker/materialization path.

The resulting focused evidence is therefore green without repeating already
green suites. Local compile-only closure also passed for all affected packages;
after the repository remediations, database and API ESM/declaration builds were
green.

## Review

Independent adversarial review first found two Important issues: malformed or
orphan feedback could starve a bounded batch, and constraining the shared legacy
`reason_code` would break arbitrary existing/future delivery alerts. Both were
fixed by deterministic privacy-safe quarantine cases and a separate bounded
`case_reason_code` projection. Every later production/test remediation received
an exact-revision re-review. Final review at `79c8ac2` is **APPROVED**, with no
Critical or Important finding.

## Cleanup and release boundary

After the final command, remote `/workspace/source` was restored to exact base
`caf0a931`; feature files, generated build outputs and controller archives were
removed. No Vitest process remained, and the retained container stayed Up.

No `pnpm install`, repeated green suite, GitHub Actions, image build, image
prune, external notifier, live provider call, staging, production, push or merge
was performed. Release/deployment authorization remains a separate human
checkpoint.
