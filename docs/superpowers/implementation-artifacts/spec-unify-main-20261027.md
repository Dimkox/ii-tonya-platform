---
title: Consolidate main-target release candidate branches
created: "2026-10-27"
type: chore
status: in-review
baseline_commit: 13edda58769e8b00e8d407da821b8ab009a8fb19
review_loop_iteration: 0
---

<frozen-after-approval reason="Owner explicitly requested consolidating pending PRs into main">

## Intent

**Problem:** GitHub has two open main-target pull requests, #101 and #106, carrying related commercial-review work on diverged histories. The owner requested a single integrated main rather than continuing separate release candidates.

**Approach:** Integrate both histories with current main on an isolated codex branch, resolve conflicts preserving both main features and newer candidate safeguards, verify the combined tree, obtain independent adversarial review, and merge the reviewed result into GitHub main. Close the superseded PRs only after their commits are included in main.

## Boundaries & Constraints

**Always:** Preserve current main landing SEO, booking lifecycle and waitlist behavior; preserve incoming privacy, authorization, financial authority and default-off capabilities. Preserve original committed SQL and evidence. Retain unrelated dirty checkout files. Use Node24/pnpm11.9.0 and frozen dependencies. No history rewrite or force push. Tests follow bounded execution rules; no repeated full/multipath suites.

**Ask First:** Destructive loss of unique user work or production activation requires separate explicit authorization.

**Never:** Deploy, enable providers/payments, fabricate successful release evidence, weaken migration integrity, commit secrets/local tool state, Owner subsequently explicitly authorized including Draft PRs110–116 after verification.

## I/O & Edge-Case Matrix

| Scenario               | Input / State                                            | Expected Output / Behavior                         | Error Handling                                          |
| ---------------------- | -------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| Branch integration     | main and PR101/106 histories                             | Both histories retained with current main features | Resolve conflicts explicitly and review combined result |
| Fresh database         | Empty isolated PostgreSQL17.5                            | Complete combined schema replays coherently        | Stop on replay/schema failure                           |
| Existing RC database   | Exact known committed migration prefix                   | Only remaining canonical migrations apply          | Reject mismatched hashes/timestamps                     |
| Diverged main database | Different historical migrations with overlapping numbers | No silent skipping or duplicate replay             | Fail closed with reconciliation guidance                |
| Working tree           | Existing uncommitted documents/local files               | Original files remain untouched                    | Keep isolated integration worktree                      |

</frozen-after-approval>

## Code Map

- `apps/web/src/landing-view.ts`, `content.ts`, `main.ts`, `apps/web/vite.config.ts`: combine prerendered SEO landing with lazy account/expert/privacy routes.
- `apps/api/src/app.ts`, `server.ts`, routes: preserve lifecycle and privacy/account route composition.
- `apps/worker/src/runtime.ts`, `main.ts`: combine lifecycle jobs with admitted provider delivery.
- `packages/db/migrations`, `packages/db/src/client.ts`: divergent0039–0041 history, canonical union and migration prefix preflight.
- `packages/db/src/repositories`, `schema`: reconcile lifecycle schema and consent authority implementations.
- `packages/config/src/env.ts`: default-off union of lifecycle and privacy settings.
- `packages/observability/src`: schema-projected redacted telemetry and fatal process handling.
- `tests/repo/migration-history-integrity.test.ts`: migration metadata and immutable-history invariants.
- `AGENT-STATUS.md`, `README.md`, financial policy docs: retain historical facts and latest owner financial decisions.

## Tasks & Acceptance

**Execution:**

- [x] Inspect live GitHub PR heads, bases and main; fetch current histories.
- [x] Create isolated `codex/unify-main-20261027` from current main.
- [x] Resolve conflicts in API/web/worker composition, packages and documents.
- [x] Preserve original migration SQL, construct canonical union and reject incompatible applied histories.
- [x] Verify frozen install, build, focused checks, types/lint, whitespace and migration replay.
- [x] Run independent review of exact combined tree; resolve material findings.
- [ ] Commit/push integration through repository gate and merge to main; verify GitHub SHA and PR states.

**Acceptance Criteria:**

- Given the two main-target PRs, when integration completes, then main exactly matches the reviewed union tree, original heads remain reachable in the preserved integration branch, and no original PR remains pending.
- Given current main functionality, when combined sources build and are checked, then landing/lifecycle behavior and privacy/payment safeguards remain represented and tested.
- Given divergent migration histories, when migration starts, then unknown history is rejected before any SQL application.
- Given unfinished draft PRs, when consolidation completes, then their work is retained and their status is reported accurately.
- Given deployment/provider configuration, when source integration runs, then no production mutation occurs.

## Spec Change Log

- Independent review exposed cross-branch behavioral seams: lifecycle payloads must capture the original consent authority for the strict dispatch gate; reschedule and waitlist mutation admissions must enforce current residency visibility; rescheduling a reservation with an existing Planerka provider operation must fail closed until a dedicated reconciliation contract exists. Preserve all existing default-off boundaries and add regression coverage.

- Owner explicitly expanded integration to all nine open PRs. Include dependent residency chain through c2077357 and preserve its canonical migrations through0069; append original RC availability as0070 and main lifecycle as0071–0073 after that chain. Existing initial0052–54 integration metadata is provisional and must be replaced before verification.

## Design Notes

Both PRs conflict with main and cannot be accepted with a blanket choice of one side. Main includes independently shipped landing and lifecycle changes; candidate branches include substantially newer consent and payment authority. Migration numbering collided after their common ancestor. A merged journal must retain a valid contiguous canonical sequence and preserve original SQL provenance, while existing incompatible databases must fail closed rather than using timestamps to silently skip migrations.

## Verification

- `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`: required toolchain and isolated database environment.
- `pnpm install --frozen-lockfile`: committed dependency graph only.
- `pnpm build`, relevant typechecks and ESLint: integrated compile and static checks.
- One bounded test invocation selected after final conflict resolution, plus focused PostgreSQL replay checks up to3 total.
- `git diff --check`, repository pre-push gate: whitespace, policy and automation checks.
- Read-only independent adversarial review: exact merged tree, migration compatibility, authorization and lost-main-feature checks.
- GitHub API and exact tree equality after squash: main matches the reviewed union, source ancestry is retained in the integration branch, and original PR states are terminal.

## Pre-publication verification checkpoint

All source fixes have focused green evidence and independent scoped review.
Owner-authorized additional run4 passed20/20and12/12; allowances consumed.
Final build/lint/full types/format/whitespace pass. Publishing and live GitHub
ancestry/PR-state verification remain the final execution task.

## Repository merge policy

GitHub rejected merge-commit publication because this repository allows only
squash (merge commits and rebases both disabled). Publish through PR117 using
squash, verify exact tree equality with the reviewed integration commit, then
close the nine original PRs as incorporated by117. Preserve the integration
branch so all nine original source heads remain reachable without rewriting
shared history. This changes the delivery mechanism, not the approved union.
