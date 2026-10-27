# Semantic tags independent review

Baseline254c8c169cbb8432654a46de206bd20500cecc3f; reviewed exact
79b5d2334b7261a94621ecac15142df1b7053dab. Three fresh read-only reviewers inspected
the committed diff and relevant exact source/evidence without running tests or
mutating resources. All were launched before triage; all finals received.

| ID | Reviewers | Severity / classification | Finding and required action | Status |
| --- | --- | --- | --- | --- |
| R1 | blind, edge | high / patch | Any Telegram reply entered custom-tag handling; media replies rejected. Recognize only original tag invitations; preserve ordinary interview/command replies and disabled-tag mode. service:482, ingress:168. | Closed: blind + edge PASS9182ab18 |
| R2 | blind, edge | high / bad_spec | SQL0069:96 rejects removing one inactive tag if another remains, deadlocking cross-scope cleanup. Allow bounded strictly reducing obsolete selections with final validity gates intact. | Closed: all assigned SQL paths accepted7b4f79f5 |
| R3 | blind, edge | high / patch | contracts/resident-semantic-tags.ts:70 uses whitespace for negation and Unicode words for matching. Brackets/colon hide negation and preselect an excluded topic at100. Use consistent tokens and meaningful regression. | Closed: both PASS eb110d74 |
| R4 | gap | medium / bad_spec | Tests show pending decisions/UI but never exercise whole-card SQL approval. Prove pending/rejected/stale rejection and current-approved immutable snapshot through actualPG review. | Closed: gap PASS eb110d74 |
| R5 | gap | medium / patch | tests/integration/resident-semantic-tags.test.ts:455 writes to an untracked directory, failing clean checkout withENOENT. Make optional export or created temporary destination. | Closed: gap PASS eb110d74 |
| R6 | gap | high / patch | Existing rich-onboarding fixture uses custom «поддержка» without current custom approval, so its approval/renewal/photo scenarios now fail. Update fixture through legitimate authority and run affected focused cases. | Closed: gap PASS eb110d74 |

R2/R4 clarify non-frozen verification/repair requirements already implied by owner
intent. No owner decision is missing. Preserve current working implementation and
all original101/39, ordinary31/11 and reply13/4 artifacts/source pins. Root verified
all archive/raw pairs and source hashes against their respective commits. No
production/provider activation or claim of whole-package completion.

Only semantic_tags_implementer edits source/tests/0069/state/evidence. Root owns
contract/review/status/coordinator/final gates. Independent reviewers will close
assigned findings against exact corrected SHA and retained meaningful evidence.

## R1 closure

Both assigned blind and edge reviewers independently accepted R1 at
9182ab188fad0907e5852fa35f96fce4e655a64a. They inspected the original invitation
classification, ordinary routing/fingerprint compatibility and retained2/2 actual
ingress/PG scenarios. Blind also independently verified13 archives/4 source hashes.
No tests were repeated by reviewers. R2–R6 remain in implementation.

R4 scope clarification: current immutable decision rows may remain separate from
resident_card_versions if their authoritative draft/revision association is
immutable. No duplicate JSON decision column is required. Proof must preserve
reviewed selections and associated decisions against later mutable revision edits,
while retaining existing privacy erasure. This avoids unnecessary schema expansion.

## Correction review at eb110d74

All three assigned reviewers completed the correction assessment. R3 is accepted
by blind+edge; R4–R6 by gap. Root independently verified55 archives/13 source pins;
reviewers independently verified the same evidence and migration/state hash chain.
R1 remains accepted. R2 has two distinct remaining normal-path failures:

- R2a (blind): profile recommendation deletes legacy catalogue rows before the draft
  update. OLD and current selection helpers both read the now-empty live table, so
  the removed obsolete occurrence is invisible. Select A through /tags, B in a
  staged service, disable both; profile recommendation/deselectA/confirm fails
  card_inactive_tag. Preserve authoritative pre-deletion context, not caller claims.
- R2b (edge): retained «ПА» aliases become candidate «#панические_атаки» on recommend,
  but repair compares raw scoped labels and treats this as an addition. Guided
  [ПА,#тревожность], pending [ПА,#фобии], disable anxiety/phobia; neither scope can
  remove its inactive label while retaining panic. Preserve readable existing
  spelling/identity consistently through proposals and repair.

One bounded second correction is assigned to the same producer, with actual ordinary
flow regressions, preservation of all prior guard proofs, refreshed state if SQL
changes, and no destructive restart/broad rerun. No new owner decision is needed.

## Final R2 reassessment at c3244a58

Edge accepts R2b and adjacent original R2a behavior; gap accepts new proof/state.
Blind confirms original R2a fixed but identifies R2c: profile removes inactive
catalogue A and active semantic C while inactive staged B remains. General draft
update only observes active C removed after A deletion and wrongly denies repair.
All38 archives/12 source pins and preserved manifests match, independently checked.

R2 remains open solely for this removal-boundary generalization. Contract iteration3
clarifies that strict per-scope subset deletion need not remove an obsolete label
itself. No additions/moves/non-tag edits or invalid finalization are allowed. Test
combined and active-only removals via actual owner paths; keep earlier corrections
and all evidence. No owner decision or destructive re-derivation is required.

## Root compatibility finding R7

High / bad_spec. resident-rich-profile.ts:64 historically accepts any text(80) tag;
0069:128 unconditionally rejects a label outside the new whitelist before repair.
A pre0069 approved profile with comma/emoji tags in separate services cannot remove
one while another remains. Include in the current bounded batch: authentic populated
upgrade and strict partial removal; preserve immutable history, new-label rejection
and final validity. Independent assigned reviewers must assess this added boundary.
This is a concrete changed-validation compatibility issue, not a speculative threat.

## Assessment at7b4f79f5

Blind and gap accept R2/R7 SQL and retained evidence; edge accepts R2c but finds
application-level R7 within-scope restriction: repo2055 tagSelectionSchema rejects
a remaining historical emoji tag before reaching the accepted SQL subset guard.
Two bad labels in one service can only be removed together. The non-frozen contract
previously permitted scope-level strictness; root now chooses consistent bounded
private repair at both layers, preserving all final validity and new-label guards.
One focused application/legacy-owner proof correction remains. SQL/state need not
change if existing authority suffices. R2 is closed at7b4f79f5; R7 remains pending
this narrow usability/compatibility completion. All48 artifacts/7 pins independently
verified by the assigned reviewers. No new business decision or approval is needed.
