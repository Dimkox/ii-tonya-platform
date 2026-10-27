# Backup Erasure Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Only one repository writer.

**Goal:** Elapsed time alone never certifies backup deletion.
**Architecture:** A trusted verifier produces job/policy/expiry-bound minimal evidence. PostgreSQL validates against its own clock and atomically persists evidence plus terminal status in existing JSONB.
**Tech Stack:** Node24, pnpm11.9.0, PostgreSQL17.5, Vitest; existing contracts/Zod, no new dependency or migration.
**Spec:** docs/superpowers/implementation-artifacts/spec-backup-erasure-evidence.md

## Global Constraints

No real deletion, provider activation, production calls or fake verifier. No commit/push by implementer.
Preserve financial/audit facts and uncertain processor outcome recovery.
One focused file per Vitest invocation. No aggregate; each PG/concurrency file at most3 invocations total.
Use existing isolated PostgreSQL fixture via II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya_test@127.0.0.1:33110/postgres. Environment -RequireDocker preflight first.
No story_key, so no sprint sync. Existing codex branch is the isolated workspace.

## Review Focus

- A historical backup_verified row without bound attestation must not be recertified by either public worker entry point (Task1).
- Four unknown processor strings must not satisfy the four named processor requirement (Task2).
- Same digest but different evidence fields is a conflict, not replay (Task2).
- An attestation resolving after timeout must never trigger a terminal mutation (Task1).
- Concurrent valid/conflicting receipts must preserve the one persisted proof and existing erasure_receipt keys (Task2).

## Task 1: Trusted verifier contract and fail-closed worker

**Files:** Create packages/contracts/src/backup-erasure.ts; update contracts index; packages/worker/src/privacy-erasure.ts, privacy-erasure.test.ts, privacy-erasure.testkit.ts and worker index only if an export is needed.
**Interfaces:** Shared strict version1 backup verification evidence type/schema with the exact fields in the spec. Extend ErasureDeps with optional trusted backup verifier taking bound job/policy/expiry and AbortSignal, returning verified evidence or unavailable/rejected/unknown. ErasureRepository.verifyBackup(jobId, evidence) returns durable ErasureJobState; getJob exposes optional persisted backupVerification.

- [x] RED test elapsed_expiry_without_verifier_never_certifies: finish mocked processor workflow, advance past scheduled expiry, call verifyExpiredBackup, assert no verifyBackup mutation and no backup_verified result.
- [x] Run pnpm exec vitest run packages/worker/src/privacy-erasure.test.ts; record intentional failure.
- [x] Implement strict shared evidence schema (no coercion, unknown fields rejected), explicit finite date/binding checks, bounded verifier timeout and fixed failure paths.
- [x] Update verifyExpiredBackup and runErasureWorkflow's terminal return: require persisted valid proof for backup_verified; policy mismatch fails closed; return actual durable repository result, not optimistic status.
- [x] Add individual cases for disabled/no I/O, missing/throw/unknown/rejected/timeout/late verifier, invalid dates/hash/fields/bindings, changed policy, future proof, CAS loss and valid proof. Preserve existing four-processor crash recovery tests.
- [x] Build contracts before importer tests; run focused worker GREEN.

## Task 2: PostgreSQL authoritative proof transition

**Files:** packages/db/src/repositories/privacy-repository.ts, new tests/integration/client-backup-erasure-evidence.test.ts, tests/integration/privacy-workflow.test.ts (contract expectation only).
**Interfaces:** PostgresPrivacyWorkflowRepository.getJob includes backupVerification, completeProcessors accepts scheduled state only, verifyBackup(jobId, strictEvidence) returns the durable job. Store only erasure_receipt.backupVerification, preserve existing object fields. assertPrivacyWorkflowContract uses verified_bound_evidence instead of expiry_evidence_only.

