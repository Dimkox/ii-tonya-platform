# Task 3 report — approved sandbox admin transitions

## Status

DONE. Implemented with Backend Architect then Security Engineer perspectives. No push,
deployment, production mutation, or production smoke occurred.

## Commits

- `55430cd` — RED tests
- `49e4cb5` — approval-bound transactional workflow
- `566c23b` — migration-journal test isolation
- `d73e2a2` — formatting

Base: `7b8f9de9943b2e7b31e8e6f5345aa7d0a34f2cb1`.

## Delivered

- Added exactly `expert_residency.sandbox_settle` and
  `expert_residency.sandbox_refund`, both requiring `entitlement_admin`.
- Added transaction-handle approval consume/replay methods.
- Added `SandboxTransitionWorkflow`; approval consume/replay, locked payment mutation,
  command/event creation, and one immutable allowed audit execute in one serializable DB
  transaction.
- Bound approval to canonical payment ID, transition, expected version, idempotency key,
  requester session, nonce, action, object type and deterministic UUID projection of the
  opaque sandbox payment ID.
- Identical consumed replay returns the committed event; mismatches deny without consuming.
- Sandbox code does not write normal financial authority relations.

## Claw evidence

All executable tests ran in the existing constrained Claw `ii-tonya-test` environment
with 1 CPU / 1 GiB. Exact image:
`ii-tonya-test:7d71646347d560ff2b5d8ebc4c0aad5b48230254`
(`sha256:a8f8d4bb072b4ef94f5cdf36a077a3be158bc314282c37fe026ffbe468746cb8`).

### RED

Exact source `55430cd`: focused command exited 1. The new role assertion received
`undefined`; the new workflow suite was absent. Existing admin guards were 8/8 green and
existing approval assertions were 3/3 green. A preceding wrong-network preparation
attempt executed no tests and is excluded.

### GREEN

Exact behavior source `566c23b`:

- focused three-file gate: 3 files / 20 tests passed;
- workflow: 7/7 passed;
- approval mapping: 4/4 passed;
- structural admin guards: 9/9 passed.

Three bounded workflow repetitions passed: 21/21 tests total. No repeat count exceeded
three. One intermediate behavior run exposed a test-only Drizzle migration journal reset
defect after `public` schema recreation; `566c23b` drops the journal schema before each
case and the full gate then passed.

Exact final source `d73e2a2`: Prettier PASS, ESLint PASS, `git diff --check` PASS.
No local executable test was run.

## Files changed

- `packages/db/src/repositories/admin-approval-repository.ts`
- `packages/db/src/repositories/admin-approval-repository.test.ts`
- `packages/sandbox-payments/src/repository.ts`
- `packages/sandbox-payments/src/workflow.ts`
- `packages/sandbox-payments/src/workflow.test.ts`
- `packages/sandbox-payments/src/index.ts`
- `tests/repo/admin-workflow-guards.test.ts`
- `tests/repo/support/payment-scope-boundary-core.ts`

## Self-review

- Approval is never consumed outside the transition transaction.
- A transition conflict rolls back approval consumption and audit/event writes.
- Concurrent identical execution produces one transition/event/audit and one replay.
- Mismatched payment, version, action/transition, idempotency key or session fails closed.
- No provider SDK, network call, credential access, production enablement or normal
  financial-table mutation was introduced.

## Cleanup

Final matching test containers: `0`. Isolated extracted source directories used for RED,
GREEN, and static checks were removed. The persistent Claw source and production database
were not modified. The test database helper created and removed dedicated databases.

## Independent-review remediation

Additional commits:

- `e49a93c` — executable RED cases for correlation IDs, approval failure modes,
  rollback, refund, and invalid runtime actions.
- `59a43e6` — remove the UUID audit cast, reject unknown actions before DB access,
  correct refund approval binding, and repair expiry/self-approval fixtures.
- `b7d3de8` — preserve approval lifecycle ordering in the expired fixture.

The causal Claw RED reached 12 workflow tests: 4 failed and 8 passed. It reproduced the
non-UUID audit failure, invalid-action DB execution, and refund binding defect; executable
self-approval and rollback cases already passed. The expiry fixture initially violated an
existing lifecycle constraint and was corrected by moving all lifecycle timestamps.

Exact post-fix source `b7d3de8` reused the already prepared offline Claw workspace without
installing dependencies. Focused GREEN passed 3 files / 25 tests (workflow 12/12,
approval 4/4, guards 9/9). The workflow then passed exactly three bounded repetitions:
36/36 tests. Prettier and ESLint passed. This run proves non-UUID correlation audit,
self-approval denial, expiry, wrong nonce, conflicting consumed replay, transactional
rollback, approved refund, and fail-closed runtime-invalid action behavior.
