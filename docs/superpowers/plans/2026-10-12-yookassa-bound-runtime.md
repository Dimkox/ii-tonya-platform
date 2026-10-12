# YooKassa Bound Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Follow the BMad spec handoff and repository test caps.

**Goal:** A lost webhook no longer leaves a bound payment permanently unresolved.
**Architecture:** Compose the real YooKassa reader/verifier/inbox inside the existing
worker factory. Lease a bounded mode-filtered batch, deliver verified events, then
resolve the operation; retain existing financial transactions and replay authority.
**Tech Stack:** Node24, pnpm11.9.0, TypeScript, PostgreSQL17.5, Vitest.
**Spec:** ../implementation-artifacts/spec-yookassa-bound-runtime.md

## Global Constraints

No real provider calls, secrets, migrations, new dependencies or flag activation.
Financial edits limited to the spec's proven settlement-attempt transition defect.
Single implementer, no nested agents. New files3 runs each:
RED1/GREEN2, coordinator3. No exhausted old suites or full suite. No commit/push.

## Review Focus

- Mode filtering must precede batch LIMIT, not starve production behind old test rows.
- Same terminal replay must preserve evidence timestamps; conflicting result rejects.
- An inbox commit followed by worker failure must not duplicate residency/rewards.
- Credential failure must stop subsequent cycles, not hammer the same merchant.
- Shutdown between jobs must not start another payment batch.

## Task 1: Wire bound reconciliation into the actual worker

**Files:** The exact owned list in the spec; verifier is read-only, inbox changes
limited to the proven settlement-attempt transition block.
**Interfaces:** Extend claimReconciliationBatch(limit:number,mode?:YooKassaMode).
Add runYooKassaBoundReconciliation with enabled/mode/limit, operation repository,
real verifier and canonical delivery dependency; return bounded result counts.
Compose it through createProductionWorkerRuntimeFactory and existing
unknownOutcomeReconciliation report before expiry. Keep all existing jobs.

- [ ] Read operation claim/resolve, verifier, inbox and production factory; run
      RequireDocker and inspect synthetic fixture constraints.
- [ ] Write new runtime integration tests against the existing factory first:
      enabled configuration must recover a seeded bound successful operation;
      currently it throws yookassa_worker_capability_unavailable. Add negative
      disabled/config/mode, pending/canceled, forged amount, duplicate delivery,
      financial replay/crash and exact terminal timestamp controls. Unit tests
      cover bounded runner failures, credentials circuit and shutdown; no mocks
      replacing the financial result oracle in PostgreSQL tests.
- [ ] Typecheck fixtures, then run EACH focused file once for RED; record exact
      collection/results. A missing new export is not behavioral RED; establish
      missing runtime behavior through existing entrypoint first.
- [ ] Implement mode-before-limit and exact-terminal idempotency in operation
      repository. Add runner and composition using existing client/verifier/inbox.
      Wire normal factory and cycle; preserve disabled behavior and existing jobs.
- [ ] Correct the proven pre-bound attempt settlement transition in the existing
      canonical transaction. Restore ordinary payment-to-refund test fixtures and
      verify identity, resolution timestamp and terminal/mismatch rejection;
      preserve all other financial policy. Coordinator3 verifies after review.
- [ ] Build affected workspace packages; typecheck source/tests. Run EACH focused
      file once for GREEN2. Record failures without a hidden third run.
- [ ] Scoped lint/format/diff; stable evidence handoff. Main obtains independent
      review, applies fixes through this same implementer and owns final3. Local
      green results do not establish live-provider evidence or completed release.
