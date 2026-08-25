# Task 6 report — provider-neutral residency settlement

## Status

DONE_WITH_CONCERNS. The Task 6 implementation, focused tests, schema upgrade tests,
static checks, and build are green. The one permitted full-suite run exposed two
Task 6 compatibility regressions that were subsequently fixed and verified in
focused runs. It also hit one unrelated `catalog-repository.test.ts` PostgreSQL
startup hook timeout under full parallel load; that test was not changed.

## Implementation

- Added strict provider-neutral Zod contracts for canonical settled events,
  checkout commands/outcomes, verification evidence, identifiers, integer minor
  units, ISO currency, UTC timestamps, and SHA-256 digests.
- Added provider-neutral payment/verifier ports and disabled production adapters.
  There is no provider SDK, network call, credential/environment access, live
  webhook route, or provider composition.
- Added a runtime verified-event boundary backed by a module-private `unique
  symbol` and `WeakSet`. The package's production exports expose only the guard,
  required verified type, and disabled verifier; the constructor is reachable
  only as a direct test fixture module and is tree-shaken from production output.
- Added one serializable PostgreSQL settlement transaction covering inbox claim,
  replay validation, order/payment locks, DB deadline decision, reservation
  terminal and immutable allocation copy, eligibility/control/referral locks,
  serialized residency, first-settlement marker, reward/debt facts, audit,
  outbox, and durable success/failure outcome.
- Enforced exact amount, currency, order/payment identity, provider deadline,
  authenticated evidence, stable identical replay, and fail-closed conflicting
  replay. Equality at the DB deadline expires/releases and does not settle.
- Added durable verification columns and a safe 0021 migration. Existing inbox
  rows are retained but downgraded to `authenticated=false` and receive bounded
  `legacy-unverified:<inbox UUID>` evidence before the columns become NOT NULL.
- Added the DB-to-integrations workspace dependency and a Vitest-only source alias
  so tests share the same private verifier singleton without exposing a production
  fixture export.

## TDD evidence

Initial required RED:

```text
corepack pnpm vitest run tests/contract/expert-residency-payment-port.test.ts tests/integration/expert-residency-settlement.test.ts tests/integration/expert-residency-settlement-concurrency.test.ts
exit 1 — 3 suites failed because verified-event and provider-inbox modules did not exist
```

First GREEN boundary slice:

```text
corepack pnpm vitest run packages/integrations/src/expert-residency/verified-event.test.ts packages/integrations/src/expert-residency/disabled-payment-adapter.test.ts tests/contract/expert-residency-payment-port.test.ts
exit 0 — 3 files, 8 tests passed
```

Primary focused GREEN after implementation and final durability fix:

```text
corepack pnpm vitest run packages/integrations/src/expert-residency/verified-event.test.ts packages/integrations/src/expert-residency/disabled-payment-adapter.test.ts packages/db/src/repositories/expert-residency-provider-inbox-repository.test.ts tests/contract/expert-residency-payment-port.test.ts tests/integration/expert-residency-settlement.test.ts tests/integration/expert-residency-settlement-concurrency.test.ts
exit 0 — 6 files, 16 tests passed
```

Concurrency repeat (capped at exactly three as requested):

```text
task6_shims=$(mktemp -d); corepack enable --install-directory "$task6_shims"; PATH="$task6_shims:$PATH" corepack pnpm test:repeat -- 3 tests/integration/expert-residency-settlement-concurrency.test.ts
exit 0 — three separate runs passed, 1/1 test in each run
```

Later regression RED/GREEN evidence:

```text
corepack pnpm vitest run tests/integration/expert-residency-settlement.test.ts -t 'durably records a verified payment identity mismatch'
RED: exit 1 — failed inbox row was undefined because the transaction rolled back
GREEN: exit 0 — 1 passed, 5 skipped

corepack pnpm vitest run tests/integration/expert-residency-provider-deadline-upgrade.test.ts
RED: exit 1 — ADD verification_id NOT NULL failed on a legacy inbox row
GREEN after backfill: exit 0 — 1 passed

corepack pnpm vitest run tests/integration/expert-residency-provider-deadline-upgrade.test.ts
RED: exit 1 — legacy verification ID was unbounded when based on external_event_id
GREEN after UUID sentinel: exit 0 — 1 passed
```

