# Rollback

Decision owner: Incident commander. Executor: Platform owner. Reviewer: Release owner.

1. Record incident time, affected digest, database migration version, traffic state, worker leases, and the immutable prior known-good API/worker digests.
2. Pause workers from claiming new work; do not discard inbox/outbox rows or ambiguous provider outcomes.
3. For the remote Compose adapter, run the release workflow rollback step or
   invoke `bash scripts/deploy-compose-remote.sh rollback` with the same pinned
   SSH and target environment variables. Before deployment the workflow captures
   the running prior digests and verifies their CI signatures. Rollback deploys
   those refs through a freshly uploaded checksum-bound recovery manifest from
   the captured prior Git commit,
   performs internal reconciliation, and verifies container health and image
   refs. On a failed first
   release it stops and removes the failed application containers instead of
   claiming that a prior release exists. Never rebuild or retag during rollback.
4. Database changes are forward-fix only. Do not run destructive down migrations; deploy a reviewed compatible correction.
5. Drain or fence in-flight outbox work, recover expired leases, and reconcile unknown outcomes before resuming workers.
6. Run `pnpm smoke -- --base-url=<rollback-target>` and the checks in `docs/operations/reconciliation.md`.
7. Capture digest/signature verification, traffic timestamps, smoke output, reconciliation counts, decision owner, executor, reviewer, and evidence URI.

If smoke or reconciliation fails, keep traffic stopped or on the last verified digest and escalate. Production release must not continue on partial evidence.
If `.rollback-in-progress` exists, the runtime is in an explicit indeterminate
state; automation will refuse another release until the incident commander
reconciles actual container digests and repairs the release pointer.
