---
title: Execute approved residency plan through Phase2
created: 2026-10-23
status: done
baseline_commit: 47e6680e9fdadf8416574afa003737691504b16a
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
  - docs/superpowers/plans/2026-10-23-phase-1-owner-plan.md
  - docs/test-evidence/phase0-guard-reconciliation-2026-10-23.md
---

<frozen-after-approval reason="owner expressly authorized all planned implementation and routine fixes">

## Intent and execution authority

The owner instructed: implement everything in the approved plan, fixing findings
along the way; do not wait for approval at each step. This is execution authority,
not another discovery/approval round. Persist through the authorized work. Existing
code is the base; extend and connect it. Missing content uses typed inactive slots
marked `TODO: Wait for Content Spec`, never fabricated content or delivery facts.

Work ONLY at /home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/phase1-owner-plan-20261023,
branch codex/phase1-owner-plan-20261023. Preserve the original checkout and other
worktrees. No remote push/PR/merge, deployment, shared DB migration, provider call,
credential copying, purchase, or live flags follows from this local task.

## Required ordered outcomes

Execute Phase1 strictly A -> B -> C -> D, then Phase2. Parallel implementation is
allowed ONLY for independent files/tasks within the same block. Before the next
block, close critical local dependencies, test, independently review and commit the
block locally. Send coordinator brief status with IDs, actual SHA and test budgets.

A: P1.A1 reusable promo code at first private /start, deep-link attribution, unique
Telegram identity count and immutable owner binding; separate namespace from expert
single-use qualified codes and all client coupons. A2 count>=2 enqueues real guide
work idempotently; pdf_sent changes ONLY on confirmed actual delivery. PDF is absent:
create pending content slot, not a fake file/success. A3 existing campaign tariff
calculation, immutable quote, TTL and explicit1/3-month choice. A4 creates owner-bound
pending verification application and masked manager work. No duplicate price engine.

B: B1 authenticated manager queue via existing admin/operator mechanism (no new web
personal cabinet), protected contact/questionnaire access and placeholder content.
B2 manager approve/reject audited and idempotent; approved creates300000-kopeck
onboarding invoice, rejected sends bounded reason. B3 verified successful onboarding
payment opens interview only. An onboarding fee must NEVER activate residency,
settle a first residency marker or grant qualified referral money. Purpose must be
bound in stored order/operation, independent of untrusted metadata or callbacks.

C: C1 collect raw text/photo/document references securely into card_drafts; no LLM
processing required. C2 editable manager review loop and explicit card approval.
C3 material templates/asset slots awaiting owner content, real delivery only;
C4 collect promo proof and manager confirmation; C5 invoice selected main tariff only
after gates; C6 verified main settlement publishes approved card to experts_published,
unlocks expert access and sets next billing date atomically/idempotently. Never
publish or grant paid access from a redirect, client statement or fake callback.

D: D1 unique renewal invoice/reminder7 days before end; D2 overdue hides card and
restricts work bot, with bounded reminder/archive offer; D3 pause to a return date
within3 calendar months, retain account/card, automatic re-evaluation on return.
Preserve unused paid time only through an explicit transaction/audit-backed
entitlement rule; no fabricated free paid period and no mutation of settled order
history. If no valid paid entitlement on return, remain suspended/payment-required.
Document this compatibility decision rather than silently granting unpaid access.

Phase2: P2.1 inspect/reuse existing slot hold/concurrency logic; complete any backend
gap without client UI. P2.2 Telegram methods for client coupons_balance, order
history and active reservations from existing DB; no new web personal cabinet.
P2.3 inactive VK/MAX connector modules; verify current official API contracts using
official docs, do not call providers or activate them. Phase3 remains excluded:
Yclients/Dikidi, web cabinet, BI dashboards and email/SMS automation are deferred.

## Owner-delegated bonus economics

Owner answered amount question: calculate it conservatively so economics remains
positive. Chosen policy: once per inviter,100 frozen bonus points after2 unique
promo registrations. This is an advance INDICATION within the existing1000RUB
qualified first-payment reward, NEVER an extra100+1000 reward. Registrations create
no spendable financial balance, no cash entitlement and no coupon balance. Existing
qualified payment eligibility, anti-abuse,30-day maturity, debt/reversal and spend
caps remain authoritative. Supersede/reconcile the preliminary100 indication when
the corresponding qualified1000 reward exists; never double-count or backfill an
ineligible first settlement. Missing PDF does not block schema/API work.

