# Task 4 report — separate sandbox API runtime

## Status

IMPLEMENTED and locally committed. No push, deployment, production mutation, provider
call, credential use, or production smoke occurred.

## Commits

- `69998e2` — causal RED server, route, and production-isolation tests.
- `0d8a6e8` — isolated sandbox API runtime and remediated architecture guards.
- `98ceae4` — causal remediation RED for executable lifecycle and runtime hardening.

Base: `7f9ec000f6d8cd9737779e2e11e1f5ed4661c227`.

## Delivered

- Added the separate `@ii-tonya/sandbox-api` workspace package and build entrypoint.
- Startup accepts only `II_TONYA_RUNTIME_MODE=sandbox`, rejects enabled live
  integrations and any recognized payment credential key, and verifies the sandbox
  PostgreSQL marker before constructing Fastify.
- Added the fixed inert checkout view plus authenticated request, approve, and transition
  endpoints with strict UUID/opaque schemas, `additionalProperties: false`, and 8 KiB
  body limits.
- Reused the public admin session hashing semantics. Requests and transitions bind the
  requester session, action, payment, version, idempotency key, nonce, and correlation
  identifier to the approved Task 3 workflow.
- Added fixed sanitized `401`, `403`, `409`, `413`, `503`, and `500` responses. The
  checkout URL performs no adapter, workflow, provider, or state mutation.
- Added a recursive static guard that rejects production composition/import or
  instantiation of `createCanonicalExpertResidencyPaymentEventVerifier`. The exact-hash
  pinned integrations index may re-export it, and only sandbox composition/tests may use
  it.
- Kept `apps/api/package.json`, production app composition, routes, server, and runtime
  closure unchanged.

## TDD evidence on Claw

All executable verification ran in the constrained `ii-tonya-test` profile with 1 CPU
and 1 GiB. Image tag:
`ii-tonya-test:7d71646347d560ff2b5d8ebc4c0aad5b48230254`; image ID:
`sha256:a8f8d4bb072b4ef94f5cdf36a077a3be158bc314282c37fe026ffbe468746cb8`.

### RED

The initial three-file command exited 1: all three suites failed collection because
`apps/sandbox-api/src/server.ts`, `routes.ts`, and the production-composition guard did
not exist. This was the intended missing-capability failure.

Package DTS verification then exposed two Task 3 exhaustiveness defects. A dedicated
isolation assertion reproduced the missing shared admin object-type mapping as one failed
test with three passing. The compiler separately rejected sandbox actions leaking into
the normal expert-referral admin repository action union. Both were remediated with the
shared object type plus an explicit sandbox-action exclusion from that production
repository.

### GREEN

- Focused runtime plus adapter regression: 4 files / 25 tests passed.
- Recursive payment scope plus isolation: 2 files / 117 tests passed.
- Final recursive exact-source scope run: 1 file / 113 tests passed.
- Direct underlying package build commands for `@ii-tonya/db`,
  `@ii-tonya/sandbox-payments`, and `@ii-tonya/sandbox-api`: ESM and DTS builds passed.
- Targeted ESLint passed.
- Targeted Prettier passed for new/expanded source and tests. Existing compact DB source
  and the lockfile were intentionally kept as minimal diffs after an accidental bulk
  formatting attempt was reverted.
- `git diff --check` passed before commit.

The ordinary `pnpm --filter ... build` wrapper completed compilation but its configured
post-script injected-dependency synchronization invoked `pnpm install` against the
temporary bind-mounted offline fixture and did not terminate within the bounded command
window. It was stopped, and the exact `tsup` commands from the package scripts were run
directly. No build failure is hidden; the successful ESM/DTS output is recorded above.

## Architecture remediation from recursive gate

The first recursive run was 115/117 and found stale Task 2/3 allowlist/hash pins rather
than runtime defects: verifier source was absent from the allowlist, current integration
index and sandbox manifest hashes were stale, the sandbox package name was misclassified
as a commercial SDK, and the non-relation approval object type was treated as a table.
The guard now uses narrow path-specific exceptions and exact hashes. The rerun passed
117/117 and the final standalone recursive run passed 113/113.

## Cleanup

- Matching test containers: `0`.
- Matching Vitest/tsup processes: `0`.
- Temporary Task 4 source directories: `0`.
- The persistent Claw source and production database were not modified.

