# MVP-CLIENT-PRINCIPAL-001 — Canonical Specification

Status: implementation preparation complete; live activation blocked by Security approval of
an identity-proof source. Documentation base:
`b6763dde890f472c5ad0fcf5a5dbd4ebba2e8423`. Catalog compatibility input:
`codex/mvp-client-catalog-001` docs commit
`10819c8ea46de13ea58e8be9000ac4b11546b9e8`.

## Objective, actors, owner, and approval point

An active internal client can exchange one approved identity proof for a short-lived opaque
session and use that session only for owner-scoped catalog access. The client is the caller;
Security owns the proof-verifier contract and activation sign-off; Platform owns session
composition; the Catalog owner owns the protected catalog integration. Production activation
requires a named Security approver and separate deployment authorization.

## Requirements

- **CPS-001 — Default-off capability.** `CLIENT_SESSION_ENABLED` MUST default to `false`.
  When false, session issuance and revocation routes are absent and no verifier, token source,
  provider client, or session fallback is constructed. An enabled session capability without
  an injected verifier, issuer service, repository, and resolver MUST fail startup.
- **CPS-002 — Production verifier boundary.** `IdentityProofVerifier` MUST be injected and
  MUST have no runtime stub, allow-all implementation, environment-derived fake, or fallback.
  Its output contains only canonical internal `userId`, literal audience `ii-tonya-client`,
  literal scope `client_session:create`, proof expiry, and a verifier-produced
  `hmac-sha256:v<positive integer>:<64 lowercase hex>` replay digest. The application MUST
  validate the verifier result as hostile runtime data: exact keys only, canonical UUID, exact
  literals, finite PostgreSQL-representable instant, bounded expiry, and exact digest grammar.
  Contact fields, provider subject, provider payload, raw proof, and raw credential MUST NOT cross
  this interface.
- **CPS-003 — Strict issuance HTTP.** `POST /v1/client/sessions` accepts exactly an object
  containing `identityProof`. The proof is a non-empty opaque UTF-8 string of 32 through 6144
  bytes, is not trimmed or normalized, and the whole body is capped at 8 KiB. Extra keys,
  wrong types, controls, or bounds violations return `400 {"error":"invalid_request"}`. The
  route accepts only `application/json` or `application/json; charset=utf-8`, rejects every
  content encoding, malformed UTF-8, duplicate JSON key, non-whitespace trailing bytes, other
  media-type parameters, and ambiguous framing, and applies the cap to de-framed entity-body
  octets before UTF-8 decoding and JSON parsing. Controls mean
  U+0000–U+001F, U+007F–U+009F, U+2028, U+2029, and unpaired UTF-16 surrogates. Invalid,
  expired, wrong-audience, wrong-scope, inactive-user, or replayed proof returns the
  same `401 {"error":"unauthorized"}`. Verifier or PostgreSQL unavailability returns
  `503 {"error":"temporarily_unavailable"}` without verifier detail.
- **CPS-004 — Opaque bearer returned once.** After verification, the issuer generates
  32 cryptographically random bytes and returns exactly
  `cs1.<43-character unpadded base64url>` in one `201` response. The response includes
  `tokenType: "Bearer"`, literal scope `client_catalog:read`, and `expiresAt`, and sets
  `Cache-Control: no-store` plus `Pragma: no-cache`. The plaintext bearer is never readable
  again; PostgreSQL stores only `sha256:<64 lowercase hex>`.
- **CPS-005 — Atomic replay and concurrency bound.** One transaction using PostgreSQL clock
  MUST check `users.active`, require proof expiry in `(databaseNow, databaseNow + 1 hour]`,
  insert one unique replay digest receipt,
  and insert its session. The unique replay digest permits at most one winner across sequential
  and concurrent attempts. A loser returns `401` and receives no bearer. No generated bearer is
  returned unless its session and replay receipt commit together.
- **CPS-005A — Replay digest construction and verifier bound.** The verifier digest MUST be
  `HMAC-SHA-256(K_replay[v], UTF8("ii-tonya/client-proof-replay/v1\0" + environment +
  "\0" + issuer + "\0" + canonicalProofId))`, serialized as
  `hmac-sha256:v<positive integer>:<64 lowercase hex>`. `K_replay[v]` is secret verifier-owned
  key material and `v` is only its serialized public identifier. `environment` is 1–32 lowercase
  ASCII bytes matching `^[a-z][a-z0-9_-]{0,31}$`; `issuer` is 1–255 canonical ASCII bytes without
  NUL; canonical proof ID is 1–512 exact canonical UTF-8 bytes without NUL. These fields come from
  the approved verifier contract and do not cross into session code. All verifier
  replicas MUST return the same digest for a proof through its expiry. Rotation retains old keys
  and deterministic digest behavior until every proof from that version expires. Verification is
  capped at 32 concurrent calls per API process with a 2-second deadline below the 3-second route
  timeout; cancellation propagates and a late result cannot create rows.
