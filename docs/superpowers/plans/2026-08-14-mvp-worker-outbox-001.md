# MVP-WORKER-OUTBOX-001 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` task-by-task. Apply test-driven development and
> request independent review before the final Claw gate.

**Goal:** Make the existing fenced outbox runner production-reachable for exactly
the two local operator-case topics, default-off and without provider activation.

**Architecture:** Parsed config selects exactly one owner. Disabled mode preserves
the merged legacy materializer. Enabled mode lazily builds a typed two-topic
registry, gives its literal tuple to every outbox claim/recovery/exhaustion query,
and uses idempotent local case mutation plus durable reconciliation. The canonical
contract is
`_bmad-output/specs/spec-mvp-worker-outbox-001/SPEC.md` with `CONTRACTS.md` and
the feature architecture spine.

**Tech Stack:** TypeScript, PostgreSQL, Drizzle, Vitest, OpenTelemetry API.

## Global constraints

- Implementation base: exact current `origin/main` at execution time; rebase and
  preserve any intervening config/runtime/schema changes before code work.
- Requirements `WORKER-OUTBOX-001-R1` through `R13` are mandatory.
- No migration, provider topic/import/credential, production action, GitHub
  Actions, image build or prune.
- One final focused Claw run after local GREEN and independent review; do not
  repeat a passing suite.

### Task 1: Default-off configuration and fail-closed composition

**Files:**

- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Modify: `.env.example`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/main.test.ts`

**TDD acceptance:** R1, R2, R9.

- [ ] RED: assert absent/false parses to `features.workerOutboxDelivery=false`,
  true parses true, and invalid values fail.
- [ ] RED: assert false never invokes the registry factory; true invokes it once;
  true with missing/incomplete factory rejects before DB repository claims; a
  prebuilt registry cannot bypass false.
- [ ] GREEN: add the exact default-false config and examples, then implement the
  config-derived lazy factory seam with the bounded capability error.
- [ ] REFACTOR: keep direct worker startup free of tokens, URLs and provider
  capabilities.

### Task 2: Closed registry and exact local decoders

**Files:**

- Create: `packages/worker/src/local-operator-case-outbox.ts`
- Create: `packages/worker/src/local-operator-case-outbox.test.ts`
- Modify: `packages/worker/src/index.ts`

**TDD acceptance:** R3, R5, R6, R7, R11.

- [ ] RED: test both exact payloads, every missing/extra/type/range/UUID/hash/
  policy violation, and dispatch rejection for an unregistered topic.
- [ ] RED: prove feedback payload values never authorize stored rating/hash/
  policy and that a well-formed mismatch cannot suppress the authoritative case;
  repository output wins. Prove no handler input contains amount, URL, recipient
  or provider operation ID.
- [ ] GREEN: implement the readonly topic tuple, registry completeness check,
  strict decoders and handler adapters.
- [ ] REFACTOR: export the smallest typed registry/factory surface; do not export
  a mutable registration API.

### Task 3: Allowlisted fenced outbox repository

**Files:**

- Modify: `packages/db/src/repositories/outbox-repository.ts`
- Modify: `packages/db/src/repositories/outbox-repository.test.ts`
- Modify: `tests/integration/outbox-repository.test.ts`

**TDD acceptance:** R4, R8, R10, R12.

- [ ] RED: mix both local topics with a pending, retry, unknown, processing,
  reconciling and exhausted provider-topic row. Assert only registered rows are
  claimed, recovered or terminalized.
- [ ] RED: empty, duplicate and unknown allowlists fail before SQL. Assert claim
  tokens still fence every state transition.
- [ ] RED: extend reconciliation with a typed terminal result and prove it writes
  one dead letter plus one bounded delivery-failure case under the reconciliation
  token; it never returns to retry.
- [ ] GREEN: thread the validated tuple through normal/unknown claims, both
  pre-claim exhaustion queries and both lease-recovery queries. Preserve current
  ordering, limits, clock use and fencing.
- [ ] REFACTOR: centralize the SQL topic predicate; do not interpolate unchecked
  strings.

### Task 4: Idempotent local mutation and durable inspection

**Files:**

- Create: `packages/db/src/repositories/operator-case-outbox-repository.ts`
- Create: `packages/db/src/repositories/operator-case-outbox-repository.test.ts`
- Modify: `packages/db/src/index.ts`
- Test: `tests/integration/operator-case-outbox-delivery.test.ts`

**TDD acceptance:** R5, R6, R7, R8.

- [ ] RED: real PostgreSQL proves concurrent safety/feedback dispatch produces
  one case per outbox ID and never writes payload/source identifiers.
- [ ] RED: safety delivery requires a matching authoritative handoff ID/version
  in escalated state; missing/mismatched local source is terminal.
- [ ] RED: simulate mutation success followed by acknowledgement failure; durable
  inspection returns applied and the next reconciliation succeeds without a
  second case.
- [ ] RED: syntactically valid missing/ineligible feedback produces the existing
  bounded `negative_feedback_source_invalid` delivery-failure case; structural
  poison and unrecoverable invariants return terminal closed reasons.
- [ ] GREEN: implement `materialize` and `inspect` using source outbox ID as the
  idempotency key and authoritative feedback projection.
- [ ] REFACTOR: share the case-row projection with the legacy batch only when that
  does not change disabled SQL behavior; otherwise leave legacy code byte-stable.

### Task 5: Exclusive production runtime and bounded metrics

**Files:**

- Modify: `packages/worker/src/outbox-runner.ts`
- Modify: `packages/worker/src/outbox-runner.test.ts`
- Modify: `apps/worker/src/runtime.ts`
- Modify: `apps/worker/src/runtime.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `packages/observability/src/metrics.ts`
- Modify: `packages/observability/src/metrics.test.ts`

