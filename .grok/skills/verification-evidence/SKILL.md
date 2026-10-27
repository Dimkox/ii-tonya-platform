---
name: verification-evidence
description: Use whenever tests, review, CI evidence, or completion claims must be checked and bound to the current repository state.
---

# Verification and evidence

Follow `.agents/skills/getzilla-delivery/SKILL.md`. Run bounded checks, commit source, collect selected independent reviews, save reports outside Git, then run one final qualifying local gate. A measured low-risk diff of at most 50 code lines may use the single-review light lane; unknown or sensitive inventories retain full gates. Full CI and external exact-head merge checks remain required.

Save new state, startup, analyses and reports under `.getzilla/runtime`. New packages use `.getzilla/runtime/changes/<id>/`; package-free reviews use `.getzilla/runtime/reviews/<route-id>/`. Do not create report-only or workflow freeze commits. At most one concise summary per change may be tracked. Preserve historical tracked packages and their existing source bindings.

PASS review receipts require `--reviewed-commit <exact-full-sha>`, clean source, a conventional non-executable regular Markdown report, exact HEAD/tree identity, route/change identity and a report-content hash. Recheck these at consumption. A new commit or report edit requires fresh evidence. Runtime state updates alone do not change the reviewed source. Record NOT_RUN/BLOCKED and the reason when a check cannot run; never invent a PASS.

Reviewers work read-only and return concise reports out-of-band. Bound mutation probes to private scratch below the canonical project's `.getzilla/runtime`, with a trusted non-sticky parent and mode 0700. Record source identity before/after, `reviewed-tree-modified: no`, exact commands, outcomes, mutant results and unexecuted claims. A changed candidate or incomplete snapshot makes the review stale.

`python3 scripts/getzilla_evidence.py --output .getzilla/runtime/exports/<id>.zip` exports bounded local observations with hashes for separate PR attachment. It excludes grants and keys and never activates imported receipts. CI artifacts contain only that runner's actual evidence, exact source provenance and CI state, retained for 30 days. CI explicitly labels workstation reviews/analyses unavailable.

Completion needs zero `getzilla_status.py` gaps and the external checks on the exact PR head. Local evidence and an owner override do not replace branch protection, exact production/external grants or human-signed security approval.

Reviewers return the complete report to the coordinator out-of-band. After all reviews finish, save reports outside Git and run one final qualifying gate. Use one canonical project root. Put private scratch outside the reviewed candidate and outside the reviewed worktree, beneath that root's `.getzilla/runtime`. Record HEAD and tree fingerprint before/after, scratch path, `reviewed-tree-modified: no`, exact commands and observed output. Report killed, survived and inconclusive mutants and all unexecuted claims. Read-only configuration is not an OS-enforced isolation boundary.
