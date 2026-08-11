# Expert Residency Referrals Go-Live Addendum

Status: **NO-GO by default**. This addendum extends the platform threat model for expert residency referrals. It does not authorize staging or production.

## Non-waivable boundaries

1. Expert referral codes, balances, reward grants, debt, and residency tariffs are separate from the client coupon `500/500` later-intent. No shared executable coupon/referral domain model is permitted.
2. PostgreSQL owns referral binding, tariff snapshots, credit reservation/spend/release/expiry, provider-event identity, settlement/refund/reversal, reward grants, debt, and audit facts.
3. `EXPERT_REFERRAL_ENABLED=false` and `EXPERT_RESIDENCY_BILLING_ENABLED=false` remain deployment defaults. Live payment-provider composition remains disabled until separately reviewed and explicitly authorized.
4. The kill switch blocks new issuance, redemption, checkout, and reward creation but must not block authenticated existing-state settlement/refund/reversal, expiry/release, reconciliation, debt, or controlled held-reward processing.
5. Plaintext referral codes are returned once only. Persistent lookup material is a versioned keyed digest; inventory is masked. Key rotation is additive by version until all outstanding codes using an old version have expired, been redeemed, or been revoked.
6. The inviter reward is exactly 100000 minor RUB units for the first eligible settled residency payment of the referred expert. A grant expires exactly 365 days after grant time.
7. Referral credit covers at most 50% of a residency tariff. Server/DB code computes price, credit, and cash; the LLM, Telegram, Make, Sheets, or client payload cannot set them.
8. Credit allocation is FIFO by grant expiry. A checkout reservation is released exactly once on expiry. The PostgreSQL deadline wins at `db_now >= payment_deadline`.
9. Refund/chargeback processing never restores spent referral credit. A terminating reversal may reverse the original inviter reward; already-consumed reward becomes debt. Future rewards repay debt before new spendable credit.
10. A settlement captured while reward grants are disabled may create only a durable `pending_feature_hold` marker using settlement-time eligibility facts. Replay is bounded, audited, idempotent, and must recheck payment/residency/refund state before grant or debt repayment.
11. Expert Telegram/API identity is server-derived and reauthorized per command. Callback claims bind expert, operation, object, nonce, and expiry.
12. LLM expert proposals are untrusted typed proposals only. Prompt context may contain server-derived summary/quote facts but no code hashes, provider secrets/payloads, raw ledger entries, payment identity, cross-expert data, or mutation authority.
13. Metrics labels are limited to bounded `module`, `operation`, `outcome`, and approved `errorCode`. Expert IDs, order/payment IDs, codes/hashes, names, and provider payloads are forbidden labels.
14. Reconciliation may observe and report mismatch but cannot invent authoritative payment or ledger transitions.

## Required release evidence

A release remains NO-GO until all of the following refer to the same exact SHA:

- Task 10 expert API/Telegram/prompt focused suite and relevant typechecks pass.
- Task 11 worker/repository/observability focused suite and relevant typechecks pass.
- `tests/e2e/expert-residency-referral.test.ts` passes against real PostgreSQL with synthetic identities and sandbox verified events only.
- Main CI `pnpm verify`, coverage, secret scan, image smoke/scan, and provenance steps pass on a hosted runner.
- Database Gate passes schema parity plus 20x redemption, checkout, settlement, deadline, and held-replay concurrency/stability gates.
- Scope/security tests prove no live payment SDK/network capability and prove the client `500/500` model remains isolated.
- Independent migration review and financial-integrity review are recorded.
- Authenticated sandbox settlement, partial refund, terminating reversal, debt, expiry/release, and held-replay evidence is recorded.
- A named human AI spot-check reviews ERR-FR-027 and ERR-FR-028 prompt/proposal evidence.
- Operations and rollback runbooks are reviewed, including HMAC key rotation, kill switch, reconciliation, held replay, debt investigation, and database recovery.

## Activation boundary

Passing the evidence above creates only a disabled release candidate. Staging requires a fresh explicit authorization naming the exact SHA/configuration and approver. Production requires a separate explicit authorization after staging evidence. Neither approval can be inferred from a merged PR, green tests, a checklist, or this document.

## Immediate NO-GO / disable conditions

Disable new expert referral/residency commands and escalate when any of these occurs: plaintext code or HMAC key exposure; cross-expert access; unverified provider event accepted; settlement after deadline; duplicate reward; unexplained ledger mutation; negative/incorrect debt or credit projection; provider identity/amount/currency/status conflict; live provider call from disabled configuration; prompt/model authority over money; scope-guard bypass; or missing/stale release approval.

Existing-state refund/reversal, expiry/release, reconciliation, and debt processing remain available unless the incident specifically proves those paths unsafe. Recovery follows `docs/runbooks/expert-residency-referrals-rollback.md` and `docs/operations/reconciliation.md`.
