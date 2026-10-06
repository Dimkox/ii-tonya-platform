# Browser booking authority and account journey

Status: owner-approved design (2026-10-06, "Go"); implementation plan pending review.
Date: 2026-10-06.
Inspected base: `f4f05e38ad337b9b8dbfd2ce84d7fa7bb6f11956`.

## Outcome and scope

A verified client can select an available time, reserve it, recover their active
reservations after a page reload, and cancel an owned reservation on ii-tonya.ru.
Written consent and electronic signing are not prerequisites. No free-text intake,
special-category processing, payment, provider confirmation, or notification
delivery is introduced. A reservation is never presented as paid or confirmed.

The live catalogue was observed to contain zero experts, services, and future slots.
Implementation must support an honest empty state; production data must come from
an approved real source. Test fixtures are not production inventory.

## Confirmed gap and alternatives

`ClientSessionService.issue` only issues `client_catalog:read`; repository issuance
and ordinary session resolution enforce that scope. Booking resolution requires
`client_booking:write`. Migration 0031 permits that value, but the current issuer
does not issue it. Changing the existing resolver to accept every read session
would silently broaden old credentials and is rejected.

Two independent browser credentials would preserve separate scopes, but require
paired issuance, cookie binding, expiry and logout coordination. Prefer a separate,
explicit booking grant attached to the existing session: one browser credential,
one revocation lifecycle, and independently checked booking authority.

## Authority design

Add a narrow `client_session_booking_grants` table keyed by session token digest,
referencing `client_sessions` with cascading deletion. A row represents exactly
`client_booking:write`; it contains no client-supplied scope or business facts.
Existing sessions receive no backfill. Session cleanup and subject/session deletion
remove grants through the parent relationship; revoked parents cannot authorize.

A new default-off `CLIENT_SESSION_BOOKING_GRANTS_ENABLED` server capability enables
grant creation only during a successful, fresh verified login. Session, proof-replay
receipt and grant commit atomically. Issuance fails atomically on any error. The
client cannot request a scope or submit a user identifier. The flag requires session
and booking capabilities, but not reserve enablement: cancellation must remain
accessible while creation is paused. Disabling grant issuance does not revoke
existing grants; revocation remains an explicit parent-session operation.

Keep catalog resolution and legacy write-scope resolution unchanged. Extend the
distinct booking resolver to additionally accept a read session with an explicit
grant, freshly checking parent expiry, revocation and active canonical user in SQL.
Read scope alone is still denied. No authorization cache or browser claim is used.
Successful logout invalidates all subsequent authorization checks for that session.
An operation already authorized before logout may finish; logout is not a rollback
of committed or in-flight bookings. Tests must pin this boundary without claiming
stronger transaction fencing.

Amend the booking prerequisite contract to describe this explicit grant, not an
implicit promotion. Grant expiry cannot exceed parent expiry. Restart, deployment,
CSRF refresh and page reload cannot mint grants. A pre-existing read-only session
must log out and complete a fresh login before receiving a grant.

## Browser API and ownership

Extend the existing cookie/CSRF browser boundary with a finite route allowlist for
catalog request creation/read, booking reserve/cancel, and an owner-only active
booking list. Forward only exact validated paths and raw bounded payloads into the
corresponding authenticated API; never accept arbitrary proxy targets. Reuse Secure,
HttpOnly, SameSite cookies, exact Origin, session-bound CSRF (including private
reads), no-store responses, normalized failures and account-switch protections.

Add `GET /v1/client/bookings` behind the booking principal and route capability.
Return only owned `reserved|booked` receipt projections: opaque booking handle,
public state, UTC start time and reserve deadline. Do not expose internal IDs,
contacts, prices or provider facts. Bound each page to 20 items; accept only an
owned opaque booking handle as a continuation cursor, with stable ordering and
identical rejection for missing/foreign cursors. The browser uses the corresponding
allowlisted route and offers explicit next-page loading. No public catalogue
endpoint returns private handles.

Reserve and cancel continue through the existing transactional booking service.
Preserve capacity, lead time, freshness, deadlines, server-derived idempotency and
existing state transitions. A reserve kill switch must not disable owned reads or
cancellation. Flags and authenticated capability probes control availability; a
missing capability yields an honest unavailable state, not fabricated success.

## Web flow

Keep anonymous catalogue browsing available. In the authenticated account, request
the booking-aware catalogue using structured service/language selections. Only
slots with a protected choice handle are actionable. Display timezone explicitly.
Poll a pending catalogue at most ten times over thirty seconds, then stop and offer
an explicit retry. Stop polling on navigation, logout, or authority change.

Reserve on an explicit button action; disable duplicate clicks while pending.
Render the returned state and deadline, and reload the owner's active list.
After an uncertain network result, reconcile that list before offering another
mutation; never automatically replay a write after session recovery. Cancellation
requires an explicit user action and uses the owned handle. On reload, reconstruct
the account from server data, not localStorage, URLs or cached private responses.
Clear private UI and ignore stale responses on account switch or session expiry.

Use accessible labels, keyboard focus and status announcements. Empty catalogue,
no fresh slots, expired choice, conflicting reservation, expired session and disabled
booking have distinct safe user messages. No free-text box or signing detour.

## Implementation map

- `packages/application/src/client-session-service.ts` and
  `packages/db/src/repositories/client-session-repository.ts`: explicit issuance
  capability, atomic grant creation and fresh resolution.
- `packages/db/src/schema/identity.ts`, hand-authored migration and matching journal:
  additive grant table; allocate the next index after inspecting current history.
  Do not run Drizzle generation or add a grandfathered metadata-gap exemption.
- `packages/config/src/env.ts`, `apps/api/src/server.ts`, `apps/api/src/app.ts`:
  default-off capability and explicit composition.
- `packages/application/src/client-booking-service.ts`,
  `packages/db/src/repositories/booking-repository.ts`, booking API: bounded owned
  active receipt reads; no changes to financial or reservation transition policy.
- `apps/api/src/routes/browser-account.ts`: finite authenticated browser bridge.
- `apps/web/src/privacy-client.ts`, account view and new booking client/view modules:
  shared session lifecycle, booking flow and active-reservation recovery.
- Booking authority contracts and activation runbook: explicit amendment and rollback.

## Acceptance and release evidence

Given an old read-only session, booking remains denied. Given a fresh verified login
with issuance enabled, the same browser session can read catalogue and perform
owned booking actions. Given disabled issuance, replayed proof or failed database
commit, no grant is created. Given logout, expiry or inactive user, subsequent
booking checks fail closed.

Given another user's choice, booking or cursor, no private data or mutation is
available. Given missing/wrong Origin or CSRF, private browser requests fail.
Given duplicate reserve clicks or an uncertain response, at most the existing
idempotent reservation is represented. Given reload, active reservations and their
cancel actions are recoverable. Given reserve disabled, existing owners can still
view and cancel. Given account switching, no old-account response is rendered.

Use failing focused tests first, then relevant API/web/unit tests and PostgreSQL
grant/ownership tests with at most three focused runs per file. Do not rerun exhausted
historical files or disguise them under new names. Run relevant typechecks, lint,
format and whitespace checks and independent adversarial review. Local checks do
not substitute for missing exact-SHA Trust CI or Database Gate evidence.

Deploy the additive schema before code depends on it. Activate only after explicit
target review, fresh-login evidence and real inventory are available. Rollback first
disables reserve and grant issuance while retaining list/cancel and expiry processing;
do not drop grants or receipts or roll back to a binary that strands active owners.
Keep the previous signed release and record the exact deployed SHA. This design
alone neither enables production flags nor certifies the full factory specification.
