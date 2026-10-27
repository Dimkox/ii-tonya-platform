---
title: Local semantic hashtag recommendations and moderated selection
created: 2026-10-27
type: feature
status: in-review
baseline_commit: 254c8c169cbb8432654a46de206bd20500cecc3f
review_loop_iteration: 4
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
  - docs/source/residency-phase1-owner-2026-10-26/hashtaxonomy-v2.txt
  - docs/source/residency-phase1-owner-2026-10-26/sales-technical-final-correction.txt
  - docs/superpowers/plans/2026-10-26-residency-phase1-final-package.md
---

<frozen-after-approval reason="owner approved complete Phase1 package and local tag optimizer; autonomous sequential execution authorized">

## Intent

Finish S3b over accepted rich profile/services: useful local tag suggestions over
the164-entry approved catalogue, editable owner confirmation, moderated custom tags
and safe administrative export. Suggestions are advisory, never diagnoses, verified
competence, pricing or automatic publication.

## Boundaries & Constraints

Latest owner limit is15 recommendations; maximum20 confirmed tags across system,
custom and format selections stays distinct. Exact Unicode words/phrases and approved
synonyms score100, real pretrained semantic cosine strictly>.85 scores50. Stable
ranking prioritizes these scores, then approved catalogue weight/tie-breaker. A
semantic/exact duplicate is one candidate with highest legitimate score. No substring
match for PA inside another word. Normalization must handle Russian case/ё/spacing
and supported morphology, without erasing negation or inventing aliases. The owner
examples КПТ and ПА must match actual source synonyms; method→related problem tags
are explained proposals requiring confirmation, not an automatic expertise claim.
Catalogue reconciliation from actual seed: КПТ, ПА and паника are present. The
owner prose example тревога is not currently a standalone synonym of тревожность;
add it with explicit source provenance (do not pretend it was in the seed or alter
historical seed bytes). The requested related страхи maps through the existing
фобии synonym, not an invented duplicate canonical tag. #онлайн is not among the164
seed entries, so represent confirmed format metadata without an unbounded city seed.
Format proposals count within the15 recommended candidates and within20 confirmed
unique selections; avoid silently appending extra preselected items. Format suggestions
include онлайн or offline city from the current confirmed profile;
no unbounded per-city global taxonomy writes or fake geographical inference.

Use concrete local pretrained vectors, cheap Russian tokenization/morphology and
public catalogue cache precomputation on startup/registry change. No paid runtime
LLM/API, fabricated hash embeddings or always-unavailable semantic stub. Exact
model/dictionary/package bytes/version/license provenance, finite/dimension/norm
validation, bounded input/tokens/time/memory/concurrency and no runtime model/network
downloads. Missing/corrupt/mismatched model/cache gives clear exact-only/manual
fallback without false semantic score. Cache identity includes actual catalogue/
synonym/version and model/tokenizer/normalization digest; no mixed stale/new vectors.
Cache public tag vectors only; private descriptions/query strings or extracted
private-word lemma caches must not persist
in a shared catalogue/model cache. Model artifacts stay outside Git and deployment
activation remains separate. Do not co-locate an unbounded model in the256MiB Node
process or change its existing ceiling to make a benchmark pass.

Root preparation has two real downloaded Navec candidates and isolated Python
package hashes under /tmp/residency-semantic-model-preparation-20261027. Compact
news model probe peaks212262912 bytes, hudlit399654912. Simple lookup times are NOT
end-to-end acceptance. Probe drops unknown qualifiers and therefore is NOT production
code: semantic phrase coverage must be explicit, unknown meaningful tokens cannot
silently collapse a specialized phrase to one broad word. Alternate multilingual
MiniLM ONNX metadata is retained but not executed. A stricter synthetic full-coverage probe now shows real non-identical examples
невысокая самооценка/низкая самооценка0.872351 and проблемы в отношениях/кризис
в отношениях0.866688; it also exposes misleading method association, so no
qualification inference is allowed. These are research fixtures only. Select/prove a fit-for-purpose
local model with real Russian witnesses, do not infer quality from a cosine number.

