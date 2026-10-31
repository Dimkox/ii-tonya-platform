---
title: 'Early bird wave one'
type: 'feature'
created: '2026-10-29'
status: 'draft'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Early residents need to pay ahead of the client launch without publication or consumption of subscription time before launch.

**Approach:** Introduce a versioned, fail-closed wave-one sales flow with a single provider payment for onboarding and discounted subscription, deferred coverage, and targeted final-call notices.

## Boundaries & Constraints

**Always:** PostgreSQL owns payment and entitlement state; provider success is verified and idempotent. Wave one starts at 2027-01-11 00:00 Moscow. Discount eligibility expires 240 hours after the initial offer; onboarding-only payment permanently ends eligibility. Persist quoted amounts and reconcile late or mismatched payments without granting an entitlement. Retain the current refund policy until legal review. Repeat notices after three days to recipients still unpaid; Telegram does not expose ordinary message read receipts.

**Ask First:** Production activation, legal approval, and any provider-side mutation require their existing separate authorization.

**Never:** Trust bot text or webhook amount as payment authority; publish an unpaid or not-yet-covered profile; silently alter existing sales or referral balances; run drizzle-kit generate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Combined | Eligible discounted quote and verified exact payment | Record onboarding and subscription atomically; coverage begins at launch | Duplicate webhook is idempotent |
| Expired | Success after the discount deadline | No discounted entitlement | Persist reconciliation case; no automatic forfeiture |
| Deferred | Onboarding-only success | Base price preserved; no discounted eligibility or publication | Retry idempotently |
| Launch | Verified prepaid resident with eligible profile | Coverage begins at launch and projection is restored | Existing verification and safety gates still apply |
| Reminder | Verified onboarding-only, unpaid | Send final call from 28 December at 10:00 Moscow; retry after three days if still unpaid | Durable consent-aware delivery; never rely on read receipts |

</frozen-after-approval>

## Code Map

- `packages/domain/src/expert-separated-sales.ts` — existing staged price calculation and minimum.
- `packages/db/src/repositories/expert-held-onboarding-repository.ts` — onboarding-only provider binding; cannot be reused by changing the amount.
- `packages/db/src/repositories/expert-residency-provider-inbox-repository.ts` — verified settlement and coverage creation.
- `packages/db/src/repositories/expert-card-main-gates.ts` — publication and restoration gates.
- `packages/db/src/repositories/expert-sales-scheduler.ts` — durable consent-aware reminders.
- `apps/api/src/routes/expert-applicant-telegram.ts` — expert promo ingress.
- `apps/web/src/legal-content.ts` — legal surface; retain current refund policy pending legal review.

## Tasks & Acceptance

**Execution:**
- [ ] Specify and test versioned wave-one pricing, timing and payment state.
- [ ] Introduce a provider-bound composite payment and atomic settlement with stored amount components and late-success reconciliation.
- [ ] Defer paid coverage and restore eligible publication at launch.
- [ ] Adapt expert sales choices, invoice copy and targeted reminders to the new state.
- [ ] Amend the expert offer subject to legal review and existing refund policy.

**Acceptance Criteria:**
- Given an eligible resident, when the combined invoice settles on time, then onboarding and subscription are recorded once, coverage starts at launch, and the card remains hidden until eligible.
- Given an onboarding-only resident, when the final-call scheduler runs, then only eligible unpaid residents are notified and unpaid profiles remain unpublished at launch.

## Verification

**Commands:**
- Focused domain, payment, scheduler and PostgreSQL integration tests; relevant typechecks and lint; `git diff --check`.
- Independent adversarial review and exact-SHA CI/database evidence are required before completion.
