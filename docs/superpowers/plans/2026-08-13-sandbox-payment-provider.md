# Sandbox Payment Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a durable sandbox-only expert residency payment provider that creates fictitious checkouts and drives approved `settled`/`refunded` events through the existing financial pipelines without entering the production image.

**Architecture:** Add a private `@ii-tonya/sandbox-payments` package for sandbox schema, migrations, persistence, event branding, and adapter behavior, plus a separate `@ii-tonya/sandbox-api` application for checkout composition and approved management routes. The production API has no dependency edge to either package. Sandbox events use `ii_tonya_sandbox` and enter the existing `PostgresExpertResidencyProviderInboxRepository`; they never write financial tables directly.

**Tech Stack:** Node.js 24, TypeScript 5.9, pnpm 11.9.0, Fastify 5, Zod, Drizzle ORM, PostgreSQL 17.5, Vitest 3.2, Docker Compose, Claw self-hosted runner.

## Global Constraints

- Use exact source base `120368d5b3b439df44d16525f59f4d008b4cffff` or rebase and re-verify if `origin/main` moves.
- All executable tests run in the constrained Claw test profile: 1 CPU, 1 GiB RAM. Do not use the host production database.
- Never run `pnpm test:repeat` above three. Run production-like container smoke once.
- `II_TONYA_RUNTIME_MODE` must equal `sandbox`; no environment flag may activate sandbox code in the production API.
- No live provider SDK, network call, credential, invented secret, or real provider environment variable is allowed.
- Sandbox relations use the `sandbox_expert_residency_*` namespace and a separately validated database marker.
- Provider identity is exactly `ii_tonya_sandbox`; the production verifier rejects it.
- Production `apps/api` and its image must not depend on or contain `@ii-tonya/sandbox-payments` or `@ii-tonya/sandbox-api`.
- Admin transitions use existing approval semantics: distinct approver, exact payload/session binding, expiry, one-time consumption, and immutable audit provenance.
- Sandbox code never writes normal residency, reward, balance, allocation, or ledger tables. Only the existing settlement/reversal repository may do so.
- Requirements and acceptance criteria are defined in `docs/superpowers/specs/2026-08-13-sandbox-payment-provider-design.md`.

---

## File map

- `packages/sandbox-payments/src/contracts.ts`: canonical sandbox command/result types and Zod schemas.
- `packages/sandbox-payments/src/schema.ts`: Drizzle declarations for the marker, payments, commands, and events.
- `packages/sandbox-payments/src/repository.ts`: PostgreSQL checkout idempotency, transitions, event claim/ack, and replay.
- `packages/sandbox-payments/src/verifier.ts`: private sandbox event brand and conversion to the existing verified-event boundary.
- `packages/sandbox-payments/src/adapter.ts`: `ExpertResidencyPaymentPort` implementation.
- `packages/sandbox-payments/src/workflow.ts`: exact approval consumption plus atomic sandbox transition.
- `packages/sandbox-payments/migrations/0000_sandbox_expert_residency.sql`: sandbox-only migration and marker.
- `apps/sandbox-api/src/routes.ts`: authenticated sandbox checkout view and admin management routes.
- `apps/sandbox-api/src/server.ts`: sandbox-only composition and startup guards.
- `apps/sandbox-api/package.json`: separate build/dependency graph.
- `Dockerfile.sandbox`: sandbox-only image; the existing `Dockerfile` remains sandbox-free.
- `compose.sandbox.yaml`: test/staging sandbox service only; not included by production Compose.
- `tests/repo/sandbox-production-isolation.test.ts`: import, manifest, image, scope, and no-network guards.
- `tests/e2e/sandbox-payment-provider.test.ts`: real-PostgreSQL settlement/refund lifecycle.

### Task 1: Define sandbox contracts and database boundary

**Requirements:** SBX-RUN-004, SBX-DATA-001, SBX-DATA-002, SBX-DATA-003, SBX-DATA-004, SBX-DATA-005, SBX-DATA-006, SBX-DATA-007, SBX-TST-001, SBX-TST-002, SBX-TST-003.

**Files:**

