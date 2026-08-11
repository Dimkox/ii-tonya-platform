# Reconciliation

Owner: Operations owner. Reviewer: Finance or product-control owner. Frequency: daily and after every release/rollback.

Checks:

1. Recompute message-ledger and package balances from immutable facts; report any negative or duplicate debit.
2. Compare reservation state with Planerka only after the provider contract is approved; unknown outcomes remain pending, never retried as confirmed failures.
3. Inspect inbox/outbox uniqueness, expired leases, dead letters, and duplicate provider event IDs.
4. Compare Make/Google Sheets projections with PostgreSQL authority; projections may be repaired but never write authoritative state.
5. Keep live payment-provider composition disabled until a separately reviewed provider contract and explicit activation approval exist. Provider-neutral expert-residency orders, payment attempts, verified provider-event inbox records, reward grants, ledger entries, allocations, and debt are authoritative PostgreSQL state and must remain reconcilable while live provider access is disabled.
6. Run expert-residency order expiry/release in bounded batches using the database deadline. At `db_now >= payment_deadline`, the pending order expires and reserved referral credit is released exactly once; operators do not extend the order in place.
7. Run held-reward replay only for durable `pending_feature_hold` markers after audited reward re-enable. Replay must recheck the qualifying payment, residency, captured settlement-time eligibility, referral snapshot, refund/chargeback state, and debt before any grant or repayment.
8. Treat expert-residency provider status, amount, currency, or identity mismatch as an incident. Reconciliation records drift but never invents a settlement/refund/reversal transition or creates a second payment identity.
9. Recompute expert referral available credit, reserved credit, expiry, and debt from reward grants plus append-only ledger allocations. Never repair a balance by updating a projection directly.
10. Verify the client coupon `500/500` later-intent remains isolated from expert referral codes, balances, routes, flags, and ledger facts.

Local checks: `pnpm exec vitest run packages/worker/src/reconciliation.test.ts packages/worker/src/expert-residency-expiry.test.ts packages/worker/src/expert-residency-reconciliation.test.ts packages/worker/src/expert-referral-hold-replay.test.ts packages/db/src/repositories/expert-referral-worker-repository.test.ts tests/integration/message-ledger-concurrency.test.ts tests/integration/outbox-runner.test.ts tests/integration/expert-residency-deadline.test.ts tests/integration/expert-residency-hold-replay.test.ts`.

A release receipt must include counts before/after, mismatches, repairs, held-replay outcomes, expiry/release outcomes, owner, reviewer, time window, exact release SHA, feature-control version, and evidence URI. Financial mismatches are NO-GO until resolved through the authoritative state machine or an approved append-only correction. Projection-only mismatches may be repaired only from PostgreSQL authority. Existing-state reconciliation, refund/reversal, expiry/release, and debt processing must not be disabled by the new-command kill switch.
