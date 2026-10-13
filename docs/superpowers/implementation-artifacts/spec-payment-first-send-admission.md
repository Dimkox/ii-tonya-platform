---
title: 'Atomic first-send admission for customer checkout'
type: 'bugfix'
created: '2026-10-13'
status: 'in-progress'
baseline_commit: 'd7ec2897462947e76bc4f258398b77817fe5900a'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="owner delegated technical choices; commercial checkout intent">

## Intent

**Problem:** Existing unbound payment operations can reach another provider POST
after a concurrent request or restart. A provider idempotency key does not prove
that this invocation owns permission to send.

**Approach:** Atomically consume initial-send permission in PostgreSQL. Only the
transaction creating a new operation may return that permission. Persist uncertainty
before external I/O; retries of unbound operations remain unresolved without POST.

## Boundaries & Constraints

**Always:** PostgreSQL owns admission, amount, currency and order state. Commit
admission before HTTP, outside serializable retries. Preserve financial reservations
on uncertain outcomes. Validate order and attempt under locks using fresh database
time after lock acquisition. Existing bound retries retain verified GET behavior.
No raw receipt data in admission records, diagnostics or evidence. Use Node24,
pnpm11.9.0 and isolated PostgreSQL17.5. Preserve Boyle's receipt file ownership.

**Ask First:** Any real provider charge, refund, destructive production operation,
or extra execution of an exhausted test file. Existing deployment authorization
does not authorize synthetic live payments.

**Never:** Infer send permission from claimed/pending/unknown status; auto-takeover
after a lease; send inside a database retry; fall back to legacy claim when the
new capability is absent; enable unbound exact-body recovery. No schema generation,
new migration unless existing constraints demonstrably require it, or unrelated
refund behavior changes. This increment does not claim complete provider composition
or solve receipt-disclosure admission by itself.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| First purchase | Valid fresh command | One committed admission, one POST, bind result | Preserve unknown on ambiguous POST/bind |
| Concurrent retry | Same command twice | At most one initial POST | Other invocation unresolved or bound GET |
| Restart | Existing unbound claimed/pending/unknown | Zero POST | Sanitized unresolved error, no release |
| Lost commit response | Admission outcome unknown | Zero POST from caller | Later invocation cannot acquire old permission |
| Bound retry | Matching provider object | GET only with existing identity/amount/mode checks | Reject mismatch |
| Changed command | Same command ID, different authority | Zero POST | Idempotency conflict |
| Lock delay | Order expires while waiting | Zero admission | Reject using fresh post-lock database time |
| Unsupported configuration | Missing capability or enabled unbound recovery | Zero POST | Explicit fail-closed error |

</frozen-after-approval>

## Code Map

- `packages/integrations/src/yookassa/payment-adapter.ts` — createCheckout claim at
  line152 and unconditional unbound createPayment at207; attachRecoverySnapshot
  returns immediately when disabled. Keep bound GET checks.
- `packages/integrations/src/yookassa/operation-port.ts` — current claim returns
  only a row; add create-payment admission result, not a reusable row permission.
- `packages/db/src/repositories/yookassa-operation-repository.ts` — claim at172
  uses serializable retry, canonical digest and order/attempt locks; insertion at323
  discards ownership. Reuse validation without duplicating divergent authority.
- `packages/db/migrations/0023_yookassa_provider_operations.sql` — existing unique
  command identity and unknown_outcome status support conservative admission.
- `docs/operations/2026-10-12-yookassa-runtime-gap.md` — ordinary API composition
  remains incomplete; this prerequisite must not be reported as live activation.

## Tasks & Acceptance

**Execution:**
- [ ] `operation-port.ts`, `yookassa-operation-repository.ts`, `payment-adapter.ts`
  under the directories above — introduce claimInitialPayment(command), returning
  `{kind: "initial_send_admitted" | "existing", operation}`. Restrict to create_payment.
  Use INSERT RETURNING ownership and commit unknown_outcome before returning admission.
  Persist a consistent unknown payment-attempt state in the same transaction.
- [ ] `packages/integrations/src/yookassa/payment-first-send-admission.test.ts` —
  recording transport tests for every matrix branch, including commit/POST/bind ambiguity.
- [ ] `tests/integration/yookassa-first-send-admission.test.ts` — actual database
  concurrency, restart, digest conflicts, explicit-attempt validation and deterministic
  lock-wait expiry. Assert persisted state and exactly one admitted caller.
- [ ] `docs/test-evidence/payment-first-send-admission-2026-10-13.md` — record
  bounded runs, exact fingerprints, review and integration limitations.

**Acceptance Criteria:**
- Given two identical concurrent purchases, when both reach admission, then at most
  one receives initial-send permission and the recording provider sees one POST.
- Given a crash after admission, when a new process retries, then it cannot resend
  and neither order nor reservation is falsely settled, failed or released.
- Given an invalid or expired order with an explicit payment-attempt ID, when
  admission runs, then that alternate path cannot bypass authoritative validation.
- Given unavailable atomic capability, when checkout runs, then no legacy-claim
  fallback or provider POST occurs.

## Spec Change Log

## Design Notes

Owner delegated technical implementation choices. Coordinator selected this design
and its plan under that delegation; no separate human review is claimed. Execute
`docs/superpowers/plans/2026-10-13-payment-first-send-admission.md`. Sole writer owns
the three named source files, two new tests and its evidence. Do not edit receipt
files, repository guards, shared status, or unrelated doubles without coordinating.
No subagents, commits, push or remote operations. Receipt source is stable under
review; preserve it. Static builds must not overlap coordinator receipt tests:
notify coordinator before rebuilding shared packages.

Prefer insertion ownership with existing unknown_outcome state over a status-only
guard (misses concurrent claimed rows) or expiring send leases (unsafe takeover).
Admission may be consumed without any HTTP after a crash. That uncertainty is
intentional and requires reconciliation, not an invented failure or another POST.
Reject incompatible exact-body recovery configuration rather than silently dropping
its snapshot or redesigning recovery. Preserve the existing generic claim for refund
and controlled legacy consumers; ordinary checkout must use the new capability.

## Verification

Each genuinely new focused file gets author RED1/GREEN2 and coordinator final3
after independent review. Existing exhausted tests remain unrun without permission.
Run preflight with RequireDocker, relevant package builds/typechecks, scoped lint,
format checks and git diff --check. Use synthetic credentials and recording transport
only. No full suite, multi-path run, production change or paid provider call.
