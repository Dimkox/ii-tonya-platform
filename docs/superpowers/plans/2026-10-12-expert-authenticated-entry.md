# Expert Authenticated Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Preserve the existing shared candidate; one implementer owns this increment.

**Goal:** Make an existing verified expert able to sign in and out through the real server and browser, supplying the identity required by commercial billing.

**Architecture:** Separate opaque expert sessions and purpose-specific Telegram proof verification. PostgreSQL owns one-time proof consumption, revocation and current ownership. A cookie/CSRF browser facade keeps bearers out of the page; normal server composition owns every dependency.

**Tech Stack:** Existing TypeScript/Fastify/PostgreSQL/Drizzle/Vite, Node24 and pnpm11.9.0; no new dependency.

**Spec:** `docs/superpowers/implementation-artifacts/spec-expert-authenticated-entry.md`

## Global constraints

- Full product completion remains the parent goal; login alone is not release completion.
- No client-token promotion, expert auto-verification, written consent/signature gate or fake payment capability.
- Keep financial startup guards, existing client behavior, dirty worktree and historical migrations intact.
- No provider calls, production changes, commit/push or unrelated financial edits in this increment.
- Hand-author the next migration and journal entry; derive metadata on isolated PostgreSQL17.5. Never run `drizzle-kit generate`.
- Each new focused test file: RED1, implementation2, post-review3 maximum. No full/multipath suite, old exhausted file, renamed test or hidden collection run.

## Review focus

1. Owner reassignment between proof verification and issuance must deny the old owner (Task1 PG).
2. Proof expiry while waiting for a database lock must not extend authentication (Task1 PG).
3. Client, admin and expert credentials must never cross namespaces (Task2 transport).
4. An old response after logout or account switch must not restore browser authority (Task3 browser).
5. A normally started server must issue/resolve/revoke without injected expert principals (Task2 composition + Task3 browser).

### Task 1: Persistent expert identity and proof consumption

**Files:** Create `packages/application/src/expert-session-service.ts`, `packages/db/src/repositories/expert-session-repository.ts`, `packages/db/src/schema/expert-sessions.ts`; modify package/schema barrels. Add next-free SQL/journal/state metadata (0049 currently), and update the existing migration guards. Test in `tests/integration/expert-session-entry.test.ts`.

**Interfaces:**

- `VerifiedExpertIdentityProof`: `userId`, `expertId`, `channelIdentityId`, audience `ii-tonya-expert`, scope `expert_session:create`, `expiresAt: Date`, purpose-namespaced `replayDigest`.
- `ExpertSessionRepository.issue({userId,expertId,channelIdentityId,replayDigest,proofExpiresAt,tokenDigest})`: issued expiry or denied. Revalidate the exact verified channel row, user and expert under locks. Fresh DB clock; maximum3600 seconds; atomic proof receipt and session.
- `findByTokenHash(hash)`: implements the existing expert resolver lookup contract, returning original user/expert/expiry only when current user, expert and channel ownership still qualify.
- `resolveTelegramIdentity(externalId)`: existing verified owner and channel row IDs or null; repository constructed with the configured bot scope. Follow the spec's private scoped/sole-legacy mapping rule; no user/expert creation.
- `revoke(tokenDigest)` and bounded `cleanupExpired(limit)`; no cleanup of unexpired proof receipts.
- `createExpertSessionService({verifier,sessions,generateToken,digestToken})`: issue result with `es1.` bearer only at the trusted service/API boundary.

- [ ] Write PG cases for valid owner, inactive/unverified/nonexpert denial, concurrent one-proof issuance, real row-lock wait across expiry, revoke/expiry and owner reassignment. Assert exact counts and original owner; no broad truthy assertions.
- [ ] Run this focused file once for genuine RED; keep its next run until Task2 adds ordinary composition coverage.
- [ ] Implement SQL constraints/indexes/FKs and transactions, then service validation and exports. Store no plaintext token/proof. Use bounded locks/retries and fresh time after waits.
- [ ] Reconstruct/check migration metadata and prior SQL hashes. Do not rerun exhausted guards without a recorded remaining allowance.
- [ ] Wire bounded expiry cleanup into `apps/worker/src/main.ts`, `runtime.ts` and `packages/worker/src/data-retention.ts` using the existing retention-job pattern. Test expired removal, unexpired receipt preservation, disabled capability and failure propagation in this increment's focused tests; do not modify unrelated notification work.

