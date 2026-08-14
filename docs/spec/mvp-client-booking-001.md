# MVP-CLIENT-BOOKING-001 — Canonical Specification

Status: documentation and implementation plan prepared; implementation awaits the merged
`MVP-CLIENT-PRINCIPAL-001` prerequisite and live activation is blocked. Documentation base:
`3db7ad1f3c76a58ebe6478863226c12e83ce306c`. Approved principal input:
`94ad64c922db1278fa78d3823a8959e5cfe90f95` (rebased successor of `c2db85c`).

## Objective, actors, owners, and approvals

An authenticated active internal client can reserve one fresh choice from their own catalog
snapshot and cancel that reservation through opaque public handles. Platform owns composition;
Catalog owns protected choice materialization; Booking/DB owns reservation state; Security owns
the `client_booking:write` trust decision; Product owns the public state and error contract.
Implementation requires Product contract approval. Live activation additionally requires named
Security approval and a separate target deployment authorization.

## Requirements

- **CBK-001 — Prerequisite and default-off capability.** Implementation MUST start from the
  merged approved principal change or a reviewed equivalent containing its frozen contracts.
  `CLIENT_BOOKING_ENABLED` and `CLIENT_BOOKING_RESERVE_ENABLED` MUST both default to `false`.
  Booking routes are absent when the first flag is false. When the capability is enabled, a
  missing booking-aware catalog materializer, `ClientBookingPrincipalResolver`, booking service,
  or repository MUST fail pure preflight before migrations or listener startup.
- **CBK-002 — Separate authenticated write authority.** Every reserve and cancel request MUST
  resolve one exact bearer through the principal contract's raw-header grammar and a fresh
  PostgreSQL lookup. The resolver returns only an authenticated, active canonical internal
  `userId` after proving `client_booking:write`; `client_catalog:read` alone is denied. Negative
  authority maps to `401`; resolver/database unavailability maps to credential-free `503`.
- **CBK-003 — Protected catalog choice.** When booking-aware materialization is enabled, each
  eligible fresh slot in a newly materialized owner-only catalog snapshot receives one random
  `ch1.<43 unpadded base64url characters>` handle. PostgreSQL stores a protected mapping from
  `sha256:<64 lowercase hex>` handle digest to catalog request, owner, local slot, and expiry.
  The snapshot contains only `startsAt` plus the opaque handle. It contains no expert, service,
  slot, reservation, provider, channel, contact, capacity, observed-time, or mapping identifier.
- **CBK-004 — Versioned catalog compatibility.** Catalog v1 request, payload, snapshot, retention,
  and legacy `catalog.show` behavior remain unchanged when booking is disabled. Booking-aware
  requests use a server-selected digest domain `client-catalog-booking-v1` and strict
  `{ "v": 2, "catalogRequestId": "uuid" }` outbox payload, so an immutable v1 snapshot is never
  retrofitted. Existing v1 snapshots remain readable but have no bookable choice.
- **CBK-005 — Strict reserve HTTP.** `POST /v1/client/bookings` accepts exactly
  `{ "choiceHandle": "ch1.<43 base64url characters>" }`, JSON only, at most 1 KiB. Extra keys,
  body authority, malformed handles, controls, wrong media/framing, or a request body outside the
  exact shape is `400 invalid_request`. Content-Type is `application/json` with no parameter or
  only `charset=utf-8`; Content-Encoding and a UTF-8 BOM are forbidden. The de-framed entity is at
  most 1,024 octets before strict UTF-8/JSON decode, contains exactly one object with one unique
  key, and has no non-JSON trailing byte. Ingress rejects duplicate/ambiguous Content-Length,
  Content-Length plus Transfer-Encoding, invalid chunking, and framing it cannot preserve. DELETE
  permits no Content-Type, Content-Encoding, or Transfer-Encoding and only absent Content-Length
  or literal zero with zero entity octets. Every framing/media rejection occurs before principal
  resolution or repository access. The request accepts no `userId`, internal ID,
  idempotency key, amount, provider, payment, contact, expected version, or client clock. After
  authority, every syntactically valid absent, erased, or foreign choice handle is the same
  `404 not_found`; `409 conflict` is reserved for an owned choice whose eligibility changed.
- **CBK-006 — Server-derived idempotency and public receipt.** The application derives the
  reservation idempotency key as SHA-256 of the exact versioned domain, authenticated `userId`,
  and choice-handle digest. It generates one random `bk1.<43 base64url characters>` public booking
  handle. A unique protected receipt `(user_id, choice_digest)` binds that handle to the
  reservation. Repeating or racing the same choice returns the original receipt and current
  public state; it never creates a second reservation, audit event, outbox set, or capacity effect.
  Handle generators retry a unique-index collision at most three times inside the owning
  transaction; exhaustion returns sanitized `500` and commits no partial effect.
