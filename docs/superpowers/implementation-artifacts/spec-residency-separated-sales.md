---
title: Separate base sales and freeze residency terms on verified onboarding payment
type: feature
created: 2026-10-26
status: in-review
baseline_commit: 66cb3fd5d2bf18ce3da29d3cca17cbe39ab8aa7b
review_loop_iteration: 0
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
  - docs/source/residency-phase1-owner-2026-10-26/sales-technical-final-correction.txt
  - docs/source/residency-phase1-owner-2026-10-26/phase1-final-comprehensive.txt
---

<frozen-after-approval reason="latest owner specifications explicitly approve this flow and autonomous execution without routine approval loops">

## Intent

Existing promotion-first quotes, pre-price intake fencing and post-fee repricing
contradict the latest owner contract. Extend the real promo→verification→payment
path: base-only offer, explicit positive response, separate promotion choice,
verification, manager-approved fixed3000 fee, then permanent selected main terms
on genuine fee settlement. Main payment and full access remain separate.

## Boundaries & Constraints

**Always:** PostgreSQL owns authority, integer minor-unit arithmetic, immutable
snapshots, clocks, replay and financial facts. Node24/pnpm11.9; additive SQL+journal.
Version the new cohort/rule; retain v1/v2 issued and paid contracts and prior intake
snapshots. A genuine current-owner transition may upgrade an unpaid intake; never
silently enroll historical paid contracts. Preserve consent, private bot identity,
manager fresh MFA, revisions, erasure, capped bonus ledger and all publication gates.

Persist first base amount/source and base_offer_shown_at exactly once after
qualification; later profile/rate changes cannot restart or change that offer.
Use approved category rates and modifiers +5000million-city/+3000online/-1000ticket
below3000. Distinguish undecided from declined; promo_accepted_flag only follows an
explicit owner selection. Base-only response has no promotional price. Positive
base response permits a separate promo message, not promo acceptance. Reuse
existing objections; free-form exhaustion or LLM intent never grants acceptance.

Keep v2 full-day96/168/240h windows:40/30/20/0percent; early package15/10percent,
space package10percent; monthly floor5000 and quarter floor15000 after calculations.
Explicit1/3month choice; packages unavailable from168h until genuinely locked.
A paid three-month choice locks that selected package total/period for renewal;
do not promise an unselected alternative. Day10 STANDARD_TARIFF_LOCKED means
standard-only offers, not paid access. final_locked_price stays NULL until valid
actual fee settlement. Persist explicit monthly/package/selected total semantics.

Selection leads to existing role-aware form and submitted-revision manager queue.
Manager approval alone authorizes the fixed300000minor RUB onboarding invoice;
no main subscription charge and no promo discount on the fee. Reuse real manager
approval authority and legacy payment/admission services through a versioned
owner-bound bridge. Preserve submitted documents; show real form and chosen terms.

Bind each fee attempt to exact approved selection, policy, period, amount and window.
Implement finite checkout validity independently of lifetime commercial terms.
15-minute scheduler refreshes unpaid stages and24h/3h reminders with durable scoped
receipts and final consent/state checks. Never invoice on silence or invent approval.
Unavailable quarter requires fresh owner selection, never silent monthly conversion.
After fee lock, initial main invoice AND automatic/explicit renewals reuse its terms
through a new validated quote source, regardless of elapsed campaign/tariff retirement.

Local expiry is not YooKassa pending cancellation. For new strict-expiry collection,
use a separately gated supported two-stage provider path (capture:false): durable
GET-verified waiting-payment authority before capture; cancel stale authorized
objects only when supported. Pending URLs may remain externally open, but stale
objects must never be captured by this path. Unsupported methods/capabilities stay
unavailable, never fall back to capture:true. Reuse receipt/consent custody; persist
exact request/idempotency before sends and recheck actual first-disclosure authority.
Deletion cancels any send not begun; no previously rejected grace-period authority.
Unknown create/capture/cancel cannot become blind POST/replacement. Reconcile actual
GET facts, including waiting/canceled/succeeded, without trusting webhook payloads.

Every proven success remains an immutable money fact, even stale/duplicate/erased.
An on-time capture reported late may lock its bound terms if no prior winner and
current admission allows; capture at/after expiry cannot lock the expired price.
Serialize settlement/expiry/winner decisions; at most one lifetime lock. Ineligible
success creates explicit recovery/refund-review work without automatic invented
refund or access. A manager interview exception cannot manufacture a paid price lock.
Fee success atomically locks and admits interview; it never activates public/main
access. Prompts and current-tariff readout reflect state and first-offer clock.

