---
title: Quote-bound expert campaign checkout
type: feature
created: 2026-10-12
status: in-progress
baseline_commit: 690797db64fd80aa1aeccea8003543de470d8c16
review_loop_iteration: 0
context:
  - "{project-root}/AGENTS.md"
  - "{project-root}/docs/operations/migration-state-baseline.md"
---

## Intent

Consume the displayed immutable expert quote as one financial order, preserving
its price, term and entitlements through settlement. Existing quote storage is
verified locally; checkout still rereads base tariffs and cannot sell campaigns.
This is the next increment of the commercial-product goal, not release completion.

## Boundaries & Constraints

Always: PostgreSQL owns financial authority. Keep existing v1/v2 tariff and order
predicates, historical snapshots, referral treatment and idempotency intact.
Only the new order policy is `expert_campaign_v1`; tariff policy remains V2.
Money crosses repository boundaries as decimal strings. Monthly minimum500000
minor applies to price, not the cash remaining after referral credit. Monthly
group limits remain0/1/3, not a pooled three-month entitlement.

Never: provider requests, live activation, catalogue rows, consent changes,
production mutations, push/commit, nested agents, Drizzle generate, or old-suite
reruns. No owner authority to exceed existing test caps. The settlement test's
date correction remains unrun after8/9; it must not be represented as accepted.

## Interface and I/O

New `PostgresExpertCampaignOrderRepository(db).createCheckoutOrder` takes only
trusted `userId`, `expertId`, `quoteId`, `idempotencyKey`. Canonicalize UUIDs before
locks; require the established8..128 ASCII transport key. Return order/quote IDs,
copied financial/entitlement facts, actual status, deadlines and grant allocations.
No caller price, term, discount, time or credit authority.

| Given                                                   | When                                       | Then                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Active user owns active verified expert and valid quote | New checkout                               | One order and FIFO credit reservation; cash+credit=price                                                |
| Same expert/key/quote                                   | Replay, even after quote retirement/expiry | Same order, no repricing or extra reserve                                                               |
| Same key, changed quote or legacy order collision       | Checkout                                   | Typed idempotency conflict                                                                              |
| Already consumed quote, different key                   | Checkout, even after order expiry          | QUOTE_ALREADY_USED                                                                                      |
| Wrong owner, inactive user, inactive/unverified expert  | New or replay                              | Deny without writes                                                                                     |
| Pending order overdue                                   | Same-key replay                            | Commit expiry and original-grant release once; return expired status                                    |
| Quote or grant expires while waiting for authority      | New checkout                               | Fresh clock rejects quote or excludes expired credit; no partial consumption                            |
| Concurrent same-key or same-quote commands              | Checkout                                   | One order/reservation; deterministic replay or conflict                                                 |
| Forged snapshot, reused quote or financial rewrite      | Direct SQL                                 | Reject; lifecycle status transitions remain possible                                                    |
| Campaign order receives verified payment                | Settle/replay/reverse                      | Stored cash/duration; consecutive paid interval; V2 referral maturity and reversal, no duplicate reward |

## Code Map and Owned Files

- New `packages/db/src/repositories/expert-campaign-order-repository.ts`: checkout.
- `packages/db/src/schema/expert-residency.ts` and `packages/db/src/index.ts`:
  campaign order fields/export only; preserve unrelated edits.
- New next migration, expected0048 (verify journal), matching journal and
  PostgreSQL17.5-derived snapshot/state: unique nullable campaign_quote_id FK,
  campaign_term_months, strict source/immutability checks. Never change0032/0047.
- `packages/db/src/repositories/expert-residency-provider-inbox-repository.ts`:
  only campaign dispatch through existing V2 referral maturity; preserve current
  reviewed atomic expiry/operator path.
- Existing `expert-residency-repository.ts`: read/reuse exported
  expireLockedExpertResidencyOrder, no unrelated refactor or ownership transfer.
- New `tests/integration/expert-campaign-orders.test.ts`: genuine checkout and
  campaign-settlement regressions, not a renamed exhausted suite.