- Create: `packages/sandbox-payments/package.json`
- Create: `packages/sandbox-payments/tsconfig.json`
- Create: `packages/sandbox-payments/src/contracts.ts`
- Create: `packages/sandbox-payments/src/schema.ts`
- Create: `packages/sandbox-payments/src/repository.ts`
- Create: `packages/sandbox-payments/src/repository.test.ts`
- Create: `packages/sandbox-payments/src/index.ts`
- Create: `packages/sandbox-payments/migrations/0000_sandbox_expert_residency.sql`
- Modify: `pnpm-workspace.yaml`
- Modify: `tests/repo/support/payment-scope-boundary-core.ts`

**Interfaces:**

- Consumes: `DrizzleDb` from `@ii-tonya/db`; canonical money/order fields from `@ii-tonya/contracts`.
- Produces:

```ts
export type SandboxPaymentState = "created" | "settled" | "refunded";
export interface CreateSandboxCheckoutCommand {
  orderId: string;
  amountMinor: string;
  currency: "RUB";
  idempotencyKey: string;
}
export interface SandboxCheckout {
  kind: "created";
  paymentId: string;
  checkoutUrl: string;
  state: SandboxPaymentState;
  version: number;
}
export interface TransitionSandboxPaymentCommand {
  paymentId: string;
  transition: "settled" | "refunded";
  expectedVersion: number;
  idempotencyKey: string;
  correlationId: string;
}
export class SandboxPaymentConflictError extends Error {
  readonly code = "SANDBOX_PAYMENT_CONFLICT";
}
export class PostgresSandboxPaymentRepository {
  constructor(db: DrizzleDb, checkoutBaseUrl: URL);
  assertSandboxDatabase(): Promise<void>;
  createCheckout(
    command: CreateSandboxCheckoutCommand,
  ): Promise<SandboxCheckout>;
  transition(
    command: TransitionSandboxPaymentCommand,
  ): Promise<SandboxProviderEvent>;
  nextPendingEvent(paymentId: string): Promise<SandboxProviderEvent | null>;
  markEventProcessed(eventId: string): Promise<void>;
}
export function migrateSandboxDatabase(db: DrizzleDb): Promise<void>;
```

- [ ] **Step 1: Write failing schema and repository tests**

Create tests that assert: a missing marker rejects startup; checkout writes one payment and one command; identical replay returns the stored result; mismatched replay throws `SandboxPaymentConflictError`; `created -> settled -> refunded` appends one event per transition; invalid and stale-version transitions roll back; concurrent same-key checkout produces one payment.

```ts
it("returns the original checkout for an identical idempotent replay", async () => {
  const first = await repository.createCheckout(checkoutCommand);
  const replay = await repository.createCheckout(checkoutCommand);
  expect(replay).toEqual(first);
  expect(await countRows(db, "sandbox_expert_residency_payments")).toBe(1);
});

it("rejects a conflicting idempotency replay", async () => {
  await repository.createCheckout(checkoutCommand);
  await expect(
    repository.createCheckout({ ...checkoutCommand, amountMinor: "2" }),
  ).rejects.toBeInstanceOf(SandboxPaymentConflictError);
});
```

- [ ] **Step 2: Run the RED test on Claw**

Run inside `ii-tonya-test` with the exact mounted source SHA:

```bash
pnpm exec vitest run packages/sandbox-payments/src/repository.test.ts --maxWorkers=1
```

Expected: FAIL because the package, migration, and repository do not exist. Record the exact failure and cleanup count; do not treat module-resolution failure as GREEN evidence.

- [ ] **Step 3: Add the sandbox-only migration and schema**

The migration must create exactly these relations and constraints:

```sql
create table sandbox_expert_residency_environment (
  singleton boolean primary key default true check (singleton),
  marker text not null check (marker = 'ii_tonya_sandbox_v1')
);
create table sandbox_expert_residency_payments (
  payment_id text primary key check (payment_id ~ '^sandbox_payment_[A-Za-z0-9_-]{22,128}$'),
  order_id uuid not null unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency = 'RUB'),
  checkout_url text not null,
  state text not null check (state in ('created','settled','refunded')),
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp()
);
```

Add command and event tables with unique `(command_kind,idempotency_key)`, SHA-256 payload digest checks, unique event IDs, append-only triggers, and FKs to `payment_id`. Seed only the constant marker; no credential or real account identifier.

- [ ] **Step 4: Implement canonical contracts and repository transactions**

