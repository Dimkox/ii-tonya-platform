# Partner Commerce and Acquisition Economics Design

**Date:** 2026-08-30  
**Status:** Approved in chat on 2026-08-30
**Owner:** Dmitry  
**Base:** `1b730cddf75d1b0cc670d263339afccae1eedd69`  
**Extends:** `2026-08-28-free-client-hybrid-platform-v2-design.md`

## 1. Objective

Add training/wellness/retreat centers and event organizers as separately priced
commercial participants without changing the approved expert tariffs or mixing partner
qualification with expert bonuses and client coupons. Keep one visible messenger
dialogue, move every deterministic and financial decision to the platform, and limit
Selarti to bounded complex-language work whose acquisition cost is explicitly approved.

This amendment also replaces the previous acquisition assumptions with measured planning
inputs for the free 100-message client trial and the 300-message expert sales dialogue.
It does not activate YooKassa, Selarti, a messenger provider, or production tariffs.

## 2. Scope and non-goals

### In scope

- participant onboarding for `EXPERT`, `CENTER`, and `ORGANIZER`;
- separate immutable partner tariff policies and residency-order snapshots;
- partner attribution codes whose only commercial effect is tariff qualification;
- monotonic center/organizer qualification tiers;
- event-publication entitlements and commission assessment;
- acquisition budgets, prompt versions, evaluation cohorts, and cost telemetry;
- deterministic routing through the existing single-dialogue gateway;
- additive schema, fail-closed provider boundaries, observability, rollout, and rollback.

### Not in scope

- changing expert tariff prices `3,900 / 5,900 / 9,990 RUB`;
- raising any expert tariff above `9,990 RUB`;
- granting center/organizer codes coupons, bonuses, gifts, cash, or ledger credit;
- activating YooKassa before its API contract and credentials are supplied and separately
  approved;
- estimating event commission from unverified attendance or self-declared aggregate GMV;
- allowing Selarti or prompt output to choose a participant kind, price, tier, referral
  owner, entitlement, payment state, booking state, or commission;
- universalizing every expert and partner product into one generic pricing engine.

## 3. Architectural decision

Create a separate `Partner Commerce` bounded context for centers and organizers. Reuse
shared platform primitives—identity, approval, payment observation, outbox, audit,
idempotency, and reconciliation—but do not expand the existing expert commercial tables
with polymorphic partner rules.

The existing Commercial Core V2 migration constrains expert tariffs and entitlements to
the approved expert product. Centers and organizers have different prices, event quotas,
qualification rules, and referral semantics. A separate context preserves those
invariants and avoids a destructive or ambiguous migration. A universal tariff engine is
deferred until at least two implemented partner products demonstrate a real common model.

## 4. Participant identity and onboarding

One user may own more than one commercial participant profile. `participant_kind` is not
a global user role.

Supported kinds:

| Kind        | Meaning                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| `EXPERT`    | Individual expert using the existing expert-residency product                                              |
| `CENTER`    | Training center, studio, salon, retreat/wellness/massage or similar center with a stable team and location |
| `ORGANIZER` | Organizer of events, festivals, retreats, travel, or comparable programs                                   |

The messenger flow asks the applicant to choose the kind before presenting tariffs or
issuing a referral code. The selection is a typed, deterministic platform command and is
confirmed before profile creation. Repeated delivery with the same idempotency key returns
the original result; a conflicting kind selection requires an explicit user correction
flow and an audit fact.

Onboarding state is server-owned:

```text
started -> kind_selected -> profile_incomplete -> profile_ready -> offer_available
        -> checkout_pending -> resident
```

Prompt output may explain a state but cannot transition it.

## 5. Partner tariffs

All partner policy versions are immutable and effective-dated. An order snapshots the
policy version, qualification count, tier, base price, surcharges, final price, period,
event entitlements, and commission terms. A settled order is never recalculated.

### 5.1 Center tariff

| Qualified invited experts |   Base residency price |
| ------------------------: | ---------------------: |
|                     `0-5` | `15,000 RUB / 30 days` |
|                     `6-9` | `12,000 RUB / 30 days` |
|                     `10+` |  `8,000 RUB / 30 days` |

Included per paid 30-day period:

- ten event publications;
- up to 30 participant seats per included event;
- no commission on the first 30 seats of an included event;
- 10% commission on verified revenue from seats above 30;
- from the eleventh event, 10% commission on all verified event revenue.

### 5.2 Organizer tariff

| Qualified invited experts |   Base residency price |
| ------------------------: | ---------------------: |
|                     `0-5` | `20,000 RUB / 30 days` |
|                     `6-9` | `15,000 RUB / 30 days` |
|                     `10+` | `10,000 RUB / 30 days` |

Included per paid 30-day period:

- five event publications with capacity up to 50;
- three event publications with capacity from 51 through 100;
- one event publication with capacity from 101 through 500;
- each event consumes the smallest fitting available entitlement;
- entitlements cannot be moved between capacity bands or carried into another period;
- events beyond the available count pay 10% of all verified event revenue;
- seats above an included capacity pay 10% only on verified excess-seat revenue.

### 5.3 Common partner rules

- `online-only` adds `3,000 RUB` to the selected partner tier.
- a verified city-million-plus location adds `5,000 RUB` to the selected partner tier.
- both surcharges may apply together.
- there is no low-average-ticket discount.
- these surcharges do not apply to existing expert V2 tariffs.
- a nonresident center or organizer pays 15% of all verified event revenue plus a
  `4,500 RUB` event-card charge for each accepted publication.
- the `4,500 RUB` charge does not change the existing expert V2 event-card rule.

## 6. Partner qualification and attribution

Every invited expert has at most one acquisition source across expert, center, and
organizer programs. The first valid, atomic redemption wins. Replayed or competing codes
cannot overwrite attribution.

A center/organizer attribution becomes qualified only when:

1. the invited expert has not previously registered or redeemed another source;
2. the invited expert completes a first residency payment observed as settled by the
   authoritative payment adapter;
3. the settlement remains unreversed through the 30-day qualification window.

Qualification creates no money-like ledger entry. It only appends a qualification fact
and may advance a partner tier:

```text
0-5 -> 6-9 -> 10+
```

Tier movement is monotonic and permanent. It never downgrades because an invited expert
later leaves, and it remains attached to the partner after a residency interruption. A
newly reached tier applies to the next partner order; no settled or pending order is
repriced. Counts above ten remain observable but create no additional privilege.

Client invitations from centers and organizers are attribution-only analytics. They do
not issue coupons, bonuses, gifts, discounts, or tariff changes.

The existing expert referral program remains separate: it may mature expert credit under
its approved rules, but the same invited expert cannot simultaneously qualify a partner.

## 7. Event accounting

Operational truth is split into append-only facts:

- publication acceptance and its residency-period entitlement snapshot;
- authoritative ticket/payment revenue observations;
- refunds and chargebacks;
- reconciled revenue allocated to included and excess seats;
- commission assessments and reversals.

An event cannot consume more than one entitlement. Concurrent publication requests lock
the applicable residency period and entitlement counters. Same idempotency key with a
different event payload is a conflict.

Excess-seat commission requires per-seat or ticket-class revenue evidence. If the payment
source provides only aggregate revenue and the included/excess allocation cannot be
proved, the assessment enters `manual_reconciliation_required`; the platform does not
invent an average ticket price. Refunds append compensating commission facts rather than
rewriting settled assessments.

## 8. Data model

All migrations are additive.

| Table                             | Purpose                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `commercial_participants`         | User-owned participant profiles and deterministic onboarding state                             |
| `organization_profiles`           | Center/organizer facts, verified location, online-only flag, verification state                |
| `partner_tariff_policy_versions`  | Immutable prices, tier thresholds, surcharges, entitlements, and commission rules              |
| `partner_residency_orders`        | Immutable quote/order snapshots and payment lifecycle                                          |
| `acquisition_attributions`        | Globally unique invited-expert source ownership                                                |
| `partner_qualification_facts`     | Append-only pending, qualified, cancelled, and reversal facts                                  |
| `partner_tier_locks`              | Monotonic effective tier history                                                               |
| `partner_event_entitlement_usage` | Atomic event quota consumption tied to a residency order                                       |
| `event_revenue_facts`             | Authoritative settlement/refund observations                                                   |
| `event_commission_assessments`    | Append-only commission and reversal facts                                                      |
| `acquisition_budget_versions`     | Approved cohort, period, RUB/message caps, and stop conditions                                 |
| `prompt_experiment_assignments`   | Stable prompt variant assignment and consented experiment state                                |
| `conversation_cost_facts`         | Provider usage, estimated/actual RUB cost, route reason, and outcome without raw dialogue text |

Financial and attribution constraints are enforced in PostgreSQL transactions, not only
application code. Existing expert, client coupon, package-history, payment, and referral
tables remain unchanged.

## 9. API and event contracts

Application capabilities:

- start onboarding and confirm participant kind;
- create/update the relevant profile under authenticated ownership;
- list current server-approved partner offers;
- quote and create a partner residency order;
- redeem an attribution code;
- show partner qualification statistics;
- submit an event publication and return entitlement/commission status;
- ingest authenticated payment/revenue observations;
- reconcile ambiguous event revenue.

Events describe completed business facts and are emitted through the transactional
outbox:

- `participant.kind_selected.v1`;
- `partner.expert_attributed.v1`;
- `partner.expert_qualified.v1`;
- `partner.tier_locked.v1`;
- `partner.residency_settled.v1`;
- `event.publication_accepted.v1`;
- `event.revenue_reconciled.v1`;
- `event.commission_assessed.v1`.

