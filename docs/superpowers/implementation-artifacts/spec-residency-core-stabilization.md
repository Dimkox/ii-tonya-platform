---
title: Stabilize workspace activation, document fallback and draft tags
type: feature
created: 2026-10-26
status: in-progress
baseline_commit: 567e71b4dea4bd2720da452c8049916f9d2b437c
review_loop_iteration: 0
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
  - docs/superpowers/plans/2026-10-26-residency-phase1-final-package.md
---

<frozen-after-approval reason="owner explicitly requested all three stabilization blocks first in one STABILIZATION PR and previously opted out of routine approval loops">

## Intent

Deliver core_stabilization before the remaining approved Phase1 package: isolate
workspace admission, make document failures safely fall back, and provide a real
private draft tag selector. Extend existing modules, not a parallel platform.

## Boundaries & Constraints

**Always:** Node24/pnpm11.9.0, PostgreSQL17.5, hand-authored additive migrations.
Keep existing financial facts, prompts and public-card exact-key contract intact.
Original consent, current private bot/channel ownership, revisions, scoped replay,
erasure and current database time own every operation. New delivery/parser/tag UI
capabilities default off; missing adapters never grant authority or fake success.

Expose bot-independent activateResidentWorkspace(userId), using internal UUIDs and
stored facts only. Paid3000 onboarding admits interview, never main entitlement.
Extract the existing transactional activation seam; do not create a post-commit
crash gap. Record idempotent ACCESS_ACTIVATED audit and an informational access
projection; no public writable access flag. Registration/submission grants nothing.
APPROVED_IN_DB is final-card quality, not an interview prerequisite. A prepayment
manager exception requires its own genuine approved-intake/manager evidence; its
producer belongs to the next verification increment and is denied while absent.

Consume durable interview_ready work with a configured promo notifier, original
identity/consent recheck, bounded attempts and honest unknown outcomes. Reuse the
owner-bound work-bot handoff; a plain URL is not identity linking. No fabricated
Telegram updates/admin sessions. No repeated send after ambiguous outcome.

Provide real local PDF/DOCX extraction through SafeDocumentParser: trusted bounded
bytes/type/AbortSignal, at least50trimmed characters, otherwise no result. A locked
isolated Python helper is acceptable; no Django/Celery or paid LLM. Bound input,
pages/ZIP expansion/output/concurrency/CPU/wall time; reap children on cancellation.
Log fixed warnings/reasons only, never raw exception, document text, path or token.
Save the private original first. On malformed/empty/scanned/unavailable/timeout
input, persist manual INTERVIEW mode and deliver the supplied fallback text with
no500. Stale completion cannot overwrite newer/erased/withdrawn drafts. Successful
extraction is a private untrusted proposal, not an automatic public profile.

Wire file-import/manual fallback into the actual interview-capable work-bot path;
full three-mode onboarding and structured LLM extraction are later work. Keep
helper assets/dependency locks explicit in package evidence. Do not enlarge the
existing256MiB production worker or claim its Node-only image supports Python;
production execution remains unavailable until reviewed isolation/runtime evidence.

Add one canonical hashtags_db and an old-shape hashtags_taxonomy compatibility
projection. Seed the supplied164entries/7categories idempotently with source
provenance, preserved wording and default weight5. Six mock entries are isolated
fixtures. A private paginated InlineButton UI saves at most20 unique active tag
IDs against editable owned card drafts, with revision/replay and erasure. Expose
the selected-label tags_array contract without widening approved public JSON.
Reject inactive/unknown/foreign/stale selections. No custom tags or semantic
inference until the moderation/semantic increments. Tags do not certify expertise.

**Ask First:** Actual deployment, provider activation, credentials or new payments.
**Never:** Main access from a fee/interview flag, swallowed payment-proof errors,
unbounded parsers/URLs, arbitrary upload paths, global Python dependency assumptions,
production mocks, duplicate booking/taxonomy authority or client-service collection.

## I/O & Edge-Case Matrix

