# MVP Client Catalog 001 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a default-off authenticated client catalog request that atomically queues `catalog.show`, materializes a bounded immutable PostgreSQL snapshot, and returns it only to its owner.

**Architecture:** The API owns authority, normalization and receipt; a serializable database transaction owns request plus outbox. The generic worker-outbox registry owns dispatch and strict legacy/request-origin payload decoding. PostgreSQL owns first-write snapshots and retention.

**Tech Stack:** TypeScript, Fastify, Zod/Ajv, Drizzle, PostgreSQL, Vitest.

## Global Constraints

- Start only after `MVP-WORKER-OUTBOX-001` is merged; rebase to its exact merge SHA before the first edit.
- `CLIENT_CATALOG_ENABLED=false` and `WORKER_OUTBOX_DELIVERY_ENABLED=false` by default; both must be true to register `catalog.show`.
- `docs/spec/mvp-client-catalog-001.md`, `docs/contracts/client-catalog.md`, and the architecture spine are authoritative.
- No live Selarti/Planerka call, credentials, booking, payment, reservation, ledger debit, raw payload, contact data, provider ID, or production action.
- Allocate the next migration number from the post-prerequisite journal; never reuse or guess one today.
- Claw runs only after local review/build; after the first passing focused invocation, do not repeat it.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/application/src/client-catalog-service.ts` | principal-scoped command/read API and SHA-256 digest |
| `packages/application/src/ports.ts` | `ClientPrincipal` and request/snapshot ports |
| `packages/db/src/repositories/client-catalog-repository.ts` | request/outbox transaction, owner reads, materialization CAS and cleanup |
| `packages/db/migrations/0029_client_catalog_requests.sql` | requests, snapshots, constraints, indexes and expiry |
| `apps/api/src/client-principal-resolver.ts` | injected bearer lookup seam, no issuer implementation |
| `apps/api/src/routes/client-catalog.ts` | strict HTTP contract |
| `apps/worker/src/client-catalog-outbox.ts` | payload union decoder and snapshot handler |
| `packages/worker/src/topic-registry.ts` | allowlisted topic registration from the prerequisite |

### Task 1: Schema and durable request transaction

**Files:**

- Create: `packages/db/migrations/0029_client_catalog_requests.sql`
- Modify: `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/integration.ts`, `packages/db/src/index.ts`
- Create: `packages/db/src/repositories/client-catalog-repository.ts`
- Test: `tests/integration/client-catalog-repository.test.ts`, `tests/repo/client-catalog-boundaries.test.ts`

**Produces:**

```ts
interface ClientCatalogRequestRepository {
  createOrReplay(input: { userId: string; requestDigest: string; serviceCode?: string; language?: string; correlationId: string }): Promise<{ catalogRequestId: string; state: "pending" | "ready" }>;
  getOwned(input: { userId: string; catalogRequestId: string }): Promise<ClientCatalogSnapshot | null>;
  materialize(input: { catalogRequestId: string; now: Date }): Promise<"ready" | "replayed" | "missing">;
}
```

- [ ] **Step 1: Allocate the migration and write RED tests.**

Run:

```powershell
git fetch origin main --quiet
git log -1 --format=%H
Get-Content packages/db/migrations/meta/_journal.json -Raw
```

Expected: merged worker registry SHA and that `0029` remains unused. If its merge consumed `0029`, stop and assign the next unused journal number before writing the migration or this plan's implementation checklist. Tests show concurrent equal requests return one ID/one outbox fact and equal filters for different users do not collide.

- [ ] **Step 2: Add additive relations.** Create `client_catalog_requests` with user, digest, nullable normalized filters, `pending|ready|expired`, timestamps and expiry; unique `(user_id, request_digest)`. Create one `client_catalog_snapshots` row per request with validated bounded public cards JSON and 24-hour expiry. Snapshot JSON contains no source IDs. Add the minimal terminal-outbox tombstone relation/state needed to remove filters and snapshot at expiry without racing a lease.
- [ ] **Step 3: Implement serializable transaction and CAS.** Advisory-lock `(user_id,digest)`, insert/replay request and `catalog.show` with exactly `{"v":1,"catalogRequestId":"uuid"}`, idempotency key `client-catalog:<requestId>`, reconciliation key `client-catalog:<requestId>:v1`, and SHA-256 canonical payload hash. Lock request while materializing; ready rows replay unchanged, pending rows receive one snapshot then transition to ready; expired/missing rows terminalize without a snapshot.
- [ ] **Step 4: Verify and commit.** Run `pnpm exec vitest run tests/integration/client-catalog-repository.test.ts tests/repo/client-catalog-boundaries.test.ts`; expect PASS. Commit `feat: add durable client catalog snapshot storage`.

### Task 2: Fail-closed authority and application service

**Files:**

- Create: `packages/application/src/client-catalog-service.ts`, `packages/application/src/client-catalog-service.test.ts`
- Modify: `packages/application/src/ports.ts`, `packages/application/src/index.ts`
- Create: `apps/api/src/client-principal-resolver.ts`, `apps/api/src/client-principal-resolver.test.ts`

**Produces:**

```ts
interface ClientCatalogService {
  request(principal: ClientPrincipal, filters: CatalogFilters): Promise<CatalogRequestReceipt>;
  get(principal: ClientPrincipal, catalogRequestId: string): Promise<ClientCatalogSnapshot | null>;
}
```

- [ ] **Step 1: Write RED tests.** Assert malformed/inactive principal denies before repository access; asserted digest equals `sha256("client-catalog-v1\\0" + userId + "\\0" + serviceCode + "\\0" + language)`; foreign repository null stays null.
- [ ] **Step 2: Implement validation.** Require literal `authenticated`/`active` true and canonical UUID. Resolver errors become unauthenticated. Trim/validate optional filters before digest; accept neither request user ID nor caller idempotency key.
- [ ] **Step 3: Verify and commit.** Run `pnpm exec vitest run packages/application/src/client-catalog-service.test.ts apps/api/src/client-principal-resolver.test.ts`; expect PASS. Commit `feat: add client catalog application boundary`.

### Task 3: HTTP and default-off composition

**Files:**

- Create: `apps/api/src/routes/client-catalog.ts`, `apps/api/src/routes/client-catalog.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/server.test.ts`, `packages/config/src/env.ts`, `packages/config/src/env.test.ts`, `.env.example`

- [ ] **Step 1: Write RED route/config tests.** Cover exact optional body/8 KiB cap, `401` before service, `202` creation/replay, pending/ready owner reads, identical missing/foreign `404`, and all two-flag combinations.
- [ ] **Step 2: Implement frozen response mapping.** Register route only if client feature is true; fail startup if a true flag lacks resolver/service. Return only contract fields and `400|401|404|413|503|500` normalized errors.
- [ ] **Step 3: Implement config.** Parse client flag default false; worker registry must independently require both flags to register the topic.
- [ ] **Step 4: Verify and commit.** Run `pnpm exec vitest run apps/api/src/routes/client-catalog.test.ts apps/api/src/server.test.ts packages/config/src/env.test.ts`; expect PASS. Commit `feat: expose default-off client catalog routes`.

### Task 4: Generic outbox handler and deterministic source reader

**Files:**

- Create: `apps/worker/src/client-catalog-outbox.ts`, `apps/worker/src/client-catalog-outbox.test.ts`
- Modify: `packages/worker/src/topic-registry.ts`, `packages/worker/src/index.ts`, `apps/worker/src/main.ts`, `apps/worker/src/runtime.ts`, `packages/db/src/repositories/catalog-repository.ts`
- Test: `tests/integration/client-catalog-worker.test.ts`

- [ ] **Step 1: Write RED compatibility tests.** Existing `{serviceCode?,allowedServiceCodes}` is accepted unchanged; `{v:1,catalogRequestId}` is accepted; mixed/unknown payload is rejected without inferred filters. Test false/false, true/false, false/true, true/true registration.
- [ ] **Step 2: Implement public reader.** Select active verified expert + active service, sort service/language/public display name/internal tie ID and limit 20. Missing, partial, stale (outside database-now minus 15 minutes), future-observed, malformed or capacity-unknown availability yields `catalog_only` with `[]`; a complete normalized result yields only capacity-available slots at least 24 hours ahead, sorted by start and capped at three. Serialize no internal ID.
- [ ] **Step 3: Implement handler.** Load protected request filters by request ID, perform first-write materialization, return applied/replayed safely, and perform no network or ledger work.
- [ ] **Step 4: Verify and commit.** Run `pnpm exec vitest run apps/worker/src/client-catalog-outbox.test.ts tests/integration/client-catalog-worker.test.ts packages/worker/src`; expect PASS. Commit `feat: materialize client catalog snapshots from outbox`.

### Task 5: Retention, privacy, observability, review and Claw evidence

**Files:**

- Modify: `packages/application/src/privacy-service.ts`, `packages/db/src/repositories/privacy-repository.ts`, `packages/worker/src/data-retention.ts`, `packages/observability/src/metrics.ts`
- Test: `packages/application/src/privacy-service.test.ts`, `packages/worker/src/data-retention.test.ts`, `tests/integration/client-catalog-privacy.test.ts`
- Create: a new `docs/test-evidence/claw/<short-current-HEAD>-mvp-client-catalog-001/verification.md` directory, where `short-current-HEAD` is the literal output of `git rev-parse --short=7 HEAD` at gate start

- [x] **Step 1: Write RED lifecycle/metric tests.** Assert 24-hour snapshot/filter removal, retained public facts only in export, eventual terminal-outbox cleanup, erasure deletes catalog rows, and claimed-worker-versus-retention/erasure interleavings are safe. Assert metric labels are fixed `phase`/`outcome` values.
- [x] **Step 2: Implement lifecycle.** Retention locks request/outbox and marks an unmaterialized request expired, stripping public content while a minimum tombstone waits for terminal outbox state. Erasure uses the same lock and removes all catalog facts; a later worker sees missing/expired as terminal. Export exposes no digest, source identifier or outbox payload. Expose counters only for `request|materialize|cleanup` phases with normalized outcomes.
- [ ] **Step 3: Review and build.** Six affected builds pass. The first independent review found one Critical and seven Important issues; the first focused remediation gate passes 11/11. Closure review found three further Important issues; its separate remediation gate passes 5/5. A final missing-outbox lifecycle finding is covered by a 1/1 real-PostgreSQL remediation gate. Final independent closure confirmation remains.
- [ ] **Step 4: Run one focused Claw gate.** Run application/API/worker/config/privacy/boundary and real-PostgreSQL integration files once after local green. On PASS, stop; restore retained source state and record exact SHA/counts/cleanup.
- [ ] **Step 5: Commit evidence.** Commit `docs: record client catalog Claw verification`.

## Plan self-review

- CCAT-001–004 map to Tasks 2–3; CCAT-005–007 map to Task 4; CCAT-008–010 map to Task 5; durable atomicity maps to Task 1.
- No undefined provider contract is needed: unavailable availability is explicit catalog-only behavior.
- Terms, payloads, errors and interfaces match `docs/contracts/client-catalog.md`.
