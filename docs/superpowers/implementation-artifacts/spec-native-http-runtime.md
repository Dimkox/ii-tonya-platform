---
title: Native Node runtime must support real outbound HTTP
type: bugfix
created: 2026-10-13
status: done
baseline_commit: 031ae46065b58223a2b6cd47e002b388a41ec89c
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="owner delegated technical implementation and explicitly requested a new production build">

## Intent

**Problem:** Production API and worker run Node 24 with `--jitless`, which removes
WebAssembly. Node's built-in fetch then fails even after network connectivity is
restored. Readiness does not exercise outbound HTTP and therefore missed the defect.

**Approach:** Run the API and worker using the supported ordinary Node runtime.
Keep the non-network migration unit's existing policy. Verify actual local HTTP
behavior using the runtime flags parsed from the shipped units, not a mock fetch.

## Boundaries & Constraints

**Always:** Work only in the isolated checkout
`/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/review-2a3484e6-20261013`,
branch `codex/native-http-runtime-20261013`. Preserve the non-root user, capability
bounding, no-new-privileges, filesystem protection, private tmp, memory limits and
restart policy. Document the precise executable-memory tradeoff: API/worker need
WebAssembly/JIT and cannot use MemoryDenyWriteExecute=true; migration retains it.
This fixes a broken runtime contract, not an engine, dependency or CI downgrade.

**Ask First:** An unavailable dependency, a required unrelated refactor or a change
to business/financial behavior. Report such a gap; do not invent a policy.

**Never:** Access secrets, make external requests, run remote operations, push,
alter financial/provider flags, touch database code, edit deployment recovery
scripts, install dependencies outside the committed graph or run old exhausted
tests. Do not run a full/multi-path suite. The implementer gets RED1/GREEN2 of the
new focused file; coordinator reserves final3. Existing native-production-release
test is updated but NOT executed by implementer; coordinator owns its single run.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| API HTTP | Child uses API unit Node flags against an ephemeral loopback HTTP server | Real fetch reads the exact fixture body, exit zero | Bounded timeout, child and server cleaned up |
| Worker HTTP | Child uses worker unit Node flags against that server | Same real successful response | No external hosts or credentials |
| Regression | Shipped flags include --jitless | Behavior test fails on missing WebAssembly | Cannot pass by mocking fetch or deleting response assertions |

</frozen-after-approval>

## Code Map

- `deploy/systemd/ii-tonya-api.service:14` and
  `deploy/systemd/ii-tonya-worker.service:14` currently use --jitless, and line29
  sets MemoryDenyWriteExecute=true. Ordinary Node needs compatible memory policy.
- `deploy/systemd/ii-tonya-migrate.service` has no external HTTP requirement;
  preserve this unit unchanged.
- `tests/repo/native-production-release.test.ts:161` onward currently asserts the
  defective flags and shared W^X policy as source strings. Reconcile those assertions
  with the corrected differentiated policy without deleting unrelated coverage.
- `tests/repo/native-http-runtime.test.ts` is the new behavioral regression test.
  Use node:http loopback on port0, node:child_process with asynchronous execution,
  real fetch/body assertions, explicit test-only proxy bypass, bounded output and
  cleanup. Parse shipped ExecStart args; do not hardcode corrected flags into test.
- `docs/runbooks/native-production-deployment.md:18` currently promises --jitless
  compatibility; correct it and explain why readiness alone was insufficient.
- Remote evidence (already obtained by coordinator): Node24.19 using same proxy
  returns302 normally, fails with `cause: WebAssembly is not defined` under
  --jitless. Adding --wasm-jitless does not repair it; --expose-wasm is rejected.
  Native source031 is live. Temporary Claw-dependent proxy is installed, not a
  claim that independent Red Shield VPN or full product is complete.

## Tasks & Acceptance

**Execution:**

- [x] New `tests/repo/native-http-runtime.test.ts`: write and run RED1 before unit edits.
- [x] Update only API/worker service runtime and executable-memory policy.
- [x] Reconcile affected native-production-release assertions; leave unrelated checks.
- [x] Update the native deployment runbook and add focused evidence at
      `docs/test-evidence/native-http-runtime-2026-10-13.md`.
- [x] Run GREEN2, focused lint/format, tests typecheck and git diff --check.

**Acceptance Criteria:**

