# Rich onboarding independent review — 2026-10-27

Runtime reviewed:5602413c7dca6809569d788b9d8254df80846cc8.
Baseline:219f8e0c9d0938fccb4188cf0081f71b3f8b2db9.
Portable evidence-only successor:3d3ca163f34f4cf3fdd8ea772d62a2294987c236.

Three fresh context-free read-only reviewers (blind, edge, verification gap) were
launched together. Root waited for all final reports before triage. No reviewer ran
tests, modified source or accessed providers/DB. The following are accepted current
increment defects or proof gaps, not a reason to restart accepted earlier blocks.
Severity is coordinator-assigned. All route to authorized incremental correction;
the owner's standing override forbids destructive re-derivation/permission/quota loops.

| ID  | Severity | Source and concrete failure                                                                                                                                                   | Required correction and proof                                                                                                                                                                                                                                           | Assigned reviewer |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| R1  | high     | expert-card-repository.ts1103: automatic current revision participates in request fingerprint; replay of committed mode/guided input computes a newer revision and conflicts. | Stable original Telegram-input replay identity; altered payload still rejected. Actual repeated ingress returns duplicate/ack with one revision change.                                                                                                                 | edge              |
| R2  | high     | resident-rich-profile.ts418 / expert-card-service.ts697: labelled service parsing generates random UUID before replay comparison.                                             | Derive/reuse server identity from immutable source or check original request before nondeterministic work; repeated full service import must not conflict or duplicate.                                                                                                 | edge              |
| R3  | high     | expert-card-repository.ts1017: legacy rich_profile=NULL dereferenced after successful photo PUT.                                                                              | Keep legacy upload behavior safe or explicitly transition before any write; no stranded inflight custody from null dereference. Real legacy upload/erasure witness.                                                                                                     | blind             |
| R4  | medium   | expert-card-repository.ts933: count of all historical media permanently caps replacements at ten.                                                                             | Bound active selection/inflight work with a real safe replacement/cleanup path; preserve current approved photos and uncertain-write deletion obligations. Prove replacement after ten historical uploads and reselecting a removed verified photo without another PUT. | edge              |
| R5  | high     | resident-rich-profile.ts132 and SQL validator: UUID text case permits one photo represented three ways to satisfy minimum.                                                    | Canonical identity comparisons in application/SQL and ownership check; mixed-case aliases count once. Apply same stable identity rule to service IDs.                                                                                                                   | edge              |
| R6  | high     | expert-card-repository.ts2170 / migration0066 publication trigger: unconditional public replacement rejects private approval when paid coverage expired.                      | Private approval succeeds independently of current visibility; expired/paused public state remains hidden. Valid renewal restores latest approved version with unchanged original paid tariff/order authority.                                                          | blind             |
| R7  | high     | migration0066 line30: JSON-null price.kind falls through SQL NULL condition to range branch.                                                                                  | Explicit discriminator/type rejection and meaningful direct SQL/app parity cases. Preserve original0066 bytes; append correction migration.                                                                                                                             | edge              |
| R8  | high     | expert-card-repository.ts2173 + expert-application-materials.ts51: legacy approved draft with untouched generic job also receives card job; both deliverable.                 | One canonical delivery admission across paths; historical receipts/unknowns preserved, no duplicated send, no rich preapproval send. Real competing/serial dispatch witness.                                                                                            | blind             |
| R9  | medium   | expert-card-repository.ts2170: updated public payload does not update experts.public_display_name used by catalogue.                                                          | Atomic approved visible projection refresh; actual catalogue read returns updated name, pending/rejected keeps prior name.                                                                                                                                              | blind             |
| R10 | high     | resident-rich-profile.ts418 flush discards a service if one required field missing; Russian service checklist extraction has no assertion.                                    | Preserve every valid partial service answer as an owner-reviewed typed proposal/staged input; ask only remaining gaps, no invented fields or hidden overwrite. Full and partial Russian multi-service checklist/file witnesses with price/duration/tags/logistics.      | blind + gap       |
| R11 | high     | Actual private adapter/parser witnesses bypass changed normal expert-card-composition.ts99 wiring.                                                                            | Authenticated photo and PDF/DOCX flow through capability produced by normal composition, asserting real private custody and explicitly accepted proposals. Disabled path truthful; no real provider calls.                                                              | gap               |
| R12 | high     | Current renewal witness directly supplies old revision to quote/accept and bypasses lifecycle snapshot/readiness.                                                             | Real renewal bill + readLifecycle + owner renewal commands during collecting and rejected rich update; correct approved revision/readiness and successful continuation.                                                                                                 | gap               |
| R13 | high     | Empty full-chain reconstruction contains no populated0065-to0066 upgrade proof.                                                                                               | Seed collecting/reviewed/published legacy states before new migrations, apply0066 and correction, verify content/review/payment/publication and safe legacy operations. Do not mislabel empty replay as upgrade acceptance.                                             | gap               |

