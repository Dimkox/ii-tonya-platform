# Expert residency referrals operations

Status: **disabled release candidate — staging and production not authorized**

Owner: Release operator. Incident commander: Operations owner. Financial
decision owner: Product owner. Security escalation owner: Security reviewer.

All examples below are **SYNTHETIC-ONLY**. Identifiers, hosts, key references,
and output are placeholders; captured evidence must replace values with
`<REDACTED>` before sharing.

## Release boundary and stop conditions

Deploy code and empty additive schema only while
`EXPERT_REFERRAL_ENABLED=false`, `EXPERT_RESIDENCY_BILLING_ENABLED=false`, and
`PAYMENT_PROVIDER=disabled`. Confirm the durable `expert_referrals` feature
control also has `new_commands_enabled=false` and
`reward_grants_enabled=false`. Stop immediately if a flag is true, a live
provider is configured, a migration hash differs, any reconciliation mismatch
exists, a HIGH/CRITICAL production dependency finding exists, or an approval is
missing. The Release operator records the stop; the accountable reviewer must
approve remediation before another attempt.

Current external gates are **PENDING/BLOCKING**: named human AI spot-check,
independent migration review, independent financial review, exact-SHA hosted CI,
authenticated external sandbox settlement/refund/replay evidence, and explicit
staging authorization. Production authorization is a later separate gate.

## Safe synthetic checks

Use a disposable PostgreSQL instance and synthetic IDs only:

```text
release_sha=<REDACTED>
expert_id=00000000-0000-4000-8000-000000000901
payment_id=sandbox-pay-0001
host=db.synthetic.invalid
```

Run `pnpm verify:expert-residency-release`, then the Database Gate migration,
parity, refund, and three-run concurrency commands. Ordinary suites run once;
every planned repeat gate is count-first and exactly three. Store only counts,
SHA, timestamps, reviewers, and redacted logs.

## HMAC rotation and one-time plaintext

Security reviewer approves a new version reference before rotation. Add the new
secret-managed HMAC key version, retain every version returned by
`activeIssuedCodeKeyVersions()`, switch only the current issuance version, and
verify old issued codes remain valid. Never place key bytes in env examples,
commands, tickets, logs, or evidence. Batch plaintext is displayed once to the
authorized administrator, transferred through the approved secret channel, and
then destroyed; inventory may show only masked suffix and status.

## Kill switch and existing-state work

The Release operator uses an audited dual-person `feature_switch` approval to
turn off new commands. The kill switch must block issuance, redemption,
checkout, and new reward grants. It must not stop authenticated callbacks,
reservation expiry/release, refund/chargeback, debt processing,
reconciliation, or held replay/cancellation for existing state. Do not disable
these workers to simulate rollback.

## Reconciliation, held replay, and financial incidents

Run bounded batches and retain the immutable incident/audit IDs. A
`reconciliation_mismatch` count greater than zero is an immediate NO-GO and
pages Operations plus the financial reviewer. Any `failed` outcome pages
Operations; duplicate-event rate above 1% for 15 minutes is a warning; held
items older than 30 minutes or debt changing without a corresponding reversal
or repayment is a financial incident. Metrics are
`ii_tonya_expert_referral_lifecycle` and
`ii_tonya_expert_referral_operation_duration_ms` with only bounded `module`,
`operation`, `outcome`, and `errorCode` labels.

For held replay, verify settlement-time eligibility, active residency, and no
terminating refund/chargeback before the approved replay. A
`cancelled_by_refund` marker is terminal. For refunds, return captured cash only;
never restore spent referral credit. For debt, trace reversal allocations and
future `debt_repayment` facts; never edit a balance or historical order.

## Database recovery and 500/500 isolation

Take an approved encrypted backup before migration, record its digest and
restore owner, and test restore only in an isolated environment. Recovery is
forward-fix by default; applied migrations and financial facts are never
rewritten. The client `500/500` coupon ledger is separate: no referral job,
query, metric, or recovery action may mutate client coupon tables. Run
`tests/repo/expert-referral-scope-guards.test.ts` to prove the isolation.
