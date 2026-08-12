# Development environment manifest

This document makes the repository reproducible on a machine that has none of the
original Codex configuration, agents, dependencies, containers, or environment files.
Repository pins are authoritative; the observed source workstation is diagnostic only.

## Required baseline

| Component                  | Required contract                              | Authoritative source                      |
| -------------------------- | ---------------------------------------------- | ----------------------------------------- |
| Git                        | modern Git with worktree support               | repository workflow                       |
| Node.js                    | major 24                                       | `.nvmrc`, `package.json#engines`          |
| pnpm                       | exactly 11.9.0                                 | `package.json#packageManager`             |
| Dependencies               | frozen committed graph                         | `pnpm-lock.yaml`, `pnpm-workspace.yaml`   |
| Bash                       | required for deployment-policy syntax checks   | `package.json#verify:deploy`              |
| Docker Engine + Compose v2 | required for container and PostgreSQL evidence | `compose.yaml`, CI                        |
| PostgreSQL                 | 17.5 Bookworm container for local evidence     | `compose.yaml`                            |
| CI execution               | self-hosted Claw, constrained test container   | `.github/workflows/ci.yml`, `db-gate.yml` |
| Text                       | UTF-8, LF, EditorConfig                        | `.editorconfig`, `.gitattributes`         |

GitHub CLI is recommended for PR/check inspection but is not required to build. Codex,
Serena, Python, Obsidian, and global skills are optional tooling, not runtime
dependencies. Project agent instructions are committed in `AGENTS.md` and `docs/agents`.

## Observed source workstation on 2026-08-04

This snapshot explains possible drift; do not reproduce it as the target environment.

| Component  | Observed                                         |
| ---------- | ------------------------------------------------ |
| OS         | Microsoft Windows 10.0.19045                     |
| PowerShell | 7.6.4                                            |
| Git        | 2.55.0.windows.3                                 |
| Node.js    | 26.5.0 — **non-conforming; project requires 24** |
| pnpm       | 11.9.0 from a Codex bundled fallback runtime     |
| Corepack   | not available on PATH                            |
| Docker     | not available on PATH                            |
| GitHub CLI | 2.97.0                                           |
| Codex CLI  | 0.146.0-alpha.9.2                                |
| Git Bash   | 5.3.15                                           |
| Python     | 3.14.6; optional for this repository             |

Consequences:

- Do not treat an unisolated local run on the source workstation as authoritative Node
  evidence because its Node major is wrong.
- Full local container/PostgreSQL verification cannot run there until Docker is
  installed and healthy.
- Exact-SHA GitHub Actions on the self-hosted Claw runner, with execution inside the
  constrained Node 24 test container, are the current authoritative environment evidence.

## Clean-machine bootstrap

1. Install Git, Node 24, pnpm 11.9.0, PowerShell 7, Git Bash (on Windows), and Docker
   Desktop/Engine with Compose v2. Do not install project dependencies globally.
2. Clone and select the implementation branch:

   ```powershell
   git clone https://github.com/Dimkox/ii-tonya-platform.git
   Set-Location ii-tonya-platform
   git fetch origin codex/task25-expert-referral-implementation
   git switch --track origin/codex/task25-expert-referral-implementation
   ```

3. Verify repository and tool identity:

   ```powershell
   pwsh -File scripts/check-development-environment.ps1
   git status --short
   git rev-parse --show-toplevel
   git remote get-url origin
   git rev-parse HEAD
   ```

4. Create local configuration from placeholders only:

   ```powershell
   Copy-Item .env.example .env
   ```

   Keep every integration and expert residency feature flag `false`. Replace placeholders
   only through the approved secret-management process. Never commit `.env` or print its
   values in logs, prompts, handoffs, or CI artifacts.

5. Install the frozen dependency graph and verify non-container code:

   ```powershell
   pnpm install --frozen-lockfile
   pnpm verify:clean-workspace
   pnpm build
   pnpm lint
   pnpm typecheck
   pnpm test:unit
   pnpm test:property
   pnpm test:contract
   pnpm test:security
   ```

6. For full local evidence, confirm Docker and run:

   ```powershell
   pwsh -File scripts/check-development-environment.ps1 -RequireDocker
   pnpm test:integration
   pnpm test:container
   ```

7. `pnpm verify` is the aggregate repository gate. It also performs a production
   dependency audit and may require network access. A blocked or cancelled audit is not
   a passing result.

## Workspace modules

The workspace contains these first-party modules. Their exact external and transitive
dependencies are fully pinned by `pnpm-lock.yaml` and must not be duplicated manually in
this document.

| Path                     | Package                   | Responsibility                                              |
| ------------------------ | ------------------------- | ----------------------------------------------------------- |
| `apps/api`               | `@ii-tonya/api`           | HTTP composition, authenticated routes, webhooks, readiness |
| `apps/worker`            | `@ii-tonya/app-worker`    | runnable bounded worker process                             |
| `packages/application`   | `@ii-tonya/application`   | use cases, authorization boundaries, ports                  |
| `packages/config`        | `@ii-tonya/config`        | validated fail-closed environment configuration             |
| `packages/contracts`     | `@ii-tonya/contracts`     | shared typed public contracts                               |
| `packages/db`            | `@ii-tonya/db`            | Drizzle schema, migrations, repositories, transactions      |
| `packages/domain`        | `@ii-tonya/domain`        | deterministic business and financial rules                  |
| `packages/integrations`  | `@ii-tonya/integrations`  | provider, Telegram, Selarti, Planerka adapters              |
| `packages/observability` | `@ii-tonya/observability` | redacted logs, metrics, and operational signals             |
| `packages/worker`        | `@ii-tonya/worker`        | worker jobs, reconciliation, expiry, safety handoff         |

