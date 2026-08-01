# Task 19 report: expiry, reconciliation, and safety-independent workers

## Scope completed

- Added bounded reservation-expiry orchestration behind one narrow
  `expireDueBatch` transaction port. The port contract requires PostgreSQL
  `FOR UPDATE SKIP LOCKED`, expected-version fencing, the state transition,
  audit, and all three stable versioned free outbox effects to be committed in
  the same batch transaction.
- Added bounded provider reconciliation with exact mismatch reports, a
  provider-unavailable circuit path, safe projection-delivery-only repairs,
  and an operator alert transaction port. The worker never exposes a method
  that can mutate authoritative reservation state from a provider observation.
- Added bounded safety handoff processing behind one atomic transaction port.
  The safety dependency surface contains no Planerka or intent-model adapter;
  it fences owner/status/version and commits escalation audit plus the free
  dedicated operator effect together. Authenticated expected-version
  acknowledgement is a separate atomic command.
- Added typed job fixtures with state, free-effect, idempotency-key, alert,
  transition, circuit, and audit recorders.
- Added a safety-first `WorkerRuntime`. Every cycle runs safety SLA work,
  expired-lease recovery, unknown-outcome reconciliation, expiry, confirmed
  outbox delivery, privacy processing, and provider drift reconciliation in
  that order. `close()` stops new cycles, waits for the current bounded cycle,
  and closes database and telemetry resources once.
- Added an import-safe worker entrypoint with validated configuration, bounded
  poll and shutdown intervals, SIGTERM/SIGINT handling, a real PostgreSQL job
  repository/outbox composition, and database-pool teardown. No provider or
  secret was enabled; provider dispatch and privacy capabilities remain
  explicitly disabled.
- Added a PostgreSQL worker repository whose expiry and safety jobs each use
  one repository-owned transaction and one data-modifying CTE statement. DB
  clock eligibility, `FOR UPDATE SKIP LOCKED`, expected versions, state/audit,
  and free idempotent outbox effects stay inside that transaction boundary.
- Replaced the bootstrap-only app-worker manifest with dist-only package
  metadata, `main`/`types`, dual tsup entrypoints, and a real `start` command.
  The app barrel deliberately does not import `main`, preventing tsup from
  moving the direct-execution check into a shared chunk.

## TDD evidence

The prescribed tests were written before production code. The first RED run:

```text
pnpm exec vitest run packages/worker/src/reservation-expiry.test.ts packages/worker/src/reconciliation.test.ts packages/worker/src/safety-handoff.test.ts
# 3 failed suites; expected missing reservation-expiry.js, reconciliation.js,
# and safety-handoff.js modules; no tests collected
```

Runtime/import tests were also RED before their modules existed:

```text
pnpm exec vitest run apps/worker/src/runtime.test.ts apps/worker/src/main.test.ts
# 2 failed files; expected missing runtime.js and main.js modules
```

A later regression test reproduced abort-listener accumulation before the fix:

```text
pnpm exec vitest run apps/worker/src/main.test.ts
# 1 failed, 2 passed; observed 11 listeners where at most 1 was allowed
```

The final fresh non-container test command passed after the review fix waves:

```text
pnpm exec vitest run packages/worker/src apps/worker/src packages/db/src/repositories/worker-jobs-repository.test.ts tests/integration/outbox-runner.test.ts tests/repo/workspace-dependencies.test.ts tests/repo/scope-boundary.test.ts
# 11 files, 141 tests passed
```

## Verification

```text
pnpm typecheck
# all 10 runnable workspace projects passed

pnpm --filter @ii-tonya/app-worker build
# passed; emitted dist/main.js, dist/index.js, and declarations

pnpm lint
# passed

git diff --check
# passed
```

Artifact behavior was checked directly: importing `dist/main.js` exited 0 and
did not start the loop; executing `dist/main.js` with placeholder-only valid
configuration invoked `main()`, constructed the production runtime, attempted
the database job, and exited 1 against an intentionally unreachable test port.

## Required integration-command boundary

The exact required Task 19 Vitest command ran once. It produced 40 passing
tests across seven suites, including durable outbox and workspace dependency
ownership. `booking-concurrency.test.ts` could not start its test bodies because
Testcontainers reported `Could not find a working container runtime strategy`;
all 18 PostgreSQL cases were skipped and suite setup failed. No retry or fake
database substitute was used. GitHub Database Gate is required for the
authoritative PostgreSQL result.

## Remaining concerns

- Local PostgreSQL behavioral verification is unavailable until a container
  runtime is present; the GitHub Database Gate must verify the exact commit.
- Live provider dispatch, unknown-outcome provider reconciliation, and privacy
  processing stay disabled until their reviewed deployment capabilities are
  explicitly bound. DB-only safety, expiry, bounded lease recovery, and atomic
  delivery of safety escalation to the durable operator queue are composed.

## Independent review fix waves

- Replaced the unbound startup factory with real PostgreSQL worker/outbox
  composition while retaining disabled live providers.
- Added a 1,000-row hard cap for expiry, safety, reconciliation, and lease
  recovery batches.
- Made incomplete provider snapshots fail closed instead of silently omitting
  local reservations.
- Made SIGTERM/SIGINT race the active cycle and start bounded close immediately;
  current-cycle, database, and telemetry waits all have hard deadlines.
- Added DB acknowledgement fencing for owner, expected version, non-null
  acknowledgement state, deadline, authenticated session audit, and DB clock.
- Added `acknowledged_at is null` to the escalation transition fence.
- Added an atomic DB-only safety dispatcher that moves the dedicated safety
  topic into the durable operator queue and marks it delivered without using
  Planerka or the intent model.
- Disabled-provider production composition no longer emits one provider error
  row per poll cycle.

## Re-review closure

- Candidate ordering now prioritizes overdue, unacknowledged `assigned`
  handoffs (then `opened` handoffs) ahead of non-transitionable
  `acknowledged` rows, so historical acknowledgements cannot consume the
  bounded candidate window.
- The direct `main()` signal path arms a 30-second default hard-exit watchdog.
  The exit function and grace period are injectable for tests, the watchdog
  exits nonzero if shutdown never settles, and it is cleared after clean close.
- `runOutboxBatch()` and both PostgreSQL lease-recovery methods reject any
  non-integer, non-positive, or greater-than-1,000 batch before repository SQL.

The strict re-review RED command produced the expected 12 failures:

```text
pnpm exec vitest run packages/db/src/repositories/worker-jobs-repository.test.ts packages/db/src/repositories/outbox-repository.test.ts tests/integration/outbox-runner.test.ts apps/worker/src/main.test.ts
# 4 failed files; 12 failed, 17 passed
```

Final fresh verification after the fixes:

```text
pnpm exec vitest run packages/worker/src apps/worker/src packages/db/src/repositories/worker-jobs-repository.test.ts packages/db/src/repositories/outbox-repository.test.ts tests/integration/outbox-runner.test.ts tests/repo/workspace-dependencies.test.ts tests/repo/scope-boundary.test.ts
# 12 files, 154 tests passed

pnpm typecheck
# all 10 runnable workspace projects passed

pnpm --filter @ii-tonya/db build
# passed

pnpm --filter @ii-tonya/app-worker build
# passed

pnpm lint
# passed

git diff --check
# passed
```
