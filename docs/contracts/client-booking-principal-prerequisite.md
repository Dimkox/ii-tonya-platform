# Client Booking Principal Prerequisite

Status: frozen dependency extracted from the approved principal documents at rebased commit
`94ad64c922db1278fa78d3823a8959e5cfe90f95` (the successor of pre-rebase `c2db85c`); this file
does not claim that the principal implementation is merged, live, or approved for activation.

## Credential and resolution contract

The HTTP edge accepts exactly one case-insensitive raw `Authorization` field occurrence. Its value
must match `^Bearer (cs1\.[A-Za-z0-9_-]{43})$`: exact scheme case, exactly one ASCII space, literal
`cs1.` prefix, exactly 43 unpadded base64url characters, and no leading/trailing whitespace,
padding, comma, second credential, or suffix. Missing values, duplicate field lines (including
mixed field-name case), arrays, folded/comma-joined values, malformed values, and any protocol or
proxy path that cannot prove preservation of exactly one raw occurrence are denied before booking
code runs. Alternate-header, body, query, path, cookie, and Selarti identity inputs are also
denied. Authorization values, token hashes, session identifiers, and rejection detail are
forbidden in telemetry and evidence.

Resolution performs a fresh, uncached PostgreSQL lookup for the token digest and proves all of:

- the canonical internal user exists and is active;
- the session is unexpired and not revoked;
- the session grants the exact `client_booking:write` scope.

Only then may it return the minimal principal `{authenticated:true, active:true, userId}`. The
result is the closed union `resolved | denied | unavailable`: denied credentials map to normalized
`401 unauthorized`; resolver or PostgreSQL unavailability maps to normalized
`503 temporarily_unavailable`. Neither result exposes cause or credential facts.

## Booking extension boundary

Booking injects a distinct `ClientBookingPrincipalResolver`. `client_catalog:read` MUST NOT be
promoted to booking-write authority, and catalog principal resolution MUST NOT be reused as an
allow-all fallback. Default-off preflight requires the resolver capability before route
registration; it never fabricates a principal.

No live issuer/verifier is selected by this story. Security approval of the identity-proof issuer,
raw-header preservation, fresh lookup, scope, expiry, revocation, telemetry, and failure behavior
is an explicit activation blocker independent of Product and deployment approvals.
