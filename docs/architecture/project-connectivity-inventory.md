# Project Connectivity Inventory

Companion inventory for `project-connectivity-graph.md`. This file records repository-level entities that are easy to miss in a runtime-only dependency diagram and classifies their connectivity status.

## Root and workspace control plane

| Entity | Graph connection | Status |
|---|---|---|
| `package.json` | CI / verification entrypoint -> all workspaces | ACTIVE |
| `pnpm-workspace.yaml` | workspace topology -> apps/packages | ACTIVE |
| `pnpm-lock.yaml` | frozen dependency graph -> CI/build | ACTIVE |
| `tsconfig.base.json` | TypeScript build/typecheck -> all TS workspaces | ACTIVE |
| `vitest.config.ts` | unit/integration/e2e/repo test discovery | ACTIVE |
| `.env.example` | config/env policy -> API/worker composition | ACTIVE POLICY; all live flags false |
| `.gitignore` | secret/env hygiene -> env-policy tests | ACTIVE POLICY |
| `AGENTS.md` | agent execution/test constraints -> development workflow | ACTIVE POLICY |
| `README.md` | repository orientation -> source/spec/handoff/graph | ACTIVE DOC |

## CI, automation, and deployment

| Entity | Graph connection | Status |
|---|---|---|
| `.github/workflows/ci.yml` | `pnpm verify`, coverage, secret scan, container smoke, image scan, provenance | ACTIVE; hosted runner currently infrastructure-blocked |
| `.github/workflows/db-gate.yml` | migrations/schema + repeated concurrency/deadline/replay tests | ACTIVE; hosted runner currently infrastructure-blocked |
| `.github/workflows/release.yml` | signed provenance -> staging evidence -> release | ACTIVE POLICY; deployment remains unauthorized |
| `Dockerfile` | packaged runtime -> CI container smoke | ACTIVE |
| `compose.yaml` | local packaged stack -> test/container verification | ACTIVE |
| `deploy/compose.remote.yml` | release mechanics | ACTIVE but gated |
| `deploy/claw/Dockerfile.test` | exact test environment evidence | TEST/EVIDENCE |
| `deploy/claw/Dockerfile.test.dockerignore` | exact test container build | TEST/EVIDENCE |
| `deploy/runtime.env.example` | deployment env contract | ACTIVE POLICY |
| `scripts/check-development-environment.ps1` | clean-machine toolchain validation | ACTIVE DEV TOOL |
| `scripts/preflight-expert-referral-migration.mjs` | migration readiness/preflight | ACTIVE RELEASE TOOL |
| `scripts/run-claw-container-tests.sh` | remote/container verification | ACTIVE TEST TOOL |
| `scripts/validate-runtime-env.sh` | runtime fail-closed env validation | ACTIVE RELEASE TOOL |
| `scripts/repeat-vitest.mjs` | bounded local repeat / CI 20x stability gate | ACTIVE TEST TOOL |
| `scripts/deploy-compose-remote.sh` | migration/deploy/rollback mechanics | ACTIVE RELEASE TOOL; gated |

Any executable automation not in the reviewed allowlist is rejected by repository scope tests. This is why scripts are not treated as casual or orphan files.

## Application and package roots

All workspace roots are represented in the main graph and have a containment edge from the repository root plus actual dependency edges. Package-level orphan count is zero.

| Root | Primary role | Production connectivity |
|---|---|---|
| `apps/api` | HTTP/webhook composition | Connected to application/config/db/integrations/observability |
| `apps/worker` | bounded background lifecycle | Connected to config/db/integrations/observability/worker |
| `packages/application` | deterministic use cases + prompt boundary | Connected from API/worker; to contracts/domain |
| `packages/config` | validated environment | Connected from both apps |
| `packages/contracts` | typed cross-boundary contracts | Connected from application/db/integrations/worker |
| `packages/db` | PostgreSQL authority | Connected from both apps/application workers; to contracts/domain/integrations |
| `packages/domain` | pure rules/properties | Connected from application/db/worker |
| `packages/integrations` | external boundary adapters/contracts | Connected from both apps/db/worker |
| `packages/observability` | logging/tracing/metrics | Connected from both apps |
| `packages/worker` | job orchestration | Connected from app-worker; to application/contracts/db/domain/integrations |

