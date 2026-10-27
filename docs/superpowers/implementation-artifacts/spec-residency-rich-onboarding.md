---
title: Rich resident onboarding and reviewed profile versions
type: feature
created: 2026-10-26
status: in-progress
baseline_commit: 219f8e0c9d0938fccb4188cf0081f71b3f8b2db9
review_loop_iteration: 1
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
  - docs/superpowers/plans/2026-10-26-residency-phase1-final-package.md
  - docs/source/residency-phase1-owner-2026-10-26/resident-onboarding.txt
  - docs/source/residency-phase1-owner-2026-10-26/phase1-final-comprehensive.txt
---

<frozen-after-approval reason="owner approved the complete Phase1 package, latest flow and autonomous execution">

## Intent

Replace the minimal raw-entry card handoff with a usable rich profile and service
catalogue, shared across file import, external checklist and guided questions.
Owners review the whole version before a manager decides; accepted private knowledge
is separate from paid client visibility. This is S3a, followed by S3b local semantic
tags and S4 scheduling/lifecycle in the same approved package.

## Boundaries & Constraints

**Always:** Extend existing card draft/review/application, work-bot ownership,
original consent, paid interview admission and financial/publication authority.
Use versioned private profile/service data; never expose raw private evidence,
room links, contact data or storage capabilities in the existing public summary.
Preserve old records without fabricating richer fields or silently invalidating
reviewed residents. New rich submissions cannot bypass completeness by using legacy
/card_submit or a direct repository/SQL transition. Rich updates retain the last
approved live version throughout draft/rejection and atomically replace it only
following current safety and manager approval. Do not charge onboarding/main fees
again for a profile update or change lifetime paid tariff terms.

Profile includes name/brand, specialization, detailed biography>=50 characters,
at least3 distinct photo references, explicit social/contact links, and conditional
logistics. Accepted photos use real original-bot private custody and protected
manager preview, reusing the reviewed object adapters and erasure obligations;
merely inventing S3 URLs or storing an unresolvable reference is not completion.
A temporary unavailable store preserves the upload/manual state and reports it
honestly. Distinguish private verification documents from explicitly card-approved
photos; no automatic public disclosure of either. Online/hybrid services need STATIC_LINK with a valid public HTTPS room
URL. UNDECIDED blocks finalization; DYNAMIC_PER_SLOT is deferred. Offline/hybrid
services need full address and arrival instructions. Event services explicitly
choose their delivery mode, rather than bypassing logistics. Provide a bounded
Yandex geocode capability with a configured fixed provider endpoint, deadlines,
output/coordinate validation and explicit enablement; no arbitrary URL fetching.
Unavailable/ambiguous geocoding retains address/manual correction, never invented
coordinates. A human-corrected Yandex link is possible without enabling paid APIs.
Do not put provider keys/addresses in logs or browser autocomplete requests.

Each bounded service has stable identity, title, format, duration, exact informational
RUB price or explicit bounded range, description>=50, indications/audience, expected
result, optional expiry date, optional direct details URL and confirmed tags.
Service prices are not residency tariffs, coupons or payment instructions; no new
platform collection for client services. Links are stored/validated, never fetched
implicitly. Financial amount precision/length/ranges use typed validation, not float
arithmetic. Reject ambiguous dates, invalid ranges/durations and unsafe URLs.

All3 input modes converge on one typed version. Deliver an actual reusable Markdown
master checklist through the current bot transport (bounded message/document),
accept returned structured text/file, and use the existing bounded local parser.
Local deterministic labelled extraction may propose supported fields; LLM structuring
remains TODO: Wait for Prompt Spec. No invented facts or paid LLM. URL-only inputs
remain saved references/manual fallback without arbitrary scraping. Preserve raw
answers/uploads after parse failure and say the supplied manual-fallback text.
Missing fields are requested without erasing existing answers. Every parser-derived
change is a proposal, explicitly reviewed and confirmed by the owner before use.

Provide bounded complete owner preview pages, photos/links/service fields and tags;
confirmation binds to exact revision and all displayed content. Never truncate then
confirm unseen values. Editing any field invalidates old confirmation/preview and
safety evidence. Existing safety registry checks all new text/services/tags; BLOCKER
prevents unsafe write/submit/publication, WARNING needs the existing acknowledged
manager review. Return actionable field errors and preserve previously valid data.

