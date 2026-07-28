# Architecture core

- Modular monolith with separately runnable API and worker processes.
- Provider adapters: Selarti inbound/outbound, Telegram expert callbacks, Planerka schedule/booking reconciliation, optional payment provider, Make/Sheets projections.
- Domain modules: identity/consent, clients, experts/catalog, event instances, reservations/waitlist, packages/message ledger, coupon ledger, payments/refunds, conversations, notifications, safety incidents, integration inbox/outbox, audit.
- Conditional reservation state machine; capacity is derived from active rows under transaction/locking, not a mutable sheet counter.
- Append-only ledger entries are authority for messages/coupons/money; materialized balances are rebuildable projections.
- Provider events store `(provider,event_id)` uniqueness and raw evidence with PII redaction; repeats are no-ops.
- Outbox delivery is retryable with backoff, dead-letter state, and reconciliation.
- Make/Sheets cannot authorize or perform critical financial/booking transitions.
- Detailed design lives in `docs/superpowers/specs/2026-07-28-ii-tonya-platform-design.md`; normalized contract lives in `docs/spec/normalized-requirements.md`.