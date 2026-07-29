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
