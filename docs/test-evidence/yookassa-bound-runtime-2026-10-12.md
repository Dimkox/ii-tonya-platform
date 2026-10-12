# YooKassa bound runtime — implementation evidence

## Coordinator final verification

Euclid accepted the scoped correction at source level with no remaining concrete
finding. Coordinator RequireDocker67962 passed. Final run3 unit93728 at22:32:10
passed17/17 (2.71s, exit0); final run3 PostgreSQL3665 at22:32:11 passed30/30
(8.81s, exit0), using the retained isolated PostgreSQL17.5 test service.
Commands were the same two focused paths recorded below, run separately.
Both files are now3/3 exhausted. No provider call, charge or production change.
This verifies the bounded worker and its restored payment-to-refund fixtures,
not the separate financial87 corrections, API checkout, contact capture,
commercial release or production activation.

Baseline: `690797db64fd80aa1aeccea8003543de470d8c16`, branch
`codex/planerka-api`. Existing dirty worktree preserved. Scope is
`spec-yookassa-bound-runtime.md`, including its 20-second operational clarification.
No merchant calls, local `.env` loading, activation, migration, commit, push,
remote operation, or nested agent. The subsequently authorized canonical
settlement-attempt correction is recorded below; other financial logic is untouched.

## Live run ledger

Each new file has three executions total. Author owns 1 and 2; coordinator owns 3
after review. No old tests or full/multi-path suites were executed.

