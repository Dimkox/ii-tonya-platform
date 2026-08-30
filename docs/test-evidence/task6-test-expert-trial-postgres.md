# Task 6 PostgreSQL evidence

Date: 2026-08-30
Commit under test: local Task 6 working tree before commit

Focused command:

```bash
corepack pnpm vitest run tests/integration/test-expert-trial-postgres.test.ts
```

Initial Task 6 result: 1 test file, 3/3 passed against a disposable PostgreSQL 17.5 test container.

NO-GO remediation result: the same focused file was run two more times (three total across Task 6 and remediation, the configured maximum). The last executed tree passed 4/4 against disposable PostgreSQL 17.5 with the then-separate, never-shipped `0039` draft. Covered at that point: ordered migration with no active seed, foreign-key rejection, two-unit concurrent reservation behavior, identical same-key convergence, conflicting-digest denial, provider request metadata, applied transition, unknown retention and explicit reconciliation, and an EXPLAIN JSON lookup for the locked redemption query.

Third-remediation schema ruling: because neither `0038` nor `0039` shipped remotely and all functionality remains default-off, the `0039` draft was folded into `0038` and its file/journal entry removed. New exact-SHA PostgreSQL cases now cover the folded migration, database prompt authority, provider-ID uniqueness, append-only audit, conflicting outcomes, global unknown-scan `EXPLAIN`, and B2/reconciliation convergence. They are intentionally **not executed locally** because the user-set three-run PostgreSQL budget was already exhausted; these cases require external exact-SHA CI evidence. No PostgreSQL PASS is claimed for the newly added cases.

Not claimed: restart durability of trial rows and actual database-role denial. The current bounded testkit does not expose a safe restart/role fixture for this increment; those remain Task 6 follow-up evidence and must be completed before activation or release. No production, staging, provider, credential, or network action was used.

Full verification command (run exactly once in this increment):

    corepack pnpm verify

Result: exit code 2 during the repository typecheck phase. Four errors in the newly added `packages/application/src/test-expert-trial-service.test.ts` were a Task 3 regression and were corrected in the first follow-up. Three unrelated `packages/domain/src/partner-pricing.test.ts` type errors blocked that same run and are now minimally corrected without behavior changes. Full verification remains not passed and was not rerun.

Third-remediation focused evidence: one-dialog application service 5/5, legacy trial service 16/16, Telegram webhook 41/41, server composition 14/14, config 21/21, schema parity 2/2, repository guards 4/4, reconciliation worker 2/2, legal content 5/5, and traceability 3/3 pass. `corepack pnpm -r typecheck` passes all 13 script-bearing workspace packages. Final test-project typecheck, formatting, diff, and secret-scan evidence is recorded at commit handoff.

The public body route is removed. Deterministic promo is composed default-off in the authenticated client Telegram webhook and emits same-dialogue deliveries. Residual provider admission remains blocked by the unseeded database campaign/prompt, official Selarti contract/privacy fixture, and B1/B2/B3 flags. Approved warmup copy, external execution of the new PostgreSQL cases, restart durability, and actual restricted-role denial remain activation blockers.
