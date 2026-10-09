---
title: "AC-015 erasure request and private status receipt"
type: "feature"
created: "2026-10-09"
status: "in-progress"
baseline_commit: "7278bab8548638eedd26fe2b401369b4de7c9bd9"
review_loop_iteration: 0
context:
  - "/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/AGENTS.md"
---

<frozen-after-approval reason="owner delegated technical decisions and approved human_gate=true">

## Intent

**Problem:** Browser erasure always returns503. Existing physical erasure revokes
sessions immediately, leaving no way to track processor or backup progress.

**Approach:** Accept a durable owner-authenticated request before physical erasure.
Issue a separate status-only receipt that survives session revocation. Connect
request execution to existing verified erasure jobs; never reinterpret a saved
request, disabled provider or elapsed retention time as completed deletion.
This increment is part of the full erasure requirement, not a manual-only substitute.

## Boundaries & Constraints

**Always:** PostgreSQL owns request uniqueness, ownership and receipt digest.
Creation requires verified active owner plus browser Origin/CSRF checks and
explicit UI confirmation. One durable request per subject; retry with its same
receipt returns the same request, another receipt returns conflict without
rotating the first. Receipt reads do not require a surviving client session.
Closing request creation must not close status reads. Keep financial/audit facts
and existing erasure gates; report actual retention exceptions when execution
has produced them. Final deletion proof comes from the existing workflow's
validated `getJob`, not a raw status column or a client assertion.

Receipt is `er1.` plus canonical unpadded base64url of32 random bytes. Browser
generates it before POST so an uncertain response can be retried with the same
key. Store only SHA256 of domain `ii-tonya:erasure-receipt:v1` followed by NUL
and the complete token. Never put token in a URL, log, analytics, localStorage
or sessionStorage. Explicit download/copy is allowed. Receipt grants only
minimal request progress, never account access, export, booking or mutations.
It remains valid until explicitly revoked; this is credential lifetime, not a
legal retention policy. A lost token is not recoverable from its database digest.
Existing authenticated owner can still read their request until session closure.

**Ask First:** None for ordinary technical gates: owner explicitly delegated
them and set human_gate always true. Real client confirmation and factual
processor/backup verification cannot be invented by that automation setting.

**Never:** Report completed before valid processor/backup evidence; infer lack of
historical processor data from a currently disabled feature flag; store raw
receipt tokens; delete live data as a test; enable unrelated providers or signing;
claim the full product finished from this request/status increment alone.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| First request | Active authenticated owner, canonical receipt | Durable accepted request; no claimed deletion | Storage failure is unavailable |
| Retry | Same owner and receipt | Same request ID and time | No duplicate queue job |
| Replacement | Same owner, different receipt | Conflict; original remains valid | No silent credential rotation |
| Wrong owner | Mismatched principal/subject or foreign job | Denied, no foreign status | Generic response |
| Session gone | Valid receipt, inactive subject | Minimal status remains readable | No account authority |
| Token invalid | Malformed/noncanonical/unknown/revoked token | Denied | Never reflect token |
| No job | Accepted request, prerequisites not bound | awaiting_execution | Not completed |
| Job progress | Validated pending/processor_complete/dead_letter | deleting/awaiting_backup/needs_attention | Proof error is unavailable |
| Verified backup | Existing workflow verifies full completion | completed | Raw forged status cannot bypass verifier |

</frozen-after-approval>

## Code Map

- `packages/application/src/erasure-request-service.ts` — new receipt validation,
  domain-separated hashing, owner guard and minimal state projection.
- `packages/db/src/repositories/erasure-request-repository.ts` — new atomic
  request/digest storage; bound job lookup uses existing verified workflow.
- `packages/db/src/repositories/privacy-repository.ts` — existing
  startErasureAtomically requires verified manifests and revokes sessions;
  PostgresPrivacyWorkflowRepository.getJob validates completed work/backup proof.
- `packages/db/migrations/0041_client_erasure_requests.sql`, journal and snapshot
  — additive request table; hand-authored SQL, never drizzle generate.
- `apps/api/src/routes/browser-account.ts` — existing session-bound CSRF guard;
  bridge only exact new privacy request/status paths, no general proxy.
- `apps/api/src/app.ts`, `server.ts` — dependency and capability composition.
- `apps/web/src/consent-view.ts`, `privacy-client.ts` — explicit request control,
  private receipt download and status UI; no fake success notice.

## Tasks & Acceptance

**Execution:**

- [x] Application receipt/service with unit RED/GREEN and sanitized failures.
- [x] SQL/schema/snapshot/repository with isolated PG17.5 ownership, retry,
  concurrency, invalid-job and revoked-receipt evidence, at most3 invocations.
- [x] Browser API/UI request and receipt status, CSRF/body limits, no secret logs,
  no stored browser credentials; focused tests and real rendered checks.
- [ ] Bind actual execution and complete local/processor/backup status and
  retained-fact exceptions. Missing live prerequisites stay explicit.
- [ ] Independent review, RC, migration compatibility/recovery, authorized
  deployment and live verification. No real-user or legal acceptance fabrication.

**Acceptance Criteria:**

- Given an active owner, when confirming deletion, then a durable request is
  recorded once and its receipt survives session revocation.
- Given receipt possession, when reading progress, then no personal export,
  processor target or other subject's facts are disclosed.
- Given an incomplete execution, when reading progress, then completed is absent.
- Given proven erasure, when reading progress, then completion and actual
  retained-fact exceptions are shown without reconstructing deleted identity.

## Spec Change Log

Coordinator recovery refinement: independent default-closed
CLIENT_ERASURE_REQUESTS_ENABLED controls creation while status and other privacy
rights remain available. This implements the approved separation without
disabling all privacy rights during recovery. Local real-PG restart evidence is
in apps/api/src/routes/erasure-recovery.integration.test.ts. Physical execution
and release evidence remain separate incomplete tasks.

Owner explicitly removed repeated technical human checkpoints and selected
autonomous continuation. Planning and tests remain required; no new question is
needed to execute the documented design.

## Verification

Node24/pnpm11.9.0; frozen dependency graph; ComposePG17.5. Focused new tests only;
existing exhausted PG files remain untouched. Build sequentially before types.
Run scoped lint/format/diff checks and independent review. No hosted CI is
available; Trust CI remains excluded. Restore compatibility includes request
rows and receipt access, not merely swapping a symlink to an older build.

## Local implementation handoff — 2026-10-09

Application, persistence, browser request/status and an optional bounded worker
hook are implemented. Actual startErasureAtomically binds request/job, local
cleanup and session revocation in one transaction. Production execution remains
uncomposed pending authentic capture, approved policy, verifier/custody and the
existing post-certification child-work invariant. No client/provider evidence is
inferred from current flags or absent backup timers.

Local checks: application12/12, API2/2, web client2/2, real Chrome1/1,
worker1/1, final PG4/4. New PG and browser budgets each3/3 exhausted.
One tests/repo run was440/444; exact additive constraint/count/journal hash
corrections passed focused schema12/12, history8/8 and scope123/123. Builds,
relevant typechecks, scoped lint and whitespace checks passed. Failed logs are
preserved. Initial new-module collection failures are not behavioral RED evidence.

See [local evidence](../../test-evidence/2026-10-09-erasure-requests-local.md)
and [execution/recovery prerequisites](../../operations/erasure-requests.md).
Independent review and release are coordinator-owned and incomplete. No commit,
push, production mutation or full-product completion is claimed. The frozen
requirements above are unchanged; the unfinished execution/release tasks remain open.
