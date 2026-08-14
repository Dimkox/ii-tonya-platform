# MVP-OPS-CASE-001 — durable operator case inbox

## Objective

Make safety escalations and negative feedback visible to authenticated operators
through a durable PostgreSQL inbox. The worker materializes cases locally and
idempotently; no external notifier is part of this story.

## Requirements

- **OPS-CASE-001-MAT:** a bounded worker batch claims pending
  `safety.operator_escalation` and `admin.negative_feedback` outbox rows with
  `FOR UPDATE SKIP LOCKED`, inserts one case per source outbox row, and marks the
  source succeeded only after the case exists. Retrying or running concurrent
  workers never creates duplicates.
- **OPS-CASE-001-PRIV:** a case stores only its server case/source key, type,
  status, rating or reason code, content hash, policy version and lifecycle
  timestamps. It never stores or returns feedback text, dialogue, safety
  narrative, user/expert/reservation/handoff/feedback identifiers, payment data
  or an outbox payload.
- **OPS-CASE-001-READ:** authenticated operators list unresolved cases through
  stable `(createdAt,id)` keyset pagination. `limit` is `1..100`; cursors and
  responses are bounded. Acknowledged cases remain unresolved and listable.
- **OPS-CASE-001-AUTH:** `support` may access negative-feedback and delivery
  failure cases; `security_admin` may access safety cases. A principal holding
  both roles receives the union. Other roles fail before repository access.
- **OPS-CASE-001-MUT:** acknowledge is idempotent for an acknowledged case;
  resolve is idempotent for a resolved case. Invalid reverse transitions fail
  closed. Successful first transitions append one bounded audit event; retries
  do not duplicate audit.
- **OPS-CASE-001-API:** expose authenticated
  `GET /v1/admin/operator-cases`,
  `POST /v1/admin/operator-cases/:caseId/acknowledge`, and
  `POST /v1/admin/operator-cases/:caseId/resolve`. Bodies and query parameters
  reject unknown fields. Existing approval and admin mutation endpoints remain
  byte-compatible.
- **OPS-CASE-001-OPS:** use additive journal migration `0028`; default API and
  worker composition use PostgreSQL only. No live provider, external notifier,
  GitHub Actions, image build/prune, staging or production action is authorized.

## Release checks

- Focused application, API, worker, repository-boundary and schema tests.
- One real-PostgreSQL multi-worker test on Claw and one final focused Claw gate;
  no repeated green suites.
- Independent review with no open Critical or Important finding before merge.
