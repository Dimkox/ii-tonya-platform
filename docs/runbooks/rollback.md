# Rollback

Decision owner: Incident commander. Executor: Platform owner. Reviewer: Release owner.

1. Record incident time, affected digest, database migration version, traffic state, worker leases, and the immutable prior known-good API/worker digests.
2. Pause workers from claiming new work; do not discard inbox/outbox rows or ambiguous provider outcomes.
3. Shift traffic to the prior signed digest. Never rebuild or retag during rollback.
4. Database changes are forward-fix only. Do not run destructive down migrations; deploy a reviewed compatible correction.
5. Drain or fence in-flight outbox work, recover expired leases, and reconcile unknown outcomes before resuming workers.
6. Run `pnpm smoke -- --base-url=<rollback-target>` and the checks in `docs/operations/reconciliation.md`.
7. Capture digest/signature verification, traffic timestamps, smoke output, reconciliation counts, decision owner, executor, reviewer, and evidence URI.

If smoke or reconciliation fails, keep traffic stopped or on the last verified digest and escalate. Production release must not continue on partial evidence.
