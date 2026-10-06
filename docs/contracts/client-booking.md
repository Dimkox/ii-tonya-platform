# Client Booking Contract v1

Status: frozen implementation contract; default-off and not approved for live activation.

## Authority

```ts
export interface ClientPrincipal {
  readonly authenticated: true;
  readonly active: true;
  readonly userId: string;
}

export type ClientBookingPrincipalResolution =
  | { readonly kind: "resolved"; readonly principal: ClientPrincipal }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" };

export interface ClientBookingPrincipalResolver {
  resolve(authorization: string): Promise<ClientBookingPrincipalResolution>;
}
```

The resolver follows the exact raw-header and `^Bearer (cs1\.[A-Za-z0-9_-]{43})$` grammar frozen in
`client-booking-principal-prerequisite.md`, performs a fresh PostgreSQL lookup, and constructs the
minimal principal only after proving `client_booking:write`.
`client_catalog:read` alone does not satisfy this interface. The 2026-10-06 amendment
in `client-booking-principal-prerequisite.md` permits a separately persisted,
server-issued booking grant bound to that session. Scope, token hash, expiry, revocation, and
session ID stay inside resolution. No body, query, path, alternate header, Selarti identity, or
cached claim supplies ownership.

## Reserve

`POST /v1/client/bookings`, exact JSON body, maximum 1 KiB:

```json
{ "choiceHandle": "ch1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }
```

The handle is exactly `^ch1\.[A-Za-z0-9_-]{43}$`. No other key is accepted. The server hashes it
as `sha256:<64 lowercase hex>`, validates the owner-protected mapping, and derives:

```text
sha256("client-booking-reserve-v1\0" + principal.userId + "\0" + choiceDigest)
```

First commit:

```http
HTTP/1.1 201 Created
Cache-Control: no-store

{"bookingHandle":"bk1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","state":"reserved","reservedUntil":"2026-08-16T11:00:00.000Z"}
```

Replay returns `200` with the same `bookingHandle`, `reservedUntil`, and current public state. The
booking handle is exactly `^bk1\.[A-Za-z0-9_-]{43}$`, is random, owner-scoped, and is not authority
without a freshly resolved principal.

The only media type is `application/json`, optionally followed by the single parameter
`charset=utf-8`; parameter names/values are ASCII case-insensitive and every other parameter is
rejected. Content-Encoding and UTF-8 BOM are forbidden. The de-framed entity limit is 1,024 octets
before strict UTF-8 and JSON decoding. The decoder requires one complete object, one unique
`choiceHandle` key, permits only JSON whitespace outside that object, and rejects duplicate keys or
any other trailing byte. Ingress rejects duplicate or conflicting Content-Length, simultaneous
Content-Length and Transfer-Encoding, invalid chunking, and any proxy/protocol path that cannot
prove unambiguous framing before resolver or repository access.

## Owner cancel

`DELETE /v1/client/bookings/:bookingHandle` accepts no request body: Content-Type,
Content-Encoding, and Transfer-Encoding are absent; Content-Length is absent or literal `0`; and
zero entity octets follow. It resolves the protected
receipt by exact owner plus handle, derives the internal cancel identity from the reservation and
literal `client_cancel`, and executes the existing transition. First cancellation and replay both
return:

```json
{
  "bookingHandle": "bk1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "state": "cancelled"
}
```

Internal `cancelled_by_client` and `cancelled_by_expert` both project to `cancelled`. Other public
states are `reserved`, `booked`, `expired`, `completed`, and `no_show`. HTTP never emits an
internal reservation ID, version, expert/service/slot/provider ID, capacity, amount, payment,
contact, correlation ID, outbox ID, or audit ID.

## Errors and feature gates

| Condition                                                                                | Response                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| malformed body/path/media/framing                                                        | `400 {"error":"invalid_request"}`         |
| denied authority                                                                         | `401 {"error":"unauthorized"}`            |
| syntactically valid absent, erased, or foreign choice; foreign or missing booking handle | `404 {"error":"not_found"}`               |
| owned expired/stale/ineligible/full choice or non-cancellable non-cancelled owner state  | `409 {"error":"conflict"}`                |
| reserve kill switch false while booking route capability remains enabled                 | `503 {"error":"feature_disabled"}`        |
| resolver or PostgreSQL unavailable                                                       | `503 {"error":"temporarily_unavailable"}` |
| unexpected internal failure                                                              | `500 {"error":"internal_error"}`          |

