# YooKassa Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strict, first-party YooKassa Merchant API adapter that can create and reconcile expert residency payments and refunds while remaining absent from the default production composition.

**Architecture:** `@ii-tonya/integrations` owns the fixed-origin HTTP client, strict provider schemas, event verifier, and provider adapter. PostgreSQL owns durable operation/idempotency mappings and canonical provider inbox delivery. `apps/api` exposes an injectable default-off webhook route, while the worker reads YooKassa objects through a bounded provider reader. No live merchant capability is constructed by the default server.

**Tech Stack:** TypeScript 5.8, Node.js 24 native `fetch`, Zod 4, Fastify 5, PostgreSQL/Drizzle, Vitest, direct Claw test container.

## Global Constraints

- `PAY-PROV-001` and `YKP-001..014` from `docs/superpowers/specs/2026-08-14-yookassa-provider-design.md` are mandatory.
- Use only `https://api.yookassa.ru/v3`; tests inject transport functions instead of changing the production origin.
- Do not add a YooKassa/YooMoney SDK, Python runtime, card-data flow, or provider dependency.
- Money remains integer minor units internally and RUB only; conversion to YooKassa decimal strings cannot use floating point.
- PostgreSQL owns durable idempotency and financial state. Webhook bodies and redirects never settle or refund directly.
- `YOOKASSA_ENABLED=false` remains the shipped default. Empty credential/fiscal values are accepted only while disabled.
- The default API/worker lifecycle constructs no YooKassa network capability. Enabling without an explicitly injected complete capability fails startup closed.
- Secrets, contacts, provider URLs, raw bodies, metadata, idempotency keys, and provider identifiers never enter logs, metrics, evidence, or committed fixtures.
- GitHub Actions are not used. Claw runs each focused test target once; when the first run passes, do not run it a second or third time.
- Production deployment is out of scope while the hosting provider is under maintenance and until merchant activation gates are approved.

---

### Task 1: YooKassa contracts and fixed-origin HTTP client

**Files:**

- Create: `packages/integrations/src/yookassa/contracts.ts`
- Create: `packages/integrations/src/yookassa/operation-port.ts`
- Create: `packages/integrations/src/yookassa/client.ts`
- Create: `packages/integrations/src/yookassa/client.test.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `tests/repo/support/payment-scope-boundary-core.ts`
- Test: `tests/repo/yookassa-provider-boundary.test.ts`

**Interfaces:**

- Consumes: Node `fetch`, `AbortSignal.timeout`, Zod, fixed origin `https://api.yookassa.ru`.
- Produces: `YooKassaClient`, `YooKassaTransport`, minimized payment/refund schemas, a strict notification envelope, provider-neutral operation/contact ports, exact minor-unit conversion, and sanitized provider failures.

- [ ] **Step 1: Write failing client and scope tests**

```ts
it("uses fixed v3 payment paths, Basic Auth, and one stable idempotency key", async () => {
  const transport = vi.fn(async () => response(200, paymentFixture));
  const client = createYooKassaClient(testConfig, transport);
  await client.createPayment(createPaymentCommand);
  expect(transport).toHaveBeenCalledWith(
    "https://api.yookassa.ru/v3/payments",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: expect.stringMatching(/^Basic /u),
        "Idempotence-Key": createPaymentCommand.idempotencyKey,
      }),
    }),
  );
});

it.each([[1n, "0.01"], [100n, "1.00"], [100001n, "1000.01"]])(
  "converts %s kopecks exactly",
  (minor, expected) => expect(formatRubMinor(minor)).toBe(expected),
);
```

- [ ] **Step 2: Run the focused RED once on Claw**

Run: `/seed/node_modules/.bin/vitest run packages/integrations/src/yookassa/client.test.ts tests/repo/yookassa-provider-boundary.test.ts --maxWorkers=1`

Expected: FAIL because the YooKassa module and approved scope do not exist.

- [ ] **Step 3: Add strict provider types and schemas**

