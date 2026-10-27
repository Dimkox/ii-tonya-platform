---
title: 'Provider-confirmed appointment workflow'
type: 'bugfix'
created: '2026-10-12'
status: 'in-review'
baseline_commit: '690797db64fd80aa1aeccea8003543de470d8c16'
review_loop_iteration: 0
context:
  - '{project-root}/docs/superpowers/specs/2026-10-12-planerka-live-design.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Expert approval currently transitions a reservation directly to booked and emits client confirmation before any calendar result. The worker has no production Planerka workflow. A successful transport test cannot establish a real appointment.

**Approach:** Record expert approval and a durable provider operation together. Create the external appointment once, store its verified UID, then confirm the client. Preserve cancellation and recovery across crashes and ambiguous provider outcomes.

## Boundaries & Constraints

**Always:** PostgreSQL owns booking and operation state. Keep catalogue empty until real inventory is supplied. Preserve the owner's order: local request, expert approval, external creation, client confirmation. Apply existing identity/ownership/version checks. Minimize attendee data. Keep existing cancellation, erasure and expiry paths correct. Changes form one cross-layer deliverable, not an isolated transport release.

**Ask First:** Actual calendar probe target and recipient, if sending a live booking becomes necessary; financial-policy changes; additional invocations of exhausted test files.

**Never:** Invent external holds or successful confirmation no-ops; retry uncertain creation blindly; expose consultation content to the calendar; seed fictitious real experts; restore written-consent signing in the start route; disable recovery merely because new-booking admission is disabled. Factory/Trust CI remains outside scope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Approval | Authorized unexpired reserved booking | One pending operation; no booked status or client confirmation | Reject stale/foreign callback |
| Created | Valid bound provider UID | Persist UID and booked state and confirmation atomically | Reject mismatched provider identity |
| Duplicate approval | Consumed callback or existing operation | No second provider operation | Preserve existing callback semantics |
| Definite rejection | Provider proves booking was not created | Release local claim and offer refreshed availability | Do not report cancellation of an unknown external booking |
| Ambiguous send | Timeout or crash after send admission | Keep durable unknown operation; no new POST | Reconcile or operator resolution |
| Cancellation race | Client cancels while provider create is active | Record cancellation intent; retain returned UID and cancel externally | Never confirm cancelled local booking |
| Restart/disable | Lease expires or new admission disabled | Recover existing operations without duplicate creation | Recovery capability remains enabled |
| Missing mapping | Empty catalogue or invalid event type | No external creation; truthful unavailable view | Never create fake offers |

</frozen-after-approval>

## Code Map

- `packages/domain/src/reservation.ts`: expert_confirm currently maps reserved directly to booked.
- `packages/db/src/repositories/booking-repository.ts`: outboxTopicsFor emits planerka.confirm and client.booking_confirmed together; transitionLocked updates status before publishing. Protected read/cancel and callback paths share this repository.
- `packages/application/src/booking-service.testkit.ts`: duplicates the premature transition in the test double; changing only the fixture cannot fix production.
- `packages/db/src/schema/booking.ts`: existing status enum and callback/version storage; no durable provider UID/operation ledger.
- `packages/db/src/repositories/worker-jobs-repository.ts`: expiry publishes cancellation; must participate in operation recovery.
- `packages/worker/src/outbox-runner.ts`: leased dispatch/unknown-outcome infrastructure is reusable; providerOperationId alone does not persist booking-domain completion.
- `apps/worker/src/main.ts` and `apps/worker/src/runtime.ts`: production worker composition; no Planerka booking handler found.
- `packages/integrations/src/planerka/client.ts`: reviewed provider-native transport, unchanged by this workflow unless a concrete contract defect is found.
- `packages/application/src/client-booking-service.ts`, `apps/web/src/booking-client.ts`, `apps/web/src/booking-view.ts`: only reserved/booked active views today; pending calendar state needs consistent projection.

## Tasks & Acceptance

**Execution:**
- [x] Import the existing paid-policy/settlement prerequisite from `ab4cd4a7d30ccbf4a58997f0aabbe23d45b2f01b` and `068b808989ac64bf9d1111800b155ef70454e0c7`: domain calculation/module tests, DB order repository/schema/tests,0042SQL/journal/snapshot/state artifacts, migration integrity/state tests and their evidence/specification documents. Merge barrel exports without losing current account exports. Preserve source bytes for imported new files and compare every pre0042SQL hash. Do not import historical AGENT-STATUS or overwrite current account implementation. No provider activation or financial-rule alteration. This prerequisite belongs to the owner's full-product goal and removes the lineage dependency; Planerka migration is0043.
- [x] `packages/db/src/schema/booking.ts`, hand-authored next migration and `_journal.json`: add unique reservation-scoped provider operations with mapping identity, request fingerprint, UID, lease, send admission, uncertainty, cancellation intent and bounded recovery state. Resolve migration numbering against payment branch before writing SQL.
- [x] `packages/db/src/repositories/booking-repository.ts`, `packages/application/src/booking-service.ts`: expert approval records pending provider work, not booked. Keep local reserved occupancy until completion; expose approval through the operation projection. Remove unsupported external reserve events.
- [x] `packages/db/src/repositories/planerka-booking-repository.ts`: implement atomic operation claim, pre-send admission, bound completion, cancellation compensation and recovery. Persist completion and client outbox event in the same transaction. Expiry and erasure cannot delete unresolved operations.
- [x] `packages/worker/src/planerka-booking-dispatcher.ts`, `apps/worker/src/main.ts`, `apps/worker/src/runtime.ts`: wire the actual transport, bounded account requests, typed definite/unknown outcomes and recovery. Never interpret lease expiry as proof of no external effect.
- [x] `packages/config/src/env.ts`: separate creation admission from drain/recovery and validate startup capabilities. No flag enabled without working mappings and credential evidence.
- [x] `packages/application/src/client-booking-service.ts`, `apps/api/src/routes/client-booking.ts`, `apps/web/src/booking-client.ts`, `apps/web/src/booking-view.ts`: distinguish expert-approved/calendar-pending from booked, including schema validation and cancellation feedback.
- [ ] Focused domain/application, new provider-operation PostgreSQL, worker and browser tests: cover every matrix row, duplicate completion, stale lease fencing and crash after UID persistence. Use failing tests before implementation; register per-file run counts.
- [x] `docs/runbooks/planerka-api-client.md`: document live mapping preflight, unresolved-operation handling, exact-RC activation and rollback that retains recovery capability.

