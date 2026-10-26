---
name: release-readiness
description: Use for release, deployment, migration rollout, canary, rollback, or final go/no-go preparation.
---

# Release Readiness

Bind the final tree/commit to current verification and review receipts. Check:

- immutable build artifact and provenance;
- migrations and compatibility window;
- feature flags and staged rollout;
- smoke/E2E/contract evidence;
- SLI/SLO, dashboards, alerts, and support visibility;
- rollback/forward-fix and data recovery;
- ownership, runbook, and go/no-go criteria.

Produce a release decision report. Conditional AGENTS L5 permits repository merge, tag and release only after green required checks on the exact head, independent review and resolved threads. Record exact action/resource grants; never bypass branch protection.

After go/no-go, run `python3 scripts/getzilla_deploy.py`. Use `--record` only with a valid production approval. Production mutation, deploy, external writes and human security approvals require separate scoped authority. Do not deploy from this skill.
