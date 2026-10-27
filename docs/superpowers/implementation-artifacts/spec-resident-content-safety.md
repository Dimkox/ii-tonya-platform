---
title: Guard resident content with bounded rules and human warning review
type: feature
created: 2026-10-26
status: done
baseline_commit: 1ac2091735836fe2a07ed0e8d95bd749f5617e80
review_loop_iteration: 1
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
  - docs/source/residency-phase1-owner-2026-10-26/content-safety-filter.txt
  - docs/source/residency-phase1-owner-2026-10-26/phase1-final-comprehensive.txt
---

<frozen-after-approval reason="owner approved content-safety specification and autonomous execution without routine approval loops">

## Intent

Resident card text, extracted proposals and tags lack the owner's blocking/warning
moderation. Add one versioned database-owned safety mechanism to actual work-bot,
manager and publication paths. BLOCKER denies content; WARNING remains available
but requires visible human review. This is separate from the client copy guard.

## Boundaries & Constraints

**Always:** Keep existing private owner/consent, paid interview, manager fresh MFA,
revision/replay, finance/promo/publication and erasure authority. Extend current
card structures; future rich bio/services reuse this mechanism. Preserve accepted
source text and uploaded files; evaluate normalized copies. No LLM/provider call.

Keep `forbidden_patterns` with UUID, `pattern_regex`, category, severity,
error template and active flag. Seed at least20 effective source-derived rules,
not filler. Medical/financial/hate/scam BLOCKER; political/magical sensitivities
WARNING. `вылечу рак` blocks; `#приворот` warns and remains reviewable; ordinary
CAT_03 stays available. `#лечениерака`/`#быстрые_деньги` are forbidden. Caps strictly
above50percent of cased letters warns; zero cased letters does not. Report exact
field/reason constructively; matched fragments may appear only in the owner's or
authorized manager's private response, never incident/telemetry storage.

Use a documented bounded regular-syntax subset, not arbitrary backtracking regex.
Unsupported or oversized policy cannot activate. Atomic authorized SQL publication
makes the next transaction observe the new valid version without restart; failed
candidate activation leaves the prior version unchanged. Missing/corrupt active
policy, unknown engine, timeout or exhausted budget denies gated work. Never skip
invalid active rules. Bind decisions to exact effective content, draft revision,
current policy and selected tag values as well as IDs. Policy changes invalidate
cached/pending approval authority. New publication/activation requires current
database-produced safety proof; never invent historical human acknowledgment.

Integrate actual save/import/tag/submit and manager edit/approval paths. Blocking
an extracted proposal preserves its upload and enters existing manual fallback.
Forbidden selections are excluded with feedback. WARNINGS are visible in manager
detail with reviewable fields; approval requires the manager to explicitly attest
to current warnings under existing authority. No caller-supplied safe Boolean.

Persist minimal `security_logs` incidents (subject/field/rule/policy/revision,
time/action) and committed blocked request outcomes; rolling back the rejected
content must not erase the incident. Replay is consistent and does not multiply
incidents or falsely report success. Erasure removes personal incident/outcome
linkage through the existing subject lock and cleanup.

Raw entries are append-only. Provide a usable owner-bound correction/supersession
path in the real bot, retaining history while evaluating only current effective
content. A legacy/new-policy blocked answer cannot permanently poison the draft.
Changes invalidate prior review/projection consistently with existing semantics.

**Ask First:** Production deployment, provider activation or actual money actions.
**Never:** Rewrite historical migrations or financial contracts; weaken guards;
blanket-ban esoteric taxonomy; evaluate registry strings as JS/SQL arbitrary regex;
introduce a second application stack, paid LLM, new client cabinet or Kanban project.

## I/O & Edge-Case Matrix