Use strict Zod schemas, SHA-256 of canonical JSON, `withSerializableRetry`, `FOR UPDATE`, and database `transaction_timestamp()`. Generate opaque IDs with `randomBytes(24).toString("base64url")`. Never interpolate SQL identifiers or client values.

- [ ] **Step 5: Run focused GREEN and three concurrency repetitions on Claw**

```bash
pnpm exec vitest run packages/sandbox-payments/src/repository.test.ts --maxWorkers=1
pnpm test:repeat -- 3 packages/sandbox-payments/src/repository.test.ts
```

Expected: all cases PASS on real PostgreSQL; cleanup reports zero test containers.

- [ ] **Step 6: Update the exact scope allowlist and commit**

Add only reviewed sandbox paths/relations/dependencies to the recursive payment-scope guard. Pin migration and package-manifest hashes after final content.

```bash
git add pnpm-workspace.yaml packages/sandbox-payments tests/repo/support/payment-scope-boundary-core.ts
git commit -m "feat: add sandbox payment persistence"
```

### Task 2: Add sandbox verifier, adapter, and durable reconciliation

**Requirements:** SBX-PAY-001, SBX-PAY-002, SBX-PAY-003, SBX-PAY-004, SBX-PAY-005, SBX-PAY-006, SBX-EVT-001, SBX-EVT-002, SBX-EVT-004, SBX-EVT-005, SBX-TST-006.

**Files:**

- Create: `packages/sandbox-payments/src/verifier.ts`
- Create: `packages/sandbox-payments/src/verifier.test.ts`
- Create: `packages/sandbox-payments/src/adapter.ts`
- Create: `packages/sandbox-payments/src/adapter.test.ts`
- Modify: `packages/sandbox-payments/src/index.ts`
- Modify: `packages/sandbox-payments/src/repository.ts`
- Modify: `packages/sandbox-payments/src/repository.test.ts`
- Modify: `packages/integrations/src/expert-residency/verified-event.ts`
- Test: `packages/integrations/src/expert-residency/verified-event.test.ts`

**Interfaces:**

- Consumes: `ExpertResidencyPaymentPort`, `VerifiedExpertResidencyPaymentEvent`, `assertVerifiedExpertResidencyPaymentEvent`, and Task 1 repository.
- Produces:

```ts
export const SANDBOX_PROVIDER = "ii_tonya_sandbox" as const;
export interface SandboxEventVerifier {
  verify(event: SandboxProviderEvent): VerifiedExpertResidencyPaymentEvent;
}
export interface CanonicalExpertResidencyPaymentEventVerifier {
  verifyCanonical(
    event: ExpertResidencyPaymentEvent,
    evidence: ExpertResidencyVerificationEvidence,
  ): VerifiedExpertResidencyPaymentEvent;
}
export function createCanonicalExpertResidencyPaymentEventVerifier(): CanonicalExpertResidencyPaymentEventVerifier;
export class SandboxExpertResidencyPaymentAdapter implements ExpertResidencyPaymentPort {
  createCheckout(
    command: ExpertResidencyCheckoutCommand,
  ): Promise<ExpertResidencyCheckoutOutcome>;
  reconcile(
    paymentId: string,
  ): Promise<VerifiedExpertResidencyPaymentEvent | null>;
}
```

- [ ] **Step 1: Write RED tests for branding, checkout, and reconcile**

```ts
it("brands only a repository-owned sandbox event", async () => {
  const event = await repository.transition(settleCommand);
  const verified = verifier.verify(event);
  expect(verified.provider).toBe("ii_tonya_sandbox");
  expect(() =>
    assertVerifiedExpertResidencyPaymentEvent(verified),
  ).not.toThrow();
});

it("never performs a network call", async () => {
  const forbiddenFetch = vi.fn(() => {
    throw new Error("network_forbidden");
  });
  vi.stubGlobal("fetch", forbiddenFetch);
  await adapter.createCheckout(checkoutCommand);
  await adapter.reconcile("sandbox_payment_validopaqueidentifier");
  expect(forbiddenFetch).not.toHaveBeenCalled();
});
```

Also prove the disabled production verifier returns `{kind:"rejected"}` for serialized sandbox input and that forged plain objects fail `assertVerifiedExpertResidencyPaymentEvent`.

