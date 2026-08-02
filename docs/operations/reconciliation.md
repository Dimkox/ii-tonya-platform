# Reconciliation

Owner: Operations owner. Reviewer: Finance or product-control owner. Frequency: daily and after every release/rollback.

Checks:

1. Recompute message-ledger and package balances from immutable facts; report any negative or duplicate debit.
2. Compare reservation state with Planerka only after the provider contract is approved; unknown outcomes remain pending, never retried as confirmed failures.
3. Inspect inbox/outbox uniqueness, expired leases, dead letters, and duplicate provider event IDs.
4. Compare Make/Google Sheets projections with PostgreSQL authority; projections may be repaired but never write authoritative state.
5. Assert payments remain disabled and no payment routes, tables, or provider configuration exist.

Local checks: `pnpm exec vitest run packages/worker/src/reconciliation.test.ts tests/integration/message-ledger-concurrency.test.ts tests/integration/outbox-runner.test.ts`. A release receipt must include counts before/after, mismatches, repairs, owner, reviewer, time window, and evidence URI. Any mismatch is NO-GO until resolved or explicitly accepted by the accountable owner.
