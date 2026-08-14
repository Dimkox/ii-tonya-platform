# Client Session Principal Contract v1

Status: frozen implementation contract; default-off and not approved for live activation.

## Injected verification boundary

```ts
export interface VerifiedClientIdentityProof {
  readonly userId: string;
  readonly audience: "ii-tonya-client";
  readonly scope: "client_session:create";
  readonly expiresAt: Date;
  readonly replayDigest: `hmac-sha256:v${number}:${string}`;
}

export interface IdentityProofVerifier {
  verify(input: {
    readonly identityProof: string;
    readonly expectedAudience: "ii-tonya-client";
    readonly expectedScope: "client_session:create";
    readonly signal: AbortSignal;
  }): Promise<VerifiedClientIdentityProof | null>;
}
```

The verifier is a capability, not a provider implementation in this repository. Runtime code
exports no accepted-proof stub. A test fake lives only in test support and repository guards
reject a production import. The verifier normalizes an approved proof to internal authority and
does not return provider, subject, contact, claims payload, or raw credential data.

The application validates the result as hostile runtime data before opening a transaction:
exact keys only, canonical UUID, exact audience and scope literals, a finite UTC instant that
PostgreSQL can represent, expiry in the repository-enforced bound, and replay digest matching
`^hmac-sha256:v[1-9][0-9]*:[0-9a-f]{64}$`. Any mismatch is `401` and creates no row.

The approved verifier contract owns the canonical proof identity and computes
`HMAC-SHA-256(K_replay[v], UTF8("ii-tonya/client-proof-replay/v1\0" + environment +
"\0" + issuer + "\0" + canonicalProofId))`. Every verifier replica returns the same digest
for that proof through its expiry. Rotation retains every required old key and deterministic
digest behavior until all proofs issued under that version expire. `K_replay[v]` is secret
verifier-owned key material; `v` is only its positive-integer public identifier. `environment` is
1–32 lowercase ASCII bytes matching `^[a-z][a-z0-9_-]{0,31}$`; `issuer` is 1–255 canonical ASCII
bytes without NUL; `canonicalProofId` is 1–512 exact canonical UTF-8 bytes without NUL. The API
admits at most 32 concurrent verifier calls per process, applies a 2-second deadline below the
3-second route timeout, propagates cancellation, and discards late completion without creating
rows.

## Issue session

`POST /v1/client/sessions`

Request body, exact object shape:

```json
{"identityProof":"opaque-security-approved-proof"}
```

Only `application/json` with no parameter or one case-insensitive `charset=utf-8` parameter is
accepted. Content encoding, malformed UTF-8, duplicate JSON keys, non-whitespace trailing bytes,
other media-type parameters, and ambiguous `Content-Length`/`Transfer-Encoding` framing are
rejected. The 8-KiB cap applies to de-framed entity-body octets before UTF-8 decoding and JSON
parsing. The exact proof bytes are passed to the verifier and then discarded.
The string is 32 through 6144 UTF-8 bytes, is never trimmed or normalized, and rejects
U+0000–U+001F, U+007F–U+009F, U+2028, U+2029, and unpaired UTF-16 surrogates. It is never hashed
by application logging or echoed.

Successful response:

```http
HTTP/1.1 201 Created
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json

{"accessToken":"cs1.<43 base64url characters>","tokenType":"Bearer","scope":"client_catalog:read","expiresAt":"2026-08-14T13:00:00.000Z"}
```

The token is `cs1.` plus unpadded base64url encoding of 32 CSPRNG bytes. The response is the only
plaintext copy. Proof expiry must be after database time and no later than database time plus one
hour; the session uses that verified expiry.

Normalized errors:

| Condition | Response |
| --- | --- |
| invalid schema/size | `400 {"error":"invalid_request"}` |
| invalid, expired, wrong-audience, wrong-scope, inactive, or replayed proof | `401 {"error":"unauthorized"}` |
| verifier or PostgreSQL unavailable | `503 {"error":"temporarily_unavailable"}` |
| feature disabled | route absent (`404`) |

