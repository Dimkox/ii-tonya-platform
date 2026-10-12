# Expert payment received after order expiry or credit invalidation

## Pending extension: credit invalidation

A separate verified defect can invalidate a pending order when its reserved
referral credit is reversed. The approved correction uses failed status with
durable reversal provenance, not a fabricated payment deadline or provider refund.
Such a subsequent paid event must be preserved and displayed as a distinct
operator exception. Implementation/review/verification of this extension are
pending; the earlier22 API/10 DB passing cases do not cover it.

The in-progress source now defines these distinct reason/result pairs:

| Operator reason                                   | Provider inbox result                 | Order state                                   |
| ------------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| `expert_residency_paid_after_deadline`            | `EXPERT_RESIDENCY_PAYMENT_EXPIRED`    | `expired`                                     |
| `expert_residency_paid_after_credit_invalidation` | `EXPERT_RESIDENCY_CREDIT_INVALIDATED` | `failed`, with bound credit-reversal evidence |

These are candidate identifiers, not evidence that the extension passed review,
tests or deployment. A generic failed order without bound reversal evidence must
not be classified as this exception. The correction contract is
`docs/superpowers/implementation-artifacts/expert-credit-invalidation-fix.md`.
No compensation, historical ledger repair or refund is authorized by this note.

The first correction did not cancel a pending order funded by an older grant
replenished through a reversed debt-repayment benefit. The revised path and exact
payment-invalidation provenance passed scoped independent source review. Its
five added regressions remain unrun, along with the rest of the87-case candidate.
Do not read source acceptance as a passing PostgreSQL or production gate.

Status: candidate procedure. Support list/detail and outer API forwarding passed
focused local tests; published end-to-end verification is pending. This document
does not activate a payment provider or
authorize a refund, additional charge, manual balance edit or production change.

## What this case means

The provider reported a verified payment, but the local order cannot activate
residency because its payment deadline elapsed or its reserved referral credit
was invalidated. Keep these causes distinct. An expired or failed order is not evidence
that no money was received. A rejected settlement inbox entry is not a provider
refund. Releasing internal referral credit does not return the cash payment.

The same handling applies whether the expiry worker ran first or settlement
waited on a lock until after the deadline. Both paths must preserve the verified
provider event and create a discoverable unresolved operator signal.

## Before processing

Use an authenticated support session with fresh MFA. Do not use a customer's
session, a public error endpoint, or a production database connection as a
substitute for the protected operator view. Do not paste tokens, customer contact
details or raw provider payloads into chat, issue trackers or application logs.

The current candidate exposes the following read-only routes. They are not yet
release-verified; their presence in source does not prove published availability.

- `GET /v1/admin/expert-residency/late-payments?limit=25` lists open cases.
  `limit` is required and must be an integer from1 through100. Optional `status`
  accepts `open` or `resolved`; omitted means `open`.
- Continue a page with both `beforeCreatedAt` and `beforeId`, copied unchanged
  from the final item. Preserve all six fractional timestamp digits. Ordering is
  descending creation time, then descending ID. Do not derive a cursor from a
  browser Date value, which drops PostgreSQL microseconds.
- `GET /v1/admin/expert-residency/late-payments/{errorId}` returns the payment
  detail bound to that operational error. An absent or mismatched binding returns
  not-found, not a successful resolution.

Use the existing admin authorization mechanism. Responses must carry
`Cache-Control: no-store`, including errors. Authentication failure, denied role
or stale MFA is not evidence that the case list is empty. Missing query wiring
must fail closed. Until these routes and their real application wiring are
verified, this procedure is not an operable commercial-review gate.

## Triage

1. Open the unresolved late-payment signal and its bound payment detail. Confirm
   the binding exists; missing or conflicting evidence remains unresolved.
2. Match the exposed inbox reference, internal order, provider, payment identity,
   exact cash amount and currency. Authentication and binding to the original
   provider event are checked server-side; this view does not expose the event
   identity or verification reference. Do not infer a match from a customer
   screenshot, redirect URL or matching amount alone.
3. This view does not display entitlement or per-grant ledger history. Do not
   claim to have checked them from the payment detail. If those facts are in
   dispute, leave the case open for investigation through a separately approved
   financial inspection procedure. The implementation must expire the order
   without granting residency or referral reward and release reserved credit
   once to its original grants; focused integration evidence checks these
   invariants. That evidence does not prove the state of an individual live case.
   For the credit-invalidation case, the intended correction instead fails the
   pending order and releases its outstanding reservations across the original
   grants. It must not activate residency or rewrite an already settled order.
   This extension still needs its own passing evidence. Internal credit release
   is distinct from cash refund status.
4. Re-read payment state through an authorized provider interface. The original
   verified event is retained history; it does not prove the provider's current
   refund/chargeback state. Never regenerate a payment to investigate uncertainty.
5. If payment ownership, amount, currency or provider state conflicts, leave the
   signal open and escalate for investigation. Do not replay settlement against
   a different order or alter financial snapshots to make the values match.

## Resolution boundary

Any refund requires a separately authorized provider operation and its confirmed
outcome. Record the authorized operation reference and verified result in the
restricted support record. An unknown refund outcome remains unresolved; do not
repeat it blindly. The current expired-order settlement path is not proof of a
working refund executor.

Do not grant residency manually by updating the expired or failed order. A replacement
order or alternative customer arrangement requires its own authorized financial
workflow. Preserve the original payment, order and credit-reversal evidence.

Only after the real financial disposition is known should support use the
existing approved `integration_error.resolve` operation to close the operational
signal. That operation changes error status only. Its success must not be shown
as proof of refund, entitlement delivery or reconciliation with the provider.

## Required release evidence

- Both expiry orderings retain authenticated payment evidence and a visible open
  signal; the customer does not lose paid time silently.
- Reversal-first invalidates the pending credit-backed order and retains a later
  verified payment as the distinct credit-invalidation case. Settlement-first
  preserves the completed order and follows the approved referral debt rules.
- Exact event replay adds no second alert, release or entitlement, including
  after the operator has resolved the first signal.
- Altered event identity is rejected without overwriting the original fact.
- Multiple reserved grants receive their corresponding inverse allocations.
- Unauthenticated, expired-MFA and non-support requests reveal no payment detail.
- List pagination is bounded and stable; detail cannot cross-bind another event.
- A real support session can find the case in the published candidate. API test
  doubles alone do not establish operator usability or human acceptance.
- Refund execution and external provider availability have their own evidence;
  this procedure does not assert either is implemented or exercised.
