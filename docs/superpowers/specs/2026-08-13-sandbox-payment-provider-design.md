# Sandbox expert residency payment provider

Date: 2026-08-13

Status: approved design; implementation not started

Owner: Engineering

Approval point: human review of this committed specification before implementation planning

## Objective

Provide a durable, controllable payment-provider stub for expert residency staging when
the real provider contract is unavailable. The stub creates fictitious checkout sessions
and supports approved manual `settled` and `refunded` transitions. It exercises the
existing provider-neutral settlement, reward, refund, and reversal paths without external
network calls, real credentials, or direct writes to financial authority tables.

This capability is a sandbox test facility. It does not constitute provider-connected
staging evidence and cannot authorize production activation.

## Actors

- Expert: requests an expert residency checkout through the existing expert API.
- Approved administrator: requests and approves a sandbox payment transition through the
  existing authenticated admin workflow.
- Sandbox API runtime: the only runtime that composes the sandbox adapter and management
  routes.
- PostgreSQL: stores sandbox payments, commands, and append-only provider events in a
  separately identifiable sandbox boundary.
- Existing settlement pipeline: consumes verified sandbox events and remains the only
  path to residency, referral reward, allocation, and ledger mutations.

## Requirements

### Runtime isolation

- **SBX-RUN-001:** Add a separate sandbox API entrypoint and Docker target. The ordinary
  API entrypoint and production image must not import or register sandbox routes,
  repositories, adapters, or verifiers.
- **SBX-RUN-002:** The sandbox entrypoint must start only when
  `II_TONYA_RUNTIME_MODE=sandbox`; any missing or different value must fail startup.
- **SBX-RUN-003:** Sandbox startup must reject enabled live integration flags and the
  presence of live payment-provider credentials.
- **SBX-RUN-004:** Sandbox startup must verify a sandbox database marker. A connection
  without that marker must fail closed before serving traffic.
- **SBX-RUN-005:** No production entrypoint, environment flag, route parameter, or admin
  command may activate the sandbox capability.

### Checkout behavior

- **SBX-PAY-001:** Sandbox checkout must implement the existing
  `ExpertResidencyPaymentPort` and accept only the provider-neutral checkout command.
- **SBX-PAY-002:** Checkout returns `kind=created`, an opaque identifier prefixed
  `sandbox_payment_`, and an HTTP(S) checkout URL owned by the sandbox runtime.
- **SBX-PAY-003:** Checkout performs no external network call and reads no real provider
  secret.
- **SBX-PAY-004:** Checkout creation and its idempotency record are committed atomically.
- **SBX-PAY-005:** Repeating an idempotency key with the same canonical command returns
  the original result; reuse with a different canonical command returns a conflict.
- **SBX-PAY-006:** A checkout URL or page view cannot settle, refund, or otherwise mutate
  the payment.

### State and event model

- **SBX-DATA-001:** Store sandbox records in separate
  `sandbox_expert_residency_*` tables. They must not share provider storage with live
  provider inbox or financial ledger records.
- **SBX-DATA-002:** `sandbox_expert_residency_payments` stores payment and order identity,
  immutable amount/currency, checkout identity, state, optimistic version, and canonical
  timestamps.
- **SBX-DATA-003:** `sandbox_expert_residency_commands` stores command identity,
  idempotency key, canonical payload digest, command kind, and replayable result.
- **SBX-DATA-004:** `sandbox_expert_residency_events` is append-only and stores unique
  provider event identity, transition kind, canonical payload digest, and occurrence
  time.
- **SBX-DATA-005:** Valid transitions are `created -> settled -> refunded`. A refund before
  settlement, a second settlement, and any transition from `refunded` are conflicts.
- **SBX-DATA-006:** Transition validation, optimistic-version check, event creation, and
  audit provenance are atomic under a locked payment row.
- **SBX-DATA-007:** Sandbox tables cannot directly mutate residency intervals, referral
  rewards, allocations, balances, or ledger entries.

### Administration and authorization

