# Task 6 PostgreSQL evidence

Date: 2026-08-30
Commit under test: local Task 6 working tree before commit

Focused command:

```bash
corepack pnpm vitest run tests/integration/test-expert-trial-postgres.test.ts
```

Initial Task 6 result: 1 test file, 3/3 passed against a disposable PostgreSQL 17.5 test container.

NO-GO remediation result: the same focused file was run two more times (three total across Task 6 and remediation, the configured maximum). The final run passed 4/4 against disposable PostgreSQL 17.5 after additive migration 0039. Covered: ordered migration through 0039 with no active seed, foreign-key rejection, two-unit concurrent reservation behavior, identical same-key convergence, conflicting-digest denial, provider request metadata, applied transition, unknown retention and explicit reconciliation, and an EXPLAIN JSON lookup for the locked redemption query.

Not claimed: restart durability of trial rows and actual database-role denial. The current bounded testkit does not expose a safe restart/role fixture for this increment; those remain Task 6 follow-up evidence and must be completed before activation or release. No production, staging, provider, credential, or network action was used.

Full verification command (run exactly once in this increment):

    corepack pnpm verify

Result: exit code 2 during the repository typecheck phase. Four errors in the newly added `packages/application/src/test-expert-trial-service.test.ts` were a Task 3 regression and were corrected in the first follow-up. Three unrelated `packages/domain/src/partner-pricing.test.ts` type errors blocked that same run and are now minimally corrected without behavior changes. Full verification remains not passed and was not rerun.

Final focused evidence: application trial service 16/16, memory repository 6/6, Telegram webhook 41/41, server composition 13/13, config 21/21, schema parity 2/2, legal content 4/4, partner pricing 24/24, and PostgreSQL 4/4 passed. Relevant package typechecks and `corepack pnpm exec tsc --noEmit -p tsconfig.tests.json` pass. The public body route is removed; promo dispatch is composed default-off inside authenticated Telegram ingress. Restart durability and actual database-role denial remain unproved activation blockers.