## Container topology

`compose.yaml` defines an isolated local evidence stack:

- PostgreSQL 17.5 on an internal network;
- one-shot migration container;
- local provider stubs;
- non-root/read-only API and worker containers;
- optional smoke container;
- only API port `127.0.0.1:3000` exposed to the host;
- all live integrations and payment/LLM/referral features disabled.

The placeholder database password in Compose is local-only and is not a production
credential. Remote deployment uses `deploy/compose.remote.yml` and separate authenticated
release evidence; it must not be inferred from the local stack.

## Observed Claw test profile on 2026-08-12

The host containing `/home/pall/app-stack` is a production host. Tests are authorized
only through its existing `ii-tonya-test` Compose profile:

- the test container is limited to 1 CPU and 1 GiB memory;
- the root filesystem is read-only and the test workspace is mounted separately;
- focused tests use `/home/pall/app-stack/ii-tonya-test-workspace`;
- no disk-size limit is configured;
- production services and the Compose definition must not be changed merely to run a
  test;
- `test:repeat` count greater than 3 is prohibited in every environment; Database Gate
  concurrency checks use the same three-run maximum.
- For a genuinely focused Vitest invocation, override the profile's broad default test
  entrypoint with `docker compose ... run --entrypoint sh ii-tonya-test -lc '<command>'`;
  otherwise the wrapper performs unrelated build and verification work first.
- The repository-scoped Actions runner lives at `/home/pall/actions-runner-ii-tonya`, is
  managed by `actions.runner.Dimkox-ii-tonya-platform.ii-tonya-claw.service`, and carries
  the labels `self-hosted`, `linux`, `x64`, `claw`, and `ii-tonya-test`.
- CI and Database Gate use `scripts/run-claw-actions-job.sh`; no GitHub-hosted runner or
  hosted Actions minute is required. Pull-request execution is owner-only.
- Gated release jobs use the separate `ii-tonya-release-claw` runner at
  `/home/ii_tonya_release/actions-runner`. Its locked `ii_tonya_release` OS identity has
  no Docker-group access and the runner has `ii-tonya-release` but not `ii-tonya-test`.
  The test runner no longer carries the release label.
- Both `server-native.yml` and `server-control.yml` have no push trigger or deployment
  code and only report an explicit refusal if manually dispatched. `ops/server-command.sh`
  is retained as legacy recovery history and is not workflow-reachable.
- Repository settings permit squash merge only, delete merged branches, and restrict
  both staging and production deployment environments to the `main` branch. These are
  compensating controls, not a claim that paid branch protection is enabled.

Machine authentication is not a repository input. The source workstation currently has
a dedicated machine-local SSH key at
`C:\Users\Dmitry\.ssh\ii_tonya_claw_ops_ed25519` with public fingerprint
`SHA256:nQicXxntL9DeOPqHX2tRoBQxpYa2LYoa4Cbxu4bLZtg`. The private key, passwords, GitHub
tokens, and `gh` host configuration must never be copied into this repository.

The parent `/home/pall/app-stack` Git remote is credential-free HTTPS and uses the
machine's existing `gh auth setup-git` credential helper. A previously embedded token was
removed from `.git/config`; because it appeared in diagnostic output, it must still be
revoked and replaced in GitHub account settings.

## CI and release tooling

The CI workflows pin their action revisions. Test commands run inside the constrained
Claw image with Node 24, pnpm 11.9.0, Docker CLI, and Gitleaks 8.28.0. Main-branch
publication retains pinned Trivy 0.65.0, Cosign installer 4.1.2, and signed
image/provenance evidence. Preserve those pins and validate workflow changes; do not
replace them with whatever versions happen to be installed locally.

## Serena and indexing

`.serena/project.yml` is committed and limits the project to TypeScript, YAML, and
Markdown. It honors `.gitignore` and excludes `.git`, `node_modules`, `.venv`, `venv`,
Python caches, `dist`, and `build`. Start Serena with this repository root only, never a
drive or user-profile root. Serena is optional and must not become a build dependency.

## Portability checklist

- [ ] Correct Git remote, branch, and HEAD recorded.
- [ ] Node 24 and pnpm 11.9.0 confirmed.
- [ ] Frozen install succeeds without lockfile changes.
- [ ] `.env` remains untracked and contains no borrowed credentials.
- [ ] Feature flags remain disabled unless the target environment has explicit evidence.
- [ ] Focused tests and relevant package checks pass.
- [ ] Docker/PostgreSQL checks run where required.
- [ ] Exact pushed SHA receives terminal CI and Database Gate conclusions.
- [ ] No other repository, staging target, or production system was mutated implicitly.
