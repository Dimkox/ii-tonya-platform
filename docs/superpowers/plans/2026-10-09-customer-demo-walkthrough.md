# Customer demo walkthrough implementation plan

> Execute inline from the approved spec using focused RED/GREEN tests. Coordinator owns independent review and release.

**Spec:** [Customer interactive demo walkthrough](../implementation-artifacts/spec-customer-demo-walkthrough.md)

**Baseline:** `29a01ce7bc386c5d0c052f0ac1a4f24cf0950023`

**Architecture:** A pure in-memory state machine and isolated render/bind module.
Reuse the six catalogue labels without changing card markup. Compose `/demo` in
the existing router and add links outside the static catalogue and account controls.
No dependencies, backend changes, persistence, personal input or remote operations.

## Tasks

- [x] Add `apps/web/src/demo-walkthrough.test.ts`; preserve first RED before
      implementing state transitions in `demo-walkthrough.ts`. Cover invalid choices,
      reservation/payment prerequisites, repeated actions, cancellation, consent,
      synthetic export and clear/reset.
- [x] Add render/bind behavior, `/demo` routing in `main.ts`, discovery links in
      `catalog-view.ts` and `consent-view.ts`, and scoped CSS. Keep fixed DOM controls
      and a persistent disclosure; reset memory on restored page navigation.
- [x] Add `demo-walkthrough-browser.test.ts`: real built entrypoint/CSS in Chrome,
      keyboard actions, mobile overflow/banner, both URL forms, reload, no network
      application requests or storage access, and actual downloaded JSON/revoked URL.
      At most three invocations; never run the existing exhausted browser tests.
- [x] Run web build/types, tests types, scoped lint/format and whitespace checks.
      Leave local changes reviewable; record logs and live selectors for coordinator.

## Review focus

Unknown selections cannot become booking labels. Double clicks cannot add bookings
or repay. Cancellation never claims a refund. Clear resets both consent and booking.
Reload/back navigation cannot restore a simulated booking. Disabling an activated
button must preserve usable keyboard focus. Long labels must fit a 320px viewport.
Download content and every visible result must identify the simulation.

## Evidence ledger

Environment check passed Node24.21.0/pnpm11.9.0. Log directory:
`/tmp/ii-tonya-demo-walkthrough.50ZCTe/`.
No subagent tools are available in this implementer session; independent review
remains with the coordinator. Spec test limits override blanket suite instructions.

Unit12/12 passed. Browser invocation1 RED (route absent), invocation2 RED
(CDP Enter omitted keypress text), invocation3 GREEN1/1 after harness-only input
correction. Budget3/3 consumed. Final build, web/tests types and scoped lint all
exited0. Scoped Prettier writes succeeded; git diff --check exited0. No extra
verification invocation after coordinator requested terminal handoff.
Exact selectors, commands and remaining release gates are in
[local evidence](../../test-evidence/2026-10-09-customer-demo-walkthrough-local.md).

## Accepted review patch

Focused status now scrolls into view. Copy distinguishes temporary page state
from retained downloads, warns that full reset also resets demo consent, and
distinguishes the simplified illustration from separate real account purposes.
Unit copy/projection checks RED3/15 then GREEN15/15.

Distinct `demo-review-regression-browser.test.ts`: RED on offscreen status with
synthetic lifecycle and export-error cleanup already passing, then GREEN1/1.
Budget2/3 used; original walkthrough remains3/3 exhausted and was not rerun.
Lifecycle events are synthetic on the existing document, not BFCache eligibility
evidence. Original harness cleanup/UTF-8 changes receive static checks only.
Review logs: `/tmp/ii-tonya-demo-review.dcU7gy/`. No further review or commit.
