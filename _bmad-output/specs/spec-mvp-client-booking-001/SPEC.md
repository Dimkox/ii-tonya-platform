---
id: SPEC-mvp-client-booking-001
companions:
  - ../../../docs/spec/mvp-client-booking-001.md
  - ../../../docs/contracts/client-booking.md
  - ../../../docs/contracts/client-booking-principal-prerequisite.md
  - ../../../docs/contracts/client-catalog-booking-amendment.md
  - ../../../docs/superpowers/architecture/architecture-mvp-client-booking-001/ARCHITECTURE-SPINE.md
  - ../../../docs/runbooks/client-booking-activation.md
sources: []
---

# MVP Client Booking from a Protected Catalog Choice

## Why

The merged client catalog can show safe public availability but deliberately exposes no internal
selection identifier, while the approved client-principal design grants catalog read authority
only. Clients need the smallest authenticated write slice that turns an owner-visible catalog
choice into one PostgreSQL reservation and permits owner cancellation without making a provider,
caller-supplied identifier, amount, or payment fact authoritative.

## Capabilities

- **CAP-1**
  - **intent:** An authenticated active client with separate booking-write authority can reserve
    one still-eligible choice from their own ready catalog snapshot.
  - **success:** The client submits only one opaque choice handle and receives one opaque booking
    handle; concurrent or repeated submissions create at most one reservation.
- **CAP-2**
  - **intent:** The authenticated owner can cancel their reserved or booked reservation without
    knowing any internal reservation, expert, service, slot, or provider identifier.
  - **success:** One owner cancellation reaches the existing terminal client-cancel state and
    every replay returns the same public result without another audit, outbox, or capacity effect.
- **CAP-3**
  - **intent:** PostgreSQL decides choice validity, capacity, expiry, ownership, transitions, and
    replay under concurrent reserve, retention, erasure, expert action, and expiry work.
  - **success:** Every adversarial interleaving has one committed winner, preserves the existing
    reservation state machine, and never oversubscribes or resurrects an expired choice.
- **CAP-4**
  - **intent:** Engineering can implement, observe, verify, and roll back the slice while all live
    Planerka, Telegram-notification, payment, and production capabilities remain blocked.
  - **success:** Both booking flags default false, provider flags remain false, one reviewed
    focused Claw/PostgreSQL gate proves the slice, and disabling new reserves preserves owner
    cancellation and existing expiry processing.

## Constraints

- Implementation starts only after the approved client-principal prerequisite is merged or
  rebased; the migration is the next actual journal entry after principal and no number is frozen.
- `client_catalog:read` never implies `client_booking:write`; booking authority is resolved fresh
  and fail-closed from the authenticated internal client principal.
- HTTP accepts no `userId`, internal ID, caller idempotency key, amount, provider, payment,
  contact, callback version, or request clock.
- HTTP uses the frozen byte-level JSON/DELETE framing contract; ambiguous framing is rejected
  before principal resolution. Well-formed absent/erased/foreign choices are identical `404`, and
  either internal cancellation actor replays the same public `200 cancelled`.
- Owner-only catalog responses expose random `ch1` choice handles and booking responses expose
  random `bk1` booking handles; protected PostgreSQL mappings never cross the HTTP boundary.
- PostgreSQL clock and serializable transactions are authoritative. Reserve uses the existing
  24-hour lead, 15-minute availability freshness, capacity/overlap guards, and
  `min(databaseNow + 72h, slot.startAt - 1h)` deadline.
- The existing BookingService, PostgresBookingRepository, reservation state machine, audit, and
  transactional outbox are extended rather than duplicated.
- `CLIENT_BOOKING_ENABLED=false` and `CLIENT_BOOKING_RESERVE_ENABLED=false` by default.
  `PLANERKA_ENABLED=false` and `TELEGRAM_ENABLED=false` remain unchanged.
- A choice is valid only before `min(request.expires_at, slot.observed_at + 15 minutes,
  slot.starts_at - 24 hours)` and cannot be resurrected after cleanup wins.
- Catalog cleanup removes choice mappings. Subject erasure first terminalizes every owned active
  reservation through the existing cancellation transition; only a later protected cleanup phase
  removes booking receipts/handles. A fenced, leased PostgreSQL phase owned by the existing privacy
  worker makes crash/retry/dead-letter behavior durable. Booking receipts never carry provider,
  contact, amount, or payment data.
- Metrics use fixed operation/outcome labels only. Handles, principals, filters, internal IDs,
  timestamps, provider facts, reason text, and payloads are forbidden labels.
- Booking outbox rows remain local facts: their four topics stay absent from worker handler,
  registry, claim, reconciliation, and provider-adapter composition under every feature matrix.
- After a focused suite passes it is not repeated. The integrated Claw/real-PostgreSQL gate has
  one total invocation through a versioned immutable `client-booking` adapter at an exact clean
  SHA. It accepts no manifest input, requires credential-redacted external PostgreSQL 17.5 proof,
  and a failed invocation remains terminal evidence.

## Non-goals

- Client session issuance, Selarti identity binding, expert confirmation UI, booking listing or
  rescheduling, live Planerka mutation, live Telegram notification, payment, refund, coupon,
  waitlist, production activation, or deployment.

## Success signal

One authenticated owner reserves a fresh protected catalog choice, safely replays the request,
cancels through the opaque booking handle, and replays cancellation on real PostgreSQL while a
foreign principal receives only `404`, capacity returns once, internal IDs never cross HTTP, and
provider/payment delivery remains disabled.

## Open Questions

- Which Security-approved identity-proof issuer may grant `client_booking:write` in a live
  environment? Until a named approval exists, activation remains blocked.