### Task 2: Proof, bearer and browser API in default server

**Files:** Create `apps/api/src/telegram-expert-proof.ts`, `apps/api/src/expert-session-token.ts`, `apps/api/src/routes/expert-sessions.ts`, `apps/api/src/routes/expert-browser-session.ts`; modify `expert-principal-resolver.ts`, `server.ts`, `app.ts`, `packages/config/src/env.ts`, `.env.example`. Test `apps/api/src/expert-authentication.test.ts`; add composed cases to Task1's PG file before its second run.

**Interfaces:** `createTelegramExpertProofVerifier` mirrors existing strict Telegram mechanics with an explicit expert audience/scope and DB owner resolver. Token parser accepts only canonical `es1.` plus32 bytes. Real lookup feeds `createExpertBearerPrincipalResolver`. Register the spec's exact bearer endpoints and GET/POST/DELETE `/v1/expert/browser/session` through the ordinary outer app, including all headers/status codes.

- [ ] Write cases using synthetic signed Telegram payloads: mini/widget enabled/disabled, tampering, age boundaries, duplicate/extra fields, aborted verification, client/admin token denial and strict request parsing. No real bot calls.
- [ ] Add browser transport cases for same-origin login, separate `__Host-expert-session`/`__Host-expert-csrf` cookies, pre-login and authenticated CSRF, duplicate credentials, cross-origin denial, `no-store` and logout revocation.
- [ ] Run the new transport file once RED; implement without altering the client proof/session contracts. Explicitly construct dependencies in `createDefaultLifecycle`, not a test-only factory option. `EXPERT_SESSION_ENABLED=false` by default; missing enabled dependencies fail startup.
- [ ] Extend Task1 PG tests to start ordinary composition with synthetic credentials and an isolated DB, issue via signed proof, resolve real bearer and revoke through HTTP. No injected principal/session store. Also assert disabled startup and missing-capability failure.
- [ ] Run the PG and transport files separately for implementation evidence; reserve their third invocations for reviewed source.

### Task 3: Expert account page and end-to-end evidence

**Files:** Create `apps/web/src/expert-account-client.ts`, `apps/web/src/expert-account-view.ts`, `apps/web/src/expert-account-browser.test.ts`; modify `apps/web/src/main.ts` and add an explicit expert-login link in `landing-view.ts` without changing client entry. Add `docs/test-evidence/expert-authenticated-entry-2026-10-12.md` and a concise operations handoff.

**Interfaces:** Browser client exposes `probe`, `login(identityProof)` and `logout` against the expert cookie facade; never accepts/returns a bearer. Bind `/expert/account` states to this client, using an epoch/fence to reject stale responses. Reuse existing visual styles and Telegram login controls, without reusing client authorization.

- [ ] Write browser RED for unauthenticated, waiting, denied, unavailable, success, logout, late-response/account-switch and empty storage. Assert no signature/consent gate is added.
- [ ] Implement page/client/route/link. Show unavailable billing honestly; do not add a working-looking payment button before the next composition increment.
- [ ] Exercise the page against the real composed local API and isolated expert session DB using synthetic signed identity. A mocked browser response is useful for race tests but is not the composed acceptance proof.
- [ ] Run scoped types/lint/formatting/whitespace and independent review. Apply concrete findings. Execute only the recorded remaining focused runs.
- [ ] Record exact source, commands, results, screenshots where useful, cleanup and remaining gates. Leave published login and financial activation unclaimed until the separately authorized RC deployment.

## Execution handoff

Native coordinator planning; reuse one available implementer after the financial
correction fix round, with a scoped independent review. Do not edit the three
financial repositories currently owned by that fix. Before dispatch, self-check
the spec/plan interfaces and confirm all chosen test budgets and migration index.
Keep this plan pending, not implemented, until its source work and evidence exist.
