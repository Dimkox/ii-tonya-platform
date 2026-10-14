# Native production rollback

Decision owner: Incident commander. Executor: Platform owner. Reviewer: Release owner.

1. Record incident time, deployed Git SHA, database migration version, traffic state,
   worker leases, and the prior known-good native release SHA.
2. Pause workers from claiming new work; preserve inbox/outbox rows and ambiguous provider
   outcomes.
3. Run `bash scripts/deploy-native-remote.sh rollback` with the same pinned SSH key,
   known-hosts file, host, and `/opt/ii-tonya-platform` deployment root.
4. The adapter restores the previous release's three versioned systemd unit files,
   runs `daemon-reload`, switches the `releases/<sha>` symlink target, and restarts
   `ii-tonya-api.service` and `ii-tonya-worker.service`.
5. Database changes are forward-fix only. Never run destructive down migrations.
6. Run the readiness smoke and `docs/operations/reconciliation.md`; keep traffic stopped
   if either fails.
7. Commit sanitized evidence containing SHAs, timestamps, smoke/reconciliation results,
   decision owner, executor, reviewer, and recovery outcome.

Production rollback never uses Docker, Compose, mutable tags, or GitHub Actions.

## Rehearsal evidence

Claw rehearsal of the exact remote rollback body (two immutable `releases/<sha>`
directories, unit restore, symlink switch, readiness):
[`docs/test-evidence/rollback-drill-2026-09-17.md`](../test-evidence/rollback-drill-2026-09-17.md).
That rehearsal is not a substitute for `deploy-native-remote.sh rollback` against
the dedicated host. Host SSH is configured as of 2026-09-17
(`docs/test-evidence/production/host-identity-2026-09-17.md`); live rollback was
not executed.
