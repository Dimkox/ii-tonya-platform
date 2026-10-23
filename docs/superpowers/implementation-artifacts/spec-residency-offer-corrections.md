---
title: Correct the paid residency funnel and automatic personal offer lifecycle
type: feature
created: 2026-10-23
status: completed
baseline_commit: 0d004a71689393f65605703193e728ebdfa44057
review_loop_iteration: 1
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
  - docs/test-evidence/phase1-through-phase2-coverage-2026-10-23.md
---

<frozen-after-approval reason="owner supplied final corrections and already directed autonomous implementation without approval loops">

## Intent

Implement the latest owner message completely in the existing isolated worktree,
branch codex/phase1-owner-plan-20261023. Preserve the previously verified financial
boundaries; correct parallel onboarding/materials and automate current offers.
The existing manager approval ALREADY invoices only300000 kopecks; keep this fact,
add explicit ONBOARDING_FEE/MAIN_SUBSCRIPTION purpose routing without trusting webhook
metadata. Existing paid orders, v1 quotes, receipts and historical source archives
remain immutable. No annual billing.

## Boundaries & Constraints

Always use integer kopecks and PostgreSQL clocks/transactions. New rules are an
additive version, not a rewrite of0047/v1 arithmetic or accepted payment snapshots.
Use current admin-approved category tariff rates, never archival12k/20k claims.
Persist owner-scoped structured city/format/ticket qualifications and their revision;
the server computes modifiers, and manager verification binds/checks the facts before
payment. No caller/LLM price, discount, clock or provider fact has authority.

The first issued personal offer after base modifiers starts one immutable timer.
Carry forward the earliest authoritative existing first-offer anchor on upgrade;
changing tariff/profile/policy or verification must not reset it. Full elapsed days
0–3/4–6/7–9/10+ mean96/168/240h boundaries, discounts40/30/20/0percent.
Base = approved category rate +500000 if million-city +300000 if online-only
−100000 if ticket<300000. Compute monthly and package prices separately, round
half-up to kopecks once per result. Monthly floor500000, package floor1500000.
Expert package3months: additional15percent in first window,10percent second;
unavailable from day7. Space calculator uses the same new schedule and floor,
additional10percent package discount; this supersedes conflicting historical text.
Space base rates must be explicitly approved/configured, never invented from an
unapproved partner fixture. Preserve30/90-day residency durations.

Fee success opens interview AND enqueues application-bound generic materials
immediately. Prefer the existing verified promo-bot identity for early delivery;
do not infer a work-bot identity before trusted handoff. Missing templates yield
AWAITING_MATERIALS and exactly “Ваши материалы для рассылки будут доступны в ближайшее время”.
They do not block raw interview, promo-proof submission or manager review. No fake
sent receipt. Promo confirmation is application-bound and can precede card approval;
actual main invoice/publication still require paid onboarding, manager-confirmed
promo, current approved card, owned current terms and original consent. A missing
material file cannot masquerade as delivery or block this new confirmation path.

Offer recalculation/reminders run independently of verification every15minutes.
Main payment links are generated only after those gates, despite the pricing
message's generic “immediately” wording. Fixed3000 fee never gets campaign discounts.
After gates, initial period/schedule selection authorizes issuance of replacement
offers/invoices (never autocharge); persist this real owner evidence, do not forge
fresh explicit acceptances or Telegram updates. Expire old orders locally at stage
change, preserve late verified financial truth without activating an expired price,
and create/deliver the new bound link automatically. Never claim provider-side
cancellation of pending payments: YooKassa only cancels waiting_for_capture.
Three-month expiry requires a real one-month selection, no silent downgrade.
After day10 use a separately declared bounded operational TTL (24h capped by
approved tariff validity), not a fictitious next discount stage.

Enqueue unique24h/3h stage reminders, with catch-up/no stale duplicate sends.
“Мой актуальный тариф” shows both current prices, first-offer date, remaining time
and currently permitted payment link; no manual-recalculate button. Pending gates
show readiness, never an early MAIN link. Paid/erased/revoked acquisitions stop
automatic acquisition invoices. Expose offer_start_date,current_discount_stage,
locked_price_monthly,locked_price_package,payment_link_expires_at as owned projection
fields over authoritative normalized money/time storage, not duplicate balances.

Keep exact TODO: Wait for PDF and TODO: Wait for Prompt Spec slots. Two unique
referrals create a single durable “Ready to send” log event without sending any PDF
or logging identity/raw content. Keep original frozen bonus policy unchanged.
Add read-time ARCHIVED/archive_until_date/lifecycle pause exclusion to actual client
catalog/search/discovery/booking admission, rather than depending on worker timing.
Add real Telegram manager queue notifications and approve/reject actions backed by
the existing admin-role/fresh-MFA authority, signed scoped callbacks and one-time
trusted staff pairing. A raw Telegram ID alone cannot approve payment. Preserve
the existing staff web UI. Transport capabilities remain default-off.

