---
title: Complete versioned resident verification and truthful manager communications
type: feature
created: 2026-10-26
status: in-review
baseline_commit: 53df4d2fbbe09038bde2298e4642cee4247fbe2b
review_loop_iteration: 1
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
  - docs/superpowers/plans/2026-10-26-residency-phase1-final-package.md
  - docs/source/residency-phase1-owner-2026-10-26/verification-final.txt
  - docs/source/residency-phase1-owner-2026-10-26/communication-templates.txt
  - docs/source/residency-phase1-owner-2026-10-26/phase1-final-comprehensive.txt
---

<frozen-after-approval reason="owner approved the full package and autonomous implementation without routine approval or splitting checkpoints">

## Intent

Complete the existing applicant form and manager workflow: role-specific data,
reviewable submitted snapshots, questions/answers, category decisions, truthful
editable notices and safe reapplication. Preserve delivered sales and paid authority.
This is S2a inside the approved S2 block; S2b follows with private file/extraction,
OCR and social-check jobs. Do not claim those external checks implemented here.

## Boundaries & Constraints

**Always:** Latest owner order wins: explicit tariff selection precedes the form;
manager approval reuses exactly one fixed3000 onboarding invoice; genuine eligible
fee settlement alone locks terms and opens interview. Preserve base clock, old
v1 forms, selected quotes, issued invoices, frozen submission proof and paid locks.
Do not regress to the earlier tariff-after-verification/no-invoice wording.

Extend the existing model with explicit form/attempt versioning and current-attempt
selection. New forms use v2; stored v1 drafts still resume under their original
rules, and submitted v1 bytes/references never change. Keep multi-role union and
primary role. Tax includes INDIVIDUAL_NO_STATUS with trust-only explanation; legacy
INDIVIDUAL remains readable. Education is explicitly optional for new experts;
esoteric/other never require diplomas. No tax/unknown-check automatic rejection.
Add typed fields required by the source: expert methods/experience/client cases;
center premises type and required tour media; organizer format/programme/speakers/
past-event evidence; education project name/optional licence/team/graduate reviews.
Preserve already-supported common/property/capacity/amenity/path fields. Bounded
DOCX/video intake stores private references, never fabricated downloads. Short
callback codes keep every supported revision within Telegram's64-byte limit.
Category criteria have no supplied content: TODO: Wait for Content Spec; manager
chooses BASIC/EXCLUSIVE, never infer category from average-check signal.

Use existing manager queue, protected detail and web editor, including real submitted
forms and selected-price facts. Record immutable outcome/category/reason/audit events
bound to exact attempt, submission, supplement/check generation and fresh manager
MFA/session. Lifecycle status is a projection, not permission to fabricate financial
submission integrity. Evolve SQL guards and sales source predicates together; old
supplements must still preserve approved capture authority. Older Telegram approve/
reject callbacks cannot bypass new-cohort typed decisions, info-first or preview;
route them safely to the existing protected editor if necessary. No Kanban.

Information requests contain bounded numbered questions, deadline DB time+48hours,
request identity and original private channel. Answers bind to that request; explicit
completion queues renewed review/check generation without replacing original facts.
Timeout queues continued human review, never automatic rejection. Late answers and
stale jobs cannot overwrite a newer request. Insufficient-proof rejection requires
a genuine prior request and renewed review. Soft rejection allows a fresh attempt
after one calendar month, including month-end clamping; hard rejection cannot
silently reopen. Concurrent reapplication creates one current attempt. Never reset
historical financial applications/decisions or restart the base clock. Paid users
cannot enter a new unpaid funnel through reapplication.

Seed all five supplied message template keys with versioned body/typed variables.
Use actual stored name or a neutral greeting; QUESTIONS_LIST derives from a bounded
array. Manager selects action, previews and edits tone/details, then confirms exact
text. Protect fact-bearing outcome/deadline/reapplication/waitlist/refund sections;
free edits cannot forge facts. Bind preview to actor, attempt, current revisions,
template, rendered variables and exact final UTF-8 hash. Reject unresolved variables,
oversized/private-channel-invalid content and stale previews. User text is plain
Telegram text; manager display escapes it. Preserve the approved wording where its
claims are grounded. Unknown check/internal blacklist is never a public accusation.