```ts
export type YooKassaMode = "test" | "live";
export interface YooKassaAmount { readonly value: string; readonly currency: "RUB" }
export interface YooKassaPayment {
  readonly id: string;
  readonly status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  readonly paid: boolean;
  readonly amount: YooKassaAmount;
  readonly test: boolean;
  readonly created_at: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly confirmation?: { readonly type: "redirect"; readonly confirmation_url: string };
  readonly refundable: boolean;
}
export interface YooKassaRefund {
  readonly id: string;
  readonly payment_id: string;
  readonly status: "pending" | "succeeded" | "canceled";
  readonly amount: YooKassaAmount;
  readonly created_at: string;
}
export type YooKassaNotificationEvent =
  | "payment.succeeded"
  | "payment.canceled"
  | "refund.succeeded";
```

Request objects, metadata, and the notification envelope use `.strict()`. Provider payment/refund responses are bounded `.passthrough()` schemas that validate every consumed authority fact and transform to a minimized object, discarding payment-method, card, authorization, recipient, receipt, and other unrelated fields rather than persisting or logging them. This accepts ordinary YooKassa response expansion without granting authority to extra fields.

Define `YooKassaOperationPort` and its command/result types in integrations so the adapter never imports `@ii-tonya/db`. Define a `YooKassaReceiptContactPort` that returns a server-owned receipt contact for an order. The default runtime supplies neither port; tests inject synthetic contacts. No client request may supply receipt contact or fiscal facts.

- [ ] **Step 4: Implement the fixed-origin client**

```ts
export interface YooKassaTransport {
  (url: string, init: RequestInit): Promise<Response>;
}

export interface YooKassaClient {
  createPayment(command: CreateYooKassaPayment): Promise<YooKassaPayment>;
  getPayment(paymentId: string): Promise<YooKassaPayment>;
  createRefund(command: CreateYooKassaRefund): Promise<YooKassaRefund>;
  getRefund(refundId: string): Promise<YooKassaRefund>;
}

export function formatRubMinor(value: bigint): string {
  if (value <= 0n || value > 999_999_999_999n) throw new Error("yookassa_amount_invalid");
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}
```

The request helper accepts only literal operation paths assembled from validated provider IDs, uses a 15-second abort signal, sends JSON only for POST, and maps connection/timeout/429/5xx to `YooKassaUnknownOutcomeError`; 400/401/403/404/409 map to bounded `YooKassaTerminalError` codes. Error messages contain no provider body or credentials.

- [ ] **Step 5: Approve only the narrow first-party boundary**

Update the recursive payment guard so network calls are allowed only in `packages/integrations/src/yookassa/client.ts`, the only allowed literal host is `api.yookassa.ru`, no provider package dependency is added, no direct `process.env` access exists in the module, and the privileged canonical event factory remains prohibited outside the dedicated verifier.

- [ ] **Step 6: Run the same focused GREEN once and commit**

Run once on Claw: `/seed/node_modules/.bin/vitest run packages/integrations/src/yookassa/client.test.ts tests/repo/yookassa-provider-boundary.test.ts --maxWorkers=1`

Expected: PASS on the first run; do not repeat.

```bash
git add packages/integrations/src/yookassa packages/integrations/src/index.ts tests/repo/yookassa-provider-boundary.test.ts tests/repo/support/payment-scope-boundary-core.ts
git commit -m "feat: add strict YooKassa API client"
```

### Task 2: Durable YooKassa operation mapping

**Files:**

- Modify: `packages/db/src/schema/expert-residency.ts`
- Create: `packages/db/migrations/0023_yookassa_provider_operations.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Create: `packages/db/src/repositories/yookassa-operation-repository.ts`
- Create: `packages/db/src/repositories/yookassa-operation-repository.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `tests/repo/support/payment-scope-boundary-core.ts`
- Test: `tests/integration/yookassa-operation-concurrency.test.ts`

**Interfaces:**

- Consumes: authoritative residency order, payment-attempt, and database transaction boundaries.
- Produces: `PostgresYooKassaOperationRepository`, implementing the integrations-owned port with atomic claim, provider-object binding, unknown-outcome resolution, webhook dedupe, and bounded reconciliation claims.

