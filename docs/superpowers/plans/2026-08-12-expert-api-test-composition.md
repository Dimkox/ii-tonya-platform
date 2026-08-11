# Expert API test composition implementation plan

**Goal:** Make the Task 10 expert HTTP boundary reachable through the normal API app in
tests while keeping runtime activation fail-closed and provider-free.

**Requirements:**

- `ERR-API-COMP-001`: absent capability means absent routes.
- `ERR-API-COMP-002`: a complete injected capability registers only the routes enabled
  by the independent referral and residency feature flags.
- `ERR-API-COMP-003`: enabled expert flags without runtime capability fail startup.
- `ERR-API-COMP-004`: no live auth/payment/provider value is invented or enabled.

## Task 1: RED composition tests

Modify `apps/api/src/app.test.ts` (or the existing closest app composition test) to prove
`ERR-API-COMP-001..003`, independent flag isolation, strict additional-field rejection,
8 KiB/413 preservation, and unexpected-error 500 behavior. Run that single test file
and record the expected failures.

## Task 2: GREEN Fastify composition

Refactor `apps/api/src/routes/expert-referral.ts` to export a route-registration plugin
while retaining its standalone builder. Add the optional complete capability to
`AppDependencies`, register it in `buildApp`, and add a bounded startup assertion for an
enabled flag without the capability.

## Task 3: Runtime fail-closed wiring

Keep `server.ts` provider-free. Pass no expert capability under current runtime config;
the startup assertion makes accidental flag activation explicit. Export the new public
types from `apps/api/src/index.ts` only if required by consumers.

## Task 4: Focused verification and evidence

Run only the focused app composition test once after GREEN. Then run relevant API
typecheck/lint only if available without executing the full test suite, followed by
`git diff --check`. Record exact commands and results in the handoff, review the diff,
commit intentionally, and push the existing branch. Do not mark PR #4 ready or enable
staging/production.
