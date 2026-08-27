# MVP Client Booking 001 Design

Status: approved-design candidate for default-off implementation after principal merge; not live.

The authoritative requirement, wire, compatibility, architecture, and activation artifacts are
`docs/spec/mvp-client-booking-001.md`, `docs/contracts/client-booking.md`,
`docs/contracts/client-booking-principal-prerequisite.md`,
`docs/contracts/client-catalog-booking-amendment.md`, the feature architecture spine, and
`docs/runbooks/client-booking-activation.md`.

The selected pattern is a protected-reference transaction. Catalog materialization creates
owner-visible random choice handles while PostgreSQL retains the only mapping to local slot facts.
Reserve extends the existing BookingService and PostgresBookingRepository so choice validation,
server-derived idempotency, capacity, reservation, public receipt, audit, and outbox commit as one
serializable operation. Owner cancel uses a random public booking handle and the existing client
transition; neither route exposes internal IDs or accepts caller authority.

Lifecycle coordination adds only a choice-digest advisory lock shared by reserve and catalog
cleanup; it does not replace the repository's established booking lock protocol. Privacy erasure
is durable work owned by the existing privacy worker: a fenced, leased cancellation phase
terminalizes active reservations before a later public-reference cleanup transaction, so an owner
is never stranded without a cancellation reference and crash recovery resumes from PostgreSQL.

A signed/self-describing choice token was rejected because it adds secret rotation and cannot
revoke with catalog retention as directly as a protected mapping. Accepting slot indexes or IDs
was rejected because immutable public snapshots deliberately omit authoritative mappings.
Creating a second reservation subsystem was rejected because it would split capacity, state,
audit, and outbox authority from the proven booking repository.

The route family and new-reserve kill switch default false. Existing local outbox facts remain,
but all booking topics remain absent from worker claim/handler composition and Planerka and
Telegram handlers remain disabled. The byte-level HTTP contract rejects ambiguous framing before
authority or repository access. The principal prerequisite must separately
prove `client_booking:write`; catalog read scope is never promoted. Product approves the public
contract, Security approves live write authority, and deployment approval remains separate.
