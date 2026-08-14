# Client Catalog Booking Amendment v1

Status: frozen compatibility amendment; default-off, not implemented here, and not live.

This document supersedes Client Catalog Contract v1 only when booking-aware catalog
materialization is enabled. Catalog v1 request/read authority, owner filtering, bounded cards,
retention, privacy, and legacy payload compatibility remain unchanged.

## Booking-aware request identity

When `CLIENT_BOOKING_ENABLED=false`, catalog digest and request-origin outbox payload remain
exactly v1. When true, the server selects a separate digest domain:

```text
sha256("client-catalog-booking-v1\0" + userId + "\0" + serviceCode + "\0" + language)
```

and emits the strict request-origin payload:

```json
{"v":2,"catalogRequestId":"uuid"}
```

The worker recognizes legacy conversation payload, catalog request v1, and booking-aware request
v2 as three exact disjoint variants. Mixed or unknown shapes are terminal invalid payloads. A v1
ready snapshot is immutable and never upgraded in place; the distinct digest creates or replays a
separate booking-aware request.

## Protected choice materialization

For a complete fresh local availability result, each chosen slot has a canonical internal local
slot UUID available only to the worker and repository. The worker generates 32 CSPRNG bytes and
serializes `ch1.` plus 43 unpadded base64url characters. Snapshot and protected mapping commit in
the same first-write transaction.

The owner-visible slot shape becomes:

```json
{"startsAt":"2026-08-16T12:00:00.000Z","choiceHandle":"ch1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
```

The protected mapping stores only the handle digest, request/owner relationship, local slot UUID,
expiry, and creation time. The public snapshot never stores or returns expert, service, slot,
reservation, provider, capacity, observed-time, outbox, correlation, or contact identifiers.
`catalog_only` cards keep `slots: []`.

`startsAt` is a finite PostgreSQL `timestamptz` serialized exactly as UTC
`YYYY-MM-DDTHH:mm:ss.sssZ`. Invalid/non-finite serialization fails materialization without a
snapshot. The handle generator retries a protected digest/unique-index collision at most three
times inside first-write materialization; exhaustion rolls the transaction back with a sanitized
internal failure and no snapshot or mapping.

Choice expiry is the earliest of request expiry, availability observation plus 15 minutes, and
slot start minus 24 hours. Reserve and cleanup coordinate on the choice-digest lock, while the
repository preserves its already-ratified request/choice row-lock topology; no path introduces a
global reorder. Cleanup cannot delete a mapping while reserve owns the coordination lock. A
committed reservation survives later catalog cleanup.

## Compatibility and activation

Booking-aware catalog materialization requires `CLIENT_CATALOG_ENABLED=true`,
`WORKER_OUTBOX_DELIVERY_ENABLED=true`, `CLIENT_BOOKING_ENABLED=true`, an injected secure handle
generator, and a protected choice repository. Missing capability fails preflight. This amendment
does not enable those flags, approve Planerka availability, or authorize provider traffic.
