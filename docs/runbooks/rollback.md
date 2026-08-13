# Native production rollback

Decision owner: Incident commander. Executor: Platform owner. Reviewer: Release owner.

1. Record incident time, deployed Git SHA, database migration version, traffic state,
   worker leases, and the prior known-good native release SHA.
2. Pause workers from claiming new work; preserve inbox/outbox rows and ambiguous provider
   outcomes.
3. Run `bash scripts/deploy-native-remote.sh rollback` with the same pinned SSH key,
   known-hosts file, host, and `/opt/ii-tonya-platform` deployment root.
4. The adapter restores the previously captured `releases/<sha>` symlink target and
   restarts `ii-tonya-api.service` and `ii-tonya-worker.service`.
5. Database changes are forward-fix only. Never run destructive down migrations.
6. Run the readiness smoke and `docs/operations/reconciliation.md`; keep traffic stopped
   if either fails.
7. Commit sanitized evidence containing SHAs, timestamps, smoke/reconciliation results,
   decision owner, executor, reviewer, and recovery outcome.

Production rollback never uses Docker, Compose, mutable tags, or GitHub Actions.