No waitlist retention promise without genuine enrollment/current applicable consent.
Absent that fact, omit the retention promise truthfully; do not enroll automatically.
The fifth refund key is seeded but unavailable for fact-bearing send unless actual
paid onboarding, applicable accepted terms and genuine refund-case authority exist.
Current code has no onboarding refund/terms binding, and the old oferta conflicts
with the ten-working-day promise. Owner clarification is pending: keep an explicit
manual-review/unavailable reason and TODO: Wait for Refund Policy, not invented
refund facts. This block creates no money/refund executor and does not change legal
terms. Sending any template cannot initiate/confirm payment or refund.

Deliver approved/rejected/info outcomes through durable current-owner/original-bot/
chat custody with exact rendered text, attempt fencing and current consent checked
immediately before disclosure. Retry only definitely unsent work; dispatch ambiguity
stays unknown and is never blindly resent. Preserve raw private text only in deletable
payload storage; immutable audit retains the exact final hash and minimal source facts.
Withdrawal/erasure cancels unsent work, removes new private data and prevents late
completion resurrection. Missing capability stays unavailable, not sent. Add normal
worker composition with default-off capability ceilings; no real messages in tests.

**Ask First:** Deployment, live provider activation or actual money operations.
**Never:** Rewrite old migrations/accepted contracts, weaken auth/consent/idempotency,
make legal/refund claims from templates, invent checks, reset paid history, add a
second stack/client cabinet/Kanban, or enable external integrations.

## I/O & Edge-Case Matrix

| Scenario    | Input/state                                             | Required outcome                                                     |
| ----------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| Form        | New six-role/v2 or pending/submitted v1                 | Typed final fields, honest tax/education, immutable historical rules |
| Approve     | Current reviewed form and explicit category             | Genuine decision, exactly one3000 invoice; no unpaid lock/interview  |
| Information | Request, partial/complete/late answers,48h boundary     | Versioned questions/answers and renewed review; no auto rejection    |
| Reapply     | Soft month boundary, hard rejection, paid history, race | One eligible current attempt; history/base clock/money preserved     |
| Preview     | Five keys, absent name/facts, edits, changed revision   | Truthful bounded text or precise unavailable; stale send denied      |
| Delivery    | Wrong channel/consent, duplicate worker, crash/unknown  | No cross-owner disclosure or blind retry; exact receipt/audit hash   |
| Erase       | Pending/dispatched work, late answers/completion        | Private linkage removed, unsent cancelled, no resurrection           |

</frozen-after-approval>

## Code Map

