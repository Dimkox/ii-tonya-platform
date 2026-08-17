# MVP Client Booking 001 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a default-off authenticated client reserve and owner-cancel API that consumes only
protected catalog choice handles and reuses the existing PostgreSQL reservation transaction.

**Architecture:** Booking-aware catalog materialization creates owner-only opaque choice handles
and protected local slot mappings. A client booking application boundary derives idempotency and
extends BookingService/PostgresBookingRepository so receipt, reservation, audit and outbox commit
atomically. Owner cancellation uses an opaque public booking handle and the existing transition.

**Tech Stack:** Node.js 24, TypeScript, Fastify, Drizzle, pnpm 11.9.0, Vitest; the qualifying
terminal gate uses the single test PostgreSQL 16.0.15 target (`server_version_num = 160015`).

## Global Constraints

- Start only after `MVP-CLIENT-PRINCIPAL-001` is merged or an equivalent reviewed commit is the
  branch base; record its exact full SHA before editing implementation files.
- The migration is the next actual journal number after the merged principal migration. No step
  in this plan reserves `0030`, `0031`, or another prefix.
- `CLIENT_BOOKING_ENABLED=false` and `CLIENT_BOOKING_RESERVE_ENABLED=false` by default.
- `PLANERKA_ENABLED=false` and `TELEGRAM_ENABLED=false`; no live provider or notification work.
- `client_catalog:read` does not satisfy `client_booking:write`.
- Accept no `userId`, internal expert/service/slot/reservation/provider ID, caller idempotency key,
  amount, payment, contact, expected version, or caller clock.
- PostgreSQL clock is authoritative. Lead is 24 hours, freshness 15 minutes, hold maximum 72
  hours, and configured confirmation buffer defaults to 60 minutes.
- Extend existing BookingService, PostgresBookingRepository, domain transitions, audit and outbox;
  do not create a parallel booking authority.
- A focused suite stops after its first PASS and is not rerun. Run exactly one integrated focused
  Claw/real-PostgreSQL invocation for the complete slice after review; failure is terminal.
- The terminal adapter requires an approved external PostgreSQL URL, asserts the actual test
  PostgreSQL 16.0.15 target `server_version_num = 160015` before the manifest, never prints the
  URL, and records the sanitized version result.
- Product approves the HTTP/public-state contract. Security separately approves live
  `client_booking:write`. Deployment requires a third explicit authorization.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/db/src/schema/integration.ts` | protected catalog choice relation |
| `packages/db/src/schema/booking.ts` | protected booking receipt and fenced erasure-work relations |
| `packages/db/src/repositories/client-catalog-repository.ts` | atomic v2 snapshot plus choice mappings and cleanup |
| `packages/db/src/repositories/booking-repository.ts` | protected-choice reserve and owner-handle cancel in existing transaction |
| `apps/worker/src/client-catalog-outbox.ts` | strict v2 payload and secure choice materialization |
| `packages/application/src/client-booking-service.ts` | handle validation/generation, principal guard and server idempotency |
| `packages/application/src/booking-service.ts` | reuse/extend booking workflow entrypoints and 60-minute config |
| `apps/api/src/routes/client-booking.ts` | strict authenticated reserve/cancel HTTP projection |
| `apps/api/src/client-booking-principal-resolver.ts` | separate booking-write resolver seam |
| `apps/api/src/app.ts`, `apps/api/src/server.ts` | pure preflight and default-off composition |
| `packages/application/src/privacy-service.ts`, `packages/db/src/repositories/privacy-repository.ts` | export/erasure of public handles and protected mappings |
| `packages/worker/src/data-retention.ts` | catalog-choice expiry cleanup without reservation loss |
| `packages/worker/src/client-booking-erasure.ts` | leased local cancellation-before-cleanup privacy phase |
| `packages/contracts/src/worker-outbox.ts`, `apps/worker/src/main.ts` | booking topics remain unclaimable and undispatchable |
| `scripts/run-claw-ci.sh` | reviewed immutable `client-booking` mode, exact manifest and PostgreSQL 16.0.15 preflight |
| `scripts/assert-client-booking-postgres.mjs` | credential-redacted `server_version_num = 160015` preflight |
| `packages/observability/src/metrics.ts`, `packages/observability/src/logger.ts` | fixed labels and handle redaction |

### Task 1: Rebase prerequisite and add protected relations

**Files:**

- Modify: `packages/db/migrations/meta/_journal.json`
- Create: the migration file whose numeric prefix Task 1 Step 1 proves is the next actual entry
  after the merged principal migration
- Modify: `packages/db/src/schema/integration.ts`, `packages/db/src/schema/booking.ts`,
  `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`
- Create: `tests/integration/client-booking-schema.test.ts`
- Modify: `tests/repo/db-schema-parity.test.ts`
- Modify: `docs/spec/mvp-client-booking-001-progress.md`

**Interfaces:**

- Produces protected `client_catalog_choices`, `client_booking_receipts`, and
  `client_booking_erasure_work` relations.
- The former belongs to catalog request lifecycle; the latter belongs to reservation lifecycle.

```ts
export interface ProtectedCatalogChoiceRecord {
  readonly requestId: string;
  readonly userId: string;
  readonly choiceDigest: `sha256:${string}`;
  readonly slotId: string;
  readonly expiresAt: Date;
}

