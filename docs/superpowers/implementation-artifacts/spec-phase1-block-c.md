---
title: Expert card interview through verified main-payment publication
status: in-progress
baseline_commit: 656cf89a025d46dfa6bc8e0cf92a3e6eee355c21
context:
  - docs/superpowers/implementation-artifacts/spec-phase1-through-phase2-execution.md
  - docs/test-evidence/phase1-block-b-2026-10-23.md
  - packages/db/src/repositories/expert-verification-repository.ts
  - packages/db/src/repositories/expert-campaign-order-repository.ts
  - packages/db/src/repositories/expert-residency-provider-inbox-repository.ts
  - packages/db/src/schema/expert-residency.ts
---

## Ordered outcome and admission invariants

Implement P1.C1–C6 as one locally reviewable block, using actual private Telegram
work-bot ingress and the existing staff interface. Main residency payment is distinct
from onboarding300000. An onboarding payment grants only interview eligibility.
Do not set experts.active merely to satisfy old checkout eligibility.

C1 accepts bounded raw text/photo/document references into RF PostgreSQL card_drafts;
no LLM processing or external media fetch. Only the paid interview owner can submit;
private identities, current original messaging consent and numeric bot/update replay
are authoritative. Unknown/revoked/ambiguous mappings never auto-merge. Reuse a
single-use owner-bound handoff if adding the work bot mapping. No raw PII in logs,
receipts/outbox summaries or public card. Explicit erasure clears raw/media/proof
content and publication; external processor/backup erasure remains unclaimed.

C2: submit/review/edit/return-for-changes/approve loop with revisions and authenticated
MFA manager authority reused from B. Public payload is a strict bounded professional
card schema, distinct from raw documents/private entries. Approval binds its revision
and digest; further edits invalidate downstream gates. Staff UI must expose actual
review/edit/approve controls and protected raw references.

C3: versioned inactive material templates/assets (`TODO: Wait for Content Spec`).
Prepare real durable delivery work, never a fake guide/banner/success. Delivery may
advance only through an internal trusted transport receipt for the correct bot/chat,
user, approved revision and content version; no user/manager boolean can mark sent.
Missing templates remain waiting_content. Injected synthetic transport fixtures may
exercise real send/result composition; no actual provider call.

C4: private owner submits bounded HTTPS links/photo/document proof references;
manager explicitly confirms current approved revision. No public fetch/LLM inference
or caller-supplied confirmation. Missing material delivery cannot be bypassed.

C5: reuse existing campaign quote calculation and immutable snapshots. Explicit
1/3-month selection and owner acceptance bind the current approved card revision.
An expired A quote requires explicit renewed quote/acceptance, never silently changes
charged price or rewrites accepted application history. Create the main residency
order only after all gates. A specific DB-owned applicant checkout admission path
may permit its inactive expert; generic existing expert checkout stays unchanged.

C6: only real authoritative GET/canonical payment proof with stored main purpose,
order/owner/operation/amount/mode can atomically publish experts_published, activate
full expert access and set next billing from the settled residency interval. Extend
existing canonical settlement with a specific DB-owned onboarding gate after its
payment/expiry checks and before eligibility/first-marker creation; never add a
public generic mint or generic caller-provided activation hook. Publication and
activation commit together with settlement; invalid/erased/withdrawn conditions
retain actual financial truth without recreating access or public data.

## Qualified promo bridge (no extra money)

@conflict_alert: the existing expert_referrals.code_id NOT NULL contract cannot
represent a reusable public promo registration. Resolve additively with the audited
source variant below; never manufacture a legacy single-use admin code or reassign
an existing qualified source. Existing first source wins across namespaces.

Existing expert_referrals requires a single-use code_id. Add an explicit audited
promo-registration source variant, never fabricate/admin-issue legacy codes. Legacy
source requires nonnull code and no promo source; promo source requires null code
AND immutable registration/owner/qualification audit FKs. Existing invitee uniqueness
must apply across both sources. An existing qualified referral always wins; no
reassignment. Both identities/eligible experts and anti-abuse checks must be proven
at first settlement. Never backfill an ineligible already-settled first payment.

Reuse the canonical100000-kopeck reward,30-day maturity, debt/reversal, spend caps and
first-settlement snapshot. Registrations give zero available credit. Preliminary
100 points are included, never added; supersede them when the corresponding1000RUB
qualified maturity exists (including pending30days), not only after a grant appears.
No onboarding fee can create any qualified referral benefit.

