# Claw verification — sandbox payment provider — 2026-08-13

Status: **INCOMPLETE / NO-GO**

## Identity and constraints

- Documentation checkpoint: `7214ae93a04e99993b190dfd881c34bd1eced22a`
- Claw test image used by Tasks 1–5: `7d71646347d560ff2b5d8ebc4c0aad5b48230254`
- Task 6 pinned offline builder image: `sha256:a8f8d4bb072b4ef94f5cdf36a077a3be158bc314282c37fe026ffbe468746cb8`
- Constraint: 1 CPU, 1 GiB memory; repeat count never exceeds 3.
- No production smoke, deployment, push, provider connection, or credential use occurred.

## Evidence summary

| Area | Result | Evidence |
|---|---|---|
| Tasks 1–4 contracts, persistence, verifier/adapter, approvals, separate API | Approved | `.superpowers/sdd/task-1-report.md` through `task-4-report.md` |
| Task 5 settlement/refund lifecycle | Conditional; focused PostgreSQL/E2E and reconciliation green | `.superpowers/sdd/task-5-report.md` |
| Task 6 code/config and static isolation | Approved by independent re-review | `.superpowers/sdd/task-6-report.md` |
| Offline sandbox image build | BLOCKED | Full hydration timed out at 480s; narrowed hydration timed out at 240s |
| Cleanup | PASS | Zero task containers and processes after both bounded attempts |
| `SBX-TST-009` container lifecycle | NOT RUN | No sandbox image was produced |
| Production packaged-image smoke/inventory | NOT RUN | Reserved one-time smoke was not consumed |
| Vulnerability scan, SBOM, signing, provenance | NOT RUN | No final image/final exact-SHA gate |
| Provider-connected staging | BLOCKED | Sandbox evidence is not provider evidence |
| Production | NO-GO | Final acceptance is incomplete |

Task 5 recorded: focused E2E/reconciliation `3/3` tests passed; reconciliation repeated three times for `6/6`; final focused regressions passed `42/42`, `48/48`, and `45/45` at their recorded task commits. These are historical task-level results, not a fresh aggregate result at this documentation checkpoint.

Task 6 recorded static results: release-assets `16/16`, Compose parse, shell/Node syntax, and cleanup passed. No claim is made that a packaged sandbox or production runtime was inspected.

## Required next builder commands

Run only on Claw after the pinned offline store contains every required tarball. Do not increase the 1 CPU/1 GiB limit and do not consume production smoke until the sandbox image succeeds.

```bash
git rev-parse HEAD
git status --short
export SOURCE_SHA="$(git rev-parse HEAD)"
export VCS_REF="$SOURCE_SHA"
export SOURCE_ARCHIVE_SHA="<independently calculated source archive sha256>"
export SANDBOX_IMAGE_REF="ii-tonya-sandbox-smoke:$SOURCE_SHA"
bash scripts/build-sandbox-image-offline.sh
bash scripts/run-sandbox-container-smoke.sh
pnpm exec vitest run packages/sandbox-payments/src/repository.test.ts packages/sandbox-payments/src/workflow.test.ts packages/sandbox-payments/src/verifier.test.ts packages/sandbox-payments/src/adapter.test.ts apps/sandbox-api/src/server.test.ts apps/sandbox-api/src/routes.test.ts tests/e2e/sandbox-payment-provider.test.ts tests/integration/sandbox-payment-reconciliation.test.ts tests/repo/sandbox-production-isolation.test.ts --maxWorkers=1
pnpm test:repeat -- 3 tests/integration/sandbox-payment-reconciliation.test.ts
```

After sandbox success, run the production packaged-image smoke exactly once, then scan both immutable image digests, generate/verify signed SBOM and provenance, and run the exact-head CI and Database Gate. Record commands, durations, pass counts, image IDs/digests, scan result, and cleanup without raw logs or secrets.

## Release decision

Provider staging remains `BLOCKED`. Production remains `NO-GO`. This file cannot authorize either environment.