**Ask First:** Deployment, provider activation or actual money operations.
**Never:** Rewrite historical migrations, weaken guards, grant via booleans/LLM,
combine first base+promotion, reset clocks, lose financial facts, claim local expiry
cancels an external URL, or collect client payments for expert services. Other
package modules follow separately; preserve their current gates and TODO slots.

## I/O & Edge-Case Matrix

| Scenario      | State/input                                      | Expected behavior                               | Failure handling                            |
| ------------- | ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------- |
| Base          | Qualified owner, repeats/profile edit            | Same base/time; base-only message               | No discount or invoice                      |
| Choice        | Positive base, explicit promo/base and period    | Separate promo; durable chosen terms then form  | Stale/foreign/replay conflict denied        |
| Approval      | Submitted current form and fresh manager         | One fixed3000 invoice/attempt                   | No implicit main charge                     |
| Expiry        | Window boundary, silence, lost package           | Reprice only unpaid; scoped reminders/reissue   | No invented selection or blind resend       |
| Hold          | Current/stale waiting payment; unknown operation | Verified capture or supported cancel/recovery   | Unsupported stays unavailable               |
| Settlement    | Concurrent success/expiry/late delivery          | One valid lifetime lock; all money recorded     | Late/double fee recovery, no invalid grant  |
| Main/renewal  | Long interview, retired tariff, locked quarter   | Same selected locked total and period           | Existing quality/promo/payment gates remain |
| Privacy       | Withdraw/erase during first send or settlement   | Cancel unsent; preserve financial evidence only | No resurrection or PII logging              |
| Compatibility | Legacy v1/v2/intake, flags off                   | Existing issued/paid contracts preserved        | No generic cohort-fence bypass              |

</frozen-after-approval>

## Code Map

- `packages/domain/src/expert-campaign-price.ts:112`: reuse v2 arithmetic/boundaries, extract base-only calculation; no v1/v2 semantic rewrite.
- `packages/db/src/repositories/expert-offer-v2.ts:153,180,208,215`: current mutable source and earliest anchor. New immutable sales source must supersede only new cohort.
- `packages/application/src/expert-applicant-service.ts:146,221,259` and `apps/api/src/routes/expert-applicant-telegram.ts:78`: form currently intercepts sales and route accepts only rv callbacks. Extend normal composition and owned short callbacks/replay digest.
- `expert-applicant-composition.ts:38` in apps/api/src and `resident-verification-service.ts:169,243` in packages/application/src: actual dependency wiring and stale pre-price text.
- `packages/db/migrations/0057_resident_verification_form.sql:114,136`: frozen submitted form, absent manager outcomes, permanent cohort fence. Add narrowly versioned predicate/bridge; preserve old cohort tombstones and evidence.
- `packages/db/src/repositories/expert-verification-repository.ts:150,176,209,277,470`: queue/detail, genuine approval/invoice, branded settlement; extend rather than duplicate.
- `packages/db/src/repositories/expert-manager-authority.ts:15`: session/role and database-time fresh MFA after locks.
- `packages/db/migrations/0053_expert_verification_onboarding.sql:23,79,105`: one invoice per application/decision, operation custody and immutable facts; version attempt uniqueness and blocked reason rules explicitly.
- `packages/integrations/src/yookassa/client.ts:124`, onboarding-verifier.ts:80 and onboarding-webhook-capability.ts:13: current automatic capture, branded GET proof, waiting/canceled currently manual. Concrete checkout currently absent; injected capability is not runtime proof.
- `packages/integrations/src/yookassa/exact-body-recovery.ts` and DB yookassa-operation-repository.ts: existing custody patterns are residency-order scoped; no unsafe direct reuse for onboarding.
- `packages/db/src/repositories/expert-personal-offer-repository.ts:57,147` and application expert-personal-offer-service.ts:83: existing main-order refresh/reminders need separate new sales identities.
- `packages/db/src/repositories/expert-onboarding-main-payment-repository.ts:151` and expert-residency-lifecycle-repository.ts:621: initial and explicit/automatic renewal currently reprice; all must consume lock.
- `packages/db/migrations/0056_residency_offer_corrections.sql:60,89,172,283`: exact v2 quote/order SQL guards; add genuine new source branch rather than weaken history.
- `docs/prompts/residency-offer-v2-shared.md`, demo_access_test_expert.md, work_expert_residency_v2.md: active combined-offer scripts need versioned state-aware copy/provenance.
- Existing tests: expert-campaign-price, resident-verification-form, expert-offer-v2, expert-personal-offers, phase1-verification, phase1-residency-lifecycle; real normal ingress fixture resident-verification-composition.integration.test.ts.

