# Private verification jobs independent review — 2026-10-26

Reviewed runtime54d9eb36aa5a4dfaa1b56eaa9c2f890295d408fb against delivered
f11d5d906acf6e1983fe36739981e31a847207ce. Three fresh context-free reviewers ran
read-only in parallel; no tests, builds, edits, providers or descendants. Root
waited for all results before triage. All72 evidence artifacts and raw compressed
hashes were independently checked by the coordinator before review.

## Accepted findings

Duplicates with the same failure and required action are grouped below. No finding
quota, destructive rederive or routine approval loop applies: owner authorized
one concrete corrective batch while preserving working code. No intent gap requires
owner input. Original successful and failed evidence stays retained.

| ID  | Severity | Category | Source and failure                                                                                                                                                                                                                | Required correction and witness                                                                                                                                                                                                                                                                                        |
| --- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | high     | bad_spec | Edge: resident-private-jobs-repository.ts385–388 checks current write_state when a delayed DELETE response completes. A concurrent PUT may settle after DELETE but before recording, falsely verifying erasure while bytes exist. | Claim/fence deletion operations and capture settled-before-DELETE authority; stale results cannot complete or downgrade another attempt. Execute the actual two-runner DELETE→late PUT→delayed response schedule with SDK/local transport and PostgreSQL; receipt stays pending until a later valid physical deletion. |
| R2  | high     | bad_spec | Blind/edge: resident-verification-service.ts470–473 truncates proposal JSON at2500 chars but confirmBrief applies every stored field.                                                                                             | Bounded complete preview pages or exact displayed-field confirmation; no silently applied trailing value. Actual owner ingress witness with long escaped/Cyrillic proposal and a trailing field, stale revision and confirmation.                                                                                      |
| R3  | high     | bad_spec | Blind/edge: verification-extraction.ts47 permits1000-char specialization; domain permits300. Derived validation throws after verified PUT/HEAD, and worker catch overwrites custody with unknown/null SHA, excluding recovery.    | Validate exact field/aggregate bounds; keep verified object proof independently of parser/proposal failure. Execute301-char specialty and oversized derived output through normal processing; stored file remains accessible/manual, with SHA and erasure authority preserved.                                         |
| R4  | high     | bad_spec | Blind/edge: expert-verification-view.ts327/369 fences session only. A's delayed evidence or signed link appends under B after switching details.                                                                                  | Detail/application generation fences on success/error/recovery/page/link operations; actual Chromium delayed A→B evidence and link cases, plus logout.                                                                                                                                                                 |
| R5  | high     | bad_spec | Edge/gap: helper.py40 omits an image-only PDF page with OCR disabled, yet worker treats any non-null text as complete and emits MATCH/MISMATCH.                                                                                   | Propagate conservative extraction coverage or refuse incomplete verification input; partial observations remain UNKNOWN while stored files/text/manual fallback survive. Real mixed text/scan PDF with OCR disabled through parser and worker, retaining current parser consumers.                                     |
| R6  | medium   | patch    | Edge: worker42–60 looks up mixed-case Telegram profile, but adapter/store use lowercase canonical profile. A new generation refetches within24h.                                                                                  | Reuse one canonical supported-profile key for cache lookup/admission/storage; execute mixed-case alias second-generation hit with zero extra provider reads and normal expiry refresh.                                                                                                                                 |
| R7  | high     | bad_spec | Gap: SDK tests only supply matching successful HEAD proof or HTTP errors. Removing checksum/custody-id comparison leaves fixtures passing.                                                                                        | Real SDK successful HEAD with missing/wrong checksum, identity, metadata, length, MIME or version must remain unknown; include matching positive proof and assert no verified custody/grant from contradictions.                                                                                                       |
| R8  | high     | bad_spec | Gap: executed runner test calls createResidentPrivateJobsRunner directly, bypassing app runtime forwarding/scheduling at runtime.ts283/414 and main composition.                                                                  | Execute enabled application-runtime lifecycle with real pending state advancing through its composed job capability; disabled remains inert. The witness must fail if forwarding or scheduled invocation is removed, without production activation.                                                                    |

All findings are pending correction. Runtime is not independently accepted yet.
Implementation evidence currently proves the runner, not complete application
runtime scheduling; the correction must state this distinction explicitly.

## Preservation and bounded verification

KEEP existing owner/consent/generation fences, fixed3000/paid financial authority,
conditional object writes, unknown no-resend rules, append-only attachment cursor,
manager/recovery pagination, privacy linkage/receipt barriers, default-off flags,
actual OCR isolation and all original evidence. Preserve committed0064 byte-for-byte;
add0065 if SQL changes, journal/state/negative inventories together. Original producer
owns one source correction batch, root owns spec/review/gate/delivery. Reviewers
close their assigned findings against the corrective SHA; no quota-based new review.
