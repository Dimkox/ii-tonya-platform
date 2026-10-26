---
title: Private verification documents and bounded evidence jobs
type: feature
created: 2026-10-26
status: in-progress
baseline_commit: f11d5d906acf6e1983fe36739981e31a847207ce
review_loop_iteration: 0
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
  - docs/superpowers/plans/2026-10-26-residency-phase1-final-package.md
  - docs/source/residency-phase1-owner-2026-10-26/verification-final.txt
  - docs/superpowers/implementation-artifacts/verification-private-jobs-preparation.md
---

<frozen-after-approval reason="owner approved the complete Phase1 package and autonomous implementation; activation remains separate">

## Intent

Turn the existing private Telegram document references into verified private object
custody, useful owner-confirmed extraction proposals and bounded background evidence
for human verification. Managers need authentic temporary file access and observed
document/social results, not fabricated links or successful placeholder checks.
This is S2b after accepted S2a, within the approved verification block.

## Boundaries & Constraints

**Always:** Reuse the canonical Node worker, current versioned form/attempt,
submission/request/check generations, original bot/channel and consent authority.
Latest sales order remains selected tariff -> form -> manager -> fixed3000 fee ->
genuine paid lock. Document/social results cannot approve, reject, price, bill or
alter submitted answers by themselves. No automatic rejection for absent documents,
tax status or unavailable checks. Keep optional expert education and all v1 history.

Implement concrete bounded Telegram getFile/download and private S3 adapters with
local transport evidence, not interfaces whose only working branch is unavailable.
Use original receiving bot, fixed Telegram origin and validated relative file path;
deny redirects and dangerous path encodings. Verify declared and actual size,
timeouts, truncation, aborts, safe MIME and source identity. Custody supports20MiB;
the existing parser ceiling remains5MiB. A larger safely stored document may remain
manual. Never log token-bearing URLs, raw bytes, filenames or credentials.

PostgreSQL allocates an opaque immutable object key and upload attempt before PUT.
Use reviewed exact modular AWS SDK pins, explicit credentials/region/approved
endpoint and maxAttempts1; no handwritten signing or ambient credential discovery.
Conditional creation and actual checksum/metadata/length validation establish
verified custody.412 requires matching HEAD evidence;409/timeouts remain unknown.
HEAD403 is not absence. No cross-subject deduplication. Initially support an explicitly
verified dedicated non-versioned bucket; reject versioned activation until exact
version deletion is implemented. SDK mocks alone do not prove transport behavior.

Erasure immediately revokes reads and retains minimal deletion/reconciliation work
for every allocated key, even when its applicant row is removed. An ambiguous PUT
can finish after DELETE/HEAD; one404 is not proof against future late completion.
No late completion can recreate a form, custody read grant or private applicant
payload. Preserve unresolved deletion honestly and expose manual recovery. Content
bytes do not belong in PostgreSQL/logs/ordinary temporary files.

Authenticated manager link issuance requires fresh role/session/MFA, current
application/consent and verified custody. Presign only that exact key,120seconds,
attachment/no-store. Audit issuance without the bearer URL. Issued presigned links
remain bearer access until expiry; do not claim session revocation alone revokes
them. Owner cannot choose bucket/key or external endpoint.

Use bounded local PDF/DOCX extraction to propose only supported still-empty fields;
explicit owner confirmation precedes changes. Missing structuring capability,
unreadable scans, encrypted/oversize documents and parsing failures preserve the
upload and switch to ordinary questions with the supplied manual-fallback message.
No paid runtime LLM, document-as-instruction execution or fabricated extracted facts.
URL-only references do not authorize arbitrary web fetching.

Add real optional local OCR with pinned PyMuPDF and fixed rus+eng model assets and
hashes. Explicit page/pixel/resolution/time/output/process budgets apply. Prove a
separately isolated nonroot helper runtime with read-only filesystem, no network,
dropped capabilities and memory/PID/CPU limits; no Docker socket in the production
Node worker. Python resource limits alone are not filesystem/network isolation.
Text extraction and scan OCR must both have actual synthetic local witnesses.
Record bounded institution/specialty/year observations and comparison against the
claimed field as MATCH/MISMATCH/NO_DOCUMENT/UNKNOWN. Partial/failed checks remain
unknown; a text match is not proof of authentic qualifications. Any medical-licence
hint stays human review, never an automatic legal verdict.

