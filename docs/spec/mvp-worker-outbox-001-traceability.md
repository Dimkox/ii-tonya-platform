# MVP-WORKER-OUTBOX-001 traceability

Status: implementation, independent review and final exact-SHA Claw evidence
complete; deployment authorization remains outside this story.

Canonical spec:
`_bmad-output/specs/spec-mvp-worker-outbox-001/SPEC.md` and companion
`CONTRACTS.md`.

| Requirement           | Implemented code                                              | Tests/evidence                                                 | Release state                  |
| --------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| WORKER-OUTBOX-001-R1  | `packages/config/src/env.ts`, `.env.example`                  | Task 1 30/30; Task 6 guard 5/5; final 1/1                      | implementation gate passed     |
| WORKER-OUTBOX-001-R2  | `apps/worker/src/main.ts`, `apps/worker/src/runtime.ts`       | registry 10/10 + metric capability 4/4 fail-before-repository  | implementation gate passed     |
| WORKER-OUTBOX-001-R3  | contracts tuple + local registry                              | Task 2 24/24; canonical tuple/remediation 10/10; final 1/1     | implementation gate passed     |
| WORKER-OUTBOX-001-R4  | `packages/db/src/repositories/outbox-repository.ts`           | Task 3 19/19; real composition 10/10; final provider guard 1/1 | implementation gate passed     |
| WORKER-OUTBOX-001-R5  | local registry + operator-case outbox repository              | Task 4 7/7; locked safety race 10/10; final delivery 1/1       | implementation gate passed     |
| WORKER-OUTBOX-001-R6  | operator-case outbox repository                               | Task 4 7/7; locked feedback race 10/10; final delivery 1/1     | implementation gate passed     |
| WORKER-OUTBOX-001-R7  | exact decoders + terminal runner outcome                      | Task 2 poison 24/24; Task 5 terminal metrics 17/17             | implementation gate passed     |
| WORKER-OUTBOX-001-R8  | `packages/worker/src/outbox-runner.ts`, both DB repositories  | replay/metrics plus real recovery/ambiguity 10/10              | implementation gate passed     |
| WORKER-OUTBOX-001-R9  | `apps/worker/src/runtime.ts`                                  | Task 5 exclusive-owner 17/17; final production composition 1/1 | implementation gate passed     |
| WORKER-OUTBOX-001-R10 | existing runner/runtime bounds                                | Task 5 17/17; real-PG exhaustion bound 2/2                     | implementation gate passed     |
| WORKER-OUTBOX-001-R11 | worker metrics port + `packages/observability/src/metrics.ts` | Task 5 17/17; recovery 10/10; exact real-SQL metrics 2/2       | implemented; exporter unproven |
| WORKER-OUTBOX-001-R12 | repo scope guards                                             | Task 6 migration/provider/topic/env guard 5/5; final 1/1       | implementation gate passed     |
| WORKER-OUTBOX-001-R13 | runtime ownership + rollback runbook                          | Task 6 drain/emergency-pause guard 5/5                         | implementation gate passed     |

## Deployment evidence and rollback

- Mandatory implementation evidence: independent review with no open Critical or
  Important finding; affected local tests; one real-PostgreSQL focused file; one
  final focused Claw run at reviewed exact SHA.
- Rollout: keep `WORKER_OUTBOX_DELIVERY_ENABLED=false` until those gates and a
  separate deployment approval exist. First enablement is a human checkpoint.
- Controlled rollback: stop new cycles, let the enabled filtered runner recover
  or reconcile local `processing`, `reconciling` and `unknown_outcome` rows until
  none remain, then set the flag to `false` and restart. Legacy materialization
  resumes for pending/retry rows. Emergency false is fail-safe but may leave
  durable unknown local rows paused until the generic mode is re-enabled; never
  reset them manually or transfer their ownership without a reviewed recovery.
- Telemetry evidence is limited to bounded instrumentation until an exporter and
  operational dashboard are separately deployed and verified.

## Current evidence boundary

Implementation evidence is complete at reviewed exact `9f5d258`: independent
review APPROVED with no Critical or Important findings, and the one-shot final
Claw PostgreSQL gate passed 1 file / 1 test in 7.85s without repetition. Cleanup
restored exact base with zero test/process/build/archive remnants. No staging,
production, provider activation, live telemetry export, migration, image build,
push, merge, or GitHub Actions evidence exists. Release remains NO-GO pending
separate human deployment authorization.
