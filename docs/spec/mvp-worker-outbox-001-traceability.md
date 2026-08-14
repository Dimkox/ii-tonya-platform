# MVP-WORKER-OUTBOX-001 traceability

Status: implementation and boundary evidence complete; independent review and
final exact-SHA Claw gate pending.

Canonical spec:
`_bmad-output/specs/spec-mvp-worker-outbox-001/SPEC.md` and companion
`CONTRACTS.md`.

| Requirement           | Implemented code                                              | Tests/evidence                                                  | Release state                           |
| --------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------- |
| WORKER-OUTBOX-001-R1  | `packages/config/src/env.ts`, `.env.example`                  | Task 1 config/app factory 30/30; Task 6 env guard pending GREEN | implemented, release gate pending       |
| WORKER-OUTBOX-001-R2  | `apps/worker/src/main.ts`, `apps/worker/src/runtime.ts`       | Task 1 lazy composition; fail-before-repository remediation 10/10 | implemented, release gate pending       |
| WORKER-OUTBOX-001-R3  | contracts tuple + local registry                              | Task 2 24/24; canonical tuple/remediation 10/10                 | implemented, release gate pending       |
| WORKER-OUTBOX-001-R4  | `packages/db/src/repositories/outbox-repository.ts`           | Task 3 19/19; real filtered production composition 10/10       | implemented, release gate pending       |
| WORKER-OUTBOX-001-R5  | local registry + operator-case outbox repository              | Task 4 7/7; locked authoritative safety race 10/10              | implemented, release gate pending       |
| WORKER-OUTBOX-001-R6  | operator-case outbox repository                               | Task 4 7/7; locked authoritative feedback race 10/10            | implemented, release gate pending       |
| WORKER-OUTBOX-001-R7  | exact decoders + terminal runner outcome                      | Task 2 poison cases 24/24; Task 5 terminal metrics 17/17        | implemented, release gate pending       |
| WORKER-OUTBOX-001-R8  | `packages/worker/src/outbox-runner.ts`, both DB repositories  | Task 4 replay; Task 5 metrics; real recovery/ambiguity 10/10    | implemented, release gate pending       |
| WORKER-OUTBOX-001-R9  | `apps/worker/src/runtime.ts`                                  | Task 5 disabled/enabled exclusive-owner case 17/17              | implemented, release gate pending       |
| WORKER-OUTBOX-001-R10 | existing runner/runtime bounds                                | retained non-overlap/shutdown tests in Task 5 17/17             | implemented, broader final gate pending |
| WORKER-OUTBOX-001-R11 | worker metrics port + `packages/observability/src/metrics.ts` | Task 5 17/17; per-topic recovery/exhaustion remediation 10/10   | implemented; exporter unproven          |
| WORKER-OUTBOX-001-R12 | repo scope guards                                             | Task 6 migration/provider/topic/env guard 5/5                   | implemented, release gate pending       |
| WORKER-OUTBOX-001-R13 | runtime ownership + rollback runbook                          | Task 6 drain/emergency-pause guard 5/5                          | implemented, release gate pending       |

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

Implementation and focused Claw evidence exist through review remediation at
exact `af83fac` (2 files, 10/10, 11.24s). The initial review had no Critical and
five Important findings; all five are implemented and await exact-HEAD
re-review. A new one-shot final gate is prepared but unexecuted. No staging,
production, provider activation, live telemetry export, migration, image build,
push, merge, or GitHub Actions evidence exists. Release remains NO-GO pending
independent review, the final exact-SHA Claw gate, and separate human deployment
authorization.
