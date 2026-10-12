# Booking handoff revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Complete the real local processing path for handoff withdrawals without inventing external disclosure or deletion evidence.

**Architecture:** A dedicated PostgreSQL consumer validates the immutable consent fact and records a local receipt atomically with outbox completion. Generic outbox operations cannot own this topic. The worker runs local processing separately from notification send/admission controls.

**Tech Stack:** TypeScript, Node24, pnpm11.9.0, hand-authored SQL, PostgreSQL17.5, Vitest.

**Spec:** `docs/superpowers/implementation-artifacts/spec-booking-notification-delivery.md`, T5; refinement below. This implements one T5 path, not the whole commercial goal.

## Global constraints

- Development-only assignment under the owner's delegated implementation workflow; no commit, push, production activation or real provider calls.
- Preserve all existing dirty changes. One implementer owns the files listed here.
- Ordinary consent remains; no written/signing entry gate. Catalogue stays empty.
- No inferred retention deadline. Identifier anonymization, backup verification and legal approval remain separate open work.
- No exhausted test file reruns or renamed copies. New focused PG file: at most three invocations; coordinator owns final run after review.
- Keep historical migrations immutable. Reserve0046 only after confirming the journal still ends0045. Add SQL, journal, schema and reconstructed state together; never run drizzle-kit generate.

## Review focus

1. Cascaded note withdrawal: its handoff fact differs from the original audit object; validate the journal fact, not a nonexistent matching audit.
2. Later regrant: process the historical withdrawal, do not require it to remain the latest decision.
3. Generic stale claim: all mutation paths must reject dedicated ownership, including direct completion with an old claim token.
4. Historical uncertainty: a grant or current expert identity is not evidence of a delivered disclosure.
5. Lock contention/shutdown: no source-first lock inversion, starvation, external send or abandoned partial receipt.

## Task 1 — Durable local processing and queue ownership

**Owned files:** new `packages/db/src/repositories/booking-handoff-revocation-repository.ts`, new focused `tests/integration/booking-handoff-revocation.test.ts`, `packages/db/src/repositories/outbox-repository.ts`, DB exports, new schema and0046migration/journal/state. Existing privacy producer remains unchanged unless an actual contract defect is reported first.

**Interface:** `PostgresBookingHandoffRevocationRepository(db).consumePending(limit: number): Promise<{examined:number;processed:number;quarantined:number;operatorRequired:number}>`.

**Processing contract:**

- Integer limits1..100; worker uses20. Use bounded keyset continuation so contended/legacy rows cannot permanently hide later withdrawals.
- Candidate reads do not lock the source first. For valid-shaped subject IDs acquire existing document/subject authority barriers before source-row locking. Re-read every candidate under lock and process only the exact dedicated topic.
- Strict existing event schema, exact producer idempotency/reconciliation keys and SHA256 payload digest are required. Consent ID, user, purpose `expert_handoff`, decision `revoked` or `denied` must match a real journal row. Subsequent regrant does not invalidate that historical fact. Invalid events are quarantined with content-free alerts; never act on their subject.
- New receipt table uses source ID as unique identity, nullable validated consent ID for malformed-source quarantine, explicit outcome and coverage, known recipient count0, timestamp. No chat IDs, names, note text or raw payload copies. Restrict mutations with existing append-only conventions. Do not claim external delivery/deletion.
- Current neutral templates disclose no optional note. Record zero *actionable known* recipients. Historical coverage remains `historical_disclosure_untracked`; create an idempotent operator alert. This is not a finding that no historical disclosure occurred. Do not suppress neutral lifecycle notifications for handoff-only withdrawal.
- Receipt insertion, alert and source terminal transition are one transaction. Pending/retry events with no external attempts complete locally. Legacy processing/unknown/reconciling events require explicit quarantine/manual evidence; never reset them to pending or manufacture non-delivery. An active legacy lease is not stolen.
- An existing receipt makes repeat processing a no-op. Concurrent consumers cannot create two receipts or duplicate cases. Transaction rollback leaves neither receipt nor premature source completion.
- Exclude this dedicated topic from generic claim, recovery, exhaustion and direct mutation paths, even when generic topics are undefined. Do not broaden exclusions to unrelated products. Existing owner/topic/bot fences stay intact.

**Acceptance tests:**

- [ ] Given direct denied/revoked journal facts, consume records one receipt, zero recipient sends and one historical-uncertainty case.
- [ ] Given cascaded note withdrawal or later regrant, the real handoff fact still processes once.
- [ ] Given mismatched user/purpose/decision/hash/keys, forged or extra payload fields, no valid withdrawal processing occurs; a bounded invalid-source case is recorded.
- [ ] Given two consumers or forced rollback, receipt/source/alert atomicity and idempotency hold.
- [ ] Given a contended first subject, a later eligible event remains reachable; authority locks precede source locks.
- [ ] Given generic unrestricted claim/recovery/exhaustion/direct stale completion, the dedicated source remains untouched.
- [ ] Given legacy active lease versus expired processing/unknown, no lease theft or external resend occurs; uncertainty remains explicit.
- [ ] Given pending neutral booking deliveries, handoff withdrawal leaves their independent messaging authority unchanged.
- [ ] First build a compileable scaffold and all regression assertions. Run only the new focused file once for behavioral RED. Implement, then one GREEN run. Reserve run3 for coordinator after independent review. Record exact output and invocation counts.
- [ ] Reconstruct state from isolated PG17.5; run relevant DB/test typechecks, changed-file lint and diff check. Do not run full suite. Report any unrelated failures without weakening checks.

## Task 2 — Actual worker composition and operator recovery guidance

Assigned after Task1 interface handoff; no concurrent edits to its files.

**Files:** `apps/worker/src/runtime.ts`, `apps/worker/src/main.ts` or existing production factory, new `apps/worker/src/booking-handoff-runtime.test.ts`, new `apps/worker/src/booking-handoff-composition.test.ts`, `docs/runbooks/2026-10-12-commercial-review-release.md`. The composition file covers the distinct actual-entrypoint behavior; it does not rerun or rename runtime/PG coverage. Both new files have exhausted three invocations as recorded in evidence.

- [x] Compose the real DB consumer as a separately named local job. It must run without Telegram credentials and with notification send/admission disabled. Follow existing local-jobs lifecycle; stop scheduling once shutdown starts.
- [ ] New runtime tests prove actual factory wiring,20-item bound, zero fetch, flags independence, shutdown ordering, and content-free error handling. Wiring/bound/zero-fetch/shutdown verified; actual consumer error-sanitization remains to review. Do not rerun exhausted notification runtime/runner files.
- [x] Document receipt versus remote deletion, historical uncertainty, invalid-source quarantine and no unknown resend. Operator acknowledgement alone does not resolve delivery evidence.
- [ ] Obtain independent adversarial review. Fix findings with remaining bounded runs. Record scope and actual results; no claim of deployment, legal approval or full T5 completion.

## Execution assignment

Task1 is assigned to the existing DB implementer after reading this plan and parent spec. Task2 remains coordinator-owned after handoff. No nested agents. Independent review is coordinator-assigned. The next action is Task1 RED, not another broad audit.