- [x] Write new PG file before implementation with direct malformed/date-only rejection, future caller time, policy/job/expiry mismatch, legacy unproven status including public startErasureAtomically→erasureReceipt replay, named processor set, booking cleanup fence, JSON field preservation, matching replay and concurrent conflict.
- [x] Run the new PG file RED with explicit external fixture env (run1/3); setup error is not meaningful RED.
- [x] Implement transaction/row fencing and database clock_timestamp checks; require scheduled processor_complete plus exact four acknowledged processors and completed booking work. Same complete bound proof may replay, conflict cannot replace it. Guard the separate public erasureReceipt path against status-only historical certification.
- [x] Harden completeProcessors finite policy/expiry/scheduled-only validation; do not change immutable history or use elapsed time as proof.
- [x] Build contracts/db as needed; run new PG file GREEN (run2/3). Reserve run3 for independent review reproduction if needed.
- [x] Run modified privacy-workflow file once with same explicit fixture and record its run count.

## Task 3: Evidence and handoff

**Files:** docs/operations/data-retention.md, spec and this plan.

- [x] Relevant contracts/db/worker builds and typechecks, tests typecheck, changed-file lint/format, git diff --check.
- [x] Document missing real verifier/inventory and distinction between timer eligibility and deletion proof. No exporter/provider/restore guarantee or overall erasure completion claim.
- [x] Record exact RED/GREEN counts and remaining PG budget. Mark status in-review and add relative Suggested Review Order.
- [x] Freeze repository writes, report changed paths and residual risks; main owns independent review and authorized release.

## Execution evidence — 2026-10-05

See the [spec results and review order](../implementation-artifacts/spec-backup-erasure-evidence.md#results)
for exact commands, counts and limits. Worker initial RED 1 failed / 6 passed;
expanded RED 35 failed / 11 passed; final GREEN 49/49. Backup PG RED 17 failed /
28 passed; GREEN 47/47 (2/3 runs used). Existing privacy workflow GREEN 3/3 (1/3
runs used). Relevant builds/typechecks, tests typecheck, changed-file lint/format
and whitespace checks pass. No aggregate suite or exhausted PG file was run.

The spec's workspace, no-commit, bounded-testing and review-handoff instructions
override generic skill worktree/full-suite/commit/review steps. All implementation
is uncommitted and frozen for main's independent review. Author self-review is
not independent review or release evidence. Real attestations, production verifier
configuration and restore approval remain unavailable/outside this increment.

## Task 4: Authorized bounded review patch round

- [x] Test and fix database-authoritative terminal worker/public replay, including completed work and public active-policy binding.
- [x] Test and fix monotonic verifier deadline enforcement; require lowercase UUIDs.
- [x] Align dead-letter parent/child lock order and reject completed-job downgrade; add measured row-lock barriers for processor and booking work.
- [x] Preserve the web shell/catalogue fixes; add accessible noscript fallback and focusable landing/consent/legal main targets with focused regressions.
- [x] Restore individual retention/privacy test commands and document authentic attestation custody, retrieval, access control, retention and exact trusted configuration.
- [x] Record policy supersession and durable database invariant as deferred activation prerequisites; no schema work.
- [x] Final backup PG GREEN **61/61, invocation3/3**, never rerun. Existing privacy workflow GREEN **3/3, invocation2/3**. Worker51/51; web landmarks8/8, shell5/5, catalogue5/5; retention3/3; privacy service9/9.
- [x] Relevant builds/typechecks, tests typecheck, scoped lint/format and whitespace checks; record [review closure table, commands and exact paths](../implementation-artifacts/spec-backup-erasure-evidence.md#bounded-independent-review-patch-round--2026-10-05), remain in-review and freeze for main's fresh closure/release.

The reviewer's inline two-case PG diagnostic was not a focused suite invocation.
No full/multipath test command, provider call, commit/push/deploy, dependency/schema
change or production activation occurred. Main owns real-browser focus/no-JS
verification and fresh independent review. The earlier run2/3 freeze counts above
are historical; this section states the final focused-file budgets.
