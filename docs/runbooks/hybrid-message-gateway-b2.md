# Hybrid message gateway B2 rollback and forward recovery

## Activation gates

Keep `SELARTI_RESPONSE_INGRESS_ENABLED`, `SELARTI_RESPONSE_POLL_ENABLED`,
`B2_TELEGRAM_DISPATCH_ENABLED`, and `B2_SENSITIVE_RETENTION_ENABLED` false until
staging delivery and release approvals are recorded. The response ingress now
accepts Selarti's documented all-messages webhook (see
`docs/operations/selarti-all-messages-webhook.md`). Turning that flag on does
not enable Telegram dispatch.
The worker capability is implemented, but production registry binding to the Telegram
transport/token is intentionally absent until those gates pass.

## Rollback

Disable all four flags first. This stops new provider proposals, the response poller, Telegram dispatch, and
purge batches without deleting B1/B2 durable state. Do not reverse migration 0035: it is
additive and B1 rows remain readable; resume through forward recovery after repair.

## Forward recovery

Inspect `integration_outbox` by fixed topic/status counts, reconcile every
`unknown_outcome`, and resolve the lowest unfinished sequence before later work in the
same dialogue. Re-enable one capability at a time after bounded staging verification.
Selarti request payloads must remain until a matching proposal exists or their deadline
passes; Telegram terminal payloads may be redacted immediately. Tombstones retain hashes
needed for replay conflict detection while raw inbound text is physically removed.
