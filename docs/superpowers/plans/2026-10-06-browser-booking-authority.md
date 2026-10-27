# Browser Booking Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a verified client select a slot, reserve it, recover active reservations and cancel through the website.

**Architecture:** Attach an explicit booking grant to the existing cookie session. Reuse transactional booking mutations behind a finite browser bridge; add bounded owner reads for recovery.

**Tech Stack:** Node 24, pnpm 11.9.0, TypeScript, Fastify, PostgreSQL 17.5, Drizzle SQL, Vite and Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-browser-booking-authority-design.md`

**Status:** Owner approved this plan, migration repair prerequisite and native execution
on 2026-10-06 ("Go"). Prerequisite investigation in progress; booking implementation
still waits for a verified migration-baseline solution.

## Global Constraints

- Preserve existing read-only sessions; no automatic backfill or client-selected scope.
- `CLIENT_SESSION_BOOKING_GRANTS_ENABLED` defaults false; reserve disablement must preserve owner reads and cancellation.
- Written consent and electronic signing are not prerequisites; no free-text intake, payments or provider activation.
- Pages contain at most 20 bookings. Catalogue polling is at most ten attempts over thirty seconds.
- Preserve ownership, idempotency, freshness, lead-time and reservation transition rules.
- Do not generate migrations, fabricate snapshot files, add a missing-snapshot exemption or weaken checks.
- At most three PostgreSQL/concurrency invocations per focused file. Preserve exhausted historical budgets; do not rerun a full/multipath suite without authorization.
- One writer per file set; independent reviewer reports findings without editing implementation.

## Review Focus

1. A lost reserve response must lead to owner-list reconciliation, not a second blind mutation (Task 5).
2. Cancellation of the pagination anchor must not make remaining active bookings inaccessible (Task 3).
3. A session change while a request is pending must discard the old account's result (Tasks 4–5).
4. Login replay or a failed grant insert must roll back session, receipt and grant together (Task 2).
5. Pausing reservation creation must not strand users after their old session expires (Tasks 2, 4 and 6).

## Newly discovered prerequisite — requires scope decision

At inspected HEAD `5388baeb61b6593b98119fc66eaff632095d85d0`, the journal ends at
`0039_consent_evidence_grant`. The integrity guard forbids a new snapshot gap AND
pins the newest snapshot to 21. Consequently adding `0040` without a snapshot fails
the gap guard, and adding a genuine new snapshot also requires updating the stale
diff-base assertion. A partial or empty snapshot would falsely imply a valid schema
baseline. The standing contract requires state-based reconstruction, including
accounting for hand-authored SQL objects, tracked in the migration-integrity issue
before attempting repair.

This is not a booking implementation detail that can be silently waived. Recommended
next step: authorize a separate migration-baseline repair investigation, then attach
its independently reviewed output to this plan. No schema repair procedure is
claimed here before establishing how to represent and verify the full database
state. Alternatively the owner can request a different grant-storage design; that
requires a design amendment, not an undocumented workaround.

All tasks below are conditional on that prerequisite being resolved. The next
migration index must be re-read after repair, not assumed to remain 0040.

## Task 1: Durable grant storage

**Files:** `packages/db/src/schema/identity.ts`; next hand-authored migration and matching
`packages/db/migrations/meta/_journal.json`; truthful state metadata from the prerequisite;
new `tests/integration/client-session-booking-grants.test.ts`.

**Interface:** `client_session_booking_grants(session_token_digest)` has a primary key
and FK to `client_sessions.token_digest ON DELETE CASCADE`; membership represents only
booking-write authority and has no independent expiry or owner override.

- [ ] Write failing schema tests: a missing parent fails, duplicate membership fails,
      parent deletion cascades, existing sessions have zero grants after migration.
- [ ] Run `pnpm exec vitest run tests/integration/client-session-booking-grants.test.ts`
      once for RED; establish Docker/environment first. Record run count.
- [ ] Implement the additive schema and SQL with no backfill. Reserve the remaining
      two PostgreSQL runs for integrated Task 2 checks and any necessary correction.
- [ ] Validate actual migration state and integrity under the approved repair procedure.
- [ ] Review and commit only owned files; do not claim the feature complete.

## Task 2: Atomic issuance and fresh authorization

**Files:** `packages/application/src/client-session-service.ts`,
`packages/db/src/repositories/client-session-repository.ts`,
`packages/config/src/env.ts`, `apps/api/src/server.ts`, `.env.example`,
`docs/contracts/client-booking-principal-prerequisite.md`;
new `packages/application/src/client-session-booking-grants.test.ts` and Task 1 tests.

**Interfaces:** Add server dependency `bookingGrantsEnabled?: boolean` to
`createClientSessionService`; add `bookingGrant?: true` to repository issue input.
Absence means no grant. Existing public issue response retains catalog scope.
Add `features.clientSessionBookingGrants` from the new environment flag.

- [ ] Unit assertions: omitted/false capability omits `bookingGrant`; enabled capability
      sends `bookingGrant: true` only after verified proof; malformed proof never calls issue.
- [ ] Run the new application test file alone for RED, implement, then run for GREEN.
- [ ] Extend the issue transaction to insert membership atomically; extend booking
      resolution with explicit membership while retaining the legacy write-scope branch.
      Parent validity and active user remain mandatory for either branch.
- [ ] Add integration assertions to Task 1's file: replay leaves no extra rows; forced
      grant failure leaves no session/receipt; revoked/expired/inactive and old read-only
      sessions deny; disabling issuance preserves already-issued valid membership.
- [ ] Use the remaining bounded PostgreSQL runs; run config-focused tests and typechecks.
      Document that authorization completed before logout may finish afterward.
- [ ] Review and commit issuance, schema and authority evidence together if Task 1
      could not be verified independently within its shared test budget.

## Task 3: Recoverable owner-only active booking pages

**Files:** `packages/application/src/client-booking-service.ts`, application exports,
`packages/db/src/repositories/booking-repository.ts`, `apps/api/src/routes/client-booking.ts`;
new `packages/application/src/client-booking-list.test.ts`,
`apps/api/src/routes/client-booking-list.test.ts`,
`tests/integration/client-booking-list.test.ts`.

**Interfaces:** Add `list(principal, after?: string): Promise<ClientBookingPage>`.
`ClientBookingPage` is `{ bookings: ClientActiveBooking[]; nextCursor: string | null }`;
each item has `bookingHandle`, `state: 'reserved' | 'booked'`, `startsAt`, `reservedUntil`.
Add repository `listOwnedActive({userId, after?: bk1Handle})`; return missing/foreign
anchor identically. Public timestamps are finite canonical UTC strings.

- [ ] Write failing tests for zero/20/21 rows, foreign cursor, inactive anchor, duplicate
      start times, private-field exclusion and invalid timestamps.
- [ ] Run each new focused test separately for RED; PostgreSQL limit is three total runs.
- [ ] Implement stable keyset ordering by receipt creation time plus booking handle;
      resolve an owned anchor regardless of current reservation state, then select
      active rows only with LIMIT 21. Missing/foreign anchors produce identical 404.
- [ ] Expose exact `GET /v1/client/bookings` and optional `after` only; reject repeated,
      malformed and unknown query fields. Authenticate before reading. No-store on all
      outcomes; reserve kill switch does not gate list.
- [ ] Verify GREEN, relevant types/lint, then independent review and commit.

## Task 4: Finite browser booking bridge

**Files:** `apps/api/src/routes/browser-account.ts`, `apps/api/src/app.ts` and server
composition; new `apps/api/src/routes/browser-booking.test.ts`.

**Interfaces:** Add authenticated probe booleans `bookingAvailable` and
`bookingReserveAvailable`, derived from current booking resolution and runtime flags.
Bridge only `/v1/browser/catalog-requests`, its canonical UUID child, `/v1/browser/bookings`,
and its canonical `bk1` child to matching client routes. Pagination is the sole allowed
query exception, `after=<canonical bk1>` on the list route only.

- [ ] Write table-driven rejection tests: duplicate cookie/header/query, foreign Origin,
      wrong CSRF, encoded path tricks, Authorization supplied by browser, body on DELETE,
      old account's CSRF after cookie switch and non-allowlisted targets.
- [ ] Run the focused test for RED; implement strict bridge and capability projection.
      Preserve raw body limits, existing private-read binding and normalized failures.
- [ ] Assert disabled reserve still forwards authorized GET/DELETE; no booking grant
      means booking unavailable without breaking privacy/catalogue access.
- [ ] Run for GREEN, review and commit. Do not activate production flags.

## Task 5: Account booking flow and uncertain-result recovery

**Files:** `apps/web/src/privacy-client.ts`, `apps/web/src/consent-view.ts`,
`apps/web/src/main.ts`, new `apps/web/src/booking-client.ts`,
`apps/web/src/booking-view.ts`, `apps/web/src/booking-client.test.ts`,
`apps/web/src/booking-view.test.ts` and necessary styles.

**Interfaces:** Extend the existing session client with guarded catalogue/list/reserve/cancel
methods using one CSRF state and epoch; do not create a second independent login state.
`BookingClient` owns pending-operation/polling state and uses that shared session client.
`bindBookingActions(root, client)` returns a disposer which stops polling and pending reads.

- [ ] Write failing tests for a ready choice, catalog-only slot, empty catalogue, pending
      poll limits (10/30 seconds), logout disposal, duplicate click, failed reserve response,
      session switch and explicit pagination. Assert no storage or URL holds private handles.
- [ ] Run each new focused file for RED. Implement structured selection, protected-handle
      reserve, active-list reload and explicit cancellation. Label local timezone and deadlines.
- [ ] On uncertain write outcome, block further writes until owner-list reconciliation
      succeeds; require explicit action afterward and retain the same choice for idempotent
      retry. Never replay a write on a 403 recovery or under changed session authority.
- [ ] Pin reserve-versus-confirmed copy, safe errors, keyboard controls and live status
      announcements. Old read-only sessions receive a fresh-login instruction, not silent elevation.
- [ ] Run GREEN, web typecheck/build, independent review and commit.

## Task 6: Integrated verification and controlled release

**Files:** new `tests/e2e/browser-booking-journey.test.ts`,
`docs/runbooks/client-booking-activation.md`, release evidence and `AGENT-STATUS.md`.

- [ ] Add a failing isolated journey fixture: fresh proof -> grant -> catalogue -> reserve
      -> reload list -> cancel, plus old read-only denial and reserve-off fresh-login cancellation.
- [ ] Run the focused journey within its three-run PostgreSQL budget and fix only proven
      failures. No production fixtures or provider calls.
- [ ] Run relevant package typechecks, scoped ESLint/Prettier, builds and `git diff --check`.
      Independently review the whole change, especially authority and rollback boundaries.
- [ ] Run the normal pre-push gate; record exact-SHA external CI/Database Gate outcomes
      honestly. Missing Trust CI remains missing, not replaced by local checks.
- [ ] Re-establish target, signed artifacts and recovery capabilities before a separately
      authorized rollout. Apply additive migration before dependent code. Do not enable
      booking without reviewed configuration, real login evidence and approved real inventory.
- [ ] Verify reserve-off leaves list/cancel/expiry intact, preserve recovery artifacts and
      remove only owned temporary artifacts. Report implemented versus live acceptance separately.

## Handoff

The plan is not executable until the migration prerequisite has a reviewed solution.
Recommended execution after that gate: native implementation in this session, with
an independent final reviewer, because tasks share session and API interfaces tightly.
Retain BMad's durable story contract during execution; no product code has been changed
by preparing this plan.
