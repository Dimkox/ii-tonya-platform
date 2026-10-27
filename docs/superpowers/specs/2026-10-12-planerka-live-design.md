# Planerka: expert approval before external booking

Status: design for owner review; not implemented or released.

## Approved intent

The owner requested implementation and activation of Planerka, and accepted
the proposed order: expert approval in Tonya, then creation in Planerka.
If the external slot is no longer available, offer another time. Existing
demo catalogue entries must not become real offers.

## Evidence and scope

Inspected source: a1d8f9353414ff7a1bc1df18a1c113f20b123849.
Current code accepts only PLANERKA_ENABLED=false. The provider port models
reserve/confirm/cancel, but the implementation is disabled. Booking repository
currently publishes client.booking_confirmed alongside planerka.confirm.
That ordering is not valid evidence of an external booking.

Official contract: https://help.planerka.app/api and
https://planerka.app/rest/v2/doc.json. Public API supports slots, creation,
lookup and cancellation, but not approval/rejection of booking requests.
Use https://planerka.app/rest/v2; do not implement illustrative /events paths
from the historical requirements. Inspect operation-specific API versions.

The previously inspected local env contains placeholders. Production lacks
Planerka credentials. A further filename search in the project work tree found
only the main checkout .env. This is not proof that no key exists elsewhere.

## Design

1. Import availability only for explicitly mapped real experts and event types.
   Event types must not require provider-side confirmation. Validate duration,
   timezone, ownership and capacity before accepting the mapping.
2. A client request creates a local reservation and asks the expert. This is
   not an external hold and cannot prevent another channel booking the slot.
3. Expert approval durably records a pending provider operation, not booked.
   PostgreSQL transactions own the decision, operation identity and outbox.
4. The worker creates the external booking. Persist the provider UID before
   marking the reservation booked and publishing the client confirmation.
   Do not emulate unsupported confirmation with a successful no-op.
5. A definite slot conflict does not produce a confirmation. Release the local
   claim through the workflow and let the client choose refreshed availability.
6. An uncertain creation result stays pending for reconciliation. No blind
   POST retry, and no inferred success from an HTTP timeout. A single matching
   result requires trustworthy correlation; ambiguous results require operator
   resolution. Do not assume provider support for idempotency headers.
7. Cancellation and expiry must account for concurrent provider creation. If
   creation wins after a cancellation request, persist the UID and request
   external cancellation. Never discard a possible external booking.
8. Disable new external operations independently of draining/reconciling
   existing operations. Rollback must retain the ability to cancel and reconcile
   bookings created by this release.

## Boundaries

Provider transport belongs in packages/integrations. Workflow decisions belong
in application/domain and durable state in packages/db. Worker composition
owns dispatch, bounded retries and reconciliation. API and client presentation
must distinguish pending external booking from booked. Transport receives only
the attendee fields required for the mapped event type; no consultation notes.

Introduce a provider-operation state model rather than falsely satisfying the
old reserve/confirm port. The implementation plan must enumerate affected SQL
constraints, transitions, queries and client validators before changing them.
Migrations are hand-authored, journalled and checked against the actual release
lineage; do not reuse the unpublished payment branch's migration number.

## Transport and security

Keep the bearer key server-side. Bound request duration and response size;
validate envelopes, identifiers, times and returned booking identity. Reject
redirects to avoid leaking credentials. Redact authorization and attendee data
from logs. Bound requests to the documented account limits and cache short
availability windows. Credentials and mappings are startup gates for activation.
Webhook events, if used, cannot authorize a transition until their authenticity
is established; otherwise use authenticated polling. No new payment activation.

## Verification and release acceptance

- Contract tests: slot normalization, successful creation/cancellation, 409,
  authorization errors, rate limits, malformed responses, and uncertain sends.
- PostgreSQL tests: duplicated decisions, worker restart after send, concurrent
  cancellation, stale callbacks, and confirmation only after durable UID storage.
- Browser/API tests: pending differs from booked; conflicts offer another time;
  no false confirmation, no demo-to-real conversion.
- Focused typechecks, lint, whitespace checks and independent review. Follow
  repository test budgets; do not rerun exhausted account-package tests.
- Read-only live preflight verifies credentials, account, event types and real
  mappings. A provider booking probe needs a separately identified safe target:
  creation can send notifications and create a calendar event.
- Build and publish an exact RC with evidence and a recovery procedure. Report
  missing hosted CI explicitly; do not manufacture a Trust CI receipt.

## Activation blockers

Working server credential and real expert/event-type mappings are not yet
available in the inspected configuration. Implementation and local verification
can proceed after design/plan review; production activation cannot be claimed
until these inputs and release checks are satisfied.
