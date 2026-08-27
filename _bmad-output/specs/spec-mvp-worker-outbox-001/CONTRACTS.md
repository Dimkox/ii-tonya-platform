# MVP-WORKER-OUTBOX-001 contracts

## Stable requirements

- **WORKER-OUTBOX-001-R1 — Default-off config:** parse
  `WORKER_OUTBOX_DELIVERY_ENABLED` as exact `true | false`, default `false`, and
  expose `RuntimeConfig.features.workerOutboxDelivery: boolean`.
- **WORKER-OUTBOX-001-R2 — Lazy composition:** construct a topic registry only
  inside the production runtime factory after parsed config is known and only
  when R1 is true. Enabled-incomplete composition throws
  `worker_outbox_delivery_capability_unavailable` before database claims.
- **WORKER-OUTBOX-001-R3 — Closed registry:** the only registered topics are the
  literal tuple `safety.operator_escalation`, `admin.negative_feedback`.
- **WORKER-OUTBOX-001-R4 — Complete filtering:** dispatch claims, unknown claims,
  pre-claim attempt exhaustion, pre-claim reconciliation exhaustion and both
  expired-lease recovery operations accept the validated tuple and apply it in
  SQL. An empty or unknown topic set is rejected before SQL.
- **WORKER-OUTBOX-001-R5 — Safety handler:** decode the exact safety payload below,
  require an authoritative `human_escalations` row with the same `handoffId`,
  version and escalated state, idempotently materialize a `safety` case keyed by
  source outbox ID, and derive stored case fields from the fixed topic contract,
  never from narrative input. A missing/mismatched source is terminal
  `local_source_invalid`.
- **WORKER-OUTBOX-001-R6 — Feedback handler:** decode the exact feedback payload
  below, use `feedbackId` only as a locator, then read rating, content hash,
  policy version and escalation status from the authoritative `feedback` row.
  A syntactically valid locator with no authoritative escalated row materializes
  the existing bounded `delivery_failure/negative_feedback_source_invalid` case.
  A payload hash/policy value that is well-formed but differs from the row does
  not override or suppress the authoritative case; the row values win.
- **WORKER-OUTBOX-001-R7 — Poison semantics:** an object with unknown/missing
  fields, an invalid UUID, invalid integer/charge/hash/policy shape or topic-
  decoder mismatch is terminal `invalid_payload`; an unrecoverable local
  invariant is terminal `local_source_invalid`. Neither is reported as
  `unknown_outcome`.
- **WORKER-OUTBOX-001-R8 — Ambiguity:** a handler exception after attempt-start is
  treated as unknown. Reconciliation checks the durable case by outbox ID and
  expected type/reason: present means applied, absent and still-valid source means
  not applied/retry, irrecoverable source means terminal. A terminal reconciliation
  result is fenced by the reconciliation claim token.
- **WORKER-OUTBOX-001-R9 — Exclusive mode:** R1 false invokes the existing
  `materializeOperatorCasesBatch` and no generic registry/runner. R1 true invokes
  the generic runner and never invokes legacy materialization or the separate
  unfiltered lease-recovery job for the registered rows.
- **WORKER-OUTBOX-001-R10 — Bounded execution:** keep batch size `1..1000`, lease
  fencing, maximum dispatch/reconciliation attempts, bounded backoff and one
  non-overlapping worker cycle.
- **WORKER-OUTBOX-001-R11 — Metrics:** record only closed `topic`, `phase`,
  `outcome` and `reasonClass` values. No payload, text, hash, policy version,
  correlation/reconciliation key, row/case ID, exception message or provider ID
  is a label or log field.
- **WORKER-OUTBOX-001-R12 — No migration/provider activation:** reuse migrations
  `0004`, `0005` and `0028`; add no migration and no provider import, credential,
  URL, token or transport claim.
- **WORKER-OUTBOX-001-R13 — Controlled rollback:** before a planned switch from
  true to false, stop new claims and let the filtered runner drain/reconcile the
  two topics. Emergency false may pause durable unknown rows but never rewrites or
  hands them to the legacy pending-only materializer.

## Exact local payload contract

The decoder rejects arrays, prototypes with extra enumerable data, unknown keys
and coercion. UUIDs use the repository's existing canonical UUID syntax.