Extend the current staff card view with paged profile/services/media, version diff,
return-with-reason and approval. Fresh role/session/MFA, immutable audit, stale
revision/idempotency, async selected-detail fencing and logout clearing apply.
Use existing support escalation for owner “call manager” and review notification;
no duplicate generic messaging authority. Manager edits must be visible in review
and must not silently bless changed owner-confirmed values. Private approved
knowledge is available internally immediately; public search still needs current
main payment, promo proof and visibility gates.

Latest final owner flow supersedes prior generic fee-time materials: fixed3000
starts interview; only manager card approval admits profile-specific materials.
Adapt existing generic/card job paths so a leftover generic job cannot suppress or
prematurely send the current approved version. Preserve historical receipts and
unknown outcomes; never resend an ambiguous delivery as a fresh one. Missing templates
produce exactly “Ваши материалы для рассылки будут доступны в ближайшее время” with
AWAITING_MATERIALS; no fabricated banners, delivered flag or completed promo proof.
After approved materials/promo evidence, retain existing manager confirmation and
main invoice/settlement authority. Updates do not restart an already completed
residency acquisition campaign automatically.

**Separate owner approval:** Deployment/provider activation, legal refund policy
change or actual monetary operation. Missing PDF/content/prompt stays a named TODO;
ordinary implementation, tests, review correction and local commits are authorized.

**Never:** New database/framework stack, client cabinet, Kanban rewrite, dynamic
Zoom/GCal, paid runtime LLM, arbitrary URL/file fetch, new financial ledger or relaxed
consent/quality gates. Do not implement S3b semantic matching or S4 slot generation
in this source set; keep exact typed service duration/IDs for the next block.

## I/O & Edge-Case Matrix

| Scenario              | Input / State                                                                | Expected Output / Behavior                                                 | Error Handling                                             |
| --------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Three modes           | Same owner data via guided/checklist/PDF or DOCX                             | One typed draft, bounded supported proposals, only gaps questioned         | Raw uploads survive unsupported input/manual fallback      |
| Completeness          | Two/repeated photos, short bio/description, missing service result/logistics | Exact field gaps, cannot submit via old command or SQL                     | Valid saved answers preserved                              |
| Full preview          | Long Cyrillic/escaped profile and multiple services                          | All bounded pages visible, exact current owner confirmation                | Old/partial preview cannot confirm hidden values           |
| Safety                | BLOCKER/WARNING in new nested service/profile/tags                           | Same current policy blocks or flags; fresh manager acknowledgment          | Editing invalidates prior proof                            |
| Conditional logistics | Online/offline/hybrid/event, missing/static/dynamic room, geocode ambiguity  | Static choice and required address instructions; safe human map correction | Disabled provider performs zero calls; no fabricated point |
| Initial approval      | Owner confirms, manager approves                                             | Version stored privately, materials eligible; not yet public               | Stale MFA/revision/replay/cross-owner denied               |
| Pending update        | Already paid/published resident edits or rejected update                     | Old live version remains visible; accepted new version replaces atomically | No new fee or stale-review publication                     |
| Materials order       | Fee paid but card unapproved; generic job exists                             | No premature send; approved version creates valid current material work    | Unknown/delivered historical attempts never resent         |
| Privacy/UI races      | Withdrawal/erasure, async A response after B/logout                          | No new reads/jobs; all rich payloads removed; stale DOM fenced             | Minimal existing audit/erasure obligations remain truthful |

</frozen-after-approval>

## Code Map

- packages/application/src/expert-card-service.ts and apps/api/src/expert-card-telegram-ingress.ts: existing command/interface and canonical allowlist.
- packages/db/src/repositories/expert-card-repository.ts: paidApplication/ownerAction, raw entries, submit/review, public payload and materials.
- packages/db/src/schema/expert-cards.ts: single mutable draft and immutable review; extend compatibly with versioned rich data.
- packages/db/src/repositories/expert-application-materials.ts: old generic fee-time jobs conflict with latest release order.
- packages/db/src/repositories/expert-card-main-gates.ts and expert-residency-main-projection.ts: authoritative initial paid publication; preserve historical proof.
- packages/db/src/repositories/resident-content-safety.ts: every new rich text field must participate in current safety proof.
- apps/api/src/routes/expert-cards.ts, apps/web/src/expert-card-{client,view}.ts: current staff UI, no new admin stack.
- packages/integrations/src/documents/: existing local parser/OCR and private transport conventions.
- packages/db/src/schema/residency-core.ts: canonical164 tags and confirmed draft selection, semantic optimization follows separately.
- Existing privacy repositories, migration0054/0061 and publication readers must be traced before adding versioned live projection.

