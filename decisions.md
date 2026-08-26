# Decisions

- Keep Task 5 dispatch behind a dedicated worker job interface with no outbox registry dependency. This preserves the contract’s separation between frozen conversation operations and existing outbox handlers.

- Keep client-conversation authentication as an injected production capability; fixture key material and fixture implementations stay outside runtime imports. This preserves the reviewed fixture-only boundary while allowing the API route and its fail-closed composition to be tested.

## 2026-08-26 — Ignore unrelated harness route

When the harness `active-route.json` names a different repository and task, keep the current repository's approved plan and isolated single write owner instead of dispatching mismatched agents. This worked because it preserved ii-tonya scope and avoided contaminating its change evidence with an unrelated software-factory change package.

## 2026-08-26 — Encrypt inside the completion transaction through an opaque capability

Generate the operation identity and expiry from PostgreSQL, then invoke an injected crypto capability before inserting the operation in the same completion transaction. This kept ledger, audit and encrypted freeze atomic while preventing raw key bytes from entering the repository API.

## 2026-08-26 — Share transaction timestamp semantics for the 24-hour envelope

Derive `payload_expires_at` from `transaction_timestamp()+24h`, matching the table's `created_at DEFAULT now()` semantics. This satisfied the exact database constraint without clock drift or application-time assumptions.

## 2026-08-26 — Reconcile the Task 6 PostgreSQL evidence target

Use PostgreSQL 16.15 (`server_version_num=160015`) for the executable Task 6 gate because the plan and pinned test host require that exact value; stale 17.5 prose describes deployment configuration, not this test target. This keeps immutable evidence aligned with the actual verification environment.
## 2026-08-26 — Bind the conversation gate to an independently recomputed invocation digest

Pattern: hash a fixed ordered tuple of reviewed SHA and fixed gate/migration/test file hashes on the outer host, then recompute the same tuple inside the isolated gate. This worked because it binds the invocation to both Git identity and the exact executable evidence surface without accepting a mutable manifest.
