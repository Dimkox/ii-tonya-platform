---
title: Original consent authority fences asynchronous client work
type: feature
status: in-progress
created: 2026-10-05
baseline_commit: 045a2de303b0191c5f345a7d3c2bd3d6ca09eb2d
context:
  - AGENT-STATUS.md
  - AGENTS.md
  - docs/superpowers/implementation-artifacts/spec-client-sensitive-consent.md
  - docs/superpowers/plans/2026-10-05-client-async-authority.md
---

## Bounded RC deployed — 2026-10-06, 07:36 UTC

Source425e647a6e8a577095df2d9a89f28660d5a781ef is published on the RC branch and
installed in native/web production. Normal pre-push gate, full workspace/tests
typecheck, committed-graph native/web builds, packaged imports, artifact signatures
and checksums passed. Live browser/API/host readback matched the exact installed SHA.
Previous4354818 and protected backups remain; temporary rollout staging was cleaned.
No PostgreSQL or full-suite rerun, migrations or provider activation occurred.
See [production evidence](../../test-evidence/production/2026-10-06-client-async-authority-rc.md).

Status remains `in-progress` for the separate external release/acceptance gates:
GitHub check-runs0, no external Trust CI/Database Gate receipt, and the full ordinary
commercial journey is not complete. This section supersedes earlier local-only
deployment statements below, not the preserved historical verification results.

## Latest focused verification — 2026-10-05, 15:00 UTC

The owner explicitly authorized ONE further invocation of the same outbox file.
Main executed it at15:00:26 UTC against the existing PostgreSQL17.5 loopback fixture:
**exit0,34/34**, duration23.69s. All six post-claim subject/authority/source-row
contention cases now passed with distinct synthetic update IDs. Original convoy,
small-limit backlog recovery, preservation of started uncertainty, bot partition,
financial/residual cases and post-wait freshness assertions also passed.

Command: `node .superpowers/sdd/2026-10-05-client-async-authority/run-pg.mjs tests/integration/outbox-repository.test.ts`.
Log: `.superpowers/sdd/2026-10-05-client-async-authority/owner-exception-3-final.log`.
Log SHA256: `a5f75060bb3fa96fc4be05bdc176e04eb08c8b07f4ed3458057ee006ad8d9498`.
Test-file SHA256: `38d0461368f51a9f15cee40e340b604a07a0002f5944f1e89fea4e248a1edd26`.
Environment with RequireDocker and whitespace checks passed. No code, fixture or
assertion was changed during this verification turn; earlier failed logs are retained.

The local six-scenario blocker is closed. Six logical outbox invocations are used
(original3 + earlier exception2 + separate exception1); no additional runs remain
authorized, and other budgets are unchanged. Independent static closure preceded
this execution. Status remains `in-progress` for release-evidence closure: no new
commit, push, deployment, exact-SHA external Trust receipt or full-product completion
is claimed. Written consent/signing remains outside ordinary launch prerequisites.

## Previous verification stop — 2026-10-05, 14:53 UTC

Status remains `in-progress`. Main consumed the final authorized outbox invocation
at14:53:08: **exit1,28/34**, duration13.46s. The original convoy, both small-limit
backlog/recovery cases, both started-uncertainty cases and all earlier financial/
residual scenarios passed. Six post-claim contention cases failed in fixture setup
before their behavioral assertions: a second same-bot `reviewClient` reused
`updateId:1n` and the real producer correctly returned `duplicate`.

The narrow fixture correction assigns distinct synthetic update IDs, preserving
production idempotency and all behavior/finance assertions. Its result remains
UNVERIFIED without another explicitly authorized run. The final run log is
`.superpowers/sdd/2026-10-05-client-async-authority/owner-exception-2-final.log`.
Original3/3 plus owner exception2/2 are exhausted: **five logical invocations**.
Do not rerun, rename cases or substitute inline PG checks. Other budgets are unchanged.

Independent static review closed the three prior consumer defects after correcting
both generic recovery queries to exclude provably unstarted overflow independently
of the first-pass limit. The review approved execution of final PG, not release.
Static builds/types/lint/format cannot close the six remaining behavioral gaps.
No commit, push, deployment, provider activation or full-product completion follows.
The parent spec separately excludes written consent/signing from the ordinary launch
route; the detailed special-category mode remains unavailable, not a launch blocker.

