# Task 9 implementation report

Status: implemented and awaiting independent review. This report does not declare Task 9 complete.

Base: `95385f05c5a93da5d69086aa20a9a77fbc95dc85`

Planned commit: `feat: add expert referral admin workflows`

## Result

- Added a separate authenticated/rate-limited expert-referral admin API for approval request, approval, execution, and masked inventory.
- Added the exact nine reviewed actions and bound executions to current requester/approver sessions, the entitlement-admin role, action, object type/ID, canonical payload, nonce, expiry, and one-time approval consumption.
- Added a two-distinct-approver issuance-override transaction with bounded quota/reason/validity, atomic approval consumption, durable override, and audit event.
- Enforced fresh process ceilings before batch issuance, tariff mutation, and durable feature enablement; disabling and approved existing-state held replay remain available under their repository contracts.
- Added approved abuse-hold transitions, tariff create/retire, revocation, feature switching, and held-reward replay composition.
- Limited successful batch output to one-time plaintext codes and hard-projected inventory to exactly `{batchId,status,maskedSuffix,createdAt}`.
- Extended the reviewed route guard only for the four concrete admin routes and their app wildcard mount. No provider, network, credential, migration, deployment, or activation change was added.

## TDD evidence

Initial required RED:

```text
corepack pnpm vitest run packages/application/src/expert-referral-admin-service.test.ts packages/db/src/repositories/admin-approval-repository.test.ts apps/api/src/routes/expert-referral-admin.test.ts
3/3 files failed: two missing modules; the existing approval test exposed the absent exact action set (3 existing tests passed, 1 failed).
```

Focused GREEN after the initial implementation:

```text
same command
3 files passed; 20/20 tests passed.
```

Additional RED-to-GREEN slices:

- `corepack pnpm vitest run tests/integration/admin-approval.test.ts`: RED 2 failed/6 passed because dual-approval override creation was absent; GREEN with the application and approval unit tests was 3 files/22 tests.
- `corepack pnpm vitest run tests/integration/expert-residency-hold-replay.test.ts -t "atomically consumes exact admin evidence"`: RED 1 failed/10 skipped because the admin replay entry point was absent; GREEN 1/1 with 10 skipped.
- `corepack pnpm vitest run apps/api/src/app.test.ts apps/api/src/server.test.ts`: RED 2 failed/16 passed because the route was not mounted and the default service was absent; GREEN 2 files/18 tests.
- `corepack pnpm vitest run packages/application/src/expert-referral-admin-service.test.ts -t "creates only a bounded"`: RED 1 failed/9 skipped when human-readable override reasons were rejected; GREEN 10/10 for the full file.
- `corepack pnpm vitest run packages/application/src/expert-referral-admin-service.test.ts`: RED 1 failed/9 passed because the execution nonce was dropped; GREEN as part of the final 10/10 application file.
- `corepack pnpm vitest run packages/db/src/repositories/expert-referral-control-repository.test.ts -t "rejects execution evidence with a nonce"`: RED 1 failed/8 skipped because a mismatched nonce was accepted; GREEN as part of the final 9/9 control repository file.
- `corepack pnpm vitest run tests/repo/scope-boundary.test.ts ...`: RED 1 failed/164 passed for the new required wildcard mount. After a narrow wildcard allowance, the direct concrete-route test was RED 1 failed/25 skipped and listed the four exact routes. The final reviewed allowlist is GREEN below.

## Final verification

