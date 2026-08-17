# Good-spine closure review — MVP Client Booking 001

## Verdict

**PASS — zero Critical and zero Important findings remain.** All prior lock-topology, principal-dependency, active-erasure/cancelability, and exact choice-expiry findings are closed. The final narrow principal-grammar recheck is recorded in the closure addendum below and supersedes the earlier residual assessment retained for audit history.

Deterministic `lint_spine.py`: **PASS**, 0 findings.

## Finding-by-finding closure

### Prior Critical — lock topology compatibility: CLOSED

AD-5 no longer imposes the incompatible row/advisory ordering. It adds only a choice-digest advisory coordination lock, permits only reserve to continue into the existing sorted booking advisory/row-lock protocol, forbids retention from taking booking locks, and separates erasure transition locks from choice/receipt cleanup (`ARCHITECTURE-SPINE.md:86-98`). This is compatible with existing reserve and transition taking sorted booking advisory locks before their row locks (`packages/db/src/repositories/booking-repository.ts:738-777`, `935-978`) and with catalog retention's existing outbox-before-request row locks (`packages/db/src/repositories/client-catalog-repository.ts:398-418`). The spec repeats the same no-cycle rule and requires a merged-topology survey before adding locks (`docs/spec/mvp-client-booking-001.md:68-79`).

### Prior Important — self-contained principal dependency: NOT CLOSED (Important)

The package now includes `docs/contracts/client-booking-principal-prerequisite.md`, pins its provenance to commit `94ad64c...`, defines single raw-header occurrence, fresh PostgreSQL resolution, exact booking-write scope, and the `resolved|denied|unavailable` / `401|503` split (`client-booking-principal-prerequisite.md:1-23`). The pinned commit is present and contains the principal spine and canonical session contract, so provenance is inspectable.

However, the local prerequisite says the value must match "the approved bearer grammar exactly" without stating that grammar (`client-booking-principal-prerequisite.md:9-12`). AD-1 still binds builders to "the principal contract's exact credential grammar" (`ARCHITECTURE-SPINE.md:49-56`), and the booking contract repeats the same undefined reference (`docs/contracts/client-booking.md:24-28`). The omitted canonical rule is implementation-significant: the pinned parent contract defines `^Bearer (cs1\.[A-Za-z0-9_-]{43})$` and rejects alternate case, padding, whitespace, duplicates, arrays, and comma folding (`94ad64c:docs/contracts/client-session-principal.md:91-100`). A fresh checkout containing only the current package cannot implement or test AD-1 exactly without reaching into a historical Git object.

**Residual disposition:** copy the exact canonical bearer syntax and rejection cases into the local frozen prerequisite (or restore the pinned canonical contract as a current-tree companion), then make AD-1 cite that local rule. Do not invent a new generic bearer grammar.

### Prior Important — active reservation erasure/cancelability: CLOSED

AD-9 now requires every owned `reserved|booked` reservation to pass through the existing client-cancel transition first; a race or failure leaves erasure pending and retains the handle; only a later phase removes receipts after all reservations are terminal (`ARCHITECTURE-SPINE.md:126-136`). The booking contract carries the same ordering and explicitly forbids cleanup from holding a choice lock while requesting a booking lock (`docs/contracts/client-booking.md:109-119`). This preserves AD-8's DELETE/expiry recovery requirement (`ARCHITECTURE-SPINE.md:117-124`) and removes the prior two-implementation divergence.

### Prior Minor — exact choice expiry: CLOSED

AD-2 now fixes the protected choice expiry as `min(request.expires_at, slot.observed_at + 15 minutes, slot.starts_at - 24 hours)` (`ARCHITECTURE-SPINE.md:58-66`), exactly matching the catalog-booking amendment (`docs/contracts/client-catalog-booking-amendment.md:47-50`).

## Residual findings

- **Important:** none after the closure addendum below.
- **Critical:** none.

## Closure addendum — principal grammar recheck

**PASS — the sole residual Important is CLOSED; zero Critical and zero Important findings remain.**

The current-tree prerequisite now freezes the exact canonical expression `^Bearer (cs1\.[A-Za-z0-9_-]{43})$`, including exact scheme case, one ASCII space, the literal `cs1.` prefix, exactly 43 unpadded base64url characters, and rejection of whitespace, padding, commas, additional credentials, suffixes, duplicate/mixed-case raw field occurrences, arrays, folding, and any path unable to prove one preserved raw occurrence (`docs/contracts/client-booking-principal-prerequisite.md:9-17`). It also preserves fresh PostgreSQL scope/active/expiry/revocation resolution and the closed `resolved|denied|unavailable` mapping (`docs/contracts/client-booking-principal-prerequisite.md:19-28`).

The booking contract directly cites that local frozen grammar and separately retains the `client_booking:write` requirement (`docs/contracts/client-booking.md:24-29`). Builders no longer need the historical Git object to implement or test AD-1's credential boundary. No residual finding remains from this narrow recheck.
