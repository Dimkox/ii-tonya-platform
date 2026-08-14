# MVP-CLIENT-CATALOG-001 — Canonical Specification

Status: implementation blocked by `MVP-WORKER-OUTBOX-001`; this document freezes the
next slice only. Base: `0bfb6efc4b2145dfc5f4ba4763fa6264f422f842`.

## Objective

An authenticated active client can request a bounded catalog and later read only their
own immutable, privacy-safe snapshot. The request transaction creates the durable
`catalog.show` fact; a worker, never the HTTP request, builds the snapshot.

## Requirements

- **CCAT-001 — Fail-closed client authority.** Every route accepts only an injected
  `ClientPrincipal` with `authenticated: true`, `active: true`, and a canonical UUID
  `userId`. Missing, malformed, expired, inactive, revoked, or resolver-error authority
  is `401` and does not query or mutate catalog data.
- **CCAT-002 — Strict request boundary.** `POST /v1/client/catalog-requests` accepts
  exactly an object with optional `serviceCode` and `language`; both are trimmed bounded
  public-filter strings. Extra keys, wrong types, empty strings after trimming, controls,
  and a body above 8 KiB are rejected as `400`.
- **CCAT-003 — Atomic, user-scoped idempotency.** A canonical SHA-256 request digest is
  derived server-side from the request version, authenticated `userId`, normalized
  `serviceCode`, and normalized `language`. A single serializable transaction inserts or
  replays one request and one `catalog.show` outbox row. The caller supplies no idempotency
  or user identifier. Equal normalized filters for different users never collide.
- **CCAT-004 — Owner-only state.** `GET /v1/client/catalog-requests/:catalogRequestId`
  returns only `pending` or `ready` for the authenticated owner. Missing, expired, or
  foreign IDs all return the same `404 { error: "not_found" }`; a foreign request is never
  distinguished from an absent one.
- **CCAT-005 — Bounded authoritative source.** A snapshot has at most 20 deterministic
  public expert-service cards and at most 3 deterministic slots per card. Cards require
  active + verified expert and active service. A fresh local slot means `observed_at` is in
  `[worker database now - 15 minutes, worker database now]`, starts at least 24 hours after
  that same clock, and has remaining capacity. Slots are sorted by `startsAt`, then internal
  row identity; expired, future-observed, partial, malformed, or capacity-unknown facts do
  not appear.
- **CCAT-006 — No fabricated availability.** Without an approved available Planerka
  capability, the worker returns eligible cards as `availability: "catalog_only"` with
  `slots: []`. It does not call Planerka, infer slots, or present stale availability.
- **CCAT-007 — Compatibility and joint feature gate.** Existing conversation-origin
  `catalog.show` payloads stay byte-for-byte compatible. The generic worker has no
  `catalog.show` handler unless both `CLIENT_CATALOG_ENABLED=true` and
  `WORKER_OUTBOX_DELIVERY_ENABLED=true`; both default to `false`. Thus default-off does
  not claim or mutate legacy rows, while an enabled handler must recognize their unchanged
  shape as a distinct branch.
- **CCAT-008 — Privacy and accounting boundary.** API responses, snapshots, outbox
  payloads, logs, metrics, and exports contain no provider, contact, private, or raw
  payload identifiers. Catalog viewing creates no package, ledger, charge, reservation,
  payment, provider mutation, or contact disclosure.
- **CCAT-009 — Snapshot and retention lifecycle.** The worker resolves each request at
  most once: first successful snapshot write wins and later delivery/reconciliation replay
  returns it unchanged. At 24 hours retention atomically marks a request expired and strips
  filters/snapshot; a worker which subsequently locks that row returns a no-materialization
  terminal result. Only a minimal non-exportable tombstone (request ID, expiry and state)
  may remain until its linked outbox row reaches a terminal state, after which both are
  removed. Subject erasure locks the same request/outbox pair, deletes snapshot/request and
  any tombstone, and a later worker treats its payload as a harmless missing request.
- **CCAT-010 — Bounded operation evidence.** Metrics may label only phase and normalized
  outcome. They exclude IDs, filters, names, slot timestamps, raw payloads, and principal
  data. Verification requires repository concurrency/idempotency, route authority and
  enumeration, worker payload compatibility, privacy, retention, and real PostgreSQL tests.

## Non-goals

- A client session issuer, Selarti login, live Planerka adapter, booking, reservation,
  payments, client contact data, or a user-facing transport.
- Updating an already-ready snapshot when availability changes.
- Enabling either feature flag or activating a provider.

## Blockers and acceptance

Implementation starts only after `MVP-WORKER-OUTBOX-001` is merged. Activation remains
blocked by an approved client session issuer/resolver and authenticated Selarti/Planerka
contracts. Acceptance is a request/replay, pending-to-ready, owner-only 404, first-write
wins, catalog-only, fresh-slot, 24-hour cleanup, export/erasure, and zero-ledger-delta
demonstration on real PostgreSQL; it does not authorize production.
