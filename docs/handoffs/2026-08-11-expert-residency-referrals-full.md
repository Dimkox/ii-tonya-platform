# Full handoff — expert residency referrals and project release state

Date: 2026-08-11
Status: corrected focused PostgreSQL E2E green; aggregate and hosted release evidence still open
Repository: `Dimkox/ii-tonya-platform`
Feature branch: `codex/task25-expert-referral-implementation`
Draft PR: `#4` — `Codex/task25 expert referral implementation`

## 2026-08-14 authoritative release correction

This section supersedes every later reference in this historical handoff to GitHub
Actions, release workflows, application images, or production Compose:

- YooKassa by YooMoney is the selected provider; T-Bank is not a target provider.
- GitHub Actions are not used. GitHub stores Git history and pull requests only.
- CI, Database Gate, and release assembly run directly on Claw through
  `scripts/run-claw-ci.sh`, with committed exact-SHA evidence.
- Claw runs a constrained test container that imitates the dedicated server.
- Production is container-free: native API/worker systemd services, system PostgreSQL,
  nginx/TLS, immutable release directories, atomic `current` symlink, and native rollback.
- `docs/runbooks/native-production-deployment.md` is the current deployment runbook.

This handoff supersedes the continuation instructions in
`docs/handoffs/2026-08-04-expert-residency-referrals.md` for Tasks 10–12. The older
handoff remains historical evidence for Tasks 1–9 and the clean-machine bootstrap.

## 2026-08-13 sandbox payment continuation checkpoint

Branch `codex/sandbox-payment-provider` adds a separate test-only sandbox API and
payment package. It does not add a live provider and must not enter the production
API/worker closure. The complete original source remains at
`docs/source/ii-tonya-expert-full-source-2026-07-28.txt` (SHA-256
`0439AE1C645E6FDA46F013A66512401F251AA18D35520F5C9A7A3C7C59314EAF`); the sandbox
design supplements rather than replaces it.

At documentation base `7214ae93a04e99993b190dfd881c34bd1eced22a`, Tasks 1–4 are
approved, Task 5 is conditional, and Task 6 code/config is independently approved.
Offline pnpm hydration timed out after 480s and 240s under Claw's 1 CPU/1 GiB limit.
Cleanup returned zero containers/processes and the reserved production smoke was not
used. No sandbox image exists; `SBX-TST-009`, packaged isolation/inventory, scans, SBOM,
signing, provenance, and final exact-SHA gates remain unrun.

Continue from `docs/runbooks/sandbox-payment-provider.md` and
`docs/test-evidence/claw/sandbox-payment-provider-20260813/verification.md`. Complete the
pinned offline store, build the immutable sandbox image, then run the sandbox lifecycle.
Only after it passes may production image smoke run once. Never exceed three repeats,
populate credential placeholders, connect providers, merge, stage, or deploy from this
checkpoint. Provider staging is `BLOCKED`; production is `NO-GO`.

## 1. Exact repository checkpoint

Functional/code checkpoint immediately before this handoff document was committed:

- feature HEAD: `9cf5f1974d66b96ea23596e19e3d977551d3cfc7`
- current `main` synchronized into the feature branch: `d3707e2b97c702a1aa2021d2e69b68c9002e6476`
- PR #4 state at that checkpoint: open, Draft, mergeable
- PR #4 size at that checkpoint: 164 commits, 163 changed files
- PR #4 must remain Draft until the verification sequence in this handoff is complete

Always resolve the actual current HEAD before doing anything:

```bash
git status --short
git remote get-url origin
git branch --show-current
git rev-parse HEAD
gh pr view 4 --repo Dimkox/ii-tonya-platform
```

Expected branch:

```text
codex/task25-expert-referral-implementation
```

Do not force-push, rewrite history, delete the branch, or squash away diagnostic
history while release evidence is incomplete.

## 2. Source of truth and governing documents

Read these first, in this order:

1. `AGENTS.md`
2. `docs/handoffs/environment-manifest.md`
3. `docs/agents/expert-residency-team.md`
4. `docs/spec/normalized-requirements.md`
5. `docs/superpowers/specs/2026-08-02-expert-residency-referrals-design.md`
6. `docs/superpowers/plans/2026-08-03-expert-residency-referrals.md`
7. `docs/spec/expert-residency-referrals-traceability.md`
8. `docs/architecture/project-connectivity-graph.md`
9. `docs/architecture/project-connectivity-inventory.md`
10. `docs/runbooks/expert-residency-referrals.md`
11. `docs/runbooks/expert-residency-referrals-rollback.md`
12. `docs/security/expert-residency-referrals-go-live-gates.md`
13. this handoff

Authoritative product snapshot:

- `docs/source/ii-tonya-expert-full-source-2026-07-28.txt`
- SHA-256:
  `0439AE1C645E6FDA46F013A66512401F251AA18D35520F5C9A7A3C7C59314EAF`