```ts
type SafetyOperatorEscalationPayload = Readonly<{
  handoffId: string; // canonical UUID; locator only
  version: number; // positive safe integer
  charge: 0; // exact literal; no monetary authority
}>;

type AdminNegativeFeedbackPayload = Readonly<{
  feedbackId: string; // canonical UUID; sole source locator
  contentHash: string; // exactly 64 lowercase hex; consistency evidence only
  policyVersion: string; // ^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$
}>;

type LocalOperatorCaseMessage =
  | Readonly<{
      outboxId: string;
      topic: "safety.operator_escalation";
      payload: SafetyOperatorEscalationPayload;
    }>
  | Readonly<{
      outboxId: string;
      topic: "admin.negative_feedback";
      payload: AdminNegativeFeedbackPayload;
    }>;
```

### Authority boundary

| Topic | Payload authority | PostgreSQL authority | Persisted operator case |
| --- | --- | --- | --- |
| `safety.operator_escalation` | `handoffId` and `version` locate the transactionally produced safety fact; `charge` must be literal zero | an authoritative `human_escalations` row with matching ID/version and escalated state plus the persisted outbox ID/topic; no payload narrative or owner identity is accepted | `case_type=safety`, `case_reason_code=safety_operator_escalation`, no rating/hash/policy/source ID |
| `admin.negative_feedback` | `feedbackId` is a locator; payload hash/policy are non-authoritative consistency evidence | `feedback.id`, `rating`, `content_hash`, `negative_policy_version`, `escalation_status` | authoritative negative-feedback fields, or bounded `delivery_failure/negative_feedback_source_invalid` when the valid locator has no eligible source |

The handler receives the persisted `outboxId`, exact registered topic and decoded
payload. It never accepts an amount, URL, provider operation ID, recipient,
operator role, user ID, expert ID, reservation ID, feedback text or safety
narrative.

## Typed registry and local repository ports

```ts
type LocalOutboxTopic =
  | "safety.operator_escalation"
  | "admin.negative_feedback";

interface RegisteredOutboxTopic<Topic extends LocalOutboxTopic, Payload> {
  readonly topic: Topic;
  decode(value: unknown): Payload;
  dispatch(message: Readonly<{
    outboxId: string;
    topic: Topic;
    payload: Payload;
  }>): Promise<
    | { kind: "applied" }
    | { kind: "not_applied"; retryable: true; reasonCode: string }
    | { kind: "terminal"; reasonCode: "invalid_payload" | "local_source_invalid" }
  >;
  reconcile(message: Readonly<{
    outboxId: string;
    topic: Topic;
    payload: Payload;
  }>): Promise<
    | { kind: "applied" }
    | { kind: "not_applied" }
    | { kind: "still_unknown" }
    | { kind: "terminal"; reasonCode: "invalid_payload" | "local_source_invalid" }
  >;
}

interface LocalOperatorCaseOutboxRepository {
  materialize(
    input: LocalOperatorCaseMessage,
  ): Promise<"materialized" | "replayed" | "source_invalid">;
  inspect(input: Readonly<{
    outboxId: string;
    topic: LocalOutboxTopic;
  }>): Promise<"applied" | "absent" | "source_invalid">;
}
```

`materialize` owns only the idempotent local case insert. The fenced outbox
repository owns attempt recording and source status transitions. This separation
is intentional so `inspect` can resolve a crash between those two mutations.

## State and ownership matrix

| Config | Registered-row owner | Legacy batch | Generic recovery/dispatch | Other topics |
| --- | --- | --- | --- | --- |
| false/absent | `materializeOperatorCasesBatch` | runs unchanged | not constructed | existing disabled runtime behavior unchanged |
| true + complete registry | filtered generic runner | never called | only the two local topics | never selected or terminalized |
| true + incomplete registry | none; startup fails | never called | never starts | untouched |

## Closed metric vocabulary

- `topic`: `safety_operator_escalation | admin_negative_feedback`
- `phase`: `claim | dispatch | reconciliation | lease_recovery`
- `outcome`: `applied | retry | unknown | terminal | dead_letter | no_op`
- `reasonClass`: `invalid_payload | local_source_invalid | attempts_exhausted |
  reconciliation_exhausted | lease_expired | internal`

High-cardinality and content-bearing values are prohibited even when hashed.