- **CPS-006 — Bounded lifetime and revocation.** Session expiry is
  `verifiedProof.expiresAt`, already bounded to at most one hour after database time at issuance.
  `DELETE /v1/client/sessions/current` requires the same resolved
  bearer, atomically sets `revoked_at` once, and returns `204`. Any subsequent use, including a
  repeated revoke, returns `401`.
- **CPS-006A — Serialized lifecycle races.** Issuance locks the `users` row `FOR UPDATE` before
  replay/session inserts. Deactivation and erasure lock the same row first, then session/replay
  state. If issuance commits first it may return a bearer which the subsequent deactivation makes
  unusable on the next resolve; if deactivation commits first issuance returns `401`. Revocation
  is one conditional `UPDATE ... WHERE revoked_at IS NULL AND expires_at > databaseNow RETURNING`
  so concurrent revokes have exactly one `204` and all other requests receive `401`.
- **CPS-007 — Exactly one bearer.** The HTTP adapter MUST inspect `request.raw.rawHeaders` and
  require exactly one case-insensitive `Authorization` field occurrence before parsing its value.
  Protected endpoints accept only one authorization value
  matching `^Bearer (cs1\.[A-Za-z0-9_-]{43})$`: exact case, one ASCII space, no comma or second
  credential, padding, whitespace, or suffix. Missing, duplicate/folded, malformed, expired,
  revoked, or wrong-scope credentials return `401` before catalog service access.
- **CPS-008 — Fresh PostgreSQL principal resolution.** Each protected request hashes the
  bearer and executes a fresh, uncached PostgreSQL query joining `client_sessions` to `users`
  under database time. Resolution succeeds only when the session exists, has literal
  `client_catalog:read`, is unrevoked and unexpired, and `users.active = true`. Lookup errors
  return `503`; negative rows return `401`. The principal `userId` comes only from that row.
- **CPS-009 — Own-catalog integration and error amendment.** The catalog request and read routes from
  `MVP-CLIENT-CATALOG-001` MUST use this resolver and MUST NOT accept user/session IDs in body,
  query, path ownership, or trusted headers. `CLIENT_CATALOG_ENABLED=true` without
  `CLIENT_SESSION_ENABLED=true` and an injected resolver is a startup error. Once resolved,
  owner filtering and foreign-or-missing `404` behavior remain the catalog contract's authority.
  The versioned `docs/contracts/client-catalog-session-amendment.md` supersedes catalog v1 only
  for resolver infrastructure failure: negative authority is `401`, resolver/database
  unavailability is `503 {"error":"temporarily_unavailable"}`, and `503 feature_disabled`
  remains distinct.
- **CPS-010 — Persistence minimization and replay tombstone.** New persistence is limited to session hash,
  internal user UUID, one fixed scope, timestamps, revocation timestamp, and verifier-produced
  replay digest/expiry. No raw proof, bearer, authorization value, contact, channel identity,
  provider subject, provider payload, display name, or catalog filter is added to session rows.
  The receipt's session digest link is nullable with `ON DELETE SET NULL`; the non-reversible,
  non-linkable receipt remains until proof expiry after session deletion or subject erasure and
  continues to reject replay. Account restoration or recreation never deletes that tombstone.
- **CPS-011 — Telemetry and error minimization.** Logger redaction MUST cover authorization,
  `identityProof`, session response bodies, verifier input/output, and nested error causes.
  Metrics use fixed `operation` and `outcome` values only. Traces, audits, evidence, and test
  failure messages MUST NOT contain raw proof, token, contact, provider subject, replay digest,
  or token hash.
- **CPS-012 — Isolated side effects.** Session issuance, resolution, revocation, failed
  authorization, and catalog GET create no catalog, outbox, provider mutation, message ledger,
  package, reservation, booking, payment, or contact facts. An authorized catalog POST may create
  only the catalog contract's request and one `catalog.show` outbox fact; it creates no other
  side effect. The verifier is the only approved proof-trust seam. Planerka is not required.