- `packages/domain/src/resident-verification-form.ts:18,59`: existing six roles, multi-role union, exact bounded patch/URL rules and v1 INDIVIDUAL. Add version-dispatched typed forms; syntactic URLs are not fetch authority.
- `packages/db/src/schema/resident-verification.ts:59,211`; migration0057:59,113: UNIQUE(user_id), form_version=1 and submitted/status freeze. Explicit attempt/current identity must replace assumptions in every affected selector, not just remove uniqueness.
- `packages/application/src/resident-verification-service.ts:180`; `apps/api/src/routes/expert-applicant-telegram.ts:149`: actual revision callbacks and PDF/photo intake. Full no-status literal exceeds64bytes at two-digit revision; short wire codes map to canonical values. Existing edits/removal/private references stay.
- `packages/db/src/repositories/resident-verification-repository.ts:207,218,242`: submission, supplements and placeholder one-per-form check work. Preserve old frozen submission; introduce request/completion and check-generation identity ready for S2b. Actual OCR/social observations remain unknown here.
- **Financial seam:** migration0060:8 `expert_sales_form_valid` requires UNDER_REVIEW and exact frozen digest/time/submitted revision. Update validity to distinguish trusted lifecycle state from source integrity, atomically with0057 replacements. Never globally accept arbitrary statuses.
- `packages/db/src/repositories/expert-separated-sales-repository.ts:406`: bridge creates canonical financial application/manager work. Reapplication must bind a new legitimate attempt without rewriting old bridge/decisions; audit user/form/current selectors and uniqueness.
- `packages/db/src/repositories/expert-verification-repository.ts:136,157,215,224,295,598`: queue/detail include actual submitted form; decide creates fixed3000; settlement alone locks price. Reuse these, including original invoice/capture/receipt conditions.
- `packages/db/src/repositories/expert-manager-authority.ts:15`; migration0053:101–165: fresh session/role/MFA and append-only terminal decision provenance. New nonterminal review events must not overwrite unique old terminal decisions.
- `apps/api/src/routes/expert-verification.ts:159`; `packages/application/src/expert-verification-service.ts:224`; `apps/web/src/expert-verification-client.ts:189` rejects submitted questionnaire; `expert-verification-view.ts:212` only renders placeholder. Extend real typed client/editor/detail, not mock-only routes.
- `packages/application/src/expert-manager-telegram-service.ts:145`; manager-telegram repository:47: generic legacy callback path needs new-cohort routing/fencing so no preview/info-first bypass remains.
- `packages/db/src/repositories/resident-workspace-repository.ts:96–222`; migration0058:216: reusable interview-ready notification custody, but work-kind/uniqueness/transport currently restricted. Use separate template-specific admission while sharing safe mechanics; do not globally loosen work-handoff sentence validation.
- `packages/integrations/src/telegram/workspace-notification-transport.ts`; `apps/worker/src/resident-workspace-notification-composition.ts:10`; worker main: existing bounded lifecycle/default-off composition. Pending rejection/invoice work currently has no equivalent candidate-message sender.
- `packages/db/src/repositories/privacy-repository.ts:376,1003,1020`;0057:152 consent-trigger cleanup: extend both explicit erasure and withdrawal paths, preserving nonpersonal/financial tombstones.
- Refund boundary: onboarding webhook capability:14,40 declines refunds; YooKassa operation repo:288 only refunds residency orders. oferta.txt:396,500 and missing onboarding accepted-terms binding forbid an invented ten-day promise. All remain read-only here.
- Fixtures: resident-verification-form.test.ts:86,101,239,488,679,746; actual separated-sales composition/state (especially supplemental approval/capture regression); current verification client/view and notification worker tests.

## Tasks & Acceptance

- [x] Hand0062 migration/journal/schema/state: versioned forms, attempts, source-aware manager lifecycle, requests/answers/check generations, template/preview/message custody and privacy/audit guards.
- [x] Actual bot v2 fields, v1 continuation, bounded media/callbacks and reapplication; real submitted manager detail/actions/editor with old callback bypass denied.
- [x] Five truthful template slots, immutable send decisions and normal bounded worker delivery; fixed3000 sales approval/capture remains authoritative.
- [x] RED/GREEN real Fastify/PG/browser/worker acceptance, migration upgrade and focused legacy sales/privacy compatibility; exact metadata/negative inventory probes, builds/types/lint and retained evidence.

Cover every matrix row with executed tests. Include January31/leap-year/exact boundary;
all six roles and mixed roles; no-status callback at large revision; v1 resume without
silent upgrade; current/cross-owner/stale form/check/MFA races; 48h timeout and late
answers; info-first denial; duplicate approval creates one invoice; genuine fee still
locks terms with final statuses; soft reapply preserves old base/financial facts;
preview hash equals actual sent UTF-8 text; missing waitlist/refund facts; real browser
client refusal/retry; current consent/erase during delivery and unknown crash outcomes.
Use synthetic providers only. Unknown capability must have real manual recovery.

## Spec Change Log

- 2026-10-26, independent review1 (R1–R6): retain the implementation and correct
  one concrete batch, following owner instruction against destructive loops.
  Add accessible terminal-delivery recovery; bounded paged accepted history;
  non-poisoning overdue processing with blocked identities; asynchronous editor
  response fencing; actual production calendar-deadline witnesses and actual
  applicant completion/reapplication commands. The known-bad states are inaccessible
  recovery, unopenable valid history, global read/worker outage, obsolete preview
  confirmation and tests that cannot detect broken public paths/calendar arithmetic.
  KEEP all passing v1/v2 forms, immutable submission/financial authority, fixed3000
  capture, exact bytes/hash, privacy cleanup, unknown-send quarantine and default-off
  worker. Do not rederive unrelated source or repeat unchanged suites. Details and
  exact source lines are in the independent review evidence.

## Design Notes

