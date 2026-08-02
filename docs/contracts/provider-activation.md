# Provider activation evidence

Live provider bindings are fail-closed. A contract harness, fixture, or successful
unit test is not authorization to enable network access.

## Required evidence

Every provider activation record must contain:

- official contract version and immutable document checksum;
- authentication method and credential owner;
- webhook replay window and signature-verification procedure;
- sanitized payload fixtures exercised through the production codec;
- isolated sandbox tenant and test identities;
- published and measured rate limits;
- timeout semantics split into before-write and after-write outcomes;
- documented idempotency support and reconciliation procedure;
- stable outbound-delivery event identity and delivery-state semantics;
- named security reviewer and product approver;
- evidence date and expiry/review date.

Missing or ambiguous evidence is a `NO-GO`.

## Selarti

| Evidence                                | Status                                             |
| --------------------------------------- | -------------------------------------------------- |
| Official contract version and checksum  | Missing immutable approved snapshot                |
| Inbound authentication method           | Not confirmed by the reviewed public contract      |
| Webhook replay window                   | Not confirmed                                      |
| Payload fixtures                        | Sanitized contract-harness fixtures only           |
| Sandbox tenant                          | Not available                                      |
| Rate limits                             | Not confirmed                                      |
| Timeout semantics                       | Harness normalization only; not provider-confirmed |
| Idempotency support                     | Not confirmed                                      |
| Stable outbound-delivery event identity | Not confirmed                                      |
| Security reviewer                       | Not assigned                                       |
| Product approver                        | Not assigned                                       |
| Evidence date                           | 2026-07-29                                         |

**Activation status: `NO-GO`.**

The inbound fixture's `occurred_at` field is an explicit contract hypothesis needed
for canonical event time; it is not treated as provider-confirmed evidence.
Only the explicit `message_type = client` harness literal maps to
`CanonicalInboundMessage`; every other direction or unknown type is rejected. The
canonical event identity hashes a serialized `[company_id, message_id]` tuple so
provider identifiers containing delimiters cannot collide.

Outbound `applied` requires an exact JSON content type and a strict response body
with one stable operation ID. Any ambiguous post-write HTTP response, unclassified
transport exception, or unconfirmed rate-limit response becomes `unknown_outcome`
with the original reconciliation key. A `429` is retryable as `not_applied` only
when an explicit reviewed policy proves that response means no provider mutation.

`SelartiContractAdapter` is an unbound codec and transport harness. The API
composition root does not construct it, and the repository contains no live Selarti
HTTP client. Runtime configuration requires:

```text
SELARTI_ENABLED=false
SELARTI_OUTBOUND_BILLING_MODE=disabled
```

All credential fields remain placeholders. No provider session or live request is
permitted by this contract.

Send acceptance is not delivery evidence and never invokes
`recordOutboundDelivery`. If an approved future contract supplies stable delivery
events, each event must first enter `integration_inbox` as a
`CanonicalOutboundDelivery`; Task 7 then meters it idempotently in a separate
transaction.

## Planerka

| Evidence                                         | Status                                       |
| ------------------------------------------------ | -------------------------------------------- |
| Official contract version and checksum           | Missing immutable approved snapshot          |
| Authenticated REST paths and authentication      | Not confirmed                                |
| Authentication credential owner                  | Not assigned                                 |
| Webhook authentication and freshness window      | Not confirmed                                |
| Payload fixtures                                 | Sanitized contract-hypothesis fixtures only  |
| Sandbox tenant and test identities               | Not available                                |
| Published and measured rate limits               | Not confirmed                                |
| `429` no-mutation and retry semantics             | Not confirmed                                |
| Before-write versus after-write timeout semantics | Not provider-confirmed                       |
| Reserve idempotency semantics                     | Not confirmed                                |
| Confirm idempotency semantics                     | Not confirmed                                |
| Cancel idempotency semantics                      | Not confirmed                                |
| Authoritative reconciliation endpoint             | Not confirmed                                |
| Stable booking/event identity                     | Not confirmed                                |
| Security reviewer                                 | Not assigned                                 |
| Product approver                                  | Not assigned                                 |
| Evidence date                                     | 2026-07-29                                   |
| Expiry/review date                                | Not assigned                                 |

**Activation status: `NO-GO`.**

`ProviderSlot` and `PlanerkaMutationOutcome` are internal boundary contracts, not
claims about a live provider schema. The seven Planerka fixtures are sanitized
contract hypotheses and have not passed through an authenticated provider codec.
An after-write timeout is treated as `unknown_outcome`; an approved future binding
must reconcile through an authoritative reservation lookup before any retry.

`DisabledPlanerkaAdapter` is the only Planerka adapter supplied by this task. The
repository contains no Planerka HTTP codec, client, endpoint binding, credential
lookup, authenticated session, or webhook handler. Runtime configuration remains:

```text
PLANERKA_ENABLED=false
PLANERKA_API_TOKEN=__PLACEHOLDER_PLANERKA_API_TOKEN__
PLANERKA_BASE_URL=__PLACEHOLDER_CONFIRM_FROM_AUTHENTICATED_API_DOCS__
PLANERKA_WEBHOOK_SECRET=__PLACEHOLDER_PLANERKA_WEBHOOK_SECRET__
```

Every disabled adapter method throws `Planerka integration is disabled`. Provider
activation requires a separate reviewed change after every missing evidence field
above is supplied and approved.

## Payments

| Evidence or commercial decision                 | Status                              |
| ----------------------------------------------- | ----------------------------------- |
| Payment provider and immutable contract version | Not selected or approved            |
| Prices                                          | Not approved                        |
| Package composition                             | Not approved                        |
| Refund policy                                   | Not approved                        |
| Chargeback policy                               | Not approved                        |
| No-show policy                                  | Not approved                        |
| Receipt and fiscal requirements                 | Not approved                        |
| Legal basis and data-processing terms           | Not approved                        |
| Authenticated webhook contract and replay rules | Not available                       |
| Idempotency and authoritative reconciliation    | Not available                       |
| Sandbox tenant and test identities              | Not available                       |
| Credential owner                                | Not assigned                        |
| Security and legal reviewers                    | Not assigned                        |
| Product approver                                | Not assigned                        |
| Dual-control activation approval                | Not defined or granted              |
| Evidence date                                   | 2026-07-29                          |
| Expiry/review date                              | Not assigned                        |

**Activation status: `NO-GO`.**

`CreateCheckoutCommand`, `PaymentWebhookCommand`, and `RefundCommand` are internal
type boundaries only. They do not establish prices, currencies, package contents,
refund eligibility, provider payloads, fiscal treatment, or entitlement rules.
`DisabledPaymentAdapter` is the only payment binding. Every operation throws a
`PaymentsDisabledError` whose code is `PAYMENTS_DISABLED`, without inspecting the
command.

No payment route, provider client, codec, webhook mutation handler, database table,
payment event consumer, entitlement grant, credential lookup, or authenticated
session is supplied. Runtime configuration remains:

```text
PAYMENTS_ENABLED=false
PAYMENT_PROVIDER=disabled
PAYMENT_API_KEY=__PLACEHOLDER_PAYMENT_API_KEY__
PAYMENT_WEBHOOK_SECRET=__PLACEHOLDER_PAYMENT_WEBHOOK_SECRET__
```

Activation requires a separate dual-controlled change after every missing evidence
and policy item above is supplied, reviewed, and approved.