## Tasks & Acceptance

- [x] Add immutable base/choices/paid lock, versioned quote/cohort/bridge and additive migration/schema/state/privacy/guards.
- [x] Wire base/positive/promo/base/period/form through actual private webhook and manager queue; update active prompts/current tariff.
- [x] Implement versioned fee attempts, strict held-payment adapter/recovery, current-state expiry/reminders and authoritative settlement.
- [x] Use paid lock for main and both renewal paths, preserving period and downstream admission gates.
- [x] Execute matrix acceptance, affected builds/types/lint and precise guard negatives; retain failed logs and hand off for independent review.

Actual Fastify→PostgreSQL flow must prove base-only, separate explicit choice, form,
manager approval and exactly300000 invoice. Real local transport fixtures must prove
provider request shapes, GET custody, timeouts and no stale capture. All matrix rows
need executed tests; an isolated helper or injected fake alone is not composition
acceptance. No live-provider success claim from synthetic evidence.

## Spec Change Log

## Execution Notes

Single fresh implementer owns source/tests/migrations and implementation evidence,
without descendants; root owns review, final gate, push/PR and coordinator evidence.
Assigned isolated worktree: /home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/phase1-owner-plan-20261023.
Use only its codex/separated-residency-sales-20261026 branch. Read AGENT-STATUS first.
Owner already waived routine approval/run-count/splitting loops; no new permission
question for coherent implementation. Do not rerender BMad or launch another lead.
If investigation reveals a concrete contradiction, report it to root before changing
frozen intent; continue independent authorized work. Do not hide missing composition.

Reuse ONE running task-owned PG17.5 cluster, project ii-tonya-verification-form-20261026,
loopback55483,1CPU/1GiB. Protected0600 /tmp/verification-form-20261026.compose.json is
authoritative; parse credentials only in memory into child environment, never print
config/URL/env or use stale container metadata. Serialize PG/metadata/heavy builds.
No extra cluster. Next migration0059; reconstruct state using committed procedure,
never drizzle generate. Exact guard registrations/negative probes, no classifier widening.

## Verification

RED before behavior changes, then focused green and all matrix cases actually run.
Rebuild domain/package dist before consumers. Retain raw complete logs with hashes;
separate filtered/skipped cases from full-file acceptance. Affected package/test
types, lint, formatting and diff-check before local commit. No unchanged broad
suite repeats, no repeat-tool count>3. Root runs canonical gate and independent
review. All integrations stay default-off without reviewed live capabilities.

Provider facts: https://yookassa.ru/developers/payment-acceptance/getting-started/payment-process
and https://yookassa.ru/developers/using-api/interaction-format (official sources).
Verify exact capture/cancel request contracts from primary docs before implementation;
no credentials, live charge, provider mutation or production enablement.

Execution clarification (2026-10-26, applies existing owner constraints): the
commercial choices are one month, or the promotional three-month package while
available. Declining promotion exposes monthly only; losing the unpaid package
requires an explicit monthly selection. A genuine paid quarter retains its exact
quarter total and period. The displayed base incorporates the monthly floor, so
accepting the base never produces a higher undisclosed floor later.

An explicit period change on the same frozen submitted form reuses its genuine
manager quality approval. It does not create a second verification decision.
Every replacement still binds the current explicit selection, original decision,
unchanged submitted revision, owner/consent, finite deadline and no paid winner.
The implementation does not introduce a second manager approval for period alone.

The requested application fields are exposed by `resident_sales_application`, a
canonical projection of the existing `residents_applications` row and immutable
sales facts; manager detail consumes it. `final_locked_price` is null until the
verified paid lock. Work-bot current-tariff reads show only the selected paid total
and period. New provider and sales flags remain off by default.

Implementation handoff evidence: `docs/test-evidence/residency-separated-sales-implementation-2026-10-26.md`.
Independent review and final exact-commit gate remain coordinator-owned; status stays
in-progress until those complete.


### Review remediation execution note — 2026-10-26

R1–R14 are implemented as an additive correction to the same frozen intent.
Private applicant receipt capture reuses encrypted finite-retention custody;
submission proof uses the frozen draft digest/time, and unchanged quality approval
survives supplemental answers and explicit period reselection. Audited fresh-MFA
operator GET recovery handles unknown creates. Notice preparation, current-choice
binding, replacement deduplication and exact price/deadline rendering are separate
from uncertain sends. Runtime form copy is sales-first only for the v3 cohort.
Migration0060 preserves0059 historical state; real erased forms cascade their
bridge and do not regain submission proof. Status remains in-review pending the
coordinator's bounded closure. See remediation evidence for raw failures and checks.