Compose through actual owner work-bot/profile interface, authenticated ingress and
normal application/runtime. Recommendations are available during paid private interview,
including partial profiles/staged services, so missing confirmed tags cannot deadlock
completion. Read only the exact current valid available text; do not invent absent
profile facts. Reconcile the accepted S3a staged-service queue and replay APIs. Return up to15 current-profile proposals with removable
preselection; existing owner-confirmed choices remain until explicit replacement.
All fields of the proposed selection must be visible and confirmation revision-bound;
no hidden/default additions on a read. Old preview/changed profile/disabled registry
or safety update cannot commit stale selections. Full catalogue browsing remains.

Custom tags are bounded/normalized, policy checked and marked pending moderation;
no unreviewed public tag or global catalogue insertion. BLOCKER refuses, WARNING
is flagged for current manager acknowledgment, respecting accepted CAT_03/#приворот
policy. Manager approves/rejects within current rich revision/diff; records audit and
reason. Selection changes invalidate prior owner/safety/manager confirmation in the
same way as other rich fields while preserving the old live version. All20-limit
checks count normalized unique selections across profile/services, not20per service,
and hold in transactions/concurrent toggle/batch/custom/system paths and directSQL.

Admin export is a real authenticated bounded endpoint/action, safe JSON or correctly
escaped CSV, canonical active/inactive/synonyms/weights/provenance only, no resident
private data. Reuse the actual existing catalog_admin role (admin-service.ts and
admin-approval-repository.ts), with authoritative current session/MFA recheck, rather
than inventing an admin role or treating owner-supplied principal roles as permission.
Custom profile-tag review continues through existing support/security manager authority.
Unauthorized/wrong-role/stale session fails closed. It is not a new
Kanban or BI dashboard. No public raw storage links or newly inferred qualification.

</frozen-after-approval>

## Acceptance Criteria

- Actual КПТ/ПА/exact/synonym/morphology samples give score100, no substring leaks.
- Real non-identical semantic Russian input uses actual pinned model at>.85; equality
  at.85 excludes,0/NaN/wrong dimension/corrupt cache denied. No claimed semantic hit
  from an out-of-vocabulary qualifier being dropped.
- Deterministic top15 unique candidates;20 confirmed maximum under concurrent changes.
- Current-profile recommendations cannot overwrite existing choices on read or with
  stale preview; owner can deselect/add and finalize exact displayed set.
- Custom BLOCKER denied/WARNING flagged; pending never becomes public without current
  manager approval. Revoked/erased/wrong-owner queries have no retained private text.
- Registry/model replacement invalidates old cache atomically; restart loads verified
  cache; missing capability falls back honestly. No provider/network inference.
- Actual warm recommendation through composed API/DB/helper completes<500ms on a
  bounded realistic fixture, with measured CPU/memory and a clearly stated hardware/
  input budget. Include startup/rebuild separately, not in warm claims.
- Real staff export and owner UI flow; async selection/session races remain fenced.

Cross-cutting lesson from S3a independent review: idempotency fingerprints must use
stable original input, not freshly loaded current revisions, new random proposal IDs,
current model generation or reparsed relative dates. Resolve/store those values once
under the canonical request transaction; a repeated committed Telegram update must
acknowledge without duplicate mutations or helper calls. Changed payload under the
same original identity still conflicts. Revocation/erasure must not disclose a cached
private result. Include actual repeated-ingress proof in the new block.

## Code Map

- `packages/contracts/src/resident-rich-profile.ts`: richServiceSchema currently
  stores up to20 free-form tag strings per service; richProfileSchema has no
  separate profile-level tag array. `rich_guided` and `rich_pending_services`
  preserve typed partial services. The new combined20 limit must cover ALL owned
  routes, not only the catalogue checkbox table.
- `packages/db/src/schema/residency-core.ts` / migration0058: canonical hashtags_db
  and expert_card_draft_tags already exist. Existing insert trigger locks draft,
  checks mutable status/active tag and counts only the20 catalogue selections.
  Reconcile normalized catalogue ID/label/synonym/free-form identities rather than
  counting one tag twice because it appears on multiple services. New stricter
  mutable-write checks must preserve immutable approved historical versions.
