# Expert Bearer Principal Boundary Design

Status: design approved for a provider-neutral, disabled-by-default increment.

Related requirements: ERR-FR-025 and ERR-FR-028.

## Objective

Replace the test-only interpretation of the complete `Authorization` header with a
reusable HTTP boundary that authenticates an expert from an opaque bearer token without
choosing a live identity provider or adding a production session table.

The increment proves token parsing, non-reversible lookup, expiry and revocation behavior,
principal validation, and per-request reauthorization. It does not make expert routes
available in the default server lifecycle.

## Actors and ownership

- An expert presents an opaque bearer token to an expert referral or residency route.
- The API boundary parses and hashes the token.
- An injected expert-session lookup resolves the hash to a session record.
- The expert referral and residency services continue to reauthorize ownership against
  authoritative application queries.
- Security owns the token and session contract. Operations owns disabled-by-default
  composition. Product owns no authentication decision.

## Requirements

- **ERR-AUTH-001:** Accept only an HTTP header matching exactly
  `Bearer [A-Za-z0-9._~-]{32,512}`. Missing, malformed, short, or oversized credentials
  resolve to no principal without calling the session lookup.
- **ERR-AUTH-002:** Hash the token as lowercase SHA-256 and pass only
  `sha256:<64 lowercase hex characters>` to the session lookup.
- **ERR-AUTH-003:** Resolve the session on every request. The resolver must not cache a
  principal or session record.
- **ERR-AUTH-004:** A resolved session is valid only when `revokedAt` is absent and
  `expiresAt` is strictly later than the injected current instant. Equality with the
  current instant is expired.
- **ERR-AUTH-005:** `userId` and `expertId` must be canonical UUID strings. Invalid or
  missing identifiers resolve to no principal.
- **ERR-AUTH-006:** A valid record produces exactly
  `{ authenticated: true, userId, expertId }`. No token, token hash, expiry, provider
  metadata, or session identifier crosses into the application principal.
- **ERR-AUTH-007:** Replace a session lookup exception with a fixed
  `expert_session_lookup_failed` internal error without retaining the original error as a
  public cause. It must not be converted to invalid credentials or cached.
- **ERR-AUTH-008:** Logs and errors must not contain the bearer token or token hash. The
  existing global authorization redaction remains mandatory.
- **ERR-AUTH-009:** The default server lifecycle must continue to provide no expert API
  capability. Expert referral and residency feature flags remain fail-closed until a
  separately reviewed session-store and service composition exists.

## Architecture

Create `apps/api/src/expert-principal-resolver.ts` with these public contracts:

```ts
export interface ExpertSessionRecord {
  readonly userId: string;
  readonly expertId: string;
  readonly expiresAt: Date;
  readonly revokedAt?: Date;
}

export interface ExpertSessionLookup {
  findByTokenHash(tokenHash: string): Promise<ExpertSessionRecord | null>;
}

export interface ExpertPrincipalResolver {
  resolve(authorization: string | undefined): Promise<ExpertPrincipal | null>;
}

export function createExpertBearerPrincipalResolver(deps: {
  readonly sessions: ExpertSessionLookup;
  readonly now?: () => Date;
}): ExpertPrincipalResolver;
```

`apps/api/src/routes/expert-referral.ts` imports `ExpertPrincipalResolver` from the new
module and re-exports the type for source compatibility. Route behavior and response
schemas do not otherwise change.

No database implementation belongs in this increment. A future adapter may implement
`ExpertSessionLookup` only after the authoritative expert session model and revocation
contract are approved.

## Data flow

1. The route passes `request.headers.authorization` to the resolver.
2. The resolver validates the complete header and extracts the opaque token.
3. The resolver immediately hashes the token and discards the plaintext value.
4. The resolver calls `findByTokenHash` once for that request.
5. The resolver validates UUIDs, expiry, and revocation using the injected clock.
6. The route returns `401 unauthorized` for `null`, or passes the minimal principal to
   the application service.
7. A lookup exception becomes the fixed `expert_session_lookup_failed` error. The existing
   route error handler returns `500 internal_error` without exposing dependency details.

## Error and security behavior

- Credential syntax and invalid session state are indistinguishable to callers: both
  return `401 unauthorized`.
- Dependency failure returns `500 internal_error`; this prevents an identity outage from
  being misreported as user error.
- Date objects with invalid timestamps fail closed.
- UUID comparison is structural and case-insensitive; emitted identifiers are normalized
  to lowercase.
- Token hashes are lookup material, not application identity, telemetry, or response data.
- No cookies, query parameters, Telegram identifiers, admin sessions, or static API keys
  are accepted by this boundary.

## Verification

Focused unit tests in `apps/api/src/expert-principal-resolver.test.ts` cover:

- valid token hashing and minimal principal output;
- missing and malformed headers without lookup calls;
- short and oversized tokens;
- expired-at-equality, expired, revoked, and invalid-date sessions;
- malformed user and expert identifiers;
- lowercase UUID normalization;
- one fresh lookup per resolve call;
- replacement of lookup failures with the fixed sanitized internal error.

The existing composed API test adds one case proving a lookup exception remains a
sanitized `500 internal_error`. Verification runs as one focused Vitest invocation in the
authorized Claw `ii-tonya-test` container with 1 CPU and 1 GiB, using `--entrypoint sh` to
avoid the profile's broad default wrapper. No repeat loop is permitted.

## Acceptance and release boundary

The increment is accepted when all ERR-AUTH requirements map to code and focused tests,
static checks pass, an independent review has no unresolved Critical or Important finding,
and the exact branch SHA is pushed with test evidence.

This is not production authentication evidence. Hosted CI remains mandatory, and live
expert routes remain disabled until an authoritative session-store contract, human
security approval, and a separate production deployment authorization exist.
