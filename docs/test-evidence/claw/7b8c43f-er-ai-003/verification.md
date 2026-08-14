# ER-AI-003 Claw verification

- Base: `3340fc7e706c64ad0a2de185cd9088f2152ebf44`
- Verified code revision: `7b8c43f45b83541b60808ee631d787498f124079`
- Environment: retained `ii-tonya-test-yookassa` container and app-stack PostgreSQL on Claw
- Production, GitHub Actions, image build, image prune and container deletion: not used
- Gate status: **GREEN — 35 focused assertions passed**

## Build evidence

Local pinned builds passed at the verified revision:

- `@ii-tonya/db`: ESM + DTS **PASS**;
- `@ii-tonya/api`: ESM + DTS **PASS**.

On Claw, the first direct database build produced ESM successfully but its DTS
phase exposed an absent current-source `@ii-tonya/integrations` build. No tests
had run. Direct `/seed` builds then passed for `@ii-tonya/config`,
`@ii-tonya/integrations` and `@ii-tonya/db`, each including ESM and DTS.

## Focused command results

The first focused Vitest invocation selected the new receipt integration test,
receipt persistence boundary, schema/journal parity, scope inventory and default
server lifecycle. Its executed assertions completed with:

- `apps/api/src/server.test.ts`: **9 passed**;
- `tests/repo/expert-referral-scope-guards.test.ts`: **10 passed**;
- `tests/repo/db-schema-parity.test.ts`: **10 passed**;
- `tests/repo/expert-ai-receipt-boundaries.test.ts`: **2 passed**;
- `tests/integration/expert-ai-request-receipts.test.ts`: **4 skipped** in that
  invocation because suite setup failed before assertions.

Initial summary: **31 passed, 4 skipped; 4/5 files passed; duration 10.16 seconds**.
The setup failure was PostgreSQL error `42501`, permission denied to create the
per-run schema in database `postgres` using the container's pre-existing test
URL. This was an environment/fixture failure, not a behavioral assertion failure.

The controller authorized one execution of only the four missing assertions with
an app-stack administrative URL assembled on the host without printing it. The
environment preparation stopped before Vitest invocation because the app-stack
`.env` contained CRLF and could not be sourced by Bash. Under the explicit
no-repeat instruction, that attempt stopped without executing tests.

The controller then parsed the CRLF app-stack `.env` safely with Python, assembled
the PostgreSQL administrative URL without printing credentials, and executed only
the four previously missing assertions at the same reviewed code revision:

- `tests/integration/expert-ai-request-receipts.test.ts`: **1 file, 4 passed**;
- duration: **2.82 seconds**; test execution: **292 ms**.

The non-repeated 31 prior passes plus this focused real-PostgreSQL remediation give
an aggregate exact-revision result of **35 passed**. The code checkpoint gate is
therefore **GREEN**.

## Review, cleanup and release boundary

Independent review at the verified code revision is **APPROVED**, with no
remaining Critical or Important finding. Its one Important finding was resolved
by replacing the fixed test schema with a collision-resistant per-run schema.

After remediation, remote source was restored to `origin/main`; added feature
files, generated config/integrations/database `dist` directories and controller
archives were removed. No Vitest process remained, and the retained container
stayed running.

The named human AI spot-check remains **BLOCKED**. The deterministic ER-AI-001
distribution baseline is unchanged. Live model/provider composition, YooKassa
activation, staging, merge and production remain absent and unauthorized.