Every endpoint and consumer has stable idempotency, authenticated ownership, bounded
payloads, correlation IDs, and audit facts. External timeout after send is an unknown
outcome and is reconciled before retry.

## 10. Single-dialogue and Selarti boundary

```text
messenger webhook
  -> platform inbox and identity
  -> stateful deterministic router
       -> onboarding / tariff / attribution / checkout / event workflow
       -> allowlisted complex-language request to Selarti
  -> one ordered transactional outbox
  -> the same messenger account and dialogue
```

The platform is the only messenger ingress and egress coordinator. Selarti receives
minimum consented context and returns bounded natural-language content. It has no direct
bot token, webhook ownership, messenger-send path, financial tools, or database mutation
authority.

The deterministic router owns commands, buttons, participant selection, tariffs,
qualification, budgets, checkout, events, balances, privacy, safety, and exact FAQ data.
Free text reaches Selarti only when an allowlisted route reason and an approved acquisition
or operating budget both permit it.

## 11. Acquisition economics

Planning inputs:

| Input                            |                                              Value |
| -------------------------------- | -------------------------------------------------: |
| Selarti plan                     |       `$360/month`, 20,000 included billable units |
| Overage                          |                           `$0.03/billable message` |
| Selarti FX                       |                    Bank of Russia USD/RUB `x 1.10` |
| Current effective FX             |                                 `94.54951 RUB/USD` |
| Stress FX                        | current effective FX `x 1.60 = 151.279216 RUB/USD` |
| Client free test                 |                                       100 messages |
| Expert sales test                |                                       300 messages |
| Expected conversion              |         `5%-10%`; sensitivity also `15%` and `20%` |
| Average expert lifetime          |                                         2.5 months |
| Monthly replacement rate         |                                    `1 / 2.5 = 40%` |
| Expert discount/referral leakage |                            `8%-16%` of listed ARPE |

The all-in marginal message estimate includes overage plus the existing token allowance
allocated per billable message. Resulting acquisition cost per conversion:

| Conversion | Client 100 messages, current / stress | Expert 300 messages, current / stress |
| ---------: | ------------------------------------: | ------------------------------------: |
|         5% |                   `6,184 / 9,894 RUB` |                 `18,552 / 29,683 RUB` |
|        10% |                   `3,092 / 4,947 RUB` |                  `9,276 / 14,842 RUB` |
|        15% |                   `2,061 / 3,298 RUB` |                   `6,184 / 9,894 RUB` |
|        20% |                   `1,546 / 2,474 RUB` |                   `4,638 / 7,421 RUB` |

Expert LTV after the modeled operating costs and leakage is approximately:

| Scenario    |  8% leakage | 16% leakage |
| ----------- | ----------: | ----------: |
| Current     | `7,251 RUB` | `6,348 RUB` |
| Stress +60% | `5,371 RUB` | `4,468 RUB` |

Required expert conversion:

| Condition      |       Current |   Stress +60% |
| -------------- | ------------: | ------------: |
| `CAC <= LTV`   | `12.8%-14.6%` | `27.6%-33.2%` |
| `LTV/CAC >= 3` | `38.4%-43.8%` | `82.9%-99.7%` |

Steady-state monthly break-even below includes 40% replacement churn and the expert
sales-test cost. It excludes client trials, centers, organizers, and event commission
because their cohort volumes and verified GMV are not yet known:

| Leakage | Conversion | Before founder salary |    Founder + support |           Small team |
| ------: | ---------: | --------------------: | -------------------: | -------------------: |
|      8% |         5% |  no finite break-even | no finite break-even | no finite break-even |
|      8% |        10% |  no finite break-even | no finite break-even | no finite break-even |
|      8% |        15% |            20 experts |          203 experts |          880 experts |
|      8% |        20% |            19 experts |          122 experts |          465 experts |
|     16% |         5% |  no finite break-even | no finite break-even | no finite break-even |
|     16% |        10% |  no finite break-even | no finite break-even | no finite break-even |
|     16% |        15% |            22 experts |          333 experts |        1,739 experts |
|     16% |        20% |            22 experts |          159 experts |          628 experts |

Under the 60% stress assumptions, 5%-20% conversion has no finite monthly break-even:
at 20%, each additional active expert still reduces monthly contribution by approximately
`257-598 RUB` before fixed-cost coverage.

Therefore 15%-20% is only a simple current-rate break-even range, not a sustainable
acquisition target. At 20% conversion in the stress case, approximately 60-72 paid
messages—not 300—are required to approach `LTV/CAC >= 3`, absent higher LTV.

