# Native dedicated-server deployment

Status: native production runtime `current` is
`cb07bd1821d8106b0b0088b17bcf305662a1b792` as of 2026-09-18;
`.previous-release` is `7498ce656e1e49fe2d92c83f02d9667eb3f86b9b`.
External-provider activation remains fail-closed and requires its own approval.

## Target topology

- one dedicated Linux server for ii-Тоня;
- Node.js 24;
- non-root `ii_tonya` API and worker systemd services;
- the explicit `node --jitless` service command preserves Node compatibility with
  `MemoryDenyWriteExecute=true`; runtime env files may not redefine `NODE_OPTIONS`;
- systemd creates `/var/lib/ii-tonya` and `/var/log/ii-tonya` through
  `StateDirectory` and `LogsDirectory`;
- system PostgreSQL with a project-scoped role/database;
- nginx/TLS reverse proxy to API on loopback;
- `/etc/ii-tonya/runtime.env` owned by root and excluded from release artifacts;
- immutable `/opt/ii-tonya-platform/releases/<git-sha>` directories and an atomic
  `/opt/ii-tonya-platform/current` symlink.

Docker, Docker Compose, GHCR application images, and container digests are not production
dependencies. They remain development/direct-Claw test evidence only. The Claw test
container imitates the native server contract; it is not copied to production.

## Production SSH access policy

The approved operator policy is recorded in the ignored local project `.env` as
`PROD_ROOT_PASSWORD_LOGIN_ENABLED=true` and `PROD_ROOT_PASSWORD_SOURCE=interactive`.
Interactive password login for `root` remains available and deployment automation must
not disable it. The root password is entered only at the interactive SSH password prompt;
it is never stored in project `.env`, Git, logs, release artifacts, handoffs, or memory.
This access policy does not change the application privilege boundary: API and worker
services continue to run as the unprivileged `ii_tonya` user.

GitHub Actions are not used. Run `scripts/run-claw-ci.sh` directly on Claw with explicit
`SOURCE_ROOT` and exact `SOURCE_SHA`. GitHub stores the resulting commit and PR only.

## Required release sequence

1. Verify exact Git SHA CI and Database Gate directly on Claw.
2. Build one deterministic native API/worker production bundle from the frozen lockfile.
3. Generate SHA-256, dependency/SBOM inventory, signature, and provenance for the bundle.
4. Transfer to a temporary host path and verify all evidence before extraction.
5. Validate the runtime environment without printing secrets.
6. Run backward-compatible migration preflight and approved migrations.
7. Install the immutable release directory and atomically switch `current`.
8. Restart API and worker systemd units; check readiness, smoke, audit, and reconciliation.
9. On failure, restore the prior release's systemd units, run `daemon-reload`, switch
   `current` to the prior compatible release, and restart services.
   Database rollback is forward-fix unless a separately reviewed reverse migration exists.

## Current production state

The old production image/Compose and GitHub Actions entrypoints are removed. The first
native runtime at `233f3cf72e45e47117948ad5615b603252801e40` required host-only recovery
settings. 2026-09-18 deploy set `current` to
`cb07bd1821d8106b0b0088b17bcf305662a1b792` (`origin/main` at sign time) with
`7498ce65` as `.previous-release`.
The Claw rehearsal uses one persistent
`ii_tonya_native_smoke` database and resets only its `public` schema. No container release
path is authorized for production.

Migration marker `MIGRATION-COMPATIBILITY: 7428a8d387256df4fe24ba13ae0ab9c02fc76a54`
was received and the object was verified, but it is a sibling merge rather than an
ancestor of current `main`. It is retained as historical evidence and cannot be relabelled
as approval for a different release SHA. Exact approval for the deployed production
release was subsequently received as
`MIGRATION-COMPATIBILITY: 233f3cf72e45e47117948ad5615b603252801e40`.

The native runtime blocker remains open until the corrected exact-SHA replacement is
built, signed, deployed, and verified under systemd. Separately, Telegram, YooKassa,
Selarti, Planerka, LLM, and other external providers remain disabled until their
provider-specific implementations, contracts, credentials, and approvals exist.