- original Google Doc ID: `14AWYM9jbE0OPU3rKY6_PpPl3REDaqQbISdMB4D2mpUc`

The source document is audit input. It is not executable Make configuration and does
not override the normalized requirements, security boundaries, or database invariants.

## 3. Non-negotiable product contract

The expert referral program is a separate bounded context from client coupons.

Rules that must not change without a new approved design:

- Expert referral codes and client coupons do not share tables, balances, namespaces,
  redemption paths, or runtime authority.
- The inviter receives exactly `100000` kopecks (1,000 RUB) only after the referred
  expert's first eligible authoritative residency settlement.
- Every reward grant expires exactly 365 days after grant.
- Referral credit may cover at most 50% of an expert residency tariff.
- Credit is allocated FIFO by grant expiry.
- All monetary values are integer minor units; no floating point financial values.
- PostgreSQL transactions own binding, quote reservation, settlement, expiry,
  reversal, debt, hold/replay, idempotency, and reconciliation facts.
- LLM output, prompts, Telegram rendering, Make, Sheets, provider payloads, and client
  input have no financial authority.
- Plaintext expert codes are returned once after approved issuance. Persistent storage
  contains irreversible/versioned lookup material and masked inventory only.
- Self-referral, code reuse, inviter replacement, double redemption, double reward,
  over-50% credit, negative spendable credit, stale settlement, and unsafe replay fail
  closed.
- A terminating refund/chargeback reverses the referral reward exactly once. Historical
  spend remains historical; spent reversed reward becomes debt.
- Debt blocks spendable referral credit and future rewards repay debt before producing
  spendable credit.
- The kill switch blocks new issuance/redemption/checkout/reward creation but must not
  block verified settlement/refund processing, expiry, reconciliation, reversal, debt,
  or controlled held-reward resolution for existing state.

## 4. Feature and provider activation state

The branch is not authorized for live expert-residency payments or production referral
activation.

Required defaults remain:

```text
EXPERT_REFERRAL_ENABLED=false
EXPERT_RESIDENCY_BILLING_ENABLED=false
PAYMENTS_ENABLED=false
PAYMENT_PROVIDER=disabled
```

The production worker composes an explicitly disabled expert-residency provider reader.
No live payment-provider SDK/network adapter was added by Tasks 1–12.

Do not enable these flags merely because unit/integration tests pass.

## 5. Current architecture

### 5.1 Composition roots

- `apps/api` — HTTP/webhook/admin/expert API composition.
- `apps/worker` — bounded polling lifecycle and worker composition.
- `packages/application` — deterministic authorization/application services and prompt
  boundary.
- `packages/domain` — pure referral and residency calculation/invariant logic.
- `packages/contracts` — provider-neutral schemas/contracts.
- `packages/db` — PostgreSQL repositories, migrations, immutable financial facts,
  controls, settlement/reversal logic, and worker repository.
- `packages/integrations` — Telegram and provider-neutral/disabled integration
  boundaries.
- `packages/worker` — bounded job orchestration.
- `packages/observability` — low-cardinality metrics/logging/tracing.
- `packages/config` — environment and feature policy.

### 5.2 Canonical connectivity graph

The repository now contains a full connected architecture inventory:

- `docs/architecture/project-connectivity-graph.md`
- `docs/architecture/project-connectivity-inventory.md`

The graph includes runtime, PostgreSQL, tests, migrations, CI, deployment, native server
control, documentation/evidence, disabled boundaries, deferred product areas,
historical artifacts, and dead/orphan candidates.

Classification labels:

- `ACTIVE`
- `ACTIVE OPS`
- `DISABLED`
- `TEST-ONLY`
- `EVIDENCE`
- `DEFERRED`
- `PROHIBITED`
- `LEGACY/HISTORICAL`
- `ORPHAN-CANDIDATE`

Non-runtime/dead/deferred entities are not omitted. They connect to the architecture
audit cluster with a reason for retention or review.

At the latest graph pass:

- workspace package orphans: none known
- composition-root orphans: none known
- known expert-referral/residency orphan modules: none known
- native server-control assets from the historical `main` snapshot are retained as
  `LEGACY/HISTORICAL`; both entry workflows now refuse deployment

### 5.3 Native server control from current main

Current `main` added an operational control plane that is now merged into this feature
branch:

- `.github/workflows/server-control.yml`
- `.github/workflows/server-native.yml`
- `ops/server-command.sh`
- `scripts/bootstrap-native-runner.sh`

These are retained operational history, not product/financial authority. The two
workflows are fail-closed refusal paths; `ops/server-command.sh` is not workflow-reachable.
They remain in the architecture graph and exact tracked-automation scope pinning.

Important consequence: after a future merge to `main`, the native deployment workflow
may run on the self-hosted `ii-tonya-server` runner. Do not merge PR #4 merely to obtain
CI evidence. Merge only after the gates in this handoff are complete.