- [ ] **Step 1: Write failing repository and migration tests**

```ts
const first = await repo.claimCreatePayment(command);
const replay = await repo.claimCreatePayment(command);
expect(replay).toEqual(first);
await expect(repo.claimCreatePayment({ ...command, amountMinor: "2" }))
  .rejects.toMatchObject({ code: "YOOKASSA_IDEMPOTENCY_CONFLICT" });
```

The concurrency test issues eight simultaneous identical claims and asserts one row, one idempotency key, one request digest, and one operation ID.

- [ ] **Step 2: Run the focused PostgreSQL RED once on Claw**

Run: `/seed/node_modules/.bin/vitest run packages/db/src/repositories/yookassa-operation-repository.test.ts tests/integration/yookassa-operation-concurrency.test.ts --maxWorkers=1`

Expected: FAIL because migration `0023` and the repository do not exist.

- [ ] **Step 3: Add the operation relation**

```sql
create table expert_residency_provider_operations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references expert_residency_orders(id),
  payment_attempt_id uuid not null references expert_residency_payment_attempts(id),
  operation_kind text not null check (operation_kind in ('create_payment','create_refund')),
  provider text not null check (provider = 'yookassa'),
  environment_mode text not null check (environment_mode in ('test','live')),
  provider_object_id text,
  parent_payment_id text,
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 999999999999),
  currency text not null check (currency = 'RUB'),
  request_digest text not null check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key uuid not null unique,
  status text not null check (status in ('claimed','pending','unknown_outcome','succeeded','canceled','failed')),
  resolved_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique (provider, provider_object_id),
  check ((operation_kind = 'create_payment' and parent_payment_id is null) or
         (operation_kind = 'create_refund' and parent_payment_id is not null)),
  check ((status in ('claimed','pending','unknown_outcome') and resolved_at is null) or
         (status in ('succeeded','canceled','failed') and resolved_at is not null))
);
```

Add indexes on `(status, created_at, id)` and `(order_id, operation_kind, created_at)` and an exact Drizzle declaration.

- [ ] **Step 4: Implement transactional repository methods**

```ts
export class PostgresYooKassaOperationRepository implements YooKassaOperationPort {
  claimCreatePayment(command: ClaimPaymentCommand): Promise<ProviderOperation>;
  claimRefund(command: ClaimRefundCommand): Promise<ProviderOperation>;
  bindProviderObject(command: BindProviderObjectCommand): Promise<ProviderOperation>;
  markUnknown(operationId: string): Promise<void>;
  resolve(command: ResolveProviderOperationCommand): Promise<void>;
  claimReconciliationBatch(limit: number): Promise<readonly ProviderOperation[]>;
}
```

Claims use serializable transactions, lock the order/payment attempt, recompute a canonical request digest in the repository, and reject any replay whose order, kind, amount, currency, environment, parent payment, or digest differs. `bindProviderObject` is compare-and-set and never replaces an existing different provider ID.

- [ ] **Step 5: Run migration parity, repository, and concurrency GREEN once**

Run once on Claw: `/seed/node_modules/.bin/vitest run packages/db/src/repositories/yookassa-operation-repository.test.ts tests/integration/yookassa-operation-concurrency.test.ts tests/repo/schema-parity.test.ts --maxWorkers=1`

Expected: PASS; do not repeat.

- [ ] **Step 6: Commit the durable boundary**

```bash
git add packages/db/src/schema/expert-residency.ts packages/db/migrations packages/db/src/repositories/yookassa-operation-repository* packages/db/src/index.ts tests/integration/yookassa-operation-concurrency.test.ts tests/repo/support/payment-scope-boundary-core.ts
git commit -m "feat: persist YooKassa operations"
```

### Task 3: Provider adapter and authoritative verifier

**Files:**

