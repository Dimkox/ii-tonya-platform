# Task 6 report

Status: BLOCKED — Claw cannot currently complete a fresh pnpm deploy inside Docker Build because registry traffic from BuildKit times out. Production smoke was not consumed.

## Commits

- Base: `b12fb553ff3e210220100bf9a44424a4beadfba5`
- RED: `ff5d196bd80dfdb19a902a5c3e6809d3bbff2d0a`
- Container implementation: `0c62dd5e78879ed5189e3e7fb7ef25c83f947043`
- Network/cache remediations: `ae992b3`, `089fba2`, `2548b77`, `56ba0c6`, `aab4542`

## Implemented

- Dedicated multi-stage `Dockerfile.sandbox`, non-root distroless runtime, packaged sandbox closure and migrations.
- Explicit opt-in `compose.sandbox.yaml`: marker-first mode, required sandbox DB URL, empty credential placeholders, read-only root, tmpfs, dropped capabilities, no-new-privileges, 1 CPU/1 GiB, no Docker socket or production network.
- Sandbox lifecycle wrapper and separate sandbox image inventory smoke.
- Production image smoke now rejects both sandbox packages and verifies sandbox routes remain 404.
- Static production Dockerfile gate rejects sandbox package names/routes/factory.

## TDD evidence on Claw

- RED: release-assets failed for missing `Dockerfile.sandbox`, `compose.sandbox.yaml`, and smoke script; sandbox image smoke failed for missing Dockerfile.
- GREEN repository gates: release-assets 15/15; sandbox-production-isolation 6/6 after ordered workspace build.
- Compose parse/hardening contract: PASS.
- Cleanup: remaining `ii-tonya-test` containers 0.

## Blocking evidence

The sandbox Docker build reaches the final packaged deploy. BuildKit cannot reliably reach npm on the Claw Docker network. Observed errors include `ETIMEDOUT`, `ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`, and missing offline tarballs (`@types/pg`, `pg-types`). Bounded retry/cache/legacy-deploy branches were attempted. The host's proxy address is not a working HTTP proxy for BuildKit. No credential was added and no production service was changed.

Consequently these required gates remain unproven:

- sandbox built-image runtime probe;
- SBX-TST-009 container lifecycle against the isolated PostgreSQL database;
- one-time production image smoke/inventory;
- image vulnerability scan.

Production remains `NO-GO`; provider staging remains `BLOCKED`.

## Final code remediation and bounded offline result

- Independent re-review approved the final code/config contract with no remaining
  Critical, Important, or Minor findings.
- Claw static evidence: release-assets 16/16; Compose parse, shell/Node syntax, and
  cleanup passed.
- The source archive is bound to an exact Git tree through an isolated evidence bundle;
  OCI revision and immutable image ID are required by the lifecycle.
- The lifecycle now owns one isolated internal PostgreSQL database, migrations, marker,
  two-admin HTTP approval/settlement/refund, readiness, and authoritative financial facts.
- Full offline workspace hydration timed out after 480 seconds. A narrowed target-only
  offline hydration also timed out after 240 seconds on the 1 CPU / 1 GiB Claw profile.
  Both were network-disabled and were terminated; cleanup returned to zero containers
  and processes.
- No sandbox image was produced. SBX-TST-009, packaged import/hardening, production
  image smoke/inventory, scan, SBOM, and final provenance remain unexecuted. The single
  allowed production smoke was not consumed.

## Review remediation checkpoint

- Added causal tests and implementation for a real checkout mutation and DB-marker-backed `/health/ready`.
- Added an exact `86400` second residency interval assertion.
- Added a pinned offline builder contract using Claw image ID `sha256:a8f8d4bb072b4ef94f5cdf36a077a3be158bc314282c37fe026ffbe468746cb8`, exact source archive SHA, `--network none`, read-only builder root, and a minimal final artifact context.
- The single bounded feasibility run reached offline hydration from `/seed/.pnpm-store` but exceeded the 60-second operational checkpoint and was terminated. Cleanup left zero task test containers.
- True container-driven HTTP lifecycle/bootstrap, deep production filesystem inventory, internal-only runtime network evidence, final sandbox image proof, and the reserved one-time production smoke remain incomplete.