- `packages/db/src/repositories/expert-card-repository.ts`: getDraftTags and
  toggleDraftTag already provide owner-scoped8-item pages, inactive selected removal,
  current revision and safety checks; reuse them and existing ownerAction replay.
  Imported/guided/service/manager edits also write tags, so custom moderation and
  total-limit guards cannot be bypassed by those paths or directSQL. Latest profile
  approval/version, old-live retention and renewal authority are accepted in S3a through0068; preserve those interfaces and current authority.
- `packages/application/src/expert-card-service.ts`: /tags and ct1 callbacks are
  existing interactive controls. Provide ordinary Russian recommendation/selection/
  custom-add actions, service targeting where needed, and explicit confirmation;
  do not expose JSON/UUID-only workflows. Preview checklist proposals retain their
  scope, so tag selection must identify profile versus particular service clearly.
- `apps/api/src/expert-card-composition.ts`: real composed work-bot capability,
  private adapter, callback acknowledgment and feature flags. Extend normal
  configuration/composition; injected fake recommender alone is insufficient proof.
- `packages/db/src/repositories/resident-content-safety.ts`: safety is SQL-owned
  through resident_card_effective_fields/resident_safety_assess. Add every selected
  custom/format/tag field to current assessment and immutable approval digest.
- `packages/application/src/expert-card-admin-service.ts`,
  `apps/api/src/routes/expert-cards.ts`, `apps/web/src/expert-card-*`: existing
  protected staff detail/diff/review plus fresh session fencing. Custom decisions
  and safe catalogue export use these current authorization patterns; export role
  is catalog_admin, profile review follows the existing manager role policy.
- Existing document helper is isolated on a Unix socket with no network, read-only
  root and bounded memory. Semantic model should use its own bounded provisioned
  helper, not inflate the parser/Node service or give Node the Docker socket.

## Tasks

1. Pin actual compact Russian model/runtime asset contract and helper wire protocol;
   real local unit witnesses for token/phrase coverage, morphology/exact/synonym,
   finite cosine strict threshold, deterministic ranking and safe cache generations.
   Cheap keyword extraction must retain surrounding qualifying/negative terms;
   a lone person/location token never establishes a method/problem specialty.
2. Hand SQL/schema for bounded public cache metadata and exact private selection/
   proposal generations, custom decisions and erasure. Immutable versions and
   all existing financial gates preserved. Add canonical owner-provided тревога
   alias with provenance, not a rewrite of164-entry seed. No vector for private data.
3. Normal composed recommender and recommendation read/preview/toggle/confirm/custom
   flows over partial/current rich text; current input binds to revision, safety,
   registry and model generation. Idempotency checked against original input before
   recomputing; unchanged repeat gets the stored result even after catalogue reload.
   Read-side disclosure still requires current consent/ownership.
4. Staff custom-tag decisions/return reasons, immutable reviewed selection snapshot,
   JSON export and visible owner controls. A custom pending label cannot be written
   as approved simply by placing it inside a service JSON or catalogue-like spelling.
   Rejecting a tag preserves all other answers and returns an actionable owner task.
5. Focused normal ingress/real helper/realPG/realUI and populated-upgrade witnesses;
   measure warm full pipeline and startup/cache rebuild separately. Separate three
   reviewer lenses then exact repository gate and stacked DraftPR. Continue S4.

Do not impose a new marketing/paid activation gate for a semantic helper outage:
exact-only plus manual confirmed selection remains available honestly. Production
model provisioning is separately reviewed; local proof must actually run pinned
assets under the stated isolation budget. No fabricated model output for acceptance.

Latest comprehensive owner spec names `tag_embeddings_cache`: use an actual bounded
public PostgreSQL cache with generation/model/taxonomy provenance and validated
vectors (not metadata-only rows claiming embeddings). Helper in-memory matrix may
mirror that exact published generation. Prepare and atomically publish a complete
generation; readers cannot mix vectors from different model/catalogue states.

Selection UX details for final reconciliation: each proposal names whether it edits
profile tags or a particular service. Do not copy profile tags into every service
or silently remove existing choices to fit20. Show the full proposed replacement
for that scope, preserve other scopes, and reject an over-limit aggregate with a
clear editable count. Canonical identity includes approved aliases and normalized
case/ё/space/#/underscore forms; arbitrary custom labels cannot impersonate a
canonical tag or evade pending moderation. Preserve readable user spelling where
needed while counting canonical identity consistently in TypeScript and SQL.