- Create: `packages/integrations/src/yookassa/payment-adapter.ts`
- Create: `packages/integrations/src/yookassa/payment-adapter.test.ts`
- Create: `packages/integrations/src/yookassa/verifier.ts`
- Create: `packages/integrations/src/yookassa/verifier.test.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `packages/integrations/src/expert-residency/payment-port.ts`
- Modify: `tests/repo/support/payment-scope-boundary-core.ts`

**Interfaces:**

- Consumes: `YooKassaClient`, the integrations-owned `YooKassaOperationPort` and `YooKassaReceiptContactPort`, existing canonical event verifier, and provider-neutral checkout commands.
- Produces: `YooKassaExpertResidencyPaymentAdapter`, verified settlement/refund events, stable unknown outcomes, and no direct financial mutation.

- [ ] **Step 1: Write failing adapter/verifier tests**

```ts
expect(await adapter.createCheckout(command)).toEqual({
  kind: "created",
  paymentId: "2f4b6d0d-000f-5000-9000-000000000001",
  checkoutUrl: "https://yoomoney.ru/checkout/payments/v2/contract?orderId=safe",
});
await expect(verifier.verifyPayment("provider-id", binding))
  .rejects.toThrow("yookassa_payment_binding_mismatch");
```

Cover exact metadata order binding, amount/currency/test-mode mismatch, unsupported state, non-HTTPS redirect, duplicate provider ID, terminal failures, unknown outcomes, settlement, cancellation, and refund.

- [ ] **Step 2: Run focused RED once on Claw**

Run: `/seed/node_modules/.bin/vitest run packages/integrations/src/yookassa/payment-adapter.test.ts packages/integrations/src/yookassa/verifier.test.ts --maxWorkers=1`

Expected: FAIL because adapter and verifier are absent.

- [ ] **Step 3: Extend the provider port without exposing customer-controlled facts**

```ts
export interface ExpertResidencyRefundCommand {
  readonly orderId: string;
  readonly paymentId: string;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly idempotencyKey: string;
}
export interface ExpertResidencyPaymentPort {
  createCheckout(command: ExpertResidencyCheckoutCommand): Promise<ExpertResidencyCheckoutOutcome>;
  refund(command: ExpertResidencyRefundCommand): Promise<{ readonly kind: "pending"; readonly refundId: string }>;
  reconcile(paymentId: string): Promise<VerifiedExpertResidencyPaymentEvent | null>;
}
```

Update the disabled and sandbox adapters with fail-closed/no-op compatible methods; no public route accepts provider IDs, amounts, receipt facts, or refund commands.

- [ ] **Step 4: Implement adapter and verifier**

`createCheckout` claims the operation before POST, obtains the receipt contact from the server-owned port, uses the same key/body for replay, binds the returned provider ID, and marks transport ambiguity as unknown. Missing contact or fiscal configuration fails before any network call. `refund` follows the same sequence. `reconcile` performs authenticated GET, compares every durable fact, computes a canonical payload digest from the accepted fact set, and only then uses the canonical verifier to brand a `VerifiedExpertResidencyPaymentEvent`.

- [ ] **Step 5: Run focused GREEN once and commit**

Run once on Claw: `/seed/node_modules/.bin/vitest run packages/integrations/src/yookassa/payment-adapter.test.ts packages/integrations/src/yookassa/verifier.test.ts packages/integrations/src/expert-residency --maxWorkers=1`

Expected: PASS; do not repeat.

```bash
git add packages/integrations/src/yookassa packages/integrations/src/expert-residency packages/integrations/src/index.ts tests/repo/support/payment-scope-boundary-core.ts
git commit -m "feat: add YooKassa residency adapter"
```

### Task 4: Default-off configuration and webhook route

**Files:**

- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Modify: `.env.example`
- Modify: `deploy/runtime.env.example`
- Create: `apps/api/src/routes/yookassa-webhook.ts`
- Create: `apps/api/src/routes/yookassa-webhook.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `tests/repo/support/payment-scope-boundary-core.ts`
- Modify: `tests/repo/env-policy.test.ts`
- Modify: `scripts/run-claw-ci.sh`

**Interfaces:**