Compatibility/guard GREEN:

```text
corepack pnpm vitest run tests/repo/db-schema-parity.test.ts tests/repo/scope-boundary.test.ts
exit 0 — 2 files, 115 tests passed

corepack pnpm vitest run tests/repo/db-schema-parity.test.ts tests/repo/scope-boundary.test.ts tests/repo/workspace-dependencies.test.ts tests/integration/expert-referral-schema.test.ts
exit 0 — 4 files, 145 tests passed

corepack pnpm vitest run tests/integration/expert-referral-schema.test.ts tests/integration/expert-residency-provider-deadline-upgrade.test.ts
exit 0 — 2 files, 15 tests passed
```

## Package/full checks

```text
PATH=<corepack-shim> pnpm exec eslint . --ignore-pattern '.worktrees/**'
exit 0 — no Task 6 lint errors

PATH=<corepack-shim> pnpm typecheck
exit 0 — 10/10 workspace projects

PATH=<corepack-shim> pnpm build
exit 0 — 10/10 workspace projects, ESM and DTS outputs built
```

The single full test run was:

```text
PATH=<corepack-shim> pnpm test
exit 1 — 98 files: 95 passed, 3 failed; 814 tests passed, 2 failed, 1 skipped
```

Two failures were Task 6 upgrade-fixture incompatibilities: the legacy schema
fixture omitted new evidence and the 0019 upgrade test expected 21 rather than 22
migrations. Both were fixed and their focused runs are green above. The third
failed file was an unrelated `catalog-repository.test.ts` 10-second `beforeAll`
timeout while many Testcontainers suites ran concurrently; its test was skipped
after setup failed and cleanup then observed an undefined handle. Per the user's
"full runs once" constraint, the full suite was not repeated.

## Files

- `packages/contracts/src/expert-residency.ts`, `packages/contracts/src/index.ts`
- `packages/integrations/src/expert-residency/*`, `packages/integrations/src/index.ts`
- `packages/db/src/repositories/expert-residency-provider-inbox-repository*`
- `packages/db/src/schema/expert-residency.ts`, `packages/db/src/index.ts`
- `packages/db/migrations/0021_expert-residency-verification-evidence.sql`
- `packages/db/migrations/meta/0021_snapshot.json`, `packages/db/migrations/meta/_journal.json`
- `packages/db/package.json`, `pnpm-lock.yaml`, `vitest.config.ts`
- `tests/contract/expert-residency-payment-port.test.ts`
- `tests/integration/expert-residency-settlement*.test.ts`
- `tests/integration/expert-referral-schema.test.ts`
- `tests/integration/expert-residency-provider-deadline-upgrade.test.ts`
- `tests/repo/db-schema-parity.test.ts`, `tests/repo/scope-boundary.test.ts`
- `tests/repo/support/payment-scope-boundary.ts`
- `tests/repo/workspace-dependencies.test.ts`

## Self-review

- Confirmed production output contains neither `verifiedEventFixture` nor its
  construction errors and public production exports cannot manufacture the
  private brand.
- Confirmed settlement production files contain no `fetch`, environment reads,
  credentials, provider SDKs, raw body, or raw payload storage.
- Confirmed all payment/inbox/order/residency/reward/audit/outbox changes occur
  under one serializable transaction using database time and locks.
- Confirmed raw events are rejected before inbox claim; verified failures are
  committed as bounded digests/evidence and thrown only after commit.
- Confirmed `git diff --check` is clean and unrelated existing dirty/untracked
  files are excluded from the Task 6 stage set.

## Concerns

- The full-suite catalog Testcontainers setup timeout remains unrelated and
  unreproduced in focused Task 6/schema runs. Raw `eslint .` also sees unrelated
  untracked `.worktrees/**`; the scoped lint run excludes only that pre-existing
  directory and is green.
