---
id: SPEC-mvp-worker-outbox-001
companions:
  - CONTRACTS.md
  - ../../../docs/superpowers/architecture/mvp-worker-outbox-001/ARCHITECTURE-SPINE.md
sources:
  - packages/worker/src/outbox-runner.ts
  - packages/db/src/repositories/outbox-repository.ts
  - packages/db/src/repositories/worker-jobs-repository.ts
  - packages/db/src/repositories/feedback-repository.ts
  - apps/worker/src/runtime.ts
  - apps/worker/src/main.ts
  - docs/spec/mvp-operator-case-inbox.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the
> complete, preservation-validated contract for what to build, test, and
> validate. Source documents listed in frontmatter are for traceability only.

# MVP-WORKER-OUTBOX-001 — local typed outbox delivery

## Why

This is a production-readiness gap for operators. The repository already has a
fenced outbox runner, while the production worker still uses a separate SQL
materializer for the two local operator-case topics. The split leaves the generic
runner unreachable and makes a later activation liable to compete for the same
rows or claim unrelated provider work. This feature makes the generic path
production-reachable for exactly the two local topics without activating any
external provider.

## Capabilities

- **CAP-1 — Configuration-owned activation**
  - **intent:** An operator can enable the local generic outbox path with one
    versioned, default-false setting while disabled deployments retain current
    behavior.
  - **success:** `WORKER_OUTBOX_DELIVERY_ENABLED` is absent or `false` by default;
    disabled composition constructs no registry and continues to call only the
    legacy operator-case materializer.
- **CAP-2 — Closed typed registry**
  - **intent:** The worker can dispatch only explicitly registered local topics
    through topic-specific payload decoders and handlers.
  - **success:** the runtime registry contains exactly
    `safety.operator_escalation` and `admin.negative_feedback`; an unregistered
    topic cannot be claimed, exhausted, recovered, dispatched, reconciled or
    dead-lettered by this mode.
- **CAP-3 — Durable local delivery**
  - **intent:** Each registered outbox fact becomes exactly one privacy-bounded
    operator case despite retries, concurrent workers or a crash between local
    mutation and outbox acknowledgement.
  - **success:** dispatch is idempotent by source outbox ID, reconciliation reads
    the durable case, and a replay never creates a second case.
- **CAP-4 — Terminal poison handling**
  - **intent:** Structurally invalid payloads and unrecoverable local source state
    stop retrying without being reclassified as an ambiguous provider outcome.
  - **success:** invalid input produces a bounded terminal reason and a fenced
    dead-letter/operator-case reconciliation; retryable local failures remain
    retryable and post-mutation ambiguity is resolved by durable case lookup.
- **CAP-5 — Single ownership**
  - **intent:** One worker mode owns the registered rows in each process.
  - **success:** enabled generic mode never invokes legacy
    `materializeOperatorCasesBatch`; disabled mode never invokes the generic
    runner or registry.
- **CAP-6 — Bounded observability**
  - **intent:** Operators can distinguish local outbox progress, ambiguity and
    terminal outcomes without exposing payloads or creating unbounded labels.
  - **success:** metrics use only closed topic/phase/outcome/reason-class labels;
    payload, correlation key, reconciliation key, row ID and case content never
    enter metrics or logs.

## Constraints

- Exact implementation base is
  `0bfb6efc4b2145dfc5f4ba4763fa6264f422f842`.
- `WORKER_OUTBOX_DELIVERY_ENABLED` defaults to `false` in the schema and every
  versioned environment example.
- Enabled startup fails before a claim when the registry factory, either local
  handler, repository allowlist or metrics adapter is incomplete.
- Registry construction is lazy and derived from parsed `RuntimeConfig`; a
  prebuilt registry cannot bypass the feature flag.
- The registry is a closed two-topic tuple. No Telegram, YooKassa, Selarti,
  Planerka, client notification, expert notification or other provider topic is
  permitted.
- Normal claims, unknown claims, exhausted-row terminalization and expired-lease
  recovery are all restricted to the exact registered topic tuple.
- Handler payloads are locators and consistency evidence, never financial,
  identity or case authority. PostgreSQL owns authoritative case data.
- Local mutation and outbox state transition remain separate. Unknown completion
  after local mutation must reconcile from the case keyed by outbox ID rather
  than repeat an unbounded side effect.
- No schema migration is part of this feature. Migration `0028` already supplies
  the case relation and lifecycle; the fenced outbox schema already supplies the
  required delivery and reconciliation states.
- The implementation follows test-first development, one final focused Claw run,
  no repeated green suite, no GitHub Actions, no production action, no image
  build and no prune.

## Non-goals

- Sending Telegram, email, webhook or payment-provider notifications.
- Registering or claiming any external/provider outbox topic.
- Changing operator-case read or transition APIs.
- Changing producer payloads, outbox tables or operator-case schema.
- Claiming production telemetry export; this story only wires bounded metric
  instruments into the worker composition.

## Success signal

With the flag enabled and complete local composition, two concurrent workers turn
valid rows for both registered topics into one case each, recover a crash after the
case insert without a duplicate, and leave an eligible provider-topic row byte-for-
byte unchanged. With the flag disabled, the existing legacy materialization path
continues unchanged.