Use actual selected methods/problems as proposal evidence; classify person/location
only from explicit profile fields or cheap bounded text analysis. Do not add a
heavy NER/paid model requirement absent from the approved optimized runtime.
Adjacent method→problem suggestions remain visibly associated proposals with
source provenance and no claim that the owner already works with those problems.

Historical compatibility witness: accepted S3a permits up to20 tags per service,
so an already approved profile can legitimately contain more than20 unique tags
across its services. Migration must preserve that immutable accepted version and
its public/financial authority without rewriting it or failing startup. Enforce
the new aggregate limit on mutable selection/edit/confirmation paths; show an
explicit reduction requirement when creating a newly reviewed version from that
history. Include a populated pre-S3b version with this shape in upgrade evidence,
not just a seed-only replay. No hidden truncation of old tags or destructive cleanup.

## Verification and execution ownership

One fresh implementer owns source/schema/hand migrations/test/runtime helper/runbook
and hashed evidence. Root owns frozen contract/master/status/coordinator/review and
final gate/push. No descendants. Existing one protectedPG17.5 and private parser
remain; use only task-owned semantic helper resources with explicit labels. Keep
external integrations disabled; no runtime network/model downloads or paid inference.
The helper must be separately provisioned; Node cannot launch containers or access
Docker socket. Pin exact environment/model/dictionary bytes, keep artifacts outside
Git, validate before use and expose clear degraded status if unavailable.

Use meaningful RED before behavior changes. Focused deterministic matcher/schema
tests, realPG concurrency/selection/generation/erasure and populated historical
upgrade, normal authenticated owner ingress plus real local helper, fresh staff
MFA/export/custom moderation and actual browser selection race proof. Run relevant
types/lint/format/diff checks once after coherent corrections. Serialize metadata,
PG and heavybuilds; no unchanged broad repeats or repeat-helper count above3. Owner
necessary-focused-rerun authorization persists. Retain harness and real failures
truthfully with commands/exit codes and source/raw/gzip SHA256 evidence. Never print
secrets/env/protected config or put connection URL in process arguments.

Use /tmp/verification-form-20261026.compose.json only in childmemory; current
credential was rotated earlier and stale environment/inspection values are invalid.
Keep original parser socket /tmp/residency-private-parser-20261026/socket/parser.sock
for shared later journey. At end commit ownedfiles only; root performs three-layer
independent review and canonical final gate/mandatory push, then DraftPR. No hosted
CI/deployment/release claim. S4 continues after this accepted block.

## Spec Change Log

-2026-10-27: source reconnaissance reconciles existing164 taxonomy, S3a partial
services/current review APIs, actual catalog_admin role, no duplicate paid-flow
authority, latest top15 versus aggregate20, direct SQL/concurrent enforcement,
and legacy already-approved profiles exceeding20 across services. Preparation
model probes are explicitly research, not implementation/performance acceptance.
Delivered S3a baseline is254c8c169cbb8432654a46de206bd20500cecc3f (DraftPR115).

## Exact execution identity

Work only in .worktrees/phase1-owner-plan-20261023, branch
codex/residency-semantic-tags-20261027. Baseline254c8c169cbb8432654a46de206bd20500cecc3f
is delivered DraftPR115; source46e03bf0 is independently accepted and full/push gates
passed611/611. Next hand-authored migration0069; do not edit0068 or earlier SQL.
Read residency-semantic-tags-preparation.md for pinned candidate research, not product
acceptance. RequireDocker preflight passes Node24.22.1/pnpm11.9.0/PG17.5 environment.
Do not rerender BMad; the original rendered build workflow continues. No story_key.
Root may organize subsequent S4 into sequential schedule/booking and notice/lifecycle
contracts; all approved work and final end-to-end journey remain required.

## Implementation clarifications

Owner-provided method→problem associations must be distinguishable from actual
semantic matches. Do not invent cosine or semantic50 for an association lacking
a measured>.85 match; explicit relation provenance ranks beneath direct exact/
real-semantic evidence. Formats/associations still share the15 recommendation
limit and20 confirmed canonical aggregate. No competence claim or silent selection.