| Scenario  | Input/state                                      | Required outcome                                              |
| --------- | ------------------------------------------------ | ------------------------------------------------------------- |
| Block     | Medical guarantee in new answer/public edit      | No content save; committed private reason/incident            |
| Warn      | #приворот or caps>50percent                      | Save, visible warnings, explicit manager acknowledgment       |
| Correct   | Old effective answer now blocked                 | Actual bot correction succeeds; history remains private       |
| Import    | Unsafe extracted text                            | Original file retained; manual fallback; no unsafe proposal   |
| Policy    | Valid/invalid replacement, concurrent review     | Atomic current version or unchanged prior; stale proof denied |
| Tag       | Forbidden/custom text or changed catalogue label | Reject forbidden selection; bind actual current value         |
| Authority | Foreign/stale/replayed owner or manager          | No unauthorized write/disclosure; stable blocked replay       |
| Publish   | Raw SQL bypass, stale revision/policy            | Deny new publication/activation without genuine proof         |
| Erase     | Block/warn records then deletion                 | No personal incident/outcome resurrection                     |

</frozen-after-approval>

## Code Map

- `apps/api/src/expert-card-telegram-ingress.ts:45`, routes/telegram-webhook.ts:613, expert-card-composition.ts:78: actual private work ingress, protected ACK and real repository composition. Extend owned callback prefix only if needed for correction; do not bypass generic ingress authority.
- `packages/application/src/expert-card-service.ts:309,362,456,592,609`: work scope, tags, submit, input and optional document completion; original media already persists before parsing. Keep TODO prompt behavior.
- `packages/db/src/repositories/expert-card-repository.ts:117,331,376,410,596,713,1073`: exact four-field public card; owner, durable requests, rollback wrapper, ownerAction/staffAction. Introduce committed typed blocked outcomes rather than logging then throwing.
- Same repository: addEntry747, completeDocumentImport773, tag toggle877, submit916, readDraft1008, editPublicCard1160, reviewCard1182. Detail currently omits proposal/tags; expose warning context without public leakage. Existing raw-entry immutability is0054:194.
- `apps/api/src/routes/expert-cards.ts:42,104`, `packages/application/src/expert-card-admin-service.ts:34,125,172`, `apps/web/src/expert-card-client.ts:18,171`, expert-card-view.ts:123: existing small manager interface; integrate reasons and exact warning acknowledgment here.
- **Latest SQL**, not historical copies: `packages/db/migrations/0056_residency_offer_corrections.sql:141,347` replaces activation and publication guards. Preserve both promo-evidence branches and actual main admissions.0058:202 supplies tag ownership guard.
- `packages/db/src/repositories/expert-residency-main-projection.ts:55,85` and expert-card-repository.ts:446 consume activation proof. Preserve existing lifecycle/archival authority and financial facts.
- `packages/db/src/repositories/privacy-repository.ts:985`: card/request erasure; new safety linkage must join it. Client `packages/domain/src/safety.ts` is read-only for this block.
- Fixtures: `tests/integration/residency-core-stabilization.test.ts:249,480,602,687,913,1219`; `phase1-card-publication.test.ts:1008,1132,1321,1377,1696,2075`. Real Fastify/PG acceptance is mandatory, not injected helper-only proof.

## Tasks & Acceptance

- [x] Add0061 registry, bounded interpreter, policy activation, exact safety/outcome/incident and effective-content correction structures; hand SQL+journal/schema/state reconstruction and privacy guards.
- [x] Seed effective source rules with provenance and positive witnesses; implement atomic hot reload and bounded failure behavior.
- [x] Wire normal bot corrections, save/import/tags/submit, manager detail/edit/acknowledgment and new publication guards.
- [x] Execute full matrix, legacy compatibility and policy races; precise boundary/inventory negative probes, metadata, builds/types/lint; retain RED/GREEN evidence and local commit.

Acceptance includes every seeded rule's positive witness; Cyrillic/mixed case,
NBSP/newline, percentage endings and benign containing words; caps49/50/51;
nested regex/backreferences/excess alternatives rejected; invalid activation
retains exact prior policy; missing active policy denies. Prove blocked incidents
survive rejection/replay, supersession restores usability, tag-label changes
invalidate evidence, actual manager sees/acknowledges warnings, direct SQL cannot
bypass and deletion clears personal linkage. Test a policy-change/approval race.

## Design Notes

