---
title: "Customer interactive demo walkthrough"
type: "feature"
created: "2026-10-09"
status: "in-review"
baseline_commit: "29a01ce7bc386c5d0c052f0ac1a4f24cf0950023"
review_loop_iteration: 0
context:
  - "/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/AGENTS.md"
---

<frozen-after-approval reason="owner explicitly requested clickable demo and delegated technical decisions">

## Intent

**Problem:** Published fictional catalogue is display-only. Owner requires the
customer to click through a working demonstration on the public production site.
Real services, slots and client checkout are unavailable; enabling provider flags
does not implement them. Owner explicitly confirmed catalogue is demo for now.

**Approach:** Publish a separate `/demo` walkthrough with a conspicuous persistent
demo banner. Visitors can choose a fictional service and example time, reserve,
simulate payment, cancel, change illustrative consent, export synthetic state,
clear it and restart. These are browser-local simulations, not production writes.
Expose discoverable links from catalogue and account. No invitation email or
account provisioning is authorized by this increment; the supplied customer email
must never appear in source, public markup, URLs, logs or fixtures.

## Boundaries & Constraints

**Always:** Label every stage and simulated result as demo. Explain that no money
is charged, no actual appointment exists, no real consent is recorded and reload
clears this temporary state. Maintain state only in memory. Use existing site
styles, accessible semantic controls and status announcements. Keep the six
existing fictional catalogue cards display-only; the walkthrough is distinct.
Real catalogue errors/emptiness must remain truthful and separate.

**Ask First:** No ordinary technical checkpoint; owner delegated them. Report
any need for real credentials, personal data, provider calls or genuine financial
authority instead of adding those to this demonstration.

**Never:** Call fetch/XHR/beacon/WebSocket/payment/booking/privacy APIs from the
demo; read or write cookies/localStorage/sessionStorage; collect names, email,
phone, card details or free text; grant real session/consent/financial authority;
claim this feature completes commercial payments or actual erasure; change API,
database, runtime flags, dependency graph or exhausted integration tests.

## I/O & Edge-Case Matrix

| Scenario     | Input / State                                   | Expected Output / Behavior                          | Error Handling               |
| ------------ | ----------------------------------------------- | --------------------------------------------------- | ---------------------------- |
| Entry        | `/demo` or `/demo/`                             | Labelled walkthrough, no authentication             | Defaults explicit            |
| Selection    | One of six fictional services and example times | Summary preserves chosen labels                     | Unknown choices denied       |
| Reservation  | Explicit demo reserve                           | One in-memory booking; repeat does not duplicate    | Disabled or idempotent       |
| Payment      | Existing unpriced demo booking                  | Simulated paid status, no charge                    | No booking means no payment  |
| Cancellation | Reserved or simulated paid                      | Cancelled demo; no claimed actual refund            | Repeat harmless              |
| Consent      | Toggle demo grant / withdraw                    | Local illustrative state only                       | No effect on real account    |
| Export       | Explicit download                               | JSON clearly marked synthetic; no actual identity   | Revoke created object URL    |
| Clear        | Explicit clear demo data                        | Booking and consent reset; status says demo cleared | Not real deletion            |
| Reset/reload | Reopen or reset walkthrough                     | Initial clean state                                 | No restored hidden authority |

</frozen-after-approval>

## Code Map

- `apps/web/src/main.ts` — pathname normalization and route composition.
- `apps/web/src/catalog-view.ts` — real catalogue plus static demo cards; add
  walkthrough link OUTSIDE `[data-demo-catalog]` to preserve existing contract.
- `apps/web/src/consent-view.ts` — shared account markup; add demo link without
  changing authentication or privacy controls.
- `apps/web/src/demo-catalog.ts` — six fictional examples; reuse labels without
  turning these cards into authoritative service records.
- `apps/web/src/styles.css` — reuse existing classes; scoped changes only if needed.
- `apps/web/src/demo-catalog-browser.test.ts` — read-only browser harness example.
  Its run budget is exhausted. Do not run/rename it. New walkthrough behavior
  gets its own focused unit and browser test, not recycled catalogue scenarios.

## Tasks & Acceptance

**Execution:**

- [x] Add isolated demo state/render/bind module and focused unit tests with RED/GREEN.
- [x] Wire `/demo` and links in catalogue/account; preserve real route behavior.
- [x] Add new real-Chrome walkthrough test covering click sequence and isolation,
      actual CSS/mobile layout, cancellation, reset and synthetic export contents.
- [x] Verify relevant builds/types/lint/format/diff and report exact evidence.

**Acceptance Criteria:**

- Given a new visitor, when opening the demo link, then all demonstration actions
  work without real login and all simulated outcomes are clearly labelled.
- Given demo actions, when exercised in Chrome, then no application API call or
  browser persistence occurs and no real account data or email enters the output.
- Given cancellation or reset, when clicked repeatedly, then no duplicate booking
  or simulated payment appears and controls remain usable by keyboard.
- Given the existing site, when demo is added, then real account authorization and
  display-only catalogue cards remain unchanged; no native deploy is required.

## Verification

Use focused new unit tests and at most three invocations of the NEW walkthrough
Chrome test. Do not rerun exhausted catalogue/account/erasure tests. Repository
rules override blanket full-suite instructions. Run web build/typecheck, tests
typecheck, scoped lint/format and git diff --check. Keep failed logs. No external
or production calls, push or deployment by implementer; coordinator owns review,
signed web-only rollout, live smoke and rollback. If a named export differs,
adapt within these boundaries rather than widen scope.

## Spec Change Log

Local implementation evidence and exact live selectors:
[implementer handoff](../../test-evidence/2026-10-09-customer-demo-walkthrough-local.md).
Independent coordinator review and rollout remain pending. New Chrome budget is
3/3 consumed; final invocation passed. No additional invocation of that original
walkthrough test is authorized.

Owner-authorized review patch: make focused status visible, clarify downloaded
file retention and simplified consent/reset copy, and harden the original test's
cleanup/UTF-8 handling without running it. A distinct narrow regression tests
offscreen focus, synthetic same-document lifecycle handlers and export exception
cleanup only; RED then GREEN used2/3 of its separate allowance. It does not prove
actual browser BFCache eligibility. Coordinator owns further review/publication.

Owner clarified current catalogue is demo and requested enabling interactions for
customer review. This supersedes the immediate payment-provider wiring proposal,
not the remaining full-product work.

## Suggested Review Order

- Separate demo entrypoint preserves real account authorization.
  [main.ts:25](../../../apps/web/src/main.ts#L25)
- In-memory transitions provide no booking, payment or consent authority.
  [demo-walkthrough.ts:46](../../../apps/web/src/demo-walkthrough.ts#L46)
- Synthetic export and persistent disclosure distinguish simulation from real data.
  [demo-walkthrough.ts:116](../../../apps/web/src/demo-walkthrough.ts#L116)
- Browser bindings retain accessible controls and reset temporary state.
  [demo-walkthrough.ts:171](../../../apps/web/src/demo-walkthrough.ts#L171)
- Focused regressions cover review findings without replaying exhausted tests.
  [demo-review-regression-browser.test.ts:1](../../../apps/web/src/demo-review-regression-browser.test.ts#L1)
