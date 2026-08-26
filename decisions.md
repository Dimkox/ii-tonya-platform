# Decisions

- Keep Task 5 dispatch behind a dedicated worker job interface with no outbox registry dependency. This preserves the contract’s separation between frozen conversation operations and existing outbox handlers.

- Keep client-conversation authentication as an injected production capability; fixture key material and fixture implementations stay outside runtime imports. This preserves the reviewed fixture-only boundary while allowing the API route and its fail-closed composition to be tested.

## 2026-08-26 — Ignore unrelated harness route

When the harness `active-route.json` names a different repository and task, keep the current repository's approved plan and isolated single write owner instead of dispatching mismatched agents. This worked because it preserved ii-tonya scope and avoided contaminating its change evidence with an unrelated software-factory change package.

## 2026-08-26 — Encrypt inside the completion transaction through an opaque capability

Generate the operation identity and expiry from PostgreSQL, then invoke an injected crypto capability before inserting the operation in the same completion transaction. This kept ledger, audit and encrypted freeze atomic while preventing raw key bytes from entering the repository API.

## 2026-08-26 — Share transaction timestamp semantics for the 24-hour envelope

Derive `payload_expires_at` from `transaction_timestamp()+24h`, matching the table's `created_at DEFAULT now()` semantics. This satisfied the exact database constraint without clock drift or application-time assumptions.