| Scenario      | Input/state                                                                       | Expected behavior                                     | Failure                         |
| ------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------- |
| Activation    | Canonical paid onboarding, active consenting owner                                | One interview activation/audit and owned handoff work | No main/public access           |
| Denial        | Registration, unpaid ordinary approval, absent exception, erased/withdrawn owner  | No new grant/send                                     | Safe denied result              |
| Recovery      | Duplicate settlement/activation and ambiguous delivery                            | Idempotent state; no blind resend                     | Bounded unknown/manual recovery |
| Parse success | Real text PDF/DOCX                                                                | Bounded private text proposal; original retained      | No automatic publication        |
| Fallback      | Broken/encrypted/empty/scan/timeout/missing helper                                | Durable manual interview and clear message            | No workflow500 or PII log       |
| Cancellation  | Abort, shutdown, stale revision/erasure during parse                              | Child closes; no late state mutation                  | Preserve saved original         |
| Tags          | Owned editable interview draft, active IDs                                        | Paginate/select/save/reload, limit20                  | No published JSON mutation      |
| Tag abuse     | Forged/group/wrong-bot/missing-chat/inactive/duplicate/21st/stale/replay conflict | No unauthorized change                                | Permanent corrective response   |

</frozen-after-approval>

## Code Map

- `expert-verification-repository.ts:470` in packages/db/src/repositories: settleVerified owns the canonical fact and queues interview_ready; extract only its activation portion after proof validation.
- `expert-card-repository.ts:303,1149,1175`: paidApplication, issueWorkHandoff/redeemWorkHandoff enforce interview and owner linking; never replace with raw access boolean.
- `packages/application/src/expert-card-service.ts:195,493`: private promo handoff and durable raw entries; extend real import/tag paths conservatively.
- `apps/api/src/expert-card-telegram-ingress.ts:47` currently excludes callbacks; add explicit private tag callback ownership before legacy fallback.
- `apps/api/src/routes/telegram-webhook.ts:666`: existing booking/xr1 callbacks retain their own authorization.
- `packages/db/src/schema/expert-cards.ts:27`: private draft/application/user ownership; public catalogue is separate. Next migration58, current174tables.
- `packages/db/src/repositories/privacy-repository.ts:372,988`: withdrawal/erasure cancel private work and remove raw drafts/refs; financial facts cannot resurrect access.
- `apps/worker/src/runtime.ts:285`: bounded cancellation/drain pattern for new consumers.
- `packages/integrations/package.json` ships dist only; `scripts/build-native-release.sh`, Dockerfile and native worker limits are release boundaries, not Python capability proof.
- Owner source manifest and core-stabilization/hashtaxonomy-v2.txt under docs/source/residency-phase1-owner-2026-10-26 are authoritative inputs. Read those two completely.

## Tasks & Acceptance

- [ ] Add resident-workspace application service, shared transactional repository activation and durable notification composition/tests; preserve canonical settlement and handoff authority.
- [ ] Add SafeDocumentParser interface, bounded real adapter/helper/locked graph and Node/pytest tests; wire durable fallback in actual work-bot import path.
- [ ] Add canonical taxonomy/schema/seed/provenance, draft selection storage and actual private UI/tests using isolated mocks plus full-catalogue assertions.
- [ ] Add hand-authored SQL+journal/schema/state where necessary; actual erasure, precise guard inventories/negative probes and focused PostgreSQL acceptance.
- [ ] Complete affected builds/types/lint, independent review and exact-source gate; root delivers a draft STABILIZATION PR and continues the package plan.

Given every matrix row, its executed test must prove the stated behavior. Given
parser failure, original answers remain and manual mode survives another request.
Given interview activation/tag save, no main order/entitlement/publication changes.
Given the full owner catalogue, six mocks never become the runtime seed.

## Spec Change Log

## Execution Notes

Root is the coordinator/final-gate/PR owner and owns
docs/test-evidence/residency-core-stabilization-coordinator-2026-10-26.md.
Fresh implementer owns source/tests/schema, plan/status and implementation evidence,
working sequentially in the existing isolated tree at
/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/phase1-owner-plan-20261023,
branch codex/residency-foundation-20261026. Read AGENT-STATUS first. No push by the
implementer. Root handles review and the requested PR.

The existing task-owned PG17.5 cluster may be reused serially: project
ii-tonya-verification-form-20261026, loopback55483,1CPU/1GiB; protected0600 config
/tmp/verification-form-20261026.compose.json is authoritative. It was stopped after
PR108 acceptance; restart it when needed. Parse credentials only in memory; never
print the config/URL/env or use stale Docker environment values. No extra cluster.

## Verification

Meaningful RED/GREEN Node and Python tests, real synthetic PDF/DOCX extraction,
serialized PG/real ingress cases, affected builds/types/lint/format/diff. Use the
locked parser graph, not observed global packages. Preserve failed logs. Stage new
files before tracked-source guards and reconcile exact old-table constraint pins.
No unchanged broad suite repeats; root runs the canonical final gate with retained
full logs and supported Vitest worker limits1. No staging/provider evidence claim.
