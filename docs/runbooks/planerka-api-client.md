# Planerka REST client

The transport now has a PostgreSQL-owned booking workflow and a production worker
composition. This does not activate Planerka. The disabled legacy adapter and
false-only `PLANERKA_ENABLED` configuration remain in place; the new workflow uses
separate admission/recovery switches below.

## Contract and use

Provider references inspected on 2026-10-12: [API guide](https://help.planerka.app/api)
and [OpenAPI](https://planerka.app/rest/v2/doc.json). The fixed base URL is
`https://planerka.app/rest/v2`. Slots use `cal-api-version: 2024-09-04`; profile,
event types and bookings use `2024-08-13`. Authentication is bearer API key.

Import `createPlanerkaClient` and its public types from `@ii-tonya/integrations`
only in server code. Pass a server-side secret as `apiKey`; never log the config,
commands or returned bookings. Tests can inject a `PlanerkaTransport` as the
second argument. A transport must honor the fixed URL, redirect policy and abort
signal; an injected transport is trusted code. Native `fetch` is the default.

| Method                         | Result                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| `getProfile()`                 | Validated owner profile                                       |
| `listEventTypes()`             | Validated event types                                         |
| `listSlots(query)`             | Date-keyed slot arrays                                        |
| `listBookings(query?)`         | One `{ data, pagination }` page                               |
| `getBooking(uid)`              | `{ kind: "found", booking }` or `{ kind: "missing" }` on 404  |
| `createBooking(command)`       | Validated matching provider booking, including pending status |
| `cancelBooking(uid, command?)` | Matching booking with cancelled status                        |

Where the provider permits a list or keyed object, results are normalized to
arrays. Unknown response fields are stripped. Required response fields, dates,
booking UID and event-type identity are checked. Requests reject unknown fields.
Event selection uses either `eventTypeId` or `eventTypeSlug` plus `username`.
Slot query dates are `YYYY-MM-DD`; booking timestamps include a UTC offset.

Local resource limits: at most 31 inclusive slot-query dates, booking page `take`
1–100, request JSON and streamed response at most 256 KiB, total request deadline
15 seconds by default (`timeoutMs` may be 1–60,000 ms). These are client policy,
not claims about provider limits. The deadline includes response-body reading.
Redirects are rejected and response bodies are cancelled on failure. Pages and
requests are never automatically repeated or prefetched.

## Outcomes and recovery

Errors expose only a fixed `PlanerkaClientError.code` and fixed message. Raw
provider messages, thrown transport causes, URLs, credentials and attendee data
are not retained in diagnostics.

| Code                | Meaning and caller action                                          |
| ------------------- | ------------------------------------------------------------------ |
| `invalid_input`     | Local validation failed before HTTP; correct the command           |
| `access_denied`     | HTTP 401/403; verify subscription and scopes, no automatic retry   |
| `conflict`          | HTTP 409; select another slot                                      |
| `rate_limited`      | HTTP 429; schedule explicitly, no implicit loop                    |
| `not_found`         | HTTP 404 outside UID lookup; do not infer a completed cancellation |
| `rejected`          | Other definite HTTP rejection                                      |
| `invalid_response`  | Read response failed validation                                    |
| `transport_failure` | Read timed out, disconnected or received a server error            |
| `unknown_outcome`   | A mutation may have applied; reconcile before retrying             |

`PlanerkaUnknownOutcomeError` covers mutation timeouts, connection failures,
408/5xx, redirects, oversized/stalled bodies and malformed or mismatched success.
No second POST is sent. Creation has no invented idempotency header. Persist
operation ownership and reconcile externally before deciding on another send.
Repeated explicit cancellation is supported by the provider, but each successful
response must still match the UID and cancelled status.

A returned external booking, including `accepted`, does not confirm a Tonya
reservation. This client does not implement the legacy reserve/confirm port.

## Deferred activation checklist

- Obtain a working paid/trial account credential and verify required scopes.
- Map real experts and event types; validate ownership, duration, capacity,
  timezone and provider confirmation requirements.
- Verify the combined PostgreSQL0042/0043, worker, API and web candidate. Workflow
  calls use a shared PostgreSQL account limiter (one request every two seconds).
  The provider guide asks for no more than 5 requests/second and100/minute;
  other applications sharing the same provider account must be budgeted too.
- Review consent and attendee-field minimization before sending real data.
- Obtain explicit approval for a specific real booking probe; creation may send
  notifications. This implementation ran offline tests only.
- Complete release evidence, rollout and recovery review, then obtain separate
  production activation authorization. Payments remain outside this increment.

No live credential acceptance, booking probe or production readiness is
established by local tests. **Production notification consumers are missing:**
`telegram.reservation_request`, `client.booking_confirmed` and booking
cancellation/expiry topics currently have durable producers but no production
delivery handlers. Expert request/confirmation delivery is NOT established by
an outbox insert. No no-op consumer is installed. End-to-end product acceptance
remains open until real, consent/identity-bound handlers and delivery evidence exist.

## Workflow admission and mapping preflight

Default `PLANERKA_CREATE_ENABLED=false` and `PLANERKA_RECOVERY_ENABLED=false`.
Recovery requires server-only `PLANERKA_API_KEY` and positive numeric
`PLANERKA_ACCOUNT_ID`. Creation requires recovery to remain enabled. The worker
checks the authenticated account and (for creation) all enabled real mappings.
Preflight failure aborts startup; it never falls back to successful no-ops.

Operators must supply genuine `planerka_service_mappings` entries for real
expert services; no migration seeds experts, slots or mappings. Verify event
ownership, duration, profile timezone, one-person capacity, no provider approval,
no provider-side payment and the event's ability to accept only the minimum
attendee name/timezone. Current requests use the neutral label `Клиент`, never
consultation text, email, phone, Telegram identity or medical information. Types
requiring contact/custom answers are unsuitable until separately implemented.
Availability import/cache and genuine inventory provisioning are not supplied by
this workflow: an empty catalogue stays empty. Changing provider settings requires
repeating preflight and reviewing mappings before admitting new operations.

Expert approval creates one operation and keeps the reservation `reserved`.
Clients see `calendar_pending`. Before POST, the worker commits `sending` plus
send-admission time and a fenced lease. Only verified provider identity can commit
UID, `booked` and the single confirmation event together. A definite rejection
expires the local claim and publishes `client.reservation_expired`; clients must
refresh availability. This publication is not notification delivery.

## Unresolved operations and operator resolution

Inspect state/reason/counts without selecting request JSON or credentials:

```sql
SELECT state, reason_code, count(*)
FROM planerka_booking_operations GROUP BY state, reason_code;
SELECT count(*) FROM planerka_legacy_booking_reviews WHERE resolved_at IS NULL;
```

Lease expiry after admission becomes `unknown`, never `pending`. Unknown creation
without a trustworthy UID becomes `manual`; do not search by attendee/time and
infer a match, and never reset send admission or issue a second POST. A returned
bound UID is retained even when completion rolls back or its lease is stale;
recovery authenticates it with GET. There is no automated search-based resolver
or operator mutation API in this increment. Operator resolution requires a
separately reviewed, evidence-bound database operation; keep ownership and all
possible external effects until resolved. Never claim a missing GET record proves
cancellation. Terminal uncertainty remains visible for operator attention.

Cancellation/expiry during creation records intent. A later UID becomes
`cancel_pending`; no confirmation is emitted. Cancellation timeouts become
`cancel_unknown`; authenticated GET determines whether cancellation is complete.
Repeated accepted results permit at most five reconciliation rounds before
`manual`. Recovery runs with new creation disabled. Erasure waits for unresolved
operations and legacy reviews; finished provider bookings retain their UID but
do not permanently block local erasure. Booking receipt cleanup must not erase
unresolved ownership.

Migration0043 records historical `booked` rows for audit without fabricated UIDs
or replaying their old events. Public rows lacking a verified operation display
`confirmation_unverified`; their external status must not be represented as
confirmed. Resolve legacy review rows only with an evidence reference and an
explicit determination of external effects, including cancellation where needed.

## Exact candidate activation and rollback

Before a separately authorized release, verify the unchanged0042 prerequisite,
0043 SQL and database-derived snapshot/supplement, migration lineage, API/web
pending-state compatibility, notification consumers, real mappings, worker crash
recovery and erasure together. Record the exact source SHA, builds, focused test
counts, independent review and rollback artifact. Hosted CI is absent; do not
claim hosted CI/Database Gate/Trust CI success. A local green check is not release
evidence. A live booking probe needs an explicitly authorized target/recipient.

Rollback admission by setting `PLANERKA_CREATE_ENABLED=false`; retain recovery,
credential/account access, migration0043 and a compatible worker/API/web until all
external effects are resolved. Do not roll back to a binary that confirms on expert
approval, remove operation rows, or disable recovery just to halt new creation.
No automatic down-migration or production mutation is authorized by this runbook.

## Availability refresh (0051)

`PLANERKA_AVAILABILITY_ENABLED=false` is the default. Opting in requires
`PLANERKA_RECOVERY_ENABLED=true`, a valid `PLANERKA_API_KEY`, the configured
`PLANERKA_ACCOUNT_ID`, migration0051 and genuinely verified service mappings.
Creation can remain disabled. The ordinary production worker executes booking
recovery/creation first, then refreshes at most one due mapped service per cycle.
The optional `planerkaAvailability` cycle report exists only when composed and
contains bounded counts and fixed diagnostic codes, never provider bodies or keys.

The importer reads profile, event types and slots using the existing authenticated
transport and account-wide admission. Its separate client has a five-second
request timeout and the existing256KiB response cap. Account, timezone, both
duration fields, owner, free/visible/unconfirmed/single-seat event mode must match.
Missing range ends are accepted only with an explicit validated request duration;
the importer derives them from the verified mapping and rejects inconsistent facts.

PostgreSQL owns the90second fenced lease, observation time and seven complete UTC
days beginning tomorrow. An optional inclusive provider end-date bucket is validated
but excluded from publication. Success is due again after120seconds; fixed failures
after30seconds. Neither network work nor admission waits hold database transactions.
Failed responses leave existing slot freshness unchanged. Empty successful snapshots
advance the durable watermark and clear covered observations without deleting slots
or reservations. Existing slot UUIDs, external identities and capacity are retained.
Mapping insertion, changes and deletion invalidate observations and pending claims
atomically, including both services when a mapping moves. Availability row locks use
NOWAIT so they never hold mapping locks while waiting for booking resources.
Contention rolls back the whole transaction and reports `database_busy`; mapping
mutation callers must retry SQLSTATE55P03 as a whole transaction. Such retries do
not establish a new observation or publication. The window is168 absolute hours,
independent of session timezone or daylight-saving changes. Valid final-day slots
that extend beyond the window are omitted after validation.

Before every availability GET, durable account admission yields to actionable or
in-flight booking/recovery operations, including short retry delays. Pending creation
blocks imports only when creation is enabled; terminal/manual operations do not.
Availability admission has a50ms database lock timeout and a nonblocking account
row lock. Booking's existing admission behavior is unchanged.

Catalogue reads discard stale, past, less-than24hour lead and occupied rows before
their500row limit and omit active expert reservations overlapping other slots or
services; same-slot remaining capacity is preserved. Planerka choices require a
currently eligible mapping. A disabled
availability flag retains the previous runtime report shape. To stop imports, set
only `PLANERKA_AVAILABILITY_ENABLED=false`; existing observations expire naturally
after15minutes. Disable the reviewed mapping when immediate invalidation is needed.
Do not delete refresh state, slots or reservation history as a rollback mechanism.

Live provider access currently returns `access_denied`; synthetic transport evidence
does not establish a working subscription, live inventory, or deployment acceptance.
Provider activation, production-compatible database checks and release authorization
remain separate. Implementation evidence is in
`docs/test-evidence/planerka-availability-2026-10-13.md`.

## Availability diagnostics

Every non-idle ordinary-factory result emits `planerka_availability`, with only the
fixed `outcome` and integer `processed`/`published` counts through the existing
sanitized logger. Idle cycles emit no availability event. Never add account/service
IDs, response bodies, URLs or credentials to this event. A healthy worker heartbeat
does not establish provider access or fresh catalogue choices.

For a bounded read-only inspection, the following shows current per-service failure
states (not cumulative attempts), never-published services and oldest publication
age. A null age with a nonzero never-published count needs investigation. Contention
that rolled back before persisting a diagnostic is visible in the fixed log event.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '2s';
SELECT reason_code, count(*) AS services
FROM planerka_availability_refreshes
WHERE reason_code IS NOT NULL
GROUP BY reason_code ORDER BY reason_code LIMIT 8;
SELECT count(*) FILTER (WHERE published_at IS NULL) AS never_published,
  extract(epoch FROM clock_timestamp() - min(published_at))::bigint
    AS oldest_publication_age_seconds
FROM planerka_availability_refreshes;
COMMIT;
```