Advance exact current-journal-tail guard in
tests/repo/hybrid-message-gateway-schema-parity.test.ts with the actual additive
migration metadata, retaining historical0041/B1 assertions and strict equality.

Legacy aggregate-limit reachability: a historical approved version may exceed20
across multiple services. Ensure a real owner path can reduce that set; rejecting
every individual removal while the remainder still exceeds20 creates a deadlock.
Provide an explicit whole-profile replacement within20, or permit strictly
decreasing removals in a grandfathered mutable draft while forbidding additions
and final confirmation/review above20. Preserve immutable prior approval and all
unrelated answers; no hidden truncation/reset. Cover through populated upgrade
and owner commands, not only a directSQL assertion.

Ordinary custom-tag input must be reachable through a readable button and plain
text label, without asking the owner to copy an internal preview UUID. Bind the
reply to its original server-issued scope/preview/revision and consent; a delayed
reply must not silently attach to a newer scope. An advanced token command may
coexist, but cannot be the only normal path. Verify actual ingress for the simple
label and stale/wrong-scope reply, preserving original-input replay.

## Independent-review correction contract

All three initial reviewers inspected79b5d233. Six unique findings remain after
deduplicating identical claims/actions. Ordinary-reply routing is already corrected
in9182ab18 and awaits assigned reviewer closure. See residency-semantic-tags-review.md.

For newly inactive selected tags, a normal owner must be able to remove them across
separate scopes one step at a time. Permit only strictly reducing obsolete selected
content during mutable repair; no additions, unrelated unsafe edits, hidden removals
or final confirmation/approval until all selections are valid. Keep historical
immutable versions intact. Check the same selected-content removal boundary for
newly blocked tag policies without weakening whole-card safety or allowing a tag
removal to authorize another blocked field. Prove ordinary catalogue and service
paths, not only direct SQL. This refines the existing editable/removable requirement.

Exact fallback must apply negation to the same normalized Unicode token stream as
matching, including punctuation/brackets/colon, so «тревожность (не паника)» and
«Исключая: паника» cannot preselect the excluded panic topic at100. Preserve safe
positive exact/synonym matching; no fabricated semantic fallback.

Prove complete current-card review on realPG: pending/rejected/stale custom decisions
block approval; a current approved decision permits a complete owner-confirmed card
and is preserved with the selection in its immutable reviewed snapshot. Browser
disabled-button fixtures alone do not prove this transactional boundary. Update
existing rich-onboarding fixtures to obtain legitimate current custom approval or
explicit valid canonical selection, preserving their original photo/renewal/
immutable-version assertions. Never weaken the moderation guard to fit old fixtures.

Integration tests must execute from a clean checkout without an untracked local
evidence directory. Optional browser fixture export may be explicitly configured;
otherwise use a created temporary directory with cleanup. Keep archived witnesses
reproducible and clearly separate from mandatory integration execution.

Preserve all passing model/callback/ordinary-reply/replay/upgrade/browser evidence.
Make bounded additive corrections, not destructive re-derivation; owner authorized
continuation and necessary focused reruns. If0069 changes, reconstruct current state
and update exact hash guards. Root does not run competing PG/build jobs.

R4 immutable proof may use the existing immutable decision rows authoritatively
bound to the reviewed version's draft/revision; a duplicate decision JSON column is
not required. Prove the reviewed selection and associated decisions cannot be
replaced by later mutable edits/new decisions, while retaining privacy erasure.

R2 progress is per-scope selected occurrences, not only global DISTINCT identity
count: the same obsolete tag in two services must be removable one occurrence at
a time. No addition/non-tag edit is authorized; all final limits/validity remain.

## R2 ordinary-path completion

Second independent assessment accepts R1/R3–R6 but finds two remaining R2 seams.
Profile confirmation must retain authoritative original legacy-catalogue selections
when it replaces/deletes them; a live re-query after deletion cannot represent OLD
selection. Do not trust an arbitrary caller-supplied repair snapshot or relax final
SQL validity. Prove catalogue A plus staged B, both inactive, removal through the
ordinary profile recommendation/confirmation while B remains, then B removal.

