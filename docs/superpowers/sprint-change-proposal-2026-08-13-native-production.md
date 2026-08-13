# Sprint Change Proposal: native dedicated-server production

Status: approved by product owner on 2026-08-13
Scope: major release-topology correction
Requirement: `OPS-DEPLOY-001`

## Issue summary

The prior release design treated API and worker containers as production artifacts. The
product owner clarified that production receives a dedicated server for this project and
must not run the application in containers. Docker is required only for development,
direct Claw tests, test databases, provider stubs, and sandbox evidence. The Claw test
container imitates the dedicated server contract. GitHub Actions are not used; GitHub is
only the Git/PR store.

## Impact analysis

- Provider-neutral domain, database, and application code are unchanged.
- Container verification remains useful test evidence but is no longer production
  topology evidence.
- Image publication, image signatures, remote Compose deployment, and image-digest
  rollback must be replaced by a native release bundle, bundle SBOM/signature, systemd
  deployment, and release-directory rollback.
- Production uses the host PostgreSQL and nginx/TLS. API and worker run as separate
  non-root systemd units from the same immutable bundle.
- The current container-based production release workflow is unauthorized until this
  correction is implemented and verified.

## Approved adjustment

1. Keep `Dockerfile`, local Compose, sandbox images, and constrained Claw containers only
   as development/test assets.
2. Build one deterministic native bundle for API and worker from the exact Git SHA.
3. Produce and verify its SHA-256, SBOM, signature, and provenance before deployment.
4. Deploy into `/opt/ii-tonya-platform/releases/<sha>`, run migration preflight, switch
   `/opt/ii-tonya-platform/current` atomically, restart systemd, then smoke and reconcile.
5. Keep runtime secrets in `/etc/ii-tonya/runtime.env`; never package them.
6. Roll back the symlink and services to the prior compatible release on failed health or
   reconciliation. Database migrations remain forward-fix unless explicitly reversible.
7. Run CI, database, and release gates directly on Claw and commit exact-SHA evidence.

## Handoff and acceptance

- Architect/security: approve bundle contents, service hardening, filesystem ownership,
  signature verification, and secret boundaries.
- Developer/DevOps: replace container release assets with native bundle and systemd
  deployment assets using test-first repository guards.
- Release owner: require an isolated native staging rehearsal and explicit production
  authorization before first deployment.

Acceptance requires no production or staging application-container path, a signed exact
bundle, repeatable native deploy/rollback, systemd readiness, database reconciliation,
and evidence tied to the deployed Git SHA.

The supplied `MIGRATION-COMPATIBILITY` marker for `7428a8d387256df4fe24ba13ae0ab9c02fc76a54`
was verified as an existing sibling merge, not an ancestor of current `main`; it is
historical evidence and does not authorize a differently identified release candidate.