**TDD acceptance:** R2, R8, R9, R10, R11.

- [ ] RED: disabled cycle invokes legacy once and generic zero times; enabled
  cycle invokes generic once and legacy zero times. Enabled recovery is performed
  only inside the filtered runner, not by the standalone unfiltered job.
- [ ] RED: applied, retry, unknown, terminal, exhausted and lease-recovery paths
  emit only the closed metric vocabulary. Assert no ID, payload, hash, policy,
  correlation/reconciliation key or exception text appears in attributes/logs.
- [ ] GREEN: compose registry dispatcher/reconciler/repository/metrics into
  `runOutboxBatch`; map its result into `confirmedOutboxDelivery` without changing
  the public worker-cycle shape.
- [ ] REFACTOR: preserve non-overlapping cycles and shutdown behavior.

### Task 6: Scope guards, review and one final gate

**Files:**

- Create: `tests/repo/worker-outbox-delivery-boundaries.test.ts`
- Modify: `tests/repo/env-policy.test.ts`
- Modify: `docs/spec/mvp-worker-outbox-001-traceability.md`
- Modify: `docs/spec/mvp-worker-outbox-001-progress.md`
- Create: `docs/test-evidence/claw/<code-sha>-mvp-worker-outbox-001/verification.md`

- [ ] Assert the registry literal set has exactly two local topics, provider
  imports/topics are absent, no migration was added and examples remain false.
- [ ] Run affected unit/repository/runtime/config tests locally once, plus the
  single real-PostgreSQL integration file once.
- [ ] Commit code and obtain independent adversarial review; resolve every
  Critical/Important finding and re-review exact HEAD.
- [ ] Run one final focused Claw gate after GREEN. If it passes, do not repeat it.
  Record exact SHA/counts/duration/cleanup and distinguish local/static evidence.
- [ ] Update traceability and ledger from `planned` to evidence-backed statuses;
  do not claim provider activation, live telemetry export, staging or production.
- [ ] Exercise the controlled rollback contract in a repository/runtime test:
  drain/reconcile registered in-flight rows before switching false; emergency
  false leaves durable unknown rows paused rather than mutating them unsafely.
