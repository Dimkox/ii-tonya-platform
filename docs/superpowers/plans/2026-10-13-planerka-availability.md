# Planerka Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate real client-booking choices from provider-confirmed available times through the ordinary production worker.

**Architecture:** One cohesive repository/worker/catalogue change. PostgreSQL claims a service refresh and fences its atomic publication; HTTP occurs outside the transaction. Existing account throttling and native transport remain authoritative.

**Tech Stack:** Node24, pnpm11.9.0, TypeScript, Drizzle, hand-authored PostgreSQL17.5 migration, Vitest.

**Spec:** `docs/superpowers/implementation-artifacts/spec-planerka-availability.md`.

## Global Constraints

- Preserve slot UUIDs, times, capacity, reservation history and existing financial rules. Never create or cancel a provider appointment in this work.
- Use existing isolated worktree, branch `codex/planerka-availability-20261013`, baseline `f31d968d4465f31501726f19c8e50c177046bca1`. Main checkout handoffs belong to the coordinator.
- Single BMad implementer executes the cohesive task inline with TDD. No nested agents, commits, push, remote operations, real credentials or provider requests by the implementer. Coordinator owns independent review and release.
- New tests: author RED invocation1 and GREEN invocation2 per file. Reserve invocation3 for the coordinator after review. Do not invoke old exhausted tests, generic suites, pre-push gate, or hidden duplicates of those tests. Typechecks/lint/builds are allowed.
- No dependency changes or `drizzle-kit generate`. Derive metadata by replay/introspection on disposable PostgreSQL17.5. Do not run old migration-state tests indirectly.
- Standing owner delegation covers these ordinary technical decisions and workflow checkpoints; it does not establish human product acceptance or resolve the separate payer-disclosure decision.

## Review Focus

- A newer empty snapshot must defeat an older nonempty response after lease expiry.
- Remapping, disabling or deleting a mapping must invalidate old observations, not relabel them under the new provider identity.
- Retained reserved/booked slots cannot be deleted, moved, given capacity or duplicated into a new offer.
- Stale, occupied and past rows must not poison a different valid catalogue choice or consume its SQL limit.
- The actual default worker factory must run the importer when enabled; disabled configuration must retain its old shape/report.

## Technical decisions