## 6. Task status — expert residency referrals extension

### Tasks 1–9 — complete and previously verified

Tasks 1–9 are complete:

1. Repository and scope boundaries.
2. Domain rules and provider-neutral contracts.
3. PostgreSQL schema/migrations/invariants.
4. Referral code lifecycle.
5. Quote/checkout accounting.
6. Provider-neutral settlement.
7. Refund/reversal/holds/debt.
8. Disabled-by-default services, feature controls, keyring/environment policy.
9. Admin workflows, dual-approved overrides, masked inventory, immutable replay.

Stable Task 9 hosted evidence:

- CI run `30865251809` — PASS
- Database Gate run `30865251814` — PASS

### Task 10 — implemented and focused-verified

Implemented:

- `apps/api/src/routes/expert-referral.ts`
- expert redeem/summary/quote/checkout HTTP boundary
- fresh expert-principal resolution and service-level ownership reauthorization
- strict request schemas that reject client-supplied price, balance, credit, expert ID,
  inviter, provider payload, settlement/payment authority
- `packages/application/src/expert-prompt-context.ts`
- separate `ExpertIntentProposal` boundary rather than widening the client Selarti
  intent union
- malicious prompt fixtures `llm-05` through `llm-09`
- typed validation for redeem, summary, quote, and checkout proposals
- Telegram referral summary and residency quote rendering using server-provided values
- callback binding to expert, operation, object, nonce hash, and expiry
- callback payload byte-length hardening
- Task 10 API/Telegram/prompt/callback tests

Focused verification on `claw` at
`a5aa6c99564ba60a96464b8baa1cdac69f56e4a9`:

```text
Test Files  6 passed (6)
Tests       78 passed (78)
@ii-tonya/application typecheck PASS
@ii-tonya/integrations typecheck PASS
@ii-tonya/api typecheck PASS
```

Task 10 is the last task with a fully green recorded focused gate in PR discussion.

### Task 11 — implementation present; final verification not yet recorded green

Implemented:

- `packages/worker/src/expert-residency-expiry.ts`
- `packages/worker/src/expert-residency-reconciliation.ts`
- `packages/worker/src/expert-referral-hold-replay.ts`
- `packages/db/src/repositories/expert-referral-worker-repository.ts`
- worker lifecycle wiring in `apps/worker/src/runtime.ts`
- production disabled provider reader in `apps/worker/src/main.ts`
- low-cardinality expert referral/residency telemetry in
  `packages/observability/src/metrics.ts`
- focused worker/runtime/repository/telemetry tests

Design properties:

- bounded batches (`1..1000`)
- PostgreSQL deadline authority for expiry
- `FOR UPDATE SKIP LOCKED` candidate scans where applicable
- serializable/idempotent financial recheck delegated to existing repositories
- reconciliation records hashed mismatch evidence rather than placing payment/expert IDs
  in telemetry labels
- live provider reader remains disabled
- worker graceful-shutdown/single-cycle semantics preserved
- held-replay reporting was corrected so retryable `gate_closed` state is not mislabeled
  as cancellation

Task 11 must not be marked complete until the current branch has a green focused run or
final `pnpm verify` evidence.

### Task 12 — implementation present; release verification not complete

Implemented:

- real-PostgreSQL release-candidate E2E:
  `tests/e2e/expert-residency-referral.test.ts`
- ERR-FR-001..042 traceability:
  `docs/spec/expert-residency-referrals-traceability.md`
- operational runbook:
  `docs/runbooks/expert-residency-referrals.md`
- rollback runbook:
  `docs/runbooks/expert-residency-referrals-rollback.md`
- security/go-live addendum:
  `docs/security/expert-residency-referrals-go-live-gates.md`
- release-readiness/env/architecture/workspace/workflow/scope guards
- expert-residency schema parity and three-run database gates in
  `.github/workflows/db-gate.yml`
- exact workflow scope pinning through
  `tests/repo/support/payment-scope-boundary.ts`
- full-project connectivity graph and inventory

Database Gate now registers CI-only repeated gates for:

- referral redemption concurrency
- residency checkout concurrency
- residency settlement concurrency
- exact payment deadline behavior
- held reward replay

Do not run any repeat suite more than three times. `AGENTS.md` and the repeat runner
enforce the same hard limit in every environment.

## 7. Last local verification result and exact unresolved test

The latest combined Task 11/12 focused command on `claw` reached:

```text
Test Files  1 failed | 13 passed (14)
Tests       1 failed | 159 passed (160)
```

The only failure was the new release-candidate E2E fixture. It attempted to mutate an
order to:

```sql
payment_deadline = transaction_timestamp() - interval '1 second'
```

PostgreSQL correctly rejected that fixture with:

```text
constraint: expert_order_deadline_after_creation
SQLSTATE: 23514
```

This was a test-fixture error, not a schema defect. The database invariant is correct:
`payment_deadline > created_at`.

The fixture was fixed in commit:

```text
f65061b3ceb34a17ffc7d347c6f9f38d7306e047
```

The fixed fixture sets an expired deadline that remains valid relative to order creation
instead of bypassing the database invariant.

The fixed E2E was rerun against current exact source
`c560cbb65e105e1aaeb8d86f544ff95cfd218346` on Claw in a constrained container:

```text
Test Files  1 passed (1)
Tests       1 passed (1)
```

Committed evidence:
`docs/test-evidence/claw/c560cbb65e105e1aaeb8d86f544ff95cfd218346/verification.md`.
This closes the fixture-specific blocker only; it is not aggregate or hosted release
evidence.

## 8. Hosted GitHub Actions state

GitHub-hosted CI has an infrastructure/account/runner-start problem independent of code.
Multiple recent runs terminate before any job step begins.

At current code HEAD `c560cbb65e105e1aaeb8d86f544ff95cfd218346`:

- Database Gate run `31501254926`
  - job `93811519791`
  - conclusion: failure
  - `steps: null`
  - no job log
- CI run `31501254868`
  - job `93811519205`
  - conclusion: failure
  - `steps: null`
  - no job log

Earlier Task 10/11 attempts showed the same pre-step behavior. Do not interpret these as
application test failures. Conversely, do not interpret them as PASS evidence either.

Hosted CI and Database Gate remain required release evidence once runner execution is
restored.

## 9. Main synchronization history

Important ancestry syncs performed without force-push:

- PR #5 — synchronized the then-current `main` into the Task 25 branch and resolved the
  `AGENTS.md` ancestry conflict.
- PR #7 — technical Task 12 Database Gate + exact scope-pin update.
- PR #8 — synchronized the newer `main` containing native server control/self-hosted
  runner automation into the feature branch.

Latest synchronized `main` SHA:

```text
d3707e2b97c702a1aa2021d2e69b68c9002e6476
```

After PR #8 and graph refresh, PR #4 returned to `mergeable=true`.

## 10. Exact resume sequence on claw

Known working checkout used during recent verification:

```text
/tmp/ii-tonya-task10
```

First update to the exact latest feature branch:

```bash
cd /tmp/ii-tonya-task10 && git fetch origin && git checkout codex/task25-expert-referral-implementation && git pull --ff-only && git rev-parse HEAD
```

### Step A — completed: rerun only the previously failing fixed E2E

Do this first. Do not immediately rerun all 160 focused tests.

```bash
corepack pnpm --workspace-concurrency=1 -r --sort run build && corepack pnpm exec vitest run tests/e2e/expert-residency-referral.test.ts
```

Result: PASS at `c560cbb65e105e1aaeb8d86f544ff95cfd218346`. No repeat gate was run.

### Step B — final repository verification

If Step A is green, this is now a branch-finish/final-task boundary, so a single full
verification is appropriate:

```bash
corepack pnpm verify
```

Do not run `pnpm verify` repeatedly in a loop. If it fails, isolate the failing test or
package, fix it, run that focused check, then perform one final full verify after the fix.

### Step C — optional explicit package typechecks if the full verify output is ambiguous

Only if needed:

```bash
corepack pnpm --filter @ii-tonya/db typecheck && corepack pnpm --filter @ii-tonya/worker typecheck && corepack pnpm --filter @ii-tonya/observability typecheck && corepack pnpm --filter @ii-tonya/app-worker typecheck && corepack pnpm --filter @ii-tonya/application typecheck && corepack pnpm --filter @ii-tonya/integrations typecheck && corepack pnpm --filter @ii-tonya/api typecheck
```

### Step D — hosted gates

Once the runner/account issue is fixed, require both current exact-SHA workflows to run
steps and pass:

- `.github/workflows/ci.yml`
- `.github/workflows/db-gate.yml`

A zero-step failure is not sufficient evidence in either direction.

## 11. Final human/release evidence still required

Before marking Tasks 11–12 and PR #4 complete:

- fixed release-candidate E2E green on current source — PASS at `c560cbb65e105e1aaeb8d86f544ff95cfd218346`
- one final `pnpm verify` green on current source
- hosted CI PASS on the exact candidate SHA
- hosted Database Gate PASS on the exact candidate SHA, including registered 3x expert
  concurrency/deadline/replay gates
- independent migration/schema review
- independent financial state-machine review for settlement/refund/reversal/debt/hold
  paths
- Task 10 prompt/adversarial evidence retained for `llm-05..09`
- named human spot-check of expert prompt context and typed proposal boundary
- traceability matrix updated with exact evidence identifiers rather than only
  registration/pending wording
- release record remains NO-GO until staging authorization is explicit

