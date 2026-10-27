# Phase 0 local development evidence

Status: local implementation and independent review completed; external and
repository-wide acceptance gates remain open. This is not a release acceptance record.
Worktree: `.worktrees/phase1-owner-plan-20261023`.
Branch: `codex/phase1-owner-plan-20261023`.
Source base: `031ae46065b58223a2b6cd47e002b388a41ec89c`.
Owner-plan commit: `d32da25dcdaf54ceb2039049ab348b3b54e9e2d4`.

## Authority and isolation

Owner instructed separate-tree execution, then Phase 0. Owner explicitly chose
existing financial authority plus an application table, and confirmed an existing
test merchant whose protected settings they will configure separately.
The primary checkout's uncommitted changes were not copied or modified.
No push, merge, deployment, live flag change, merchant request, shared-database
migration, or physical-erasure execution occurred.

## Environment

`pwsh -File scripts/check-development-environment.ps1 -RequireDocker`: PASS.
Node24.22.0, pnpm11.9.0, PowerShell7.6.7, Docker29.9.2, Compose5.6.1.
`pnpm install --frozen-lockfile`: PASS, lockfile unchanged.
Required workspace dependency builds: PASS; config was built separately after
initial typechecks identified missing fresh-tree declaration output.
`pnpm hooks:check`: active shared pre-push hook; no bypass or push occurred.

## P0.1

See `docs/spec/phase0-geography-audit.md` for exact audit boundary and retained
operator/legal/source occurrences. Primary environment audit printed counts only.
Web build, final web typecheck, scoped ESLint and Prettier: PASS. Initial typecheck
attempts failed before required workspace declaration builds; those failures were
resolved by building pinned dependencies, without weakening types or settings.

## P0.2

First focused PostgreSQL17.5 run: 14 failed, expected absent table (RED).
Second focused run: 13 passed, one failed because raw timestamp was a string, while
the test expected a Date. The assertion was corrected. Independent inspection also
corrected the draft archive date column to precise UTC timestamps.
Final third focused run: **18/18 PASS**, including full PostgreSQL constraint/index
catalogue equality, precise UTC calendar bounds, target-only erasure, and rollback.
The focused PostgreSQL budget is exhausted; no further run is authorized.

Schema metadata: RED absent export, then GREEN1/1.
State/provenance guard: 15/15 PASS.
DB package and tests typechecks, targeted lint/format/diff: PASS before review fixes.
Final state/provenance guard after the verified manifest update: **15/15 PASS**.
New snapshot/supplement/manifest extend the existing baseline by hand; no generation.

Existing guard failures retained for diagnosis:

- migration-history integrity: 7/8, missing baseline0050 function registrations;
- initial scope guard: 120/123, relation/hash drift across earlier components;
- final staged scope guard: **121/123**, two failing assertions. The recursive
  scanner reports243 violations, including21 inherited unregistered relations
  repeated in the new0051 full snapshot. These are real unresolved guard findings,
  not a passing result or a claim that every final finding was present at the parent.
  No global relation allowlist was widened to hide them.

Additive0051 path/relation/hash registrations were added. After independent review,
exact hashes were refreshed only for this change's three YooKassa source files,
the changed migration journal, and the new0051 manifest. Unrelated stale hashes and
the grandfathered gap/bigint lists were preserved. No mismatch detector was weakened.
The recorded guard commands do not establish a baseline test run at the parent SHA;
source inspection identifies older content, and no parent-suite rerun was performed.
Schema logs are retained under `.superpowers/sdd/phase0-schema-20261023/` locally.

## P0.3

Before review: deletion adapter13, deletion ingress4, keyed security helper2,
existing logger20 passed. API/observability/tests typechecks and scoped static checks
passed. Independent review found replay/rebinding and atomic-authorization gaps;
these initial greens are not acceptance evidence for the corrected implementation.

Initial existing `telegram-webhook.test.ts`: 42/43. The ct2 fixture predates this
patch but incorrectly selects booking while asserting legacy callbacks. Independent
review confirmed the stale fixture and separate booking coverage. Only the payload
was changed to `legacy.safe_callback_token`; all authorization/inbox/process
assertions remain. Final second invocation: **43/43 PASS**.

Review remediation now uses atomic PostgreSQL intake with stable numeric-bot/update
replay identity, user/identity row locks and pinned original ownership. Private
HMAC receipt disclosure requires an unrevoked matching stored digest; existing
browser receipts and changed owners cannot receive a different token. Replies use
verified stages. Wrong-bot HTTP200 rejections emit keyed security events.

New focused PostgreSQL file: invocation1 failed before collection (Fastify import
resolution; no PG evidence); invocation2 replayed17.5 and demonstrated RED8fail/1pass
against the previous repository; final invocation3 **10/10 PASS** on corrected code.
It covers real repository plus HTTP/buildApp, dual feature gates, actual foreign-bot
and mismatched-chat DB identities, inactive owners/identities, concurrent acceptance,
rebinding, revocation under locks, receipt revocation/browser ownership, and secret/
path rotation. This PG file budget is exhausted.

Final adapter13, new remediation10, adapted ingress4 PASS. The non-PG ingress file
was rerun after the reviewed interface redesign; the earlier blanket unit3 limit
was a conservative planning choice, not the repository PG/concurrency policy.
No PG/concurrency file exceeded3. Final API/DB/tests typechecks, focused ESLint,
Prettier and whitespace checks passed.

## P0.4

Verifier RED4 failures/11passes, then GREEN15/15; capability RED4 failures/9passes,
then GREEN13/13. API webhook11/11. Integrations build/typecheck, lint/format/diff passed.
Independent review requested terminal inconsistency/unknown-operation coverage.
Third runs passed **16/16** each, then the independent reviewer confirmed closure.
Both focused file budgets are exhausted. No payment implementation changed in
that coverage correction.
No merchant API was called. The placeholder profile uses mode=test with disabled
flags. External HTTPS delivery, actual test merchant subscription/events, receipts,
mode binding and recovery remain unverified.

## Independent review and outstanding gates

Three read-only review layers ran: adversarial, edge cases, verification gaps.
Edge-case review returned no findings. Confirmed issues were fixed and rechecked by independent reviewers. All material
local findings are closed in source and focused verification. Default full lifecycle
boot is not covered by the factory/buildApp tests; active backup policy and genuine
completed-job proof remain a separately composed external gate.

Physical erasure, processor/backup proof, external YooKassa delivery and successful
exact-SHA CI/Database Gate are separate gates. Local fixture success does not satisfy
them. Phase 1 must not bypass critical Phase 0 dependencies.

## Final static verification

Coordinator final staged TypeScript ESLint and tests TypeScript check passed.
Formatting initially identified only whitespace in the two new JSON state
artifacts; Prettier corrected it, corresponding manifest/approved hashes were
refreshed, and state/provenance15/15 passed again. Parsed snapshot/catalogue content
was unchanged, so no exhausted PostgreSQL file was rerun. Direct verification of
all8 changed/new approved artifact hashes passed. Frozen dependency files and
local environment values are unchanged.

## Committed review checkpoint

Implementation SHA: `be3dfb270680aeed748e1769088fd7dbe573a51b`. Independent adversarial reviewer
rechecked this exact local commit and found no remaining blocking source finding
in the reviewed scope.

`MIGRATION-COMPATIBILITY: be3dfb270680aeed748e1769088fd7dbe573a51b`

This is a technical compatibility assessment, not a GitHub approval, release
authorization, external-provider proof or exact-SHA CI success. The reviewer ran
no tests; focused command evidence above belongs to the implementing agents and
coordinator. Scope/history failures and all stated external gates remain open.
