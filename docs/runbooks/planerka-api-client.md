# Planerka REST client

This increment provides server-only transport. It does not activate Planerka or
connect the worker, database reservation flow or client UI. The disabled legacy
adapter and false-only `PLANERKA_ENABLED` configuration remain in place.

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
- Implement durable PostgreSQL operation ownership, UID storage, reconciliation
  and concurrent cancellation recovery. Wire worker/API/client pending states.
- Schedule account-wide requests and cache availability. The provider guide asks
  for no more than 5 requests/second and 100/minute; this client has no scheduler.
- Review consent and attendee-field minimization before sending real data.
- Obtain explicit approval for a specific real booking probe; creation may send
  notifications. This implementation ran offline tests only.
- Complete release evidence, rollout and recovery review, then obtain separate
  production activation authorization. Payments remain outside this increment.

No live credential acceptance, booking probe, workflow integration or production
readiness is established by local client tests.
