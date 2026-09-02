# Reconciliation

Owner: Operations owner. Reviewer: Finance or product-control owner. Frequency: daily and after every release/rollback.

Checks:

1. Recompute message-ledger and package balances from immutable facts; report any negative or duplicate debit.
2. Compare reservation state with Planerka only after the provider contract is approved; unknown outcomes remain pending, never retried as confirmed failures.
3. Inspect inbox/outbox uniqueness, expired leases, dead letters, and duplicate provider event IDs.
4. Compare Make/Google Sheets projections with PostgreSQL authority; projections may be repaired but never write authoritative state.
5. Assert payment remains disabled with `PAYMENT_PROVIDER=disabled`.
   Provider-neutral contracts and tables are expected: reconcile
   `expert_residency_payment_attempts` and
   `expert_residency_provider_event_inbox`. Confirm no live payment-provider
   route, adapter, SDK, credential, provider configuration activation, or
   composition exists.

Local checks: `pnpm exec vitest run packages/worker/src/reconciliation.test.ts tests/integration/message-ledger-concurrency.test.ts tests/integration/outbox-runner.test.ts`. A release receipt must include counts before/after, mismatches, repairs, owner, reviewer, time window, and evidence URI. Any mismatch is NO-GO until resolved or explicitly accepted by the accountable owner.

## Expert residency referral projection

While both expert environment ceilings and durable new-command/reward controls
are false, existing-state processing continues. Compare provider-neutral payment
attempts and verified inbox results with orders, cash captured/refunded,
reservation allocations, immutable reward/expiry/reversal/debt facts,
first-settlement/held markers, and residency intervals. A mismatch emits bounded
`ii_tonya_expert_referral_lifecycle{operation="reconciliation_mismatch",outcome="mismatch"}`
telemetry and creates an immutable incident; automatic financial correction is
forbidden.

Operations owns the bounded job, the financial reviewer owns fact acceptance,
and the Release operator owns release evidence. Any mismatch, failed batch,
unexpected provider availability, or client `500/500` table access is NO-GO.
Recovery follows `docs/runbooks/expert-residency-referrals-rollback.md`: drain
existing-state work, reconcile, preserve all facts and applied migrations, and
forward-fix. External sandbox, exact-SHA hosted CI, migration/financial review,
AI spot-check, and staging approval remain **PENDING/BLOCKING** until real linked
evidence exists.