Terminal outcome does not end communication recovery: pending/ambiguous notices
must remain discoverable after reload. Existing accepted supplemental history must
remain readable in bounded pages, including its request/question context; neither
silent truncation nor a larger browser envelope is a fix. A single blocked due
subject cannot abort every manager read/worker cycle; retain strict identity checks
and safe per-subject isolation. An editor change fences outstanding preview
responses, not only the last resolved value. Deadline tests must exercise production
calculation plus genuine events, and applicant commands must reach the actual
repository through the normal service. No production clock override is introduced.

Info-request preview keeps exact confirmed bytes: its protected timing text says
48hours from request creation and points to `/verification` for the actual absolute
deadline/remaining time. Confirmation uses real DB time+48hours; never backdate a
decision to preview time. The current owner request view renders live timing. Expired
or superseded notices are cancelled before first disclosure. This avoids inventing
a future timestamp during preview or changing approved text after confirmation.

Prefer additive immutable attempt/event provenance plus explicit current selection
inside existing repositories; avoid a second parallel form model. If uniqueness or
SQL source predicates change, enumerate every affected lookup and verify upgrade of
actual pending/submitted/approved/paid historical rows. Manager lifecycle and financial
submission integrity are different facts. Preserve the exact original consent target.
An information request is not a terminal financial decision. Record quality decisions
transactionally, then deliver through dedicated durable custody. New checks consume
frozen generations in the following S2b contract; they must not block manual review.
No automatic interview-exception producer is added by this block: latest owner fee
sequence controls new intakes. Existing historical exception authority stays intact.

## Execution & Verification

One fresh implementer owns source/tests/migrations and implementation evidence; no
descendants. Root owns spec, coordinator/review evidence, final gate and PR. Work
only in the existing isolated tree on codex/residency-verification-messages-20261026.
BMad is already rendered once; no rerender or previous-block restart. Owner autonomy
and routine split/approval/run-count opt-out persist; no new permission loops.

Node24/pnpm11.9; use existing one task PG17.5 project ii-tonya-verification-form-20261026,
loopback55483. Protected0600 /tmp/verification-form-20261026.compose.json supplies
credentials only in child memory; never print URL/config/env. No extra cluster.
Serialize PostgreSQL/metadata/heavy builds. Next migration0062, hand SQL+journal;
never drizzle generate. Reconstruct exact state after final SQL edits; register
all literal inventories including migration-history, scope and journal parity.

Behavioral RED, focused GREEN and relevant old-path/actual upgrade evidence; preserve
failures and distinguish skipped cases. Build changed packages before dist consumers.
No unchanged broad repeats or repeat-helper count>3. Root runs independent review
and final canonical gate. No hosted CI exists; local tests are not live-release proof.

## Suggested Review Order

**Entry and authority**

- Connect actual manager decisions to the existing sales and review services.
  [expert-verification-service.ts:61](../../../packages/application/src/expert-verification-service.ts#L61)

- Bind exact previews, fresh authority, immutable decisions and the fixed fee.
  [resident-review-repository.ts:99](../../../packages/db/src/repositories/resident-review-repository.ts#L99)

**Applicant and lifecycle**

- Preserve versioned forms and route actual completion/reapplication commands.
  [resident-verification-service.ts:353](../../../packages/application/src/resident-verification-service.ts#L353)

- Compute calendar deadlines from real DB time without changing historical migration0062.
  [0063_resident_verification_review_corrections.sql:1](../../../packages/db/migrations/0063_resident_verification_review_corrections.sql#L1)

**Recovery and bounded reads**

- Keep unresolved terminal cases discoverable through bounded queue and detail navigation.
  [expert-verification-repository.ts:137](../../../packages/db/src/repositories/expert-verification-repository.ts#L137)

- Resolve ambiguity without resending and isolate overdue subjects.
  [resident-review-repository.ts:232](../../../packages/db/src/repositories/resident-review-repository.ts#L232)

**Review and delivery**

- Fence delayed previews against current editor state.
  [expert-verification-view.ts:322](../../../apps/web/src/expert-verification-view.ts#L322)

- Recheck current authority before original-channel disclosure and quarantine ambiguity.
  [resident-review-repository.ts:343](../../../packages/db/src/repositories/resident-review-repository.ts#L343)

**Supporting evidence**

- Exercise production calendar semantics and real applicant commands.
  [resident-verification-remediation.test.ts:387](../../../tests/integration/resident-verification-remediation.test.ts#L387)
