# ии-Тоня Rollback Policy

## Triggers

- `Governance CI / required` fails for a candidate commit.
- A schema, contract or transactional invariant regresses.
- An artifact checksum or configured signature cannot be verified.
- A change enables an external side effect outside its authorized environment.
- Secret or personal data appears in source, logs or retained evidence.

## Repository rollback

1. Stop merge and rollout activity.
2. Revert the responsible commit through a new reviewed branch; do not rewrite
   shared history.
3. Restore the workflow, CI contract and affected implementation together.
4. Re-run formatting, lint, typecheck, unit, integration, contract and build
   gates from a clean checkout.
5. Verify `Governance CI / required` against the exact rollback commit.

## Data and migration boundary

There is no authorized production deployment in this baseline. Never run a
rollback migration against shared data from Governance CI. If production
migrations are introduced, each forward migration must define a tested,
data-preserving recovery path, backup/preflight evidence and an explicit owner.

## Artifact recovery

Use only a full-SHA artifact whose adjacent SHA-256 verifies. When signing is
activated, verify its detached OpenSSL ECDSA P-256 signature with
`.github/artifact-signing.pub`. Rebuild from the Git commit if either integrity
check fails.

## Secret incident

Stop publication, preserve redacted diagnostic evidence and request separate
authority for credential rotation or history rewriting. Never print the
credential while diagnosing the incident.
