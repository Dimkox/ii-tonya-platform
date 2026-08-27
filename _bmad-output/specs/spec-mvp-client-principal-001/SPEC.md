---
id: SPEC-mvp-client-principal-001
companions:
  - ../../../docs/spec/mvp-client-principal-001.md
  - ../../../docs/contracts/client-session-principal.md
  - ../../../docs/contracts/client-catalog-session-amendment.md
  - ../../../docs/superpowers/architecture/architecture-mvp-client-principal-001/ARCHITECTURE-SPINE.md
  - ../../../docs/runbooks/client-session-activation.md
sources: []
---

# MVP Client Session Principal and Catalog Access

## Why

The catalog contract requires an authenticated active client, but the repository has no
client session issuer or resolver and the current Selarti webhook treats an external
channel identifier as an internal user UUID. A default-off session boundary must establish
the internal principal without making an unapproved provider or raw credential authoritative.

## Capabilities

- **CAP-1**
  - **intent:** A client holding a Security-approved identity proof can create one
    short-lived catalog session.
  - **success:** One proof use returns one opaque bearer once while PostgreSQL stores only
    non-reversible proof replay and bearer digests.
- **CAP-2**
  - **intent:** A client session can authorize access to that client's catalog requests.
  - **success:** Every request resolves current PostgreSQL session, scope, revocation,
    expiry, and active-user state before owner-scoped catalog access.
- **CAP-3**
  - **intent:** A client or operator can rely on bounded session expiry, revocation, replay
    control, and privacy cleanup.
  - **success:** Expired, revoked, inactive, wrong-scope, malformed, and replayed authority
    fails closed without exposing or retaining raw proof, bearer, contact, or provider subject.
- **CAP-4**
  - **intent:** Engineering can implement and verify the capability without silently
    activating it or introducing provider, ledger, reservation, booking, or payment work.
  - **success:** Default-off composition rejects missing production capabilities, one
    focused Claw gate is sufficient after review, and live activation remains explicitly blocked.

## Constraints

- `CLIENT_SESSION_ENABLED` defaults to `false`; production has no verifier stub, allow-all
  fallback, or implicit provider adapter.
- The bearer is a 256-bit random `cs1` token returned once; only its SHA-256 digest is stored.
- Verified proof expiry must be after PostgreSQL `now` and no later than `now + 1 hour`;
  session lifetime ends at that verified expiry.
- One exact `Bearer` credential is accepted; expiry, revocation, inactive user, and wrong
  `client_catalog:read` scope return `401` after a fresh PostgreSQL resolution.
- A verifier-produced, versioned and environment/issuer/domain-separated HMAC-SHA-256 replay
  digest is consumed atomically with session creation;
  concurrent or repeated use has at most one winner.
- The replay receipt remains until proof expiry even after its nullable session link is removed;
  deleting or erasing a session cannot reopen a still-valid proof.
- Verification has a 2-second deadline and a 32-call per-process concurrency ceiling; timeout,
  saturation, cancellation, and late completion fail closed without credential detail.
- No raw proof, bearer, contact, provider subject, authorization header, or request body is
  persisted or emitted to logs, traces, metrics, errors, or evidence.
- Catalog enablement without an enabled injected client session resolver fails startup.
- A pure capability preflight runs before migrations; invalid session/catalog composition mutates
  no database state.
- The schema migration is the next actual migration after the merged catalog migration;
  this contract does not reserve `0030`.
- Live activation is blocked until Security approves and records an identity-proof source.

## Non-goals

- Selarti conversation identity binding, protected booking, Planerka access, refresh tokens,
  federated login UI, contact capture, payments, ledger mutation, or production activation.

## Success signal

A real PostgreSQL proof shows one valid identity proof yields one short-lived opaque session,
concurrent replay yields no second session, the session reads only its owner's catalog request,
and revocation or user deactivation makes the next request return `401` with zero provider,
ledger, reservation, booking, or payment facts.

## Assumptions

- Security will provide a production verifier that returns an internal `userId`, exact
  audience/scope, proof expiry, and the specified versioned replay digest without exposing a
  provider subject to this slice.
