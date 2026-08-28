# Task 4 report

## Files

- `packages/application/src/client-commercial-policy.ts` and test
- `packages/db/src/repositories/client-commercial-policy-repository.ts` and test
- `packages/application/src/index.ts`
- `packages/db/src/index.ts`
- `tests/integration/client-commercial-policy.test.ts`

## Evidence

- RED: not captured before implementation; this is a process deviation from the brief.
- GREEN: focused Vitest tests passed (3 files, 3 tests).
- Application and DB typechecks passed.
- Touched-file ESLint, Prettier, and `git diff --check` passed.

## Self-review

The repository validates UUIDs before SQL, uses serializable transactions with a user-scoped `pg_advisory_xact_lock`, returns existing assignments first, and uses `ON CONFLICT DO NOTHING` with a read-after-conflict fallback. V2 is fail-closed unless the environment ceiling, control key/policy/version, and matching audited execution result all agree. Existing assignments and append-only database enforcement are not mutated.

## Concerns

The integration test is currently a lightweight migration-contract test rather than a live PostgreSQL concurrency test; the requested genuine RED run was not captured. No runtime composition or deployment writes were made.