## Previous convoy correction — 2026-10-05, after owner exception RED

Status stays `in-progress`; correction is authored, not PG-verified or complete.
The owner explicitly approved TWO extra invocations of ONLY
`tests/integration/outbox-repository.test.ts`. Main ran exception 1 (logical run 4)
at 14:28:54 UTC: **exit 1, 23/24**. Only the actual convoy regression failed
(expected two free deliveries, observed zero). All three previously fixture-blocked
financial/residual scenarios passed. The settlement-interval correction now has PG
evidence. Log: `.superpowers/sdd/2026-10-05-client-async-authority/owner-exception-1-red.log`.
Exactly ONE exception invocation remains, exclusively MAIN-operated after frozen
patch review/static checks. No implementer PG/concurrency/inline/full-suite run.

Bounded mechanism: cleanup returns busy IDs, excluded by both claim queries without
changing their ordering/bot predicates. Client admission keeps document→subject→row
lock order, with 10 ms document/subject and 1000 ms row/authority lock waits. Existing
post-wait lease/deadline checks and their 600–650 ms regression barriers are unchanged.
Only PostgreSQL lock-busy `55P03` is deferred; other errors still surface. Admission
rolls back before exact owner/token/attempt/key-fenced release. Only a claim with no
current attempt facts AND no unresolved prior start can return to pending and undo
its claim-only attempt increment. No started/not_applied/unknown fact or financial
mutation is invented. If the source row is also locked, bounded scoped expiry
recovery makes that same transition after unlock; durable starts retain the existing
unknown-outcome path. Runner deferral emits existing `no_op`/`internal`, not terminal,
retry or unknown labels. Cleanup exclusion alone was rejected as insufficient.

Eight additional SAME-file PG cases are authored and UNEXECUTED: post-claim subject,
authority and outbox contention across plain/metrics runners (six), plus preservation
of started client uncertainty across both recovery APIs (two). They check free-subject
dispatch before unlock, repeated contention at maxAttempts=1, no invented attempt or
usage facts, unchanged reservation, bot partitioning and eventual delivery. No case
was moved/renamed or existing financial/freshness assertion weakened.

Changed this round: `packages/contracts/src/client-consent-authority.ts`,
`packages/db/src/repositories/outbox-repository.ts`, `packages/worker/src/outbox-runner.ts`,
`tests/integration/outbox-repository.test.ts`, this spec, its plan, operations doc and
existing ignored task ledger/logs. Parent spec and `AGENT-STATUS.md` remain main-owned
and untouched. Main's ordinary-safe launch-route amendment is context only; no
signature provider, personal free-text activation or other product-scope implementation.

Static/build evidence is logged as `convoy-*.log` in the existing task directory.
Four-package build and package typechecks (contracts/db/worker/app-worker) exited 0;
initial test-project typecheck and four-file lint exited 0. Final test-only checks
follow the added started-uncertainty cases; their exact exits belong in the freeze
handoff/ledger. These checks cannot establish PostgreSQL locking correctness.
Remaining gates: independent read-only patch review, main's single final allowed PG
invocation, and separate product/release evidence. All writes freeze for that handoff.

Current outbox budget is **4 logical invocations: original 3/3 + exception 1/2**,
latest 23/24. All other counts below are unchanged; no additional authority for
any other PG file. Earlier stops and evidence below are historical, not current claims.

## Previous closure continuation — 2026-10-05 12:21 UTC (historical)

Status remains `in-progress`: this is a bounded local patch, NOT verified completion
or release readiness. The three independent initial reviews were collected; subsequent
closure reported three material consumer defects. Dispositions in this round:

1. Final immutable usage/trial `not_applied` now returns the existing terminal
   reconciler object with `provider_not_applied`, rather than the retryable transport
   string. The actual registry and runner tests show no retry or redispatch. Unknown,
   contradictory and applied facts, and unrelated transport retry semantics remain.
2. Client-only runtime recovery is owned by the configured filtered runner, and the
   production factory prefers its repository over the unfiltered fallback. Actual
   production factory/runtime tests cover client-only, combined and no-runner modes,
   including independent jobs. These are synthetic DB/repository boundary tests,
   NOT evidence of actual persistence, bot isolation in PostgreSQL, or lock behavior.
