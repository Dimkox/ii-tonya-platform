---
title: Client paid order settlement
type: feature
created: 2026-10-10
status: done
baseline_commit: ab4cd4a7d30ccbf4a58997f0aabbe23d45b2f01b
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="Owner requested continued implementation and delegated technical gates; financial terms unchanged">

## Intent

Persist a client package purchase and settle a verified successful payment exactly
once. Existing expert payments cannot own client purchases. Implement a separate
PostgreSQL repository; the HTTP/provider composition remains a following step.

## Boundaries & Constraints

Use client_paid_v1 from the existing domain module. Persist immutable order terms
(SKU, RUB price, units, coupon value, policy version), user, live/test mode and
client idempotency key. Duplicate creation with identical user/key/SKU/mode returns
the same order; changed payload rejects. The server chooses prices, never callers.

Bind one YooKassa payment ID to one order before settlement; binding is immutable,
unique across orders and modes. A trusted caller must retrieve and verify provider
truth before calling settlement. This repository does NOT authenticate webhooks.
Settlement verifies bound payment ID, metadata order ID, exact amount, RUB, mode,
succeeded status, paid=true and finite capturedAt at or after order creation.
No grants for pending/canceled/test-mode mismatch or unbound payments. Test-mode
orders may be stored/bound but settlement always rejects them: sandbox money must
never create spendable message packages. Reject
malformed UUIDs, IDs, values and invalid/overflow dates with bounded errors.

One transaction inserts the paid message package, positive grant ledger fact,
client coupon grant and immutable settlement linking them. Expiries use original
capturedAt, not processing time. Coupon grants are append-only client facts, never
expert credits. All-or-nothing rollback on any failure. Concurrent exact replays
return the same package/settlement; contradictory payment data rejects even after
settlement. No update of legacy cohorts, existing packages or debit behavior.
Use existing serializable retries and database uniqueness, not process mutexes.

No provider network calls, real checkout/charges, deployment, new feature flags,
new dependencies, coupon spending, refunds or financial-policy changes. No secrets.
Do not enable production payments from repository-level test success.

## I/O & Edge-Case Matrix

| Scenario                                                                 | Expected behavior                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Create start order                                                       | Frozen 499900 RUB-minor price,500 units,999800 coupon-minor |
| Same key/user and same terms concurrently                                | Same order, one row                                         |
| Same key/user with changed SKU or mode                                   | Conflict, no second order                                   |
| Another user's same key                                                  | Independent order                                           |
| Duplicate binding / payment reused on another order                      | Exact replay succeeds / conflict                            |
| Valid bound succeeded payment                                            | One package, grant fact, coupon grant, settlement           |
| Concurrent repeated settlement                                           | Same result, no duplicate grants                            |
| Wrong amount/currency/mode/order/payment/status/paid flag, or test order | Reject without grants                                       |
| Changed capturedAt on replay                                             | Conflict; never extend original expiry                      |
| Missing, invalid, pre-order or overflowing capturedAt                    | Reject without grants                                       |
| Failure inserting coupon grant                                           | Roll back package, ledger and settlement                    |
| Update/delete immutable purchase facts                                   | Database rejects                                            |

</frozen-after-approval>

## Code Map

- `packages/domain/src/client-paid-policy.ts`: approved SKU and expiry calculation;
  use packaged domain exports, do not edit or rerun its exhausted focused test.
- `packages/db/src/repositories/message-repository.ts`: withSerializableRetry.
- `packages/db/src/schema/billing.ts`: existing package/ledger constraints.
- `packages/db/migrations/0016_task17c_admin_workflows.sql`: paid grant provenance;
  inspect triggers before inserts. Never modify existing migration files.
- `packages/db/src/repositories/client-commercial-policy-repository.ts`: SQL
  transaction/locking pattern; keep existing cohort assignments unchanged.
- `packages/db/src/testkit/postgres.ts`: startTestPostgres and createUser fixtures;
  inspect just relevant helpers. External test DB helper supports isolated DBs.
- `packages/db/migrations/meta/_journal.json`: next index42, hand-written migration.
- `docs/operations/migration-state-baseline.md`: new snapshot must derive from
  isolated PostgreSQL17.5, not schema generation. Coordinator owns snapshot step.

