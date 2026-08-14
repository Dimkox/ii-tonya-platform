# MVP-WORKER-OUTBOX-001 traceability

Status: specification complete; implementation not started.

Canonical spec:
`_bmad-output/specs/spec-mvp-worker-outbox-001/SPEC.md` and companion
`CONTRACTS.md`.

| Requirement | Planned code | Planned tests/evidence | Release state |
| --- | --- | --- | --- |
| WORKER-OUTBOX-001-R1 | `packages/config/src/env.ts`, `.env.example` | config + env-policy tests | planned |
| WORKER-OUTBOX-001-R2 | `apps/worker/src/main.ts`, `apps/worker/src/runtime.ts` | app-worker factory/startup tests | planned |
| WORKER-OUTBOX-001-R3 | `packages/worker/src/local-operator-case-outbox.ts` | exact registry/decoder unit tests, scope guard | planned |
| WORKER-OUTBOX-001-R4 | `packages/db/src/repositories/outbox-repository.ts` | mixed-topic real-PG claim/recovery/exhaustion tests | planned |
| WORKER-OUTBOX-001-R5 | worker handler + operator-case outbox repository | safety decoder/idempotency/privacy tests | planned |
| WORKER-OUTBOX-001-R6 | operator-case outbox repository | authoritative feedback/missing-source tests | planned |
| WORKER-OUTBOX-001-R7 | decoders + terminal runner outcome | poison payload and terminal-state tests | planned |
| WORKER-OUTBOX-001-R8 | `packages/worker/src/outbox-runner.ts`, both DB repositories | mutation/ack crash and durable reconciliation test | planned |
| WORKER-OUTBOX-001-R9 | `apps/worker/src/runtime.ts` | disabled-vs-enabled exclusive-owner test | planned |
| WORKER-OUTBOX-001-R10 | existing runner/runtime bounds | batch, fencing, overlap and shutdown regressions | planned |
| WORKER-OUTBOX-001-R11 | worker metrics port + `packages/observability/src/metrics.ts` | closed-label/no-content metric tests | planned |
| WORKER-OUTBOX-001-R12 | repo scope guards | no migration/provider import/topic assertion | planned |
| WORKER-OUTBOX-001-R13 | runtime shutdown/mode transition contract | drain-before-disable and emergency-pause tests | planned |

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

This docs-only commit contains no implementation, test, Claw, staging,
production, provider or live telemetry evidence.
