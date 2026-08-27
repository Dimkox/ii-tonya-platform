# MVP Client Principal 001 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a default-off, replay-safe client session that resolves fresh PostgreSQL authority and grants only owner-scoped catalog access.

**Architecture:** An injected production verifier converts an approved external identity proof into a minimal internal claim. The application issues a one-time 256-bit opaque bearer; PostgreSQL atomically owns proof replay, hashed sessions, expiry, revocation, active-user checks, and fresh resolution. Catalog routes consume only the resolved principal.

**Tech Stack:** TypeScript, Fastify, Node crypto, Drizzle, PostgreSQL, Vitest.

## Global Constraints

- Start from the exact merge that contains `MVP-CLIENT-CATALOG-001`; inspect its committed
  migration journal before any schema edit.
- The session migration number is the next actual number after the merged catalog migration.
  Do not reserve or assume `0030`.
- `CLIENT_SESSION_ENABLED=false` by default. Production exports no accepted-proof stub or
  fallback verifier.
- The authoritative documents are `docs/spec/mvp-client-principal-001.md`,
  `docs/contracts/client-session-principal.md`,
  `docs/contracts/client-catalog-session-amendment.md`, the architecture spine, and
  `docs/runbooks/client-session-activation.md`.
- No raw proof, bearer, authorization, contact, provider subject, replay digest, or token hash
  may enter logs, traces, metrics, errors, snapshots, evidence text, or test failure output.
- No provider, Planerka, ledger, reservation, booking, payment, contact, push, merge, deployment,
  production, or GitHub Actions operation belongs to implementation of this slice.
- Local suites run once per focused checkpoint. Run exactly one focused Claw invocation for this
  slice only after local green and independent review; a failure is terminal for this slice ID.
- Live activation remains BLOCKED until the runbook has named Security approval and separate
  deployment authorization.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/application/src/client-session-service.ts` | verifier/result types, issuer orchestration, token-hash-only repository port |
| `packages/application/src/client-session-service.test.ts` | issue validation, returned-once behavior and normalized failures |
| `apps/api/src/client-session-token.ts` | exact bearer parser, 32-byte CSPRNG generator and SHA-256 digest |
| `apps/api/src/client-proof-verifier-gate.ts` | process-wide 32-call ceiling, 2-second deadline, abort propagation and late-result discard |
| `packages/db/src/schema/identity.ts` | `client_sessions` and `client_identity_proof_receipts` schema |
| new post-catalog migration selected from the journal | session/replay tables, checks, indexes and foreign keys |
| `packages/db/src/repositories/client-session-repository.ts` | atomic issue, fresh resolve, revoke and cleanup queries |
| `tests/integration/client-session-repository.test.ts` | real-PG TTL/replay/concurrency/revocation/active-user evidence |
| `apps/api/src/client-principal-resolver.ts` | exact-one-Bearer to fresh repository principal |
| `apps/api/src/routes/client-sessions.ts` | strict issue and current-session revoke HTTP contract |
| catalog route/composition files from merged catalog | inject session principal into owner-scoped catalog requests/reads |
| `packages/config/src/env.ts` and `.env.example` | default-false feature flag only; no proof secret placeholder |
| `packages/observability/src/logger.ts` | proof/token/header/body redaction before sinks |
| `packages/worker/src/data-retention.ts` and privacy repository | expired receipt/session cleanup and subject erasure |
| `tests/e2e/client-session-catalog.test.ts` | complete session-to-own-catalog and zero-side-effect proof |

## Task 1: Application contract and one-time opaque issuer

**Files:**

- Create: `packages/application/src/client-session-service.ts`
- Create: `packages/application/src/client-session-service.test.ts`
- Modify: `packages/application/src/index.ts`
- Create: `apps/api/src/client-session-token.ts`
- Create: `apps/api/src/client-session-token.test.ts`
- Create: `apps/api/src/client-proof-verifier-gate.ts`,
  `apps/api/src/client-proof-verifier-gate.test.ts`

**Interfaces:**

- Consumes: injected `IdentityProofVerifier`, `ClientSessionRepository`, and token generator.
- Produces: `ClientSessionService.issue(identityProof)`, canonical token helpers, and
  `ClientPrincipal` used by Tasks 2–4.

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

export interface ClientSessionRepository {
  issue(input: {
    readonly userId: string;
    readonly replayDigest: `hmac-sha256:v${number}:${string}`;
    readonly proofExpiresAt: Date;
    readonly tokenDigest: `sha256:${string}`;
    readonly scope: "client_catalog:read";
    readonly maximumTtlMs: 3_600_000;
  }): Promise<{ readonly kind: "issued"; readonly expiresAt: Date } | { readonly kind: "denied" }>;
}
```