**Acceptance Criteria:**
- Given no external UID, when expert approval succeeds, then no booked result or client confirmation is observable.
- Given a valid bound external creation, when completion commits, then exactly one confirmation becomes deliverable.
- Given pending creation and concurrent cancellation, when a UID arrives, then compensation is retained and no confirmation is emitted.
- Given catalogue empty, when a user opens booking, then the truthful empty state remains usable without fake offers.
- Given an exact candidate, when deployment review runs, then database compatibility, frontend state, worker recovery and rollback evidence are checked together.

## Spec Change Log

## Design Notes

Execution authority: the owner explicitly delegated implementation and automated workflow checkpoints (always_on), reiterated by the active goal. This is not human product acceptance. The coordinator preserves its uncommitted all-tab audit and AGENT-STATUS changes. The implementer owns only the execution file set above, associated tests, migration journal and this specification; it must not modify the all-tab audit, AGENT-STATUS, financial policy or live state. No push or deployment in this implementation step. Report per-file test invocation counts and do not invoke broad suites containing exhausted tests.

Coordinator dependency resolution: importing the unchanged existing payment prerequisite is authorized within the full commercial-product goal. This is not authority to redesign payments or publish them. The payment repository test has exhausted its authorized run4; preserve its historical evidence and do not rerun it. Inspect `docs/test-evidence/client-paid-settlement-2026-10-10.md` from068b8089 before verification; migration-state previously used2/3. Exact combined-RC evidence remains separate from historical tests. Do not cherry-pick account code already present in this worktree.

Retaining reserved occupancy with an explicit provider-operation projection avoids changing historical enum semantics before migration review. This is not permission to hide pending state from clients. Historical booked rows require audit: do not invent provider UIDs or replay their old creation events.

## Verification

Run `pwsh -File scripts/check-development-environment.ps1 -RequireDocker` before implementation/database checks. Use PostgreSQL17.5. Run each focused file at most3 times and only one multi-path suite per task. Existing Planerka transport tests have exhausted their authorized budget and must not be rerun indirectly. Require relevant typechecks, scoped lint/format, `git diff --check` and independent adversarial review. No hosted CI success may be claimed. Real-provider execution remains unverified until an authorized target and working provider access exist.

## Implementation handoff — 2026-10-12

Local code and migration implementation is present. Frozen intent is unchanged.
Evidence: [local verification report](../../test-evidence/planerka-booking-workflow-2026-10-12.md).
Final focused results:73 passing tests across13 files. The PostgreSQL workflow
file consumed3/3 invocations (setup failure;7/12 pass;16/16 pass). The one
multi-path invocation is consumed. Transport and paid-order exhausted tests
were not rerun. All per-file counts, RED/GREEN distinctions, review findings
and static checks are recorded in the report.

The verification task remains open for independent closure of review fixes and
the incomplete test-first history. Do not label this end-to-end acceptance or
release-ready: production delivery consumers for expert booking requests,
client confirmation and cancellation/expiry are absent. The worker only creates
durable notification events. No fake/no-op handler was introduced. Real
inventory, provider access/mapping evidence, operator resolution tooling and
exact-candidate release/rollback evidence remain gates. No production activation,
commit or push occurred. Coordinator-owned changes were preserved.

## Owner activation authorization — 2026-10-12

The owner explicitly removed the production activation prohibition and requested
activation. This supersedes the earlier no-deployment/no-live-state restriction
for this workflow; it does not change frozen intent, empty-catalogue policy,
financial scope, live-probe target requirements or exhausted test budgets.

Fresh read-only production preflight at14:57UTC found native/web still43a93e2,
healthy services, and HTTPS root/account200 from the server. Production has no
PLANERKA_API_KEY or PLANERKA_ACCOUNT_ID; inspected local Planerka values are
placeholders. There are zero experts, expert services and slots;0043 mapping and
operation tables are absent (42 applied migrations). Required notification
delivery consumers remain absent. Activation is authorized but technically
blocked, not completed. No runtime flag, migration or release was changed.