```text
corepack pnpm vitest run packages/application/src/expert-referral-admin-service.test.ts packages/db/src/repositories/admin-approval-repository.test.ts apps/api/src/routes/expert-referral-admin.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts tests/integration/admin-approval.test.ts
6 files passed; 46/46 tests passed.

corepack pnpm vitest run packages/db/src/repositories/expert-referral-repository.test.ts packages/db/src/repositories/expert-referral-control-repository.test.ts packages/db/src/repositories/expert-residency-repository.test.ts packages/db/src/repositories/expert-residency-provider-inbox-repository.test.ts tests/integration/expert-referral-redemption.test.ts tests/integration/expert-residency-hold-replay.test.ts apps/api/src/routes/admin.test.ts packages/application/src/admin-service.test.ts
8 files passed; 50/50 tests passed, including all 11 held-replay tests.

corepack pnpm vitest run tests/repo/expert-referral-scope-guards.test.ts tests/repo/scope-boundary.test.ts tests/repo/env-policy.test.ts tests/repo/workspace-dependencies.test.ts tests/repo/admin-approval-test-guards.test.ts tests/repo/admin-workflow-guards.test.ts
6 files passed; 166/166 tests passed.

bash -n scripts/deploy-compose-remote.sh scripts/validate-runtime-env.sh && corepack pnpm vitest run tests/repo/release-assets.test.ts tests/repo/workflow-semantics.test.ts
shell syntax passed; 2 files/18 tests passed.

corepack pnpm exec eslint <all 22 changed Task 9 TypeScript files>
passed with zero findings.

git diff --cached --check
passed.
```

The shared worktree contains protected unrelated edits in `apps/worker/src/runtime.ts` and `packages/config/src/env.ts`. A direct shared-tree workspace build fails in the latter because its in-progress `expertReferralMaturityWorker` field is not present in the declared feature type. To avoid modifying or staging either file, the exact staged Task 9 patch was applied to a detached worktree at the base commit and verified there:

```text
corepack pnpm --workspace-concurrency=1 -r --sort run build
10/10 workspace builds passed.

corepack pnpm -r --sort run typecheck
10/10 workspace typechecks passed.
```

Prettier exception, proven against the unchanged base commit: whole-file `prettier --check` already fails for these five compact legacy files at `95385f05`: `apps/api/src/app.test.ts`, `packages/db/src/repositories/admin-approval-repository.test.ts`, `packages/db/src/repositories/admin-approval-repository.ts`, `packages/db/src/repositories/admin-repository.ts`, and `tests/integration/admin-approval.test.ts`. Formatting them wholesale would add roughly 747 cosmetic changed lines, so it was intentionally not done. All new/previously clean changed TypeScript files (17 files) pass exact `prettier --check`; additions in the five legacy files were compared with formatter output, and the two modified legacy declarations that differed were wrapped to the formatter form.

## Exact changed files

- `.superpowers/sdd/2026-08-03-expert-residency-referrals/task-9-report.md`
- `apps/api/src/app.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/routes/expert-referral-admin.test.ts`
- `apps/api/src/routes/expert-referral-admin.ts`
- `apps/api/src/server.test.ts`
- `apps/api/src/server.ts`
- `packages/application/src/expert-referral-admin-service.test.ts`
- `packages/application/src/expert-referral-admin-service.ts`
- `packages/application/src/index.ts`
- `packages/db/src/index.ts`
- `packages/db/src/repositories/admin-approval-repository.test.ts`
- `packages/db/src/repositories/admin-approval-repository.ts`
- `packages/db/src/repositories/admin-repository.ts`
- `packages/db/src/repositories/expert-referral-control-repository.test.ts`
- `packages/db/src/repositories/expert-referral-control-repository.ts`
- `packages/db/src/repositories/expert-referral-repository.ts`
- `packages/db/src/repositories/expert-residency-provider-inbox-repository.ts`
- `packages/db/src/testkit/expert-referral.ts`
- `tests/integration/admin-approval.test.ts`
- `tests/integration/expert-residency-hold-replay.test.ts`
- `tests/repo/expert-referral-scope-guards.test.ts`
- `tests/repo/support/payment-scope-boundary.ts`

The provider-inbox extension is limited to 47 insertions and 4 deletions: it validates/consumes exact held-replay evidence and appends its audit event inside the existing serializable transaction, then delegates to the unchanged replay state machine. The complete prior redemption and held-replay regression suites passed.

## Review notes

- The five documented whole-file formatter failures are inherited baseline formatting, not a Task 9 formatter regression.
- The two protected shared edits remain unstaged and unchanged by Task 9.
- Independent review remains required before Task 9 can be declared complete.