- **SBX-ADM-001:** Management routes exist only in the sandbox entrypoint and require the
  existing authenticated administrator principal boundary.
- **SBX-ADM-002:** `settled` and `refunded` transitions require an existing approved admin
  workflow bound exactly to payment ID, expected version, transition, requester session,
  and idempotency key.
- **SBX-ADM-003:** The requester cannot approve their own command. Expired, reused,
  mismatched, or already-consumed approvals fail closed.
- **SBX-ADM-004:** Identical approved transition replay returns the committed result;
  conflicting replay is rejected without creating another event.
- **SBX-ADM-005:** Management error responses are fixed and sanitized: authentication and
  authorization use `401`/`403`, command conflicts use `409`, and unavailable dependencies
  use `503`. SQL, raw payloads, approvals, credentials, and internal exception text are not
  returned.

### Verified provider flow

- **SBX-EVT-001:** Sandbox events use provider identity `ii_tonya_sandbox` and are branded
  only by a sandbox verifier unavailable to the production runtime.
- **SBX-EVT-002:** The production verifier must reject sandbox events.
- **SBX-EVT-003:** A settled event enters the existing authoritative settlement path. A
  refunded event enters the existing refund/reversal path. Sandbox code must not reproduce
  financial calculations or write financial outcomes directly.
- **SBX-EVT-004:** A transient downstream failure retains the durable sandbox event for
  bounded reconciliation. Redelivery must rely on the existing provider-event replay and
  idempotency protections.
- **SBX-EVT-005:** Sandbox event verification evidence and logs must not contain raw
  authorization headers, approval payloads, or credentials.

## Component design

### Sandbox entrypoint

The sandbox entrypoint composes the normal API application with an explicit sandbox
capability. It owns sandbox-only routes and lifecycle setup. The ordinary server entrypoint
has no dependency edge to the sandbox module. Static import guards and packaged-image
smoke tests enforce this boundary.

### Sandbox payment adapter

`SandboxExpertResidencyPaymentAdapter` implements `ExpertResidencyPaymentPort`. Checkout
delegates persistence to the sandbox repository and returns the stored result. Reconcile
reads durable unprocessed sandbox events and returns only sandbox-branded verified events.
It does not make HTTP requests or accept client-supplied price, balance, expert, or reward
authority.

### Sandbox repository

The repository owns checkout idempotency, state transitions, command replay, optimistic
versioning, append-only event creation, and sandbox audit facts. PostgreSQL transactions
and constraints are authoritative. The repository exposes no method that updates normal
financial tables.

### Admin transition workflow

The sandbox management endpoint creates or consumes the existing admin approval contract.
The approved command contains the exact target payment, transition, expected version, and
idempotency key. Once consumed, the repository performs the transition and creates one
provider event. A separate delivery step invokes the existing provider-neutral processing
path.

## Data flow

1. An authenticated expert requests residency checkout through the existing API service.
2. The service creates the authoritative residency order and invokes the sandbox payment
   port only in the sandbox runtime.
3. The adapter atomically stores the sandbox payment and idempotency result, then returns
   its opaque payment ID and sandbox checkout URL.
4. An authorized administrator requests a transition approval. A distinct authorized
   administrator grants the exact approval.
5. The requester submits the approved transition with the expected payment version.
6. PostgreSQL locks the sandbox payment, consumes the exact approval, validates the state
   transition, and appends one sandbox provider event atomically.
7. The sandbox verifier brands the durable event. The existing settlement or refund path
   applies financial effects transactionally and idempotently.
8. On an unknown or transient outcome, bounded reconciliation redelivers the same durable
   event rather than generating a replacement identity.

## Database boundary

The implementation may use a dedicated sandbox database or a sandbox schema, but startup
must validate an explicit database marker stored in PostgreSQL. A database name alone is
not sufficient evidence. Migrations must create only the approved sandbox tables,
constraints, indexes, and marker needed by this capability.