export interface ClientBookingReceiptRecord {
  readonly userId: string;
  readonly choiceDigest: `sha256:${string}`;
  readonly bookingHandle: `bk1.${string}`;
  readonly reservationId: string;
  readonly createdAt: Date;
}
```

- [ ] **Step 1: Establish the implementation base and allocate one migration.**

Run:

```powershell
git status --short --branch
git rev-parse --show-toplevel
git remote get-url origin
git rev-parse HEAD
git log -1 --format='%H %s'
Get-Content packages/db/migrations/meta/_journal.json -Raw
Get-ChildItem packages/db/migrations -Filter '*.sql' | Sort-Object Name | Select-Object Name
```

Expected: clean `codex/*` worktree, canonical remote, principal implementation in ancestry, and
one unambiguous next unused journal index. Record the exact base and selected migration filename
in the progress ledger before the RED test. Stop if principal is absent or the journal conflicts.

- [ ] **Step 2: Write RED schema/parity tests.** Assert exact constraints: canonical handle digest,
  request/slot FKs, choice unique digest, choice expiry after creation, unique
  `(user_id,choice_digest)`, unique `booking_handle`, receipt reservation FK, no provider/contact/
  amount/payment/raw payload columns, and cascade/delete behavior matching the two lifecycles. Add
  booking-local erasure work keyed by the existing deletion job with finite phase, lease/fence,
  attempt count, and timestamps; the parent job cannot complete before this phase does.

```ts
expect(await relationColumns("client_catalog_choices")).toEqual([
  "id", "request_id", "choice_digest", "slot_id", "expires_at", "created_at",
]);
expect(await relationColumns("client_booking_receipts")).toEqual([
  "id", "user_id", "choice_digest", "booking_handle", "reservation_id", "created_at",
]);
expect(await uniqueConstraint("client_booking_receipts", ["user_id", "choice_digest"]))
  .toBe(true);
expect(await relationColumns("client_booking_erasure_work")).toEqual([
  "deletion_job_id", "phase", "lease_token", "lease_until", "attempt_count", "updated_at",
]);
```

- [ ] **Step 3: Run RED once.**

```powershell
pnpm exec vitest run tests/integration/client-booking-schema.test.ts tests/repo/db-schema-parity.test.ts
```

Expected: FAIL because the two protected relations and selected migration do not exist.

- [ ] **Step 4: Add the selected forward-only migration and Drizzle schema.** Choice rows contain
  only request FK, digest, local slot FK, expiry and creation time; owner is derived through the
  request. Receipt rows contain only owner, choice digest, opaque booking handle, reservation FK
  and creation time. Add exact format checks and indexes used by owner lookup/cleanup. Do not add
  provider, contact, amount, payment, filter, capacity, observed-time, payload or secret fields.

- [ ] **Step 5: Run the focused schema suite until its first PASS, then never rerun it.** Commit
  `feat: add protected client booking references`.

### Task 2: Materialize booking-aware catalog choices

**Files:**

- Modify: `packages/application/src/client-catalog-service.ts`,
  `packages/application/src/client-catalog-service.test.ts`, `packages/application/src/ports.ts`
- Modify: `apps/worker/src/client-catalog-outbox.ts`,
  `apps/worker/src/client-catalog-outbox.test.ts`
- Modify: `packages/db/src/repositories/catalog-repository.ts`,
  `packages/db/src/repositories/client-catalog-repository.ts`
- Modify: `apps/worker/src/main.ts`, `apps/worker/src/runtime.ts`
- Create: `tests/integration/client-catalog-booking-choice.test.ts`

**Interfaces:**

```ts
export interface BookingAwareAvailabilitySlot {
  readonly localSlotId: string;
  readonly sourceOrder: string;
  readonly startsAt: Date;
  readonly observedAt: Date;
  readonly remainingCapacity: number | null;
}

export interface MaterializedCatalogChoice {
  readonly publicSlot: { readonly startsAt: string; readonly choiceHandle: `ch1.${string}` };
  readonly protected: { readonly choiceDigest: `sha256:${string}`; readonly localSlotId: string; readonly expiresAt: Date };
}
```

- [ ] **Step 1: Write RED compatibility/materialization tests.** Cover unchanged legacy payload,
  unchanged v1 `{v:1,catalogRequestId}`, strict v2 `{v:2,catalogRequestId}`, mixed payload
  rejection, separate v2 digest domain, 32-byte handle generation, owner-only snapshot shape,
  first-write/replay stability, complete availability only, and cleanup/erasure of mapping plus
  snapshot in one transaction.

```ts
expect(ready.cards[0]?.slots[0]).toEqual({
  startsAt: "2026-08-16T12:00:00.000Z",
  choiceHandle: expect.stringMatching(/^ch1\.[A-Za-z0-9_-]{43}$/u),
});
expect(JSON.stringify(ready)).not.toMatch(/expertId|serviceId|slotId|provider/i);
```

- [ ] **Step 2: Run RED unit files once.** Expected: FAIL because v2 payload, local slot locator,
  handle generator and protected materialization input are absent.

```powershell
pnpm exec vitest run packages/application/src/client-catalog-service.test.ts apps/worker/src/client-catalog-outbox.test.ts
```

- [ ] **Step 3: Implement booking-aware v2 without changing v1.** Select the digest/payload version
  from server feature composition, not request data. Extend the injected availability result with
  a validated canonical local slot UUID, generate `ch1` using `randomBytes(32)`, derive
  `sha256:` digest, calculate expiry as the frozen minimum, and pass public/protected records to a
  single first-write repository transaction. Never serialize the local UUID.
  Regenerate a colliding choice handle at most three times inside that transaction; the injected
  collision test proves the fourth outcome is sanitized rollback. Serialize valid instants only as
  millisecond UTC with `Z`.

- [ ] **Step 4: Implement compatible choice coordination.** First document the merged booking,
  catalog-retention, principal and privacy lock topology. Add one advisory key derived from the
  choice digest for reserve and choice cleanup. Only reserve may proceed into the existing sorted
  booking lock protocol; retention never acquires booking locks. Delete mappings with snapshot/
  filter cleanup. A reserve holding the choice lock wins or loses as a whole; a committed
  reservation has no FK dependency on the choice row.

- [ ] **Step 5: Run the Task 2 focused unit/integration suite until its first PASS, then never
  rerun it.** Commit `feat: materialize protected catalog booking choices`.

### Task 3: Extend the existing booking transaction and application service

**Files:**

- Modify: `packages/application/src/booking-service.ts`,
  `packages/application/src/booking-service.test.ts`,
  `packages/application/src/booking-service.testkit.ts`, `packages/application/src/index.ts`
- Create: `packages/application/src/client-booking-service.ts`,
  `packages/application/src/client-booking-service.test.ts`
- Modify: `packages/db/src/repositories/booking-repository.ts`
- Create: `tests/integration/client-booking-repository.test.ts`
- Modify: `packages/config/src/env.ts`, `packages/config/src/env.test.ts`, `.env.example`

**Interfaces:**

```ts
export interface ClientBookingService {
  reserve(principal: ClientPrincipal, input: { choiceHandle: string }): Promise<{
    readonly created: boolean;
    readonly bookingHandle: string;
    readonly state: "reserved" | "booked" | "cancelled" | "expired" | "completed" | "no_show";
    readonly reservedUntil: string;
  }>;
  cancel(principal: ClientPrincipal, bookingHandle: string): Promise<{
    readonly bookingHandle: string;
    readonly state: "cancelled";
  }>;
}

export interface ProtectedClientBookingRepository {
  reserveProtectedChoice(input: {
    readonly userId: string;
    readonly choiceDigest: `sha256:${string}`;
    readonly bookingHandle: `bk1.${string}`;
    readonly correlationId: string;
    readonly minimumLeadMs: 86400000;
    readonly slotFreshnessMs: 900000;
    readonly confirmationBufferMs: 3600000;
  }): Promise<ClientBookingReserveResult>;
  cancelOwnedByHandle(input: {
    readonly userId: string;
    readonly bookingHandle: `bk1.${string}`;
    readonly correlationId: string;
  }): Promise<ClientBookingCancelResult>;
}
```

- [ ] **Step 1: Write RED application/repository tests.** Cover hostile principal, exact handles,
  server digest, no caller authority, one random `bk1`, receipt replay, database clock, active user,
  choice expiry, 24h/15m/72h/60m boundaries, capacity/overlap, same-choice concurrency, different
  clients, well-formed absent/erased/foreign choice equality, changed-owned-choice conflict,
  client/expert cancellation replay equality, three-collision retry/exhaustion, fixed public time,
  and exact existing audit/outbox topics with `charge: 0`.

```ts
const attempts = await Promise.all(
  Array.from({ length: 10 }, () => service.reserve(owner, { choiceHandle })),
);
expect(new Set(attempts.map((result) => result.bookingHandle))).toHaveLength(1);
expect(await durableCounts()).toMatchObject({
  reservations: 1,
  bookingReceipts: 1,
  reserveAudits: 1,
  reserveOutbox: 2,
  providerAttempts: 0,
  ledgerFacts: 0,
  payments: 0,
});
```

- [ ] **Step 2: Run RED application files once.**

```powershell
pnpm exec vitest run packages/application/src/client-booking-service.test.ts packages/application/src/booking-service.test.ts
```

Expected: FAIL because protected methods, server handle identity, and configurable 60-minute
confirmation buffer are absent.

- [ ] **Step 3: Implement the application boundary.** Validate exact principal/handles, generate
  32 random booking-handle bytes and correlation ID, hash choice handle, and call only protected
  BookingService/repository methods. Project domain statuses through the frozen public mapping.
  Never accept or return internal IDs or versions. Retry booking-handle collision at most three
  times in the transaction and fail sanitized/atomically on exhaustion.

- [ ] **Step 4: Refactor the repository without duplicating mutation logic.** Add a protected
  transaction entrypoint that locks the active user, request and choice, derives slot/expert lock
  keys, then reuses the existing reserve insert, overlap/capacity, audit and outbox helpers. Obtain
  time from PostgreSQL. Insert receipt in the same transaction. Add owner-handle cancel as an
  idempotent wrapper around the existing client transition; either internal cancellation terminal
  replays the same public `200 cancelled` without calling audit/outbox again.

- [ ] **Step 5: Replace the hard-coded 30-minute buffer.** Add bounded configuration that defaults
  to `60` minutes and injects `3_600_000` into BookingService. Repository and route reject startup
  if the value is not a positive safe integer allowed by the normalized policy.

- [ ] **Step 6: Run the Task 3 focused unit/real-PG files until their first PASS, then never rerun
  them.** Commit `feat: reserve and cancel protected client bookings`.

### Task 4: Strict HTTP, privacy, telemetry and rollback composition

**Files:**

- Create: `apps/api/src/client-booking-principal-resolver.ts`,
  `apps/api/src/client-booking-principal-resolver.test.ts`
- Create: `apps/api/src/routes/client-booking.ts`, `apps/api/src/routes/client-booking.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/api/src/server.ts`,
  `apps/api/src/server.test.ts`
- Modify: `packages/application/src/privacy-service.ts`,
  `packages/application/src/privacy-service.test.ts`
- Modify: `packages/db/src/repositories/privacy-repository.ts`
- Create: `packages/worker/src/client-booking-erasure.ts`,
  `packages/worker/src/client-booking-erasure.test.ts`
- Modify: `packages/worker/src/data-retention.ts`, `packages/worker/src/data-retention.test.ts`,
  `packages/contracts/src/worker-outbox.ts`, `apps/worker/src/main.ts`,
  `apps/worker/src/main.test.ts`, `apps/worker/src/runtime.ts`,
  `apps/worker/src/runtime.test.ts`
- Create: `packages/contracts/src/worker-outbox.test.ts`
- Modify: `packages/observability/src/logger.ts`, `packages/observability/src/logger.test.ts`,
  `packages/observability/src/metrics.ts`, `packages/observability/src/metrics.test.ts`
- Modify: `scripts/run-claw-ci.sh`, `tests/repo/workflow-semantics.test.ts`
- Create: `scripts/assert-client-booking-postgres.mjs`
- Create: `tests/integration/client-booking-privacy.test.ts`,
  `tests/e2e/client-booking-boundary.test.ts`, `tests/repo/client-booking-boundaries.test.ts`

- [ ] **Step 1: Write RED HTTP/composition/privacy tests.** Use raw injection for the exact media,
  charset, no-encoding, de-framed 1,024-octet limit, strict UTF-8, duplicate-key/trailing-byte,
  CL/TE ambiguity, and zero-octet DELETE rules. Cover raw-header occurrence, catalog-read-only
  denial, resolver `401|503`, new/replay statuses, paired absent/foreign choice `404`, changed-owned
  `409`, both cancellation actors as `200`, route/kill-switch matrix, preflight before migration,
  exact no-store headers and UTC timestamps, sentinel redaction, exact finite metric labels, export,
  durable erasure resume/dead-letter, provider-topic non-dispatch, and reserve-off/cancel-on rollback.

```ts
await expectNoRepositoryCall(() => inject({
  method: "POST",
  url: "/v1/client/bookings",
  headers: { authorization: catalogReadOnlyBearer },
  payload: { choiceHandle },
}), 401);
expect(metricLabels()).toEqual([
  { operation: "reserve", outcome: "created" },
  { operation: "cancel", outcome: "replayed" },
]);
expect(Object.keys(metricLabels()[0] ?? {}).sort()).toEqual(["operation", "outcome"]);
```

- [ ] **Step 2: Run RED HTTP/privacy files once.** Expected: FAIL because the route family,
  booking-write resolver, feature flags, public export and redaction do not exist.

```powershell
pnpm exec vitest run apps/api/src/client-booking-principal-resolver.test.ts apps/api/src/routes/client-booking.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts packages/application/src/privacy-service.test.ts packages/worker/src/client-booking-erasure.test.ts packages/worker/src/data-retention.test.ts packages/contracts/src/worker-outbox.test.ts apps/worker/src/main.test.ts apps/worker/src/runtime.test.ts packages/observability/src/logger.test.ts packages/observability/src/metrics.test.ts tests/repo/client-booking-boundaries.test.ts tests/repo/workflow-semantics.test.ts
```

- [ ] **Step 3: Implement the exact route contract and principal seam.** Preserve principal's
  duplicate/folded raw-header rejection and explicit `resolved|denied|unavailable` result. The
  booking resolver proves write scope internally and returns only minimal principal. Map only the
  frozen errors/statuses. Set `Cache-Control: no-store` on every authenticated booking success and
  error response and serialize only finite millisecond UTC instants.

- [ ] **Step 4: Implement pure preflight and kill switch.** Main false registers no routes. Main
  true requires resolver/service/repository and booking-aware catalog capability. Reserve false
  returns `503 feature_disabled` for POST while DELETE remains. Validate before any migration,
  registration or listen call. Keep Planerka and Telegram schemas literal false.
  Preserve the exact local worker allowlist: all four booking topics remain absent from handler
  exports, registry, claim and reconciliation paths under every flag matrix, and provider network
  adapters are never constructed.

- [ ] **Step 5: Implement durable two-phase erasure and fixed telemetry.** The existing privacy
  worker claims the booking-local work row with `FOR UPDATE SKIP LOCKED`, five-minute DB lease and
  fencing token. Phase `cancel_active` uses job/reservation-derived idempotency with existing client
  cancellation. After a locked zero-active proof, release booking locks and run separate
  `cleanup_public`; then mark `complete` so external processor completion may proceed. Lease expiry
  resumes from PostgreSQL state. Five failed claims dead-letter visibly; only approved operator
  requeue resumes. Never hold a choice lock while requesting a booking lock. Test crash between
  phases, partial owner sets, lease expiry, repeated workers and cleanup replay on real PostgreSQL.
  Export only public booking handle/state/time; assert every rendered metric has exactly
  `operation,outcome` from the frozen enums and scan metrics/traces for handle/UUID/time/reason
  sentinels.

- [ ] **Step 6: Add the executable immutable terminal adapter.** Extend `run-claw-ci.sh` with a
  literal `client-booking` mode; it accepts no manifest argument, reuses the pinned-image/host/SHA
  checks, requires a fully clean source including untracked files, requires and forwards the
  already-provisioned `II_TONYA_TEST_POSTGRES_ADMIN_URL` without printing it, and runs
  the fixed `assert-client-booking-postgres.mjs` first to assert `server_version_num = 160015`
  through `pg` with credential-redacted failures. It builds once, then launches one Vitest process
  over the exact Task 5 manifest with `--maxWorkers=1`.
  Evidence records only SHA, image ID, PostgreSQL version, test/file counts, timings, checksums,
  cleanup and `repeat_limit: 1`. Extend workflow semantics tests to freeze mode, manifest, secret
  redaction, clean-source guard and cleanup trap. The local focused test checks script semantics;
  it does not consume the Claw/PG invocation.

- [ ] **Step 7: Run the Task 4 focused suite until its first PASS, then never rerun it.** Run
  affected typechecks, lint, build and `git diff --check` once each; after the first PASS do not
  rerun. Commit `feat: expose private default-off client booking commands`.

### Task 5: Independent approvals and one terminal Claw/PostgreSQL gate

**Files:**

- Create after implementation review:
  `docs/test-evidence/claw/<exact-short-reviewed-SHA>-mvp-client-booking-001/verification.md`
- Modify: `docs/spec/mvp-client-booking-001-progress.md`
- Modify: `docs/spec/mvp-client-booking-001-traceability.md`
- Modify only with new approval facts: `docs/runbooks/client-booking-activation.md`

- [ ] **Step 1: Obtain Product approval.** Record named approver, date, exact spec/contract SHA,
  and verdict for handles, public states, response codes, replay and rollback. No implementation
  or reviewer may self-approve this checkpoint.

- [ ] **Step 2: Obtain independent interface/security review.** Give the reviewer canonical spec,
  both contracts, spine, plan, merged principal/catalog contracts, exact base, and implementation
  diff. Require severity/file/line/evidence for scope separation, handle secrecy, mapping/receipt
  ownership, lock order, state/replay, expiry, privacy, metrics, disabled providers and rollback.
  Resolve every Critical and Important finding. Do not rerun any already-passing suite solely to
  restate evidence; run only the new or changed focused file and stop at first PASS.

- [ ] **Step 3: Run exactly one integrated focused Claw/real-PG invocation.** Use the pinned Claw
  test image and exact clean reviewed source SHA. Build once and run only the immutable manifest
  below with `--maxWorkers=1`. Set
  `repeat_limit: 1`. This is the only total Claw/PG gate invocation for the slice. If PASS, stop.
  If FAIL, retain terminal evidence and keep the slice blocked; do not invoke again under this ID.

```text
tests/integration/client-booking-schema.test.ts
tests/repo/db-schema-parity.test.ts
tests/integration/client-catalog-booking-choice.test.ts
tests/integration/client-booking-repository.test.ts
tests/integration/client-booking-privacy.test.ts
tests/e2e/client-booking-boundary.test.ts
tests/repo/client-booking-boundaries.test.ts
apps/api/src/client-booking-principal-resolver.test.ts
apps/api/src/routes/client-booking.test.ts
packages/worker/src/client-booking-erasure.test.ts
packages/contracts/src/worker-outbox.test.ts
apps/worker/src/main.test.ts
apps/worker/src/runtime.test.ts
packages/observability/src/logger.test.ts
packages/observability/src/metrics.test.ts
tests/repo/workflow-semantics.test.ts
```

The only gate command is run on Claw with the approved external PostgreSQL variable already
provisioned in the environment; the command never expands or prints its value:

```bash
test -n "${II_TONYA_TEST_POSTGRES_ADMIN_URL:-}"
SOURCE_ROOT="$PWD" SOURCE_SHA="$(git rev-parse HEAD)" bash scripts/run-claw-ci.sh client-booking
```

- [ ] **Step 4: Record terminal evidence and cleanup.** Record full/short SHA, image ID, exact
  command, test counts, duration, sanitized checksums, provider flags false, production container
  false, and zero leaked database/container/session resources. Do not record credentials, handles,
  digests, internal IDs, payloads or raw logs.

- [ ] **Step 5: Obtain activation approvals separately.** Security records the live
  `client_booking:write` issuer/verifier evidence. Deployment owner records a separate target
  authorization. Without both, activation stays `BLOCKED` even if implementation and Claw pass.
  Commit evidence locally; push/merge/Actions/deployment require a new explicit command.

## Acceptance proof manifest

| AC | Exact proof |
| --- | --- |
| CBK-AC-01 | `apps/api/src/app.test.ts`: default-off and invalid-capability preflight table |
| CBK-AC-02 | `apps/api/src/client-booking-principal-resolver.test.ts` plus `tests/e2e/client-booking-boundary.test.ts`: raw bearer/scope/outage cases before repository |
| CBK-AC-03 | `tests/integration/client-catalog-booking-choice.test.ts`: exact public snapshot and protected mapping columns |
| CBK-AC-04 | `tests/integration/client-booking-repository.test.ts`: ten-reserver counts and receipt identity |
| CBK-AC-05 | `apps/api/src/routes/client-booking.test.ts`: paired absent/erased/foreign `404`, owned-changed `409`, zero effects |
| CBK-AC-06 | `tests/integration/client-booking-repository.test.ts`: reserve replay counts and original receipt |
| CBK-AC-07 | `apps/api/src/routes/client-booking.test.ts`: client/expert cancelled `200`, owner/missing/foreign behavior |
| CBK-AC-08 | `tests/integration/client-booking-repository.test.ts` and `tests/integration/client-booking-privacy.test.ts`: both-order lifecycle/lease/crash races |
| CBK-AC-09 | `tests/integration/client-booking-repository.test.ts`: database-time 24h/15m/72h/60m boundary table |
| CBK-AC-10 | `tests/e2e/client-booking-boundary.test.ts`, `packages/observability/src/logger.test.ts`, `packages/observability/src/metrics.test.ts`: exact HTTP/framing/cache/time plus sentinel absence and exact labels |
| CBK-AC-11 | `packages/contracts/src/worker-outbox.test.ts`, `apps/worker/src/main.test.ts`, `apps/worker/src/runtime.test.ts`: exact durable rows, booking topics unclaimable, no handler/provider adapter |
| CBK-AC-12 | review files plus the single immutable Claw manifest and terminal evidence directory |

## Plan self-review

- CBK-001–006 map to Tasks 1–3; CBK-007–012 map to Tasks 3–4; CBK-013–018 map to Tasks 4–5.
- CBK-AC-01–12 each has a named focused or one-time real-PG proof.
- Public payloads use only `ch1`, `bk1`, public state and `reservedUntil`; every internal/provider/
  payment authority field is absent.
- Existing catalog v1, principal scope separation, booking state machine, audit/outbox and provider
  disablement remain explicit invariants.
- The migration number is intentionally selected from the post-principal journal at execution;
  the plan contains no frozen numeric claim.
- Successful suites and the one terminal Claw/PG invocation are never repeated.
