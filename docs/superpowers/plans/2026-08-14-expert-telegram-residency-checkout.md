# ER-TG-003 Expert Telegram Residency Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the provider-neutral `xr1` checkout callback with explicit readiness, durable mutation outcomes, retry-safe delivery, and expiring sensitive URL storage.

**Architecture:** Add an additive 0026 state machine to the existing callback table. A provider-neutral Telegram checkout capability owns token issuance/authentication and delegates the only financial mutation to `ExpertResidencyService.checkout`; webhook code owns inbox/delivery/ack orchestration. The production worker clears expired URLs in bounded batches.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Drizzle schema/migrations, Vitest, existing Telegram adapter, direct Claw verification.

## Global Constraints

- Base is exactly `651b8bf63c32a1e2f0caf295fe0b28aad830c960` in `.worktrees/er-tg-003` on `codex/er-tg-003`.
- `EXPERT_TELEGRAM_CHECKOUT_ENABLED=false` is versioned and independent from query, financial-view, and referral-mutation flags.
- `xr1` remains isolated from `ct2` and `cv1`; no YooKassa/provider import or activation is allowed.
- Telegram supplies no tariff amount, checkout URL, payment ID, or mutation idempotency key.
- Terminal replay never calls checkout. Expired processing recovery uses the same token hash and a database lease/fence so one retry owns recovery.
- Stored URLs are HTTPS, at most 2,048 characters, never logged, and physically nulled in a bounded worker cycle at or after expiry.
- All tests are focused. Run the real PostgreSQL suite and final Claw target once; do not repeat a passing run. No image build/prune, production action, or GitHub Actions.

---

### Task 1: Versioned readiness and production composition

**Files:**
- Modify: `.env.example`
- Modify: `deploy/runtime.env.example`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `packages/integrations/src/telegram/expert-ingress-factory.ts`
- Modify: `packages/integrations/src/telegram/expert-ingress-factory.test.ts`

**Interfaces:**
- Produces: `RuntimeConfig.features.expertTelegramCheckout: boolean`.
- Produces: factory input `checkoutReadiness?: boolean` plus required `checkout` capability when true.
- Consumes later: `ExpertTelegramCheckoutCapability` from Task 3.

- [ ] **Step 1: Write RED config/factory/app/server tests**

Assert the env default is false, explicit true parses, false with complete injected dependencies emits no checkout capability, true with complete dependencies exposes it, and true without complete checkout dependencies throws `Expert Telegram checkout capability is required`.

```ts
expect(loadEnv(localEnv()).features.expertTelegramCheckout).toBe(false);
expect(loadEnv(localEnv({ EXPERT_TELEGRAM_CHECKOUT_ENABLED: "true" })).features.expertTelegramCheckout).toBe(true);
expect(() => createExpertTelegramIngress({
  ...completeBase,
  checkoutReadiness: true,
})).toThrow("Expert Telegram checkout capability is required");
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run only the Task 1 files. Expected failure: missing env schema/feature and missing checkout dependency guard.

- [ ] **Step 3: Implement the minimal readiness seam**

Add `EXPERT_TELEGRAM_CHECKOUT_ENABLED=false` to both examples and map it to `features.expertTelegramCheckout`. Extend ingress dependencies with:

```ts
readonly checkoutReadiness?: boolean;
readonly checkout?: ExpertTelegramCheckoutCapability;
```

The factory must throw if readiness is true without checkout. `createDefaultLifecycle` derives readiness exclusively from `RuntimeConfig`; callers cannot inject a prebuilt ingress that bypasses the flag. `buildApp` includes this flag in the existing Telegram capability gate.

- [ ] **Step 4: Run the same focused tests and confirm GREEN**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(config): gate expert Telegram checkout"
```

### Task 2: Durable callback state, fencing, and URL cleanup

**Files:**
- Create: `packages/db/migrations/0026_expert_telegram_checkout_outcomes.sql`
- Modify: `packages/db/src/schema/expert-residency.ts`
- Modify: `packages/db/src/repositories/expert-telegram-residency-callback-repository.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `tests/integration/expert-telegram-residency-callback.test.ts`
- Modify: `tests/repo/db-schema-parity.test.ts`
- Modify: `tests/repo/expert-referral-scope-guards.test.ts`
- Modify: `tests/repo/support/payment-scope-boundary-core.ts`
- Modify: `apps/worker/src/runtime.ts`
- Modify: `apps/worker/src/runtime.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/main.test.ts`

**Interfaces:**
- Produces:

```ts
type CheckoutOutcome =
  | { kind: "ready"; checkoutUrl: string }
  | { kind: "unavailable" | "unknown" };
type CheckoutClaim =
  | { kind: "acquired"; tokenHash: string; claims: ExpertResidencyCallbackClaims; fence: string }
  | { kind: "replay"; tokenHash: string; outcome: CheckoutOutcome }
  | { kind: "processing" };