## Expert referral / residency implementation coverage

The following implementation areas are connected to both their runtime owner and verification owner:

- API: expert referral routes, admin routes, Telegram webhook.
- Application: referral service, residency service, admin service, code crypto/key resolver, prompt context and typed proposal validation.
- DB: referral/control/admin/residency/provider-inbox/worker repositories and transaction capability.
- Integrations: Telegram adapter/callback token and provider-neutral residency payment contracts.
- Worker: residency expiry, reconciliation, held-reward replay.
- Observability: bounded referral/residency metrics.
- Database: migrations `0018`–`0022`, snapshots/journal, 16 expert referral/residency relations/views.
- Verification: package tests, integration concurrency/deadline/reversal/hold tests, e2e release-candidate lifecycle, repo scope/env/workflow guards.
- Operations: traceability, runbooks, rollback, threat-model addendum, reconciliation policy.

## Non-runtime, historical, and dead/deferred classification

| Entity class | Classification | Why it stays connected |
|---|---|---|
| `docs/test-evidence/claw/*` | EVIDENCE | Exact-SHA environment/results are required for audit and recovery. |
| `.superpowers/sdd/*` | EVIDENCE / HISTORICAL | Progress and remediation history explain prior decisions; not runtime. |
| `docs/handoffs/*` | EVIDENCE | Clean-machine continuation/recovery path. |
| completed implementation plans/specs | EVIDENCE | Traceability baseline; not runtime. |
| old migrations/snapshots | LEGACY/HISTORICAL | Required for replay and schema parity. |
| disabled payment adapter | DISABLED | Fail-closed implementation boundary; deleting it would remove the explicit disabled contract. |
| disabled expert payment provider reader | DISABLED | Prevents worker from silently obtaining live network authority. |
| worker unknown-outcome placeholder | DISABLED | Lifecycle slot intentionally retained while providers are off. |
| worker privacy placeholder | DISABLED | Capability not composed; shutdown/lifecycle contract remains explicit. |
| generic provider reconciliation placeholder | DISABLED | No approved provider reader exists. |
| client `500/500` coupon executable runtime | DEFERRED | Separate product scope; must not share expert referral storage/logic. |
| waitlist runtime | DEFERRED | Explicitly outside current release. |
| expert reschedule composite runtime | DEFERRED | Explicitly outside current release. |
| live payment-provider SDK/network composition | PROHIBITED | Scope guards reject it until separate provider approval. |
| authoritative Make/Sheets writes | PROHIBITED | PostgreSQL remains transactional authority. |
| direct LLM DB/financial mutation | PROHIBITED | Typed proposals and server-side reauthorization are mandatory. |

## Orphan and dead-code rule

`ORPHAN-CANDIDATE` is reserved for a production file/symbol with no static/dynamic/runtime/test/config reference and no explicit evidence, migration, policy, disabled-boundary, or deferred-scope role.

Current architecture-level result:

- Workspace package orphans: **0**.
- Composition-root orphans: **0**.
- Expert referral/residency subsystem orphan modules: **0 known**.
- Intentional non-live nodes: explicitly marked in the graph and table above.
- File/symbol-level unreferenced code: **not auto-deleted**. A definitive deletion decision requires static reference analysis plus review of dynamic imports, package exports, Fastify registration, migrations, workflow/script references, test-only entrypoints, and documentation/evidence retention.

If a future scan finds an orphan candidate, it must be added to `project-connectivity-graph.md` with `ORPHAN-CANDIDATE` before removal. This prevents dead code from becoming invisible during cleanup.
