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

| Entity                                            | Graph connection                                                              | Status                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| `.github/workflows/`                              | GitHub Actions                                                                | ABSENT BY POLICY; GitHub is Git/PR storage only     |
| `scripts/run-claw-ci.sh`                          | direct exact-SHA CI/database/release gates in constrained Claw test container | ACTIVE                                              |
| `scripts/build-native-release.sh`                 | exact-SHA native API/worker bundle + checksum/SBOM/provenance                 | ACTIVE; Claw assembly proven at `887c462`           |
| `scripts/provision-claw-syft.sh`                  | pinned, dual-SHA-verified SPDX generator for release mode                     | ACTIVE CLAW RELEASE TOOL                            |
| `scripts/deploy-native-remote.sh`                 | immutable native transfer, migration, systemd restart, readiness, rollback    | ACTIVE; production host confirmation still required |
| `deploy/systemd/ii-tonya-*.service`               | API, worker, and one-shot migration on dedicated server                       | ACTIVE NATIVE PRODUCTION CONTRACT                   |
| `Dockerfile`                                      | packaged dev/test runtime -> CI container smoke                               | TEST/EVIDENCE only                                  |
| `compose.yaml`                                    | local packaged stack -> verification                                          | DEV/TEST only                                       |
| `Dockerfile.sandbox`                              | isolated test-only sandbox API image                                          | TEST-ONLY; build evidence blocked                   |
| `compose.sandbox.yaml`                            | isolated sandbox API + PostgreSQL lifecycle                                   | TEST-ONLY; not production-connected                 |
| `scripts/run-sandbox-container-smoke.sh`          | marker-first lifecycle and cleanup                                            | TEST TOOL; SBX-TST-009 not run                      |
| `deploy/claw/Dockerfile.test`                     | exact test environment                                                        | TEST/EVIDENCE                                       |
| `deploy/claw/Dockerfile.test.dockerignore`        | exact test container build                                                    | TEST/EVIDENCE                                       |
| `deploy/runtime.env.example`                      | deployment env contract                                                       | ACTIVE POLICY                                       |
| `scripts/check-development-environment.ps1`       | clean-machine toolchain validation                                            | ACTIVE DEV TOOL                                     |
| `scripts/preflight-expert-referral-migration.mjs` | migration readiness/preflight                                                 | ACTIVE RELEASE TOOL                                 |
| `scripts/run-claw-container-tests.sh`             | remote/container verification                                                 | ACTIVE TEST TOOL                                    |
| `scripts/validate-runtime-env.sh`                 | runtime fail-closed env validation                                            | ACTIVE RELEASE TOOL                                 |
| `scripts/repeat-vitest.mjs`                       | bounded local repeats / direct Claw stability gate                            | ACTIVE TEST TOOL                                    |

The old Actions-runner bootstrap and monolithic server command remain in Git history only.
The approved production target is one dedicated Linux server with native Node.js API and
worker systemd units, system PostgreSQL, and nginx/TLS. Application containers are
dev/test-only. Claw uses a constrained container to imitate the server. The native
bundle/systemd path is the sole production release path; live integrations stay disabled.

## Application and package roots

All workspace roots are represented in the canonical graph and have containment plus actual dependency edges. Package-level orphan count is zero.

| Root                        | Primary role                                    | Production connectivity                                    |
| --------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `apps/api`                  | HTTP/webhook composition                        | application/config/db/integrations/observability           |
| `apps/worker`               | bounded background lifecycle                    | config/db/integrations/observability/worker                |
| `apps/sandbox-api`          | test-only checkout/admin composition            | sandbox-only; never production                             |
| `packages/application`      | deterministic use cases + prompt boundary       | API/worker -> contracts/domain                             |
| `packages/config`           | validated environment                           | both apps                                                  |
| `packages/contracts`        | typed cross-boundary contracts                  | application/db/integrations/worker                         |
| `packages/db`               | PostgreSQL authority                            | both apps + worker/application paths                       |
| `packages/domain`           | pure rules/properties                           | application/db/worker                                      |
| `packages/integrations`     | external boundary adapters/contracts            | both apps/db/worker                                        |
| `packages/observability`    | logging/tracing/metrics                         | both apps                                                  |
| `packages/worker`           | bounded job orchestration                       | app-worker -> application/contracts/db/domain/integrations |
| `packages/sandbox-payments` | test-only persistence/verifier/adapter/workflow | sandbox-api only; prohibited from production closure       |