The normal migration and release process must not run sandbox migrations against a
production-marked database. Cleanup tooling may truncate or drop sandbox data only after
validating the marker and exact target database.

## Error and recovery behavior

- Validation errors do not persist commands or payments.
- Transaction failures roll back the transition, approval consumption, and event creation
  together.
- Delivery failure does not roll back the already committed provider event; reconciliation
  retries the exact event identity.
- Duplicate delivery is handled by the existing provider inbox and settlement replay
  rules.
- A mismatched replay never creates a replacement event, payment identity, reward, or
  ledger fact.
- Feature shutdown stops new sandbox checkout and transition commands while preserving
  reconciliation of already verified events.

## Testing and evidence

All executable verification runs in the constrained Claw test profile. No local full-suite
substitute is accepted as PostgreSQL or container evidence.

- **SBX-TST-001:** TDD RED must demonstrate missing entrypoint, persistence, idempotency,
  transitions, approval binding, and runtime guards before implementation.
- **SBX-TST-002:** Focused PostgreSQL tests cover checkout creation, identical replay,
  conflicting replay, rollback, and concurrent checkout commands.
- **SBX-TST-003:** Transition tests cover `created -> settled -> refunded`, every invalid
  transition, optimistic-version conflict, identical replay, and concurrent commands.
- **SBX-TST-004:** Admin tests cover authentication, authorization, self-approval denial,
  exact payload/session binding, expiry, consumption, and sanitized errors.
- **SBX-TST-005:** End-to-end tests prove settled reward/ledger effects and refund/reversal
  effects occur only through the existing authoritative pipelines.
- **SBX-TST-006:** Security tests prove no external network call, credential read, raw
  payload leak, production verifier acceptance, or direct financial-table mutation.
- **SBX-TST-007:** Import and packaged-image tests prove the production entrypoint/image
  cannot register sandbox routes or compose sandbox modules.
- **SBX-TST-008:** Focused concurrency tests run three times. Production-like container
  smoke runs once. `test:repeat` above three is prohibited.
- **SBX-TST-009:** Sandbox-container smoke covers checkout URL creation, approved manual
  settlement, reconciliation, approved refund, and cleanup.
- **SBX-TST-010:** Before merge, the exact final SHA must pass the existing full Claw CI,
  Database Gate, scope guards, build/typecheck/lint, image scan, SBOM/provenance, and an
  independent Critical/Important review.

## Traceability and release boundary

Implementation must link every `SBX-*` requirement to changed code, focused tests,
evidence, and rollback instructions. The sandbox operational document must describe
startup, empty credential placeholders, database-marker validation, approved transitions,
reconciliation, cleanup, and incident containment.

This design does not change these release facts:

```text
live payment provider = DISABLED
provider-connected staging evidence = BLOCKED
production activation = NO-GO
```

Using the sandbox cannot change `docs/runbooks/provider-staging-evidence.md` to `PASS`.
Production deployment still requires a separately reviewed real provider contract,
provider-connected staging evidence, signed exact-image provenance, migration approval,
and explicit human production authorization.

## Acceptance criteria

The increment is complete only when all of the following are true at one exact commit:

1. A separately built sandbox runtime creates durable fictitious checkout sessions.
2. Approved administrators can drive idempotent `settled` and `refunded` transitions.
3. Normal settlement, reward, refund, and reversal behavior is exercised end to end.
4. The production runtime and image cannot expose or activate sandbox behavior.
5. No sandbox component makes external provider calls or reads real provider credentials.
6. Sandbox data cannot directly mutate financial authority tables.
7. Focused and final Claw gates pass within the three-run policy.
8. Independent review reports no unresolved Critical or Important finding.
9. Documentation and rollback guidance remain explicit that production is `NO-GO`.

## Deferred scope

- Selection or implementation of a real payment provider.
- Real provider webhook authentication, contract fixtures, rate limits, and credentials.
- Provider-connected staging sign-off.
- Production feature activation or deployment.
- A standalone payment-provider microservice; reconsider only if a real provider requires
  a separate operational boundary.
