# Task 23 remote Compose deployment plan

Status: implementation and independent review in progress.

## Objective

Replace the deliberate release-workflow deployment stubs with a target-neutral,
fail-closed Docker Compose adapter while preserving disabled live capabilities,
immutable signed image provenance, human production approval, and forward-only
database recovery.

## Requirements

- `DEP-001`: accept only a successful signed `main` CI run and immutable GHCR
  digests.
- `DEP-002`: restrict GitHub staging and production environments to `main`.
- `DEP-003`: pin SSH host trust and keep all private material outside Git and
  command output.
- `DEP-004`: require a pre-provisioned mode `400`/`600` runtime file with TLS
  PostgreSQL and all live capabilities disabled.
- `DEP-005`: run migration preflight before atomic deployment, then health,
  external smoke, and reconciliation gates.
- `DEP-006`: record and restore the prior immutable application release after a
  failed post-deployment gate; never run a destructive database rollback.
- `DEP-007`: retain provider, restore-drill, legal/safety, and accountable human
  approvals as NO-GO gates until real evidence exists.

## Implementation and verification

1. Add RED repository tests for the remote manifest, adapter, workflow ordering,
   trust inputs, rollback, examples, and mandatory CI checks.
2. Add `deploy/compose.remote.yml`, `scripts/deploy-compose-remote.sh`, placeholder
   runtime contract, and operator runbook.
3. Replace staging/production stubs in `release.yml`; preserve the evidence gate.
4. Configure GitHub environments with server-side `main` deployment policies.
5. Run actionlint, bash syntax, scope guards, formatting, lint, typecheck, tests,
   secret scanning, independent CI/security review, and exact-SHA hosted gates.

## Approval boundary

This plan authorizes code and GitHub environment preparation. It does not select
or mutate a live host, populate secrets, mark evidence `GO`, merge the pull
request, enable providers, or authorize production deployment.