## Expert referral / residency implementation coverage

Connected areas:

- API: expert referral routes, admin routes, Telegram webhook.
- Application: referral/residency/admin services, code crypto/key resolver, prompt context and typed proposals.
- DB: referral/control/admin/residency/provider-inbox/worker repositories and trusted transaction capability.
- Integrations: Telegram adapter/callback token; provider-neutral residency payment port;
  YooKassa fixed-origin client, adapter, verifier, and default-off webhook seam.
- Worker: residency expiry, reconciliation, held-reward replay; YooKassa reconciliation
  is an injected, disabled-by-default seam.
- Observability: bounded referral/residency and provider-outcome metrics.
- Database: migrations `0018`–`0023`, snapshots/journal, expert referral/residency
  relations/views, and YooKassa operation mapping.
- Verification: unit, integration concurrency/deadline/reversal/hold, e2e lifecycle, repo scope/env/workflow guards.
- Operations: traceability, runbooks, rollback, security addendum, reconciliation policy.

## `тест эксперт` one-dialog coverage

- API: default-off composition extends the webhook-secret-authenticated client Telegram route; no public body-supplied identity route exists.
- Application: durable prefixless session routing, zero-unit deterministic warmup/qualification/segmentation/FAQ, and authoritative expert/partner quotes.
- DB: folded never-shipped migration `0038`, bot/chat-scoped session and deterministic-request facts, database prompt/campaign authority, two-unit trial ledger, B3 admission, B2 response convergence, and append-only audit.
- Worker: bounded age/limit scan and reconciliation of reserved/unknown trial rows; runtime activation remains blocked.
- Delivery: deterministic and B2 answers both create the existing `telegram.send_text.v1` outbox/delivery for the original dialogue; residual requests use one `selarti.request.v1` and never dispatch directly.
- Observability/privacy: enabled composition requires a metric sink; raw residual text stays only in the existing retention-governed Selarti outbox and remains an activation gate.
- Activation: no prompt/campaign seed, approved selling copy, official Selarti contract/privacy evidence, restart/role proof, or external execution of the newly added PostgreSQL cases is claimed.

## Non-runtime, historical, and dead/deferred classification

| Entity class                                  | Classification        | Why it stays connected                                                 |
| --------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| `docs/test-evidence/claw/*`                   | EVIDENCE              | Exact-SHA environment/results for audit and recovery.                  |
| `.superpowers/sdd/*`                          | EVIDENCE / HISTORICAL | Progress/remediation history.                                          |
| `docs/handoffs/*`                             | EVIDENCE              | Clean-machine continuation/recovery.                                   |
| completed plans/specs                         | EVIDENCE              | Requirement/decision traceability.                                     |
| old migrations/snapshots                      | LEGACY/HISTORICAL     | Clean migration replay and schema parity.                              |
| disabled payment adapter                      | DISABLED              | Explicit fail-closed contract.                                         |
| disabled expert payment provider reader       | DISABLED              | Prevents accidental live network authority.                            |
| worker unknown-outcome placeholder            | DISABLED              | Lifecycle slot retained while providers are off.                       |
| worker privacy placeholder                    | DISABLED              | Capability not composed.                                               |
| generic provider reconciliation placeholder   | DISABLED              | No approved live provider reader.                                      |
| client `500/500` coupon executable runtime    | DEFERRED              | Separate product scope; must not share expert referral logic.          |
| waitlist runtime                              | DEFERRED              | Outside current release.                                               |
| expert reschedule composite runtime           | DEFERRED              | Outside current release.                                               |
| YooKassa Merchant boundary                    | DISABLED              | Code exists, but default composition has no credentials or capability. |
| personal YooMoney Wallet API / T-Bank adapter | PROHIBITED            | Wrong/out-of-scope provider surface; YooKassa Merchant API only.       |
| authoritative Make/Sheets writes              | PROHIBITED            | PostgreSQL is transactional authority.                                 |
| direct LLM DB/financial mutation              | PROHIBITED            | Typed proposal + deterministic reauthorization.                        |

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