3. Cleanup convoy remains OPEN. Its actual runner/dispatch-progress/no-loss PG
   reproduction is authored in the SAME existing outbox file and explicitly
   UNEXECUTED. Cleanup/admission production SQL is unchanged in this round. A partial
   busy-ID exclusion would not close the post-cleanup lock race; no unverified
   production fix is substituted for the required PG RED.

The existing settlement-interval fixture correction is applied but UNVERIFIED.
Latest actual outbox PG evidence is still exit 1, 20/23; all three failures were setup
failures before the financial/residual assertions. Main requested at most TWO extra
invocations of that file (convoy RED then correction GREEN), superseding the earlier
one-run request. No owner answer or PG/concurrency authorization has been received.
Zero PG/concurrency invocations occurred in this continuation, including files with
unused historical capacity. Never rename, copy or bypass the exhausted PG cases.

### Selected non-PG verification

Commands ran individually from the repository root; logs are under
`.superpowers/sdd/2026-10-05-client-async-authority/closure-*`.

| Command                                                                                                                            | Invocations this continuation | Exact result                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm exec vitest run apps/worker/src/client-async-reconciliation-review.test.ts`                                                  | 2                             | RED 3/4, exit 1 (one retry and redispatch); GREEN 4/4, exit 0                                                      |
| `pnpm exec vitest run apps/worker/src/client-async-runtime-review.test.ts`                                                         | 3                             | RED 2/3, exit 1 (other-bot recovery); GREEN 3/3, exit 0; fixture-typing-only final rerun 3/3, exit 0               |
| `pnpm exec tsc --noEmit -p tsconfig.tests.json`                                                                                    | 2                             | First exit 2: synthetic registry returned a string instead of its required object; corrected fixture, final exit 0 |
| `pnpm --filter @ii-tonya/db --filter @ii-tonya/worker --filter @ii-tonya/app-worker --workspace-concurrency=1 -r --sort run build` | 1                             | Exit 0, all three packages                                                                                         |
| Same three package filters with `run typecheck`                                                                                    | 1                             | Exit 0, all three packages                                                                                         |
| `pwsh -File scripts/check-development-environment.ps1`                                                                             | 1                             | Exit 0; Node 24.21.0, pnpm 11.9.0                                                                                  |

The reconciliation test exercises the real registry/runner with synthetic facts and
repository state, not a moved PG case. Only the runtime fixture changed after its
first GREEN; only that unit file was rerun. No full/multipath suite was run.

### Current PG invocation ledger (unchanged)

| Focused file                                                          | Logical runs        | Latest evidence                                                       |
| --------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------- |
| `tests/integration/outbox-repository.test.ts`                         | 3/3 exhausted       | 20/23, exit 1; corrected fixture and new convoy regression unexecuted |
| `tests/integration/consent-egress-gate.test.ts`                       | 3/3 exhausted       | 7/7, exit 0                                                           |
| `tests/integration/hybrid-message-gateway-b2.test.ts`                 | 3/3 exhausted       | 6/6, exit 0                                                           |
| `tests/integration/client-consent-async-fencing.test.ts`              | 3/3 exhausted       | 20/20                                                                 |
| `tests/integration/test-expert-trial-postgres.test.ts`                | 3/3 exhausted       | 7/7                                                                   |
| `tests/integration/privacy-workflow.test.ts`                          | 3/3 exhausted       | 3/3                                                                   |
| Navigation replay / catalogue-worker / client-backup-erasure-evidence | 3/3 each, exhausted | Inherited evidence; no rerun                                          |
| `tests/integration/hybrid-message-gateway-b1.test.ts`                 | 1/3                 | 9/9; further runs prohibited                                          |
| `tests/integration/hybrid-message-gateway-b3.test.ts`                 | 1/3                 | 5/5; further runs prohibited                                          |
| `apps/api/src/routes/telegram-client-b1.integration.test.ts`          | 1/3                 | 5/5; further runs prohibited                                          |

### Files changed in this continuation

- `packages/db/src/repositories/client-consent-authority.ts`
- `packages/worker/src/outbox-runner.ts`
- `apps/worker/src/main.ts`
- `apps/worker/src/runtime.ts`
- `apps/worker/src/client-async-reconciliation-review.test.ts` (new, non-PG)
- `apps/worker/src/client-async-runtime-review.test.ts` (new, non-PG)
- `tests/integration/outbox-repository.test.ts` (regression authored only)
- This spec, its linked plan and `docs/operations/client-async-authority.md`
- Existing ignored task ledger and local command logs

Main owns `AGENT-STATUS.md`; it was not edited by this continuation. Earlier patches,
backup/web fixes, all financial assertions and the frozen pre-continuation diff are
preserved. No schema/dependency/provider/activation/commit/push/deploy operations.
Execution, TDD and review-reception skills guided the bounded RED/GREEN work; their
whole-suite, commit and delegated-review steps do not override this handoff.
Independent patch closure, actual PG evidence for the three financial/residual
scenarios and the convoy defect remain blockers. All writes freeze after the allowed
checks and ledger update; no automatic continuation while authorization is pending.

## Previous verification stop — 2026-10-05 06:57 UTC (historical)

Status remains in-progress. This section supersedes earlier initial-implementation
green claims and run counts below. The review patch is NOT verified or complete,
and no new commit, push or deployment followed it. Production remains4354818.

Three independent initial reviews were completed and13 consolidated patch findings
were assigned. The code patch and new regressions are present; independent closure
has not occurred. Initial reports, full diff and triage are retained in
`/tmp/ii-tonya-async-rc.f8bLcK/review-reports.json`,
`review-initial.diff` and `review-findings.json`.

Final permitted outbox PG invocation: exit1,20/23 tests passed,3/3 invocations
exhausted. The three failures are fixture setup failures in `reviewBudget`, before
asserting authoritative budget nonapplication, reply/outcome serialization, or the
real residual producer-to-runtime-to-response path. The fixture supplied an interval
inconsistent with `expert_order_settlement_interval`. It now uses one SQL
`now()` instant and end=start+30days. This correction is applied but UNVERIFIED.
Database constraints and financial assertions are unchanged.

The coordinator requested one explicit owner exception for one additional run of
only `tests/integration/outbox-repository.test.ts`; no exception has been received
at this checkpoint. Do not run a fourth invocation, rename the cases, or substitute
inline PostgreSQL diagnostics. If the owner authorizes it, run only that exception,
then obtain independent patch closure before considering publication/deployment.
A green result would not complete the full factory/provider/legal/product gates.

Updated PG counts: outbox-repository3/3 (20/23 FAIL), consent-egress-gate3/3
(7/7 PASS), hybrid-message-gateway-b2 3/3 (6/6 PASS). Async fencing, trial,
privacy workflow, navigation, catalogue worker and backup evidence each remain3/3
exhausted. B1/B3/API-B1 remain1/3. No full/multipath suite was repeated.

Budget-conflict unit1/1, runner unit1/1 and metrics unit2/2 passed. Five-package
build/typechecks, tests typecheck and patch lint passed before the final fixture-only
correction. These do not verify the three blocked financial/residual scenarios.
Raw failure and success logs are retained in the task's existing local evidence directory.

Main independently ran the frozen initial contract9/9, Selarti dispatcher7/7,
Telegram dispatcher8/8 and API typecheck before this review patch. Those are
initial-slice evidence, not post-patch verification. The implementer stopped all
writes/tests on request; no automatic continuation is running.

## Intent

Implement CT-012 against the existing real client producers, outbox worker and Selarti response path. A later grant cannot revive an old job; withdrawal and durable dispatch-start share one transaction ordering; late response content must be rejected before persistence. Existing checks only read current consent and have check/start and regrant gaps.

## Boundaries and ownership

One writer, no providers, production calls/deletes, schema/dependencies, finance-policy changes or autoactivation. Preserve navigation terminal receipts and unrelated contractual/financial/expert topics. Owner has authorized implementation and later main-operated release, not invented external evidence. Do not claim special-category admission is ready.
Own new packages/contracts/src/client-consent-authority.ts + barrel; packages/db/src/repositories/consent-current.ts (SOLE oracle), new client-consent-authority.ts helper, db barrel; hybrid-message-repository.ts, test-expert-telegram-repository.ts, selarti-proposal-repository.ts, outbox-repository.ts, privacy-repository.ts for shared locking/fencing only; packages/worker/src/outbox-runner.ts, telegram-send-text-dispatcher.ts, existing Selarti request dispatcher/registry and narrow relevant tests; packages/observability/src/metrics.ts and telemetry-schema.ts only for required finite Selarti outbox topic/phase/reason enum additions, with focused validation tests; apps/worker/src/main.ts composition and tests; tests/integration/client-consent-async-fencing.test.ts and necessary existing focused fixtures/expectations and packages/db/src/testkit fixture helpers only if shared consent setup requires genuine document/projection records; docs/operations/client-async-authority.md, this spec/plan.

## Original authority contract

Server-authored strict versioned stamp stored in existing outbox JSONB:
v=1, subjectId UUID, purpose entries {decisionId UUID, revision positive decimal string}.
Use a closed purpose set, no duplicates/extras; PostgreSQL bigint precision cannot pass through Number. Exact original decision resolves document/version/basis/scope; text_sha256 is DOCUMENT digest, not message digest. Capture once under subject lock before content persistence/enqueue. Required purposes derive from server-owned operation: ordinary Telegram reply requires client_messaging; Selarti request and its reply retain client_messaging+selarti_ai_processing. Never upgrade unstamped historical jobs with current grants.

Validation checks active subject, dialogue/channel ownership, original decision/revision equal current consent_states, granted state AND existing currentConsentGrantedSql tie-fail-closed journal oracle plus exact policy/document requirements. Projection alone is not authority. Keep documented messaging-vN alias for matching approved version; no new derivation outside consent-current. Missing/invalid/unknown stamp/projection/evidence/expired scope denies. If scope expiry needs a not-yet-existing binding, preserve that gap explicitly and keep capability off.

Capture in both Hybrid and test-expert trial producers; carry unchanged into Selarti-derived Telegram jobs. Preserve request IDs, reconciliation/budget/ingress hashes; add stamp to Telegram envelope hash and exact decoder. Do not send stamp to Telegram/AI. No global optional flag that re-enables unfenced client send.

## Atomic start and locking

Resolve candidate subject without row locks, acquire existing subject advisory
hashtextextended(canonical_user_uuid_text,0), then re-read/lock source and authority before outbox mutations. Stable purpose/row order. Fix current Hybrid identity/user-before-advisory inversion and proposal-before-subject inversion. Preserve document-table-before-user ordering if touched; do not acquire catalogue locks.

Use READ COMMITTED post-lock authoritative queries or SERIALIZABLE with locking reads/bounded serialization retries; never authorize from a snapshot established before waiting. Never put network calls in retried transaction.

Claim grants no send authority. recordAttemptStarted atomically validates exact lease/owner/claimToken/attempt/reconciliation key, locks original authority under subject barrier, and records started once. Return explicit durable admission (or blocked, no dispatch). Same attempt admission cannot authorize a second send. Runner cannot dispatch without matching admission. Keep unrelated topic contracts intact. Last-minute dispatcher validates receipt/binding instead of a separate boolean allowsSend(dialogueId) that reopens a race.

The committed durable start is the logical linearization boundary. Withdrawal winning first blocks; start winning first is potentially irreversible even if a crash precedes first network byte. Preserve unknown-outcome/reconciliation: no false unsent claim, automatic release of reserved units, or blind retry. Do not promise PostgreSQL and external HTTP atomicity.

## Withdrawal, stale work, responses

Existing withdrawal lock+revision commit invalidates dependent stamps, including revoke→regrant. Terminalize only provably unstarted invalid work with a fixed reason, bounded batches; stale ordered rows must not block later freshly authorized sequence forever. Processing/started/unknown/reconciling work retains uncertainty and accounting evidence.

Selarti accept resolves durable original request before proposal locks, then subject lock and post-lock recheck: request/thread/tenant/dialogue, original stamp, durable provider start evidence, no authoritative not-applied outcome, and deadline using actual server/DB time after any wait. No current-grant restamp. Rejected/late/stale response yields no body persistence or Telegram job. Existing duplicate/conflict result must not recreate effects.

Finance is separate from content: current trial acceptance settles units and reconciliation infers provider application from proposal existence. Rejected content cannot imply not-applied/refund/release. Preserve unknown reservations unless existing authoritative provider outcome establishes otherwise; if a minimal evidence-only provider outcome is required, use existing outcome tables with strict authenticated request binding, no text. Do not silently weaken financial tests.

## Runtime

composeB2TelegramDelivery currently has no production caller; default registry excludes selarti.request.v1. Wire the fenced default-off path only when complete configured dependencies are present. Require fencing for client delivery; missing capability fails readiness rather than using legacy dispatch. Cover both claim and claimWithMetrics. The current runner's metricTopic and registry acceptedTopics enumerate only operator/catalogue/Telegram topics; extend those exact closed contracts for Selarti rather than introducing an arbitrary-topic fallback or letting metrics throw after a financial operation. Preserve the content-free telemetry contract. Keep actual deployment flags off until remaining signature/provider/retention gates are met. Redacted source payloads deny new processing while reconciliation remains possible.

## Verification

- [ ] Meaningful RED: old queued work must stay invalid after revoke→regrant; old expectation in consent-egress-gate allowing pregrant work after grant must be replaced with no replay plus fresh-stamp success.
- [ ] New PG file controlled barriers for both start/withdraw orderings, both accept/withdraw orderings, restart-after-start, stale lease token, repeat admission, missing/malformed stamp/projection, bigint>2^53, tied decisions, ownership mismatch, no response body on reject, unknown trial units preserved.
- [ ] Producer tests show capture before write and unchanged propagation; legacy unstamped operations fail closed. Existing hybrid B1/B2/B3 and test-expert trial fixtures currently often insert journal-only grants; update relevant trusted fixtures to create real valid document/evidence/projection records rather than teaching production to accept missing projection or weakening financial assertions. Run affected existing focused files individually within their own run limits; do not claim the unrun full suite passed.
- [ ] Runner/dispatcher tests prove no network with blocked admission and no unsafe retry; unrelated topics retain financial/idempotency behavior.
- [ ] Default composition tests exercise real fenced registration, not only helper exports.
- [ ] Each focused file individually; max3 PG/concurrency invocations across the logical CT task, keep a run count. The aggregate has already been used and interrupted; no full/multipath command. Current exhausted counts and the prohibition on any further PG/concurrency run are recorded above; unused historical capacity is not authorization.
- [ ] Builds/typechecks/lint/format/diff, exact failures/results in spec, independent review pending, freeze ALL repository writes.

## Initial slice results (historical; superseded above)

Implemented locally from baseline `045a2de303b0191c5f345a7d3c2bd3d6ca09eb2d`. No commit, push, deploy, provider call, activation, migration, dependency change, nested writer or new worktree. Earlier backup-proof/clock/locking and web fixes are untouched. Independent review belongs to main; this is not release evidence.

### Behavior and implementation decisions

- Strict original authority is captured under the subject lock in Hybrid and test-expert producers, including both purposes for Selarti. Existing ingress/request/budget identities are preserved. Telegram envelope hashes include the stamp.
- The sole oracle also resolves exact original evidence against the projection, immutable approved document, consumed presentation, canonical policy/version, basis, and channel/dialogue ownership. Revisions remain decimal strings throughout. A later grant cannot revive an old stamp.
- Durable admission binds lease, owner, claim token, attempt, reconciliation key and complete payload digest. Duplicate admission blocks. Runner requires the matching receipt; dispatch consumes it once in the existing attempt journal. HTTP is outside all retried transactions.
- Bounded cleanup only terminalizes invalid rows with no prior durable start. The ordered Telegram barrier applies in both claim APIs. Unknown/started work and trial units retain uncertainty.
- Response acceptance takes the subject barrier before proposal locks, verifies original request/start/authority, and uses actual database time after waiting. Rejected content does not persist or settle trial units. Existing proposal duplicates/conflicts remain terminal receipts after source redaction.
- Ruling: only the existing unscoped `{}` consent shape is admitted. Nonempty/expiry-bearing scope fails closed because no reviewed scope-expiry binding exists; a capability requiring it remains off.
- Ruling: the referenced existing Selarti outbox dispatcher was absent in the baseline. Added a narrow wrapper requiring a trusted request-mapping transport, with no guessed endpoint/provider identity. Missing dependencies fail readiness; default capabilities remain absent.
- The real trial producer regression exposed a pre-existing NUL in its PostgreSQL advisory-lock text parameter. Hashing the same tuple before passing it to PostgreSQL fixes that failure; delivery/request keys and finance rules are unchanged.
- Execution/TDD skills were used. Their commit/worktree/review-dispatch/whole-suite steps were overridden by the explicit handoff. No story key: no sprint synchronization.

### Exact verification and budgets

All commands below ran from the repository root. PostgreSQL invocations used
`node .superpowers/sdd/2026-10-05-client-async-authority/run-pg.mjs <one-file>`.
That local runner supplies `II_TONYA_TEST_POSTGRES_ADMIN_URL` privately from the
explicit local `ii-tonya-completion-pg-20261005` PostgreSQL 17.5 fixture, calls
`pnpm exec vitest run <one-file>`, and creates/drops only its random test database.
No secret values are recorded here.

| Focused PostgreSQL file                                               | Logical invocation count | Results                                                                                              |
| --------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `tests/integration/client-consent-async-fencing.test.ts`              | **3/3 exhausted**        | Run 1 meaningful RED: old queued reply claimed after regrant. Run 2: 16/16. Run 3: 20/20.            |
| `tests/integration/hybrid-message-gateway-b1.test.ts`                 | 1/3                      | 9/9                                                                                                  |
| `tests/integration/hybrid-message-gateway-b2.test.ts`                 | 2/3                      | Run 1: 5/6, redacted duplicate incorrectly rejected. Run 2: 6/6 after fixing terminal replay lookup. |
| `tests/integration/hybrid-message-gateway-b3.test.ts`                 | 1/3                      | 5/5, financial assertions preserved                                                                  |
| `tests/integration/test-expert-trial-postgres.test.ts`                | **3/3 exhausted**        | Run 1: 6/6. Run 2: 6/7, newly exercised real producer failed on NUL lock key. Run 3: 7/7.            |
| `tests/integration/consent-egress-gate.test.ts`                       | 1/3                      | 5/5; pregrant replay expectation replaced by no replay + fresh-stamp success                         |
| `tests/integration/outbox-repository.test.ts`                         | 1/3                      | 10/10                                                                                                |
| `apps/api/src/routes/telegram-client-b1.integration.test.ts`          | 1/3                      | 5/5                                                                                                  |
| `tests/integration/privacy-workflow.test.ts`                          | **3/3 exhausted**        | 2 inherited + 1 here; latest 3/3 tests                                                               |
| Navigation replay / catalogue-worker / client-backup-erasure-evidence | **3/3 each, inherited**  | Zero additional invocations here                                                                     |

The third async-file invocation had already started at 06:18:40 UTC before main's
request to reserve it. It added actual production-factory dispatch, one-time receipt
consumption after withdrawal, unknown-trial-unit preservation, and a deadline crossed
during a controlled subject-lock wait. It was not an unchanged reconfirmation.
Do not run it again under this task's existing budget.

Individual non-PG commands:

| `pnpm exec vitest run <one-file>`                           | Latest result                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/contracts/src/client-consent-authority.test.ts`   | 9/9; initial 8/9 exposed fractional-string BigInt conversion, fixed with nonthrowing validation |
| `packages/worker/src/telegram-send-text-dispatcher.test.ts` | 8/8                                                                                             |
| `packages/worker/src/selarti-request-dispatcher.test.ts`    | 7/7                                                                                             |
| `packages/worker/src/outbox-runner.test.ts`                 | 1/1 (closed metrics and unrelated local topics)                                                 |
| `apps/worker/src/b2-telegram-composition.test.ts`           | 3/3; initial 1/3 proved missing readiness checks                                                |
| `packages/observability/src/client-async-metrics.test.ts`   | 1/1; initial 0/1 proved Selarti metric rejection                                                |

