# Payment First-Send Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent concurrent/restarted checkout from sending an existing unbound payment again.

**Architecture:** PostgreSQL returns one insertion-owned initial-send permission after committing conservative unknown state. The adapter sends only with that permission, outside database retry callbacks. Bound retries use existing validated GET.

**Tech Stack:** TypeScript, PostgreSQL17.5, Drizzle SQL, Vitest, Node24, pnpm11.9.0.

**Spec:** `docs/superpowers/implementation-artifacts/spec-payment-first-send-admission.md`

## Global Constraints

- No live provider calls, production changes, refunds, or nested subagents.
- Preserve existing dirty receipt work; no edits to Boyle-owned receipt files.
- Each of two genuinely new test files: author RED1/GREEN2, coordinator final3 after review. No existing exhausted test runs or full/multi-path suite.
- No automatic resend or financial release after ambiguity. No legacy claim fallback.
- No migration is expected; do not generate schema or alter existing migrations.
- Coordinator controls commit/release; implementer leaves a stable scoped diff and evidence.

## Review Focus

- Explicit attempt ID must not bypass order amount/status/deadline validation.
- A transaction retry must never carry a network request or stale send permission.
- Crash/ambiguous commit leaves no reusable permission and no false failure.
- Expiry while blocked on a row lock must use fresh database time, not transaction start.
- Existing unknown operations and incompatible recovery settings must produce zero POST.

## Task 1: Atomic admission through the real checkout adapter

**Files:** Modify `packages/integrations/src/yookassa/operation-port.ts`, `packages/integrations/src/yookassa/payment-adapter.ts`, and `packages/db/src/repositories/yookassa-operation-repository.ts`. Create the two focused test files named in the spec and `docs/test-evidence/payment-first-send-admission-2026-10-13.md`.

**Interfaces:** Add `claimInitialPayment(command: ClaimYooKassaOperationCommand)` returning a discriminated union of `{kind: "initial_send_admitted", operation: YooKassaOperation}` and `{kind: "existing", operation: YooKassaOperation}`. Reject non-create_payment commands. Missing capability must fail closed at runtime; update compile-time doubles only where required, with no additional test execution.

- [ ] Write adapter regressions for first send, concurrent calls, existing unbound statuses, bound GET, changed authority, absent capability, unsupported recovery, and POST/binding ambiguity.
- [ ] Write isolated PostgreSQL regressions for unique admission, restart, consistent attempt state, explicit-attempt validation, digest conflict, and deterministic lock-wait expiry. Instrument commit ambiguity with a narrow transaction boundary double; do not falsely label it real network-failure evidence.
- [ ] Run each new file once (RED1) separately; record command, session, exit and behavioral failure before implementation.
- [ ] Implement insertion-owned admission using existing validation/digest/serializable retry. Persist operation and attempt uncertainty in the transaction; only the successful newly inserted operation returns permission. Revalidate locked order/attempt and fresh deadline. Existing operation returns no permission.
- [ ] Switch createCheckout to the atomic capability. Bound existing operations retain GET checks; unbound existing operations return sanitized unresolved error with no POST or release. Reject incompatible unbound recovery explicitly. Keep network calls outside transaction/retry.
- [ ] Build affected packages, then run each new file once (GREEN2), separately. Record failures honestly; do not consume coordinator final3.
- [ ] Run relevant types, scoped lint/format and whitespace checks. Record exact hashes and limitations in evidence; no production or provider side effects.
- [ ] Independent review; same implementer corrects findings without unapproved extra tests. Coordinator runs final3 for each new file only on stable reviewed source, then decides commit readiness.

## Preflight ruling

One cohesive task owns the port/repository/adapter interface; splitting would test incomplete admission semantics. All five review-focus risks have explicit regression obligations above. Existing receipt implementation remains the sole active source writer until its stable handoff; do not dispatch this task concurrently. Owner delegated technical choices, not test-budget exceptions or fabricated live-provider success.
