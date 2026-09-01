# Mistakes

The repaired Claw gate mounted a linked worktree without its absolute Git common directory, so repository-policy tests failed at `git ls-files` after a successful build. The root cause was validating source visibility but not linked-worktree metadata visibility; the harness now mounts the resolved common Git directory read-only and tests that contract.

The Claw gate assumed that a source-SHA tag and local BuildKit cache made its test image recoverable after the pinned image was deleted. The root cause was relying on mutable apt repositories and host-local cache state; recovery now creates a replacement image from a pushed clean SHA and pins its verified immutable image ID in both gate paths.

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

The partner/trial release changed package validity and added migrations without advancing shared schema, scope-hash, and smoke characterizations; hybrid fixtures also let payment deadlines expire while their business occurrence remained fixed. The root cause was updating vertical feature tests without replaying cross-release contracts and without separating live database lifecycle timestamps from deterministic revenue-window timestamps.

The first cross-release scope repair updated the shared boundary constant but missed a second exact-list characterization in `expert-referral-scope-guards.test.ts`. The root cause was searching by changed migration names instead of enumerating every consumer of `EXPERT_RESIDENCY_ALLOWED_MIGRATION_PATHS` and `EXPERT_RESIDENCY_ALLOWED_RELATIONS`.

The linked-worktree CI repair mounted Git metadata into the main test container but not into its nested Gitleaks container, so the scanner saw an unresolved absolute `.git` pointer after all tests passed. The root cause was validating repository-policy Git access without tracing the same metadata dependency through every nested container boundary.

Gitleaks 8.28 returned success while reporting findings because the gate did not set an explicit finding exit code; once real history access was restored, this could have produced false PASS evidence. The root cause was testing command presence and redaction but not pinning terminal semantics; the gate now fails on findings and ignores only reviewed exact fingerprints for synthetic idempotency keys, placeholder test secrets, and prose.

Running `gh pr merge --delete-branch` from a linked feature worktree completed the server-side squash merge but then failed local cleanup because `main` was checked out in another worktree. The root cause was coupling the irreversible remote merge with checkout-dependent local cleanup; future merges from linked worktrees must omit automatic branch deletion, verify the remote result first, and clean remote/local refs separately.

The first Release C integration run could not see `lifecycle_jobs` because the hand-authored SQL migration was not added to Drizzle's migration journal. The root cause was treating the migration filename as sufficient registration; every manual migration must update and test the journal entry before PostgreSQL integration tests run.

The Task 3 repeat command used the repository runner through Corepack even though that runner spawns a bare `pnpm`, and a later Reaper startup failure triggered teardown against an uninitialized database. The root cause was not tracing executable and resource ownership across child-process/setup boundaries; direct Corepack repeats and guarded teardown now preserve the primary failure.

The first waitlist-worker review-fix test inherited a booked reservation, while the reschedule test asserted an old live status after deliberately mutating it. The root cause was coupling immutable-replay assertions to mutable shared fixture state instead of resetting each transition precondition and checking replay separately from the live projection.

The first immutable reschedule-replay repair edited migration `0040` after that migration had already been committed. The root cause was optimizing for fresh-schema tests without testing the applied-`0040` upgrade path; the repair now uses `0041` and a real PostgreSQL upgrade test.

The first `0041` backfill copied the reservation's current deadline into every historical reschedule fact. The root cause was assuming mutable aggregate state could reconstruct per-command results even though confirmation buffers vary; old facts are now explicitly unrecoverable and cannot return invented data.
