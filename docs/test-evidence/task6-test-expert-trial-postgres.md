# Task 6 PostgreSQL evidence

Date: 2026-08-30  
Commit under test: local Task 6 working tree before commit

Focused command:

```bash
corepack pnpm vitest run tests/integration/test-expert-trial-postgres.test.ts
```

Result: 1 test file, 3/3 passed against a disposable PostgreSQL 17.5 test container.

Covered: migration chain through 0037 and 0038, zero active campaign seed, foreign-key rejection, two-unit concurrent reservation behavior, applied transition, unknown retention and explicit reconciliation, and an EXPLAIN JSON lookup for the locked redemption query.

Not claimed: restart durability of trial rows and actual database-role denial. The current bounded testkit does not expose a safe restart/role fixture for this increment; those remain Task 6 follow-up evidence and must be completed before activation or release. No production, staging, provider, credential, or network action was used.

Full verification command (run exactly once in this increment):

    corepack pnpm verify

Result: exit code 2 during the repository typecheck phase. Four errors in the newly added `packages/application/src/test-expert-trial-service.test.ts` were a Task 3 regression: the test double omitted repository method input parameters (`createOrGetRedemption` and `summary`). Those test-double signatures are now corrected. The remaining three errors are unrelated in `packages/domain/src/partner-pricing.test.ts` (lines 34, 37, 38); full verification remains not passed and was not rerun.

Follow-up focused evidence: `corepack pnpm vitest run packages/application/src/test-expert-trial-service.test.ts` passed 15/15; `corepack pnpm --filter @ii-tonya/application typecheck` passed. `corepack pnpm exec tsc --noEmit -p tsconfig.tests.json` now reports only the three `partner-pricing.test.ts` errors and no application errors.