Only after those are satisfied should PR #4 be considered for Ready-for-review or merge.

## 12. Known review risks / design deviations to preserve consciously

### 12.1 Expert intent isolation

The implementation intentionally keeps expert proposals separate from the existing
client `IntentProposal` union:

- client Selarti intent handling remains client-only
- expert intents use a separate `ExpertIntentProposal` and validator

This deviates from the illustrative Task 10 plan snippet that showed a widened union, but
it prevents expert financial commands from becoming valid client-channel proposals.
Do not naively merge these unions to match the snippet.

### 12.2 Checkout proposal vs HTTP service shape

The typed expert proposal uses a server order identity for checkout initiation while the
current HTTP/application checkout service is tariff-version based. If a future review
requires one model, inspect the actual order lifecycle before changing it. Do not add a
client-supplied amount or arbitrary object ID to bridge the mismatch.

### 12.3 Prompt context display name

`ExpertPromptContext` may include a bounded optional `displayName`. Financial and provider
internals are manually whitelisted/excluded. If further prompt hardening removes
`displayName`, preserve the read-only server-derived architecture.

### 12.4 Telegram masked code status

Telegram view values are bounded server data and no arithmetic occurs in the adapter.
If stronger masking validation is added, reject full plaintext expert codes rather than
attempting to mask them in the Telegram layer.

### 12.5 Integrations public index is a guarded boundary

`packages/integrations/src/index.ts` is covered by strict scope-content protection.
Do not casually add exports. Review scope policy and intended public capability before
changing it.

### 12.6 Expert API composition

Task 10 created the expert referral route builder and tests. Any additional wiring into
server composition must preserve disabled defaults and must not create a live-provider
path as a side effect.

### 12.7 Hosted CI problem

Do not change application code solely to make a zero-step GitHub Actions failure appear
green. Diagnose account/runner/Actions execution separately.

## 13. Security and scope guards

The repository deliberately fails closed around payment/commercial scope.

Relevant guards:

- `tests/repo/scope-boundary.test.ts`
- `tests/repo/expert-referral-scope-guards.test.ts`
- `tests/repo/expert-residency-release-readiness.test.ts`
- `tests/repo/architecture-boundaries.test.ts`
- `tests/repo/env-policy.test.ts`
- `tests/repo/workflow-semantics.test.ts`
- `tests/repo/db-schema-parity.test.ts`
- `tests/repo/support/payment-scope-boundary.ts`
- `tests/repo/support/payment-scope-boundary-core.ts`

The Task 12 scope wrapper preserves the previous reviewed core and provides exact tracked
content approval for the new Database Gate and synchronized native operational automation.
Do not weaken recursive tracked-file inspection to make a new executable file pass.
Approve the exact reviewed artifact or redesign the boundary.

## 14. PostgreSQL financial authority map

The most important expert-residency relations include:

- `expert_referral_code_batches`
- `expert_referral_codes`
- `expert_referrals`
- `expert_residency_tariff_versions`
- `expert_residency_orders`
- `expert_residency_payment_attempts`
- `expert_residency_provider_event_inbox`
- `expert_first_residency_settlements`
- `expert_referral_reward_grants`
- `expert_referral_ledger_entries`
- `expert_referral_ledger_allocations`
- `expert_referral_issuance_overrides`
- `expert_referral_abuse_holds`
- `expert_referral_feature_controls`
- `expert_referral_balances`
- `expert_referral_admin_execution_results`

Important database invariants include:

- one invitee referral binding
- one reward per qualifying referral/settlement/payment identity
- exact 100000-kopek reward grant
- exact 365-day grant expiry
- max 50% credit
- exact cash remainder
- explicit RUB currency
- payment deadline after order creation
- settlement before payment deadline
- immutable/append-only financial provenance
- held first-settlement state transitions only through approved monotonic terminal paths
- replay/idempotency constraints

Never bypass these constraints in fixtures with trigger/replication tricks unless the test
is explicitly testing historical corruption/recovery behavior and documents why.

## 15. Observability contract

Expert referral/residency metrics are intentionally low-cardinality.

Do not label metrics with:

- expert ID
- user ID
- order ID
- payment ID
- referral code
- provider payload
- arbitrary error strings

Use bounded module/operation/outcome/error-code dimensions only. Detailed incident
identity belongs in authorized database/audit evidence, not metric labels.

## 16. Operations and rollback

Operational instructions:

- `docs/runbooks/expert-residency-referrals.md`
- `docs/runbooks/expert-residency-referrals-rollback.md`
- `docs/operations/reconciliation.md`

Immediate containment for a referral/residency financial incident:

1. disable new expert referral commands/reward creation through the approved feature
   control/kill switch
2. keep verified existing callback/refund/reversal/reconciliation/expiry processing alive
3. capture exact SHA, feature-control version, affected object IDs, provider-event IDs,
   and database evidence
