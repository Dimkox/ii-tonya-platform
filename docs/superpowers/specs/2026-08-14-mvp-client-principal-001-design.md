# MVP Client Principal 001 Design

Status: approved design input for future default-off implementation. The authoritative
requirements, HTTP/session contract, architecture invariants, and activation boundary are in
`docs/spec/mvp-client-principal-001.md`, `docs/contracts/client-session-principal.md`,
`docs/superpowers/architecture/architecture-mvp-client-principal-001/ARCHITECTURE-SPINE.md`,
and `docs/runbooks/client-session-activation.md`.

The selected design is a capability-injected short-lived opaque session. It is selected over
using Selarti's external channel identifier because that identifier is neither an internal UUID
nor an approved identity proof. It is selected over self-contained bearer claims because current
revocation and `users.active` state must take effect on the next request. It is selected over
extending `admin_sessions` because client and admin scopes, MFA semantics, issuance authority,
and privacy lifecycle are different security domains.

The proof verifier converts approved external trust into the minimum internal claim. PostgreSQL
atomically consumes a non-reversible replay digest and stores only the client session hash.
Every catalog request performs a fresh PostgreSQL lookup. The design contains no Planerka,
provider mutation, message ledger, reservation, booking, payment, refresh-token, or production
activation path.

Two subsequent stories remain explicit: booking from an owner-visible protected catalog choice,
and Selarti conversation identity binding to the same internal principal. Neither inherits
authority merely because this session slice exists.
