# MVP Client Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct external Selarti authority with ordered authenticated fixture ingress,
fresh tenant-bound identity and scope resolution, and crash-safe typed catalog/booking dispatch.

**Architecture:** The existing message completion transaction freezes accounting plus one encrypted
typed operation before mutation. A dedicated non-outbox fenced job mints a runtime-authenticated
operation claim; the matching catalog/booking transaction locks and freshly rechecks the exact
grant before mutation. Catalog/booking remain authoritative; provider, payment, LLM and outbound
delivery remain disabled.

**Tech Stack:** Node.js 24, TypeScript 5.8, Fastify 5.5, Drizzle ORM 0.45, PostgreSQL 17.5,
Vitest, pnpm 11.9.0.

## Global Constraints

- Implement only after merged/reviewed-equivalent booking input `e5efdb23a8bd80119aa2a28a533949d8a399d99a`;
  it currently contains protected service/repository code and migration 0031 but is unmerged here.
- Preserve CCV-001–019, architecture AD-1–8 and the exact v2 contract.
- All conversation/tool/Selarti/LLM/provider/billing flags default false/disabled.
- One migration is required, but its prefix is only the next actual journal entry after booking;
  inspect then allocate, never reserve it in this plan.
- Development may repeat focused/property/concurrency tests without invoking Claw/PG. After review,
  one total immutable release-evidence invocation is allowed for the reviewed SHA/identity.

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/application/src/client-conversation-authority.ts` | opaque tokens plus private runtime-authenticated operation claim |
| `packages/application/src/conversation-service.ts` | safety, strict proposal validation and atomic operation freeze request |
| `packages/db/src/repositories/client-conversation-principal-repository.ts` | tenant/subject identity and shared lifecycle-lock facts |
| `packages/db/src/repositories/client-conversation-operation-repository.ts` | claim/fence/reconcile/terminal/cleanup operations |
| `apps/api/src/client-conversation-inbound.ts` | ordered raw-header capability/result parser |
| `apps/api/src/routes/selarti-webhook.ts` | exact HTTP edge and state matrix without inbound UUID |
| `apps/worker/src/client-conversation-operations.ts` | dedicated local operation job, not outbox registry |
| `packages/contracts/src/worker-outbox.test.ts` | proves operation/provider topics are absent |

---

### Task 1: Allocate the post-booking migration and exact durable state

**Files:**

- Modify: `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/identity.ts`,
  `packages/db/src/schema/integration.ts`, `packages/db/src/index.ts`
- Create: the next actual migration after merged booking, with suffix `_client_conversation.sql`
- Create: `tests/integration/client-conversation-schema.test.ts`
- Modify: `tests/repo/db-schema-parity.test.ts`, `docs/spec/mvp-client-conversation-001-progress.md`

**Produces:** tenant/version binding columns, exact grants and leased encrypted operations. Required
DDL shape:

```sql
alter table provider_subject_mappings
  add column tenant_token text,
  add column token_version integer,
  add constraint provider_subject_mappings_conversation_token_check check (
    (provider='selarti.client-thread.v1' and tenant_token ~ '^hmac-sha256:v1:[0-9a-f]{64}$' and token_version=1)
    or (provider<>'selarti.client-thread.v1' and tenant_token is null and token_version is null)
  );

create table client_conversation_grants (
  id uuid primary key default gen_random_uuid(),
  provider_subject_mapping_id uuid not null references provider_subject_mappings(id) on delete cascade,
  scope text not null check (scope in ('client_catalog:read','client_booking:write')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at),
  unique(provider_subject_mapping_id, scope)
);

