---
title: Manager verification and purpose-bound onboarding payment
status: done
baseline_commit: e880246f641ede57b4ab0512dccbd1031226dacb
context:
  - docs/superpowers/implementation-artifacts/spec-phase1-through-phase2-execution.md
  - docs/superpowers/implementation-artifacts/spec-phase1-block-a.md
  - packages/db/src/schema/expert-onboarding.ts
  - packages/integrations/src/yookassa/verifier.ts
  - packages/db/src/repositories/admin-approval-repository.ts
---

## Contract and compatibility boundary

P1.B1–B3: extend existing applicant queue, using existing authenticated MFA admin
sessions and support/security roles. Queue summaries contain masked facts only;
protected detail exposes necessary contact/current questionnaire slot. No web cabinet.
Unknown content is typed inactive `TODO: Wait for Content Spec`.

Manager approve/reject is transactionally audited, immutable and idempotent. Approved
creates one separate onboarding invoice for300000 kopecks RUB. Persist purpose
`onboarding`, application owner and server-owned provider mode in both invoice and
payment-operation binding. This is NEVER an expert_residency_order. A rejected
application gets a bounded reason-code work item, no invented rejection prose.
Never replace the accepted campaign quote via A apply after manager decision; no
silent quote renewal or price change.

Verified onboarding payment opens only application onboarding_stage=interview.
Do not create/activate/verify experts, residency intervals, first settlement markers,
qualified referral maturities/grants/ledger entries or spendable bonus/coupon credit.
Existing expert APIs stay inaccessible to applicants. C6 owns future full admission.

Reuse YooKassa GET contract, strict decimal kopecks, paid+succeeded+captured timestamp,
provider ID, metadata order ID, owner, currency, amount and mode binding. Callback
claims and redirects cannot settle. A private runtime proof brand is created only
by the narrow GET verifier, with no exported generic mint. PostgreSQL settlement
rechecks stored operation/invoice purpose/owner/amount/mode and proof binding.

Checkout uses an explicit injected capability honoring existing strict first-send
cancellation/deletion custody; absent complete production dependencies is inactive,
never a fake URL/success or new lease exception. Local injected fixtures may exercise
provider create/GET contracts without actual providers. No live flags/provider calls.

## Owned files and interfaces

- SQL0053/journal, supported snapshot+state evidence, schema/expert-verification.ts:
  purpose-bound invoices, immutable payment bindings, manager decisions/work,
  payment inbox/audit, ownership FKs and state guards; exports and privacy disposition.
- repositories/expert-verification-repository.ts: listQueue(sessionHash),
  applicationDetail(sessionHash,applicationId), decide(sessionHash,applicationId,
  decision,reasonCode,idempotencyKey), invoiceForOwner(scope,invoiceId),
  bindPayment(invoiceId,operation), settleVerified(proof). Every manager command
  rechecks existing admin session/MFA/role inside transaction; no caller-owned role.
- integrations/src/yookassa/onboarding-verifier.ts and test: narrow stored-binding
  interface, GET verifier and private proof assertion; no access to residency mint.
- application/src/expert-verification-service.ts + new tests: bounded manager/API
  workflow, invoice ownership and injected checkout capability, no PII logs.
- apps/api/src/routes/expert-verification.ts + new tests; app/config/composition:
  dedicated authenticated admin endpoints and separate default-off capabilities.
- NEW tests/integration/phase1-verification.test.ts: integrated stored authority,
  concurrency, owner/payment/purpose mismatch, actual GET proof, consent/deletion,
  first-marker/referral/residency absence and accepted quote replacement regression.
- Exact guard registrations, docs/test-evidence/phase1-block-b-2026-10-23.md,
  AGENT-STATUS and plan checklist. Never widen classifiers or old migration gaps.

## Acceptance and verification

Given an active MFA support manager, listing returns bounded masked pending entries;
wrong/expired/revoked roles fail without contact enumeration. Detail is protected.
Given one application, concurrent duplicate decisions create one immutable audited
result and at most one300000 invoice; conflicting repeat decisions fail.
Given untrusted payment/callback facts, no access changes. Given actual GET proof
matching the stored onboarding purpose/order/owner/operation/mode/amount, concurrent
settlement produces one interview admission and no residency/referral artifacts.
Given manager decision, A apply cannot replace its accepted campaign quote.
Given missing content/payment transport, represent inactive slots honestly.

TDD: non-PG behavior RED first; NEW PG file at most3 invocations, favor first real
integrated run after source review, reserve final for corrections. Never rerun A's
five-consumed file or any exhausted legacy/provider file. Relevant builds/types,
scoped lint/format/diff, independent review, actual passing local commit before C.

## Manager interface acceptance

B1/B2 also require a usable staff interface, not JSON endpoints alone. Add an
internal `/admin/expert-verification` web view in the existing application shell:
masked queue, protected selected detail, explicit approve/reject buttons with a
bounded reason-code selector, and invoice recovery action. Reuse the existing
issued MFA admin bearer session; keep its token in memory only, never browser
storage, URLs, telemetry or logs. No new login protocol or customer/expert cabinet.
Untrusted detail uses textContent/escaping; failed authorization/logout clears PII.
API reads/mutations and page responses carrying contact use no-store. Unit/contract
coverage must exercise queue/detail, buttons, body authority restrictions, token
handling, duplicate command keys, errors and inactive content slots.

Owned files: apps/web/src/expert-verification-client.ts,
apps/web/src/expert-verification-view.ts, their new tests, and minimal main.ts route.

## Local acceptance

Source dd73dfb30be327d1e3e86458826c956375834ece locally implemented/reviewed/verified.
PG2 passed23/23 after production SQL-clock fix;2/3 invocations consumed, thirdunused.
Actual staff UI client10/binding8 and native nginxedge1 passed; relevant builds,
types, lint, format and guards passed. Evidence:
../../test-evidence/phase1-block-b-2026-10-23.md. No provider/release acceptance.