Recommendations must preserve readable retained aliases consistently. Guided
[ПА,#тревожность] and pending[ПА,#фобии], with anxiety/phobia disabled, must allow
either obsolete selection to be removed while retaining the active panic choice.
A presentational canonical label must not masquerade as a new scoped selection or
make repair impossible. Preserve strict no-add/move and non-selection-content
guards, current confirmation, original replay and whole-card moderation checks.

Keep all accepted corrections/evidence. Add focused RED/GREEN actual owner ingress/
repository proofs for these precise cases and relevant state/types/lint. Refresh
0069 state if its SQL changes; unchanged broad/model suites remain unnecessary.

The existing tagAction also admits an approved draft. Catalogue-only repair must
handle its normal transition to collecting/confirmation invalidation while keeping
the prior immutable approved version intact, not only an already-collecting fixture.

## R2c general strict-removal boundary

Second residual assessment accepts both original R2a/R2b cases but finds a mixed
profile removal: inactive catalogue A, active semantic C, inactive staged B;
deselect A+C in one profile preview. After A deletion the old-row helper only sees
active C removed and wrongly rejects the remaining B. Do not add caller-supplied
proof or another storage-migration workaround.

Clarify the non-frozen repair rule: any genuine strict per-scope selection subset
is a safe private repair when no selection is added/moved and every unrelated
answer is byte-identical and passes the existing unrelated-content gate. The owner
may choose to remove an active tag before an obsolete one; requiring the removed
occurrence itself to be obsolete creates artificial deadlocks. The draft can remain
incomplete/invalid privately, but owner finalization/manager approval, additions,
unchanged invalid confirmation and unrelated unsafe edits remain prohibited.
Actual catalogue DELETE OLD tuples prove removal; draft JSON proves its own strict
subset. Neither needs to invent the now-deleted catalogue contents. Retain original
owner/consent/revision, replay and immutable-public-version authority.

Cover combined A+C deletion while B remains, active-only semantic and catalogue
removal while obsolete selections remain, no-add/move, unchanged-invalid denial,
unrelated blocked-field denial and final R4 moderation control. Preserve all
previous passing paths/evidence and reconstruct0069 only when its SQL changes.
This clarifies safe removal already required by editable owner selection, not new
authority to introduce blocked content or approve an invalid card.

## Legacy tag syntax repair (R7, same bounded batch)

Root traced another concrete compatibility boundary: pre0069 richServiceSchema
accepts any bounded text tag, including «Стресс, тревога» or emoji, whereas0069
introduces a character whitelist and unconditionally rejects any remaining invalid
label before subset repair. Two previously approved such labels in separate services
therefore cannot be removed incrementally. Treat remaining legacy invalid label
syntax as incomplete selected content under the same genuine strict-removal rule;
never allow new invalid labels, additions/moves, invalid finalization or unrelated
content changes. The confirmed scope may still be required to be syntactically valid.
Use actual populated pre0069 source/schema evidence, preserve its immutable version
and financial facts, then remove both scopes through normal owner operations. Do not
manufacture historical state by disabling current guards. Retain negative new-invalid
label and final approval controls. This preserves accepted legacy data and user repair
reachability, without relaxing the new syntax rule for new content.

## R7 within-scope repair consistency

Final SQL review accepts the strict-removal authority, but edge identifies the
application's tagSelectionSchema precheck still rejects an unchanged legacy-invalid
label retained in the same scope. The previous non-frozen allowance for a completely
valid confirmed scope is superseded here: apply the same bounded private-removal
rule consistently across scopes and within one scope. Do not require the owner to
remove all obsolete labels from one service in a single confirmation.

Keep type/size/count bounds. Permit unchanged historical labels only when authoritative
SQL proves a genuine strict subset with no additions/moves/non-tag changes. Newly
introduced invalid labels, unchanged-invalid confirmation and whole-card finalization
stay denied. A pre0069 service [Стресс, тревога; Спокойствие 🙂; #КПТ] must allow
removing just the comma label, retaining emoji unchanged, then removing emoji, with
old approval and financial/non-tag facts intact. Verify actual owner callbacks and
invalid-new-label/unchanged/finalization controls. Preserve accepted SQL/state if
its existing guard is sufficient; no unnecessary reconstruction or broad rerun.
