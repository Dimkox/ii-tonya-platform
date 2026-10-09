# Erasure Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execute inline; one independent review before release.

**Goal:** Let an owner submit erasure and track verified progress after session closure.

**Architecture:** Separate the durable request from physical erasure. A digest-only
status credential reads minimal progress from an owner-bound verified workflow.
No component may convert missing execution evidence into completion.

**Tech Stack:** TypeScript, Node24, PostgreSQL17.5, Drizzle SQL, Fastify, Vite.

**Spec:** `docs/superpowers/implementation-artifacts/spec-ac015-erasure-requests.md`

## Global Constraints

- pnpm11.9.0; frozen lockfile; no production fixtures or invented proofs.
- Hand SQL plus journal/snapshot; no drizzle generate.
- At most3 runs per new PG file; no exhausted file reruns.
- Owner delegated technical checkpoints. Native execution; preserve unrelated files.
- Saved request is not completed erasure; current provider flags are not history.

## Review Focus

- Lost response: same pre-generated receipt must recover the same durable request.
- Replaced/deactivated session: status credential works without resurrecting authority.
- Wrong linked job: no foreign processor or backup state may appear.
- Corrupt/forged completion: validated workflow failure must not become completed.
- Malformed credential/date: bounded rejection without throwing or exposing input.

### Task 1: Receipt and application service

**Files:** Create `packages/application/src/erasure-request-service.ts` and
`erasure-request-service.test.ts`; modify application `index.ts` exports.

**Interfaces:** `createErasureRequestService({repository,requestEnabled?})` exposes
`request({principalUserId,targetUserId,receiptToken})`, `readOwned({principalUserId,targetUserId})`
and `readReceipt(receiptToken)`. Repository ports: `accept({userId,receiptDigest})`,
`findOwned(userId)`, `findByReceiptDigest(receiptDigest)` and `getVerifiedJob(jobId)`.
Stored request is `{id,createdAt,jobId}`. Public view is
`{requestId,requestedAt,stage}`. Stages exactly match the spec matrix.

- [ ] Write unit tests for real owner/token validation and projection against
  a test-only repository double. Assert digest not token reaches storage;
  canonical aliases rejected; kill mode retains reads; no job means waiting;
  each verified job status maps exactly; unavailable proofs never complete.
- [ ] Run focused unit file and observe RED; implement ports/types and service.
- [ ] Run focused GREEN, application build/types, tests types, lint and diff.
- [ ] Commit the tested service increment; do not mark the route or goal complete.

### Task 2: Durable PostgreSQL request and receipt

**Files:** New `0041_client_erasure_requests.sql`, metadata/snapshot and
`schema/privacy-requests.ts`, repository and new integration test.

**Interfaces:** Implement Task1 ports; unique subject and receipt digest;
nullable job binding must match subject. Receipt revocation excludes reads.

- [ ] Write failing PG tests for one request per subject, same-token retry,
  replacement conflict, inactive creation denial, receipt read after deactivation,
  foreign link denial and concurrent inserts. Assert PG170005.
- [ ] Create additive SQL and complete snapshot metadata; implement bounded
  transactions and query projection. Use existing verified workflow.getJob.
- [ ] Execute focused PG within3 runs; build/types and migration integrity guard.
- [ ] Commit verified persistence; preserve request rows through rollback.

### Task 3: Browser request and status

**Files:** API browser routes/app/server, web privacy client/consent view and
focused API/browser tests.

**Interfaces:** Exact authenticated request/owned-status routes plus status-only
receipt POST. Body tokens only; strict shape/size, no URLs or persistence.

- [ ] Test anonymous/foreign CSRF denial, malformed body, same-token retry,
  receipt-only read, lost response and closed creation with retained status.
- [ ] Implement explicit confirmation and receipt download; distinguish request
  accepted from deletion. Keep controls disabled until dependencies are composed.
- [ ] Verify keyboard/mobile and real DOM behavior. Commit after focused GREEN.

### Task 4: Execution and release

**Files:** Existing privacy worker/repository/runtime composition, new focused
execution tests, recovery/evidence documents.

- [ ] Bind request-to-job execution with verified capture prerequisites; exact
  owner and idempotency fencing. Test unavailable providers, actual proof failure,
  retained ledger/audit facts and verified backup completion.
- [ ] Reconcile real processor targets and retention configuration; missing
  operator/provider evidence stays a visible pending prerequisite, never fake proof.
- [ ] Run independent whole-increment review and fix important findings with TDD.
- [ ] Build/sign RC, apply reviewed additive migration, deploy, verify site,
  receipt status and recovery compatibility. Human product review stays separate.
