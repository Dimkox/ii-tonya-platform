# Client Catalog Contract v1

Status: frozen implementation contract. No live provider contract is asserted.

## Authority

```ts
export interface ClientPrincipal {
  readonly authenticated: true;
  readonly active: true;
  readonly userId: string; // canonical UUID, never accepted from request body
}

export interface ClientPrincipalResolver {
  resolve(authorization: string | undefined): Promise<ClientPrincipal | null>;
}
```

The resolver is injected at composition. It fails closed: an exception, `null`, a false
field, or invalid UUID is unauthenticated. `active` is a claim the future issuer must
prove; this repository currently has no client session issuer or resolver.

## HTTP

`POST /v1/client/catalog-requests`

```json
{"serviceCode":"career","language":"ru"}
```

Both fields are optional. The request object has no other keys. `serviceCode` and
`language` use their normalized trimmed values; absent values are represented in the
digest by the empty component, not JSON `null`.

Success is `202` for both creation and replay:

```json
{"catalogRequestId":"uuid","state":"pending"}
```

`GET /v1/client/catalog-requests/:catalogRequestId` returns either:

```json
{"catalogRequestId":"uuid","state":"pending"}
```

or:

```json
{
  "catalogRequestId":"uuid",
  "state":"ready",
  "cards":[
    {
      "displayName":"Эксперт",
      "serviceCode":"career",
      "language":"ru",
      "availability":"catalog_only",
      "slots":[]
    }
  ]
}
```

For fresh availability, a card uses `availability: "fresh_slots"` and each slot is only
`{ "startsAt": "2026-08-14T12:00:00.000Z" }`. Neither response serializes expert,
service, slot, provider, channel, contact, request-digest, outbox, or correlation IDs.
`400 invalid_request`, `401 unauthorized`, `404 not_found`, `413 payload_too_large`,
`503 feature_disabled`, and `500 internal_error` are the only route errors.

## Digest and durable payload

The server computes:

```text
sha256("client-catalog-v1\\0" + userId + "\\0" + serviceCode + "\\0" + language)
```

The unique request key is `(user_id, request_digest)`. Its transaction writes the current
outbox schema fields deterministically: `idempotency_key` is
`client-catalog:<catalogRequestId>`, `reconciliation_key` is
`client-catalog:<catalogRequestId>:v1`, and `payload_hash` is SHA-256 of the exact canonical
JSON payload below. `correlation_id` is audit context only and never changes replay identity.
Concurrent replays lock the unique request row and return its original receipt/outbox fact;
they do not update payload, hash, filters, or correlation identity.

The new outbox payload is exactly:

```json
{"v":1,"catalogRequestId":"uuid"}
```

The `catalog.show` handler must preserve the existing conversation-origin variant:

```json
{"serviceCode":"career","allowedServiceCodes":["career"]}
```

It must strictly recognize the two shapes; an unknown shape is a normalized terminal
dead-letter outcome, never a guessed catalog. The request-origin handler loads owner and
filters from the protected `client_catalog_requests` row, not the payload. When either
feature flag is false no `catalog.show` handler is registered or claimed; when both are
true, the legacy branch remains dispatchable with its unchanged payload.

## Slot freshness and expiry race

The worker database clock is the only catalog clock. A slot may be serialized only if
`now - 15 minutes <= observedAt <= now`, `startsAt >= now + 24 hours`, and remaining
capacity is known positive at that read. Any unavailable, partial, stale, future-observed,
or malformed availability result makes the entire card `catalog_only` with `slots: []`.

At `expiresAt`, retention locks the request and its `catalog.show` outbox row in the same
transaction, marks the request `expired`, removes public snapshot and filters, and leaves a
minimal non-exportable tombstone until the outbox is terminal. A materializer under the same
lock observes `expired` or missing and returns a terminal no-materialization result. Subject
erasure applies the same lock, removes the request/tombstone immediately, and later payload
replay is a terminal missing-request result. Tests must cover claimed-worker-versus-retention
and claimed-worker-versus-erasure interleavings on PostgreSQL.
