# Resident content safety independent review — 2026-10-26

Candidate a882d5621bb0a0912376b71f8d5c432f9e52c9a8; baseline1ac2091735836fe2a07ed0e8d95bd749f5617e80.
All three fresh context-free reviewers launched before collection. Read-only; no
reviewer ran tests or edited source. Coordinator then inspected reported paths and
one directly related UI recovery path. Same-intent concrete corrections below are
accepted; preserve the implementation and apply one bounded batch, not re-derive.

| ID  | Severity | Source           | Finding and required correction                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | high     | Blind + edge     | SQL0061 policy publication/active-pointer triggers allow direct publication or rollback to an older policy without fresh security-admin authority. Protect underlying transitions with genuine authorization/provenance, not a forgeable session setting. Direct SQL bypass must fail; valid authorized hot publication must still work. A policy rollback must not resurrect old human acknowledgment.                                                          |
| R2  | high     | Edge             | A100-entry media-only draft can retain a proposal that a new policy blocks; no text entry exists to correct and the cap prevents another upload. Provide an owner-bound proposal discard/replacement path in the real bot, preserving originals and working at the cap. Cover wrong owner/revision/replay and subsequent successful submission.                                                                                                                  |
| R3  | high     | Verification gap | Integration test lines835–842 and860–883 catch transaction errors indiscriminately, including their own failed Vitest assertions. Assert the expected database rejection outside the rollback wrapper; prove missing/unknown/corrupt policy cases really fail the test if assessment unexpectedly succeeds. Preserve rollback cleanup without swallowing assertions.                                                                                             |
| R4  | medium   | Verification gap | Real browser client refusal branch has no behavioral coverage: API tests bypass it, view tests mock it. Feed committed safetyBlocked responses through createExpertCardClient and prove private reasons, rejection and no false success display for blocked review/edit.                                                                                                                                                                                         |
| R5  | high     | Coordinator      | expert-card-view.ts controls disables fields while pending exists; mutate catch leaves pending on known committed refusal. Reopening same revision preserves it, so correction or new warning acknowledgment is stuck replaying the rejected command. Clear only definitively rejected safety commands, permit corrected new-key action/current acknowledgment, and retain exact retry custody for unknown transport failures. Test actual client+view recovery. |

R1 evidence: migration0061 lines95–123,307–319; the active-row trigger validates
shape but has no authorization, while unpublished rows can become published via
ordinary UPDATE. Existing tests directly reset the pointer and thus encode the bypass.
R2 evidence: expert-card-repository.ts correctEntry855 requires a text entry;
addEntry preserves the100-entry cap and import completion is not an owner recovery UI.
R3 andR4 have precise mutation demonstrations in reviewer reports. R5 follows the
new refusal branch through actual controls/pending/render/mutate code; an unchanged
revision does not clear pending on reload. No speculative broader redesign required.

## Closure

Pending corrective commit, focused evidence and independent bounded re-review.
Do not rerun broad unchanged suites or repeat a finding quota. Regenerate0061 state
and exact hashes if its unpublished SQL changes; do not edit historical migrations.
No deployment, provider activation, real money operation or release claim.