One dependency-free SQL-authoritative interpreter is selected. `resident_safe_regex_v1`
admits literal tokens/escaped punctuation, optional outer Unicode-aware `\b`,
`\s+`, the two approved numeric `\d+` templates, `[км]` and flat literal alternation.
Compile on activation into bounded token predicates; verify stored source and
compiled representation correspond. Never pass registry values to RegExp or SQL~.
Use immutable policy versions and an active singleton row: safety transactions
hold FOR SHARE, publication updates it. Start without an application cache.
Bounds:256 active rules,512 pattern bytes,16 atoms/alternatives,64000bytes/field,
125 effective fields and2MiB aggregate. Preserve existing100-entry/20-tag/media
limits. Retain2s statement/1s lock timeout as additional limits, not sole safety.

Source corrections are explicit provenance: `вылеч[ию]` must include required
`вылечу`; enumerate disease inflections; Unicode boundaries and `%` endings;
Latin a in `единственнaя`; placeholder racial-insult class is not executable;
joinchat lookahead cannot authenticate an official exception. Malformed
`все остальные во\nlаке` stays quarantined with `TODO: Wait for Content Spec`,
not guessed or counted as a rule. Owner was notified; it blocks no other work.
A source-derived35-rule inventory can split existing compound categories. Preserve
explicit five insults only; no invented broad abusive vocabulary.

## Spec Change Log

- Review iteration1: preserve working bounded matching, owner/finance/privacy gates,
  committed outcomes and correction history. Close concrete R1–R4 findings in
  `docs/test-evidence/resident-content-safety-review-2026-10-26.md`: authorized
  underlying policy transitions and nonresurrecting rollback, proposal recovery
  at the raw-entry cap, non-swallowing fault assertions, actual browser refusal
  coverage and known-refusal UI recovery without weakening unknown-send retries.
  R5 was rejected after exact candidate inspection: failed() already clears known
  refused commands. R4 tests that existing behavior without an unnecessary redesign.
  Owner autonomy overrides routine re-derivation/approval loops; one corrective batch.

## Execution & Verification

Single fresh implementer owns source/tests/migrations and its evidence; no descendants.
Root owns coordinator evidence, independent review, gate and PR. Work only in the
existing isolated tree on codex/residency-content-safety-20261026. Owner's autonomous
execution and routine approval/run-count/splitting opt-out remain effective. BMad
was rendered once for this package; do not rerender or restart previous blocks.

Reuse existing task PG17.5 project ii-tonya-verification-form-20261026,loopback55483;
protected0600 /tmp/verification-form-20261026.compose.json supplies credentials only
in child memory. No printing config/URLs/env, no stale container credential lookup,
no extra cluster. Serialize PG/metadata/heavy builds. Node24/pnpm11.9 unchanged.
Next migration0061; no drizzle generate. Exact registrations include companion
inventory tests (expert-referral-scope-guards and hybrid-message-gateway-schema-parity).

RED before behavior; focused GREEN, relevant old-path compatibility, affected
builds/types/lint/format/diff checks. No unchanged broad repeats; repeat helper≤3.
Retain complete logs/hashes and distinguish skipped cases. Root owns canonical
final gate/independent review; no hosted CI exists, no release claim from local tests.

## Suggested Review Order

**Normal private workflow**

- Trace owner commands and refusal rendering through the existing paid-interview workflow.
  [expert-card-service.ts:237](../../../packages/application/src/expert-card-service.ts#L237)

**Database authority**

- Authorize immutable publication facts and bind activation to a fresh generation.
  [0061_resident_content_safety.sql:124](../../../packages/db/migrations/0061_resident_content_safety.sql#L124)

- Apply bounded normalized rules and bind exact content to current policy.
  [0061_resident_content_safety.sql:176](../../../packages/db/migrations/0061_resident_content_safety.sql#L176)

**Recovery and human review**

- Preserve originals while repairing current content at the raw-entry cap.
  [expert-card-repository.ts:829](../../../packages/db/src/repositories/expert-card-repository.ts#L829)

- Require fresh manager authority and explicit current warning acknowledgment.
  [expert-card-repository.ts:1424](../../../packages/db/src/repositories/expert-card-repository.ts#L1424)

- Propagate committed refusals without reporting false success.
  [expert-card-client.ts:292](../../../apps/web/src/expert-card-client.ts#L292)

**Acceptance evidence**

- Verify underlying SQL authorization and old-proof invalidation after authorized rollback.
  [resident-content-safety.test.ts:1003](../../../tests/integration/resident-content-safety.test.ts#L1003)