4. do not mutate ledger history in place
5. append compensating/reversal facts through approved services only
6. reconcile before re-enable
7. require new approval evidence before returning the feature to active state

A code rollback does not erase or rewrite committed financial facts.

## 17. Deployment boundary

Do not deploy/merge merely because implementation Tasks 1–12 exist.

Current feature state is pre-release. Live activation requires explicit evidence and
approval beyond code completion.

GitHub Free does not provide private-repository branch protection or rulesets. The
release perimeter is therefore fail-closed independently of that paid capability:

- `.github/workflows/server-native.yml` has no push trigger or deployment code; a manual
  dispatch only emits an explicit refusal
- `.github/workflows/server-control.yml` also contains only an explicit refusal and never
  checks out or invokes `ops/server-command.sh`
- `.github/workflows/release.yml` is the sole release entrypoint
- every release job uses the isolated `ii-tonya-release-claw` runner under the locked
  `ii_tonya_release` OS account; it has no test label or Docker-group access
- release still requires successful exact-main CI provenance, signed artifacts,
  independent exact-SHA migration approval by a write-capable reviewer, staging evidence,
  and explicit production dispatch

A merge can update `main`, but cannot activate the legacy native deployment path.

## 18. Claw / environment notes

Recent verification used the remote Linux host named `claw`.

Known successful Task 10 environment after dependencies/build:

- repository checkout under `/tmp/ii-tonya-task10`
- commands use `corepack pnpm`; do not run `corepack enable` as the non-root user because
  it attempts to write `/usr/bin/pnpm` and fails with EACCES
- fresh focused tests require workspace build first because package exports point to
  `dist`

Use:

```bash
corepack pnpm --workspace-concurrency=1 -r --sort run build
```

before focused tests in a fresh clone when `dist` is absent.

Do not assume the assistant session can SSH into `claw`. The human/operator runs shell
commands there and supplies output; repository changes are made through the GitHub
branch.

## 19. Historical exact evidence worth preserving

Do not delete these diagnostics from PR history:

- Task 9 CI `30865251809` PASS
- Task 9 Database Gate `30865251814` PASS
- Task 10 focused `78/78` PASS at `a5aa6c99564ba60a96464b8baa1cdac69f56e4a9`
- GitHub hosted run `31465777658` — zero-step infrastructure failure
- Task 11 hosted CI `31476564775` / DB Gate `31476564798` — zero-step failures
- latest pre-handoff hosted CI `31487328886` / DB Gate `31487328808` — zero-step
  failures
- latest Task 11/12 local combined run — 159/160 with only the invalid E2E deadline
  fixture failing before commit `f65061b3...`
- corrected focused E2E at `c560cbb65e105e1aaeb8d86f544ff95cfd218346` — 1/1 PASS;
  constrained Claw evidence committed under `docs/test-evidence/claw/c560cbb65.../`

Failed precursor evidence is useful because it distinguishes code regressions from
runner/account failures and documents the fixes that followed.

## 20. What not to do

- Do not enable live payments.
- Do not connect a live payment provider.
- Do not move financial calculations into Telegram, prompts, Make, Sheets, or API route
  parsing.
- Do not accept price/balance/credit/expert/inviter/payment authority from a client or
  model output.
- Do not widen client Selarti intents with expert financial intents without a full
  channel-boundary redesign.
- Do not remove database constraints to make a test fixture pass.
- Do not run repeat loops with a count greater than three.
- Do not run full verification repeatedly after every small change.
- Do not force-push PR #4.
- Do not mark PR ready or merge while current exact-SHA verification is incomplete.
- Do not treat zero-step GitHub Actions failures as code failures or as PASS evidence.
- Do not delete historical migrations, snapshots, handoffs, or test evidence because
  they look unused; the connectivity graph classifies historical/evidence nodes
  explicitly.

## 21. Definition of done for this branch

The branch is complete only when all of the following are true at one coherent release
candidate:

- [x] latest fixed E2E passes
- [ ] full `pnpm verify` passes once at the final source
- [ ] package build/typechecks are green
- [ ] scope/architecture/env/release-readiness guards pass
- [ ] current hosted CI executes real steps and passes
- [ ] current Database Gate executes real steps and passes its CI-only repeat gates
- [ ] traceability points to exact final evidence
- [ ] independent financial/migration review has no unresolved Critical/Important
      findings
- [ ] prompt boundary has a named human spot-check
- [ ] feature flags and provider composition remain disabled
- [ ] PR #4 is synchronized with `main` and mergeable
- [ ] release authority explicitly decides whether to proceed to staging/merge

Until then:

```text
PR #4 = DRAFT
expert referral activation = OFF
expert residency billing activation = OFF
live payment provider = DISABLED
release status = NO-GO
```

## 22. 2026-08-12 continuation: test-only expert API composition

