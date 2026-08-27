# Worker outbox delivery runbook

## Scope

`WORKER_OUTBOX_DELIVERY_ENABLED` controls only
`safety.operator_escalation` and `admin.negative_feedback`. It defaults to
`false`. Enabling it transfers those two topics from the legacy pending-only
operator-case materializer to the filtered generic outbox runner. It does not
activate a provider, transport, credential, deployment, or telemetry exporter.

## Enablement checkpoint

Keep the flag false until the exact code SHA has passed its focused PostgreSQL
and non-PostgreSQL gates, independent review has no open Critical or Important
finding, and a human owner separately approves the target deployment. Confirm
that the configured registry, filtered repository, local case repository, and
bounded metrics adapter are all present before startup.

## Drain before planned disable

1. Stop scheduling new worker cycles while leaving the current enabled cycle
   time to finish.
2. Query only the two registered topics. Wait until there are no `processing`,
   `reconciling`, or `unknown_outcome` rows. The enabled filtered runner owns
   expired-lease recovery and durable reconciliation during this drain.
3. Confirm there is no active dispatch or reconciliation lease for either
   registered topic.
4. Set `WORKER_OUTBOX_DELIVERY_ENABLED=false`, restart the worker through the
   separately approved deployment procedure, and verify that only pending or
   retry-wait local rows are eligible for the legacy materializer.

Do not run the legacy materializer concurrently with the filtered runner for
the registered topics.

## Emergency disable pauses durable unknown rows

An emergency switch to false stops new generic claims. Durable `processing`,
`reconciling`, and `unknown_outcome` rows may remain paused; the legacy
pending-only materializer does not take them over. Preserve them and re-enable
the reviewed filtered runner to recover or reconcile them. Do not reset their
status, clear a lease, replay a side effect manually, or transfer ownership by
editing PostgreSQL rows.

## Verification boundary

Record the exact source SHA, flag value, bounded row counts by registered topic,
review verdict, and deployment approval identity. IDs, payloads, hashes, policy
versions, correlation or reconciliation keys, exception text, and provider data
must not enter labels or operator logs. Instrument creation alone is not proof
that metrics were exported or observed in production.
