# Project Connectivity Inventory

Companion inventory for `project-connectivity-graph.md`. It records repository-level entities that are easy to miss in a runtime-only dependency diagram and classifies their connectivity status.

## Root and workspace control plane

| Entity                | Graph connection                                         | Status                                 |
| --------------------- | -------------------------------------------------------- | -------------------------------------- |
| `package.json`        | CI / verification entrypoint -> all workspaces           | ACTIVE                                 |
| `pnpm-workspace.yaml` | workspace topology -> apps/packages                      | ACTIVE                                 |
| `pnpm-lock.yaml`      | frozen dependency graph -> CI/build                      | ACTIVE                                 |
| `tsconfig.base.json`  | TypeScript build/typecheck -> all TS workspaces          | ACTIVE                                 |
| `vitest.config.ts`    | unit/integration/e2e/repo test discovery                 | ACTIVE                                 |
| `.env.example`        | config/env policy -> API/worker composition              | ACTIVE POLICY; live integrations false |
| `.gitignore`          | secret/env hygiene -> env-policy tests                   | ACTIVE POLICY                          |
| `AGENTS.md`           | agent execution/test constraints -> development workflow | ACTIVE POLICY                          |
| `README.md`           | repository orientation -> source/spec/handoff/graph      | ACTIVE DOC                             |

## CI, automation, deployment, and server control

| Entity                                            | Graph connection                                                                               | Status                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `.github/workflows/ci.yml`                        | verification in constrained Claw container, coverage, secret scan, container smoke, provenance | ACTIVE; self-hosted Claw                                           |
| `.github/workflows/db-gate.yml`                   | migrations/schema + repeated expert financial concurrency/deadline/replay                      | ACTIVE; self-hosted Claw                                           |
| `.github/workflows/release.yml`                   | signed provenance -> staged release evidence -> release                                        | ACTIVE POLICY; manual, self-hosted Claw; provider activation gated |
| `.github/workflows/server-control.yml`            | manual explicit refusal; no checkout or command execution                                      | DISABLED; cannot deploy                                            |
| `.github/workflows/server-native.yml`             | disabled legacy native-deploy recovery reference                                               | DISABLED; cannot deploy                                            |
| `ops/server-command.sh`                           | retained native recovery implementation; not workflow-reachable                                | LEGACY/HISTORICAL                                                  |
| `scripts/bootstrap-native-runner.sh`              | retained bootstrap history for the offline native runner                                       | LEGACY/HISTORICAL                                                  |
| `Dockerfile`                                      | packaged runtime -> CI container smoke                                                         | ACTIVE                                                             |
| `compose.yaml`                                    | local packaged stack -> verification                                                           | ACTIVE                                                             |
| `deploy/compose.remote.yml`                       | release mechanics                                                                              | ACTIVE but gated                                                   |
| `deploy/claw/Dockerfile.test`                     | exact test environment                                                                         | TEST/EVIDENCE                                                      |
| `deploy/claw/Dockerfile.test.dockerignore`        | exact test container build                                                                     | TEST/EVIDENCE                                                      |
| `deploy/runtime.env.example`                      | deployment env contract                                                                        | ACTIVE POLICY                                                      |
| `scripts/check-development-environment.ps1`       | clean-machine toolchain validation                                                             | ACTIVE DEV TOOL                                                    |
| `scripts/preflight-expert-referral-migration.mjs` | migration readiness/preflight                                                                  | ACTIVE RELEASE TOOL                                                |
| `scripts/run-claw-container-tests.sh`             | remote/container verification                                                                  | ACTIVE TEST TOOL                                                   |
| `scripts/validate-runtime-env.sh`                 | runtime fail-closed env validation                                                             | ACTIVE RELEASE TOOL                                                |
| `scripts/repeat-vitest.mjs`                       | bounded local repeats / CI stability gate                                                      | ACTIVE TEST TOOL                                                   |
| `scripts/deploy-compose-remote.sh`                | migration/deploy/rollback mechanics                                                            | ACTIVE RELEASE TOOL; gated                                         |

The native server control plane deploys the application shell to a self-hosted server, but its generated runtime environment keeps Selarti, Planerka, Telegram, LLM, Make, Sheets, intent model, and payments disabled. It is therefore `ACTIVE OPS`, not a live-provider business path.

## Application and package roots

All workspace roots are represented in the canonical graph and have containment plus actual dependency edges. Package-level orphan count is zero.