The handoff audit found that the Task 10 expert route builder was not reachable from the
normal API application. The next bounded increment added an optional complete expert API
capability to `buildApp` and converted the route builder internals into a reusable Fastify
plugin.

Closed in this increment:

- no capability means the expert routes remain absent;
- an explicitly injected test capability registers the expert routes in the normal app;
- referral and residency flags expose only their own two-route groups;
- enabling either expert feature flag without that capability rejects startup;
- route body limits remain 8 KiB after plugin composition;
- additional financial/identity fields are rejected rather than stripped;
- payload-too-large remains 413, explicit expert command errors map to 409, and
  unexpected service faults remain 500;
- server runtime still supplies no expert principal or payment provider capability;
- live flags, staging, production services, compose, and environment values were not
  enabled or changed.

Deferred because exact external contracts are unknown:

- real expert bearer/session authentication;
- Telegram-to-HTTP principal mapping;
- payment-provider deadline/session creation;
- LLM proposal runtime dispatch;
- `start_residency_checkout.orderId` versus HTTP `tariffVersionId` semantics.

Focused RED/GREEN and static evidence is recorded under
`docs/test-evidence/claw/3f8ed564-expert-api-composition/verification.md`. The test ran
only in the existing `ii-tonya-test` profile on Claw with 1 CPU and 1 GiB. The underlying
host is production; only the explicitly isolated test profile is authorized for tests.

This does not change the release decision:

```text
PR #4 = DRAFT
expert referral activation = OFF
expert residency billing activation = OFF
live payment provider = DISABLED
release status = NO-GO
```

## 23. 2026-08-12 continuation: Claw access and server-control repair

Operational cleanup completed after the test-only API increment:

- `/home/pall/app-stack` origin no longer embeds a GitHub token and remains accessible
  through credential-free HTTPS plus the existing `gh` credential helper;
- a dedicated machine-local SSH key restores key-based access for the test operator;
- the prior `authorized_keys` state was empty and is backed up on the host before the new
  key entry;
- no credential or password helper is tracked in this repository;
- the exposed GitHub token still requires revocation in GitHub account settings.

The zero-job `server-control` push failure had a separate repository root cause: the
`control-event-ack: ...` text appeared in an unquoted YAML plain scalar. GitHub could not
parse the workflow and therefore created a path-named failure with zero jobs on each push.
That historical repair was later superseded by a stricter release review. The current
control policy is:

- issue-driven execution is removed entirely; only explicit manual `workflow_dispatch`
  remains;
- workflow token access is reduced to `contents: read`;
- `server-control.yml` performs no checkout or command execution and fails explicitly;
- `ops/server-command.sh` remains inert legacy recovery history;
- the server command error trap no longer includes `$BASH_COMMAND`, and the database
  password setup failure emits only a fixed diagnostic.

The self-hosted runner label is declared for actionlint, and the execute step propagates
its own exit status without a second expression-derived `exit` step. Focused Claw evidence
is 110/110 PASS across workflow semantics and recursive scope boundaries.

Evidence is recorded under
`docs/test-evidence/claw/4cfcc32-server-control-validation/verification.md`.
CI and Database Gate now run on the constrained Claw test runner and do not consume
GitHub-hosted Actions minutes.

## 24. Minimal continuation summary

If there is no time to read the entire handoff, do exactly this:

1. checkout/pull `codex/task25-expert-referral-implementation`
2. record `git rev-parse HEAD`
3. read `AGENTS.md` and this handoff
4. build workspace
5. rerun only `tests/e2e/expert-residency-referral.test.ts`
6. if green, run one final `corepack pnpm verify`
7. fix only causal failures with focused tests
8. restore hosted CI/Database Gate execution and require exact-SHA PASS
9. update traceability/evidence
10. keep PR Draft and all live expert payment/referral flags disabled until explicit
    release approval

## 25. 2026-08-12 continuation: expert Bearer principal boundary

The bounded authentication increment adds a provider-neutral Expert Bearer principal
resolver without composing a live identity/session provider. The resolver accepts only a
strict Bearer token, passes a SHA-256 token hash to a fresh lookup on every request,
rejects expired/revoked/malformed session records, and returns only normalized UUID
principal identifiers. Lookup failure is converted to a fixed internal error; the
composed API test proves its HTTP response is sanitized `500 internal_error` rather than
leaking a bearer token.

New implementation and tests:

- `apps/api/src/expert-principal-resolver.ts`
- `apps/api/src/expert-principal-resolver.test.ts`
- `apps/api/src/routes/expert-referral.ts`
- `apps/api/src/index.ts`
- `apps/api/src/app.test.ts`

Claw focused evidence is retained at
`docs/test-evidence/claw/83e20da-expert-bearer-principal/verification.md`. A fresh
authorized run synchronized from exact code commit
`93334aa487572f305fd612cc4e1eaaa93703bb74`, using `ii-tonya-test` image tag
`7d71646347d560ff2b5d8ebc4c0aad5b48230254`, passed 2 files and 37 tests in 5.00s
(resolver 16/16; composed API 21/21). Task 1 separately recorded its resolver-only
GREEN run as 16/16 in 717ms.