- Consumes: injected webhook capability, trusted effective peer address, YooKassa client/verifier, PostgreSQL webhook inbox.
- Produces: strict `POST /v1/webhooks/yookassa`, fail-closed environment metadata, and zero YooKassa network calls in default server composition.

- [ ] **Step 1: Write failing config, route, and composition tests**

```ts
expect(loadEnv(localEnv()).features.yookassa).toBe(false);
expect(() => loadEnv(localEnv({ YOOKASSA_ENABLED: "true" })))
  .toThrow("yookassa_configuration_incomplete");
expect(await app.inject({ method: "POST", url: "/v1/webhooks/yookassa" }))
  .toMatchObject({ statusCode: 404 });
```

Injected enabled composition tests cover allowlisted IPv4/IPv6, spoofed forwarded headers, 64 KiB body ceiling, malformed/extra JSON, three supported events, duplicate delivery, authoritative GET mismatch, sanitized 4xx/5xx, and acknowledgement only after durable inbox acceptance.

- [ ] **Step 2: Run focused RED once on Claw**

Run: `/seed/node_modules/.bin/vitest run packages/config/src/env.test.ts apps/api/src/routes/yookassa-webhook.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts tests/repo/env-policy.test.ts --maxWorkers=1`

Expected: FAIL because YooKassa configuration and route composition are absent.

- [ ] **Step 3: Add reference-only configuration**

```ts
export interface YooKassaRuntimeMetadata {
  readonly mode: "test" | "live";
  readonly shopId: string;
  readonly secretReference: "env://YOOKASSA_SECRET_KEY";
  readonly returnUrl: string;
  readonly receipt: {
    readonly vatCode: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    readonly paymentSubject: string;
    readonly paymentMode: string;
  };
}
```

Change `PAYMENTS_ENABLED` to `true|false` and `PAYMENT_PROVIDER` to `disabled|yookassa`. `loadEnv` returns metadata and a secret reference, never the secret. Enabling requires the exact combination `YOOKASSA_ENABLED=true`, `PAYMENTS_ENABLED=true`, `PAYMENT_PROVIDER=yookassa`, a non-empty shop ID, `env://YOOKASSA_SECRET_KEY`, an HTTPS return URL on an approved host, explicit test/live mode, and receipt values. Any partial or contradictory combination fails closed. `RuntimeConfig.integrations.payments` becomes a boolean and `features.yookassa` is explicit. `buildApp` permits only this exact combination and only when an injected webhook capability exists; every other live integration remains prohibited. The default server still supplies no resolver/capability, so enabled startup fails closed before network access.

Add empty example values:

```dotenv
YOOKASSA_ENABLED=false
YOOKASSA_MODE=
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=
YOOKASSA_SECRET_REF=
YOOKASSA_RETURN_URL=
YOOKASSA_RECEIPT_VAT_CODE=
YOOKASSA_RECEIPT_PAYMENT_SUBJECT=
YOOKASSA_RECEIPT_PAYMENT_MODE=
```

- [ ] **Step 4: Implement the injectable webhook route**

```ts
export interface YooKassaWebhookDependencies {
  readonly effectivePeerAddress(request: FastifyRequest): string;
  readonly claim(eventKey: string): Promise<"claimed" | "duplicate">;
  readonly verify(notification: unknown): Promise<VerifiedExpertResidencyPaymentEvent>;
  readonly deliver(event: VerifiedExpertResidencyPaymentEvent): Promise<void>;
  readonly complete(eventKey: string): Promise<void>;
  readonly release(eventKey: string): Promise<void>;
}
```

Register the route only when `features.yookassa` is true and a capability is injected. If the flag and capability disagree, `buildApp` throws. `createDefaultLifecycle` injects neither the route nor a secret resolver.

- [ ] **Step 5: Run focused GREEN once and commit**

Run once on Claw: `/seed/node_modules/.bin/vitest run packages/config/src/env.test.ts apps/api/src/routes/yookassa-webhook.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts tests/repo/env-policy.test.ts --maxWorkers=1`

Expected: PASS; do not repeat.