## Tasks & Acceptance

- [ ] Add typed rich profile/services/version schema, hand migration/state and cross-layer validation without altering historical migration bytes.
- [ ] Connect3 real bot input modes, reusable checklist, safe proposals/manual fallback, gap questions and complete revision-bound owner preview/confirmation.
- [ ] Compose safe conditional logistics/geocode/manual-map capability; protect detailed private data and deletion.
- [ ] Extend existing manager review/diff/return reason, current safety and publication version replacement while retaining old live state.
- [ ] Move materials eligibility to card approval, preserve old receipts/unknowns, exact placeholder and existing promo/main-payment gates.
- [ ] Execute matrix through real authenticated ingress, PostgreSQL/SQL guards, actual browser and local transport/parser witnesses; preserve RED/GREEN evidence.

## Spec Change Log

- 2026-10-27, implementation seam clarification: existing human_escalations and
  operator cases are restricted to safety/negative-feedback/delivery incidents.
  The owner call-manager action may use an explicit assistance-request state in
  the existing protected staff card queue, with truthful pending acknowledgment,
  current owner/revision/consent/audit, bounded deduplication and manager visibility.
  Do not fabricate a safety incident or introduce unrelated messaging authority.
  This preserves the approved assistance intent without blocking on a nonexistent
  generic support producer.

- 2026-10-27, usability implementation clarification: the approved guided mode,
  checklist and complete preview must use resident-readable Russian labels and
  ordinary answers, with server-generated stable service IDs. Advanced JSON commands
  may coexist but cannot be the only completion route. Owner preview must expose
  actual selected photos through owner-bound protected access, not only media UUIDs.
  Preserve exact revision/consent/safety confirmation and all valid partial data.
  Trigger: initial source exposed schema keys/JSON/UUIDs as the ordinary route.

- 2026-10-27, independent review R1–R13: incremental corrections must preserve
  stable original-input replay identity, historical draft/material compatibility,
  canonical photo/service UUID identity, useful photo replacement and SQL null
  rejection. Private approval must survive unavailable paid visibility and later
  renewal must use the latest approved content. Preserve partial labelled services
  for gap-only completion. Add actual normal-composition, lifecycle-command and
  populated-upgrade witnesses. Exact triage/ownership is in
  docs/test-evidence/residency-rich-onboarding-review-2026-10-27.md.
  KEEP all accepted working behavior and original evidence; no destructive rewrite.
  Add hand-authored0067 correction/state while preserving0066 and earlier bytes.

## Design Notes

The current four-field public payload deliberately excludes contacts/media. Add a
private rich projection with stable service IDs; don't expand public exposure just
because the owner template lists every field. A URL stored in a private draft is
not an outbound fetch instruction. Approval of an update must preserve old financial
proof and previous visibility until replacement; a second payment is not a migration
strategy. If a Code Map detail differs, inspect accepted source before adapting,
without weakening intent or authority. Historical legacy residents stay intact;
new-mode admission must be explicit and irreversible for an application.

## Verification and execution ownership

One fresh implementer owns source/tests/migrations/runbook/implementation evidence.
Root owns this specification/status/master/review/final gate/push/PR. No descendant
agents, rerender of BMad, previous block restart or full gate by implementer. Work
only in the existing isolated .worktrees/phase1-owner-plan-20261023 on codex/residency-rich-onboarding-20261026. Capture identity, Node24/pnpm11.9.0 and RequireDocker preflight.

Use ONE existing PG17.5 project ii-tonya-verification-form-20261026 on loopback55483.
Protected0600 /tmp/verification-form-20261026.compose.json provides credentials only
in child memory; never print configuration/URL/env. Reuse the task-owned isolated
parser socket /tmp/residency-private-parser-20261026/socket/parser.sock when needed.
No new DB cluster or production access. Serialize PG/metadata/heavy builds. Next
hand migration0066; preserve0065 and earlier. Reconstruct exact state/counts, update
all legitimate inventory guards, no drizzle generate or relaxed resource ceilings.

Write meaningful failing behavior tests first. Relevant focused checks/builds,
types/lint/format/diff follow; run-count override is already authorized for necessary
changed/failing checks, never unchanged broad repeats or repeat helper above3.
Archive exact commands/exit codes/matrix mapping and failures under separately hashed
S3a evidence. Local green is not hosted CI or live release evidence. Commit locally
when complete and report exactSHA/evidence/remaining risks to root. No criterion is
complete merely because a placeholder/interface always returns unavailable.
