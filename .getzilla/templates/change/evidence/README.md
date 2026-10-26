# Evidence

Store human-readable review reports here. Machine receipts live under `.getzilla/runtime/receipts/` and are bound to the current repository fingerprint.

`state.json` holds canonical local checkpoints and explicit evidence accounting. A `not_run` reason explains unfinished work; a recorded result is self-reported and does not satisfy a passing receipt. Checkpoints are observations in this worktree, and become available to another clone only when separately exported and attached.

New-package and first-implementation observations are appended below by the lifecycle commands. A pending README mirror is surfaced in status and can be retried with the same explicit lifecycle command; state and README publication is not a two-file atomic transaction.

Code and test review reports perform bounded, change-relevant mutation probes in a reviewer-owned private scratch copy outside the reviewed worktree. Keep the reviewed candidate read-only; use scratch below a trusted non-sticky parent with mode `0700`. Reproduce the exact candidate (HEAD and relevant staged, unstaged, and untracked changes), record its HEAD and tree fingerprint before/after, and treat unsafe or mismatched snapshots and changed fingerprints as stale/inconclusive. Make the copy with `getzilla cleanup snapshot <commit>` and remove it with `getzilla cleanup snapshot --remove <path>` when the report is returned. Reviewer read-only configuration is not an OS-enforced isolation boundary.

Delivery order: bounded checks, commit source, independent reviews, save reports outside Git, then one final qualifying local gate. Record receipts only after the final gate passes.

Reviewers return the complete report to the coordinator out-of-band. After all reviews finish, the coordinator saves reports here without changing the source commit. Runtime report receipts bind exact reviewed HEAD/tree, route/change and the report hash. A new source commit or edited report makes prior receipts stale. Runtime state updates do not change source. Never reuse evidence from another tree.

Each report must include:

- source identity: HEAD and candidate tree fingerprint;
- scratch path and `reviewed-tree-modified: no`;
- each claim probed, exact command, concise observed output, and mutant outcome (`killed`, `survived`, or `inconclusive`);
- claims not executed and why; static claims without executable probes are unexecuted;
- surviving mutants as findings or explicit limitations (no blanket mutation-score threshold unless a scoped policy requires it).

New evidence belongs to this ignored runtime package. Preserve exact source identity and commands. Do not commit reports or freeze workflow state. Export a bounded archive with scripts/getzilla_evidence.py for PR attachment; CI artifacts contain only actual CI-run evidence and expire after 30 days.
