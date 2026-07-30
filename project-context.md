# Project Context

## Identity

- Repository: `Dimkox/ii-tonya-platform`
- Canonical path:
  `C:\Users\Dmitry\Documents\Codex\2026-07-28\new-chat\work\ii-tonya-platform`
- Default branch: `main`
- Working branch prefix: `codex/`
- CI contract: `.codex/ci-contract.json`

## Purpose

Implement the client and expert workflows described by the normalized ии-Тоня
requirements while preserving transactional ownership, safety boundaries and
source traceability.

## Architecture

- TypeScript monorepo managed by pnpm workspaces.
- Node.js 24 and pnpm 11.9.0.
- Domain and application packages own business behavior.
- PostgreSQL adapters own durable booking, billing, consent, message, feedback
  and outbox state.
- Selarti, Telegram and Planerka are external adapters, not authoritative state
  stores.
- Testcontainers provide isolated PostgreSQL integration tests.

## Setup and checks

```powershell
pnpm install --frozen-lockfile
pnpm exec prettier --check .
pnpm lint
pnpm typecheck
pnpm exec vitest run packages/contracts packages/domain packages/config packages/application packages/integrations packages/worker tests/repo tests/support
pnpm exec vitest run packages/db tests/integration
pnpm exec vitest run tests/contract
pnpm build
```

The initial governance adoption intentionally does not waive existing failures:
format, typecheck or build debt remains a blocking CI result until corrected.
Docker is required for database integration tests.

## Artifacts

- Name: `ii-tonya-platform-<full-commit-sha>.zip`
- Integrity: adjacent `.sha256`
- Security evidence: redacted Gitleaks output, Trivy dependency report,
  Semgrep report and CycloneDX SBOM
- Signature: OpenSSL ECDSA P-256 detached signature verified with the committed
  `.github/artifact-signing.pub`; the encrypted private key and its password
  remain GitHub Actions secrets

## Deployment boundary

The repository is pre-production and has no deployable application composition
root. Governance CI performs a non-production launcher and contract smoke only.
When an executable API/worker stack is introduced, replace that smoke with
staging health, readiness and externally observable workflow checks before any
production deployment is enabled.

## Telemetry

- GitHub Actions required-job status and retained evidence artifacts.
- Unit, database integration and contract test output.
- No production availability SLO is claimed before a production service exists.