- **CBK-007 — Atomic authoritative reserve.** One serializable PostgreSQL transaction MUST lock
  and recheck the active user, owned ready catalog request, unexpired choice, active verified
  expert/service, fresh local slot observation, 24-hour lead, capacity, client/expert overlap, and
  reservation deadline. It then creates the existing `reserved` reservation, protected receipt,
  existing audit event, and existing free outbox rows atomically. It MUST extend the existing
  `BookingService` and `PostgresBookingRepository`; a parallel reservation store is forbidden.
- **CBK-008 — Owner cancellation by opaque handle.** `DELETE /v1/client/bookings/:bookingHandle`
  accepts no body and resolves the authenticated owner plus protected receipt. It permits only
  internal `reserved|booked -> cancelled_by_client`, derives cancel idempotency server-side, and
  uses the existing transition/audit/outbox path. Missing and foreign handles are identical
  `404`. A repeated owner cancellation returns the same public `cancelled` result without another
  version, audit, outbox, or capacity change. An existing expert-cancelled reservation also returns
  the same `200 cancelled` projection without another durable effect; other terminal states return
  normalized `409`.
- **CBK-009 — Public state projection.** HTTP exposes only `reserved`, `booked`, `cancelled`,
  `expired`, `completed`, or `no_show`. Both internal cancellation reasons project to
  `cancelled`. Reserve returns `201` for the first commit and `200` for replay; cancel returns
  `200` for first commit and replay. Internal reservation ID and version never appear.
- **CBK-010 — Race, expiry, and lock compatibility.** Transactions use PostgreSQL clock. Reserve,
  catalog retention, and choice cleanup coordinate on one advisory key derived from the choice
  digest. Only reserve may proceed from that choice lock into the existing sorted booking advisory
  and row-lock protocol. Retention never acquires booking locks. Subject erasure terminalizes active
  reservations in the existing booking transition transaction, releases those locks, then removes
  choice/receipt records in a separate retryable cleanup phase; it never holds a choice lock while
  requesting a booking lock. A choice is valid only before
  `min(request.expires_at, slot.observed_at + 15 minutes, slot.starts_at - 24 hours)`.
  Reserve-versus-retention/cleanup has one winner. Cancel-versus-expert-transition/expiry has one
  state-machine winner. Serialization retry is capped at the repository's existing maximum of
  three and never broadens the successful-suite repeat policy. Implementation MUST survey and
  ratify the merged principal/catalog/privacy lock topology before adding any lock.
- **CBK-011 — Frozen hold policy.** Reserve uses database time, minimum lead `24 hours`, slot
  freshness `15 minutes`, and `reserved_until = min(databaseNow + 72 hours,
  slot.start_at - confirmation_buffer)`. For this slice `confirmation_buffer` is configured and
  defaults to `60 minutes`, matching normalized requirements. The current hard-coded 30-minute
  application value MUST be removed before the client route can register.
- **CBK-012 — Durable side effects without live delivery.** The local transaction retains the
  existing free `planerka.reserve`, `telegram.reservation_request`, `planerka.cancel`, and
  `telegram.booking_cancelled` outbox facts and audit records. `PLANERKA_ENABLED` and
  `TELEGRAM_ENABLED` remain literal/default false; no live handler, token, endpoint, provider
  attempt, message delivery, ledger debit, amount, payment, refund, or coupon fact is added or
  authorized by this slice.
- **CBK-013 — Privacy and erasure.** Choice and booking handles are owner-scoped opaque
  identifiers, not bearer authority, and MUST be redacted from logs, traces, metrics, errors, and
  evidence. Choice mappings and their plaintext snapshot handles expire/erase with the 24-hour
  catalog lifecycle. Before subject erasure removes a booking public receipt/handle, every owned
  `reserved|booked` reservation MUST reach a terminal state through the existing client-cancel
  transition. If any transition races or fails, erasure remains pending and the handle is retained
  for owner cancellation. Only after all owned reservations are terminal may a separate cleanup
  phase remove mappings and public receipts/handles while preserving reservation/audit facts
  already required by existing retention rules.
  The existing privacy worker owns a durable PostgreSQL booking-local phase
  `cancel_active -> cleanup_public -> complete|dead_letter` before external processor completion.
  It claims with `FOR UPDATE SKIP LOCKED`, a database-time five-minute lease and fencing token;
  lease expiry permits another worker to resume. Per-reservation cancellation identity is derived
  from erasure job plus reservation, and cleanup begins only after a locked query proves zero owned
  active reservations. Crash/replay re-resolves PostgreSQL state. Five failed claims for the same
  phase move the work to operator-visible `dead_letter`; only an approved operator retry may
  requeue it, and the privacy job cannot reach `processor_complete` beforehand.
  Subject export may expose public booking handle, public state, and appointment time only; it
  MUST NOT expose internal or provider IDs.
