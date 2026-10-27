---
title: Browser booking authority and account journey
type: feature
created: 2026-10-06
status: in-review
baseline_commit: 5388baeb61b6593b98119fc66eaff632095d85d0
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="Owner approved linked design and plan with Go on 2026-10-06">

## Intent

Implement the owner-approved [design](../specs/2026-10-06-browser-booking-authority-design.md)
and [plan](../plans/2026-10-06-browser-booking-authority.md): verified login with an
explicit session-bound booking grant, protected slot selection, reservation,
recoverable active owner bookings and cancellation on the existing website.
The owner also approved the prerequisite migration-state repair and native execution
in this session with independent review. These approvals do not fabricate production
inventory, provider evidence, real-user login or external Trust CI.

## Boundaries & Constraints

Always preserve old read-only sessions, parent-session expiry/revocation, opaque
owner-bound handles, transactional reservation policy and fail-closed defaults.
Grant issuance is server-selected, default off and atomic with verified login.
Do not introduce written-consent/signing prerequisites, free-text intake, financial
mutations, provider activation or synthetic production inventory.
Ask before expanding the approved product or changing business policy. Keep all
existing test-budget constraints and distinguish local evidence from release gates.

</frozen-after-approval>

## Code Map

- `packages/db/migrations/meta`, `packages/db/migrations/state`: database-derived
  state and provenance; no modification to applied migration SQL.
- `packages/application/src/client-session-service.ts`,
  `packages/db/src/repositories/client-session-repository.ts`: issuance and resolution.
- `packages/application/src/client-booking-service.ts`,
  `packages/db/src/repositories/booking-repository.ts`: existing reserve/cancel and new list.
- `apps/api/src/routes/browser-account.ts`: session-bound finite browser bridge.
- `apps/web/src/privacy-client.ts`, `apps/web/src/consent-view.ts`: existing account lifecycle.
- Exact remaining paths, interfaces and assertions are in the approved plan.

## Tasks & Acceptance

- [ ] Restore and independently verify the latest database-derived metadata baseline.
- [ ] Task 1: durable grant storage with truthful state metadata.
- [ ] Task 2: atomic grant issuance and fresh authorization.
- [ ] Task 3: recoverable owner-only active booking pages.
- [ ] Task 4: finite session-bound browser bridge.
- [ ] Task 5: account booking flow and uncertain-result recovery.
- [ ] Task 6: integrated evidence and separately authorized controlled release.

Given an old read session, when it requests booking, then access remains denied.
Given fresh verified login and enabled issuance, when the transaction commits, then
catalogue and explicit booking authority share a revocable parent session.
Given a foreign handle or changed browser session, when a private operation occurs,
then it neither leaks nor mutates another owner's state.
Given an active reservation, when the page reloads or creation is disabled, then the
owner can recover and cancel it. Given uncertain mutation outcome, when recovery
runs, then it reads owner state without automatic write replay.

## Spec Change Log

2026-10-06: Recorded already-approved design/plan as BMad's durable continuation
contract. Native execution selected by the owner takes precedence over the default
implementer-subagent handoff. No intent changes.

## Verification

Use the approved plan's focused commands and limits; evidence is retained in
`.superpowers/sdd/2026-10-06-browser-booking-authority/`. No task is marked done by
documentation alone. The migration prerequisite has independent test files; its
PostgreSQL runs currently use two of three allowed invocations (first rejected the
shared PG16 default, second passed on explicitly isolated PG17.5).

## 2026-10-06 current continuation

Implementation code through Task5 and bounded Task6 journey is in remote RC
`8835f9e1a26287f145c19f231a31e59396a5fc10`. Independent list/bridge/UI reviews and
Chrome corrections are recorded in [journey evidence](../../test-evidence/2026-10-06-browser-booking-journey.md).
The normal pre-push gate passed after exact journal-baseline correction. The earlier
paragraph's baseline test count is historical: migration-state and session-grant PG
budgets are3/3 exhausted. New list/journey PG budgets2/3 each; Chrome account3/3.

Status stays in-review, not done: external exact-SHA CI/Database Gate, real-user login
and approved real inventory are missing. Production remains425e647. Outstanding
nonblocking coverage/UX minors are listed in evidence; no hidden activation occurred.