- [ ] **Step 2: Run RED on Claw**

```bash
pnpm exec vitest run packages/sandbox-payments/src/verifier.test.ts packages/sandbox-payments/src/adapter.test.ts packages/integrations/src/expert-residency/verified-event.test.ts --maxWorkers=1
```

Expected: sandbox imports are missing while existing production-verifier tests remain green.

- [ ] **Step 3: Implement a provider-neutral canonical verifier factory**

Keep `brand()` private in `@ii-tonya/integrations`. Export a provider-neutral factory whose returned object validates a canonical provider event and bounded verification evidence before delegating to the private brand. It must not mention sandbox, accept raw unchecked HTTP input, read credentials, or make network calls. The sandbox package receives this verifier explicitly at composition and accepts only frozen event objects returned by its repository in the same process. Verification ID and key version are bounded constants derived from the durable event ID; no secret is used. The production runtime must not instantiate the factory.

- [ ] **Step 4: Implement adapter checkout and reconcile**

Checkout delegates to Task 1 and returns only `{kind,paymentId,checkoutUrl}`. Reconcile returns the next durable verified event or `null`; it does not mark the event processed until the settlement/reversal call succeeds.

- [ ] **Step 5: Run focused GREEN and commit**

```bash
pnpm exec vitest run packages/sandbox-payments/src/verifier.test.ts packages/sandbox-payments/src/adapter.test.ts packages/integrations/src/expert-residency/verified-event.test.ts --maxWorkers=1
git add packages/sandbox-payments packages/integrations/src/expert-residency/verified-event.ts packages/integrations/src/expert-residency/verified-event.test.ts
git commit -m "feat: add sandbox payment adapter"
```

### Task 3: Add exact approved admin transitions

**Requirements:** SBX-ADM-001, SBX-ADM-002, SBX-ADM-003, SBX-ADM-004, SBX-ADM-005, SBX-DATA-006, SBX-TST-003, SBX-TST-004.

**Files:**

- Create: `packages/sandbox-payments/src/workflow.ts`
- Create: `packages/sandbox-payments/src/workflow.test.ts`
- Modify: `packages/db/src/repositories/admin-approval-repository.ts`
- Modify: `packages/db/src/repositories/admin-approval-repository.test.ts`
- Modify: `packages/sandbox-payments/src/repository.ts`
- Modify: `tests/repo/admin-workflow-guards.test.ts`
- Modify: `tests/repo/support/payment-scope-boundary-core.ts`

**Interfaces:**

- Consumes: `PostgresAdminApprovalRepository.consumeApproval`, Task 1 transition transaction, authenticated `AdminPrincipal` session hash.
- Produces:

```ts
export const sandboxAdminActions = [
  "expert_residency.sandbox_settle",
  "expert_residency.sandbox_refund",
] as const;
export interface SandboxTransitionWorkflowCommand {
  action: (typeof sandboxAdminActions)[number];
  paymentId: string;
  approvalId: string;
  nonce: string;
  sessionIdHash: string;
  expectedVersion: number;
  idempotencyKey: string;
  correlationId: string;
}
export type SandboxTransitionWorkflowResult =
  | { allowed: true; replayed: boolean; event: SandboxProviderEvent }
  | { allowed: false; reasonCode: "approval_denied" };
export class SandboxTransitionWorkflow {
  constructor(
    db: DrizzleDb,
    approvals: PostgresAdminApprovalRepository,
    payments: PostgresSandboxPaymentRepository,
  );
  execute(
    command: SandboxTransitionWorkflowCommand,
  ): Promise<SandboxTransitionWorkflowResult>;
}
```

- [ ] **Step 1: Write RED tests for action roles and exact binding**

Add the two actions to the approval type test first and assert the required role is `entitlement_admin`. Test distinct approver, self-approval denial, expired/reused approval, wrong payment ID/version/transition/idempotency key/session, identical consumed replay, and concurrent consumption.

```ts
expect(requiredApprovalRole("expert_residency.sandbox_settle")).toBe(
  "entitlement_admin",
);
await expect(
  workflow.execute({ ...command, expectedVersion: 99 }),
).resolves.toEqual({
  allowed: false,
  reasonCode: "approval_denied",
});
```