## Resolve and revoke

The only accepted authorization form is:

```text
Bearer cs1.<43 unpadded base64url characters>
```

It must match `^Bearer (cs1\.[A-Za-z0-9_-]{43})$`. An array, comma-folded value, duplicate
credential, alternate case, padding, extra whitespace, or suffix is invalid. The API computes
`sha256:<64 lowercase hex>` and performs a fresh PostgreSQL lookup for every request:

```ts
export interface ClientPrincipal {
  readonly authenticated: true;
  readonly active: true;
  readonly userId: string;
}

export type ClientPrincipalResolution =
  | { readonly kind: "resolved"; readonly principal: ClientPrincipal }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" };

export interface ClientPrincipalResolver {
  resolve(authorization: string): Promise<ClientPrincipalResolution>;
}
```

The query joins `client_sessions.user_id` to `users.id` and requires session scope
`client_catalog:read`, `revoked_at is null`, `expires_at > clock_timestamp()`, and
`users.active = true`. It is not cached. `denied` maps to `401`; `unavailable` and unexpected
resolver exceptions map to the same credential-free `503`.
The token digest, scope, and expiry remain internal to resolution and are not added to the
principal passed into catalog code.

Before calling the resolver, the HTTP adapter inspects `request.raw.rawHeaders` and requires
exactly one case-insensitive `Authorization` field occurrence. It rejects duplicate field lines,
comma folding, and protocol/proxy normalization that cannot preserve this invariant before any
catalog service access.

`DELETE /v1/client/sessions/current` resolves the bearer with the same rules, then executes one
conditional update equivalent to `UPDATE ... SET revoked_at = clock_timestamp() WHERE
token_hash = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp() RETURNING ...`.
Exactly one concurrent caller receives `204`; zero returned rows map to `401`.

## PostgreSQL state

`client_sessions` contains only token hash, internal user UUID, literal scope, expiry,
revocation, and creation timestamps. `client_identity_proof_receipts` contains only the
verifier-produced replay digest, linked session hash, proof expiry, and creation timestamp.
The receipt digest is unique; session and receipt insert in one transaction after locking/checking
the active user. Issuance locks the `users` row `FOR UPDATE` before replay/session inserts;
deactivation and erasure take the same lock first. The receipt's nullable session-digest link uses
`ON DELETE SET NULL`. Subject erasure first deactivates or deletes the user and removes its session;
the now non-linkable receipt remains until proof expiry, so erasure or account recreation cannot
reopen a live proof. At proof expiry cleanup deletes the receipt before any remaining expired
session. The migration file receives the next actual number after the merged catalog migration;
this contract does not reserve `0030`.

## Catalog binding

`MVP-CLIENT-CATALOG-001` routes consume the resolved `userId` and never request ownership from a
payload or header. Catalog enablement without session enablement and an injected resolver fails
startup. Catalog's existing `pending|ready`, replay, and foreign-or-missing `404` responses do not
change. Session operations do not call Planerka and do not create catalog, provider, outbox,
ledger, reservation, booking, or payment facts; the catalog request itself retains its separate
documented outbox behavior.

## Forbidden data and telemetry

Raw proof, bearer, authorization value, request/response body, contact, provider subject, provider
payload, replay digest, and token hash are forbidden from logs, traces, metrics, evidence text,
and thrown error messages. Metrics use fixed operation/outcome labels. Structured logger redaction
must cover both direct and nested forms before any sink receives them.

## Ambiguous issuance recovery

Issuance is intentionally non-idempotent. If the transaction may have committed but the `201`
response is lost, the client does not retry the same proof. It obtains a newly issued proof with a
distinct canonical proof identity. Reuse of the old proof returns `401`, and the original bearer
cannot be recovered.
