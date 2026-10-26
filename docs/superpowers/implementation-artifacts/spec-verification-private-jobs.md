---
title: Private verification documents and bounded evidence jobs
type: feature
created: 2026-10-26
status: draft
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

Planning references are distilled in `verification-private-jobs-preparation.md`.
Before implementation, resolve exact accepted S2a paths and generation contracts,
record the delivered baseline SHA and replace this paragraph with the verified map.
Do not launch implementation against an uncommitted S2a snapshot.

Existing stable components to reuse: integrations/documents/safe-document-parser.ts,
its Python helper/tests, application/expert-card-service.ts, DB completion and
consent locks, worker/expert-card-materials.ts and explicit/trigger erasure paths.
The current Node-only256MiB runtime does not prove OCR isolation or capacity.

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

This draft captures approved scope while S2a implementation owns shared source.
It is not ready-for-dev and authorizes no concurrent edits. Reconcile actual source
seams and pin dependency/model choices before the sequential S2b implementation.
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
