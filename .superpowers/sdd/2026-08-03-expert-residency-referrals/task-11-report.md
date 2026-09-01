# Task 11 implementation report

Status: `DONE`, pending independent task review.

Base: `a72e65f094132917c0a5739b55ea3cf458fc29fd`

Worktree: `.worktrees/task11-implementer` (`codex/task11-implementer`)

## Scope delivered

- Added three bounded worker jobs: expert residency expiry/release, provider-neutral reconciliation, and held-reward replay.
- Added `PostgresExpertReferralWorkerRepository` with `1..1000` validation, stable `FOR UPDATE SKIP LOCKED` claims, per-item failure isolation, database-clock expiry, bounded/fair reconciliation claims, immutable mismatch audit/outbox facts, and held replay delegated to the existing Task 7 transaction.
- Extracted the existing Task 5 expiry/release state machine into a transaction-scoped method so the worker claim owns the row lock while reusing the established financial transition.
- Added the three exact runtime report fields and sequential jobs without changing the pre-existing job order, single-cycle exclusion, shutdown deadline, heartbeat, or provider-disabled default.
- Production composition uses `PostgresExpertReferralWorkerRepository` plus `DisabledExpertResidencyPaymentAdapter`; it does not read either expert capability environment flag and introduces no maturity-worker flag.
- Added a private bounded-cardinality referral metric instrument. The only public write APIs validate exactly `module`, `operation`, `outcome`, and finite `errorCode` values; the raw instrument is not exported.
- No schema, migration, provider SDK, network client, credential, activation, deployment, route, or admin-action change.

## TDD evidence

### Required RED

Command:

`corepack pnpm vitest run packages/worker/src/expert-residency-expiry.test.ts packages/worker/src/expert-residency-reconciliation.test.ts packages/worker/src/expert-referral-hold-replay.test.ts packages/observability/src/metrics.test.ts apps/worker/src/runtime.test.ts`

Result: exit 1; 5/5 files failed, 8 failed / 2 passed. The three job modules and metric validator were absent, and runtime lacked all three jobs/report fields.

Repository RED: `packages/db/src/repositories/expert-referral-worker-repository.test.ts` failed to load because the repository module was absent.

Main composition RED: `apps/worker/src/main.test.ts` failed 1/8 because `composeProductionWorkerRuntime` was absent.

Reconciliation fairness RED: the emitted claim SQL lacked the bounded claim timestamp update, so a fixed oldest batch could starve later rows.

Metric hardening RED: 1/16 failed because the raw referral instrument was exported, allowing callers to bypass bounded-label validation.

### GREEN

- Required worker/metrics/runtime/main slice: 6 files, 28/28.
- New real PostgreSQL worker repository: 11/11, including exact database deadline and stable replay, one immutable verified-mismatch incident with zero repair, and skip-locked concurrency exactly three runs.
- Impacted Task 5–9 checkout, settlement, durable control, application, and admin suites: 9 files, 59/59.
- Deadline/refund/reversal/held-replay/provider-inbox/residency repository suites: 5 files, 24/24.
- Scope/env/dependency/release/workflow guards: 6 files, 175/175.
- Final metric hardening slice: 16/16; observability typecheck and exact-file ESLint passed.

The optional whole suite was intentionally not run in deadline mode. The known pre-Task10 provider-deadline fixture remains the recorded Task 12 carry and is not attributed to Task 11.

## Build and quality evidence

- All 10 workspace builds passed with `corepack pnpm --workspace-concurrency=1 -r --sort run build`.
- All 10 workspace typechecks passed with `corepack pnpm -r --sort run typecheck`; terminal marker: `TASK11_TYPECHECK_10_OF_10_OK`.
- Exact changed-TypeScript ESLint passed.
- All new files plus every changed file that was Prettier-clean at the base passed Prettier.
- Full changed-file Prettier reports only these five existing base failures: `apps/worker/src/main.ts`, `apps/worker/src/runtime.test.ts`, `apps/worker/src/runtime.ts`, `packages/observability/src/index.ts`, and `packages/observability/src/metrics.ts`. A byte comparison of each base file against Prettier output independently confirmed the same five failures at `a72e65f`; unrelated whole-file formatting was deliberately excluded to keep the protected runtime patch non-overlapping.
- `git diff --check` passed.
- The first `corepack pnpm build` wrapper attempt failed before build because its package script invoked an unavailable bare `pnpm` binary. The equivalent direct corepack recursive command above then completed all 10 builds; this was launcher environment, not a code failure.

## Security and operational notes

- Process `now` is validated/copied for scheduling only; PostgreSQL `transaction_timestamp()` and the established deadline function remain authoritative.
- Reconciliation calls the provider reader only after the short claim transaction has committed. Disabled provider returns a bounded explicit result; it never creates a mismatch or repair.
- A verified mismatch appends an idempotent outbox incident and immutable audit fact. It never changes order, attempt, reservation, ledger, reward, debt, or residency state.
- Held replay claims only `pending_feature_hold`, then the existing transaction re-locks the control/order/payment/identity/eligibility/residency/marker state. `cancelled_by_refund` never grants and the durable `reward_grants_enabled` check is not bypassed.
- No exception message, entity ID, payment ID, code/hash/suffix, free text, timestamp, URL, correlation key, idempotency key, or payload can enter referral metric labels.

## Protected shared edits

The implementation worktree was created at the exact reviewed base, so it never contained or depended on the shared dirty edits in `apps/worker/src/runtime.ts` and `packages/config/src/env.ts`. Before shared-branch advancement, their unstaged combined diff must still hash to `6a35fa28ff123c84a00dff5b1427c256e4f0c525`, and the protected staged diff must remain empty.
