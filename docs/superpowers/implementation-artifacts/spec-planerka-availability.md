---
title: "Provider availability in the client catalogue"
type: "feature"
created: "2026-10-13"
status: "done"
baseline_commit: "f31d968d4465f31501726f19c8e50c177046bca1"
review_loop_iteration: 0
context:
  - "{project-root}/AGENTS.md"
  - "{project-root}/docs/superpowers/plans/2026-10-13-planerka-availability.md"
---

<frozen-after-approval reason="owner-delegated implementation; human product acceptance remains separate">

## Intent

**Problem:** The production worker never imports provider slots. Retained stale or occupied rows also poison catalogue availability.

**Approach:** Refresh verified mapped availability in the ordinary worker; atomically publish it to existing slots and expose eligible times through the real catalogue.

## Boundaries & Constraints

**Always:** PostgreSQL owns leases, clock and publication. Use authenticated Planerka GETs, existing account-wide rate admission, bounded responses and verified TLS. Preserve slot identity, reservation history, capacity and financial authority. Recheck the complete mapping and eligibility after network work. Ordinary composition, not an unused helper, is required.

**Ask First:** Live booking/payment targets, financial/privacy-policy changes, or exhausted-test exceptions.

**Never:** Seed fictional real offers; create/cancel meetings; refresh timestamps on failed responses; hold DB transactions across HTTP; remove existing bookings; claim unavailable subscriptions work; add written-signing gates or factory work.

## I/O & Edge-Case Matrix

| State                                                          | Required result                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| Verified mapping and valid response                            | Stable provider-slot identities and fresh catalogue choices   |
| Duplicate response                                             | Same UUIDs; no second slot or changed reservation             |
| Valid empty snapshot                                           | Retire observations only inside its window; preserve bookings |
| Old worker after newer empty snapshot                          | Fenced rejection; no resurrected availability                 |
| Disabled/remapped/deleted mapping                              | Invalidate observations and pending publication               |
| Stale, occupied, past or too-near retained rows                | Omit them; keep other fresh choices visible                   |
| Wrong owner, timezone, duration, seats or event mode           | No publication                                                |
| Malformed, duplicate-conflicting, oversized or failed response | No cache mutation or fabricated freshness                     |
| Disabled flag or absent mapping                                | No availability HTTP calls or seeded inventory                |

</frozen-after-approval>

## Code Map

- `packages/db/src/repositories/catalog-repository.ts`: `read` currently selects stale/occupied rows before limiting; downstream rejects the whole list.
- `packages/db/src/repositories/planerka-booking-repository.ts`: reuse `admitRequest`; mappings already uniquely bind account/event type. Do not change booking operation authority.
- `packages/integrations/src/planerka/client.ts`: existing profile/type/slot transport and fixed limits; no new transport.
- `packages/worker/src/planerka-booking-dispatcher.ts`: profile/mapping validation precedent and existing booking runner.
- `apps/worker/src/main.ts`, `runtime.ts`: compose/run refresh after booking work.
- `packages/db/migrations/0043_planerka_booking_operations.sql`: mapping identity; latest journal index is0050.

## Tasks & Acceptance

- [x] Add `0051_planerka_availability.sql`, journal, database-derived metadata and `schema/booking.ts` declaration: fenced refresh state and mapping invalidation.
- [x] Add `packages/db/src/repositories/planerka-availability-repository.ts`; fix catalogue eligibility filtering; export repository.
- [x] Add `packages/worker/src/planerka-availability.ts`; compose it in ordinary worker and add opt-in config/example documentation.
- [x] Add the three plan-named test files, metadata checks and runbook/evidence. Respect per-file budgets; preserve earlier evidence.

**Acceptance:** Given an enabled reviewed configuration and synthetic provider, when the ordinary production worker cycles, then the real catalogue exposes the returned eligible slot; a later empty refresh removes it without deleting its reservation. Given competing workers or changed mappings, when an obsolete response finishes, then it cannot publish. Given disabled configuration, when the worker cycles, then its previous report and behavior remain unchanged.

## Spec Change Log

## Design Notes

Owner delegated technical workflow checkpoints and execution. This is not human product acceptance. Keep one cohesive DB/worker/catalogue implementation. Implementer must not spawn agents, commit, push or perform remote operations. Coordinator owns review/release. Resolve project-root from THIS spec's containing repository, not the default shell CWD. Use the existing isolated worktree; main checkout has unrelated dirty handoff files.

All three round1 reviews are complete. The plan's grouped remediation section records
the coordinator's bounded patch instructions and limited file-scope additions.
Frozen intent remains unchanged; no code reset or financial-policy change is needed.
Initial GREEN2 precedes those patches. All three files stayed at2/3 until coordinator
final verification:35/35 worker,54/54 PostgreSQL,6/6 ordinary runtime, one run each.

## Verification

Environment check passed2026-10-13. New files: author RED1/GREEN2, coordinator final3 after independent review. All older test budgets remain consumed; no broad suites. Require relevant typechecks, scoped lint/format, whitespace, SQL replay/state checks on isolated PostgreSQL17.5. Live access currently returns `access_denied`; deployment/activation and PG16 compatibility remain separate evidence.

Implementation is done; live provider activation and commercial acceptance are not.
Final3 passed all95 cases on the reviewed source. Each file is now3/3. Two initial
DB setup failures were not behavioral RED evidence. Focused remediation re-review
accepted all12 groups; the final test-only executor fixture was independently
accepted before execution. No hosted CI or Trust CI is claimed. No story_key is
set, so sprint synchronization is intentionally skipped.

## Suggested Review Order

**Ordinary execution and provider boundary**

- Start at the actual worker composition; availability is explicit and opt-in.
  [main.ts:562](../../../apps/worker/src/main.ts#L562)
- Validate provider facts before publishing a bounded, leased snapshot.
  [planerka-availability.ts:76](../../../packages/worker/src/planerka-availability.ts#L76)

**Database authority and catalogue**

- Claim, publish and defer require current durable identity and nonblocking locks.
  [planerka-availability-repository.ts:113](../../../packages/db/src/repositories/planerka-availability-repository.ts#L113)
- Mapping changes invalidate freshness and leases without deleting reservation history.
  [0051_planerka_availability.sql:22](../../../packages/db/migrations/0051_planerka_availability.sql#L22)
- Shared admission yields to actionable booking work.
  [planerka-booking-repository.ts:105](../../../packages/db/src/repositories/planerka-booking-repository.ts#L105)
- Real catalogue readers filter stale, ineligible and overlapping offers before limits.
  [catalog-repository.ts:46](../../../packages/db/src/repositories/catalog-repository.ts#L46)

**Verification and operation**

- Exercise database fencing, identity preservation and derived migration state.
  [planerka-availability.test.ts:1](../../../tests/integration/planerka-availability.test.ts#L1)
- Prove the real factory publishes slots consumed by the real catalogue.
  [planerka-availability-runtime.test.ts:1](../../../apps/worker/src/planerka-availability-runtime.test.ts#L1)
- Keep activation explicit and diagnosis bounded.
  [env.ts:59](../../../packages/config/src/env.ts#L59)