## Safety and acceptance

Keep PostgreSQL authority, integer kopecks, server-owned quotes and provider modes,
private authenticated identities, durable bot-ID/update replay, zero PII/secrets in
logs and masked manager outbox data. Sensitive drafts/media need protected storage
and an explicit erasure disposition. No LLM balance/ownership/settlement authority.
Preserve strict cancellation of unsent payer data on consent withdrawal/deletion.
New billing must use real GET verification and purpose/amount/owner binding; test
fixtures must remain synthetic. Runtime capabilities default off, fail startup
closed if enabled without complete required production dependencies.

Do not weaken existing guards or claim local success as release acceptance. External
YooKassa merchant settings/delivery, processor/backup erasure and exact-SHA release
checks remain separate. These external gates do not prevent building/test-driving
the local modules with explicit injected fixtures. User is configuring the protected
test merchant separately; do not request or print credentials.

</frozen-after-approval>

## Implementation responsibility

You are the implementation lead for the remaining authorized plan. Own remaining
source/test/schema/config changes and per-block artifacts in this isolated tree.
Create concise per-block BMad specs/implementation plans with exact paths, interfaces
and acceptance before code; preserve the above authorization, no new approval loops.
Resolve ordinary implementation choices from existing code and conservative safety
invariants; report genuine conflicts rather than silently changing money policies.

Use subagents only as explicitly directed by relevant skills or the owner's
within-block parallel allowance. Assign disjoint ownership. Reviewers never edit
what they review. Do not start the next block while its critical predecessor code
is incomplete. Do not return after just a plan, acknowledgement or first task;
continue all authorized work until done or a genuine external/input blocker leaves
no independent implementation work. Report actual blockers and completed work.

Update AGENT-STATUS with resumable source/commit/test counters as work progresses.
The parent coordinator owns final overall report; avoid editing
`docs/test-evidence/phase1-coordinator-2026-10-23.md` if the parent creates it.

## Verification policy

TDD for behavior. New PostgreSQL/concurrency focused files at most3 invocations;
reserve the last for corrections after independent review. No existing exhausted
onboarding/deletion PG, old bound-runtime, verifier/capability suite reruns. No full
or multi-path Vitest inner loop. Non-PG unit reruns require a new change/failure to
justify them; no artificial blanket3 limit beyond repository policy. Relevant
package builds/types, tests tsc, lint/format and diff checks. Guard registrations
must be exact, documented and independently reviewed; current scope123/history8
are green. Add SQL+journal+hand-authored supported metadata/state evidence together;
never drizzle-kit generate. No dependency or feature-flag weakening.

Independent adversarial/edge/verification review per block, remediate real findings,
record local evidence and commit actual passing implementation before continuing.
Only mark local implementation complete where verified; never mark release/live
provider acceptance complete from fixtures. Full aggregate gates cannot silently
rerun exhausted files; preserve this limitation for the final evidence owner.

## Owner verification amendment and local progress — 2026-10-23

The owner explicitly overrode verification run-count restrictions for this entire
current task (“разрешаю, что за бесконечный цикл”). This supersedes historical
three-run/exact-extra-run approval caps above and in continuation records for this
task. Do not request further count approval. Preserve run facts/failed logs, keep
repeat-tool count at most3, and run only verification justified by changes,
failures or unresolved acceptance. Assertions, runtime and release boundaries stay.

A and B are locally complete. C is locally complete after C8 passed20/20 on isolated
PostgreSQL17.5; its spec/evidence retain all failed attempts, reviews and external
gates. D is locally complete after its first focused run passed12/12. Phase2 is locally complete: slot genuine TTL regression RED→GREEN2/2 and first
private client integrated run8/8, plus57 inactive connector tests. Relevant builds,
types/static and independent reviews passed. Final plan coverage is recorded in
`docs/test-evidence/phase1-through-phase2-coverage-2026-10-23.md`; the coordinator
owns the final branch gate. Local fixture acceptance is not provider or release
acceptance. No Phase3 work was added.