`CLIENT_BOOKING_ENABLED=false` removes both routes. With it true,
`CLIENT_BOOKING_RESERVE_ENABLED=false` disables POST only and leaves authenticated owner DELETE
available. Both default false. Error bodies include no nested cause, handle, principal, internal
ID, state detail, provider fact, or selection reason.

DELETE of either internal cancellation terminal returns the same stable `200` public cancelled
projection and creates no effect. This prevents cancellation actor inference. All reserve/cancel
successes and authenticated `400|404|409|500|503` responses carry `Cache-Control: no-store`.

## PostgreSQL transaction and durable effects

Reserve first coordinates with catalog cleanup on the choice-digest advisory lock documented by
CBK-010, then enters the existing booking repository's sorted advisory/row-lock protocol. It
rechecks database-time choice expiry and every existing booking eligibility invariant, then calls the existing reservation
insert/audit/outbox implementation inside the same serializable transaction. The protected
receipt contains owner UUID, choice digest, opaque booking handle, reservation FK, and creation
time only. Unique `(user_id, choice_digest)` and unique booking handle enforce replay.
Choice and booking handle generators retry a unique-index collision at most three times inside the
owning transaction. Exhaustion produces sanitized `500 internal_error` and rolls back every
mapping, receipt, reservation, audit, outbox, and capacity effect.

Cancel rechecks owner and current reservation under the same transaction. Repeated client cancel
is a read-only replay. A competing expert action or expiry wins only through the existing versioned
state transition; the loser returns current public outcome or normalized conflict without another
side effect.

The existing free outbox payloads may contain protected internal reservation IDs because they are
not client payloads. All four booking topics remain absent from worker handler exports, registry,
claim/reconciliation allowlists, and adapter construction under every booking/catalog flag matrix.
No booking operation invokes a provider, message ledger, payment, amount, refund, coupon, or
contact repository.

## Privacy and telemetry

Choice/booking handles, authorization, principal IDs, choice digests, internal IDs, filters,
payloads, and timestamps are redacted before logs/traces/evidence. Metrics use only the fixed
operation/outcome values in CBK-014. Catalog cleanup deletes choice mappings; subject erasure
first moves every owned active reservation through the existing client-cancel transition. If any
transition races or fails, erasure remains pending and retains the public handle. After all owned
reservations are terminal, a separate cleanup transaction removes public receipts/handles and
preserves only pre-existing required reservation/audit facts. That cleanup never holds a choice
lock while requesting a booking lock. Subject export uses public handle/state/time and no internal
ID. Every public instant is a finite PostgreSQL `timestamptz` serialized exactly as UTC
`YYYY-MM-DDTHH:mm:ss.sssZ`; invalid/non-finite serialization returns a sanitized `500` before any
response is emitted.

## Durable local erasure phase

The existing privacy worker owns a PostgreSQL work record keyed by the existing deletion job. Its
phase is `cancel_active -> cleanup_public -> complete|dead_letter`; the parent job cannot become
`processor_complete` until this local phase is `complete`. Claims use `FOR UPDATE SKIP LOCKED`, a
database-time five-minute lease, and a fencing token checked by every write. An expired lease is
reclaimable. Each cancellation derives an idempotency identity from literal
`privacy-client-cancel-v1`, deletion job ID, and reservation ID and uses the existing booking
transition. The worker re-reads state after a crash or unknown outcome.

Cleanup starts only after a locked PostgreSQL query proves zero owned `reserved|booked`
reservations. Booking locks are released before the separate choice/receipt cleanup transaction.
Five failed claims for one phase move it to operator-visible `dead_letter`; only an explicitly
approved operator requeue can resume it. Until completion, the public handle remains available for
owner cancellation. Repeated claims, lease expiry, partial owner sets, and crashes between the two
phases are idempotent.
