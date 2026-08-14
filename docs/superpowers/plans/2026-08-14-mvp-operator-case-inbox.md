# MVP Operator Case Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materialize safety and negative-feedback outbox facts into a durable, privacy-bounded operator inbox with authenticated listing and idempotent case transitions.

**Architecture:** Extend the existing `outbox_operator_alerts` relation through additive migration `0028`, retaining its outbox uniqueness while adding a closed case lifecycle. A PostgreSQL worker batch materializes both local topics; an application service owns role filtering and cursor validation; a separate repository performs keyset reads and atomic audited transitions. Existing dual-control admin mutations remain unchanged.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Drizzle, Vitest.

## Global Constraints

- Exact base `8b3c5c846f28451784c49c35ebd1e0606527db04`.
- Requirements `OPS-CASE-001-MAT` through `OPS-CASE-001-OPS` in `docs/spec/mvp-operator-case-inbox.md` are authoritative.
- No raw feedback/dialogue, domain identifiers, provider payloads or payment data in case storage or responses.
- One real-PostgreSQL Claw run and one final focused Claw gate only; no repeats, Actions, production, image build or prune.

---

### Task 1: Schema and worker materialization

**Files:**

- Create: `packages/db/migrations/0028_operator_case_inbox.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/integration.ts`
- Modify: `packages/db/src/repositories/worker-jobs-repository.ts`
- Modify: `apps/worker/src/runtime.ts`
- Test: `tests/integration/operator-case-inbox.test.ts`
- Test: `tests/repo/operator-case-inbox-boundaries.test.ts`

**Interfaces:**

- Produces: `PostgresWorkerJobsRepository.materializeOperatorCasesBatch(batchSize): Promise<{materialized:number}>`.
- Persists: `safety | negative_feedback | delivery_failure` and `open | acknowledged | resolved` closed values.

- [x] Write the integration and boundary tests first. The fixtures insert both
      reviewed outbox topics, include forbidden raw/source identifiers in source
      payloads, run two repository workers concurrently and expect exactly two safe
      cases and succeeded sources.
- [x] Author tests before production code; no pre-implementation behavior run
      was claimed because execution was reserved for the Claw gate.
- [x] Add migration `0028`, exact Drizzle metadata and the atomic batch:

```sql
with claimed as materialized (
  select id, topic, payload from integration_outbox
  where topic in ('safety.operator_escalation','admin.negative_feedback')
    and status in ('pending','retry_wait')
  order by created_at,id for update skip locked limit $1
), case_rows as (...), queued as (
  insert into outbox_operator_alerts (...) select ... from case_rows
  on conflict (outbox_id,reason_code) do update
    set outbox_id=excluded.outbox_id returning outbox_id
)
update integration_outbox set status='succeeded' from queued
where integration_outbox.id=queued.outbox_id;
```

- [x] Point the production worker's local confirmed-outbox job at the new batch; do not add a notifier.

### Task 2: Application port, repository and routes

**Files:**

- Create: `packages/application/src/operator-case-service.ts`
- Create: `packages/application/src/operator-case-service.test.ts`
- Modify: `packages/application/src/index.ts`
- Create: `packages/db/src/repositories/operator-case-repository.ts`
- Modify: `packages/db/src/index.ts`
- Create: `apps/api/src/routes/operator-cases.ts`
- Create: `apps/api/src/routes/operator-cases.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**

```ts
interface OperatorCaseService {
  listOpen(
    principal: AdminPrincipal,
    input: { limit: number; cursor?: string },
  ): Promise<
    | { kind: "ok"; items: readonly OperatorCase[]; nextCursor?: string }
    | { kind: "forbidden" }
  >;
  transition(
    principal: AdminPrincipal,
    input: { caseId: string; action: "acknowledge" | "resolve" },
  ): Promise<
    | { kind: "updated" | "replayed"; item: OperatorCase }
    | { kind: "forbidden" | "not_found" | "conflict" }
  >;
}
```

- [x] Write service tests for exact role/type visibility, malformed cursor rejection, bounded limit and repository-free denial.
- [x] Write route tests for fresh bearer resolution, bounded pagination, no-body transitions, role denial and closed status mapping.
- [x] Implement opaque base64url `(createdAt,id)` cursors and exact role-to-case-type mapping.
- [x] Implement PostgreSQL keyset reads and a row-locked transition transaction that appends audit only for a first state change.
- [x] Register optional case routes beside the existing admin Fastify boundary without changing existing mutation contracts.
- [x] Compose `createOperatorCaseService(new PostgresOperatorCaseRepository(db))` in the default server lifecycle.

### Task 3: Verification, review and evidence

**Files:**

- Modify: `tests/repo/db-schema-parity.test.ts`
- Modify: `tests/repo/support/payment-scope-boundary-core.ts`
- Modify: `tests/repo/expert-referral-scope-guards.test.ts`
- Create: `docs/test-evidence/claw/<code-sha>-mvp-ops-case-001/verification.md`

- [x] Register migration `0028`, its immutable hash, unchanged relation inventory and exact named constraints/indexes.
- [x] Build affected packages locally without running the real-PostgreSQL behavior outside Claw.
- [x] Commit code and obtain independent adversarial review; fix every Critical/Important finding and re-review.
- [x] Run the focused Claw gate and only targeted failed assertions after remediation; never repeat already-green suites.
- [x] Record exact counts, cleanup and release boundaries in a docs-only evidence commit. Do not push or merge.