Additional verification:

- `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`: PASS; Node 24.21.0, pnpm 11.9.0, Docker/Compose available.
- `pnpm --filter @ii-tonya/contracts --filter @ii-tonya/db --filter @ii-tonya/worker --filter @ii-tonya/observability --filter @ii-tonya/app-worker --workspace-concurrency=1 -r --sort run build`: PASS, all five packages, including ESM and declaration output.
- Same five filters with `run typecheck`, plus `pnpm exec tsc --noEmit -p tsconfig.tests.json`: PASS after the final ordered build; all five package typechecks and the test-project typecheck exited 0.
- `pnpm exec eslint <all 31 changed/new TypeScript files listed below>`: PASS. Initial lint found one unused compatibility parameter, explicitly consumed without changing fencing.
- `pnpm exec prettier --check <same files> docs/operations/client-async-authority.md`: PASS.
- `git diff --check`: PASS.
- Initial `@ii-tonya/worker-app` filter matched no project and is **not** verification; corrected to `@ii-tonya/app-worker`. One app typecheck overlapped a dependency rebuild and saw the old barrel; the subsequent correctly ordered app check passed.
- No full/multipath suite was run. The inherited interrupted aggregate remains interrupted, not green. No external Trust CI/Database Gate/release receipt is claimed.

