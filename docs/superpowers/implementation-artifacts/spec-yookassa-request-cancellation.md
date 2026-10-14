---
title: "Bound cancellation of receipt-bearing YooKassa requests"
type: "bugfix"
created: "2026-10-14"
status: "done"
baseline_commit: "d00d24593493cb348a25abf0eec0318a1c018ddf"
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="owner delegates technical gates; existing payment-composition prerequisite, no change to disclosure authorization">

## Intent

**Problem:** The merchant client always replaces a caller's request signal with
its own timeout. Ordinary API shutdown and the planned receipt scope therefore
cannot cancel a checkout through its public interface. Body-reading failures can
escape unsanitized, and the current response-size check occurs after buffering.

**Approach:** Add an optional, non-serialized signal to payment creation. Preserve
the existing fifteen-second ceiling and propagate cancellation through transport
and bounded response reading. Reuse existing unknown/terminal error contracts;
never retry an ambiguous payment. This is a prerequisite of full API composition,
not a substitute for the commercial checkout or a production-activation claim.

## Boundaries & Constraints

**Always:** Preserve request serialization, merchant/idempotency bindings and
existing callers without options. A pre-cancelled invocation performs no provider
I/O. Cancellation or I/O failure after invocation is an unknown outcome, never
evidence of no charge. Cancellation reasons and provider body errors are private.
Keep the 256KiB limit, measured in bytes while consuming the stream. Keep each
request's signal independent. Preserve refund and authoritative GET contracts.

**Ask First:** Actual merchant traffic, changing the unresolved receipt-disclosure
policy, or additional runs after a test's recorded allowance is used.

**Never:** New financial admission, a permission to disclose after redaction,
retry/resend, enabled payment flags, credentials in fixtures, DB/schema changes,
remote operations, deployment, or a claim that this completes client purchases.

## I/O & Edge-Case Matrix

| Scenario               | Input / State                                  | Expected Output / Behavior                         | Error Handling                     |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------- | ---------------------------------- |
| Already cancelled      | Valid payment with aborted caller signal       | Zero transport calls                               | Sanitized unknown                  |
| In-flight cancellation | One POST awaiting transport                    | Combined signal aborts; no resend                  | Sanitized unknown                  |
| Own ceiling            | Caller signal remains active                   | Existing fifteen-second ceiling still cancels      | Sanitized unknown                  |
| Response consumption   | Cancellation after headers or while body waits | Stop body reading; never return successful payment | Sanitized unknown                  |
| Body failure           | Stream throws private error                    | No private error escapes                           | Sanitized unknown                  |
| Oversized response     | Declared or streamed body exceeds limit        | Cancel body without unbounded buffering            | Existing response-invalid terminal |
| Normal checkout        | Optional active signal                         | Exact existing wire body and validated result      | Existing validation/mode errors    |
| Concurrent calls       | One caller cancels, another succeeds           | Cancellation stays request-local                   | No cross-call cancellation         |

</frozen-after-approval>

## Code Map

- `packages/integrations/src/yookassa/client.ts`: `YooKassaClient.createPayment`,
  internal `request` and `readJson`; current fixed timeout overwrites signals,
  and response.text buffers before checking size. Existing serializers/error
  classes remain authoritative. Extend only payment's optional options surface.
- `packages/integrations/src/index.ts`: export the options type if one is named.
- `packages/integrations/src/yookassa/client.test.ts`: existing fixtures and wire
  contracts; read-only reference, do not run or rename exhausted old coverage.
- `apps/worker/src/yookassa-composition.ts`: read-only existing caller that combines
  request signals with shutdown/credentials/deadline. Do not edit its behavior.
- New `packages/integrations/src/yookassa/client-cancellation.test.ts`: regression
  matrix using real client and synthetic/recording transport. No network or DB.
- New `docs/test-evidence/yookassa-request-cancellation-2026-10-14.md`: execution
  counts, evidence and explicit unimplemented full-checkout dependencies.

## Tasks & Acceptance

**Execution:**

- [x] Add regression matrix and observe expected baseline failures (RED1).
- [x] Implement optional signal, bounded reads and sanitized failure handling.
- [x] Run focused GREEN2, relevant static checks and record evidence.
- [x] Independent review, corrections, coordinator final3 (56/56), and source evidence.

**Acceptance Criteria:**

- Given a valid receipt-bound command, when the caller cancels before invocation,
  then no merchant request occurs and no receipt enters transport.
- Given an already invoked request, when cancellation occurs at any asynchronous
  network boundary, then no success or retry is manufactured from uncertainty.
- Given existing callers, when no options are supplied, then public result,
  body serialization, validation and timeout ceiling remain compatible.

## Spec Change Log

## Design Notes

The complete API-composition spec remains separate and unchanged. In particular,
transport cancellation does not claim atomic database-lock/remote-HTTP exclusion
or resolve the previously identified disclosure-policy question. Standard fetch
and injected transports must honor the passed signal; no helper can recall bytes
already sent or revoke a payment already created. Cancel unread bodies on error,
without awaiting an untrusted stream's indefinitely pending cancellation hook.

## Verification and ownership

One implementer owns only client.ts, its export, the new test, and own evidence
in the current isolated worktree, branch codex/yookassa-request-cancellation-20261014.
Do not change shared main-checkout handoffs, the spec's frozen block or old tests.
No nested agents, commit, staging, push, SSH, live provider call or secret access.
Coordinator already passed environment preflight: Node24.21.0/pnpm11.9.0; missing
.env is intentional for synthetic testing. Existing worktree dependencies exist.
Keep all executions sequential within the implementer's scope.

Only two author invocations of the new focused test: RED1 and GREEN2. Coordinator
owns final3 after independent review. Record commands/results immediately. Do
not run full/multi-path suites, old tests or mutation commands; repository limits
override generic skill suite instructions. No PostgreSQL verification needed.
Run integrations typecheck/build, focused ESLint and Prettier, and git diff --check.
Return changed paths, precise results, counts and incomplete/risky items.

## Suggested Review Order

**Request lifetime**

- Preserve caller cancellation and the existing ceiling without authorizing a resend.
  [client.ts:231](../../../packages/integrations/src/yookassa/client.ts#L231)

- Carry cancellation separately from the serialized financial request.
  [client.ts:289](../../../packages/integrations/src/yookassa/client.ts#L289)

**Response boundary**

- Bound bytes, sanitize stream failures, and release the owned reader.
  [client.ts:105](../../../packages/integrations/src/yookassa/client.ts#L105)

- Discard unread error bodies without waiting for an untrusted cancellation hook.
  [client.ts:101](../../../packages/integrations/src/yookassa/client.ts#L101)

**Contract and evidence**

- Document uncertainty and preserve source compatibility for existing callers.
  [client.ts:38](../../../packages/integrations/src/yookassa/client.ts#L38)

- Cover cancellation races, byte boundaries, hostile streams, and shared refund consumers.
  [client-cancellation.test.ts:131](../../../packages/integrations/src/yookassa/client-cancellation.test.ts#L131)

- Record all three executions, independent review, exact hashes, and remaining product gaps.
  [yookassa-request-cancellation-2026-10-14.md:1](../../test-evidence/yookassa-request-cancellation-2026-10-14.md#L1)