inspect(tokenHash, expertId, telegramUserId, now): Promise<claims | null>;
claim(tokenHash, claims, now, leaseUntil, fence): Promise<CheckoutClaim | null>;
recordOutcome(tokenHash, fence, outcome, now): Promise<boolean>;
clearExpiredCheckoutUrls(now, limit): Promise<number>;
```

- [ ] **Step 1: Write RED PostgreSQL and worker tests**

Use real PostgreSQL to assert: eight concurrent initial claims have one `acquired`; concurrent expired-lease recovery has one new fence winner; stale fence cannot record; ready stores one bounded HTTPS URL; foreign/inactive/expired inspection returns null; terminal replay returns the stored outcome; cleanup nulls the URL after expiry. Worker tests assert the bounded cleanup runs once per cycle and production factory injects the repository.

```ts
const winners = await Promise.all(Array.from({ length: 8 }, () =>
  repository.claim(tokenHash, claims, now, leaseUntil, crypto.randomUUID()),
));
expect(winners.filter((x) => x?.kind === "acquired")).toHaveLength(1);
await repository.clearExpiredCheckoutUrls(afterExpiry, 100);
expect(await rawCheckoutUrl(tokenHash)).toBeNull();
```

- [ ] **Step 2: Run schema/static tests to confirm RED**

Do not run the real PostgreSQL suite until the final focused Claw gate. Confirm RED locally with schema parity and repository type/build errors only.

- [ ] **Step 3: Add exact additive migration and Drizzle schema**

0026 adds:

```sql
checkout_status text not null default 'issued',
checkout_url varchar(2048),
processing_fence uuid,
processing_lease_until timestamptz,
outcome_recorded_at timestamptz,
check (checkout_status in ('issued','processing','ready','unavailable','unknown')),
check ((checkout_status='ready' and checkout_url ~ '^https://[^[:space:]]{1,2040}$') or
       (checkout_status<>'ready' and checkout_url is null)),
check ((checkout_status='processing') = (processing_fence is not null and processing_lease_until is not null))
```

Add a partial index for expired URL cleanup and mirror every column, check, and index in Drizzle/parity assertions.

- [ ] **Step 4: Implement repository compare-and-set transitions**

`inspect` joins active user, active verified expert, and exact Telegram identity. `claim` uses one `UPDATE ... WHERE` that permits `issued` or expired `processing`, returns the new fence, and returns terminal replay separately without exposing a URL after expiry. `recordOutcome` requires the current fence. `clearExpiredCheckoutUrls` uses a bounded `FOR UPDATE SKIP LOCKED` CTE and sets only `checkout_url=null`.

- [ ] **Step 5: Compose bounded cleanup into the worker**

Add `expertTelegramCheckoutCleanup` to `WorkerCycleReport` and dependencies. Run it every bounded cycle after residency expiry. The production factory constructs the repository on the same DB and calls `clearExpiredCheckoutUrls(now(), batchSize)`.

- [ ] **Step 6: Run focused schema/worker tests and confirm GREEN**

- [ ] **Step 7: Commit**

```bash
git add packages/db apps/worker tests/integration/expert-telegram-residency-callback.test.ts tests/repo
git commit -m "feat(db): persist Telegram checkout outcomes"
```

### Task 3: Provider-neutral checkout capability

**Files:**
- Create: `packages/integrations/src/telegram/expert-residency-checkout.ts`
- Create: `packages/integrations/src/telegram/expert-residency-checkout.test.ts`
- Modify: `packages/integrations/src/telegram/residency-checkout-callback-token.ts`
- Modify: `packages/integrations/src/telegram/residency-checkout-callback-token.test.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**
- Consumes: `ExpertResidencyService`, Task 2 store, 32-byte secret, authoritative clock.
- Produces:

```ts
interface ExpertTelegramCheckoutCapability {
  issue(input: { principal; tariffVersionId: string; idempotencyKey: string }): Promise<string>;
  process(input: { data: string; principal; correlationId: string }): Promise<
    | { kind: "ready"; tokenHash: string; checkoutUrl: string; replay: boolean }
    | { kind: "unavailable" | "unknown" | "processing"; tokenHash?: string; replay: boolean }
  >;
}
```

- [ ] **Step 1: Write RED unit tests**

Tests prove issue stores only server claims; processing fresh-resolves stored tariff through binding lookup/MAC; the only mutation is:

```ts
residency.checkout(
  { authenticated: true, userId: principal.userId, expertId: principal.expertId },
  stored.tariffVersionId,
  tokenHash,
)
```

Assert ready validates HTTPS URL and stores it without payment ID; forbidden/disabled/missing URL becomes unavailable; throw becomes unknown; terminal replay does not call service; expired processing recovery calls service once with the same tokenHash while concurrent losers return processing.

- [ ] **Step 2: Run focused capability/token tests and confirm RED**

- [ ] **Step 3: Implement server-state lookup before MAC and fenced processing**

Parse canonical `xr1`, derive tokenHash, inspect claims for the fresh principal, verify HMAC with stored tariff, then claim. Only `acquired` invokes checkout. Record a bounded terminal outcome using the returned fence. Never return/log payment ID or amounts. Map invalid/foreign/expired tokens to a fixed verification failure.