## Files and ownership interfaces

- Card storage owner:0054_expert_card_publication.sql/journal (sole DDL writer until
  explicit handoff), schema/expert-cards.ts, repositories/expert-card-repository.ts,
  privacy disposition and card/data unit tests. Expose typed scope commands, card
  revision/gate reads, current manager transactions and handoff receipts.
- Main financial owner: repositories/expert-onboarding-main-payment-repository.ts;
  narrowly extend campaign-order/provider-inbox repositories and referral schema;
  schema/expert-card-payments.ts and financial DDL fragment for0054's sole owner.
  Own NEW tests/integration/phase1-card-publication.test.ts integrated C acceptance.
  Reuse scalar/quote/settlement authority; do not duplicate a price/ledger engine.
- Ingress/application owner: application/expert-card-service.ts/new unit tests;
  existing expert Telegram route interception for interview/card commands using
  trusted receiving work-bot scope; default-off config/composition and NEW route tests.
  Keep existing active-expert commands and private callback authentication intact.
- Staff UI owner: extend staff client/view or dedicated card subview with actual
  protected draft review/edit/approve and promo confirmation; new unit contracts.
- Lead owns coordination/spec/plan/evidence/AGENT status, exact gate integration and
  per-block independent review. Metadata/guard owner assigned once0054 is stable.

All owner interfaces are structural and actor/owner/revision-bound; coordinate exact
names early. One writer per file set. Original canonical internal mint is forbidden.

## Verification and completion

TDD non-PG behavior first. NEW C PG file at most3 runs, source/test review BEFORE
first integrated invocation, final reserved for actual corrections. Never rerun A's
5-consumed file or unchanged B file (2/3). Cases must execute full bot→manager gates→
GET settlement, no pre-main expert access, bad owner/replay/revision/expiry/consent,
raw-media erasure, false delivery rejection, unknown callback recovery and concurrency.
Qualified promo test proves exactly1000RUB pending canonical maturity, no1100 or
available registration credit; first-ineligible settlement never later backfills.
Relevant builds/types/lint/format/diff, exact state/guards, independent adversarial/
edge/verification review, local commit before D. No provider/live/release claim.

## Durable materials execution

The actual fixed-origin text/photo/document transport and bounded worker are part
of C, not optional disconnected helpers. Transport receipts bind every package part
and never report complete from partial/unknown results. DB attempt markers are
quarantine only, not retained disclosure authority; consent/revision/identity are
rechecked immediately before bounded send. Unknown/crash outcomes never blind-resend.
Worker ownership: packages/worker/src/expert-card-materials.ts/newtests, minimal
apps/worker cycle/composition and exports. A separate default-off material-delivery
flag requires complete trusted work-bot scope/token/transport dependencies. Waiting
content persists until an approved real template exists; no provider is activated.

## Main checkout and replay integration closure

A main-order identifier is not a completed checkout. The owner `/main_invoice`
command automatically uses an explicitly configured strict first-send cancellation
capability to create or recover the same canonical order's real provider link.
Database authority verifies owner, revision, exact main purpose, amount, mode and
current deadline before the call and stored provider-operation binding afterwards.
Unknown outcomes never blind-create a second payment; recovery retains the order.
Without this reviewed capability, new main checkout remains explicitly inactive.

Before C handles a work update, a read-only fence checks existing legacy Telegram
receipts: terminal means duplicate acknowledgement, unfinished means retryable
failure, absent allows C's durable bot-ID/update receipt. It never claims fresh or
unhandled legacy events. C durable mutation replays suppress another message and
provider call; a distinct owner recovery command can recover the existing invoice.

## Local WIP checkpoint

C source is implemented and independently reviewed. The owner-authorized fifth
PG invocation passed19/20, with only qualified-reward fixture setup exceeding the
unchanged5000ms body limit. All five authorized invocations are consumed.

A complete20-case setup/body audit accompanies the final fixture-only repair.
Normal heavy preparation moves to tracked bounded hooks; actual callbacks, races,
financial/erasure assertions,20 cases, default5000ms limits, real3-second TTL and
bounded drain remain unchanged. That revised integrated fixture is unexecuted.
Status stays in-progress; D and Phase2 await an explicitly authorized extra focused
run and C critical-gate closure. No sixth run or equivalent manual execution is
implied.