Implement real VK wall observation using explicit user/service-token capability,
fixed api.vk.com and bounded response/time/pages. Keep only five newest post metadata
observations, no bodies. Existing messaging community tokens are not this capability.
Telegram Bot API cannot supply arbitrary post history. Do not invent that API or
substitute a pinned post. A public-preview reader must have actual sanitized fixture
evidence and be labelled partial/unofficial; separately authorized MTProto capability
is not implied. Unsupported Instagram/site/history stays manual/unknown without
login, captcha or unrestricted scraping workarounds.

Cache observations per subject/canonical profile/adapter version24hours, retaining
observed/expiry time, coverage and unavailable reason. Manager reads never fetch.
Inactive means strictly more than30days with adequate evidence; missing comments
stay null. GOOD/MODERATE/BAD scoring thresholds are not supplied: preserve a visible
policy slot and actual observations, never invent a trust score or turn unknown into
BAD. Bind jobs/results to current generation, consent and provenance; stale/duplicate
completion cannot overwrite newer answers or resurrect erased data.

**Ask First:** Deployment, live provider activation, real money or new external
account/session authorization. Protected credentials are never requested in chat.
**Never:** Another application stack, client cabinet/Kanban, automatic financial or
quality decisions, arbitrary fetching, secret output, fabricated checks/access,
rewritten historical migrations, weakened tests/flags or live-environment copying.

## I/O & Edge-Case Matrix

| Scenario        | Input/state                                                      | Required outcome                                                                   |
| --------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Custody         | Original-bot reference, valid/hostile/large/truncated bytes      | Bounded verified private object or precise safe unavailable; no false stored claim |
| Upload recovery | Duplicate,412,409,timeout,HEAD403 or late PUT                    | Matching evidence or unknown; durable reconciliation, no blind overwrite           |
| Erasure         | Allocated/in-flight/stored key and late completion               | Immediate read revocation and non-resurrecting deletion responsibility             |
| Manager access  | Fresh/stale MFA, wrong owner, current/withdrawn consent          | Exact120s link only with genuine custody; no URL logging                           |
| Form proposal   | Valid PDF/DOCX, bad scan, existing field, stale revision         | Real bounded extraction, explicit confirmation or preserved manual fallback        |
| OCR             | Synthetic Cyrillic scan, mismatch, absent/partial/timeout        | Observable comparison or unknown, never authenticity/approval authority            |
| Social          | Five posts, pinned post,30day boundary, missing history/comments | Source-labelled observations; no fabricated inactivity/engagement                  |
| Jobs/cache      | Duplicate worker, stale generation,24h boundary, manager read    | Owned claim, current result, bounded refresh; reads do not call providers          |

</frozen-after-approval>

## Code Map

Verified against accepted S2a runtime3baaf003 and guard3c546774, delivered baseline
recorded in frontmatter. The0063 corrections preserve generation schema and add
real calendar helpers/identity guards. Preserve bounded history navigation,
terminal recovery and per-subject expiry isolation. No submitted snapshot mutation.