- [ ] **Step 1: Write RED issuer and token tests.** Assert the generator requests exactly
  32 random bytes and serializes `cs1.` plus 43 base64url characters; parser rejects missing,
  array, comma, alternate case, padding, whitespace, and suffix. Assert invalid verifier result,
  wrong audience/scope, invalid UUID/digest/date, or repository denial returns unauthorized and
  never returns a token. Assert verifier/repository exceptions expose no nested value. The gate
  tests a hanging verifier timeout, abort propagation, 33rd-call saturation, and a late result that
  creates zero rows. Security-owned verifier contract vectors prove `K_replay[v]`, never public
  `v`, is the HMAC key and reject out-of-bound or NUL-containing canonical fields.

```ts
it("returns a bearer only after the hash-only repository commits", async () => {
  const issue = vi.fn().mockResolvedValue({
    kind: "issued",
    expiresAt: new Date("2026-08-14T13:00:00.000Z"),
  });
  const service = createClientSessionService({
    verifier: approvedProofVerifier(),
    sessions: { issue },
    generateToken: () => `cs1.${"A".repeat(43)}`,
  });
  await expect(service.issue("P".repeat(32))).resolves.toEqual({
    accessToken: `cs1.${"A".repeat(43)}`,
    tokenType: "Bearer",
    scope: "client_catalog:read",
    expiresAt: "2026-08-14T13:00:00.000Z",
  });
  expect(issue.mock.calls[0]![0]).not.toHaveProperty("identityProof");
  expect(JSON.stringify(issue.mock.calls[0]![0])).not.toContain(`cs1.${"A".repeat(43)}`);
});
```

- [ ] **Step 2: Run RED once.**

Run:

```powershell
pnpm exec vitest run packages/application/src/client-session-service.test.ts apps/api/src/client-session-token.test.ts apps/api/src/client-proof-verifier-gate.test.ts
```

Expected: FAIL because the service and exact token helpers do not exist.

- [ ] **Step 3: Implement the minimal issuer.** Validate only the frozen verifier result,
  generate the bearer after verification, pass only its hash plus normalized proof facts to the
  repository, and include the bearer only when the repository returns `issued`. Map verifier
  null to unauthorized and verifier exceptions to unavailable. Wrap the one process-wide verifier
  instance with a 32-permit gate, a 2-second abort deadline, and a completion generation check so
  an aborted/late result cannot call the repository. Do not export any runtime fake.

```ts
export const createClientSessionToken = (): `cs1.${string}` =>
  `cs1.${randomBytes(32).toString("base64url")}`;

export const clientSessionTokenHash = (token: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;

export const parseClientBearer = (
  authorization: string | readonly string[] | undefined,
): `cs1.${string}` | null => {
  if (typeof authorization !== "string") return null;
  return /^Bearer (cs1\.[A-Za-z0-9_-]{43})$/u.exec(authorization)?.[1] as
    | `cs1.${string}`
    | undefined ?? null;
};
```

- [ ] **Step 4: Run focused tests and commit.** Expect PASS, then commit
  `feat: define client session issuance boundary`.

```powershell
pnpm exec vitest run packages/application/src/client-session-service.test.ts apps/api/src/client-session-token.test.ts apps/api/src/client-proof-verifier-gate.test.ts
```

## Task 2: PostgreSQL session and proof-replay authority

**Files:**