## Deferred boundary

Task 6 still owns the built production-image inventory proof that
`@ii-tonya/sandbox-payments` and `@ii-tonya/sandbox-api` are absent. Task 4 proves source,
manifest, route, composition, and recursive static isolation only.

## Final-review remediation (2026-08-13)

- Added a real `node dist/server.js` entrypoint. It constructs and migrates the core and
  sandbox databases, composes the repository, canonical-to-sandbox verifier, adapter,
  admin approval repository and transition workflow, listens on a validated address,
  and closes Fastify plus PostgreSQL exactly once on failure or termination.
- Environment handling is now default-deny for every unsupported `*_ENABLED` key and
  explicitly rejects all known live flags when true. Recognized payment placeholders
  are allowed only as the exact empty string; whitespace/non-empty values and unknown
  payment credential names are rejected.
- Reused `@fastify/rate-limit` with the existing admin policy of 30 requests/minute and
  a sanitized `{ "error": "rate_limited" }` 429 response.

### Remediation TDD and verification on Claw

- Causal RED: the isolation suite rejected the missing `scripts.start`; lifecycle,
  environment and limiter assertions were introduced in commit `98ceae4` before code.
- Focused GREEN: 3 files / 32 tests passed.
- Recursive/static GREEN: 2 files / 118 tests passed (113 scope-boundary plus 5
  sandbox-production-isolation).
- Exact direct builds (no package wrapper, install, or loop): integrations, DB,
  sandbox-payments and sandbox-api ESM+DTS builds all exited 0. The final sandbox API
  artifact was 5.56 MB ESM with a 1.62 KB declaration file.
- Executable entrypoint smoke: starting the built artifact in sandbox mode without its
  required database configuration exited 1 and emitted only
  `sandbox_startup_failed`, proving direct execution and fail-closed startup without
  leaking the underlying fault.
- Commands ran in `ii-tonya-test:7d71646347d560ff2b5d8ebc4c0aad5b48230254`
  with `--cpus=1 --memory=1g`; no production smoke or external provider call occurred.

## Second runtime review remediation (2026-08-13)

- Runtime startup is schema-read-only: it performs no core or sandbox migration and validates the pre-provisioned sandbox marker before returning dependencies or listening. Task 6 exclusively owns schema/bootstrap mutation.
- SANDBOX_HOST accepts only exact 127.0.0.1, 0.0.0.0, ::1, or ::; undefined defaults to loopback and blank/malformed values fail closed.
- Signal cleanup rejection is handled without an unhandled rejection, emits only sandbox_shutdown_failed, and sets exit code 1.
- Claw focused: 3 files / 40 tests; recursive/static: 2 files / 118 tests. Exact sandbox API ESM+DTS build exited 0.
- Executable artifact smoke remains unresolved: the repository's current tsup ESM bundle embeds a transitive CommonJS dynamic require and Node fails before module initialization. Externalizing dependencies reaches the same defect in the existing bundled DB artifact. No install loop or unrelated global build behavior was changed. The fail-closed source path remains covered by executable Vitest lifecycle tests; this is not claimed as a passing built-artifact smoke.
- pnpm-workspace.yaml confirms syncInjectedDepsAfterScripts: [build]; this global injected-dependency synchronization explains the package wrapper behavior. No bounded documented bypass was found, so direct exact tsup evidence is retained.


## Final packaging review (2026-08-13)

- Resource shutdown now attempts Fastify and PostgreSQL cleanup independently exactly once; the regression covers Fastify close rejection while still requiring database close.
- The built-artifact packaging blocker is unresolved without a broader DB/package build change: ESM bundling fails on transitive CommonJS dynamic require; CJS bundling fails because DB and sandbox-payment modules evaluate import.meta-based migration paths and their published exports are import-only. Experimental CJS packaging changes were reverted and production packages were not changed.
- A bounded CJS sandbox build command itself completed, but its artifact could not initialize for the reason above; it is not retained or claimed green.
- Final bounded Claw source gate after reverting packaging was 40/41 because the remote fixture retained the reverted CJS isolation assertion; no further run was made per the stop instruction. Previous source-focused 40/40 and scope/isolation 118/118 evidence remains valid for the read-only runtime; the independent-close test passed within the 40 passing tests.
- Report NUL was replaced with ASCII 0 and saved as UTF-8.