- Given the deployed Node major, when each shipped service's runtime flags make
  a real loopback request, then the exact response is read and the child exits zero.
- Given the corrected API/worker unit, when inspected, then all unrelated hardening
  and operating limits remain unchanged and the migration unit is byte-for-byte unchanged.
- Given the old assertion suite, when reconciled, then it still guards non-root
  execution and other protections while distinguishing migration from HTTP runtimes.
- Given the deploy runbook, when preparing this upgrade, then it explicitly warns
  that existing remote `10-node-jitless.conf` drop-ins override the new unit and
  must be backed up and retired during cutover. Controller owns that operational
  action and recovery; do not change deployment scripts or perform it as implementer.

## Spec Change Log

## Verification

- `pnpm exec vitest run tests/repo/native-http-runtime.test.ts`: RED1 then GREEN2 only.
- `pnpm exec eslint tests/repo/native-http-runtime.test.ts tests/repo/native-production-release.test.ts`.
- `pnpm exec tsc --noEmit -p tsconfig.tests.json`.
- Prettier only changed supported files; `git diff --check`.
- Report exact run counts, exits and source hashes. Do not claim a released build;
  independent review, coordinator final verification and signed deployment follow.

Implementation evidence and exact source hashes:
[native HTTP runtime evidence](../../test-evidence/native-http-runtime-2026-10-13.md).
RED1 failed both cases with the expected missing-WebAssembly error; GREEN2 passed
both cases. The implementer consumed exactly two new-file runs and no legacy-suite
runs. Final review acceptance and coordinator verification remain pending.

## Review correction progress

- Coordinator triage reports no edge-hunter findings; systemd proof and docs gaps
  are addressed by the updated runbook/evidence and pending operational acceptance.
- Listener startup now has bounded cancellation and cleanup. Static lint/typecheck
  passed; this post-GREEN2 correction has not been executed. Final3 remains reserved.
- Coordinator surrogate 95917/wait2779c6 passed as reported preflight, not deployed
  API/worker acceptance. Final proof uses both actual units' nonfatal, exact-SHA
  `ExecStartPost` getMe hooks with separately required zero status/success logs,
  followed by final effective config and no-`NODE_OPTIONS` checks.
- Runbook records override backup/retirement before normal script quiescing,
  no early restart, selective hook cleanup without restart, and override restoration
  plus degraded-HTTP disclosure on rollback. Operational helpers remain coordinator-owned.
- General INI parsing/source-substring/conflicting-assignment concerns are deferred,
  not fixed. No additional tests, remote operations or commit; legacy ONE remains
  reserved. RED/GREEN evidence is session output only, without durable per-run logs.

## Final source verification

Coordinator final3 exposed a fixture cleanup race: abort closed the server before
asynchronous disposal, which returned ERR_SERVER_NOT_RUNNING. The correction
ignores only that already-closed result and propagates every other error. The owner
explicitly authorized one additional focused run. Run4 (75399) passed 2/2; the
unchanged legacy contract file's sole run (49133) passed 10/10. Focused ESLint,
tests typecheck, formatting and whitespace passed. No exhausted legacy suite ran.
Reviewer Noether accepted the bounded cleanup correction and operational helpers;
three-layer source review is complete. Build and deployment acceptance are separate
from completion of this source fix. Independent VPN and commercial acceptance remain open.

## Suggested Review Order

- Ordinary Node restores HTTP parsing; the executable-memory tradeoff is explicit.
  [ii-tonya-api.service:14](../../../deploy/systemd/ii-tonya-api.service#L14)
- Worker receives the same runtime correction; migration policy stays unchanged.
  [ii-tonya-worker.service:14](../../../deploy/systemd/ii-tonya-worker.service#L14)
- Preserve recovery while retiring legacy overrides and verifying actual service HTTP.
  [native-production-deployment.md:33](../../runbooks/native-production-deployment.md#L33)
- Real loopback requests detect missing WebAssembly without provider calls or secrets.
  [native-http-runtime.test.ts:7](../../../tests/repo/native-http-runtime.test.ts#L7)
- Retained protection assertions distinguish application runtimes from migration.
  [native-production-release.test.ts:180](../../../tests/repo/native-production-release.test.ts#L180)
- Review run counts, source fingerprints and remaining operational limits.
  [native-http-runtime-2026-10-13.md:1](../../test-evidence/native-http-runtime-2026-10-13.md#L1)