The free client trial has no direct payback while ordinary-client revenue is zero. A
client conversion becomes economically meaningful only after the platform defines an
authoritative paid target such as a settled expert booking and its platform margin. Until
average booking value, settlement rate, repeat rate, coupon redemption, and platform take
rate are measured, client trials are budgeted acquisition cost rather than revenue.

Partner tier discounts are acquisition consideration rather than free revenue. Using the
listed expert ARPE of `5,109 RUB/month`, the gross ecosystem revenue sensitivity before
leakage, acquisition, tax, support, event costs, and partner churn is:

| Partner state                       | Partner revenue | Referred-expert listed revenue | Combined gross revenue | Discount from full partner tier |
| ----------------------------------- | --------------: | -----------------------------: | ---------------------: | ------------------------------: |
| Center with 6 qualified experts     |        `12,000` |                       `30,654` |     `42,654 RUB/month` |               `3,000 RUB/month` |
| Center with 10 qualified experts    |         `8,000` |                       `51,090` |     `59,090 RUB/month` |               `7,000 RUB/month` |
| Organizer with 6 qualified experts  |        `15,000` |                       `30,654` |     `45,654 RUB/month` |               `5,000 RUB/month` |
| Organizer with 10 qualified experts |        `10,000` |                       `51,090` |     `61,090 RUB/month` |              `10,000 RUB/month` |

These figures do not establish partner profitability. The model must be rerun when
partner lifetime, support cost, event GMV/refunds, attribution volumes, and whether the
partner-sourced experts still consume the paid 300-message sales test are observed.

## 12. Acquisition budgets and prompt experiments

Paid trials require a separate immutable acquisition-budget approval; the operating
Selarti cap tied to residency revenue cannot silently fund them. A budget snapshots:

- participant/client cohort and maximum entrants;
- start/end timestamps;
- prompt/model versions;
- maximum messages per dialogue;
- RUB warning and hard-stop amounts using the configured Selarti FX uplift;
- target conversion and maximum CAC;
- safety and financial-authority evaluation versions;
- operator approval and rollback rule.

Prompt optimization uses stable A/B assignment. Conversion is a first authoritative
settled residency, never a click or AI assertion. Experiments record quality, refusals,
handoffs, latency, billable messages, current/stress CAC, settlement conversion, and
reversals. They stop automatically when the hard budget is exhausted, the financial
boundary is violated, safety eval fails, or confidence-bounded CAC exceeds its approved
ceiling.

The first expert experiment compares the existing 300-message path against deterministic
qualification plus a Selarti cap of 72 messages. It does not optimize through deception,
pressure, fabricated scarcity, or unverified performance claims.

## 13. Rollout and rollback

Delivery is split into independently disabled vertical releases:

1. participant onboarding and deterministic routing;
2. partner pricing and shadow quotes;
3. attribution, qualification, and tier locks;
4. partner orders and provider-disabled checkout;
5. event entitlements, revenue reconciliation, and commissions;
6. prompt experiments and acquisition budgets;
7. canary activation for one participant kind and a bounded cohort.

Each release has a separate feature flag. Rollback stops new assignments, quotes,
redemptions, publications, or AI admissions while continuing reconciliation of already
accepted payment and event facts. Additive migrations and append-only financial history
are retained; settled orders, attribution ownership, and tier locks are never deleted or
downgraded.

## 14. Acceptance criteria

- Expert V2 tariffs and expert referral credit behavior are unchanged.
- Applicant kind selection is deterministic, authenticated, idempotent, and auditable.
- One user may own multiple participant profiles without role collision.
- Center/organizer codes never create coupon, bonus, gift, cash, or expert-credit facts.
- An invited expert has one immutable acquisition source.
- Partner qualification requires authoritative first settlement plus 30 unreversed days.
- Partner tier only improves, survives interruptions, and affects only future orders.
- Quotes and event entitlements reproduce exactly from immutable policy/order snapshots.
- Concurrent publication cannot over-consume an event entitlement.
- Excess-seat commission is assessed only from authoritative allocatable revenue.
- Selarti cannot mutate participant, financial, referral, event, booking, or delivery state.
- Replayed webhooks/events cannot duplicate orders, attribution, qualification, quota use,
  payment, or commission.
- Paid AI trials fail closed without an active approved acquisition budget.
- Cost telemetry reproduces current/stress CAC for 5%, 10%, 15%, and 20% conversion.
- Feature rollback preserves accepted facts and reconciliation duties.

## 15. Required evidence before activation

- focused unit and PostgreSQL concurrency tests for every invariant;
- API/event contract tests and migration verification;
- prompt safety/authority evaluation set and A/B assignment tests;
- current/stress unit-economics report from authoritative usage facts;
- YooKassa and Selarti authenticated staging fixtures when their APIs are supplied;
- independent architecture, security, test, and release reviews;
- exact-SHA CI/Database Gate evidence;
- explicit human authorization for production tariff publication and provider activation.
