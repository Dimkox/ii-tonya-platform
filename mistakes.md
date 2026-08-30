# Mistakes

Residual admission checked API-side B2/B3 flags but not the worker capabilities needed to converge unknown outcomes. The root cause was validating producer readiness without validating the complete asynchronous convergence path; startup gates must cover both enqueue and reconciliation workers.

The trial slice inferred `not_applied` from an expired deadline and omitted B1 consent checks because it modeled reservation state separately from the established messaging trust/delivery authority. Future provider-assisted flows must reuse current consent authority and require an explicit durable delivery/reconciliation fact before releasing reserved value; elapsed time is never proof of non-delivery.

The first remediation treated an HTTP acknowledgement and a direct provider callback as sufficient proof of a one-dialog flow. The root cause was bypassing the existing Telegram delivery and B1/B2/B3 convergence seams; future channel work must trace both ingress identity and the durable user-visible delivery before claiming composition.

The first promo boundary was designed as a standalone HTTP route and accepted `telegramUserId` from its body, while startup treated deterministic and provider activation as one gate. The root cause was composing from the new feature inward instead of extending the authenticated Telegram trust boundary and separating zero-cost deterministic capability from residual provider capability.

Full-verify failures from newly added Task 3 tests were incorrectly labeled pre-existing because failure ownership was not checked against the commit introducing the files. Prevention: classify each diagnostic against `git log -- path` and reproduce it with the narrowest relevant typecheck before writing evidence.

Focused verification omitted `legal-view.test.ts`, leaving a stale policy-heading assertion; the full web suite caught it.

The deployment review checked only the currently served HTML/JavaScript and inferred that there was no analytics requirement. The root cause was failing to inspect Git history, where the approved Yandex Metrika counter already existed and had later been removed by a wholesale `index.html` rewrite.

The prior `human_handoff` charge was hardcoded to `1`, and cross-layer fixtures preserved that assumption. The root cause was deriving the contract from outcome kind instead of the committed ledger delta, so free and legacy paths could not share a truthful 0|1 result contract.

The A1 SDD workspace was treated as wholly disposable even though it contained a tracked task report. The root cause was trusting an earlier “gitignored workspace” assumption without checking `git ls-files` for the exact directory before moving it; the directory was restored immediately.

The first A2.1 aggregate verification was invoked as `corepack pnpm verify`, but nested package scripts call `pnpm` directly and the host had no pnpm shim in `PATH`. The root cause was assuming Corepack propagation into child scripts; verification must install a temporary Corepack shim directory and prepend it to `PATH`.

The A2.1 plan contradicted its own canonical lock order and the implementation lacked an assertion that legacy settlement creates zero maturity rows. That missing invariant allowed legacy lifecycle facts and lease ownership rules to drift until review exposed the defect.

The first B1 gateway slice kept a callback-style claim/record/enqueue fallback and trusted `bot_key` in the payload. The root cause was designing the pure routing seam before binding it to the repository transaction and server composition; the fallback is now explicitly treated as incomplete rather than release-safe.

Reusing the known-hanging Sol/ultra architect profile under this harness caused another non-result. The root cause was ignoring prior harness/model timeout evidence; future architecture reviews should be bounded or use a responsive profile.

Full verification exposed three stale test assumptions after the B3 contract change: config expectations omitted newly added safe-off flags, the B1 HTTP test expected a paid Selarti outbox without constructing the authorized approval/revenue path, and the response route suite created and closed Fastify resources per case, making the `late` case lifecycle-sensitive under parallel load. The root cause was updating implementation contracts without updating characterization fixtures and test resource ownership; the fix centralizes the app lifecycle, seeds approval through the real repository plus settled cash revenue, and asserts every new default-off flag.

The B1 paid-route fixture used independent `clock_timestamp()` calls for MFA and approval lifecycle fields, so PostgreSQL could observe `requester_mfa_verified_at > created_at` and reject the row nondeterministically. The root cause was treating volatile clock calls as one snapshot, assuming the timestamp driver shape, and leaving teardown handles reusable after partial setup; the fixture now normalizes one database timestamp, uses repository-managed approvals, and atomically consumes optional handles during bounded cleanup.

Release slices did not update cross-release characterization and boundary pins. The root cause was treating each release migration as locally complete while shared scope detectors, hashes, journals, and environment fixtures remained on the prior release contract.

The B2 fixture used a 10x tariff and mixed wall-clock approval dates with fixed occurrence dates; full integration teardown also exceeded Vitest's default 10s under concurrent schema cleanup. The root cause was not separating DB-now approval controls from deterministic business fixtures and not sizing the shared teardown budget to measured parallel cleanup.
