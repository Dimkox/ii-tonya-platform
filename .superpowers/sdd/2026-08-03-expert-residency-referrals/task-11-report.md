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

## Independent-review remediation — DB ownership and full projection

Worktree: `.worktrees/task11-fix1` (`codex/task11-fix1`), base `17a0dd22b11d`.

- Reconciliation claims now use a five-minute database lease and an exact `(attemptId, providerPaymentId, claimedAt)` compare-and-set owner check. Stale owners fail with `reconciliation_claim_lost`; an expired lease becomes claimable again.
- Held replay now owns the control and order locks for the complete bounded batch and delegates each item through a nested savepoint to the existing transaction-scoped Task 7 state machine. A poisoned item cannot abort later items, and locks are released after the batch.
- Reconciliation now locks and compares the order/payment row plus bounded projections for provider identity/state, active reservation/spend, first-settlement reward grant, allocation-derived ledger balance, over-repaid debt, and residency activation. The only mismatch codes are the seven finite literals in the repository. A digest-bound immutable incident/audit pair is inserted once; retry performs no correction.

### Remediation RED/GREEN

- Lease/CAS and transaction-owned held replay RED/GREEN were captured before this projection slice.
- Full projection RED: `17 tests`, `5 failed / 12 passed`; independent corruption probes initially exposed the absent projection contract plus two fixture-proof issues (immutable snapshot protection and the lease timestamp being intentionally mutable).
- Full real-PostgreSQL projection GREEN: provider state, reservation, reward grant, ledger allocation, debt, and residency activation each emitted exactly one bounded mismatch code, one incident/audit pair after retry, and changed no financial fields.
- Provider identity classification is separately exercised at the locked-row boundary and passed `1/1`, asserting the exact serialized incident fragment `"mismatchCodes":["provider_identity"]`.
- Worker repository non-concurrency slice passed `7/7`. The earlier required concurrency evidence remains exactly three runs; it was not expanded to twenty.
- All ten workspace builds passed after rebuilding barrels in dependency order. All ten workspace typechecks then passed; the earlier direct DB typecheck before rebuilding dependent barrels failed only on unavailable workspace package declarations and was superseded by this reproducible build-then-typecheck gate.
- Changed-file ESLint passed. Prettier passed for the worker repository, its test, and the held-replay integration test; the deliberately minimal transaction extraction in the provider inbox retains its pre-existing formatting. `git diff --check` passed.

### Protected shared bytes at remediation handoff

At shared HEAD `17a0dd22b11d`, the protected worktree blobs are:

- `apps/worker/src/runtime.ts`: `635c08dc84443b1a16cf4ed986d946ca0d8e4b81`
- `packages/config/src/env.ts`: `89c8cecb24079b66707a0187d9fe85a5784e4896`

Their corresponding HEAD blobs are `f64f9c0d0a4301553a0689c6be67627614358529` and `0a34abc369702778ec90398fdf9b4ac62de04ee0`. The protected staged diff is empty (`sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`). The combined unstaged diff hash at this newer HEAD is `sha256:b4ff0464a597ddc42ac78a6212434e65f53ca8a6d184320438e5b2acc5ae1aa8`; the earlier `6a35…` value was diff-relative to the pre-Task-11 runtime base, so content-blob hashes are the reproducible cross-base proof.

## Integrated metric remediation and final fix gate

Commits integrated after the DB remediation:

- `97f401f3` — DB lease/CAS, stable locked projection, transaction-owned held replay, and DB report evidence.
- `1a7edb59` — production-boundary financial lifecycle metrics from the independently verified metric worktree.

### Metric TDD evidence

- RED: the production-boundary OpenTelemetry test failed `1/1`; the collected operation set was empty while all 14 approved finite lifecycle categories were required from the real application/admin/worker functions.
- GREEN: the independent metric gate passed 12 focused files / 110 tests, plus TypeScript, ESLint, and diff checks. The in-memory OpenTelemetry production test observes batch/code lifecycle, redemption, first-payment qualification, reward, bonus share, credit spend/expiry, debt, duplicate, held replay, refund/reversal, and reconciliation matched/mismatch emissions. Every observed point has exactly `module`, `operation`, `outcome`, and `errorCode`; entity IDs, plaintext/code suffixes, payloads, reasons, URLs, and exception text are absent.

### Integrated verification

- Application, worker, observability, runtime/main, and repository guard batch: 16 files passed; the initial integrated run was `250 passed / 1 failed` because the recursive scope guard had not yet approved the two exact new `@ii-tonya/observability` workspace edges or refreshed their manifest hashes.
- The scope guard was narrowed to only `packages/application/package.json` and `packages/worker/package.json`, with exact current SHA-256 pins. Its focused rerun passed `112/112`.
- Real PostgreSQL reconciliation selection passed `3/3`: immutable incident/no repair, clean locked match/no incident, and stale-owner rejection with expired-lease recovery.
- Real PostgreSQL held replay selection passed `3/3`: disabled-to-re-enabled grant, poisoned-item isolation/lock recovery, and refund serialization. The planned concurrency ownership tests remain capped at the already recorded three runs and were not rerun in the integrated gate.
- Dependency-ordered workspace builds passed `10/10`, followed by workspace typechecks `10/10`.
- Exact changed-TypeScript ESLint passed. Every changed file that was Prettier-clean at the base remains clean. The excluded failures are existing baseline formatting in the minimally extracted provider-inbox body, `packages/observability/src/metrics.ts`, the two compact workspace manifests, and `pnpm-lock.yaml`; no unrelated formatting rewrite was included. `git diff --check 17a0dd22b11d` passed.

## Independent-review remediation round 2 — stable projection and replay fairness

Base: `ae0561f27afeee44a97d720dcf7f96ffbc2f4f39`