```bash
git add packages/config/src/env* .env.example deploy/runtime.env.example apps/api/src tests/repo/env-policy.test.ts tests/repo/support/payment-scope-boundary-core.ts
git commit -m "feat: add disabled YooKassa webhook boundary"
```

### Task 5: Bounded YooKassa reconciliation reader

**Files:**

- Create: `packages/integrations/src/yookassa/reconciliation-reader.ts`
- Create: `packages/integrations/src/yookassa/reconciliation-reader.test.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `apps/worker/src/runtime.ts`
- Modify: `apps/worker/src/runtime.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/main.test.ts`
- Test: `tests/integration/yookassa-reconciliation.test.ts`

**Interfaces:**

- Consumes: existing `ExpertResidencyProviderReader`, exact local payment batch, injected YooKassa client, test/live mode.
- Produces: bounded status snapshots for existing reconciliation and unknown-operation resolution, with no history scan and no financial mutation.

- [ ] **Step 1: Write failing reader/runtime tests**

```ts
expect(await reader.readPayments({ now, payments: local })).toEqual({
  kind: "available",
  payments: [{
    provider: "yookassa",
    paymentId,
    amountMinor: "50000",
    currency: "RUB",
    status: "settled",
  }],
});
```

Cover batch maximum 100, duplicate IDs, foreign providers, exact amount/currency/mode checks, bounded concurrency, one fetch per unique provider ID, and whole-batch fail-closed behavior.

- [ ] **Step 2: Run focused RED once on Claw**

Run: `/seed/node_modules/.bin/vitest run packages/integrations/src/yookassa/reconciliation-reader.test.ts apps/worker/src/runtime.test.ts apps/worker/src/main.test.ts tests/integration/yookassa-reconciliation.test.ts --maxWorkers=1`

Expected: FAIL because the provider reader and enabled dependency seam are absent.

- [ ] **Step 3: Implement the reader and explicit runtime seam**

```ts
export class YooKassaExpertResidencyProviderReader implements ExpertResidencyProviderReader {
  constructor(private readonly client: YooKassaClient, private readonly mode: YooKassaMode) {}
  async readPayments(command: ReadPaymentsCommand): Promise<AvailableProviderPayments>;
}
```

`createProductionWorkerRuntime` keeps the disabled reader by default. A separate injected dependency may supply the YooKassa reader only when config metadata is enabled and complete; the runnable default worker never reads the YooKassa secret or constructs a client.

- [ ] **Step 4: Run focused GREEN once and commit**

Run once on Claw: `/seed/node_modules/.bin/vitest run packages/integrations/src/yookassa/reconciliation-reader.test.ts apps/worker/src/runtime.test.ts apps/worker/src/main.test.ts tests/integration/yookassa-reconciliation.test.ts --maxWorkers=1`

Expected: PASS; do not repeat.

```bash
git add packages/integrations/src/yookassa/reconciliation-reader* packages/integrations/src/index.ts apps/worker/src tests/integration/yookassa-reconciliation.test.ts
git commit -m "feat: add YooKassa reconciliation reader"
```

### Task 6: Traceability, runbook, graph, and exact-head verification

**Files:**

- Create: `docs/spec/yookassa-provider-traceability.md`
- Create: `docs/runbooks/yookassa-provider.md`
- Create: `docs/test-evidence/claw/<exact-sha>/yookassa-provider.md`
- Modify: `README.md`
- Modify: `docs/architecture/project-connectivity-graph.md`
- Modify: `docs/architecture/project-connectivity-inventory.md`
- Modify: `docs/integrations/live-readiness.md`
- Modify: `docs/runbooks/provider-staging-evidence.md`
- Modify: `docs/runbooks/go-live-evidence.md`
- Modify: `.superpowers/sdd/progress.md`
- Modify: `tests/repo/expert-residency-release-readiness.test.ts`
- Modify: `scripts/run-claw-ci.sh`
- Create: `.github/pr-body-yookassa-provider.md`

**Interfaces:**

- Consumes: reviewed implementation commits and exact Claw evidence.
- Produces: `YKP-001..014` traceability, operator recovery steps, explicit test-shop/live blockers, and a reviewable Draft PR. No staging or production activation.

- [ ] **Step 1: Write failing traceability/release-guard tests**

```ts
for (const id of Array.from({ length: 14 }, (_, index) => `YKP-${String(index + 1).padStart(3, "0")}`)) {
  expect(traceability).toContain(`| ${id} |`);
}
expect(goLive).toContain("YooKassa status: BLOCKED");
expect(runtimeEnv).toContain("YOOKASSA_ENABLED=false");
```

- [ ] **Step 2: Run focused RED once on Claw**

Run: `/seed/node_modules/.bin/vitest run tests/repo/expert-residency-release-readiness.test.ts tests/repo/yookassa-provider-boundary.test.ts --maxWorkers=1`

Expected: FAIL because traceability and go-live records are absent.

- [ ] **Step 3: Write operational documentation**

Trace every YKP requirement to code, focused tests, Claw gate, telemetry, recovery, and approval owner. The runbook covers feature-off rollout, secret rotation by reference, test-shop setup, webhook/nginx peer trust, unknown-outcome reconciliation, fiscal configuration validation, daily registry comparison, credential incident response, rollback, and proof that no provider payload can directly mutate financial state.

- [ ] **Step 4: Update README and architecture graph**

README must link the YooKassa design, traceability, and runbook from the architecture/release sections and state: adapter code exists; default server remains disconnected; test-shop evidence, legal/fiscal approval, registry reconciliation, and live credentials remain blocked.

- [ ] **Step 5: Run one exact-head focused gate and one branch-finish gate on Claw**

Run focused once:

```bash
/seed/node_modules/.bin/vitest run \
  packages/integrations/src/yookassa \
  packages/db/src/repositories/yookassa-operation-repository.test.ts \
  apps/api/src/routes/yookassa-webhook.test.ts \
  tests/integration/yookassa-operation-concurrency.test.ts \
  tests/integration/yookassa-reconciliation.test.ts \
  tests/repo/yookassa-provider-boundary.test.ts \
  tests/repo/expert-residency-release-readiness.test.ts \
  --maxWorkers=1
