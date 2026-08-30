# Task 6 PostgreSQL evidence

Date: 2026-08-30
Commit under test: local Task 6 working tree before commit

Focused command:

```bash
corepack pnpm vitest run tests/integration/test-expert-trial-postgres.test.ts
```

Initial Task 6 result: 1 test file, 3/3 passed against a disposable PostgreSQL 17.5 test container.

NO-GO remediation result: the same focused file was run two more times (three total across Task 6 and remediation, the configured maximum). The last executed tree passed 4/4 against disposable PostgreSQL 17.5 with the then-separate, never-shipped `0039` draft. Covered at that point: ordered migration with no active seed, foreign-key rejection, two-unit concurrent reservation behavior, identical same-key convergence, conflicting-digest denial, provider request metadata, applied transition, unknown retention and explicit reconciliation, and an EXPLAIN JSON lookup for the locked redemption query.

Third-remediation schema ruling: because neither `0038` nor `0039` shipped remotely and all functionality remains default-off, the `0039` draft was folded into `0038` and its file/journal entry removed.

The user explicitly authorized one final current-head PostgreSQL exception run:

```bash
corepack pnpm exec vitest run tests/integration/test-expert-trial-postgres.test.ts
```

Result: 1 file, 6/6 passed against disposable PostgreSQL 17.5 in 8.84s (tests 7.03s). It covered folded migration/no active seed, FK/cap and concurrent reservations, exact provider IDs, unknown retention and explicit reconciliation, same-key race convergence, controlled prompt/campaign lifecycle plus append-only lifecycle/trial audit, global unknown-scan `EXPLAIN`, provider-ID uniqueness, and B2 same-dialogue convergence. It also confirms the corrected `unknown_outcome_requires_reconciliation` assertion.

Not claimed: restart durability of trial rows and actual database-role denial. The current bounded testkit does not expose a safe restart/role fixture for this increment; those remain Task 6 follow-up evidence and must be completed before activation or release. No production, staging, provider, credential, or network action was used.

Full verification command (run exactly once in this increment):

    corepack pnpm verify

Result: exit code 2 during the repository typecheck phase. Four errors in the newly added `packages/application/src/test-expert-trial-service.test.ts` were a Task 3 regression and were corrected in the first follow-up. Three unrelated `packages/domain/src/partner-pricing.test.ts` type errors blocked that same run and are now minimally corrected without behavior changes. Full verification remains not passed and was not rerun.

Final-remediation focused evidence includes one-dialog application 5/5, trial ledger repository 6/6, consent authority 4/4, reconciliation 3/3, config 22/22, worker selection 2/2, and schema parity 2/2. Package and test-project typechecks, formatting, diff, and secret-scan evidence are recorded at commit handoff.

The public body route is removed. Deterministic promo is composed default-off in the authenticated client Telegram webhook and emits same-dialogue deliveries only with current messaging consent. Residual provider admission remains blocked by the unseeded database campaign/prompt, official Selarti contract/privacy fixture, current AI consent, and B1/B2/B3 flags. Reconciliation is separately default-off and refuses startup without its repository, durable delivery authority, and metric sink. Approved warmup copy, restart durability, actual restricted-role denial, and independent exact-SHA review remain activation blockers.
