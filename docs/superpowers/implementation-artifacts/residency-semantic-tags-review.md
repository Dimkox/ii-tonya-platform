# Semantic tags independent review

Baseline254c8c169cbb8432654a46de206bd20500cecc3f; reviewed exact
79b5d2334b7261a94621ecac15142df1b7053dab. Three fresh read-only reviewers inspected
the committed diff and relevant exact source/evidence without running tests or
mutating resources. All were launched before triage; all finals received.

| ID | Reviewers | Severity / classification | Finding and required action | Status |
| --- | --- | --- | --- | --- |
| R1 | blind, edge | high / patch | Any Telegram reply entered custom-tag handling; media replies rejected. Recognize only original tag invitations; preserve ordinary interview/command replies and disabled-tag mode. service:482, ingress:168. | Corrected9182ab18, awaiting review closure |
| R2 | blind, edge | high / bad_spec | SQL0069:96 rejects removing one inactive tag if another remains, deadlocking cross-scope cleanup. Allow bounded strictly reducing obsolete selections with final validity gates intact. | Open |
| R3 | blind, edge | high / patch | contracts/resident-semantic-tags.ts:70 uses whitespace for negation and Unicode words for matching. Brackets/colon hide negation and preselect an excluded topic at100. Use consistent tokens and meaningful regression. | Open |
| R4 | gap | medium / bad_spec | Tests show pending decisions/UI but never exercise whole-card SQL approval. Prove pending/rejected/stale rejection and current-approved immutable snapshot through actualPG review. | Open |
| R5 | gap | medium / patch | tests/integration/resident-semantic-tags.test.ts:455 writes to an untracked directory, failing clean checkout withENOENT. Make optional export or created temporary destination. | Open |
| R6 | gap | high / patch | Existing rich-onboarding fixture uses custom «поддержка» without current custom approval, so its approval/renewal/photo scenarios now fail. Update fixture through legitimate authority and run affected focused cases. | Open |

R2/R4 clarify non-frozen verification/repair requirements already implied by owner
intent. No owner decision is missing. Preserve current working implementation and
all original101/39, ordinary31/11 and reply13/4 artifacts/source pins. Root verified
all archive/raw pairs and source hashes against their respective commits. No
production/provider activation or claim of whole-package completion.

Only semantic_tags_implementer edits source/tests/0069/state/evidence. Root owns
contract/review/status/coordinator/final gates. Independent reviewers will close
assigned findings against exact corrected SHA and retained meaningful evidence.