DB commit: `53ffdb7ea254a327279ddca81d4b73045dcdece3`

- Reconciliation now takes separate statements in the established order: feature control, order, exact attempt lease/CAS, first-settlement marker, referral, reward grants, ledger entries, allocations, and residency rows. The complete projection runs in a new READ COMMITTED statement after those locks, so a waiter cannot report an incident from the snapshot that preceded a committed terminal transition.
- Provider identity now requires both the attempt-side and order-side provider/payment identifiers. Reservation validation independently proves reservation, terminal, and per-grant allocation totals. Reward validation requires the exact marker/referral/inviter/order binding and reward ledger fact. Allocation completeness covers all seven balance-affecting kinds, including reversal and debt repayment; debt validation proves reversal/reward bindings, allocated debt position, and the repayment bound. Residency validation independently proves the exact quoted duration.
- Held replay uses `expert_residency_orders.updated_at` as a durable schema-free cursor. The cursor update is in the outer control/order claim transaction and outside the per-item savepoint, so `batchSize=1` advances past both `still_held` and poisoned outcomes while preserving retry visibility and the Task 7 financial transaction.
- The worker reconciliation candidate contract now requires and forwards `claimedAt`; the exact database repository lease remains mandatory and was not weakened for test fixtures.

### Round-2 RED/GREEN evidence

- RED: worker typecheck failed with `TS2353` because `claimedAt` was absent from the worker candidate interface. Real PostgreSQL fairness failed `2/2`: the second `batchSize=1` call selected the same oldest still-held/poisoned marker. The projection returned `matched` for seven independent corruptions: order provider, order provider payment ID, terminal/reservation total, reward binding, reversal allocation, debt-repayment allocation, and debt source/binding. The exact-duration probe required a deliberately dropped/re-added `NOT VALID` test constraint because the normal write-time check correctly rejects that corruption.
- GREEN: the independent projection matrix passed `8/8`, the clean locked projection passed, and the fresh-statement terminal-transition lock-wait race passed `1/1` with zero false incident. The affected worker repository gate passed `26/26`; the already exhausted three old skip-locked concurrency repetitions were selected out. Worker reconciliation passed `5/5`. Real PostgreSQL held replay passed `3/3`, including the two new fairness cases.
- Every mismatch remains one of seven finite codes. Each corruption retry produced one idempotent incident/audit pair and no corrective financial mutation.

### Integrated telemetry and final gate

- Integrated effect-based telemetry commit `ad3f885` (source `cb842d6e9e66fa530409048893dfb9b4d8210133`). Three telemetry test candidates were updated with the now-authoritative `claimedAt` lease; production interfaces were not weakened.
- Integrated focused/application/worker/observability/scope guard gate: 11 files, `85/85` tests.
- Integrated real PostgreSQL repository gate: `26/26`, with only the exhausted old concurrency repetitions skipped. Integrated held-replay affected gate: `3/3`.
- Dependency-ordered builds passed `10/10`. The first integrated typecheck exposed the third new telemetry fixture missing `claimedAt`; after correcting that fixture, dependency-ordered typechecks passed `10/10`.
- Exact changed-TypeScript ESLint, changed-file Prettier, and `git diff --check` passed. No migration, schema, flag, live provider, credential, or network change was introduced.

## Independent-review remediation round 3 — debt bindings and authoritative effects

Base: `7099734f6a159de7d0c8c0d4f2a789a3a65438f2`

Integrated commits:

- `32aeca6` — DB projection and authoritative expiry count (source `ec3be7c3de19b46314eee8c92858ad32d13a58a4`).
- `6fe5a8f` — typed authoritative financial facts and effect-derived telemetry (source `01900a8b53f589aca63da0afc2f9f89c2d750ed9`).

### Round-3 RED/GREEN

- RED: `creditChanged` was absent for a released reservation and for both bounded zero/nonzero unit outcomes. A structurally consistent reward with corrupted amount or one-second lifetime drift incorrectly matched. A production-shaped debt repayment bound to an old reversal but funded by a new same-inviter reward grant incorrectly emitted a debt mismatch, while two old-source/source-allocation corruptions incorrectly matched.
- GREEN: targeted DB remediation passed `8/8`; the complete affected worker repository slice passed `31/31`. The three previously exhausted skip-locked repetitions and the already isolated snapshot-race test were explicitly excluded.
- Debt projection now keeps `original_entry_id` bound to the old reversal while requiring repayment `source_id` and its sole allocation to bind the new same-account reward grant. Aggregate repayments remain bounded by the reversed amount. Reward projection independently enforces `100000` minor units and exactly `31536000` seconds.
- Expiry batches now return required `creditChanged`, incremented only for `kind = expired` with `released = true`; cash-only order expiry remains `changed = 1`, `creditChanged = 0`.
- Application and provider boundaries now return typed immutable financial facts. Telemetry is derived only from those authoritative facts, including exact zero-value negative cases; it is not inferred from order/result labels.

### Round-3 integrated gate

- Application/worker/observability/runtime/API/scope guards: 8 files, `64/64`.
- Real PostgreSQL projection/debt/expiry repository: `31/31` with exhausted races excluded.
- Real PostgreSQL authoritative facts: checkout `1/1`, held replay `2/2`, refund/reversal/debt `3/3`, settlement/debt/expiry `5/5`.
- Dependency-ordered workspace builds passed `10/10`; workspace typechecks passed `10/10`. Fresh worktrees must build dependency barrels before Vitest/typecheck can resolve workspace package exports.
- The known provider-deadline fixture remains the recorded Task 12 carry. It was deliberately not selected and is not attributed to Task 11.
- No schema, migration, feature flag, live provider, credential, network, or deployment change was introduced.
