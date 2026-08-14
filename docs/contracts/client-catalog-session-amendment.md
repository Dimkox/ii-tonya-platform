# Client Catalog Session Amendment v1

Status: frozen compatibility amendment for future implementation; default-off and not live.

This document supersedes `Client Catalog Contract v1` only for the principal resolver boundary,
resolver failure responses, and capability composition. Catalog request shape, owner filtering,
foreign-or-missing `404`, idempotency, outbox, snapshot, retention, and provider rules remain
unchanged.

## Principal authority

Every catalog route obtains authority from the default-off client session boundary in
`docs/contracts/client-session-principal.md`. The HTTP adapter first proves that
`request.raw.rawHeaders` contains exactly one case-insensitive `Authorization` field and that its
value matches the canonical `Bearer cs1.<43 unpadded base64url characters>` grammar. The resolver
then performs one fresh PostgreSQL lookup and returns only an active canonical internal `userId`.
No request body, query, path parameter, alternate header, Selarti identifier, cached claim, or
fallback resolver may supply catalog ownership.

The session resolver replaces catalog v1's `ClientPrincipal | null` result with the explicit
`resolved | denied | unavailable` union frozen in the session contract. Catalog routes map
`resolved` to owner-scoped access, `denied` to `401`, and `unavailable` to `503`; they do not catch
and collapse infrastructure failure into unauthenticated authority.

## Failure amendment

| Condition | Response |
| --- | --- |
| missing, duplicate, malformed, expired, revoked, inactive, or wrong-scope authority | `401 {"error":"unauthorized"}` |
| session resolver or PostgreSQL unavailable | `503 {"error":"temporarily_unavailable"}` |
| catalog capability disabled | `503 {"error":"feature_disabled"}` where the existing catalog route surface exposes that response |

Negative authority and infrastructure failure are distinct internal outcomes but expose no reason,
identifier, token hash, replay digest, or nested cause. An infrastructure exception is never
collapsed to `401` and never reaches catalog application or repository code.

## Fail-closed composition

`CLIENT_CATALOG_ENABLED=true` requires `CLIENT_SESSION_ENABLED=true` plus an injected production
verifier, session repository, issuer, and resolver. A pure configuration/capability preflight runs
before migrations and rejects every invalid combination without database mutation, route
registration, or listener startup. Both feature flags remain `false` by default.

This amendment does not approve an identity-proof source, activate either capability, or authorize
deployment. Live activation remains blocked by `docs/runbooks/client-session-activation.md`.