- packages/domain/src/resident-verification-form.ts: ResidentDocument is {kind photo/document/video,fileId,mimeType,size,caption?}; actual fields education/propertyEvidence/tourMedia/licence. Draft max64KB and SQL max100KB; URLs are validated syntactically, not fetch-authorized. No dedicated resume/brief slot currently exists. Add explicit bounded brief intake/proposals instead of disguising a resume as a diploma or overloading whichever question cursor is active.
- packages/application/src/resident-verification-service.ts + apps/api/src/routes/expert-applicant-telegram.ts: actual private v2 bot surface. Draft parsing is revision-bound before submit; post-submit checks consume immutable submitted_draft/submitted_revision and numbered followups. All proposed fields require owner confirmation; no financial/status fields from extraction.
- packages/db/src/schema/resident-review.ts: resident_check_generations PK(application_id,generation), submitted_revision, supplement_revision, request_id, status pending/manual_review/cancelled. Generation0 pending forms and generation1+ submitted checks are distinct. Snapshot followups at the generation watermark; no unrestricted reread of future amendments.
- packages/db/src/schema/resident-verification.ts: old resident_verification_check_work deliberately constrains education_result=unknown, social_result=pending, upload_state=pending_upload. Evolve or explicitly project into the versioned jobs; do not report new fields without real source or bypass these constraints. Existing immutable facts/current attempt must remain intact.
- packages/db/src/repositories/resident-verification-repository.ts: normal mutate/current-owner/idempotency; after submit inserts legacy check-work and bridge. S2a correction adds actual public-command witnesses. Current checks are advisory; late external completion cannot revoke a human/financial decision or reopen an obsolete attempt.
- packages/db/src/repositories/expert-verification-repository.ts + apps/web/src/expert-verification-client.ts and expert-verification-view.ts: existing protected detail/UI currently states docs/socials unknown. Consume proof-labelled observations and issue manager links through fresh protected grant; reuse upcoming bounded history API, not another admin stack.
- packages/integrations/src/documents/safe-document-parser.ts: bounded optional child adapter; 5MiB input,5s default/10s max, one active child, sanitized environment, no filename/URL,64KB content/90KB JSON. Spawn reads binary stdin and validates output. Default helper URL resolves from built package to packages/integrations/parser/helper.py (not src/documents/parser).
- packages/integrations/parser/helper.py and test_helper.py: existing text-only PyMuPDF1.26.7/DOCX/lxml safety,40 pages, ZIP/XML guards, no filesystem/network isolation proof from rlimits. Add OCR without dropping these guards. Language models already hash-verified in /tmp/residency-ocr-assets-20261026. Pinned wheel integrated OCR must be tried with explicit model path in an isolated runtime before adding an unnecessary executable.
- packages/application/src/expert-card-service.ts: existing later-card document read/parser capability, manual preserved upload and explicit proposal correction. Reuse safe integration mechanics; do not pretend its raw narrative proposal is a typed verification form.
- packages/worker/src/expert-card-materials.ts: bounded one-active-cycle runner, per-job errors, abort on stop, repository durable claims. apps/worker/src/runtime.ts and main.ts compose actual lifecycles. New private-check jobs should reuse these lifecycle principles with honest result kinds, not pretend social/OCR checks sent a material.
- packages/db/src/repositories/privacy-repository.ts: explicit erasure deletes residents_applications and tombstones resident_verification_requests.0057 erase_resident_verification_subject handles consent withdrawal,0062 extends review-data deletion. New private custody rows can cascade, but allocated object deletion responsibilities MUST survive subject/form deletion. Plan a nonpersonal object-key tombstone/outbox before any external PUT.
- Current parser production image is Node-only256MiB. Separately proved isolated OCR runtime is still a deployment dependency; do not let normal Node worker invoke Docker socket. One existing task PG17.5 remains, and future OCR sandbox is a separate bounded helper, not an extra database.

## Tasks & Acceptance

- [ ] Extend the accepted attempt/check model with custody, bounded jobs,
      current-source observations, owner-confirmed proposals, cache and durable
      deletion reconciliation. Hand migration plus exact metadata/guard inventories.
- [ ] Concrete Telegram/S3/VK adapters, optional isolated extraction/OCR runtime,
      authentic manager links and clear unsupported-capability reasons.
- [ ] Existing applicant/manager/worker composition consumes these capabilities;
      all external activation ceilings remain off. Document recovery and deployment
      prerequisites without calling capabilities-only scaffolding complete.
- [ ] Execute every matrix row with real transports/local fixtures, PostgreSQL,
      actual owner/manager routes and isolated parser witnesses; independent review
      and canonical gate before delivery.

## Spec Change Log

## Design Notes

