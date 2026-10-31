---
title: "Public expert payments after launch"
type: "feature"
created: "2026-10-30"
status: "in-progress"
baseline_commit: "3ca55b1d5453b25b6e0c907e7cc545554b1424d5"
review_loop_iteration: 0
context:
  - docs/superpowers/implementation-artifacts/public-expert-payment-gateway-design-2026-10-30.md
  - docs/superpowers/implementation-artifacts/early-bird-gateway-ack-owner-decision-2026-10-30.md
---

<frozen-after-approval reason="original owner specification requires standard-mode periods from payment; engineering design remains under review">

## Intent

**Problem:** When January 11 changes the launch phase, newly joining experts fall into an unwired legacy checkout. Existing paid-wave publication does not implement ordinary payments. Legacy first coverage also starts at settlement processing rather than actual payment.

**Approach:** Connect the existing expert onboarding and residency financial ledgers to typed authenticated gateway operations. Keep merchant credentials exclusively in the gateway and preserve the existing held-onboarding lifecycle. This is completion of the owner's standard-mode requirement, not permission to change prices or fabricate financial facts.

## Boundaries & Constraints

**Always:** PostgreSQL authorizes every operation, immutable body digest, subject, product, amount, mode, provider binding and endpoint. Separate public product evidence from wave records. Preserve held create, genuine waiting-for-capture observation, capture/cancel, settlement and refund rules. First public coverage begins at verified provider capture, with effective date in Europe/Moscow; renewal preserves queued coverage. Wave coverage remains January 11. Unknown POST outcomes permit GET recovery, never blind redispatch.

**Ask First:** Additional complete CI invocations beyond the consumed two-run allowance; any additional exhausted focused test invocation. Production deployment is already requested but requires exact-source release gates. Personal administrator enrollment and the future single test expert's identity remain external prerequisites, not invented sessions or blanket price exceptions.

**Never:** Put merchant secrets in API/worker; route public payments through relaxed wave gates; convert a captured payment into fictitious held observations; authorize from Telegram or webhook claims; substitute webhook receipt time for capture; erase/recreate gateway nonce state; modify historical migrations or run drizzle-kit generate.

## I/O & Edge-Case Matrix

| Scenario          | Input / State                                                       | Expected Output / Behavior                                                                                              | Error Handling                                                                                     |
| ----------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Public onboarding | Current approved application and accepted legacy offer after launch | Genuine held invoice, bank-card inspection and authorized capture; invalidated frame cancels                            | Missing authority creates no payment                                                               |
| Public residency  | Current onboarding/card/quote and owned unpaid order                | Bound provider payment, fresh verified settlement and correct coverage                                                  | Foreign, expired, ambiguous or inconsistent facts fail closed                                      |
| Lost response     | Dispatch recorded; provider ID unavailable                          | Complete bounded LIST, unique exact candidate, fresh GET and isolated binding                                           | Empty, ambiguous or incomplete discovery remains uncertain; no second POST                         |
| Contact revoke    | Receipt-bearing operation overlaps deletion                         | Complete deletion only after gateway ACK; no later contact send                                                         | Concurrent send may finish under approved boundary                                                 |
| Non-PII cleanup   | Contact expired/revoked; bound held payment needs cancellation      | Explicit financial authority still permits contact-free cleanup                                                         | Never reconstruct or retransmit contact                                                            |
| Delayed webhook   | Fresh GET confirms capture before deadline, processing after it     | Capture determines first public coverage; unresolved public dispatch preserves reserved credit until a verified outcome | Already released/conflicting credit retains paid evidence for manual reconciliation; no double use |

</frozen-after-approval>

## Code Map

- `expert-held-onboarding-repository.ts` currently refuses first dispatch; `yookassa/held-onboarding.ts` needs credentialless typed transport instead of API merchant auth.
- `expert-card-service.ts` defines the main checkout port; production bootstrap does not supply it.
- `scripts/experimental/yookassa_gateway/{ipc,bound_gateway,pg_authority,provider_reader}.py` currently permit payment-create only and omit bank-card method evidence.
- `payer-receipt-contact-repository.ts` owns legacy encrypted contacts and quote/order bindings; retain its domain separately from wave contacts.
- `expert-residency-provider-inbox-repository.ts` persists immutable branded `occurredAt` but derives first coverage from processing time. Existing provider GET already supplies capture time.
- Full annotated paths and read-only evidence are in the linked design.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/db/migrations/0084_public_expert_payment_gateway.sql` plus journal/state — add immutable public operation authority over existing financial records, exact isolated capabilities and cross-product ambiguity rejection.
- [ ] `packages/db/src/repositories/public-expert-payment-gateway.ts` — persist preparation/admission/binding/recovery without holding uncommitted admission across provider transport.
- [ ] `packages/integrations/src/yookassa/public-expert-gateway.ts` and gateway Python modules — implement DB-derived create/capture/cancel/main/refund operations, genuine method evidence and bounded authenticated transport; preserve public refund operation/order/subject/purpose metadata in request and GET/LIST projections.
- [ ] API bootstrap, verification/card/lifecycle compositions and worker recovery — inject actual credentialless ports and full revoke/privacy/TTL composition.
- [ ] Residency verifier/inbox and expiry selection — enforce public capture/deadline consistency, protect unresolved reserved credit and use cohort-specific period origin without rewriting historical or wave periods.
- [ ] Role catalogue/provisioning/readiness, bounded tests and release evidence — prove isolated principals and rebuild bridge approval for 85 entries.

**Acceptance Criteria:**

- Given a newly approved expert after launch, when onboarding and the main tariff are paid, then actual gateway/provider facts settle once and a valid profile becomes eligible from payment.
- Given a held payment with an invalidated application or expired frame, when reconciliation runs, then only an authorized cancellation is issued and no contact is disclosed again.
- Given an existing wave resident, when launch or recovery runs, then its original product, quoted amount and January 11 start remain unchanged.
- Given contradictory capture times or duplicate cross-product provider IDs, when settlement runs, then no entitlement is granted and the financial record remains diagnosable.
- Given a public payment captured on time with a delayed notification, when expiry races settlement, then reserved credit cannot be released and spent twice; an existing inconsistent release preserves the paid fact for explicit reconciliation.

## Design Notes

The implementer selects separate public products on existing ledgers because the alternative of weakening wave snapshots breaks their fixed-start contract. A new independent financial ledger duplicates settlement/referral/refund authority. Typed non-PII capture/cancel operations need financial authorization independent of receipt-contact lifetime; receipt-bearing creation/refunds retain contact fencing. No arbitrary URL, method or path is accepted from the caller.

## Verification

New focused tests cover all matrix rows, real minimal LOGIN privileges, replay/crash boundaries, Moscow midnight, delayed capture, refunds and actual provider-method projection. Preserve all test counters; exact commands and file ownership belong in the implementation plan. Require relevant builds/types/lint, whitespace, independent adversarial review, PG17.5 state reconstruction and successful exact-SHA CI/Database Gate. A bridge accepting 84 entries is not recovery evidence for this 85-entry candidate.