| Check                                                                                                                                                               | Session              | Result                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`                                                                                               | synchronous `95a763` | exit 0, Node 24.21.0, pnpm 11.9.0, Docker/Compose available                                                                                                  |
| `pnpm exec tsc --noEmit -p tsconfig.tests.json` before initial tests                                                                                                | 26764                | exit 0; launched before unit RED, terminal result collected afterward                                                                                        |
| `pnpm exec vitest run packages/worker/src/yookassa-bound-reconciliation.test.ts` RED1                                                                               | 84398                | exit 1; collected 1, failed 1: recovery still starts after close; 22:07:22 UTC, 2.45s                                                                        |
| `pnpm exec vitest run tests/integration/yookassa-bound-runtime.test.ts` RED1                                                                                        | 51335                | exit 1; collection failure resolving root `@ii-tonya/config`; zero tests, 22:07:33 UTC, 764ms. Consumes run; NOT behavioral RED. Corrected to source import. |
| Tests typecheck during implementation                                                                                                                               | 93404                | exit 2, syntax error in new runtime branch, corrected                                                                                                        |
| Tests typecheck during implementation                                                                                                                               | 38810                | exit 2, payments config is integrations.payments, corrected                                                                                                  |
| Tests typecheck                                                                                                                                                     | 93861                | exit 0                                                                                                                                                       |
| `pnpm --filter @ii-tonya/app-worker... --workspace-concurrency=1 --sort run build`                                                                                  | 54747                | exit 0, nine affected/transitive packages                                                                                                                    |
| Tests typecheck                                                                                                                                                     | 76656                | exit 0                                                                                                                                                       |
| Scoped ESLint, nine owned TypeScript files                                                                                                                          | 32747                | exit 0                                                                                                                                                       |
| `pnpm --filter @ii-tonya/worker --filter @ii-tonya/app-worker --workspace-concurrency=1 --sort run build`                                                           | 14740                | exit 0 after deadline corrections                                                                                                                            |
| `pnpm exec tsc --noEmit -p tsconfig.tests.json`                                                                                                                     | 82227                | exit 0                                                                                                                                                       |
| `pnpm --filter @ii-tonya/db --filter @ii-tonya/worker --filter @ii-tonya/app-worker --filter @ii-tonya/integrations --workspace-concurrency=1 --sort run typecheck` | 76942                | exit 0                                                                                                                                                       |
| Scoped Prettier                                                                                                                                                     | 79453                | exit 0                                                                                                                                                       |
| Integration fixture Prettier and `git diff --check`                                                                                                                 | 13213                | exit 0                                                                                                                                                       |
| Unit focused GREEN2 (same command as RED1)                                                                                                                          | 79743                | exit 0, 13/13 passed, 22:15:20 UTC, 2.48s                                                                                                                    |
| Integration focused GREEN2 (same command as RED1)                                                                                                                   | 49597                | exit 1, 15/19 passed; four refund fixtures fail at claim with YOOKASSA_OPERATION_INVALID (repository line 304), 22:15:31 UTC, 7.33s                          |

Current consumed counts: unit **2/3**, integration **2/3**. Unit GREEN2 passed;
integration GREEN2 failed four refund cases. Diagnosis recorded below; no author
executions remain. Coordinator final3 remains unused.

PostgreSQL commands derive the retained synthetic container's connection URL in
memory using `docker inspect`, then pass only `II_TONYA_TEST_POSTGRES_ADMIN_URL`
to the child Vitest process. No credentials are printed. The testkit creates a
random database and drops only that database. Tests assert server version 170005,
replay actual migrations, and do not reset a shared schema/database.

## Implementation and pending evidence

Normal factory composes the real client, operation repository, verifier, inbox,
and bounded runner. Approved secret reference is resolved in memory; main's
explicit environment is forwarded. Bound claims are filtered by mode before LIMIT,
limited to 25, and run before expiry. Delivery precedes terminal resolution.
Same-terminal replay preserves timestamps; conflicting resolution rejects.

Provider admission has a 20-second window, remaining-time abort signals, and close
abortion of transport only. DB acceptance is awaited. Credential failures latch
until restart and fence the optional terminal audit job. Reports contain bounded
counts/reasons only. Terminal auditing remains an optional existing reader seam;
the default bound path does not require it.

Tests additionally cover real refund reversal, canonical operator rejection,
concurrent webhook/worker delivery, commit-before-resolution crash recovery,
mixed modes, 25-row limit, bad provider facts, disabled/configuration gates,
sequential failure isolation, close, and synthetic remaining-time admission.
Unit cases passed 13/13; integration passed 15/19. Four revised refund fixtures
remain unexecuted. Do not treat corrected test source as passing evidence.

Independent review and coordinator final3 are pending. The unrelated financial
87-case correction remains unrun; this work does not establish financial release
readiness, contact policy/capture, unbound recovery activation, or provider activation.

## Refund prerequisite finding after GREEN2 (initial handoff)

The four refund failures are a real existing dependency gap, not a provider GET
failure. `expert-residency-provider-inbox-repository.ts:386` inserts a settled
attempt with `ON CONFLICT ... DO NOTHING`, then selects the existing attempt at
line 392 without transitioning its pending status. The normal bound payment path
has already created/bound that attempt. The order and inbox settle, but the attempt
remains pending. `yookassa-operation-repository.ts:300` requires a settled attempt
to claim a new refund and rejects it. No financial repository change is authorized
by this spec, and none was made. End-to-end refund creation after recovery therefore
remains blocked by this separate defect.

Refund recovery fixtures now seed their parent through the real canonical inbox
without a pre-existing attempt, which creates a properly settled attempt. They
then claim/bind the refund with the real operation repository and use the ordinary
factory/client/verifier/inbox to recover it. This tests the specified already-bound
refund prerequisite without changing the financial oracle or patching production
authority. These four corrected fixtures are UNRUN, awaiting coordinator final3.
Original failed execution remains the recorded result; no author rerun.

## Initial stable handoff (superseded by authorized correction below)

Implementation is ready for coordinator review, not fully verified or release-ready.
No author command/session remains running. No test may be rerun by this author;
coordinator owns the remaining third execution of each new file after review.
Independent adversarial review has not been performed by a separate agent in this
handoff (nested agents forbidden). No edits to shared status or the spec checklist.

Final static results after the corrected refund fixtures:

- Session 36068: fixture/evidence Prettier and `pnpm exec tsc --noEmit -p tsconfig.tests.json`, exit 0.
- Session 64412: scoped ESLint, Prettier check and `git diff --check`, exit 0.

The scoped formatting/lint targets were:

```text
packages/worker/src/yookassa-bound-reconciliation.ts
packages/worker/src/yookassa-bound-reconciliation.test.ts
apps/worker/src/yookassa-composition.ts
apps/worker/src/main.ts
apps/worker/src/runtime.ts
packages/integrations/src/yookassa/operation-port.ts
packages/db/src/repositories/yookassa-operation-repository.ts
packages/worker/src/index.ts
tests/integration/yookassa-bound-runtime.test.ts
```

Commands: `pnpm exec eslint <the nine paths above>`, then
`pnpm exec prettier --check <the nine paths above> docs/test-evidence/yookassa-bound-runtime-2026-10-12.md`,
then `git diff --check`. Final evidence edits only append this handoff and ledger.

Review should retain the separate refund-creation finding, verify the four
already-bound refund cases with final3, and distinguish 20-second provider I/O
admission from canonical transaction duration. DB commits are deliberately not
aborted by the provider deadline. No dependency installation or lockfile change.

## Authorized prerequisite correction — current handoff

Main confirmed the finding and extended the spec/plan ownership to the canonical
settlement-attempt block only. Read both updated documents before implementation.
The original four payment-to-refund fixtures are restored: create/bind ordinary
payment, settle through the real production worker, then claim/bind/recover refund.
The temporary prerequisite-seeding workaround was removed without ever executing it.

At the existing exact-binding SELECT FOR UPDATE, the repository now reads status
and rejects states other than created/pending/unknown_outcome/settled with
EXPERT_RESIDENCY_PAYMENT_ATTEMPT_CONFLICT. It transitions the three nonterminal
states to settled with resolved_at and updated_at inside the SAME existing
transaction, after all preceding financial/expiry/invalidation checks. Already
settled attempts receive no UPDATE. The UPDATE repeats exact provider/payment/
order/amount/currency binding and status guards and requires one returned row.
No other financial block, reward, reversal, credit or residency rule changed.

New unrun controls assert original attempt ID and single-row identity, status and
resolution time, created/pending/unknown transitions, same-settled timestamp
preservation, concurrent replay, rejected failed/refunded/charged_back attempts,
amount/order mismatch rejection, and rollback if the transaction fails after the
attempt transition. Current integration file has 29 cases; none was executed in
this correction. Prior execution remains **15/19**, not a green result.

Execution counts remain **unit 2/3, integration 2/3**. No new test execution or
separate diagnostic reproduction. Main owns final3 after independent review.
The separate financial87 suite remains unrun and is not replaced by this work.

Static checks in this correction:

- Session 56986: RequireDocker preflight and integration fixture Prettier, exit 0.
- Session 87381: financial repository Prettier check and tests typecheck, exit 0.
- Session 40919: DB, worker and app-worker build, exit 0.
- Session 26503: fixture/evidence Prettier and scoped financial repository/fixture ESLint passed; tests typecheck exited 2 because an unrelated expert-session test imports DB dist declarations while the parallel build cleans them. Build now finished; repeat static check sequentially. Diff check in this chain did not run.
- Session 36578: DB, worker and app-worker typechecks, exit 0.
- Session 43211: tests typecheck after build completion, scoped financial repository/fixture ESLint, Prettier check and `git diff --check`, exit 0.

Correction source handoff is stable; no command or writer remains active. All
static checks passed. The authorized transaction correction and 29-case integration
source still require independent review and main's final3. Unit source is unchanged
since 13/13; integration execution remains the original 15/19. Do not report the
restored refund path or the new controls as dynamically verified yet. This turn
changed only the settlement-attempt block, the owned integration file, and this
evidence file, preserving earlier financial edits elsewhere in the dirty worktree.

## Euclid fix round 1 — current work

Main confirmed two Important findings and updated the spec. Read the updated spec
before editing. Counts remain **2/3 for each file**, no tests authorized or launched.
The financial settlement-attempt correction is unchanged in this round.

1. Replaced the unsafe enabled legacy reader instance seam with a reader factory
   that receives only getPayment from the same guarded client. Enabled legacy
   reader injection rejects before provider I/O. Every audit GET now checks the
   same credentials, closing state and remaining 20-second window. Credential
   rejection also aborts already-admitted sibling requests. Disabled behavior and
   the optional nature of terminal auditing remain unchanged.
2. Preserve the actual completed reconciliation result and add an unavailable
   reason separately; a post-persistence deadline no longer rewrites counts to zero.

Added unrun controls use the real four-loop audit reader, real HTTP client and
deferred transport responses for inside-audit 401, 403, closing and deadline
expiry. Sibling responses deliberately survive abort to prove GET 5 cannot start.
The existing PG credentials-before-audit test now uses the guarded factory seam;
enabled unsafe legacy injection has an explicit rejection control. A real PG
audit commits a status mismatch, advances the synthetic clock after persistence,
and asserts examined=2, matched=1, mismatches=1 plus budget_exhausted.

Strengthened the existing webhook/worker concurrency case with a held order-row
lock: require two independent provider-inbox/order statements observed waiting
in pg_stat_activity before releasing the blocker. Promise.all alone is no longer
the overlap oracle. This is test-only locking in the isolated database.

Current source contains 17 unit and 30 integration cases, all edits in this round
UNRUN. Last executed results remain unit13/13 and integration15/19. Main final3
remains reserved after scoped rereview.

Static ledger (completed; no live command):

- Session 79234: RequireDocker environment preflight, exit 0.
- Session 17353: `pnpm exec prettier --write` on composition, main, runtime and the two new test files, followed by `pnpm --filter @ii-tonya/worker --filter @ii-tonya/app-worker --workspace-concurrency=1 --sort run build`, exit 0 (both ESM and declaration builds).
- Session 91119, launched only after build completion: `pnpm --filter @ii-tonya/db --filter @ii-tonya/worker --filter @ii-tonya/app-worker --workspace-concurrency=1 --sort run typecheck`, then `pnpm exec tsc --noEmit -p tsconfig.tests.json`, scoped ESLint and Prettier check on the same five TypeScript files, then `git diff --check`, all exit 0.

Source edits are frozen for Euclid's scoped rereview. No production/merchant
calls, new dependencies, or test executions occurred. Counts remain unit **2/3**
and integration **2/3**; coordinator final3 remains reserved. Static success is
not dynamic verification of the new controls or deployed readiness on ii-tonya.ru.
Remaining gates are scoped rereview and coordinator-owned final focused runs;
commercial deployment/human-review readiness is not established by this handoff.