- [ ] **Step 2: Run RED on Claw**

```bash
pnpm exec vitest run packages/sandbox-payments/src/workflow.test.ts packages/db/src/repositories/admin-approval-repository.test.ts tests/repo/admin-workflow-guards.test.ts --maxWorkers=1
```

Expected: missing action/workflow assertions fail; existing admin cases remain green.

- [ ] **Step 3: Extend the closed approval-action union**

Add only the two sandbox actions to `ApprovalAdminAction` and the role map. Their object type is exactly `sandbox_expert_residency_payment`. Canonical payload is exactly:

```ts
{
  paymentId,
  transition: action === "expert_residency.sandbox_settle" ? "settled" : "refunded",
  expectedVersion,
  idempotencyKey,
}
```

- [ ] **Step 4: Implement workflow with one transaction boundary**

Expose a repository method that receives the transaction handle, consumes the exact approval, or validates an identical consumed replay, then applies the locked transition and writes the event/audit atomically. Never consume approval before entering the transition transaction.

- [ ] **Step 5: Run GREEN, repeat concurrency three times, and commit**

```bash
pnpm exec vitest run packages/sandbox-payments/src/workflow.test.ts packages/db/src/repositories/admin-approval-repository.test.ts tests/repo/admin-workflow-guards.test.ts --maxWorkers=1
pnpm test:repeat -- 3 packages/sandbox-payments/src/workflow.test.ts
git add packages/sandbox-payments packages/db/src/repositories/admin-approval-repository* tests/repo
git commit -m "feat: require approval for sandbox transitions"
```

### Task 4: Build the separate sandbox API runtime

**Requirements:** SBX-RUN-001, SBX-RUN-002, SBX-RUN-003, SBX-RUN-004, SBX-RUN-005, SBX-ADM-001, SBX-ADM-005, SBX-PAY-002, SBX-PAY-006, SBX-TST-004, SBX-TST-007.

**Files:**