- Modify: `packages/db/src/schema/identity.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Create: the migration whose prefix is the next actual number after the merged catalog entry
- Create: `packages/db/src/repositories/client-session-repository.ts`
- Create: `tests/integration/client-session-repository.test.ts`
- Modify: `packages/db/src/testkit/postgres.ts`, `tests/integration/schema.test.ts`,
  `tests/repo/db-schema-parity.test.ts`

**Interfaces:**

- Consumes: Task 1 `ClientSessionRepository` issue input and token hash.
- Produces: `PostgresClientSessionRepository.issue`, `resolve`, `revoke`, `cleanupExpired`.

- [ ] **Step 1: Rebase on the catalog merge and allocate the migration.** Verify exact root,
  remote, branch and HEAD. Read the committed catalog merge and journal. Select the next unused
  journal index after catalog; record that resolved filename in the progress ledger before adding
  SQL. If catalog is not merged or the worktree is dirty, stop without editing.

```powershell
git status --short --branch
git rev-parse --show-toplevel
git remote get-url origin
git rev-parse HEAD
Get-Content packages/db/migrations/meta/_journal.json -Raw
Get-ChildItem packages/db/migrations -Filter '*.sql' | Sort-Object Name | Select-Object Name
```

Expected: a clean `codex/*` worktree based on the catalog merge and an unambiguous next actual
migration number. No instruction in this plan implies `0030`.

- [ ] **Step 2: Write RED schema and repository tests.** Cover canonical constraints, inactive
  user denial, proof already expired, proof expiry at/beyond the one-hour bound, sequential replay,
  ten concurrent identical issues with one winner, token-hash collision denial, exact scope,
  fresh resolve, expiry, revoke, repeated revoke, and user deactivation between resolves.

```ts
const attempts = await Promise.all(
  Array.from({ length: 10 }, (_, index) =>
    repository.issue({
      userId,
      replayDigest,
      proofExpiresAt,
      tokenDigest: hashFor(`candidate-${index}`),
      scope: "client_catalog:read",
      maximumTtlMs: 3_600_000,
    }),
  ),
);
expect(attempts.filter((result) => result.kind === "issued")).toHaveLength(1);
expect(await countRows("client_identity_proof_receipts")).toBe(1);
expect(await countRows("client_sessions")).toBe(1);
```

- [ ] **Step 3: Run RED once.**

Run:

```powershell
pnpm exec vitest run tests/integration/client-session-repository.test.ts tests/integration/schema.test.ts tests/repo/db-schema-parity.test.ts
```

Expected: FAIL because the migration, schema, repository, and cleanup order do not exist.

- [ ] **Step 4: Add the two minimal relations.** `client_sessions` stores
  `token_digest`, `user_id`, fixed `scope`, `expires_at`, nullable `revoked_at`, and
  `created_at`. `client_identity_proof_receipts` stores unique `replay_digest`, unique linked
  nullable `session_token_digest`, `expires_at`, and `created_at`. Add format/lifecycle/scope checks, indexes on
  active session lookup and cleanup time, and foreign keys to `users` and session hash. The receipt
  uses `ON DELETE SET NULL`, so subject erasure can remove the user-linked session while a
  non-linkable replay tombstone remains until proof expiry. Do not add
  proof, contact, subject, provider, display, token, body, or payload columns.

- [ ] **Step 5: Implement atomic issue and fresh resolution.** Use one transaction and database
  clock. The issue statement locks/validates the active user, requires proof expiry after database
  time and no later than `db_now + interval '1 hour'`, inserts the unique receipt, inserts its
  session with `expires_at = proof_expires_at`, and returns expiry only after both rows
  exist. Resolve joins `users` on every call and checks literal scope, expiry and revocation.
  Revoke conditionally updates one currently valid row. Cleanup deletes proof-expired receipts
  first, then their expired session tombstones, idempotently and without outputting hashes.

- [ ] **Step 6: Run focused PostgreSQL tests and commit.** Expect PASS, run migration parity once,
  then commit `feat: add replay-safe client sessions`.

## Task 3: Strict HTTP, fresh resolver, config and catalog composition

**Files:**

- Modify after catalog merge: `apps/api/src/client-principal-resolver.ts`,
  `apps/api/src/client-principal-resolver.test.ts`
- Create: `apps/api/src/routes/client-sessions.ts`,
  `apps/api/src/routes/client-sessions.test.ts`
- Create: `apps/api/src/client-session-body.ts`,
  `apps/api/src/client-session-body.test.ts`
- Modify: merged catalog route tests and composition files
- Verify and preserve: `docs/contracts/client-catalog-session-amendment.md`
- Modify: `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/api/src/server.ts`,
  `apps/api/src/server.test.ts`
- Modify: `packages/config/src/env.ts`, `packages/config/src/env.test.ts`, `.env.example`
- Create: `tests/repo/client-session-boundaries.test.ts`

**Interfaces:**

- Consumes: Task 1 service/token parser and Task 2 resolve/revoke repository.
- Produces: injected `ClientPrincipalResolver` for catalog routes and default-off session routes.

```ts
export type ClientPrincipalResolution =
  | { readonly kind: "resolved"; readonly principal: ClientPrincipal }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" };

export interface ClientPrincipalResolver {
  resolve(authorization: string): Promise<ClientPrincipalResolution>;
}
```

- [ ] **Step 1: Write RED HTTP/composition tests.** Cover exact request object, 32–6144 UTF-8
  proof bytes, 8-KiB body, no normalization, `201` headers/body, normalized `400|401|503`, route
  absence under default false, enabled-with-missing-dependency startup failure, and every
  catalog/session/resolver flag combination. Raw-request cases cover duplicate/mixed-case
  Authorization field lines, comma folding, HTTP/1.1 plus activation proxy/HTTP2 normalization,
  media type/charset, content encoding, malformed UTF-8, duplicate JSON keys, trailing bytes,
  ambiguous framing, and the pre-parse byte cap. Prove unauthorized returns before catalog service.

```ts
it("fails startup when catalog is enabled without client session authority", async () => {
  await expect(buildApp({
    ...dependencies(),
    config: config({ clientCatalog: true, clientSession: false }),
  })).rejects.toThrow("Client catalog requires client session authority");
});
```

- [ ] **Step 2: Run RED once.**

Run:

```powershell
pnpm exec vitest run apps/api/src/client-principal-resolver.test.ts apps/api/src/client-session-body.test.ts apps/api/src/routes/client-sessions.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts packages/config/src/env.test.ts tests/repo/client-session-boundaries.test.ts
```

Expected: FAIL because the routes, flag and capability composition do not exist.

- [ ] **Step 3: Implement resolver and routes.** The HTTP adapter counts case-insensitive
  `Authorization` occurrences in `request.raw.rawHeaders` before parsing one exact Bearer value;
  folded, duplicated, or normalization-ambiguous input returns `401` before catalog service. The
  resolver hashes the token and calls fresh PostgreSQL resolution. A raw-body parser enforces the
  frozen media/framing/UTF-8/duplicate-key/trailing-byte grammar before JSON conversion. The issue
  route disables body logging, maps only frozen responses, sets `no-store`/`no-cache`, and never
  includes proof or nested causes. The revoke route resolves first, conditionally revokes, and
  returns `204`.

- [ ] **Step 4: Implement default-off composition and pure preflight.** Add
  `CLIENT_SESSION_ENABLED` as `true|false` with default false. `.env.example` contains only
  `CLIENT_SESSION_ENABLED=false`; it contains no invented proof key/reference. When false, do not
  register routes. When true, require verifier, issuer repository/service, and resolver. When
  merged catalog is true, additionally require client session true and inject this resolver into
  catalog request/read routes. Run a pure flag/capability preflight before `migrateDb`; matrix tests
  assert invalid combinations call neither migration, route registration, nor listen. Runtime
  server construction must not import test support.

- [ ] **Step 5: Reconcile catalog merge conflicts explicitly.** Preserve catalog's minimal
  `ClientPrincipal` shape (`authenticated`, `active`, canonical `userId`) and replace only its
  `ClientPrincipal | null` resolver outcome with the amendment's typed
  `resolved|denied|unavailable` result. Keep token digest, scope, and expiry resolver-internal.
  Add a compile-time boundary test that catalog code cannot access or serialize those fields.
  Resolve overlapping `app.ts`, `server.ts`, `env.ts`, `.env.example`, application exports, DB
  exports/journal, and tests without dropping catalog's worker-outbox joint gate.

- [ ] **Step 6: Run focused HTTP/config tests and commit.** Expect PASS, then commit
  `feat: protect client catalog with fresh sessions`.

```powershell
pnpm exec vitest run apps/api/src/client-principal-resolver.test.ts apps/api/src/client-session-body.test.ts apps/api/src/routes/client-sessions.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts packages/config/src/env.test.ts tests/repo/client-session-boundaries.test.ts
```

## Task 4: Privacy cleanup, telemetry redaction and zero-side-effect acceptance

**Files:**

- Modify: `packages/application/src/privacy-service.ts`,
  `packages/application/src/privacy-service.test.ts`
- Modify: `packages/db/src/repositories/privacy-repository.ts`
- Modify: `packages/worker/src/data-retention.ts`,
  `packages/worker/src/data-retention.test.ts`
- Modify: `packages/observability/src/logger.ts`,
  `packages/observability/src/logger.test.ts`, `packages/observability/src/metrics.ts`
- Create: `tests/integration/client-session-privacy.test.ts`
- Create: `tests/e2e/client-session-catalog.test.ts`

**Interfaces:**

- Consumes: Tasks 2–3 repository, resolver, routes, and merged catalog service.
- Produces: idempotent expiry/erasure cleanup and the complete CPS-AC-01–11 proof.

- [ ] **Step 1: Write RED privacy and acceptance tests.** Use unique sentinels for proof, bearer,
  authorization, contact and provider subject. Capture logs/traces/metric labels/errors and assert
  no sentinel, replay digest, or token hash. Assert subject erasure removes the session, nulls the
  replay receipt link, rejects replay and account recreation until proof expiry, and expiry cleanup
  is idempotent. The end-to-end test issues a session, creates/reads one owner
  catalog request, rejects a second client, deactivates/revokes, and counts exactly one catalog
  request plus one `catalog.show` outbox fact while provider, ledger, reservation, booking, and
  payment counts remain zero. Add the lost-`201` case: the same proof returns `401`, while a new
  proof identity can recover without revealing the original bearer.

```ts
expect(await durableSideEffectCounts()).toEqual({
  catalogRequests: 1,
  catalogShowOutbox: 1,
  providerAttempts: 0,
  ledgerFacts: 0,
  reservations: 0,
  bookings: 0,
  payments: 0,
});
```

- [ ] **Step 2: Run RED once.**

Run:

```powershell
pnpm exec vitest run packages/application/src/privacy-service.test.ts packages/worker/src/data-retention.test.ts packages/observability/src/logger.test.ts tests/integration/client-session-privacy.test.ts tests/e2e/client-session-catalog.test.ts
```

Expected: FAIL because session privacy processors, cleanup, redaction, and acceptance harness do
not exist.

- [ ] **Step 3: Implement cleanup and erasure.** Add client sessions to the existing subject
  erasure transaction and replay receipts to the retention worker. The privacy transaction first
  locks and deactivates or deletes the user, then removes its sessions; `ON DELETE SET NULL` makes
  each live receipt non-linkable and it remains until proof expiry. Routine retention removes
  proof-expired receipts before any remaining expired sessions. Delete by internal user/session
  relationship; do not export hashes or receipts. Cleanup uses database time and normalized
  counts only.

- [ ] **Step 4: Implement redaction and fixed telemetry.** Redact `authorization`,
  `identityProof`, session response body, verifier inputs/outputs, nested causes, token/replay fields,
  and raw body before sinks. Emit only fixed operations `issue|resolve|revoke|cleanup` and outcomes
  `allowed|denied|unavailable|removed`; never attach IDs, reason detail, scope, time, or proof data.

- [ ] **Step 5: Run the complete focused local gate once and commit.** Run Tasks 1–4 test files,
  affected package typechecks, lint for changed files, build, and `git diff --check` once. Expect
  PASS and commit `feat: complete private client session lifecycle`.

```powershell
pnpm exec vitest run packages/application/src/client-session-service.test.ts apps/api/src/client-session-token.test.ts apps/api/src/client-proof-verifier-gate.test.ts tests/integration/client-session-repository.test.ts tests/integration/schema.test.ts tests/repo/db-schema-parity.test.ts apps/api/src/client-principal-resolver.test.ts apps/api/src/client-session-body.test.ts apps/api/src/routes/client-sessions.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts packages/config/src/env.test.ts tests/repo/client-session-boundaries.test.ts packages/application/src/privacy-service.test.ts packages/worker/src/data-retention.test.ts packages/observability/src/logger.test.ts tests/integration/client-session-privacy.test.ts tests/e2e/client-session-catalog.test.ts
```

## Task 5: Independent review and one focused Claw gate

**Files:**

- Create: `docs/test-evidence/claw/<short-current-HEAD>-mvp-client-principal-001/verification.md`
- Modify: `docs/spec/mvp-client-principal-001-progress.md`
- Modify: `docs/spec/mvp-client-principal-001-traceability.md`
- Modify only if facts changed: `docs/runbooks/client-session-activation.md`

- [ ] **Step 1: Obtain independent interface/security review.** Give reviewers the canonical
  spec, contract, spine, plan, merged catalog contract, base SHA and implementation diff. Require
  exact severity/file/line/evidence for bearer grammar, verifier boundary, replay transaction,
  TTL/revocation/user-active resolution, catalog ownership, redaction, cleanup and zero-side-effect
  scope. Resolve every Critical and Important finding before proceeding.

- [ ] **Step 2: Verify the reviewed commit locally once.** Run the exact focused Tasks 1–4 files,
  affected typechecks/lint/build, migration check, secret-pattern scan with redaction, and
  `git diff --check`. Record counts and current full SHA; do not run the full workspace suite twice.

```powershell
pnpm exec vitest run packages/application/src/client-session-service.test.ts apps/api/src/client-session-token.test.ts apps/api/src/client-proof-verifier-gate.test.ts tests/integration/client-session-repository.test.ts tests/integration/schema.test.ts tests/repo/db-schema-parity.test.ts apps/api/src/client-principal-resolver.test.ts apps/api/src/client-session-body.test.ts apps/api/src/routes/client-sessions.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts packages/config/src/env.test.ts tests/repo/client-session-boundaries.test.ts packages/application/src/privacy-service.test.ts packages/worker/src/data-retention.test.ts packages/observability/src/logger.test.ts tests/integration/client-session-privacy.test.ts tests/e2e/client-session-catalog.test.ts
```

- [ ] **Step 3: Run one focused Claw invocation.** On the Claw host use the current pinned
  `ii-tonya-test` image documented in `docs/testing/claw-container.md`, mount the exact clean source
  SHA, install offline/frozen, build once, and run only the Task 1–4 unit/repository/real-PG/E2E
  files with `--maxWorkers=1`. Record `repeat_limit: 1`. If it passes, stop. If it fails, retain the
  failure as terminal evidence and keep this slice blocked; do not invoke Claw again under this
  slice ID.

- [ ] **Step 4: Record evidence and cleanup.** Evidence contains exact full SHA, current test image
  ID, command, test counts, duration, redacted checksums, cleanup result, no credentials, and
  `production_container: false`. Confirm zero leaked test databases/containers and unchanged
  activation status `BLOCKED`.

- [ ] **Step 5: Commit evidence.** Commit `docs: record client principal verification`. Do not push,
  merge, invoke Actions, enable flags, contact providers, or deploy without a separate command.

## Plan self-review

- CPS-001–004 map to Tasks 1 and 3; CPS-005 and CPS-005A map to Tasks 1–2; CPS-006,
  CPS-006A, CPS-007, and CPS-008 map to Tasks 2–3; CPS-009 maps to Task 3;
  CPS-010–012 map to Task 4; CPS-013–015 map to Tasks 2 and 5; CPS-016 maps to Tasks 1 and 5.
- All acceptance criteria have a named focused or real-PostgreSQL proof; no provider or Planerka
  evidence is required.
- Types, token grammar, audience, scopes, TTL, replay digest, error shapes and no-store response
  match the canonical contract.
- The migration is intentionally selected from the post-catalog journal at execution; no numeric
  prefix is frozen here.
- `FOLLOW-CLIENT-BOOKING-001` and `FOLLOW-SELARTI-IDENTITY-001` remain separate slices and gain no
  authority from this implementation.
