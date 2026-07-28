# Conventions

- Organize by domain module, not horizontal controller/service dumping.
- Keep pure domain transitions separate from provider adapters and persistence.
- UUIDs internally; immutable numeric Telegram user/chat IDs for authorization.
- Money uses integer minor units; coupon/message balances are append-only ledgers, never mutable counters as authority.
- All timestamps are timezone-aware UTC; retain source timezone for display.
- Provider webhooks require schema validation, signature/secret verification when available, event-id uniqueness, replay protection, and raw evidence retention with PII redaction.
- Reservation transitions are conditional and versioned; terminal-state repeats are no-ops.
- Safety/opt-out/error/receipt/cancellation messages bypass paid-message billing.
- No credentials in repository, prompts, Sheets exports, logs, fixtures, or callback payloads.
- Tests are written first and must demonstrate RED before implementation.
- Commit by independently testable task; no unrelated refactors.