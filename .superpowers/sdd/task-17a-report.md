# Task 17A feedback transaction report

## RED

- Command: `pnpm exec vitest run packages/application/src/feedback-service.test.ts packages/application/src/admin-service.test.ts apps/api/src/routes/admin.test.ts tests/integration/feedback-transaction.test.ts`
- Result: failed as intended before implementation. The application attempted
  `deps.feedback.insertOnce` with no transaction gate, `feedback.read` returned
  `allow`, and unfinished admin methods resolved. The PostgreSQL suite reached
  Testcontainers and stopped at the local container-runtime boundary.

## GREEN

- Replaced split feedback insert/outbox/audit ports with a named
  `submitFeedbackTransaction` gate and `PostgresFeedbackRepository`.
- The transaction inserts one source event, stores only score/reference/hash/
  policy evidence, conditionally creates one free negative-feedback outbox
  record, and appends one immutable audit fact. Duplicate source events return
  their original result; a rollback leaves no dedupe record, so retry can make
  the entire effect.
- All incomplete admin application, API helper, and database paths now fail
  closed and are not re-exported from the application barrel. Read helpers do
  not confer assignment authorization.
- Command: `pnpm exec vitest run packages/application/src/feedback-service.test.ts packages/application/src/admin-service.test.ts apps/api/src/routes/admin.test.ts tests/integration/admin-ledger.test.ts`
- Result: 4 files, 11 tests passed.

## PostgreSQL behavioral coverage

- `tests/integration/feedback-transaction.test.ts` covers duplicate and
  concurrent duplicate behavior, forced outbox/audit failure rollback and
  retry, neutral scores 4/5, low scores 1–3, and explicit-negative score 4.
- Local command: `pnpm exec vitest run tests/integration/feedback-transaction.test.ts`
- Result: BLOCKED before test execution by Testcontainers: `Could not find a
  working container runtime strategy`. The feedback transaction gate is wired
  into CI; CI PostgreSQL remains the required behavioral authority.
- Schema parity/migration command: `pnpm exec vitest run
  tests/integration/schema.test.ts`.
- Result: the same Testcontainers boundary occurred before its six schema
  assertions; it was not treated as a passing local schema gate.

## Static gates

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`: passed.
- `git diff --check`: passed.

## Scope boundary

- No credentials or live bindings were added.
- No migration was needed: the existing additive feedback
  `source_event_id` uniqueness plus hash/policy/status fields and existing
  immutable audit/outbox schema support the concrete transaction.