create table client_conversation_operations (
  id uuid primary key default gen_random_uuid(),
  message_event_id uuid not null unique references message_events(id) on delete cascade,
  binding_id uuid references provider_subject_mappings(id) on delete set null,
  required_scope text not null,
  tool_kind text not null,
  proposal_digest char(64) not null check (proposal_digest ~ '^[0-9a-f]{64}$'),
  payload_envelope_version smallint,
  payload_key_id text,
  payload_nonce bytea,
  payload_ciphertext bytea,
  payload_tag bytea,
  payload_expires_at timestamptz not null,
  status text not null check (status in ('pending','processing','retry_wait','unknown_outcome','reconciling','succeeded','denied','dead_letter','privacy_expired')),
  claim_fence bigint not null default 0 check (claim_fence >= 0),
  claim_owner_id text,
  claim_token uuid,
  lease_until timestamptz,
  reconciliation_owner_id text,
  reconciliation_claim_token uuid,
  reconciliation_lease_until timestamptz,
  attempt integer not null default 0 check (attempt between 0 and 5),
  reconciliation_attempt integer not null default 0 check (reconciliation_attempt between 0 and 5),
  next_attempt_at timestamptz,
  result_digest char(64) check (result_digest is null or result_digest ~ '^[0-9a-f]{64}$'),
  terminal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (updated_at >= created_at),
  check ((tool_kind='show_catalog' and required_scope='client_catalog:read') or
         (tool_kind='start_booking' and required_scope='client_booking:write')),
  check (payload_expires_at > created_at and payload_expires_at <= created_at + interval '24 hours'),
  check (payload_key_id is null or payload_key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  check ((status in ('pending','retry_wait','unknown_outcome','processing','reconciling') and
          payload_envelope_version=1 and payload_key_id is not null and octet_length(payload_nonce)=12 and
          payload_ciphertext is not null and octet_length(payload_tag)=16) or
         (status in ('succeeded','denied','dead_letter','privacy_expired') and
          payload_envelope_version is null and payload_key_id is null and payload_nonce is null and
          payload_ciphertext is null and payload_tag is null)),
  check ((status='processing' and claim_owner_id is not null and claim_token is not null and
          lease_until is not null and lease_until <= payload_expires_at and reconciliation_owner_id is null and
          reconciliation_claim_token is null and reconciliation_lease_until is null) or
         (status='reconciling' and reconciliation_owner_id is not null and
          reconciliation_claim_token is not null and reconciliation_lease_until is not null and
          reconciliation_lease_until <= payload_expires_at and claim_owner_id is null and claim_token is null and
          lease_until is null) or
         (status not in ('processing','reconciling') and claim_owner_id is null and claim_token is null and
          lease_until is null and reconciliation_owner_id is null and reconciliation_claim_token is null and
          reconciliation_lease_until is null)),
  check ((status='retry_wait' and next_attempt_at is not null) or
         (status<>'retry_wait' and next_attempt_at is null)),
  check ((status='succeeded' and result_digest is not null and terminal_reason is null) or
         (status='denied' and result_digest is null and terminal_reason='grant_denied') or
         (status='dead_letter' and result_digest is null and terminal_reason in
           ('invalid_operation','attempts_exhausted','crypto_invalid')) or
         (status='privacy_expired' and result_digest is null and terminal_reason='payload_expired') or
         (status in ('pending','processing','retry_wait','unknown_outcome','reconciling') and
           result_digest is null and terminal_reason is null)),
  unique(payload_key_id, payload_nonce)
);

create table client_conversation_runtime_leases (
  capability text not null check (capability in ('dispatch_v1','cleanup_v1')),
  instance_id text not null,
  contract_version integer not null check (contract_version=1),
  build_sha char(40) not null check (build_sha ~ '^[0-9a-f]{40}$'),
  heartbeat_at timestamptz not null,
  lease_until timestamptz not null,
  primary key(capability, instance_id),
  check (lease_until > heartbeat_at and lease_until <= heartbeat_at + interval '30 seconds')
);

create table client_conversation_operation_cases (
  operation_id uuid not null references client_conversation_operations(id) on delete cascade,
  case_kind text not null check (case_kind in ('operator_case','deletion_receipt')),
  reason text not null check (reason in ('grant_denied','invalid_operation','attempts_exhausted','payload_expired','crypto_invalid')),
  created_at timestamptz not null default now(),
  primary key(operation_id, case_kind)
);
```

- [ ] **Step 1: Read the merged journal and record the next actual prefix in progress docs.** Abort
  if booking is not merged or the journal conflicts; do not choose from this plan.
- [ ] **Step 2: Write RED schema/parity tests.** Assert provider-literal token constraints,
  `(tenant_token,subject_token,token_version)` lookup index, scope/state/check pairings, unique
  message event, cascade grants, operation binding `SET NULL`, lease/fencing consistency, nonnegative
  attempts, exact crypto envelope/nonce uniqueness, digest grammar, ciphertext expiry no later than
  creation + 24h, runtime-lease compatibility and unique operator/deletion cases. Attempt every
  forbidden row shape enumerated in contract section 5.2 with hostile SQL.
- [ ] **Step 3: Run `pnpm exec vitest run tests/integration/client-conversation-schema.test.ts tests/repo/db-schema-parity.test.ts` and confirm RED.**
- [ ] **Step 4: Add the exact migration/schema and rerun the same focused command until GREEN.**
- [ ] **Step 5: Commit.**

```powershell
git add packages/db tests/integration/client-conversation-schema.test.ts tests/repo/db-schema-parity.test.ts docs/spec/mvp-client-conversation-001-progress.md
git commit -m "feat: add durable client conversation state"
```

### Task 2: Add runtime-authenticated claims and lifecycle resolvers

**Files:**

- Create: `packages/application/src/client-conversation-authority.ts`,
  `packages/application/src/client-conversation-authority.test.ts`
- Create: `packages/db/src/repositories/client-conversation-principal-repository.ts`,
  `packages/db/src/repositories/client-conversation-principal-repository.test.ts`
- Modify: `packages/application/src/index.ts`, `packages/db/src/index.ts`
- Test: `tests/integration/client-conversation-authority.test.ts`,
  `tests/repo/client-conversation-import-boundary.test.ts`

**Interfaces:**

```ts
export interface ClientConversationIdentityResolver {
  resolveIdentity(input: {
    tenantToken: OpaqueConversationToken;
    subjectToken: OpaqueConversationToken;
  }): Promise<{ kind: "resolved"; identity: ClientConversationIdentity } | { kind: "denied" } | { kind: "unavailable" }>;
}
```

- [ ] **Step 1: Write RED compile/runtime tests.** Prove tokens parse only fixture v1; identity
  query matches provider+tenant+subject+version+active. Prove the private operation-claim
  constructor/reader is not exported and plain JS, `as unknown as`, stolen UUID, cross-tool,
  spread, clone and deserialized objects are rejected before DB/service invocation.
- [ ] **Step 2: Run `pnpm exec vitest run packages/application/src/client-conversation-authority.test.ts tests/integration/client-conversation-authority.test.ts tests/repo/client-conversation-import-boundary.test.ts` and confirm RED.**
- [ ] **Step 3: Implement DB raw-row facts and an application-only private claim class.** Register
  genuine instances in a module-private `WeakSet` and verify both native private-field and WeakSet
  provenance. The private reader exposes only operation/fence/tool/scope/frozen input to matching
  gateways. Zero/multiple/corrupt identity rows are denied; database errors are unavailable; no
  query reads `channel_identities` or creates/updates mappings/grants.
- [ ] **Step 4: Rerun the focused command until GREEN.**
- [ ] **Step 5: Commit.**

```powershell
git add packages/application/src packages/db/src tests/integration/client-conversation-authority.test.ts tests/repo/client-conversation-import-boundary.test.ts
git commit -m "feat: enforce runtime conversation operation claims"
```

### Task 3: Build ordered authenticated fixture ingress and exact replay identity

**Files:**

- Create: `apps/api/src/client-conversation-inbound.ts`,
  `apps/api/src/client-conversation-inbound.test.ts`
- Modify: `apps/api/src/routes/selarti-webhook.ts`, `apps/api/src/routes/selarti-webhook.test.ts`,
  `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Modify: `packages/config/src/env.ts`, `packages/config/src/env.test.ts`, `.env.example`
- Test: `tests/repo/runtime-fixture-boundary.test.ts`

**Interfaces:**

```ts
export interface RawHeaderOccurrence { readonly name: string; readonly value: string }
export interface AuthenticatedConversationInboundCapability {
  authenticate(input: {
    rawBody: Uint8Array;
    rawHeaders: readonly RawHeaderOccurrence[];
    signal: AbortSignal;
  }): Promise<AuthenticatedConversationInboundResult>;
}
```

- [ ] **Step 1: Write RED vectors.** Cover rawHeaders order/mixed-case duplicates/comma fold,
  HTTP/2/proxy denial, trustProxy false, source/IPv4-mapped-IPv6, 64,000/64,001 bytes, framing,
  UTF-8, hostile exact-key result, v1-only token grammar, cross-tenant/user/thread event/message
  collisions, exact payload digest, freshness and four rate buckets. Assert no `channelUserId` or
  inbound `userId` reaches conversation.
- [ ] **Step 2: Run `pnpm exec vitest run apps/api/src/client-conversation-inbound.test.ts apps/api/src/routes/selarti-webhook.test.ts tests/repo/runtime-fixture-boundary.test.ts packages/config/src/env.test.ts` and confirm RED.**
- [ ] **Step 3: Implement raw occurrence extraction from `request.raw.rawHeaders`, exact parser/
  digest, fixed state matrix and API-local preflight.** Route exposure and each tool freeze require
  compatible `dispatch_v1` and `cleanup_v1` DB-time leases for the same exact build SHA; new or
  pre-completion DB/lease failure is 503 with Retry-After 1. Post-freeze state is always no-store
  202; changed digest is 409. Prove API startup alone never claims worker presence.
- [ ] **Step 4: Rerun the focused command until GREEN.**
- [ ] **Step 5: Commit.**

```powershell
git add apps/api/src packages/config/src .env.example tests/repo/runtime-fixture-boundary.test.ts
git commit -m "fix: authenticate ordered conversation ingress"
```

### Task 4: Atomically freeze one typed operation with accounting

**Files:**

- Modify: `packages/application/src/ports.ts`, `packages/application/src/conversation-service.ts`,
  `packages/application/src/conversation-service.test.ts`
- Modify: `packages/db/src/repositories/message-repository.ts`,
  `packages/db/src/repositories/message-repository.test.ts`
- Create: `packages/application/src/client-conversation-operation-crypto.ts`
- Test: `tests/integration/client-conversation-freeze.test.ts`

**Exact tools:**

```ts
type ClientConversationToolProposal =
  | { kind: "show_catalog"; serviceCode?: string; language?: string }
  | { kind: "start_booking"; choiceHandle: `ch1.${string}` };
```

- [ ] **Step 1: Write RED tests.** Reject `expertId`, user/internal/provider/financial/URL/
  idempotency fields and mixed keys. Cover same/different payload, ten concurrent deliveries with
  different deterministic proposals, nondeterministic second inference, encryption failure and
  crashes before/after completion commit. Cover AES-256-GCM v1 vectors, CSPRNG 96-bit nonce
  collision, exact AAD/plaintext framing, row/metadata/ciphertext/tag swaps, normalized decrypt
  failure, active/decrypt-only/retired/compromised keys and 24h+6m rotation. Assert one ledger/
  audit/operation and zero tool calls.
- [ ] **Step 2: Run `pnpm exec vitest run packages/application/src/conversation-service.test.ts tests/integration/client-conversation-freeze.test.ts` and confirm RED.**
- [ ] **Step 3: Extend `completeInbound` so its existing serializable message/inbox row lock writes
  the exact proposal digest, AES-256-GCM v1 envelope, 24h expiry and accounting together.** Use the
  injected key-provider boundary, unique `(key_id,nonce)`, exact AAD and key lifecycle in contract
  5.1; wipe explicit plaintext buffers in `finally`. Tool outcomes do not create integration-outbox
  rows. Stored completion reads the operation row.
- [ ] **Step 4: Rerun the focused command until GREEN.**
- [ ] **Step 5: Commit.**

```powershell
git add packages/application/src packages/db/src/repositories tests/integration/client-conversation-freeze.test.ts
git commit -m "feat: freeze conversation tools before mutation"
```

### Task 5: Dispatch through a dedicated fenced non-outbox job

**Files:**

- Create: `packages/db/src/repositories/client-conversation-operation-repository.ts`,
  `packages/db/src/repositories/client-conversation-operation-repository.test.ts`
- Create: `apps/worker/src/client-conversation-operations.ts`,
  `apps/worker/src/client-conversation-operations.test.ts`
- Modify: `apps/worker/src/main.ts`, `apps/worker/src/runtime.ts`
- Modify: `packages/application/src/client-catalog-service.ts`, protected booking service/ports,
  and their PostgreSQL repositories/tests
- Modify: grant revocation, user-deactivation and privacy-erasure repositories/tests
- Modify: `packages/contracts/src/worker-outbox.test.ts`
- Test: `tests/integration/client-conversation-operation-races.test.ts`

**Gateways:**

```ts
export interface ConversationCatalogGateway {
  request(claim: ClaimedConversationOperation): Promise<
    | { kind: "applied"; downstreamReceiptDigest: string }
    | { kind: "rejected"; code: "not_found" | "conflict" | "feature_disabled" }
  >;
}
export interface ConversationBookingGateway {
  reserve(claim: ClaimedConversationOperation): Promise<
    | { kind: "applied"; downstreamReceiptDigest: string }
    | { kind: "rejected"; code: "not_found" | "conflict" | "feature_disabled" }
  >;
}
```

- [ ] **Step 1: Write RED job/race tests.** Cover claim/lease/fence, expired claim, wrong grant,
  runtime claim forgeries, decrypt/digest mismatch, after-commit exception, unknown reconciliation
  by exact replay, five-attempt dead letter, crash after receipt, and both commit orders for revoke,
  user deactivation and mapping erasure immediately before/during catalog or booking commit. Assert
  the lifecycle winner rule, one operator case, one deletion receipt, ciphertext clear, fenced
  `privacy_expired` at 24h, stale-owner rejection, bounded transaction timeouts, and zero provider/
  outbox-registry attempts.
- [ ] **Step 2: Run `pnpm exec vitest run apps/worker/src/client-conversation-operations.test.ts tests/integration/client-conversation-operation-races.test.ts packages/contracts/src/worker-outbox.test.ts` and confirm RED.**
- [ ] **Step 3: Implement the bounded job and transaction seam.** Mint only a genuine private
  operation claim. Refactor/reuse a repository-owned prelock helper—never reconstruct it—whose
  current exact expressions are catalog `hashtextextended(userId || ':' || requestDigest,0)` and
  booking `hashtextextended('choice:' || choiceDigest,0)`. Ordinary and conversation entries call
  the same helper in the same transaction, then lock `users -> mapping -> exact
  grant -> operation`, recheck all facts, and take remaining existing downstream locks. Lifecycle
  paths start at `users` and never acquire a tool prelock afterward; missing ancestors are skipped,
  never locked after operation. Never convert to `ClientPrincipal`; use a 2-second pre-call lock
  timeout. Write under claim fence; post-call exception is unknown and
  reconciliation replays only the frozen idempotent call. Run worker-local preflight, then publish
  DB-time 30-second `dispatch_v1`/`cleanup_v1` leases every 10 seconds for exact contract/build.
- [ ] **Step 4: Implement expiry terminalization.** Cap all leases and DB statement/lock/idle
  deadlines at payload expiry; require 30 seconds remaining before dispatch. Cleanup steals only an
  expired lease, increments the fence, invalidates both claim tuples, writes `privacy_expired`/
  `payload_expired`, clears every crypto field, and inserts unique sanitized operator/deletion rows
  in one transaction. Legal hold cannot retain ciphertext.
- [ ] **Step 5: Rerun focused/property/concurrency diagnostics until stable GREEN.** No Claw/PG
  release invocation occurs here. Include deadlock probes mixing ordinary catalog/protected-booking,
  catalog choice cleanup, conversation and lifecycle calls at every advisory/row seam without
  changing lock-key bytes. A blocking test must prove ordinary and conversation paths contend on
  the identical PostgreSQL advisory key.
- [ ] **Step 6: Commit.**

```powershell
git add packages/db/src/repositories apps/worker/src packages/contracts/src tests/integration/client-conversation-operation-races.test.ts
git commit -m "feat: run fenced client conversation operations"
```

### Task 6: Privacy, mandatory AI evidence, review, and one release invocation

**Files:**

- Modify: `packages/db/src/repositories/privacy-repository.ts`,
  `packages/db/src/repositories/privacy-repository.test.ts`
- Modify: `packages/observability/src/logger.ts`, `packages/observability/src/logger.test.ts`
- Create: `tests/integration/client-conversation-privacy.test.ts`
- Create: `docs/test-evidence/ai/client-conversation-tool-schema/verification.md`
- Modify: `scripts/run-claw-ci.sh`, `tests/repo/workflow-semantics.test.ts`
- Create: `scripts/assert-client-conversation-postgres.mjs`
- Modify: `docs/spec/mvp-client-conversation-001-progress.md`,
  `docs/spec/mvp-client-conversation-001-traceability.md`,
  `docs/runbooks/client-conversation-activation.md`

- [ ] **Step 1: Write/run focused privacy tests until GREEN.** Prove mapping deletion cascades
  grants and nulls operation binding after winning the shared lock order; if a mutation wins it
  commits first. Prove expiry increments the fence, terminalizes `privacy_expired`, clears every
  crypto field and writes exactly one sanitized case/receipt; exports/logs/traces/metrics/errors
  omit every sentinel. Record broader anonymization/backup receipt as live blockers.
- [ ] **Step 2: Record mandatory AI artifacts.** Run real-incident old/new schema regressions and
  distribution diff against prior release; obtain named Product/Safety/Security spot-check. Until
  all exist, keep implementation status blocked and permit deterministic fixtures only.
- [ ] **Step 3: Add but do not run immutable `client-conversation` gate mode.** One fixed process
  asserts clean SHA, `server_version_num=170005`, schema parity, counts, forbidden sentinels,
  exact outbox topic set, zero providers, cleanup and invocation identity; it accepts no mutable
  manifest and prints no DB URL/credential.
- [ ] **Step 4: Obtain independent adversarial closure review.** Close every Critical/Important
  finding and commit the reviewed clean implementation. Record exact SHA and invocation identity.
- [ ] **Step 5: Run one total release-evidence command:**

Run: `bash scripts/run-claw-ci.sh client-conversation`

Expected: one fixed process; PG 17.5; exact reviewed SHA/identity; zero forbidden/provider counts;
cleanup complete; exit 0. Pass ends the gate. Failure is preserved and blocks this story. A
successor requires new SHA, delta review, new identity and explicit authorization.
- [ ] **Step 6: Commit sanitized evidence locally only; do not push, merge, run Actions, deploy,
  activate, mutate production/Claw, or sync Obsidian without a separate explicit command.**

## Self-Review Record

- Spec coverage: Tasks 1–6 cover CCV-001–019 and AC-01–12.
- Placeholder scan: the migration prefix and future exact SHA are intentionally obtained by
  executable guards; no numeric prefix or release result is invented.
- Type consistency: conversation identity and the runtime-authenticated operation claim are
  distinct; grants are rechecked under mutation-transaction locks; the job never enters registry.
- Review reconciliation: draft C-1–C-5/I-1–I-9 and closure C-1/C-2/I-1–I-4 are routed to the
  runtime-claim, locking, header, digest, AEAD, expiry, lease, DDL, privacy, AI and gate tasks above.