```

If that first run passes, do not repeat it. Before the branch-finish gate, replace every direct `pnpm test:repeat -- 3` in `scripts/run-claw-ci.sh` with one direct focused Vitest run, update the evidence metadata to `repeat_limit: 1`, and add a repository assertion preventing repeat counts above one. Then run the direct Claw CI and Database Gate entrypoints once for the exact commit. GitHub Actions are not invoked.

- [ ] **Step 6: Run static checks once**

Run: targeted Prettier, targeted ESLint, relevant package builds/typechecks, migration/schema parity, `git diff --check`, secret-pattern scan, and `git status --short`. Each command runs once if green.

- [ ] **Step 7: Obtain independent adversarial review**

Review boundaries: credential leakage, fixed origin/SSRF, idempotency beyond 24 hours, unknown outcomes, webhook spoofing/proxy trust, authoritative re-read, amount/order/mode binding, refund cap, event branding, PostgreSQL concurrency, default-off composition, fiscal fail-closed behavior, worker bounds, tests, and evidence truthfulness. Remediation receives one new RED/GREEN cycle only for the affected tests.

- [ ] **Step 8: Commit evidence, publish, and merge the disabled increment**

```bash
git add README.md docs .superpowers/sdd/progress.md tests/repo/expert-residency-release-readiness.test.ts
git commit -m "docs: record YooKassa provider evidence"
git push -u origin codex/yookassa-provider
gh pr create --draft --base main --head codex/yookassa-provider --title "Add disabled YooKassa provider adapter" --body-file .github/pr-body-yookassa-provider.md
```

Create the PR body with exact Claw evidence and explicit activation blockers. After exact-head review and direct Claw gates are green, mark the PR ready and merge it. Do not deploy or activate YooKassa while production maintenance is active. Even after merge, test-shop and live activation remain separately blocked by the open inputs in the design.
