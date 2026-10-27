# Customer demo walkthrough: implementer handoff

Date: 2026-10-09. Baseline: `29a01ce7bc386c5d0c052f0ac1a4f24cf0950023`.
Branch: `codex/fin-001-client-access-policy`. Changes are uncommitted.
Authority: [approved spec](../superpowers/implementation-artifacts/spec-customer-demo-walkthrough.md).

## Changes and boundaries

`apps/web/src/demo-walkthrough.ts` implements a pure state machine, static view
and browser bindings. `/demo` and `/demo/` use that isolated controller. There
are six fixed service choices, two illustrative times, one unpriced booking,
simulated payment, cancellation, illustrative consent, synthetic JSON download,
clear and reset. Disclosure remains sticky. State exists only in the controller
closure; normal reload and restored-page handlers reset it. No actual identity,
money, appointment or consent authority exists here.

`main.ts` adds the route. `catalog-view.ts` and the shared `consent-view.ts`
markup add discovery links; account authentication and privacy bindings are
unchanged. `demo-catalog.ts` only exports its existing display labels; the six
static cards and their markup remain unchanged. New CSS is scoped to the demo.
New unit and Chrome files cover this walkthrough, not the exhausted scenarios.

No backend, migration, runtime flags, dependency graph, static card behavior or
existing test files changed. No personal contact data was introduced. No external
or production calls, commit, push or deployment were performed. Coordinator's
concurrent `AGENT-STATUS.md` edits and unrelated pre-existing files were preserved.

## Verification and retained logs

### Accepted review patch (latest local evidence)

Status focus now scrolls the announcement into view, preserving its keyboard
focus and live-region semantics. Disclosure, export content and download/clear/
reset messages explain that a downloaded file remains on the device. Cancellation
explains that a full restart also resets demo consent. Consent copy explicitly
calls this a simplified illustration; real account purposes remain separate.
Live selectors and exported field names are unchanged.

The original `demo-walkthrough-browser.test.ts` now registers process termination
at spawn, handles spawn failure/already-exited children, bounds TERM waiting and
escalates to KILL, protects server/temp acquisition and cleanup with nested
finally blocks, drains stderr and decodes CDP output with `setEncoding('utf8')`.
These harness changes are **static-only verified**; the exhausted test was not
run. No claim is made that its newly added fault cleanup paths have executed.

Distinct `demo-review-regression-browser.test.ts` uses the real view/controller
and CSS for exactly three review concerns: clear-button focus must be visible
below the sticky banner; synthetic pagehide/persisted-pageshow events reset the
same document's controller; allocation/download exceptions remove the temporary
anchor and revoke any allocated URL. Booking/consent actions are only fixture
setup for lifecycle assertions. It does not repeat payment, successful download,
route, reload, catalogue or complete-walkthrough scenarios. Synthetic lifecycle
exercise is **not evidence of BFCache eligibility or real browser restoration**.

New logs are under `/tmp/ii-tonya-demo-review.dcU7gy/`:

| Evidence                       | Result                                                                    | Log                                |
| ------------------------------ | ------------------------------------------------------------------------- | ---------------------------------- |
| Added copy/projection unit RED | exit1; new3 failed, prior12 passed                                        | `unit-red.log`                     |
| Unit GREEN                     | exit0; 15/15                                                              | `unit-green.log`                   |
| Narrow Chrome invocation1      | exit1; offscreen focus reproduced; lifecycle and exception cleanup passed | `browser-1-red.log`                |
| Narrow Chrome invocation2      | exit0; 1/1, all three named checks passed                                 | `browser-2-green.log`              |
| Web build                      | exit0                                                                     | `web-build.log`                    |
| Web/tests typechecks           | exit0                                                                     | `web-types.log`, `tests-types.log` |
| First lint                     | exit1; harness session variable needed explicit initialization            | `lint.log`                         |

Narrow browser budget **2/3 used**; original walkthrough **3/3 exhausted**.
No further review, commit, push, deployment, native change or dependency change.

Final scoped lint passed (exit0, `lint-final.log`) after explicitly initializing
the mutable CDP session variable. Final web/tests types passed (exit0,
`web-types-final.log`, `tests-types-final.log`). Scoped Prettier check passed
(exit0, `format-final.log`); `git diff --check` passed. The web build above is
for the final production code; subsequent code edits were confined to the static
harness. All verification processes are terminal. No known implementation blocker;
coordinator owns remaining review and publication.

### Original implementation evidence (historical)

All log filenames below are under `/tmp/ii-tonya-demo-walkthrough.50ZCTe/`.

| Evidence                                                            | Exit/result                                                   | Log                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------- |
| First unit invocation                                               | 1; collection failed because the new module did not yet exist | `unit-first-red.log`        |
| Behavioral RED against typed no-op scaffold                         | 1; 7 failed, 4 passed                                         | `unit-behavior-red.log`     |
| Complete unit RED including discovery links and reset preconditions | 1; 10 failed, 2 passed                                        | `unit-complete-red.log`     |
| Focused unit GREEN                                                  | 0; 12/12                                                      | `unit-green.log`            |
| Chrome invocation1                                                  | 1; demo route absent                                          | `browser-1-red.log`         |
| Chrome invocation2                                                  | 1; incomplete CDP Enter event did not activate reservation    | `browser-2.log`             |
| Chrome invocation3, final                                           | 0; 1/1, 2.94s test / 3.48s total                              | `browser-3-final.log`       |
| Final web build                                                     | 0                                                             | `web-build-final.log`       |
| Final web typecheck                                                 | 0                                                             | `web-typecheck-final.log`   |
| Final tests typecheck                                               | 0                                                             | `tests-typecheck-final.log` |
| Final scoped lint                                                   | 0                                                             | `lint-final.log`            |