- [ ] **Step 4: Run focused capability/token tests and confirm GREEN**

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src
git commit -m "feat(telegram): process residency checkout callbacks"
```

### Task 4: Quote button and checkout-link rendering

**Files:**
- Modify: `packages/integrations/src/telegram/expert-command-processor.ts`
- Modify: `packages/integrations/src/telegram/expert-command-processor.test.ts`
- Modify: `packages/integrations/src/telegram/telegram-adapter.ts`
- Modify: `packages/integrations/src/telegram/telegram-adapter.test.ts`

**Interfaces:**
- Consumes: Task 3 `checkout.issue`.
- Produces: optional `checkoutCallbackData` on `ExpertResidencyQuoteView` and `sendResidencyCheckoutLink` on the view port.

- [ ] **Step 1: Write RED processor/adapter tests**

Assert quote has no keyboard when readiness is false. With readiness true, issue receives principal, exact returned tariff UUID, and a delivery-independent issuance key; the adapter renders exactly one `Оплатить` button whose callback is canonical `xr1` and <=64 UTF-8 bytes. Checkout-link send accepts only bounded HTTPS and renders no payment ID or amount.

- [ ] **Step 2: Run focused tests and confirm RED**

- [ ] **Step 3: Implement minimal optional button and link view**

Keep quote text unchanged. Add reply markup only when `checkoutCallbackData` is present and valid. Add a separate message view that sends the authoritative HTTPS URL with its own idempotency key. Do not add provider-specific text or types.

- [ ] **Step 4: Run focused tests and confirm GREEN**

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/telegram
git commit -m "feat(telegram): render residency checkout action"
```

### Task 5: Webhook mutation, replay, delivery, and acknowledgement

**Files:**
- Modify: `packages/integrations/src/telegram/expert-ingress-factory.ts`
- Modify: `apps/api/src/routes/telegram-webhook.ts`
- Modify: `apps/api/src/routes/telegram-webhook.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: ingress `processResidencyCheckout`, `sendResidencyCheckoutLink`, and existing `answerCallbackQuery`.
- Produces: retry-safe `xr1` webhook behavior.

- [ ] **Step 1: Write RED route tests**

Assert disabled xr1 stays unsupported. Enabled xr1: claims inbox, freshly resolves principal, processes mutation, sends ready URL using a token-hash delivery key, separately ACKs, and completes. Terminal replay sends stored outcome but checkout service count remains one. `not_applied`/`unknown_outcome` delivery fails the claim and returns sanitized 503; retry reuses the stored outcome. Invalid/foreign/expired/processing/unknown outcomes complete with generic unavailable and no URL. ACK failure never changes mutation/delivery state.

- [ ] **Step 2: Run focused route/composition tests and confirm RED**

- [ ] **Step 3: Replace the xr1 unsupported branch**

Keep it before `cv1`/`ct2`. When readiness is false, return unsupported without principal resolution or claim. When enabled: claim update, fresh-resolve principal, invoke checkout processing, send only a ready authorized URL, and handle delivery outcome before callback ACK. Never put callback data, URL, payment ID, or service error in response/logs.

- [ ] **Step 4: Run focused route/composition tests and confirm GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/integrations/src/telegram/expert-ingress-factory*
git commit -m "feat(api): orchestrate Telegram residency checkout"
```

### Task 6: Traceability, exact gates, and independent review

**Files:**
- Create: `docs/spec/expert-telegram-residency-checkout.md`
- Modify: `docs/spec/expert-telegram-referral-mutations.md`
- Modify: `docs/spec/expert-residency-referrals-traceability.md`
- Modify: relevant handoff/connectivity inventory only where current claims change.

**Interfaces:**
- Produces: stable mapping ER-TG-003-R1..R8 -> code -> focused tests -> Claw evidence -> rollback owner.

- [ ] **Step 1: Update documentation truthfully**

State that provider-neutral checkout code is default-off and capability-injected. Do not claim live Telegram, payment provider, staging, production, AI, or provider activation.

- [ ] **Step 2: Run static changed-scope checks**

Run `git diff --check`, focused typecheck/build for touched packages, ESLint on touched TypeScript, schema parity, config/scope guards, and migration compatibility. Fix only causal failures.

- [ ] **Step 3: Run the final Claw focused gate once**

Upload the exact worktree source into the retained `ii-tonya-test-yookassa` container without rebuilding. Run the selected unit/webhook/config/worker suites and the real PostgreSQL callback suite once against the existing single PostgreSQL service. Stop after the first pass; retain the container and remove only staged files.

- [ ] **Step 4: Request independent review**

Review boundaries: security/ownership, migration parity, fencing, crash recovery, URL retention/leakage, service idempotency, route claim state, default-off composition, and provider isolation. Resolve every Critical/Important finding with focused TDD.

- [ ] **Step 5: Commit final docs/fixes and verify clean tree**

```bash
git status --porcelain
git rev-parse HEAD
git merge-base HEAD 651b8bf63c32a1e2f0caf295fe0b28aad830c960
```

No push, merge, image operation, production action, or GitHub Actions execution is authorized.
