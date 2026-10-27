# Core stabilization R1–R13 bounded remediation — 2026-10-26

Input: the coordinator's13 accepted same-intent findings against exact
390613bc72cf51cd450404cc3f9492198d26ea87 in the independent review record.
This is one remediation batch, with no additional discovery quota or intent change.
Root retains independent closure, final exact-source gate and draft PR ownership.

| Finding | Change and executed acceptance                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1      | Preparation commits the owner-bound token together with the durable unknown attempt before disclosure. The final send retains the existing subject/consent lock. A real independent connection observes the committed token inside notifier, starts redemption without awaiting that lock inside notifier, and completes after delivery releases it. Forced post-send completion-write failure leaves the prepared token valid and work unknown. |
| R2      | Notification preparation sets revokeExisting=false on the shared handoff helper. An existing interactive link remains redeemable after definite pre-send rejection. Explicit current-owner issuance retains its existing replacement semantics. No new table or grant authority.                                                                                                                                                                 |
| R3      | Documented terminal-unknown recovery uses the genuine original-promo /work_handoff command with current owner/consent/paid admission. Crash-after-preparation-before-transport is simulated at the real committed transaction boundary; the actual application command recovers a redeemable link while the original notification stays unknown with zero sends. No pending reset/retry.                                                         |
| R4      | resident_workspace_access now includes archive_until_date parity. The PG test checks both predicates, denies an archived pair consistently with actual activation, and confirms the existing archive check rejects an unpaired field. Fresh full-chain state/supplement and exact hashes regenerated.                                                                                                                                            |
| R5      | Actual normal composition reuses the trusted booking callback ACK transport for the configured work token; tag UI configuration now requires that token. Successful owned callbacks, page reads and verified duplicate toggles authorize cosmetic ACK with the original callback ID/bot. Forged/wrong-bot/foreign-conflict attempts cannot acquire it. ACK cannot retry or change committed mutation results.                                    |
| R6      | Durable toggle receipt is checked before a fresh revision read. Identical callback retry returns duplicate without mutation. Fresh stale/digest-conflicting/foreign-owner requests cannot become duplicates or alter another draft. A narrow regression caught and closed cosmetic ACK authority on the foreign conflicting replay.                                                                                                              |
| R7      | Repository clamps requested pages to actual visible catalogue bounds, including zero entries; rendering/navigation use returned page. PG asserts first out-of-range clamps to the last page and an empty catalogue returns page0/pages1.                                                                                                                                                                                                         |
| R8      | Actual Fastify next-page response must contain distinct IDs, later-page selection must survive reload, and final-page/back buttons must target the preceding page. These executed assertions fail an offset0 or repeated-current-page implementation.                                                                                                                                                                                            |
| R9      | Selected inactive tags remain visible with an explicit removal label and count toward the actual selected20. Owned removal is allowed; new inactive additions remain forbidden. Actual UI20→deactivate1→remove/replay→replace is covered, preserving revisions, ownership and erasure.                                                                                                                                                           |
| R10     | Bounded XML uses lxml with resolve_entities=false, no_network=true, load_dtd=false and huge_tree=false; DTDs and parsed External relationships are rejected before python-docx. Tests cover single quotes, whitespace, character-reference encoding and UTF16. The already locked lxml6.1.3 runtime is now an explicit direct dependency.                                                                                                        |
| R11     | Real subprocess main() acceptance observes CPU3/AS384MiB/FD32/core0/FSIZE0, enforces descriptor exhaustion, confirms fixed null output on address-space failure, and terminates only the child under its actual CPU bound. Probe extraction is controlled test code so limits are measured without hostile input or parent resource changes. Actual PDF/DOCX through Node/Fastify remains separately executed.                                   |
| R12     | README and implementation evidence now describe a file-size bound, explicitly not a filesystem sandbox. The main() subprocess creates an empty file successfully and proves subsequent content growth is rejected. Other filesystem mutations are not claimed prevented. Production isolation/cgroup evidence remains absent/default-off.                                                                                                        |
| R13     | Two independent database connections compete for one real pending job. PostgreSQL pg_stat_activity must show the contender waiting on the held lock before release. Exactly one notifier call and one durable terminal completed attempt result.                                                                                                                                                                                                 |

The initial focused R-case command produced5 failing assertions/2passing cases, with10
unrelated baseline cases filtered. It became7/7 after the first source patches.
The four equivalent External XML fixtures failed against the raw-byte check and passed
against explicit secure XML parsing. Python then passed12/12, including real main() limits.
The later required foreign-owner replay assertion failed on cosmetic ACK count before its
bounded correction. The final complete focused PostgreSQL/Fastify file passed17/17,
with no skipped cases, in `core-remediation-pg-exact.log`. This includes the final genuine
recovery command and observed independent-connection contention, plus real PDF/DOCX imports.

Normal ACK composition passed10/10. Relevant card/UI/config units, exact metadata/source
boundary, affected builds/package types/full test types, lint/format and diff checks are
recorded in the retained remediation logs. Failed outputs remain preserved losslessly.
The only repeated complete focused run followed an actual R5/R6 source correction; no
unchanged full suite, pnpm verify, new PG cluster or provider/staging operation was run.

Full SQL replay remains59 migrations/176 tables,2new functions/1trigger/2views,
13constraints/4indexes. Only the existing0058 archive view definition changed; no new
financial schema, writable access switch, callback entitlement or parser production runtime.

Evidence is lossless gzip with compressed and original-byte SHA256 manifests under
`residency-core-stabilization-2026-10-26/logs/`. The remediation commit containing this
record is the bounded closure candidate; root records its complete SHA separately.
Independent R1–R13 closure and the final branch gate remain pending, not inferred from
these local results. No additional product feature or accepted-finding quota is requested.

## Final local check results

- Complete final PG/Fastify17/17, no skips: `core-remediation-pg-exact.log`.
- Python12/12, including the real main() resource boundary: `core-remediation-python-green.log`.
- ACK normal composition10/10; card regression44/44; private UI2/2; configuration2/2;
  exact catalogue/metadata/executable boundary9/9.
- Config/application/database/API builds passed; all5 affected package typechecks
  and the complete test TypeScript check passed.
- All changed TypeScript ESLint and supported-file formatting checks passed.
  Whitespace checks cover the staged source/evidence before the local commit.
- No task-owned check/child process remains running. The existing local PG17.5
  cluster remains available for coordinator review; no extra cluster was created.