Overlapping reports were consolidated only where they share the same defect and
correction. R10 includes both the actual partial-data loss and its directly related
Russian extraction proof gap. R11/R12/R13 remain separate substantive verification
requirements; direct financial/adapter tests cannot substitute for their consumers.

Preserve working rich paid interview, human-readable guided/checklist/full preview,
real custody/parser/UI races, current safety/consent, approved-version history and
all prior source/evidence. Unsolicited owner review-status push remains explicitly
assigned to S4 in the same package; it is neither delivered nor abandoned here.

Correction status: pending. No final branch gate/push/acceptance yet.

## First correction closure at be8a0c7d — second bounded batch

All three assigned reviewers completed read-only closure. R1–R3 and R7–R13
are closed (ten findings); R4–R6 remain open for the concrete cases below.
Coordinator checked the cited implementation before accepting this batch.

- R4: manager detail still selects ten historical media rows by UUID. After
  replacements, current selected photos can disappear from preview. Select the
  current profile photos in their order; handle prior-version photos separately
  and bounded. Prove the real detail/API/view path with more than ten retained rows.
- R5: service edit/removal compares old stored uppercase UUIDs with canonicalized
  lowercase input. Compare canonical identities on both sides without rewriting
  immutable historical versions; prove edit, removal and duplicate rejection.
- R6: expired public A, privately approved B, then collecting/returned C before
  renewal settlement: projection selects B but the publication trigger accepts
  only current approved pointer or existing A. Align immutable latest-approved
  authority across SQL, lifecycle and settlement, retaining all financial,
  consent, safety, coverage and pause gates. Prove actual renewal through C.

One implementer receives this bounded correction; append migration0068 if SQL
changes, preserving0066/0067 and both85/125 evidence archives. No final gate or
push yet. Review iteration2 is incremental, with no destructive restart or quota.

## Final assigned closure — accepted source46e03bf0

All three assigned reviewers completed closure at
46e03bf0db4a751977a494f9c645e165490a6c75. R1–R13 are closed.

| Reviewer         | Final assigned scope                                                  | Result |
| ---------------- | --------------------------------------------------------------------- | ------ |
| Blind            | R6 latest private approval through collecting/returned C renewal      | PASS   |
| Edge             | R4 current/approved photo detail and grants; R5 legacy UUID mutations | PASS   |
| Verification gap | Real witnesses,69 migration inputs, exact state/guard registrations   | PASS   |

Reviewers independently verified15 current owned source hashes and48 raw/compressed
artifacts. Prior85+125 artifacts and historical migration bytes remain preserved.
0068 changes only the immutable approved-version selector; other publication guards
remain byte-identical. Actual API-response replay in Chromium uses synthetic custody
URLs, not production bucket evidence. Financial time boundaries remain synthetic.
No reviewer ran tests/builds/DB/providers or silently fixed source. Runtime accepted;
root final branch gate/push remain next. Whole-package S3b and S4 remain open.