- New `docs/test-evidence/expert-campaign-checkout-2026-10-12.md`: exact runs,
  matrix coverage, migrations, remaining risks and handoff.

## Tasks & Acceptance

- [ ] Write compileable scaffold and real PG tests first, then observe RED.
- [ ] Hand-author migration and matching schema. Given campaign insertion, source
      checks bind quote owner through expert, tariff, price, duration, all entitlements,
      valid quote and active source. Only campaign orders require campaign fields;
      legacy policies prohibit them. Unique quote linkage is the consumption fact.
      Reject financial UPDATE/DELETE and relabeling involving a campaign order.
      Protect identity, policy, key, amount/split, term, deadlines, creation and snapshot;
      permit existing payment/refund/expiry lifecycle writes.
- [ ] Implement transactional checkout and exact replay. Validate ownership and
      active eligibility even on replay. New consumption rechecks source retirement;
      replay does not. Provider deadline equals quote.expiresAt; payment deadline is
      its minimum with allocated grant expiry. Set fresh creation time so PostgreSQL
      historical transaction timestamps cannot create invalid expiry combinations.
- [ ] Preserve document/subject authority before user rows; SERIALIZABLE checkout
      uses existing control→expert ordering. For this new branch only, bound waits
      with transaction-local lock_timeout250ms and at most3 whole-transaction attempts
      on40001/55P03/40P01, releasing all locks between attempts. Exhaustion returns a
      content-free contention error. Include implicit FK waits; do not claim absence
      of deadlocks from isolation alone or change shared retry helpers. Read fresh
      clock after locks; allocation expiry predicates must use that clock.
- [ ] Route campaign settlement through existing V2 first-payment marker and
      30-day reward maturity, not legacy immediate reward or policy fallthrough.
      Prove cash, saved duration, replay, reversal and marker uniqueness.
- [ ] Reconstruct0048 metadata on isolated PG17.5; preserve all prior hashes.
      Main coordinator owns repository migration guards; report exact added objects.
- [ ] Complete scoped static checks and independent review; leave final PG3 to
      coordinator. Actual API/Telegram/promo/provider composition is downstream and
      remains required before activation, not excused by this storage increment.

## Literal Test Matrix

With sufficient valid credit: PRO first-stage1month price599400,credit179820,
cash419580,duration2592000; PRO first-stage3months1528470/458541/1069929,
duration7776000; START3month floor1500000/450000/1050000; PRO second-stage3months
1888110/566433/1321677. With only100000 credit against599400 cash499400.
Pin immutable fields, source mismatch, failed transaction rollback, active-owner
changes, exact quote expiry, retirement, all idempotency cases and FIFO grant
mapping. Real authority waits must be observed in PostgreSQL before release;
test-side pauses before SQL are not lock evidence. Concurrent checkout/settlement/
maturity/reversal/expiry must conserve credit and terminate or return bounded
contention without partial writes. Use actual timestamp decoder conventions.

## Verification

Run `pwsh -File scripts/check-development-environment.ps1 -RequireDocker` first.
Use retained synthetic PG17.5 via II_TONYA_TEST_POSTGRES_ADMIN_URL; no live DB.
New focused file: RED1 and GREEN2 only for implementer, final3 reserved for main.
If RED1 is a fixture failure, report it honestly; correctedRED2 then code/static
and coordinatorGREEN3 is permitted within the same3 total. Never spend a fourth
run without owner approval. No full or multi-path command. Check DB/shared-test
types, scoped lint/formatting and git diff --check. Metadata reconstruction is
not a substitute for integration results. Report exact tested/unexecuted cases.

## Design Decisions

Existing owner decisions and the campaign quote plan authorize this increment;
no new commercial pricing choice is made. Quote expiry is the payment-window
ceiling; cost is a short window near expiry, to display in later UI. Bounded lock
contention may require a client retry under load; it must never create duplicate
orders. This delegated technical choice does not authorize activation or refund.
