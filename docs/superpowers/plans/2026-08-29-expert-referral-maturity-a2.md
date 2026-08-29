# Expert Referral Maturity A2 Implementation Plan

> **Execution:** use `superpowers:subagent-driven-development`; exactly one
> `ai_implementer` owns product writes and independent reviewers inspect the exact diff.

**Goal:** Complete Release A by delaying every new qualifying expert referral reward for
30 days, cancelling it on a pre-maturity terminating reversal, and preserving the
existing append-only reversal/debt path after grant.

**Spec:** `docs/superpowers/specs/2026-08-28-free-client-hybrid-platform-v2-design.md`

**Architecture:** A separate `expert_referral_maturities` aggregate owns the financial
clock. `pending_feature_hold` remains only an operational gate on the first-settlement
marker. Settlement creates a pending maturity but no spendable credit. A bounded worker
locks due maturities and rechecks the snapshotted settlement, payment, residency,
referral, abuse, and feature-control facts before granting. Refund and maturity use the
same lock order and serialize on the maturity row. Existing settlements and grants remain
legacy facts and are not rewritten.

## Global constraints

- No production tariff seed, provider activation, credential read, deployment, merge, or
  protected-branch push.
- Use PostgreSQL `transaction_timestamp()` for financial time; caller clocks select work
  only and cannot authorize maturity.
- New migration is additive and journaled; historical ledgers and settled orders are not
  changed.
- Same idempotency key with a different canonical payload is a conflict.
- New financial behavior remains behind the existing referral reward control and fails
  closed when the control or evidence is absent.
- A maturity has one terminal outcome: `granted` or `cancelled`; terminal rows are
  immutable.
- All batches are bounded to `1..1000`; parallel workers use `FOR UPDATE SKIP LOCKED`.

## Lock order (architectural ruling)

For processing rows present in a path, acquire locks in this canonical order:

1. residency order;
2. payment attempt;
3. first-settlement marker;
4. maturity row;
5. experts in UUID sort order;
6. grants by expiry, grant time, and id;
7. ledger rows by id.

Provider inbox identity is acquired before this common financial prefix when present.
Due work is claimed in a short `FOR UPDATE SKIP LOCKED` transaction with a lease;
processing then commits separately in a serializable transaction. Refunds use the same
common prefix, so a terminating refund cancels a pending maturity even after its due time
but before grant processing.

The maturity worker and terminating refund must both lock the same maturity row before
the order/marker/payment facts. A transaction that finds no maturity follows the legacy
path without inventing one.

## Task 1 — Add the maturity schema

**Files:** migration `0033`, migration journal, Drizzle schema/index, DB testkit, migration
upgrade/schema tests.

- [ ] Write RED tests for a separate enum/table with `pending|granted|cancelled`, unique
  first-settlement/order/payment/referral bindings, exact `matures_at = settled_at + 30
  days`, terminal timestamps, bounded reason codes, due index, and append-only terminal
  protection.
- [ ] Add and journal migration `0033_expert_referral_maturity_a2.sql`.
- [ ] Mirror it in Drizzle and test cleanup.
- [ ] Prove 0032→0033 upgrade preserves existing marker/grant/order facts and creates no
  synthetic maturity for historical rows.

## Task 2 — Settlement creates pending maturity, never immediate credit

**Files:** provider inbox repository and tests, settlement contracts/fixtures where
required.

- [ ] RED: a new eligible first settlement creates exactly one pending maturity whose
  authoritative due time is 30 days after settlement, while balance and reward-grant
  tables remain unchanged.
- [ ] RED: duplicate provider settlement returns the same facts and creates no second
  maturity.
- [ ] Remove the immediate grant branch from new settlement processing. Preserve marker
  snapshots and existing settlement/replay compatibility.
- [ ] Emit only non-PII maturity scheduling/audit facts.

## Task 3 — Bounded due-maturity worker

**Files:** expert referral worker repository, provider/referral transaction capability,
worker package/runtime, tests.

- [ ] RED boundary tests: before due no grant; exactly at due grants `100000` minor units;
  retry is idempotent; feature gate off leaves pending; reversed/ineligible evidence
  cancels or remains fail-closed according to the approved state contract.
- [ ] Select due pending rows in deterministic order with `FOR UPDATE SKIP LOCKED`, then
  recheck using database time inside one serializable transaction.
- [ ] Reuse the existing debt-first allocation and append-only reward ledger logic; grant
  expiry remains exactly 365 days after actual grant.
- [ ] Keep feature-hold replay separate: it may clear the operational hold, but it cannot
  bypass `matures_at`.
- [ ] Compose the job in the production worker with bounded counters and fixed-cardinality
  outcome metrics.

## Task 4 — Serialize refund, maturity, reversal, and debt

**Files:** provider inbox repository and focused PostgreSQL concurrency/reversal tests.

- [ ] RED: terminating refund before maturity wins the shared lock, sets maturity
  `cancelled`, and creates no reward or debt.
- [ ] RED: maturity and refund launched concurrently produce exactly one legal serialized
  history, never a duplicate grant.
- [ ] RED: terminating refund after maturity reverses unused grant value; spent value
  produces the existing recoverable debt; duplicate refund/chargeback is idempotent.
- [ ] Apply the common lock order and retain partial-refund behavior unless the payment is
  terminating.

## Task 5 — Release evidence and documentation

**Files:** README, traceability/runbook, focused/e2e/repository guard tests,
`decisions.md`/`mistakes.md` when warranted.

- [ ] Document A2 maturity status and keep client coupons/group events explicitly pending
  later provider-backed releases.
- [ ] Add exact requirement→test traceability and rollback: disable new grants, drain the
  maturity worker, preserve all pending/terminal facts.
- [ ] Run focused RED/GREEN commands after every task, then build, format, deploy checks,
  lint, typecheck, unit, property, serial PostgreSQL integration, contract, security, e2e,
  and production dependency audit.
- [ ] Run independent code, test, security, and release reviews on the exact HEAD. Do not
  claim merge eligibility without the external App-owned exact-SHA Trust CI check.

## Deferred release dependencies

Client `500/500` campaigns and group-event commissions are not part of this increment.
They require the default-off client-service payment settlement/reconciliation boundary
and authoritative event-revenue ingress defined for Release D. Implementing their
ledgers before those producer contracts would create untestable financial authority.
