# YooKassa request cancellation — implementation evidence

- Specification: `docs/superpowers/implementation-artifacts/spec-yookassa-request-cancellation.md`, read completely; frontmatter `context: []`.
- Worktree: `.worktrees/review-2a3484e6-20261013`.
- Branch: `codex/yookassa-request-cancellation-20261014`.
- Baseline: `d00d24593493cb348a25abf0eec0318a1c018ddf`.
- Scope: merchant client, public options export, new synthetic regression file, this evidence.
- Environment preflight: `pwsh -File scripts/check-development-environment.ps1` exited 0; Node 24.21.0, pnpm 11.9.0, no failures. Missing `.env` is intentional.

## Execution allowance

Only `packages/integrations/src/yookassa/client-cancellation.test.ts` may run.
Author allowance: RED1 and GREEN2 only. Coordinator owns final3 after independent review.
No old tests, full/multi-path suites, PostgreSQL tests, mutation commands or network/provider calls.

| Run    | Command                                                                               | Result                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED1   | `pnpm exec vitest run packages/integrations/src/yookassa/client-cancellation.test.ts` | Session52561, exit1, 2026-10-14 14:25:44UTC, 1.16s:25 failed/15 passed. Expected cancellation, stream cleanup and byte-boundary failures against unchanged client; no collection error. |
| GREEN2 | Same focused command                                                                  | Session38872, exit0, 2026-10-14 14:28:17UTC, 1.15s:40/40 PASS.                                                                                                                          |
| final3 | Same focused command, coordinator after independent review                            | Session56372, exit0, 2026-10-14 14:43:51UTC, 1.29s:56/56 PASS. All review corrections included.                                                                                         |

## Completed bounded verification

All three permitted focused invocations are consumed. Final3 passed all56 cases
after the review corrections. Its original tool output was recovered read-only
from the current session transcript after context truncation; exit0 and counts
were present in the original completed result. Vitest's persisted result also
records failed=false. No fourth test run was made or authorized.

The earlier interrupted multi-file apply_patch failed its evidence-line match
before changing files; no test command followed that failure.

Coordinator took over execution after explicitly closing Anscombe. Tool returned
previous_status=running; subsequent wait returned not_found and shutdown
notification arrived. The author left this evidence and the regression file,
with no implementation change and no recorded test execution. No second writer.

Integrations build/typecheck passed (78090). Tests typecheck initially found a
self-referential mock initializer (TS7022/TS7024); replaced that test-only selector
with an explicit invocation counter. No production code changed after GREEN2.
Static retry48886 exit0: tests typecheck, integrations typecheck, focused ESLint,
Prettier check and git diff --check all passed. After review corrections,
session87819 exited0 with integrations build, tests typecheck, scoped ESLint,
formatting and whitespace checks. Commands:

```sh
pnpm --filter @ii-tonya/integrations build
pnpm exec tsc --noEmit -p tsconfig.tests.json
pnpm exec eslint packages/integrations/src/yookassa/client.ts packages/integrations/src/yookassa/client-cancellation.test.ts packages/integrations/src/index.ts
git diff --check
```

Final3 covers these exact SHA256 file contents, unchanged after execution:

| File                                                           | SHA256                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| packages/integrations/src/yookassa/client.ts                   | d2f344d4f4598a09babd95453a303a044de1db492a533632a1b95726b99fb8f8 |
| packages/integrations/src/yookassa/client-cancellation.test.ts | 3285cc5eea03820b4ef8ea139b5569955ad910a667dabdb4c749c1747de8bfb0 |
| packages/integrations/src/index.ts                             | 2322ad12ab863dfa628d4c49ff600fab8156adb58114547e9b2c083388dea747 |

No full suite, old exhausted test, hosted CI, Database Gate or production checkout
was run by this change. The pre-push hook is installed and active. A Draft RC push
must explicitly document any deliberate hook bypass required to avoid rerunning
exhausted repository suites; it is not evidence that the full gate passed.

## Independent review and bounded remediation

Arendt (blind), Poincare (edge cases) and Singer (verification gaps) reviewed the
complete tracked/untracked candidate diff. They made no source edits or test runs.
All three results were collected before triage. Accepted patch findings:

- Default-ceiling expiry lacked coverage when options were omitted. Extended the
  transport/body matrix to both branches (existing production logic retained).
- Cross-realm byte arrays were rejected by instanceof. Use node:util/types;
  regression exercises a real VM-created byte array.
- Mutable chunk views could corrupt consumed bytes and retain large backing
  stores. Copy into bounded client-owned 256KiB storage before the next read.
- Empty immediate reads could grow bookkeeping and starve timeout callbacks.
  Fixed storage prevents growth; bounded batches yield the event loop. The
  regression has a finite fallback to avoid hanging its own baseline runner.
- Added locked-body/non-byte coverage, failure-path coverage for all shared
  refund/GET consumers, and public cancellation-contract JSDoc.

Patch-header paths were a review-presentation artifact, not repository paths or a
shipped patch, so that claim was rejected. A native-fetch transport integration
test was not added: the default fetch delegation is unchanged, and this scope
explicitly permits synthetic transport only. No native-fetch integration claim.
Final3 passed after all accepted corrections. The source hashes above bind its
evidence to the candidate; only this evidence and the spec were updated afterwards.
All three reviewers are closed. Candidate commit identity belongs in the handoff.

The new review regressions were written before their production corrections,
but not separately executed RED: the single-file3-run allowance leaves only the
reserved final3. Initial25 behavioral RED failures remain observed evidence;
do not describe review-only cases as independently observed RED/GREEN cycles.

## Product limitations

This change does not implement full API checkout composition, financial admission,
receipt-disclosure authorization, database-lock/remote-HTTP exclusion, or production
activation. Cancellation cannot recall bytes already sent or reverse a payment already
created; ambiguous outcomes remain unknown. Standard fetch and injected transports
must honor the passed signal. All test data and transport responses are synthetic.