Raw local logs remain under `.superpowers/sdd/2026-10-05-client-async-authority/`.
They are ignored local test evidence, not committed release artifacts.

### Changed files

- `apps/api/src/routes/telegram-client-b1.integration.test.ts`
- `apps/worker/src/b2-telegram-composition.test.ts`
- `apps/worker/src/main.ts`
- `apps/worker/src/runtime.ts`
- `packages/contracts/src/index.ts`
- `packages/db/src/index.ts`
- `packages/db/src/repositories/consent-current.ts`
- `packages/db/src/repositories/hybrid-message-repository.ts`
- `packages/db/src/repositories/outbox-repository.ts`
- `packages/db/src/repositories/privacy-repository.ts`
- `packages/db/src/repositories/selarti-proposal-repository.ts`
- `packages/db/src/repositories/test-expert-telegram-repository.ts`
- `packages/observability/src/metrics.ts`
- `packages/worker/src/index.ts`
- `packages/worker/src/outbox-runner.ts`
- `packages/worker/src/telegram-send-text-dispatcher.test.ts`
- `packages/worker/src/telegram-send-text-dispatcher.ts`
- `tests/integration/consent-egress-gate.test.ts`
- `tests/integration/hybrid-message-gateway-b1.test.ts`
- `tests/integration/hybrid-message-gateway-b2.test.ts`
- `tests/integration/hybrid-message-gateway-b3.test.ts`
- `tests/integration/test-expert-trial-postgres.test.ts`
- `apps/worker/src/client-async-outbox.ts`
- `packages/contracts/src/client-consent-authority.ts`
- `packages/contracts/src/client-consent-authority.test.ts`
- `packages/db/src/repositories/client-consent-authority.ts`
- `packages/db/src/testkit/client-consent.ts`
- `packages/observability/src/client-async-metrics.test.ts`
- `packages/worker/src/selarti-request-dispatcher.ts`
- `packages/worker/src/selarti-request-dispatcher.test.ts`
- `tests/integration/client-consent-async-fencing.test.ts`
- `docs/operations/client-async-authority.md`
- `docs/superpowers/implementation-artifacts/spec-client-async-authority.md`
- `docs/superpowers/plans/2026-10-05-client-async-authority.md`

