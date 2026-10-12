# Client Paid Settlement Implementation Plan

> **For agentic workers:** Use the BMad single-implementer handoff and independent review. The owner delegated technical workflow decisions.

**Goal:** Persist a purchased client package and grant its entitlements once after verified payment.

**Architecture:** Separate immutable orders, bindings and settlements from expert billing. PostgreSQL owns atomicity and uniqueness. Provider retrieval and authenticated checkout remain subsequent composition work.

**Tech Stack:** TypeScript, Node24, pnpm11.9.0, PostgreSQL17.5, Drizzle hand-authored SQL.

**Spec:** [Client paid settlement](../implementation-artifacts/spec-client-paid-settlement.md)

## Global Constraints

- Preserve existing cohorts, ledger history, expiry and expert credits.
- No provider calls, paid generation, live migration or payment activation.
- Reject sandbox settlement; never issue spendable credits for test payments.
- At most three runs per focused PostgreSQL file; no exhausted calculation-test reruns.
- No schema-generated SQL or invented migration snapshots.

## Review Focus

- Same payment reused by another order: reject through unique binding.
- Contradictory replay: check immutable payment details before returning prior grant.
- Failure after package insert: roll back all facts, not just settlement.
- Test mode: no usable entitlements even when provider says succeeded.
- Provider timestamps: original capturedAt anchors expiry; pre-order or overflow dates reject.

## Task 1: Atomic order settlement

Files and exact input contracts are in the spec's Tasks & Acceptance.
Consumes domain `getClientPaidPackage` and `clientPaidGrantTerms`.
Produces `PostgresClientPaidOrderRepository` with createOrder, bindPayment and settleVerifiedPayment.

- [x] Write the focused repository test before implementation. Assert start price499900,
      grant500, coupon999800, stable IDs under concurrency and complete rollback on failure.
- [x] Observe RED with the missing repository. Use the existing isolated PostgreSQL helper.
- [x] Hand-author migration0042, schema and repository. Store immutable terms and provider binding.
- [x] Verify every spec matrix row against PostgreSQL17.5; owner authorized invocation4 after budget3/3.
- [x] Build/typecheck DB and typecheck tests; run scoped lint/format.

## Task 2: Migration state and review

- [x] Replay SQL through0042 on a new disposable PostgreSQL17.5 database.
- [x] Introspect into a fresh temporary directory and normalize against PostgreSQL catalogs.
- [x] Record snapshot, SQL-only objects and input-hash manifest; preserve prior states.
- [x] Extend state integrity checks and verify snapshot linkage, constraints and append-only triggers.
- [x] Run independent code, edge-case and verification reviews; fix accepted defects within authorized budget.
- [x] Record exact commands/results and commit the local candidate. No automatic push or deployment.

## Release boundary

Repository completion is not commercial acceptance. Remaining work includes
provider checkout/reconciliation, receipt data, authenticated routes, coupon
spending/refunds and end-to-end recovery evidence before production enablement.