Commands: `pnpm exec vitest run apps/web/src/demo-walkthrough.test.ts`;
`pnpm exec vitest run apps/web/src/demo-walkthrough-browser.test.ts`;
`pnpm --filter @ii-tonya/web build`;
`pnpm --filter @ii-tonya/web typecheck`;
`pnpm exec tsc --noEmit -p tsconfig.tests.json`.
ESLint covered the new module/tests and changed TypeScript files.
Scoped `pnpm exec prettier --write` succeeded for changed source/tests/styles
and plan; the final browser harness correction was formatted as well.
`git diff --check` exited0 after the final code changes. No standalone format
check or additional verification was run after the coordinator requested handoff;
the subsequent edits are this report and task/status metadata only.

Chrome invocation2 was a harness defect: `Input.dispatchKeyEvent` was sent with
the logical Enter key but without its text character. Only the test was changed
to send `text: "\r"` and `unmodifiedText: "\r"` (and corresponding Space text),
with explicit active-element and enabled-control assertions. Invocation3 passed
native Enter reservation, Tab to payment and Space activation. No production
behavior was changed to accommodate synthetic keyboard injection.

The final browser run exercised the built production entrypoint and actual CSS,
both URL forms, selection summary, repeat reservation/payment/cancellation,
cancellation before and after payment, consent grant/withdraw, the actual JSON
download and created-URL revocation, repeated clear/reset, clean reload, keyboard
focus, sticky disclosure and no overflow at390px and320px. It blocked and audited
fetch/XHR/beacon/WebSocket/EventSource, cookie access and local/session storage;
all attempt lists were empty. Network requests were only local static resources
and demo documents; runtime exception list was empty. Export matched an exact
synthetic projection with no identity or price fields.

Unit coverage includes every matrix row: clean defaults; all six services and
two fixed times; invalid/incomplete selections; idempotent reservation; payment
prerequisites; cancellation in both booking states; independent consent; synthetic
export; and repeated clear/reset. Existing account, catalogue and erasure tests
were neither changed nor rerun. No full or multi-path suite was invoked.

## Exact live selectors

Open `/demo` or `/demo/`. The entry link from catalogue/account is
`a[data-demo-link][href="/demo"]`, outside `[data-demo-catalog]`.

| Operation or observation | Selector / expected value                                       |
| ------------------------ | --------------------------------------------------------------- |
| Persistent disclosure    | `[data-demo-banner]`                                            |
| Service select           | `[data-demo-service]`, values `demo-1` through `demo-6`         |
| Time select              | `[data-demo-time]`, values `example-morning`, `example-evening` |
| Selection summary        | `[data-demo-selection]`                                         |
| Reserve                  | `button[data-demo-reserve]`                                     |
| Booking result           | `[data-demo-booking]`, attribute `data-state`                   |
| Simulate payment         | `button[data-demo-pay]`                                         |
| Cancel                   | `button[data-demo-cancel]`                                      |
| Consent grant/withdraw   | `input[data-demo-consent]`, checked/unchecked                   |
| Consent result           | `[data-demo-consent-status]`                                    |
| Download                 | `button[data-demo-export]`                                      |
| Clear                    | `button[data-demo-clear]`                                       |
| Restart                  | `button[data-demo-reset]`                                       |
| Accessible announcement  | `[data-demo-status]`                                            |

Choose service `demo-2` and time `example-evening`: summary must preserve
`Коучинг целей` and `Пример дня · 18:00`. Reserve, pay, cancel should transition
`[data-demo-booking].dataset.state` through `reserved`, `simulated-paid`,
`cancelled`. Repeated actions are disabled/idempotent. Clear/reset returns `none`,
empty selections and unchecked consent; reload also starts clean.

Export filename: `ii-tonya-synthetic-demo.json`. Required markers:
`kind: "ii-tonya-synthetic-demo"`, `synthetic: true`, demo disclosure in `notice`.
Top-level fields are exactly `kind`, `synthetic`, `notice`, `selection`, `booking`,
`consent`. A booking contains only service label, illustrative time and status.

## Remaining gates

Local implementation is ready for coordinator review, not a release claim.
Independent adversarial review, signed web-only rollout, live smoke and rollback
remain coordinator-owned. Native is intended to remain `aae05c0`; no native
operation was performed here. There is no exact-commit release evidence for this
uncommitted patch. Real login, commercial booking/payment and actual erasure are
outside this demonstration's scope.

New walkthrough Chrome budget is **3/3 consumed**. Do not rerun, rename or bypass
this logical browser test without explicit additional authorization. No owned
verification process remains running. Temporary Chrome profile/download fixtures
were removed by the test; retained logs remain under the path above.
