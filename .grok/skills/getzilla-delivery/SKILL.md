---
name: getzilla-delivery
description: Use for routed software-development tasks. Keep one writer, independent review, exact-source evidence and the external merge gate.
---

# Getzilla delivery

Read `.getzilla/runtime/active-route.json` and load its workflow skills. Use only selected agents. Keep exactly one writer per isolated task; review fixes return to that writer. Measure startup capacity before dispatch and bound concurrent workers to that capacity. Dispatch all independent selected analyses in one wave, then synthesize their findings before implementation. Give each analysis the route ID, canonical root, selected package, narrow question and runtime report destination.

The initial route is provisional. After committing source and before reviewer dispatch, run `python3 scripts/getzilla_route.py --reconcile --json`. The complete assessment binds the trusted comparison bases, HEAD/tree, rule digest and review plan. Each change has one ordinary code review covering correctness and test adequacy. Security, data and release audits require both a changed sensitivity category and risk threshold from the diff policy; prompt wording and repository domains do not select them. Incomplete source inventory blocks qualification. The final verifier rederives the plan and rejects stale evidence.

Retain explicitly selected additional reviews with `python3 scripts/getzilla_route.py --reconcile --add-reviewer test_reviewer --add-reviewer release_reviewer`. This only adds review obligations and their dispatch authority. Legacy routes retain their selected wave automatically. Operational gates, grants, writer and analysis authority remain separately bound.

## Light lane

A route with `delivery_lane: light` is provisional. The verifier admits it only from a complete, clean Git comparison: at most 50 added plus deleted code lines, excluding ordinary tests and non-executable Markdown/RST/text. It checks sensitive paths before these exclusions. Control files, hooks, runtime code, Trust CI, migrations, dependencies, locks and CI require the full lane. Binary, rename, submodule, unknown and incomplete inventories also require the full lane. Medium/high risk or a larger diff restores the full review floor.

For an admitted small change, keep scope and acceptance in the task or PR. Do not create a change package. Add a failing regression, implement the change, and run focused checks. Commit source once. Have one independent code reviewer inspect code and tests. Save the report to `.getzilla/runtime/reviews/<route-id>/code-review.md`. Run `python3 scripts/getzilla_verify.py --mode fast`; the measured selector must admit the change. CI retains its full suite and exact-head merge gate.

## Full lane

1. Run `python3 scripts/getzilla_change.py start`. New packages live in `.getzilla/runtime/changes/<id>/` and are ignored by Git. Existing tracked packages remain readable history; commands copy them into runtime before new writes.
2. Record scope, acceptance, design, tests, rollout and rollback in the package. Dispatch independent selected analyses and save concise findings in `<package>/evidence/analysis-<agent>.md`. When a named human gate lacks approval, present the concrete decision and stop before its dependent action. Existing explicit owner decisions remain valid within their scope. Record the scoped/approved lifecycle transitions with `getzilla_change.py transition`; ordinary tasks with no named gate proceed after the bounded design.
3. The selected writer adds a failing test, implements the bounded change, and runs focused checks. Keep exact commands and outcomes in runtime evidence.
4. Commit the source candidate and reconcile its review plan. Dispatch all selected independent reviewers against that exact HEAD/tree. Reviewers return reports out-of-band and do not modify the candidate. Save reports in the runtime package evidence directory or `.getzilla/runtime/reviews/<route-id>/`.
5. Run one final `python3 scripts/getzilla_verify.py --mode pr`, or the existing focused landing mode when its closed inventory qualifies. Do not shorten the comparison range. Record skips as skips. No report-only or workflow-state freeze commit is needed.
6. After the gate passes, record each passing report with `python3 scripts/getzilla_review.py <kind> --status pass --report <runtime-report> --reviewed-commit <exact-full-sha>`. Runtime reports must be ignored, regular, non-executable UTF-8 Markdown using the conventional review names. The receipt binds route/change, exact reviewed HEAD/tree and content hash; consumption rechecks them. Any source commit or report-content change stales the receipt.
7. Run `python3 scripts/getzilla_status.py`; completion requires zero evidence gaps. Runtime state may transition to ready without changing source. Deliver through a PR with the required external exact-head checks. Local evidence never replaces merge authority, branch protection or human security approvals.
8. Before you end the task, record every Getzilla defect you met (a bug, a wrong refusal, a broken check, a doc that does not match the code, costly friction), also the ones you worked around. Follow the "Getzilla defects" rule in `AGENTS.md`: an issue in `Dimkox/Getzilla` when that is allowed, otherwise a ready issue text for the owner.

## Evidence and handoff

Store state, startup snapshots, analyses, reviews and verification output outside Git. At most one concise summary may be tracked per change. Keep durable product contracts, canonical docs and source in Git. Export portable local evidence with `python3 scripts/getzilla_evidence.py --output .getzilla/runtime/exports/<change-id>.zip`; attach it separately to a PR or publish the concise findings in PR comments. The bounded archive contains source identities and hashes, never approval grants or keys. Importing an archive does not activate receipts.

Public CI exports its own actual run logs, startup snapshot, verification report when produced, state and exact source provenance. It retains artifacts for 30 days. A fresh runner does not have workstation analyses or reviews and labels them unavailable. Do not claim they were rerun or uploaded by CI.

Historical tracked review receipts retain their old report-only-delta validation. Do not rewrite historical evidence or pinned fixtures to adopt the new layout.

## Review and authority

Review security, duplicate external writes/idempotency and tests. Keep reports short. Code and test reviewers use bounded, change-relevant mutation probes; reproduce the exact candidate snapshot in scratch. Unsafe scratch, a mismatched snapshot or modified candidate makes the review inconclusive/stale. A failed check or finding returns to the selected writer. Run useful mutation probes in reviewer-owned private scratch under the canonical root's `.getzilla/runtime`, outside the reviewed candidate, with a trusted non-sticky parent and mode 0700. Record reviewed HEAD/tree before and after, `reviewed-tree-modified: no`, commands, outcomes and unexecuted claims. Inconclusive probes are not passes.

Protected edit grants name exact files and bind the branch, repository, route, change and TTL. Approved-file commits retain the grant; other changes, another branch or expired TTL invalidate it. Production/external grants retain exact HEAD/tree binding and separate authority. Follow conditional AGENTS L5 for merge, tag and release; `getzilla_deploy.py` remains prepare-only without separate authorization. If review or verification cannot run, record NOT_RUN or BLOCKED and its reason. Never fabricate approvals, independent reports or successful receipts. An explicit owner override of a local rule records the rule, scope, reason, deferred checks and follow-up; label the result UNVERIFIED until those checks run. It never bypasses external exact-head checks, branch protection or human private-key authority.

After a tool denial, do not repeat it unchanged. One semantic correction is allowed. A second denial for the same objective is a blocker; report the named action and reason. Request a protected-path grant only for exact targets identified by the hook.

Reviewers return the complete report to the coordinator out-of-band. After all reviews finish, save reports outside Git and run one final qualifying gate. Use one canonical project root. Put private scratch outside the reviewed candidate and outside the reviewed worktree, beneath that root's `.getzilla/runtime`. Record HEAD and tree fingerprint before/after, scratch path, `reviewed-tree-modified: no`, exact commands and observed output. Report killed, survived and inconclusive mutants and all unexecuted claims. Read-only configuration is not an OS-enforced isolation boundary.

## Tool-denial circuit breaker

Never repeat an identical denied invocation. One semantic rewrite is allowed. If that also fails, report the blocked objective and stop dependent work. An opaque denial requires explicit targets before requesting a protected-path grant.