1. Refresh one mapped service per cycle. Use a fixed seven-day UTC window starting at tomorrow's UTC midnight. Persist start/end and the DB observation time with the lease. Request `start=windowStartDate`, `end=windowEndDate`, `timeZone=UTC`, mapped `duration`, `format=range`. Treat the committed window as half-open. The provider docs do not state end-date inclusivity: accept and validate an optional extra end-date bucket, but never publish or invalidate that extra day. This covers the same seven complete days under either end-date convention. Existing catalogue lead time remains24hours.
2. Successful refresh becomes due again after120seconds; failed refresh after30seconds. Use a90second lease, random fencing token, DB clock and one durable service watermark, including empty successful snapshots. Network responses do not set their own observation time. Do not hold a transaction open while waiting or fetching.
3. Before slots: read authenticated profile and event types. Require exact configured account, mapping timezone, one matching type owned by that account, matching both duration fields, `price=0`, `hidden=false`, `requiresConfirmation=false`, no team scheduling and seats absent/null/1. Reuse `PostgresPlanerkaBookingRepository.admitRequest` before every GET; wait2100ms between bounded attempts (maximum3 attempts per GET). Use a separate availability client with5000ms request timeout, keeping the booking client's settings unchanged. On exhausted admission return a fixed diagnostic and leave freshness unchanged. No provider data/URLs/keys in logs.
4. Reuse `planerkaSlotsSchema`; validate canonical UTC date buckets, window bounds and exact mapped duration. Derive a missing/null end solely from that approved duration. Deduplicate identical normalized intervals; reject conflicting intervals with the same start. Validate before opening the publication transaction. Retain existing256KiB transport bound; resource/contract rejection does not mean an empty calendar.
5. New `planerka_availability_refreshes` state is keyed by mapped service. Persist the claimed complete mapping, window, observation timestamp, lease pair, due timestamp and fixed error code. Publication checks the durable claim, unexpired lease AFTER lock acquisition, unchanged mapping and active/verified expert/service. Use consistent mapping -> service/expert -> refresh -> slot locking; bounded statement/lock timeouts. Competing claims use skip-locked selection. Stale fail/defer must not clear a newer claim.
6. Reuse a unique existing Planerka slot for the same service/start/end/capacity1, including legacy rows. Do not replace its UUID or external identity. Reject ambiguous multiple matching rows or ownership/time/capacity conflicts. New rows use a stable SHA256 external identity derived from account/event/start/end. Atomically refresh returned rows and set `observed_at=NULL` only for absent rows belonging to that mapped service/provider inside the committed window. Never delete slots or touch reservations. Valid empty responses still advance the watermark and invalidate the covered observations.
7. A mapping UPDATE changing identity, duration, timezone, verification or enabled state, or DELETE, must atomically clear that service's Planerka observations and invalidate refresh leases. Implement a narrowly scoped SQL trigger with reviewed lock order; no customer data is deleted. Preserve unrelated providers/services and all financial/booking transition triggers.
8. `PostgresCatalogRepository.read` must filter current fresh observations (15minutes), future starts at least24hours away and positive remaining occupancy BEFORE ordering/limit500. Join active/verified expert and active service. Planerka rows additionally need an enabled currently verified duration-compatible mapping. Apply the same Planerka mapping eligibility to `findEligible`; retain its caller-provided minimum lead/window contract. Keep schema-invalid retained data fail-closed, not visible as fabricated availability.
9. Add `PLANERKA_AVAILABILITY_ENABLED=false`. Enabling requires existing recovery capability, API key and account ID; it does not require creation enabled. Emit an optional availability property only when true, retaining existing disabled config shape. Add optional availability job/report fields only when composed; execute after booking recovery/creation so the existing booking runner gets first opportunity at account admission. External failures produce fixed bounded job results without hiding other worker errors.
10. Ordinary `createProductionWorkerRuntimeFactory` constructs the real importer. A narrow optional `planerkaTransport` seam may inject the existing `PlanerkaTransport` for tests into the genuine clients, without changing fixed URL/credentials/authority in production. Do not replace the DB, job or catalogue with mocks in the composition proof.

## Task 1: Ship availability end to end

**Files:**

- Create `packages/db/src/repositories/planerka-availability-repository.ts`.
- Create `packages/worker/src/planerka-availability.ts`.
- Modify `packages/db/src/schema/booking.ts`, `packages/db/src/index.ts`, `packages/worker/src/index.ts`, `packages/db/src/repositories/catalog-repository.ts`.
- Create `packages/db/migrations/0051_planerka_availability.sql`, `meta/0051_snapshot.json`, `state/0051_sql_objects.json`, `state/0051_manifest.json`; extend `meta/_journal.json` contiguously. Preserve every previous SQL byte.
- Modify `packages/config/src/env.ts`, `.env.example`, `apps/worker/src/main.ts`, `apps/worker/src/runtime.ts`.
- Create `packages/worker/src/planerka-availability.test.ts`, `tests/integration/planerka-availability.test.ts`, `apps/worker/src/planerka-availability-runtime.test.ts`.
- Modify `docs/runbooks/planerka-api-client.md`; create `docs/test-evidence/planerka-availability-2026-10-13.md`.

**Interfaces:**

- `PlanerkaAvailabilityClaim`: service ID, account/event IDs, duration/timezone/verifiedAt, lease token, DB observation time, half-open window bounds. The repository also stores these facts and does not trust altered caller fields.
- `PostgresPlanerkaAvailabilityRepository(db).claim(accountId): Promise<PlanerkaAvailabilityClaim | undefined>`.
- `.publish(claim, slots: readonly {startsAt: string; endsAt: string}[]): Promise<boolean>`; false for a stale or ineligible claim, with no mutation. Invalid input/conflict fails without partial publication.
- `.defer(claim, code: fixed diagnostic): Promise<boolean>`; fence before changing due/lease state.
- `runPlanerkaAvailabilityOnce({repository,client,accountId,admitRequest,sleep?}): Promise<{processed:number; published:number; reason?:fixed diagnostic}>`. Production sleep is real, tests inject deterministic advancement. Do not put test-only cleanup methods in production classes.

