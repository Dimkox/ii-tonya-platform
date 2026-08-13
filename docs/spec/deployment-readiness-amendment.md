# Deployment readiness amendment

Status: native release implementation in verification; live target activation remains
blocked. Owner: release owner. Deployment approval: human production reviewer.

GitHub Actions are not used. GitHub stores Git and pull requests only. Exact-SHA gates
run directly on Claw in a constrained container that imitates the dedicated production
server. Production itself is native and container-free.

| ID     | Requirement                                                                                                                                  | Implementation                                             | Verification / evidence                                                    | Deployment boundary                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| DR-001 | Only an exact commit that passed direct Claw CI and Database Gate may enter release assembly.                                                | `scripts/run-claw-ci.sh`                                   | `tests/repo/workflow-semantics.test.ts`, committed exact-SHA Claw evidence | Merge remains a separate repository action.                 |
| DR-002 | The native API/worker bundle is deterministic, checksummed, inventory/SBOM scanned, signed, and provenance-bound to the same SHA.            | `scripts/build-native-release.sh`                          | `tests/repo/native-production-release.test.ts`, native staging evidence    | Missing scan/signature evidence keeps release blocked.      |
| DR-003 | Production runs native Node.js services through hardened systemd, system PostgreSQL, and nginx; no app container or Compose path is allowed. | `deploy/systemd`, `scripts/deploy-native-remote.sh`        | native staging rehearsal, readiness and reconciliation                     | Docker remains dev/direct-Claw test only.                   |
| DR-004 | Claw application/database tests run in a constrained container with live features disabled.                                                  | `compose.yaml`, `/home/pall/app-stack` test profile        | `tests/repo/release-assets.test.ts`                                        | Test-container health is not production evidence.           |
| DR-005 | PostgreSQL URLs use one unambiguous secure `sslmode`; runtime secrets remain outside Git and release bundles.                                | `packages/config/src/env.ts`, `deploy/runtime.env.example` | config and release-asset tests                                             | Production credentials remain root-owned host state.        |
| DR-006 | Migration preflight, reconciliation, rollback drill, restore drill, YooKassa staging evidence, and accountable approvals exist before GO.    | native deploy/rollback scripts and runbooks                | go-live/provider evidence records                                          | GO remains blocked until dated evidence and approval exist. |

## Recovery

The immutable prior native release directory is the application rollback target. Database
changes remain forward-fix only. Restore the prior `current` symlink, restart the same
systemd units, then run smoke and reconciliation. Never rebuild during an incident.