| Root                     | Primary role                              | Production connectivity                                    |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------- |
| `apps/api`               | HTTP/webhook composition                  | application/config/db/integrations/observability           |
| `apps/worker`            | bounded background lifecycle              | config/db/integrations/observability/worker                |
| `packages/application`   | deterministic use cases + prompt boundary | API/worker -> contracts/domain                             |
| `packages/config`        | validated environment                     | both apps                                                  |
| `packages/contracts`     | typed cross-boundary contracts            | application/db/integrations/worker                         |
| `packages/db`            | PostgreSQL authority                      | both apps + worker/application paths                       |
| `packages/domain`        | pure rules/properties                     | application/db/worker                                      |
| `packages/integrations`  | external boundary adapters/contracts      | both apps/db/worker                                        |
| `packages/observability` | logging/tracing/metrics                   | both apps                                                  |
| `packages/worker`        | bounded job orchestration                 | app-worker -> application/contracts/db/domain/integrations |

## Expert referral / residency implementation coverage

Connected areas:

- API: expert referral routes, admin routes, Telegram webhook.
- Application: referral/residency/admin services, code crypto/key resolver, prompt context and typed proposals.
- DB: referral/control/admin/residency/provider-inbox/worker repositories and trusted transaction capability.
- Integrations: Telegram adapter/callback token and provider-neutral residency payment contracts.
- Worker: residency expiry, reconciliation, held-reward replay.
- Observability: bounded referral/residency metrics.
- Database: migrations `0018`–`0022`, snapshots/journal, expert referral/residency relations/views.
- Verification: unit, integration concurrency/deadline/reversal/hold, e2e lifecycle, repo scope/env/workflow guards.
- Operations: traceability, runbooks, rollback, security addendum, reconciliation policy.

## Non-runtime, historical, and dead/deferred classification

| Entity class                                  | Classification        | Why it stays connected                                        |
| --------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| `docs/test-evidence/claw/*`                   | EVIDENCE              | Exact-SHA environment/results for audit and recovery.         |
| `.superpowers/sdd/*`                          | EVIDENCE / HISTORICAL | Progress/remediation history.                                 |
| `docs/handoffs/*`                             | EVIDENCE              | Clean-machine continuation/recovery.                          |
| completed plans/specs                         | EVIDENCE              | Requirement/decision traceability.                            |
| old migrations/snapshots                      | LEGACY/HISTORICAL     | Clean migration replay and schema parity.                     |
| disabled payment adapter                      | DISABLED              | Explicit fail-closed contract.                                |
| disabled expert payment provider reader       | DISABLED              | Prevents accidental live network authority.                   |
| worker unknown-outcome placeholder            | DISABLED              | Lifecycle slot retained while providers are off.              |
| worker privacy placeholder                    | DISABLED              | Capability not composed.                                      |
| generic provider reconciliation placeholder   | DISABLED              | No approved live provider reader.                             |
| client `500/500` coupon executable runtime    | DEFERRED              | Separate product scope; must not share expert referral logic. |
| waitlist runtime                              | DEFERRED              | Outside current release.                                      |
| expert reschedule composite runtime           | DEFERRED              | Outside current release.                                      |
| live payment-provider SDK/network composition | PROHIBITED            | Scope guards reject it pending separate approval.             |
| authoritative Make/Sheets writes              | PROHIBITED            | PostgreSQL is transactional authority.                        |
| direct LLM DB/financial mutation              | PROHIBITED            | Typed proposal + deterministic reauthorization.               |

## Orphan and dead-code rule

`ORPHAN-CANDIDATE` means a production file/symbol has no static/dynamic/runtime/test/config reference and no valid evidence, migration, policy, disabled-boundary, or deferred-scope role.

Current architecture-level result:

- Workspace package orphans: **0**.
- Composition-root orphans: **0**.
- Known expert referral/residency subsystem orphan modules: **0**.
- Native server-control assets: **retained and classified; deployment entrypoints disabled**.
- Intentional non-live nodes: explicitly marked in graph and inventory.
- File/symbol-level deletion: **never automatic**. A removal decision requires static references plus review of dynamic imports, package exports, Fastify registration, migrations, workflows/scripts, test entrypoints, and evidence retention.

Future true orphans must first be added to `project-connectivity-graph.md` as `ORPHAN-CANDIDATE` before removal. Dead code is made visible, not silently dropped.