- [x] **Step1: Write new tests before product changes.** Cover every spec matrix row. Keep DB tests real; use literal synthetic provider fixtures at the transport boundary. Name the break each case catches. Include a retained reservation and stable UUID across refresh; mapping change/deletion; concurrent/stale workers; empty watermark; duration/owner/timezone mismatch; optional inclusive end bucket; rate-limit and provider error without timestamp refresh; catalogue stale/occupied filtering and at least24hour lead. Pin returned catalogue slot/time, not only repository method calls.
- [x] **Step2: Run each new file once for RED.** `pnpm exec vitest run <exact-new-file>`. Use a dedicated PostgreSQL17.5 Docker Compose service through `II_TONYA_TEST_POSTGRES_ADMIN_URL` and existing isolated database testkit; no customer data. Record exact command, time, reason and invocation count. Missing feature is the expected failure; do not silently classify unrelated setup errors as RED.
- [x] **Step3: Implement the single cross-layer task.** Follow technical decisions and existing errors/transaction conventions. New SQL + journal first; derive full snapshot/state via the documented disposable replay/introspection method, never invented or schema-generated metadata. Add new state verification to the NEW integration file, including predecessor link and authoritative catalogue definitions. Do not broaden old test baselines or modify exhausted old tests just to hide regressions.
- [x] **Step4: Run each new file once for GREEN.** Same commands, invocation2, with complete logs. New ordinary-factory test must exercise real DB publication and real catalogue consumption through `runtime.runOnce`, and prove disabled flag prevents calls. If a test still fails, report it and preserve remaining coordinator run; do not consume invocation3 yourself.
- [x] **Step5: Run static checks.** Relevant `pnpm --filter @ii-tonya/{db,worker,config,app-worker} typecheck` separately; `pnpm typecheck:tests`; scoped `pnpm exec eslint <changed-ts>`; scoped `pnpm exec prettier --check <changed-files>`; `git diff --check`. Fix actual errors; no widening unrelated formatting or lint exceptions. Record commands/results in evidence.
- [x] **Step6: Self-review and hand back without committing.** Report changed files, evidence paths, per-file run counts, unresolved failures/risks and exact source hashes. Coordinator performs independent review, final invocation3, commit/RC and separate production-compatible deployment checks. Earlier broad test budgets remain consumed; no CI/Trust CI claim.

## Self-review of plan

One cohesive task owns all shared files/interfaces; no cross-task writer conflict. All nine matrix rows map to Step1 tests. Provider endpoint and account/date validation are preserved in worker tests; real publication/mapping invalidation and retained reservations in PostgreSQL; config and ordinary startup/cycle in factory tests. Existing account rate admission and booking recovery retain ownership. Live access/mappings remain a deployment prerequisite, not replaced with successful fakes.

## Grouped review remediation — coordinator decision 2026-10-13

The three independent reviews were collected before triage. Their grounded findings
are implementation patches to the unchanged intent: preserve booking authority,
bound background work, fence publication and prove the actual consumers. No product
policy or frozen requirement changes. Preserve all passing behavior and existing
history. Do not restart the feature or discard useful code. The same implementer
owns this grouped patch, with NO further Vitest invocation; coordinator run3 remains
reserved after remediation review. Add regressions before their corresponding fix.

Additional permitted files: `packages/db/src/repositories/planerka-booking-repository.ts`
(only a bounded/priority-aware availability admission option using the same limiter,
preserving existing booking admission semantics), `packages/db/src/schema/catalog.ts`
(matching narrow slot lookup index), `packages/observability/src/telemetry-schema.ts`
(one fixed sanitized availability event), `tests/repo/migration-history-integrity.test.ts`
and `tests/repo/migration-state-baseline.test.ts` (exact new state expectations only;
DO NOT run their exhausted tests or broaden frozen historical-gap/bigint baselines).

Required patches and observable regressions:

1. Update newest snapshot to51, actual table count/functions/triggers and provenance
   guard coverage to0051. Derive exact values; do not delete assertions. Extend the
   NEW metadata integration checks as necessary; no old-test invocation.
2. New availability/invalidation locking must not wait while holding a mapping
   lock for rows held by booking approval (which later requests that mapping).
   Use nonblocking ordered row locks (`NOWAIT`/try-lock) and whole-transaction
   rollback on contention for the new paths. Keep existing booking financial/
   notification locking unchanged. Contention is a fixed non-success/retry outcome,
   not a fatal worker loop or a successful publication. Cover real held booking
   resources and mapping invalidation with bounded completion/no deadlock.
3. After locking durable refresh state, recheck current due/lease facts. Condition
   the conflict UPDATE itself so a stale selection cannot steal a newer live lease
   or skip its delay. Return no claim when another owner/delay wins; cover this
   conditional branch on real PostgreSQL as well as ordinary competing claims.
4. Use168 absolute hours for the seven-day UTC window and its SQL CHECK, independent
   of session timezone/DST. Verify a non-UTC session across a DST boundary without
   adding a production clock/test-only setter.
5. Lock/select only service slots with starts inside the publication window plus
   relevant stable external identities anywhere. Preserve ambiguity/ownership checks
   and history. Add a narrow Planerka service/start index if no suitable index exists;
   include its schema declaration/state. Prove an unrelated historical slot lock
   does not obstruct publication.
6. Initial mapping INSERT must invalidate fresh legacy observations as well as
   UPDATE/DELETE; keep source/destination handling for service transfers. Prove no
   unrefreshed legacy choice appears on insertion. Also disable then restore the
   SAME mapping before lease expiry and prove the original publish/defer stays fenced.
7. Both catalogue readers must omit overlaps with active reservations for the same
   expert across different slots/services, not just exact-slot occupancy. Preserve
   same-slot capacity semantics for non-Planerka providers. Cover cross-slot/service
   overlap, expired/cancelled reservations, and otherwise-valid fresh rows with absent,
   disabled, future-verified or duration-incompatible mappings independently of the
   invalidation trigger (do not let null observation mask mapping-eligibility tests).
8. A schema-valid final-day interval that ends beyond the half-open publication
   window is validated but omitted, like the optional end-date bucket. It must not
   poison other valid choices. Invalid duration/buckets still reject the response.
9. Availability must yield durable account admission to outstanding actionable or
   in-flight booking/recovery operations, including their short retry delay. Check
   before each availability GET using the common limiter, not only worker order or
   process memory. Respect creation-disabled semantics; terminal/manual operations
   alone must not disable availability permanently. Bound its admission DB lock wait
   and map contention to fixed non-success without masking unrelated DB failures.
   Prove progress under a refresh backlog and no HTTP when the account row is held.
10. Add ordinary-factory coverage for recovery ON + availability OFF with a valid
    mapping and a synthetic recovery operation. Recovery must still run; no import,
    cache mutation or availability report field may occur. Add factory coverage for
    an exhausted durable account window after preflight: no availability GET or
    freshness mutation, fixed rate-limit result. Do not mock away the limiter.
11. Prove final lease-expiry rollback AFTER slot writes begin, including unchanged
    old observations, no inserted rows and unchanged publication watermark. The
    test must prove it reached that late path, not pass via the earlier expiry guard.
    Use isolated DB synchronization/test fixtures, no production-only test hook.
12. Ordinary factory must emit a fixed sanitized outcome/count event on non-idle
    availability results via the existing logger schema, with no IDs, provider body,
    URLs or secrets. Test the real sanitized output. Document bounded SQL inspection
    of failure counts and last-publication age. Do not build an unrelated monitoring
    service or claim healthy heartbeat means available provider slots.

Regenerate0051 metadata from PostgreSQL17.5 after the final SQL change. Preserve old
SQL bytes. Run static checks including observability and changed guards; no Vitest,
old suites, pre-push gate, commit, push, remote operation or new agent. Report exact
remaining test counts, source hashes and any unresolved issue for coordinator review.
