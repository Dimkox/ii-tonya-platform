# Task 9 implementation report

Status: implementation and fix round 1 are awaiting independent re-review. This report does not declare Task 9 complete.

Base: `95385f05c5a93da5d69086aa20a9a77fbc95dc85`

Implementation commit: `8fa1a93cf7367a6966e4574d1f62243fa3d80f95` (`feat: add expert referral admin workflows`)

Fix-round commit: `test: complete expert admin workflow coverage`

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

## Independent-review fix round 1

The review found no Critical issue. Its Important finding required real-database negative-path coverage for inviter eligibility and revocation, real-database tariff-retirement approval/replay coverage, and exact dispatch coverage for every non-batch route action. Its two Minor findings were a dead `correlationId` execution input and date parsing that accepted normalized impossible calendar dates.

Strict RED was captured before production changes:

```text
corepack pnpm vitest run apps/api/src/routes/expert-referral-admin.test.ts tests/integration/expert-referral-redemption.test.ts packages/db/src/repositories/expert-residency-repository.test.ts
1 file failed, 2 passed; 13 failed, 20 passed, 33 total.
```

The 13 failures proved that all eight non-batch executions and three error-mapping cases stopped on the dead required `correlationId`, and that `2026-02-30T00:00:00.000Z` was normalized and accepted. Both new real-database files were already GREEN during this RED, proving the test fixtures themselves exercised the existing database behavior before the minimal route/input correction.

Focused GREEN after the correction:

```text
same command
3 files passed; 33/33 tests passed (18 routes, 11 referral database, 4 tariff database).
```

The fix removes the unused Task 9 execution `correlationId` field instead of accepting unauthenticated dead input. Approval binding is unchanged: requester and approver session hashes, action, object type/ID, canonical payload, nonce, and expiry remain exact. ISO date validation now requires a canonical `Date#toISOString()` round trip after the existing syntax check, so normalized impossible dates fail closed.

Added review coverage proves:

- inactive and unverified inviters reject batch issuance with zero batches, zero codes, zero audit rows, and unconsumed approval evidence;
- redeemed and non-issued/revoked codes reject revocation without mutation, while an issued code revokes once, exact approval replay is stable, and payload mismatch fails;
- tariff retirement rejects incorrectly bound approval evidence without mutation, persists the approved retirement, replays exactly, rejects mismatched replay, removes the retired tariff from quoting, and permits a non-overlapping replacement at the prior exclusive boundary;
- all eight non-batch route actions send the exact object identity and canonical approval payload, then dispatch the exact application-service command; typed 400/403/409 mappings remain redacted.

Final fix-round verification:

```text
corepack pnpm vitest run packages/application/src/expert-referral-admin-service.test.ts packages/db/src/repositories/admin-approval-repository.test.ts apps/api/src/routes/expert-referral-admin.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts tests/integration/admin-approval.test.ts
6 files passed; 58/58 tests passed.

corepack pnpm vitest run packages/db/src/repositories/expert-referral-repository.test.ts packages/db/src/repositories/expert-referral-control-repository.test.ts packages/db/src/repositories/expert-residency-repository.test.ts packages/db/src/repositories/expert-residency-provider-inbox-repository.test.ts tests/integration/expert-referral-redemption.test.ts tests/integration/expert-residency-hold-replay.test.ts apps/api/src/routes/admin.test.ts packages/application/src/admin-service.test.ts
8 files passed; 54/54 tests passed, including all 11 held-replay tests.

corepack pnpm vitest run tests/repo/expert-referral-scope-guards.test.ts tests/repo/scope-boundary.test.ts tests/repo/env-policy.test.ts tests/repo/workspace-dependencies.test.ts tests/repo/admin-approval-test-guards.test.ts tests/repo/admin-workflow-guards.test.ts
6 files passed; 166/166 tests passed.

bash -n scripts/deploy-compose-remote.sh scripts/validate-runtime-env.sh && corepack pnpm vitest run tests/repo/release-assets.test.ts tests/repo/workflow-semantics.test.ts
shell syntax passed; 2 files/18 tests passed.

corepack pnpm prettier --check <all 7 fix-round TypeScript files>
passed; all matched files use Prettier style.

corepack pnpm eslint <all 7 fix-round TypeScript files>
passed with zero findings.
```

The exact staged fix patch was applied to detached clean worktree `/tmp/ii-tonya-task9-fix1.A5xduK` at `8fa1a93cf7367a6966e4574d1f62243fa3d80f95` and verified there:

```text
corepack pnpm --workspace-concurrency=1 -r --sort run build
10/10 workspace builds passed.

corepack pnpm -r --sort run typecheck
10/10 workspace typechecks passed.
```

The direct shared-tree API DTS build remained unavailable because the protected in-progress config edit did not generate the required `@ii-tonya/config` declaration output; the clean overlay establishes that the exact fix patch builds and typechecks. The original five-file Prettier baseline exception above is unchanged. Every fix-round TypeScript file was previously clean and passes exact `prettier --check`, so this round adds no formatter exception. The startup-static environment ceilings, fresh durable database kill switch, and exact-replay contracts were not changed.

Exact fix-round files:

- `.superpowers/sdd/2026-08-03-expert-residency-referrals/task-9-report.md`
- `apps/api/src/routes/expert-referral-admin.test.ts`
- `apps/api/src/routes/expert-referral-admin.ts`
- `apps/api/src/server.test.ts`
- `packages/application/src/expert-referral-admin-service.test.ts`
- `packages/application/src/expert-referral-admin-service.ts`
- `packages/db/src/repositories/expert-residency-repository.test.ts`
- `tests/integration/expert-referral-redemption.test.ts`

The protected shared edits in `apps/worker/src/runtime.ts` and `packages/config/src/env.ts` remain unstaged and unchanged by this fix. Independent re-review remains required.