- **CPS-013 — Migration allocation after catalog.** Implementation MUST start from the merged
  catalog head, inspect the migration journal, and allocate the next actual migration after the
  catalog migration. This specification does not freeze `0030` or any other numeric prefix.
- **CPS-014 — Bounded verification.** TDD MUST cover parser, issuer, replay, fresh resolution,
  catalog ownership, startup composition, privacy, and real PostgreSQL concurrency. After local
  green and independent review, run exactly one focused Claw invocation for this slice. A pass
  ends the gate; a failure is retained as terminal evidence. No second invocation is allowed under
  this slice ID.
- **CPS-015 — Activation remains blocked.** No environment may set
  `CLIENT_SESSION_ENABLED=true` until `docs/runbooks/client-session-activation.md` has a named
  Security approver, approved proof source/contract, key and rotation evidence, replay semantics,
  expiry/audience/scope evidence, and a separately authorized deployment. Documentation, tests,
  or a green Claw run are not activation approval.
- **CPS-016 — Ambiguous issuance is not replayed.** Session issuance is intentionally
  non-idempotent. If the transaction may have committed but the `201` response is lost, a client
  MUST NOT retry the same proof; recovery requires a newly issued proof with a distinct canonical
  proof identity. Reuse of the old proof returns `401` and the original bearer is unrecoverable.

## Data and non-functional constraints

- PostgreSQL is the only session/replay state authority and its clock is authoritative.
- Token entropy is 256 bits; token and replay digests use domain-prefixed lowercase hex forms.
- Resolution performs one bounded indexed lookup and has no in-process positive cache.
- Session/replay cleanup is idempotent. A replay receipt remains independently until proof expiry;
  session deletion nulls its link but not its unique digest. Subject erasure first locks and
  deactivates/deletes the user, deletes session rows, and retains non-linkable receipts until expiry.
- All error bodies are normalized and carry no reason that distinguishes identity existence.

## Acceptance criteria

| ID | Acceptance |
| --- | --- |
| CPS-AC-01 | One valid approved proof creates one session and returns one canonical bearer with no-store headers. |
| CPS-AC-02 | Ten concurrent uses of the same proof have exactly one `201`, nine `401`, one replay receipt, and one session. |
| CPS-AC-03 | Malformed, expired, wrong-audience, wrong-scope, and inactive-user proofs create zero rows and return `401`. |
| CPS-AC-04 | Missing, duplicated, padded, suffixed, expired, revoked, inactive-user, and wrong-scope bearers return `401` before catalog access. |
| CPS-AC-05 | A valid session can create/read only its own catalog request; POST creates exactly one catalog request plus one `catalog.show` outbox fact, while GET and failed authorization create none; a second client's request remains foreign-or-missing `404`. |
| CPS-AC-06 | Deactivation or revocation between two requests makes the second fresh resolution fail `401` without process restart. |
| CPS-AC-07 | Persistence and captured telemetry contain none of the forbidden raw values or hashes excluded by CPS-011. |
| CPS-AC-08 | The complete proof creates zero provider mutation, ledger, reservation, booking, and payment facts; only the catalog POST's required request/outbox pair exists. |
| CPS-AC-09 | Every invalid flag/dependency composition fails pure preflight before migration, while default false registers no session route. |
| CPS-AC-10 | The slice records exactly one focused Claw invocation with exact SHA/counts/cleanup; only a PASS satisfies the gate, and no second invocation is allowed. |
| CPS-AC-11 | Lost-success retry with the same proof returns `401`; a newly issued distinct proof can recover without revealing the prior session. |

## Non-goals and follow-ons

- **FOLLOW-CLIENT-BOOKING-001:** create a protected booking command only from an owner-visible,
  still-eligible catalog choice, with a separately approved `client_booking:write` authority.
- **FOLLOW-SELARTI-IDENTITY-001:** bind verified Selarti conversation identity to the same
  internal client principal; replace the current external-channel-ID-as-UUID behavior without
  treating Selarti as authority before its contract is approved.
- Refresh tokens, login UI, contact collection, provider activation, Planerka, payments,
  reservations, bookings, and production deployment are outside this slice.

## Blockers

Implementation must rebase after the catalog change is merged because the catalog branch owns
the principal seam and migration immediately preceding this slice. Live activation is separately
BLOCKED on Security approval of the proof source. Planerka and Planerka staging evidence are not
prerequisites for session implementation or its activation decision.