Static evidence is intentionally qualified: the requested API-specific TypeScript command
is not runnable because `apps/api/tsconfig.json` is absent; no replacement typecheck was
substituted. Prettier 3.9.6 reports whole-file historical formatting in `app.test.ts`;
the identical check on unchanged `HEAD` also fails, so broad reformatting was not mixed
into this increment. See the Claw evidence for exact commands and outcomes.

Task 1 self-review and Task 2 self-review found no scope expansion into a database,
session provider, configuration, Compose, Billing, production, or deployment path. An
independent Critical/Important review found three Important evidence issues: conflated
ERR-AUTH-007/008 verification, no exact final tested SHA/image/duration, and transient
publication prose. This continuation remediates all three. A clean independent re-review
is a prerequisite for controller publication; record its result in controller evidence
and verify identical local and `origin` branch SHAs after push. Hosted CI and external
approvals remain required before release.

ERR-AUTH-008 now has separate focused Claw evidence at exact branch commit
`b1777bd8e54fa86c54615b5f50157f7e9a48d34c`: the real Pino serialization test passed
2/2 in 719ms using test image `7d71646347d560ff2b5d8ebc4c0aad5b48230254`.
The mounted source was restored to base and the cleanup check returned zero test
containers and zero focused processes. Hosted CI/security regression is still mandatory;
the GitHub jobs remain unable to start because of the account Billing/spending-limit gate.

Unchanged boundaries:

```text
default server expert capability = ABSENT
expert referral activation = OFF
expert residency billing activation = OFF
live identity/session provider = NOT COMPOSED
release status = NO-GO until hosted CI and external approvals pass
```

## 2026-08-12 three-run test policy and final Claw gate

Repeat count is capped at three everywhere, including CI; all Database Gate
commands now use 3x. Production-like container smoke remains a single run. On exact
source `ce72fa3d21f5a913ff06f1f8afa0eb883e89fb13`, Claw passed frozen install, build,
format, deploy contract, lint, workspace typecheck, dependency audit, and three complete
Vitest runs: 120/120 files and 983/983 tests in 310.94s, 316.30s and 314.17s. The audit
found no known vulnerabilities. Raw evidence/checksums remain in the Claw results
directory named `<exact-sha>-three-pass`. The mounted source was restored to `83e20da`;
cleanup proved zero test containers and zero test processes. The later self-hosted CI
migration removed the hosted Actions/Billing dependency; release remains NO-GO until the
exact current SHA, independent review, migration approval, staging evidence, and explicit
human deployment approval all pass.

## 2026-08-12 isolated release-control hardening

- `server-control.yml` and `server-native.yml` are manual refusal workflows only.
- Test runner `ii-tonya-claw` carries `ii-tonya-test` and no release label.
- Release runner `ii-tonya-release-claw` carries `ii-tonya-release` and no test label,
  runs as `ii_tonya_release`, and cannot access the Docker socket through group membership.
- Migration approval must bind the merged PR merge commit to the exact CI SHA, the review
  to the PR head SHA, an exact `MIGRATION-COMPATIBILITY: <sha>` body, and a reviewer with
  repository write, maintain, or admin permission.
- Every secret-bearing release job has `always()` cleanup for SSH keys, rollback state,
  provenance, and transient approval/evidence files.

## 2026-08-12 trusted-main SBOM hotfix

PR #9 was squash-merged to `main` as
`ebd408580a10bd53289f0cd52c186923f7a5d7dd`. Its Database Gate passed, while trusted-main
CI run `31618873619` failed after tests, publication, and both digest vulnerability scans:
`anchore/sbom-action` could not download Syft with its plain HTTP installer (`HTTP 000`).
Signing and provenance upload correctly stayed skipped, so release remained fail-closed.

The follow-up `codex/sbom-provenance-hotfix` branch replaces that runtime installer with
pinned Syft v1.42.3 fetched through `gh` and verified against Anchore's published SHA-256
checksums. It also isolates GHCR authentication in `$RUNNER_TEMP` and removes credentials,
Syft, SBOMs, bundles, and provenance files with `always()` cleanup. Claw evidence is under
`docs/test-evidence/claw/syft-provenance-hotfix-20260812/verification.md`: 127/127 focused
semantic/scope assertions, actionlint, Prettier, and real SPDX generation for both exact
published digests passed. The shared GHCR login left by the failed job was removed without
reading or printing it.

Release remains NO-GO until this hotfix is reviewed and merged and a new exact-main CI run
successfully uploads signed provenance. Gated release still additionally requires the
exact structured migration approval, staging evidence, and explicit human approval.