- Create: `apps/sandbox-api/package.json`
- Create: `apps/sandbox-api/tsconfig.json`
- Create: `apps/sandbox-api/src/routes.ts`
- Create: `apps/sandbox-api/src/routes.test.ts`
- Create: `apps/sandbox-api/src/server.ts`
- Create: `apps/sandbox-api/src/server.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `tests/repo/sandbox-production-isolation.test.ts`
- Modify: `tests/repo/support/payment-scope-boundary-core.ts`

**Interfaces:**

- Consumes: `buildApp` and public API dependencies from `@ii-tonya/api`; Task 2 adapter; Task 3 workflow; existing admin principal resolution.
- Produces:

```ts
export interface SandboxRuntimeDependencies {
  paymentAdapter: SandboxExpertResidencyPaymentAdapter;
  transitionWorkflow: SandboxTransitionWorkflow;
  approvals: Pick<
    PostgresAdminApprovalRepository,
    "resolvePrincipal" | "requestApproval" | "approveApproval"
  >;
}
export function assertSandboxRuntimeEnvironment(env: NodeJS.ProcessEnv): void;
export async function buildSandboxServer(
  deps: SandboxRuntimeDependencies,
): Promise<FastifyInstance>;
```

- [ ] **Step 1: Write RED server and route tests**

Assert startup rejects missing/wrong mode, any enabled live integration, payment credential key presence, and absent DB marker. Assert production `buildApp` has no sandbox route. Assert sandbox routes require strict Bearer admin auth, use 8 KiB body limits, reject extra properties, sanitize faults, and never settle from the checkout URL.

Management endpoints are fixed:

```text
GET  /sandbox/v1/payments/:paymentId
POST /sandbox/v1/admin/approvals/:action/:paymentId/request
POST /sandbox/v1/admin/approvals/:approvalId/approve
POST /sandbox/v1/admin/payments/:paymentId/transitions/:transition
```

- [ ] **Step 2: Run RED on Claw**

```bash
pnpm exec vitest run apps/sandbox-api/src/server.test.ts apps/sandbox-api/src/routes.test.ts tests/repo/sandbox-production-isolation.test.ts --maxWorkers=1
```

Expected: package/routes are missing and isolation assertions fail for the intended reason.

- [ ] **Step 3: Implement strict runtime guards**

Accept only `II_TONYA_RUNTIME_MODE=sandbox`. Reject any true live integration config and any present environment key matching `PAYMENTS?_(API_KEY|TOKEN|SECRET|WEBHOOK_SECRET|BASE_URL|PROVIDER)`. Validate the PostgreSQL marker before building Fastify. Do not add sandbox imports to `apps/api`.

- [ ] **Step 4: Implement bounded authenticated routes**

Reuse the existing admin Bearer parser/session hashing semantics. Validate UUIDs, opaque keys, exact schemas, and expected version. Route handlers call only the approval port or Task 3 workflow. Map `SandboxPaymentConflictError` to `409`, unavailable state to `503`, and unexpected faults to sanitized `500 internal_error`.

- [ ] **Step 5: Build both packages and run GREEN**

```bash
pnpm --filter @ii-tonya/sandbox-payments build
pnpm --filter @ii-tonya/sandbox-api build
pnpm exec vitest run apps/sandbox-api/src/server.test.ts apps/sandbox-api/src/routes.test.ts tests/repo/sandbox-production-isolation.test.ts --maxWorkers=1
```

Expected: build exits 0; all focused tests pass; `apps/api/package.json` contains no sandbox dependency.

- [ ] **Step 6: Commit**

```bash
git add apps/sandbox-api pnpm-workspace.yaml pnpm-lock.yaml tests/repo/sandbox-production-isolation.test.ts tests/repo/support/payment-scope-boundary-core.ts
git commit -m "feat: add isolated sandbox payment API"
```

### Task 5: Prove settlement and refund end to end

**Requirements:** SBX-EVT-003, SBX-EVT-004, SBX-TST-005, SBX-TST-006, SBX-TST-009.

**Files:**

- Create: `tests/e2e/sandbox-payment-provider.test.ts`
- Create: `tests/integration/sandbox-payment-reconciliation.test.ts`
- Modify: `packages/sandbox-payments/src/adapter.ts`
- Modify: `packages/sandbox-payments/src/repository.ts`
- Modify: `apps/sandbox-api/src/server.ts`

**Interfaces:**

- Consumes: existing `PostgresExpertResidencyProviderInboxRepository.settle(event)` and `.reverse(event)`; Task 2 reconcile; Task 3 approved transitions.
- Produces: a bounded delivery function:

```ts
export async function deliverSandboxPaymentEvent(input: {
  paymentId: string;
  adapter: SandboxExpertResidencyPaymentAdapter;
  inbox: PostgresExpertResidencyProviderInboxRepository;
  acknowledge(eventId: string): Promise<void>;
}): Promise<"none" | "settled" | "refunded">;
```

- [ ] **Step 1: Write the failing end-to-end tests**

Use the real PostgreSQL testkit to create experts, referral, tariff, order, and reserved credit. Create sandbox checkout, approve settlement with a distinct admin, deliver it, and assert the existing order, residency interval, payment attempt, first-settlement marker, reward grant, ledger, audit, and outbox facts. Then approve full refund, deliver it, and assert existing reversal/debt behavior. Assert sandbox tables contain only provider-side facts.

- [ ] **Step 2: Write RED reconciliation cases**

Inject a failure after the durable sandbox event but before acknowledge. Assert the event remains pending, retry returns the same event ID/digest, the existing inbox replays the committed result, and acknowledge occurs only after success.

- [ ] **Step 3: Run RED on Claw**

```bash
pnpm exec vitest run tests/e2e/sandbox-payment-provider.test.ts tests/integration/sandbox-payment-reconciliation.test.ts --maxWorkers=1
```

Expected: delivery composition is missing; existing settlement repository tests remain unchanged.

- [ ] **Step 4: Implement minimal bounded delivery**

Call `adapter.reconcile(paymentId)`. For `settled`, call `inbox.settle(event)`; for `refunded`, call `inbox.reverse(event)`. Mark the sandbox event processed only after the call resolves. Propagate failures without creating new event/payment identities.

- [ ] **Step 5: Run GREEN and three reconciliation repetitions**

```bash
pnpm exec vitest run tests/e2e/sandbox-payment-provider.test.ts tests/integration/sandbox-payment-reconciliation.test.ts --maxWorkers=1
pnpm test:repeat -- 3 tests/integration/sandbox-payment-reconciliation.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/sandbox-payments apps/sandbox-api tests/e2e/sandbox-payment-provider.test.ts tests/integration/sandbox-payment-reconciliation.test.ts
git commit -m "feat: deliver sandbox settlement lifecycle"
```

### Task 6: Add sandbox container and production-image isolation

**Requirements:** SBX-RUN-001, SBX-RUN-003, SBX-RUN-004, SBX-RUN-005, SBX-TST-006, SBX-TST-007, SBX-TST-008, SBX-TST-009.

**Files:**

- Create: `Dockerfile.sandbox`
- Create: `compose.sandbox.yaml`
- Create: `scripts/run-sandbox-container-smoke.sh`
- Create: `tests/container/sandbox-image-smoke.test.mjs`
- Modify: `tests/container/image-smoke.test.mjs`
- Modify: `.dockerignore`
- Modify: `tests/repo/release-assets.test.ts`
- Modify: `tests/repo/sandbox-production-isolation.test.ts`
- Modify: `tests/repo/support/payment-scope-boundary-core.ts`

**Interfaces:**

- Consumes: packaged `@ii-tonya/sandbox-api` and sandbox migrations.
- Produces: read-only, non-root sandbox image and an explicit opt-in Compose file not referenced by production deployment.

- [ ] **Step 1: Write RED image and Compose assertions**

Assert `Dockerfile.sandbox` has a dedicated target, runs non-root/read-only, and starts only `@ii-tonya/sandbox-api`. Assert existing `Dockerfile` and production image/package closure contain neither sandbox workspace package. Assert `compose.yaml` has no sandbox service and `compose.sandbox.yaml` requires sandbox marker/mode while provider credential variables are present only as empty values.

- [ ] **Step 2: Run RED on Claw**

```bash
pnpm exec vitest run tests/repo/release-assets.test.ts tests/repo/sandbox-production-isolation.test.ts --maxWorkers=1
node --test tests/container/sandbox-image-smoke.test.mjs tests/container/image-smoke.test.mjs
```

Expected: missing sandbox artifacts fail; the existing production smoke remains green.

- [ ] **Step 3: Implement the sandbox image and opt-in Compose contract**

Use multi-stage build, frozen install, explicit sandbox package deploy, non-root UID/GID, read-only root, tmpfs `/tmp`, dropped capabilities, and no Docker socket. The sandbox Compose file must require `SANDBOX_DATABASE_URL` from the test harness and must not join production provider networks.

- [ ] **Step 4: Implement one sandbox-container smoke**

The smoke creates an isolated test database, applies sandbox plus normal test migrations, starts the sandbox container, creates a checkout, performs approved settlement/refund through test fixtures, checks sanitized health/runtime mode, and tears down all resources. It never repeats production-like smoke.

- [ ] **Step 5: Run both packaged-image smokes once on Claw**

```bash
bash scripts/run-sandbox-container-smoke.sh
pnpm test:container
```

Expected: sandbox lifecycle PASS; production image returns 404 for all `/sandbox/*` routes and contains no sandbox package; cleanup reports zero test containers.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile.sandbox compose.sandbox.yaml scripts/run-sandbox-container-smoke.sh tests/container tests/repo .dockerignore
git commit -m "test: add sandbox container gate"
```

### Task 7: Documentation, traceability, final Claw gate, and review

**Requirements:** SBX-TST-010 and every acceptance criterion in the design spec.

**Files:**

- Create: `docs/runbooks/sandbox-payment-provider.md`
- Create: `docs/test-evidence/claw/sandbox-payment-provider-20260813/verification.md`
- Create: `.github/pr-body-sandbox-payment-provider.md`
- Modify: `README.md`
- Modify: `docs/spec/expert-residency-referrals-traceability.md`
- Modify: `docs/handoffs/2026-08-11-expert-residency-referrals-full.md`
- Modify: `docs/runbooks/go-live-evidence.md`
- Modify: `docs/runbooks/provider-staging-evidence.md`
- Modify: `docs/architecture/project-connectivity-graph.md`
- Modify: `docs/architecture/project-connectivity-inventory.md`
- Modify: `scripts/run-claw-actions-job.sh`
- Modify: `.github/workflows/db-gate.yml`

**Interfaces:**

- Consumes: exact final source SHA and evidence from Tasks 1-6.
- Produces: SBX requirement-to-code/test/evidence mapping, safe startup/cleanup runbook, and mandatory CI registration.

- [ ] **Step 1: Write RED traceability/release-readiness assertions**

Extend repository tests so every `SBX-*` ID maps to code, focused test, Claw evidence, rollback, and owner. Assert provider staging remains `BLOCKED` and production remains `NO-GO`. Assert the Database Gate includes focused sandbox PostgreSQL tests and only three-repeat concurrency commands.

- [ ] **Step 2: Run RED on Claw**

```bash
pnpm exec vitest run tests/repo/expert-residency-release-readiness.test.ts tests/repo/workflow-semantics.test.ts tests/repo/scope-boundary.test.ts tests/repo/sandbox-production-isolation.test.ts --maxWorkers=1
```

- [ ] **Step 3: Write operational and traceability documentation**

Document exact sandbox startup, `II_TONYA_RUNTIME_MODE=sandbox`, provider credential variables fixed to empty values, marker validation, separate admin approvals, event reconciliation, bounded cleanup, rollback, and incident containment. State explicitly that sandbox evidence cannot change provider-connected staging status. Write `.github/pr-body-sandbox-payment-provider.md` with the SBX requirement summary, exact evidence links, `NO-GO` statement, rollback link, and reviewer checklist used by Step 8.

- [ ] **Step 4: Register focused tests in the Claw Database Gate**

Add one focused execution of repository/E2E suites and three repetitions only for concurrency/reconciliation tests. Do not add hosted runners or repeat production smoke.

- [ ] **Step 5: Run fresh final verification on exact SHA**

On Claw, run once:

```bash
pnpm install --frozen-lockfile
pnpm --workspace-concurrency=1 -r --sort run build
pnpm verify
pnpm audit --prod
bash scripts/run-sandbox-container-smoke.sh
pnpm test:container
```

Then run actionlint with its official checksum-verified binary and run the exact Database Gate command. Record exact SHA, image identifiers/digests, commands, durations, pass counts, audit result, and zero-container cleanup. Do not commit raw logs or secrets.

- [ ] **Step 6: Perform an independent Critical/Important review**

Review boundaries: production import/image isolation, marker enforcement, approval consumption atomicity, idempotency/replay, event branding, settlement/refund authority, network/credential absence, sanitized errors, migration safety, test truthfulness, and evidence completeness. Fix findings with new RED tests and rerun only affected focused gates before the final aggregate gate.

- [ ] **Step 7: Commit final evidence and documentation**

```bash
git add README.md docs scripts/run-claw-actions-job.sh .github/workflows/db-gate.yml tests/repo
git commit -m "docs: record sandbox payment verification"
```

- [ ] **Step 8: Push, open PR, and require exact checks before merge**

```bash
git push -u origin codex/sandbox-payment-provider
gh pr create --repo Dimkox/ii-tonya-platform --base main --head codex/sandbox-payment-provider --title "Add isolated sandbox payment provider" --body-file .github/pr-body-sandbox-payment-provider.md
```

Require exact-head CI, Database Gate, secret scan, and independent review success. Squash-merge only if the head SHA is unchanged and every required check succeeds. After merge, require exact-main CI/Database Gate, including signed SBOM/provenance. Do not dispatch staging or production release in this plan.

## Final acceptance checklist

- [ ] `apps/api/package.json`, production Dockerfile, production Compose, and production image have no sandbox dependency or route.
- [ ] Sandbox startup fails without exact mode and database marker.
- [ ] Checkout and command replay are durable and conflict-safe.
- [ ] Approved `settled` and `refunded` transitions are atomic and auditable.
- [ ] Existing settlement/reversal paths are the only financial mutation authority.
- [ ] No external call, live provider credential, raw payload, or approval secret is introduced.
- [ ] Focused concurrency/reconciliation tests pass three times on Claw.
- [ ] Sandbox and production packaged-image smokes each pass once with zero leftover containers.
- [ ] Exact final SHA passes full CI, Database Gate, scope/security guards, scan, SBOM, signing, and provenance.
- [ ] Independent review has no unresolved Critical or Important finding.
- [ ] Provider staging remains `BLOCKED`; production remains `NO-GO`.
