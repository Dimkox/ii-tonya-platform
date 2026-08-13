# Native dedicated-server deployment

Status: native bundle assembly and the Claw server-imitation rehearsal are verified;
production remains `BLOCKED` until signing, a confirmed production host with
systemd/nginx provisioning, and renewed exact-SHA migration approval are available.

## Target topology

- one dedicated Linux server for ii-Тоня;
- Node.js 24;
- non-root `ii_tonya` API and worker systemd services;
- system PostgreSQL with a project-scoped role/database;
- nginx/TLS reverse proxy to API on loopback;
- `/etc/ii-tonya/runtime.env` owned by root and excluded from release artifacts;
- immutable `/opt/ii-tonya-platform/releases/<git-sha>` directories and an atomic
  `/opt/ii-tonya-platform/current` symlink.

Docker, Docker Compose, GHCR application images, and container digests are not production
dependencies. They remain development/direct-Claw test evidence only. The Claw test
container imitates the native server contract; it is not copied to production.

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
9. On failure, switch `current` to the prior compatible release and restart services.
   Database rollback is forward-fix unless a separately reviewed reverse migration exists.

## Current blocker

The old production image/Compose and GitHub Actions entrypoints are removed. Exact-SHA
Claw CI, Database Gate, and native bundle assembly now have committed evidence. This
runbook may move from `BLOCKED` to `READY` only after signed evidence, renewed migration
approval, and a confirmed production host. The Claw rehearsal uses one persistent
`ii_tonya_native_smoke` database and resets only its `public` schema. No container release
path is authorized for production.

Migration marker `MIGRATION-COMPATIBILITY: 7428a8d387256df4fe24ba13ae0ab9c02fc76a54`
was received and the object was verified, but it is a sibling merge rather than an
ancestor of current `main`. It is retained as historical evidence and cannot be relabelled
as approval for a different release SHA. The production candidate requires a renewed
exact-SHA migration approval after final merge.