Never push, deploy, activate providers, print/copy secrets or rewrite shared history.
The prior task-wide focused-run override continues for these owner-plan corrections;
record runs and diagnose failures before reruns, no blanket old-suite repetition.

## I/O & Edge-Case Matrix

| Scenario                            | Expected behavior                                                     |
| ----------------------------------- | --------------------------------------------------------------------- |
| Manager approves any tariff         | Fixed3000 onboarding link only, no residency grant                    |
| Fee verified; card not approved     | Raw interview and generic materials proceed in parallel               |
| Assets absent; promo proof supplied | Waiting-material status remains honest; manager can verify proof      |
| Base900000 at first offer           | Month540000; expert package1500000 after floor                        |
| First offer +96h/+168h/+240h        | Exact new stages; no timer reset or unauthorized quarter              |
| Price transition before gates       | New price/reminders, no early main payment link                       |
| Old/duplicate/late provider event   | Stored purpose/owner/mode binding, money truth, no expired activation |
| Archived flag/date before worker    | Card absent and new booking denied at read/admission time             |
| Unpaired/stale manager callback     | No decision or payment side effect                                    |

</frozen-after-approval>

## Code Map

- `packages/domain/src/expert-campaign-price.ts` — frozen v1 arithmetic; add v2.
- `packages/db/src/repositories/expert-campaign-quote-repository.ts` — v1 anchor,
  immutable quote and15min TTL;0047/0048/schema enforce those rules.
- `packages/db/src/repositories/expert-verification-repository.ts` — fixed fee proof.
- `packages/db/src/repositories/expert-card-repository.ts` — currently post-review
  materials/proof gates; add separate parallel/application-bound policy.
- `packages/db/src/repositories/expert-card-main-gates.ts` — canonical activation.
- `packages/db/src/repositories/catalog-repository.ts` and `booking-repository.ts`
  — current active/verified reads need current archive fences.
- `packages/application/src/expert-prompt-context.ts` — typed runtime read context.
- `docs/source/ii-tonya-expert-full-source-2026-07-28.txt` and source manifest —
  immutable archive; requested demo_access_test_expert.md is absent. Add working
  prompt assets/overlay with new version/digests, preserving old archive pins.

## Tasks & Acceptance

- [x] Domain v2 calculator + focused boundary/floor/kopeck/space tests; working
      demo/work prompt copies and shared runtime instructions. Report this first.
- [x] Versioned profiles/first offers/quotes and immutable schedule evidence;
      hand-authored SQL+journal+supported metadata, no drizzle-kit generate.
- [x] Purpose-separated fee/main callbacks, parallel application materials/proof,
      exact placeholders/logging, trusted Telegram manager actions and archive filters.
- [x] Actual bot menu and15min worker, reminders, expiry/automatic link recovery;
      reuse canonical checkout/GET/erasure/custody and notification quarantine.
- [x] Focused TDD, new integrated tests with heavy setup in bounded hooks, relevant
      types/build/lint/format/diff, exact repo guard inventories, independent review.
      Commit tested blocks locally; preserve failed logs and final coverage evidence.

Given any matrix input, the corresponding actually executed test must prove its
outcome. Given a clean final checkpoint, the branch gate must pass without bypass.

## Spec Change Log

## Verification

Execution lead owns source/tests/artifacts and per-file disjoint assignments;
coordinator owns independent audit/final gate. Use BMad/Superpowers implementation,
TDD and review steps, without another design/permission cycle already waived by
the owner. Independent work may run only within this correction block. The lead
may resolve ordinary implementation choices from the source and these invariants;
report actual conflicts instead of weakening financial/security authority.

### Local implementation checkpoint

All implementation tasks and focused matrix checks are complete locally. Final
new PostgreSQL files passed activation admission3/3 and personal offers10/10;
scheduled finance4/4, materials8/8, archive3/3, manager5/5, late money2/2 and future
admission1/1 passed. Calculator64/64, prompt31/31 and ingress12/12 are preserved.
Builds, complete types and scoped lint pass. Independent financial and materials
review findings are remediated; historical V1 compatibility retains its explicit
provenance and dynamic-gate boundary. See the consolidated local evidence.

Status remains `in-review` pending the coordinator's exact clean-commit branch
gate. No push, provider activation or release authority follows from this state.