Ignored task-local ledger, runner and logs were also created under the workspace above.
Unrelated pre-existing untracked files were preserved.

### Suggested Review Order

1. `consent-current.ts` and `client-consent-authority.ts`: original evidence, policy aliases, projection precision, lock order and post-wait reads.
2. `outbox-repository.ts`, runner and dispatchers: exact admission, one-use receipt, stale cleanup and unknown-outcome preservation.
3. Hybrid/trial producers and Selarti response repository: capture before writes, unchanged propagation, duplicate/redacted replay, deadline and trial accounting.
4. Actual worker factory/runtime, exact registry/metric vocabulary, and focused PG race/fixture evidence.

### Remaining risks and review limits

This is an application fence, not a DB constraint against arbitrary SQL or old binaries.
Mandatory immutable stamps against those writers require a separate migration and
coordinated rollout. The start/HTTP gap remains potentially irreversible by design.
Unsupported scopes/expiry bindings, real signing/special-category admission, provider
mapping/attestations, approved legal documents, retention and external release gates
remain open and cannot be filled by these synthetic tests. Default runtime flags remain
off; the trusted Selarti transport is an injection boundary and no live mapping was
implemented or called. The real trial deterministic producer and financial response
path were exercised; a full real-provider/trial-residual end-to-end flow and the
unrun full suite are not claimed. All requested independent reviews remain pending.

## Execution handoff

Implement in this existing isolated codex branch; do not create another worktree, commit, push, deploy or spawn a writer. Read execution/TDD skills. Main owns external operations and independent review; one repository writer total. No story_key so sprint sync skips. Never infer paid/provider authority from consent or rejected-content paths.

Production at handoff is4354818c0187d41057b9660deb847e15a002a574; local baseline045a2de includes only its evidence/continuation docs after that source. Do not alter existing backup proof/clock/locking or web fixes. Main handles ops while you are the sole repository writer. Runtime registry/metrics ownership may include narrowly necessary adjacent composition files and barrels, but report any material architecture/policy conflict before choosing a different business rule.
