# Early bird composite payment: implementation notes

Status: incomplete design; not safe to enable. No composite provider operation, binding persistence or financial posting exists yet.

A composite payment must be its own provider operation and purpose; the existing held-onboarding operation is bound to RUB 3,000, `capture: false`, one receipt item and the `onboarding` purpose. The residency operation is separately bound to the residency order cash amount. Neither can be reused by changing only its amount or by fabricating another provider payment.

## Required authority and atomic transition

1. Introduce a versioned, opt-in composite operation bound to a user, the current immutable sales base and selection, a verified application and provider mode. PostgreSQL must store onboarding amount, subscription amount, total, original offer time, applicable deadline, quote version, idempotency key and provider identity. Enforce ownership and amount equations in database guards; a separate transition must resolve duplicate/concurrent create attempts without blindly reposting an uncertain request.
2. Build one YooKassa request with two receipt items whose values sum to the stored total. Preserve encrypted replay, payer-contact deletion fencing and uncertain-request recovery already required by `expert-held-onboarding-repository.ts`; do not make a provider request merely from Telegram input. Provider configuration must remain disabled by default.
3. Verify an independently fetched provider payment against the immutable binding, including provider object, amount, currency, mode, user, operation, purpose and actual capture time. `packages/integrations/src/yookassa/early-bird-verifier.ts` is a standalone proof primitive only; it is not yet wired to a database binding or webhook. A payment at or after expiry must be recorded as a reconciliation case, without granting discounted entitlement or silently losing the received funds. Repeated events must resolve idempotently.
4. In a single PostgreSQL transaction under consistent user/expert/order locks, consume an eligible verified provider event and materialize separate onboarding and residency business facts linked to the same composite provider payment. The transaction must enforce that there is no prior onboarding-only payment, no duplicate payment or concurrent competing admission, and that the stored quote and provider observation match. Update the SQL source guards to recognize this new proof as an additional explicit source; do not fabricate the existing onboarding invoice, waiting-for-capture observation or separate residency payment. Referral qualification, audit and outbox effects must remain exactly once and derive from the actual residency component. A crash or failed constraint must leave neither half granted.
5. The settled residency order starts no earlier than the configured launch instant, respecting any later existing coverage; no subscription time elapses before launch. Publication must continue to use `publishSettledMainCard` / `restoreSettledMainCardProjection` and their verification, consent, abuse and current-coverage checks. A durable, idempotent launch-time projection job must re-evaluate eligibility; future settlement alone does not publish a card.

## Existing guards that must be extended explicitly

- `0060_separated_sales_review_corrections.sql`: `expert_sales_paid_lock_source` insists on a genuine onboarding fact, a provider waiting-for-capture observation and a subsequent capture operation.
- `0066_resident_rich_onboarding.sql`: card eligibility currently requires a settled onboarding invoice and an `interview` onboarding fact; quote validity depends on the separated-sales paid lock.
- `expert-residency-provider-inbox-repository.ts`: settlement validates the residency payment attempt, computes coverage, releases credit and writes first-settlement/referral, audit and outbox records in one transaction.
- `expert-card-main-gates.ts`: card projection is denied until coverage is currently effective; it must not be replaced by a direct `active=true` update.
- User deletion, retention, provider replay, idempotency, consent and race controls must cover the new records and operations. Migration history is hand-authored with the matching journal entry; never run `drizzle-kit generate`.

## Required verification

Use focused PostgreSQL integration tests for exact amount/metadata binding, simultaneous webhooks and payment choices, repeated events, late capture, expired or deleted consent, crashes before and after provider dispatch and transaction rollback, first-referral effects, and future/current coverage and launch catch-up. Test actual consumer search before and after launch. Run focused verifier tests, relevant typechecks and lint, `git diff --check`, independent adversarial review and the repository's applicable release gates before enabling the capability.

## Owner-requested live review pricing (2026-10-29)

For a single designated production test expert, temporarily charge RUB 10 for onboarding and RUB 20 for the subscription until further notice. Under the wave-one combined-payment path this is one RUB 30 payment with two receipt components, not two provider payments. The expert identity must be bound authoritatively and immutable for each invoice; other experts retain their existing prices. The current RUB 3,000 onboarding and RUB 5,000 subscription floors and their existing records must not be globally weakened. Explicitly version and scope any exception, including the provider request, fiscal receipt, verifier and all PostgreSQL guards, and keep the capability disabled until end-to-end evidence and target release gates are satisfied. No real provider call, production configuration change, or account enrollment has been made.
