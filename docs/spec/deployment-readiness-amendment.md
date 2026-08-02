# Deployment readiness amendment

Status: independent re-review passed after remediation; hosted verification pending.
Owner: release owner. Deployment approval: human production-environment reviewer.

This amendment hardens the disabled foundation into a release candidate without
claiming that a target environment, provider staging, or production approval
exists. It does not authorize deployment or enable any live capability.

| ID     | Requirement                                                                                                                                                                                                                | Implementation                                               | Verification / evidence                                                           | Deployment boundary                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| DR-001 | Only a successful push CI run for `main` may create release provenance or enter the release workflow.                                                                                                                      | `.github/workflows/ci.yml`, `.github/workflows/release.yml`  | `tests/repo/workflow-semantics.test.ts`, actionlint, exact-SHA CI                 | Merge and protected-main policy remain human/repository controls.                       |
| DR-002 | Both immutable image digests must fail the release gate on every HIGH or CRITICAL Trivy finding, including findings without a published fix.                                                                               | `.github/workflows/ci.yml`                                   | `tests/repo/release-assets.test.ts`, main push CI                                 | An accepted exception requires a dated owner decision; no implicit waiver exists.       |
| DR-003 | Both immutable image digests must have SPDX JSON SBOMs signed with keyless Cosign, hash-bound in signed provenance, retained with it, and verified against the SPDX container subject before release.                      | `.github/workflows/ci.yml`, `.github/workflows/release.yml`  | `tests/repo/release-assets.test.ts`, provenance artifact on main push CI          | Release verification consumes the exact main-run artifact.                              |
| DR-004 | API, worker, migration, provider-stub, and smoke containers must use a read-only root filesystem, `/tmp` tmpfs, all-capability drop, `no-new-privileges`, and a PID limit; evidence-only Node containers must be non-root. | `compose.yaml`                                               | `tests/repo/release-assets.test.ts`, container smoke in CI                        | Target-specific orchestrator policy must preserve or strengthen these controls.         |
| DR-005 | PostgreSQL URLs must use one unambiguous `sslmode=require`, `verify-ca`, or `verify-full`; plaintext local evidence requires the explicit `ALLOW_INSECURE_LOCAL_DATABASE=true` flag and a bounded local hostname.          | `packages/config/src/env.ts`, `.env.example`, `compose.yaml` | `packages/config/src/env.test.ts`                                                 | Production should prefer `verify-full`; credentials and CA material remain outside Git. |
| DR-006 | Staging and production adapters, migration preflight, reconciliation, rollback drill, restore drill, provider evidence, and accountable approvals must exist before GO.                                                    | fail-closed `release.yml` steps and runbooks                 | `docs/runbooks/go-live-evidence.md`, `docs/runbooks/provider-staging-evidence.md` | Still BLOCKED until the deployment target and owners are supplied.                      |

## Acceptance criteria

1. Repository tests and actionlint pass after every change.
2. PR CI, Database Gate, secret scanning, and container smoke pass on the exact
   candidate SHA.
3. After merge, main push CI produces signed image digests, strict Trivy results,
   signed SBOMs, and signed provenance bound to that exact main SHA.
4. A release remains fail-closed while DR-006 lacks dated evidence and human
   approval.

## Recovery

The immutable prior signed digest is the application rollback target. Database
changes remain forward-fix only. Target-specific commands, traffic control,
worker fencing, smoke, reconciliation, and the restore drill must be added to
`docs/runbooks/rollback.md` and `docs/operations/disaster-recovery.md` when the
deployment platform is selected.
