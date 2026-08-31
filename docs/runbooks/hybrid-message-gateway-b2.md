# Hybrid message gateway B2 rollback and forward recovery

## Activation gates

Keep `SELARTI_RESPONSE_INGRESS_ENABLED`, `B2_TELEGRAM_DISPATCH_ENABLED`, and
`B2_SENSITIVE_RETENTION_ENABLED` false until the official signed/shared-secret Selarti
fixture, staging delivery/reconciliation, retention, and release approvals are recorded.
The worker capability is implemented, but production registry binding to the Telegram
transport/token is intentionally absent until those gates pass.

## Rollback

Disable all three flags first. This stops new provider proposals, Telegram dispatch, and
purge batches without deleting B1/B2 durable state. Do not reverse migration 0035: it is
additive and B1 rows remain readable; resume through forward recovery after repair.

## Forward recovery

Inspect `integration_outbox` by fixed topic/status counts, reconcile every
`unknown_outcome`, and resolve the lowest unfinished sequence before later work in the
same dialogue. Re-enable one capability at a time after bounded staging verification.
Selarti request payloads must remain until a matching proposal exists or their deadline
passes; Telegram terminal payloads may be redacted immediately. Tombstones retain hashes
needed for replay conflict detection while raw inbound text is physically removed.