## Tasks & Acceptance

- [x] Add `packages/db/src/repositories/client-paid-order-repository.test.ts`
      first; observe RED, then exercise matrix on real isolated PostgreSQL17.5.
- [x] Add `0042_client_paid_orders.sql` and contiguous journal entry. Model
      immutable orders, payment bindings, coupon grants and settlements with required
      FKs, positive amounts, exact supported version/SKU terms and unique keys.
      Reuse reject_append_only_change for UPDATE/DELETE guards. Never weaken guards.
- [x] Add `schema/client-paid-orders.ts`, export through schema index and add
      `repositories/client-paid-order-repository.ts` plus DB public exports.
      Expose createOrder({userId,packageCode,mode,idempotencyKey}),
      bindPayment({orderId,providerPaymentId}), settleVerifiedPayment({orderId,
      providerPaymentId,metadataOrderId,amountMinor,currency,mode,status,paid,capturedAt}).
      Use explicit typed outputs carrying stable order/package/coupon identifiers.
- [x] Coordinator derives snapshot0042 with supplement/manifest and adds state
      validation, without overlapping implementer's files.
- [x] Verify build/typechecks, focused integration, scoped lint, formatting,
      whitespace and independent review; record remaining activation work.

Given matching confirmed payment, settlement commits all grant facts once. Given
a repeated or conflicting notification, balances and expiry cannot increase.
Given a failed transaction, no partial entitlement survives. Existing financial
history and provider settings remain unchanged.

## Execution and Verification

Single implementer owns only new repository/test/schema/SQL, their index exports
and journal entry. Coordinator owns spec/status, migration snapshot/state evidence
and repo integrity inventories. Do not edit coordinator files or commit/push.
Do not spawn agents. Use apply_patch. Environment check with RequireDocker passed.
Use isolated PostgreSQL17.5 evidence; Docker Compose must be available as checked
above. Reuse the existing local test container, creating separate disposable
databases. Never print credential-bearing environment. At most3 invocations of
the new PostgreSQL test including RED; no broad/multipath/full suite. Preserve
at least one invocation for corrections where possible. Report exact commands.
Run domain build if required, DB build/typecheck, tests typecheck and scoped lint.
No drizzle-kit generate, fake snapshot, new snapshot gap or dependency install.
If schema support creates ambiguity, report it instead of weakening invariants.

## Spec Change Log

## Design Notes

Separate immutable order, binding and settlement facts avoid rewriting purchase
history. Existing message ledger remains balance authority. Coupon grant storage
does not implement coupon spending. Test orders cannot grant real entitlements.

## Verification Outcome

Local implementation only; no release or commercial-completion claim. All matrix
rows exercised by14 passing PostgreSQL tests in the single owner-authorized extra
invocation4. Original3-run budget exhausted; no further reruns authorized.
Independent state reconstruction passed2/2, integrity tests14/14, DB build and
DB/tests typechecks, scoped lint/format and whitespace passed. Three independent
review layers completed; accepted coverage fixes passed and the verification-gap
reviewer confirmed closure. Known integration limitations and exact commands:
[evidence](../../test-evidence/client-paid-settlement-2026-10-10.md).

## Suggested Review Order

- Start with the trusted payment boundary and atomic grant transaction.
  [client-paid-order-repository.ts:164](../../../packages/db/src/repositories/client-paid-order-repository.ts#L164)
- Review immutable purchase terms and unique payment ownership.
  [0042_client_paid_orders.sql:1](../../../packages/db/migrations/0042_client_paid_orders.sql#L1)
- Check database ownership, value and expiry integrity for completed settlements.
  [0042_client_paid_orders.sql:78](../../../packages/db/migrations/0042_client_paid_orders.sql#L78)
- Inspect four-SKU settlement coverage and replay invariants.
  [client-paid-order-repository.test.ts:209](../../../packages/db/src/repositories/client-paid-order-repository.test.ts#L209)
- Inspect rollback at both final persistence boundaries.
  [client-paid-order-repository.test.ts:371](../../../packages/db/src/repositories/client-paid-order-repository.test.ts#L371)
- Confirm independent migration reconstruction and state linkage.
  [client-paid-migration-state.test.ts:1](../../../tests/integration/client-paid-migration-state.test.ts#L1)