This sequential block follows accepted S2a. Use exact AWS SDK pins3.1157.0 for
client-s3 and s3-request-presigner; preparation records both registry integrity values.
Use PyMuPDF1.26.7 and tessdata_fast87416418657359cb625c412a48b6e1d6d41c29bd
rus/eng bytes with the preparation's exact hashes; no model binaries committed.
The current256MiB Node deployment is not permission to co-locate a384MiB parser.
Prove a separate isolated helper and actual orchestrator-to-helper contract without
mounting Docker socket or enabling production. Explicit authenticated local helper
transport may be added if needed; it must preserve the no-network parsing sandbox.
A test-only container runner is not a completed normal production composition.
Read-only filesystem permits bounded tmpfs only where necessary; never ordinary
persistent temporary storage. Recovery/manual routes must be accessible in the
existing manager interface, including unknown upload/delete states after erasure.
If a code-map detail differs, inspect the actual accepted code before adapting;
never weaken financial, privacy or feature gates to fit these planning notes.
The preparation document cites primary provider/library limitations and recovery
semantics; do not infer unsupported provider capabilities from generic mocks.

## Verification

Use real local HTTP fixtures for Telegram/VK serialization, path/redirect/byte/time/
abort/truncation and secret-canary redaction. Exercise actual AWS SDK signing and
serialization against a local fixture or pinned emulator: conditional PUT, checksum,
HEAD403, conflict/recovery, presign and DELETE. Include unknown PUT-after-erasure races.
PostgreSQL tests cover claims, current generations, consent/deletion and cache races.
Actual browser/API tests cover manager grants and owner extraction confirmation.
Sandbox probes exercise network, host-file access, writes, process/memory/CPU limits
plus Russian scan extraction. Measure256MiB Node headroom rather than asserting it.

One existing task-owned PostgreSQL17.5 cluster; no additional cluster. Use protected
configuration only in child memory. Node24/pnpm11.9.0; intentional pinned dependency
graph change followed by frozen installation. Hand migration/journal and fresh
exact state reconstruction; never drizzle generate. Retain RED/GREEN logs, build
changed packages before consumers, relevant types/lint and diff checks. No unchanged
broad repeats or repeat helper above3. Root owns final review/gate/push/PR; no hosted
CI exists and local verification is not provider/staging/production release proof.

## Execution ownership and local resources

One fresh implementer owns source/tests/migrations, dependency manifests/lockfile,
optional parser runtime artifacts, operations runbook and implementation evidence.
Root owns this spec, AGENT-STATUS, master/coordinator/review evidence, final gate and
push/PR. Implementer may mark task checkboxes and report evidence but must not
rewrite frozen requirements or run another lead/descendants. BMad already rendered;
no rerender, earlier-block restart, routine approval or run-count/splitting loop.
Work only in /home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/phase1-owner-plan-20261023
on codex/residency-private-verification-jobs-20261026. Capture identity and run
pwsh -File scripts/check-development-environment.ps1 -RequireDocker before edits.

Use ONE existing task-owned PG17.5 project ii-tonya-verification-form-20261026,
loopback55483; protected0600 /tmp/verification-form-20261026.compose.json supplies
credentials only in child process memory. Never print URL/config/environment. No
new DB cluster or stale Docker Config.Env credentials. Serialize PG/metadata/builds.
Next hand migration0064; preserve0062/0063 bytes, journal contiguous, reconstruct
exact state and all literal inventories. Compact full SQL catalogue stays below
unchanged1MiB ceiling; never format it as indented JSON. New table/function/trigger
counts must come from actual PostgreSQL, not guessed old counts.

Retain RED/GREEN/status under .superpowers/sdd/verification-private-jobs-20261026/;
write docs/test-evidence/verification-private-jobs-2026-10-26.md with exact commands,
exit statuses, matrix-to-tests and skipped counts. Empty stdout alone is not proof.
Do not run final full gate/push; root owns them after independent review. Commit
reviewable source/tests/evidence locally and report exact SHA when implementation
and focused verification finish. No remaining incomplete criterion may be called
complete merely because a default-off capability returns unavailable.