- **CBK-014 — Fixed telemetry.** Metrics may label only operation
  `choice_materialize|reserve|cancel|cleanup` and outcome
  `created|replayed|denied|not_found|conflict|expired|erased|unavailable|failed`. No handle,
  principal, request, filter, service, slot, reservation, timestamp, provider, amount, reason,
  payload, or free text is a metric label or trace attribute.
- Public time and cache projection under CBK-014: every public instant is a finite PostgreSQL
  `timestamptz` serialized as UTC `YYYY-MM-DDTHH:mm:ss.sssZ`; invalid serialization is sanitized
  `500` before response emission. Every reserve/cancel success and authenticated error response
  includes `Cache-Control: no-store`.
- **CBK-015 — Migration allocation.** After rebasing onto the merged principal implementation,
  read the actual migration journal and allocate the next unused migration after principal. This
  specification does not reserve `0030`, `0031`, or any other prefix.
- **CBK-016 — Verification budget.** Development uses TDD with focused files. Once any focused
  suite passes, it MUST NOT be rerun unless the human explicitly changes the verification budget.
  After independent interface/security review closes every Critical and Important finding, run
  exactly one integrated focused Claw invocation through the versioned immutable
  `run-claw-ci.sh client-booking` mode at an exact clean SHA. The mode accepts no mutable manifest,
  requires an approved external PostgreSQL URL, and asserts target `server_version_num = 170005`
  without logging credentials before its one fixed Vitest process. PostgreSQL 16 fallback runs are
  development compatibility only. A pass ends the gate; a failure is retained as terminal evidence
  and blocks the slice without a second invocation under `MVP-CLIENT-BOOKING-001`.
- **CBK-017 — Rollback without stranding cancellation.** Rollback first sets
  `CLIENT_BOOKING_RESERVE_ENABLED=false` to reject new reserves while leaving authenticated owner
  cancellation and the existing expiry worker available. It does not delete migrations, choice
  mappings, reservations, receipts, audits, or outbox rows. Full route disablement occurs only
  after active reservations are resolved under an approved operational decision.
- **CBK-018 — Human and Security checkpoints.** Product MUST approve the HTTP/public-state
  contract before implementation completion. An independent reviewer MUST approve interface and
  data boundaries. Security MUST separately approve the live `client_booking:write` issuer,
  verifier, scope/revocation behavior, raw-header preservation, and privacy evidence. A green
  test, Claw run, or documentation commit is not activation or deployment approval.

## Acceptance criteria

| ID | Acceptance |
| --- | --- |
| CBK-AC-01 | Default false registers no booking routes; every invalid capability matrix fails before migration/listen. |
| CBK-AC-02 | Catalog-read-only, malformed, expired, revoked, inactive, duplicate-header, and wrong-scope authority returns `401` before choice or booking repository access; resolver outage returns `503`. |
| CBK-AC-03 | A booking-aware v2 catalog snapshot exposes only `startsAt` and `ch1` handle; protected mapping holds the local slot and no internal/provider ID crosses HTTP. |
| CBK-AC-04 | Ten concurrent reserves of one owned choice create one reservation, one receipt, one reserve audit, one exact existing outbox set, and one capacity effect. |
| CBK-AC-05 | A syntactically valid absent, erased, or foreign choice is indistinguishable `404`; an owned expired, stale, ineligible, capacity-full, or sub-24-hour choice is `409`; none creates a reservation. |
| CBK-AC-06 | Reserve replay returns the same `bk1` handle and public current state without another durable effect. |
| CBK-AC-07 | Owner cancel of `reserved` and `booked` reaches `cancelled`; client- or expert-cancelled replay is stable `200 cancelled`, and foreign/missing handle is indistinguishable `404`. |
| CBK-AC-08 | Reserve-versus-retention/erasure and cancel-versus-expiry/expert action each commit one valid winner with no deadlock, resurrection, or double capacity release. |
| CBK-AC-09 | `reserved_until` uses database time, 24-hour lead, 15-minute freshness, and the configured 60-minute confirmation buffer. |
| CBK-AC-10 | HTTP, logs, traces, metrics, exports, errors, and evidence contain no internal ID, handle sentinel, provider/contact/payment data, or caller authority field. |
| CBK-AC-11 | Side-effect counts show booking audit/outbox only, zero ledger/payment/provider attempts, and both live Planerka and Telegram delivery disabled. |
| CBK-AC-12 | Review records zero unresolved Critical/Important findings and exactly one immutable-mode Claw invocation with exact SHA, PostgreSQL 17.5 assertion, counts, cleanup, and `repeat_limit: 1`. |

## Non-goals and blockers

No client session implementation, Selarti identity binding, expert confirmation surface, booking
list/read route, reschedule, payment, refund, coupon, waitlist, provider activation, deployment, or
production mutation is in scope. Implementation is blocked until the principal prerequisite is
merged. Live activation is independently blocked until Product and Security approvals plus target
deployment authorization are recorded in `docs/runbooks/client-booking-activation.md`.
