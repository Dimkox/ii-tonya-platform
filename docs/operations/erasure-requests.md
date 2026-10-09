# Erasure requests and private status receipts

AC-015 separates accepting an owner request from executing deletion. Migration
0041 adds one request per subject, a unique domain-separated receipt digest and
an optional composite foreign key to the same subject's deletion job. A retry
with another digest conflicts; no route rotates or recovers a lost credential.

The browser creates 32 random bytes before submission and offers an explicit
download. The key stays in memory only, never in URLs or browser storage.
Explicit confirmation and a session-bound Origin/CSRF check are required for
`POST /v1/browser/privacy/erasure-requests`. GET on that exact path reads the
authenticated owner's request. `POST /v1/browser/privacy/erasure-status` accepts
only the receipt in JSON, requires the configured same Origin, and grants no
account access or mutation. `CLIENT_ERASURE_REQUESTS_ENABLED` defaults false and
independently controls creation; privacy and client sessions must also be enabled.
Status reads remain composed when creation is closed. Request acceptance does
not deactivate the account.

## Execution prerequisites

`createErasureRequestExecution` supplies a deterministic request idempotency key
and request/subject binding to the existing `startErasureAtomically` transaction.
The request link, actual local cleanup and session revocation commit together.
`runErasureRequests` provides a bounded worker runner, with an optional
`clientErasureRequests` runtime hook. Neither API nor production worker currently
composes physical execution: authentic prerequisites are unavailable.

Before composing that hook, satisfy [data retention](data-retention.md), including:

- Historical target manifests for all four processors, authentic capture and
  envelope verification; currently disabled providers are not evidence of no copies.
- Approved versioned retention/backup policy, real processor adapters and a
  trusted verifier covering provider and hosting/manual backup copies.
- Protected attestation custody and retrieval by digest, with reviewed access,
  provenance and retention rules.
- The existing unresolved database invariant against adding/changing child work
  after certification, plus policy supersession and restore procedures.

Receipt completion calls the existing workflow `getJob` verifier and additionally
requires the explicitly configured current backup policy. The production request
repository has no policy binding, so it cannot certify completion. Stored raw
`backup_verified` alone, time expiry, client assertions or hashes cannot supply
proof. Minimal retained-fact counts come from the stored erasure receipt; no
processor targets, raw attestation, subject identifiers or session authority are
returned. These counts do not establish approved legal retention periods.

## Release and recovery

Apply additive migration 0041 before composing the new API. State metadata is
derived from isolated PostgreSQL 17.5 SQL replay, normalized against PostgreSQL
constraints and indexes, with input hashes and SQL-only supplement. Never run
`drizzle-kit generate` or execute introspection SQL as migrations.

A rollback must preserve request rows, digest revocation, job links and receipt
status access. An old API that returns 503 or 404 for the new routes is not a
compatible rollback. Retain the status-capable API alongside a prior web build,
or deploy a reviewed forward fix with the same receipt protocol. Close creation
through `CLIENT_ERASURE_REQUESTS_ENABLED=false` when needed. Keep
`CLIENT_PRIVACY_ENABLED=true` so export and withdrawal remain available; do not
drop the table or rotate digests.
Never restore a database snapshot that loses accepted requests, revocations or
erasure authority. Reconcile current authority before serving restored data.

This increment does not approve physical deletion, real-user acceptance or
production rollout. Independent review and operational release evidence are
coordinator-owned. No real client data was used in local tests.

### Two-stage activation and recovery boundary

1. Before installation, verify exact current native/web source, signed candidate
   manifests, journal ending0040, and absence of the request table. Use the host
   release lock. Keep privacy enabled and set only the erasure creation flag off.
2. Apply reviewed additive0041 with bounded PostgreSQL lock/statement waits using
   the candidate migration entrypoint. Never restore a database snapshot or run
   down-migration as an application rollback. Verify the journal and composite FK.
3. Install the status-capable API and web with creation still closed. Verify
   readiness, independent services, anonymous status denial, public routes and
   displayed demo disclosures. Retain signed candidate and previous artifacts.
4. Before enabling creation, prove recovery with the exact status-capable
   artifact. Recovery must keep that API (or a reviewed compatible forward fix),
   close only creation, and may restore the prior web. Verify receipt/revocation
   continuity in an isolated database; never manufacture a live customer's
   erasure request as a deployment smoke test.
5. Only then enable creation explicitly. Once any request is accepted, reverting
   API to b658b5c is forbidden: it has no receipt routes. Retain the current
   database and status-capable API during recovery; verify rights and readiness.

This sequence is an operational contract, not evidence that installation,
artifact recovery or activation has occurred. Current local restart evidence and
its unresolved augmented-test run are recorded in the implementation handoff.
