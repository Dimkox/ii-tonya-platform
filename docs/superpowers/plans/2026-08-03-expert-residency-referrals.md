# Expert Residency Referrals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the disabled-by-default expert-to-expert referral and residency billing bounded context defined by ERR-FR-001 through ERR-FR-042.

**Architecture:** Keep expert referral codes, RUB credit, residency orders, and provider-neutral payment facts separate from client coupons and message-unit billing. Pure domain functions own arithmetic; PostgreSQL transactions own locks, idempotency, allocation, settlement, refund, and append-only state; application services authorize commands; API, Telegram, workers, and prompts remain thin adapters.

**Tech Stack:** Node.js 24, TypeScript 5.8, pnpm 11, Fastify 5, PostgreSQL, Drizzle ORM/Kit, Vitest, fast-check, OpenTelemetry, GitHub Actions.

## Global Constraints

- PostgreSQL and its database clock are the financial source of truth.
- Use integer kopecks and `bigint`; never use floating-point money.
- Reward amount is exactly `100000n` kopecks and expires after exactly 365 days.
- Credit applied to an order is at most `priceMinor / 2n`, rounded down; cash is the exact remainder.
- Refunds return captured cash only and never restore or cash out spent referral credit.
- All balance-affecting entries are append-only and carry mandatory per-grant allocations.
- Expert codes contain at least 128 random bits and persist only HMAC-SHA-256 plus key version and masked suffix.
- A batch contains 1 through 1000 codes; outstanding and rolling 30-day inviter quotas are both 1000 unless a bounded, dual-approved override applies.
- Settlement is valid only while `db_now < payment_deadline`; expiry wins at equality.
- `EXPERT_REFERRAL_ENABLED` and `EXPERT_RESIDENCY_BILLING_ENABLED` default to `false`; no deployment may set either to `true` without the recorded activation approval.
- Live provider SDKs, network calls, credentials, and payment-provider composition remain forbidden.
- Client `500/500` coupons and message-unit billing remain unchanged.
- The LLM may request typed operations and explain server-derived facts; it may not calculate or mutate financial state.
- Tariff price uses PostgreSQL `bigint`; APIs serialize minor units as decimal strings and reject values outside signed 64-bit range.
- Tariff duration is a fixed integer `duration_seconds` from 86400 through 315360000; residency arithmetic uses UTC instants.
- Each task must pass its focused tests and `git diff --check` before its commit.

## File Structure

- `packages/domain/src/expert-referral.ts`: pure quote, FIFO, expiry, reversal, debt, and residency interval rules.
- `packages/db/src/schema/expert-residency.ts`: all expert referral/residency tables, enums, views, and relations.
- `packages/db/src/repositories/expert-referral-repository.ts`: HMAC lookup persistence, issuance quotas, revocation, and redemption transactions.
- `packages/db/src/repositories/expert-residency-repository.ts`: tariff, quote, reservation, settlement, refund, ledger, and residency transactions.
- `packages/db/src/repositories/expert-residency-provider-inbox-repository.ts`: authenticated provider-event inbox and payment-attempt idempotency.
- `packages/db/src/repositories/expert-referral-control-repository.ts`: durable feature controls, abuse holds, and transaction-time eligibility reads.
- `packages/db/src/repositories/expert-referral-worker-repository.ts`: bounded expiry, reconciliation, and feature-hold replay claims.
- `packages/contracts/src/expert-residency.ts`: provider-neutral canonical payment commands and events.
- `packages/integrations/src/expert-residency/`: disabled payment adapter, verified-event boundary, and environment-backed HMAC-secret resolver; no live provider implementation.
- `packages/application/src/expert-referral-service.ts`: expert redemption and balance queries.
- `packages/application/src/expert-residency-service.ts`: quote, checkout, settlement, refund, and replay orchestration.
- `packages/application/src/expert-referral-admin-service.ts`: authorized batch, tariff, revocation, override, inventory, and kill-switch workflows.
- `apps/api/src/routes/expert-referral.ts`: authenticated expert HTTP commands and queries.
- `apps/api/src/routes/expert-referral-admin.ts`: approved admin commands and masked inventory.
- `packages/worker/src/expert-residency-*.ts`: bounded expiry, reconciliation, and held-reward jobs.
- `docs/runbooks/expert-residency-referrals.md`: operating, reconciliation, activation, rollback, and recovery procedure.

---

### Task 1: Establish the reviewed scope boundary

**Files:**

- Create: `tests/repo/expert-referral-scope-guards.test.ts`
- Modify: `tests/repo/scope-boundary.test.ts`
- Modify: `tests/repo/support/payment-scope-boundary.ts`

**Interfaces:**

- Consumes: current payment and commercial-scope classifiers.
- Produces: `EXPERT_RESIDENCY_ALLOWED_PATHS` and negative probes that permit only the named provider-neutral bounded context.

- [ ] **Step 1: Write the failing allowlist and bypass tests**

```ts
expect(EXPERT_RESIDENCY_ALLOWED_PATHS).toEqual(
  expect.arrayContaining([
    "packages/contracts/src/expert-residency.ts",
    "packages/integrations/src/expert-residency/payment-port.ts",
  ]),
);
expect(
  classifyPaymentScopeProbe({
    path: "packages/integrations/src/expert-residency/live-provider.ts",
    content: 'export const send = () => fetch("https://provider.invalid")',
  }),
).not.toEqual([]);
expect(
  classifyPaymentScopeProbe({
    path: "packages/domain/src/client-coupon.ts",
    content: "export const coupon500 = 500",
  }),
).not.toEqual([]);
```

- [ ] **Step 2: Run the focused guard and observe the missing allowlist failure**

Run: `pnpm vitest run tests/repo/expert-referral-scope-guards.test.ts tests/repo/scope-boundary.test.ts`

Expected: FAIL because `EXPERT_RESIDENCY_ALLOWED_PATHS` is not exported and the new reviewed paths are not classified.

- [ ] **Step 3: Add exact path and content rules**

```ts
export const EXPERT_RESIDENCY_ALLOWED_PATHS = new Set([
  "packages/contracts/src/expert-residency.ts",
  "packages/integrations/src/expert-residency/payment-port.ts",
  "packages/integrations/src/expert-residency/disabled-payment-adapter.ts",
  "packages/integrations/src/expert-residency/verified-event.ts",
  "packages/integrations/src/expert-residency/environment-secret-resolver.ts",
]);

export const EXPERT_RESIDENCY_ALLOWED_RELATIONS = new Set([
  "expert_referral_code_batches",
  "expert_referral_codes",
  "expert_referrals",
  "expert_residency_tariff_versions",
  "expert_residency_orders",
  "expert_residency_payment_attempts",
  "expert_residency_provider_event_inbox",
  "expert_first_residency_settlements",
  "expert_referral_reward_grants",
  "expert_referral_ledger_entries",
  "expert_referral_ledger_allocations",
  "expert_referral_issuance_overrides",
  "expert_referral_abuse_holds",
  "expert_referral_feature_controls",
  "expert_referral_balances",
]);

export const EXPERT_RESIDENCY_ALLOWED_ROUTES = new Set([
  "/v1/expert/referrals/redeem",
  "/v1/expert/referrals/summary",
  "/v1/expert/residency/quotes",
  "/v1/expert/residency/checkouts",
  "/v1/admin/expert-referrals/inventory",
]);

export const EXPERT_RESIDENCY_ALLOWED_FLAGS = new Set([
  "EXPERT_REFERRAL_ENABLED",
  "EXPERT_RESIDENCY_BILLING_ENABLED",
  "EXPERT_REFERRAL_HMAC_KEY_VERSION",
  "EXPERT_REFERRAL_HMAC_KEY_REF",
  "EXPERT_REFERRAL_HMAC_KEYS_JSON",
]);

export const EXPERT_RESIDENCY_ALLOWED_ADMIN_ACTIONS = new Set([
  "expert_referral.batch_generate",
  "expert_referral.code_revoke",
  "expert_referral.issuance_override",
  "expert_referral.abuse_hold_open",
  "expert_referral.abuse_hold_close",
  "expert_referral.hold_replay",
  "expert_referral.feature_switch",
  "expert_residency.tariff_create",
  "expert_residency.tariff_retire",
]);

const forbiddenProviderContent =
  /\b(fetch|axios|stripe|yookassa|PAYMENT_API_KEY)\b/u;
```

Register migration `0018_expert_residency_referrals.sql`, its snapshot/journal changes, the exact admin actions, and all relations/routes/flags above in Task 1. Keep unknown payment paths, relations, migrations, routes, commands, and flags forbidden. Retain the explicit ban on `packages/domain/src/coupon.ts`, `packages/domain/src/referral.ts`, provider SDKs, network calls, and payment secrets. Task 12 may update content hashes only after the final reviewed artifacts exist; it must not first authorize their names or capabilities.

- [ ] **Step 4: Run guard tests**

Run: `pnpm vitest run tests/repo/expert-referral-scope-guards.test.ts tests/repo/scope-boundary.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the reviewed boundary**

```bash
git add tests/repo/expert-referral-scope-guards.test.ts tests/repo/scope-boundary.test.ts tests/repo/support/payment-scope-boundary.ts
git commit -m "test: define expert residency scope boundary"
```

### Task 2: Implement pure financial and residency rules

**Files:**

- Create: `packages/domain/src/expert-referral.ts`
- Create: `packages/domain/src/expert-referral.test.ts`
- Create: `packages/domain/src/expert-referral.property.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: decimal-string minor units and UTC `Date` values supplied by trusted application/database adapters.
- Produces: `quoteResidency`, `allocateCreditFifo`, `rewardExpiresAt`, `resolveRewardReversal`, `applyRewardToDebt`, and `nextResidencyInterval`.

- [ ] **Step 1: Write failing examples for the public functions**

```ts
expect(quoteResidency(999n, 999n)).toEqual({
  creditMinor: 499n,
  cashMinor: 500n,
});
expect(rewardExpiresAt(new Date("2026-08-03T00:00:00.000Z"))).toEqual(
  new Date("2027-08-03T00:00:00.000Z"),
);
expect(
  nextResidencyInterval({
    currentEndsAt: new Date("2026-09-01T00:00:00.000Z"),
    settledAt: new Date("2026-08-03T00:00:00.000Z"),
    durationSeconds: 2_592_000,
  }),
).toEqual({
  startsAt: new Date("2026-09-01T00:00:00.000Z"),
  endsAt: new Date("2026-10-01T00:00:00.000Z"),
});
```

- [ ] **Step 2: Run examples and verify RED**

Run: `pnpm vitest run packages/domain/src/expert-referral.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement checked integer arithmetic and state results**

```ts
export function quoteResidency(priceMinor: bigint, availableMinor: bigint) {
  if (priceMinor <= 0n || availableMinor < 0n) throw new Error("invalid_money");
  const creditMinor =
    availableMinor < priceMinor / 2n ? availableMinor : priceMinor / 2n;
  return { creditMinor, cashMinor: priceMinor - creditMinor } as const;
}

export function settlementBeforeDeadline(now: Date, deadline: Date): boolean {
  return now.getTime() < deadline.getTime();
}
```

Implement FIFO ordering by `(expiresAt, grantedAt, grantId)`, mandatory allocation totals, 365-day UTC expiry, reversal `{remove, cancelReservations, debt}`, debt-first reward application, and fixed-second residency extension. Reject invalid dates, negative values, overflow beyond signed PostgreSQL `bigint`, and durations outside the global bounds.

- [ ] **Step 4: Add property tests**

```ts
fc.assert(
  fc.property(
    fc.bigInt({ min: 1n, max: 9_223_372_036_854_775_807n }),
    fc.bigInt({ min: 0n, max: 9_223_372_036_854_775_807n }),
    (price, available) => {
      const quote = quoteResidency(price, available);
      return (
        quote.creditMinor * 2n <= price &&
        quote.cashMinor + quote.creditMinor === price
      );
    },
  ),
);
```

Cover FIFO stability, non-negative available balance, expiry equality, replay-stable reversal, `pending_feature_hold`, and `cancelled_by_refund`.

- [ ] **Step 5: Run domain tests and package checks**

Run: `pnpm vitest run packages/domain/src/expert-referral.test.ts packages/domain/src/expert-referral.property.test.ts && pnpm --filter @ii-tonya/domain typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the pure domain**

```bash
git add packages/domain/src/expert-referral.ts packages/domain/src/expert-referral.test.ts packages/domain/src/expert-referral.property.test.ts packages/domain/src/index.ts package.json
git commit -m "feat: add expert referral domain rules"
```

### Task 3: Add the empty PostgreSQL schema and migration

**Files:**

- Create: `packages/db/src/schema/expert-residency.ts`
- Create: `packages/db/migrations/0018_expert_residency_referrals.sql`
- Create: `packages/db/migrations/meta/0018_snapshot.json`
- Create: `tests/integration/expert-referral-schema.test.ts`
- Create: `tests/integration/expert-referral-migration-upgrade.test.ts`
- Create: `scripts/preflight-expert-referral-migration.mjs`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `tests/integration/schema.test.ts`
- Modify: `tests/repo/db-schema-parity.test.ts`
- Modify: `tests/repo/support/payment-scope-boundary.ts`

**Interfaces:**

- Consumes: `experts`, `admin_approvals`, `admin_sessions`, audit/outbox conventions.
- Produces: typed schema exports for batches, codes, referrals, tariffs, orders, attempts, provider inbox, first settlements, reward grants, ledger allocations, issuance overrides, abuse holds, durable feature controls, and derived balance views.

- [ ] **Step 1: Write failing schema-contract tests**

```ts
expect(await columns("expert_residency_orders")).toEqual(
  expect.arrayContaining([
    "price_minor",
    "duration_seconds",
    "credit_minor",
    "cash_minor",
    "payment_deadline",
  ]),
);
expect(await columns("expert_referral_abuse_holds")).toEqual(
  expect.arrayContaining([
    "expert_id",
    "status",
    "reason_code",
    "opened_approval_id",
    "closed_approval_id",
  ]),
);
expect(await effectiveControl("expert_referrals")).toMatchObject({
  newCommandsEnabled: false,
  rewardGrantsEnabled: false,
  persisted: false,
});
await expectDatabaseError(
  () =>
    insertOrder({
      priceMinor: 999n,
      creditMinor: 500n,
      cashMinor: 499n,
    }),
  { code: "23514", constraint: "expert_order_credit_cap" },
);
await expectDatabaseError(() => overlapTariffVersions(), {
  code: "23P01",
  constraint: "expert_tariff_active_interval_exclusion",
});
```

Assert no mutable balance column, one expert per existing `users.id`, one referral per invitee/code, inviter differs from invitee, reward equals `100000`, one first-settlement marker per expert, at most one open abuse hold per expert, one versioned feature-control singleton, provider event uniqueness, decimal money bounds, exact order remainder, and append-only ledger triggers.

Add an upgrade fixture using the current 0017 schema with two `experts` rows sharing one `user_id`. Assert the preflight and migration both fail before any 0018 relation is created, with SQLSTATE `P0001` and marker `expert_user_identity_duplicates`.

- [ ] **Step 2: Run schema tests and verify RED**

Run: `pnpm vitest run tests/integration/expert-referral-schema.test.ts tests/integration/expert-referral-migration-upgrade.test.ts tests/repo/db-schema-parity.test.ts`

Expected: FAIL because the relations are absent and the 0017 duplicate fixture is not yet stopped by the `expert_user_identity_duplicates` preflight/migration guard.

- [ ] **Step 3: Define the Drizzle schema**

```ts
export const expertResidencyOrders = pgTable("expert_residency_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  expertId: uuid("expert_id")
    .notNull()
    .references(() => experts.id),
  priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  creditMinor: bigint("credit_minor", { mode: "bigint" }).notNull(),
  cashMinor: bigint("cash_minor", { mode: "bigint" }).notNull(),
  paymentDeadline: timestamp("payment_deadline", {
    withTimezone: true,
  }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
});
```

Define all design tables with explicit enums, unique/index/check/foreign-key constraints. Add a unique constraint on `experts.user_id`; existing `channel_identities(provider, external_id)` remains the authoritative unique external identity signal, so no raw identity fingerprint or additional PII is stored. Add `expert_referral_abuse_holds` with an audited open/close lifecycle and `expert_referral_feature_controls` with optimistic `version`, `new_commands_enabled`, and `reward_grants_enabled`. Use a separate allocation relation keyed by `(ledger_entry_id, reward_grant_id)` so every credit reservation, release, spend, expiry, and reversal is attributable to grants.

- [ ] **Step 4: Generate and harden migration 0018**

Run: `pnpm --filter @ii-tonya/db exec drizzle-kit generate --name expert_residency_referrals`

Expected: migration `0018_expert_residency_referrals.sql`, snapshot, and journal entry are created.

Add `btree_gist`, the `[active_from, active_to)` tariff exclusion constraint, append-only triggers for grants/ledger/allocations/referrals, and derived balance/debt views. The single first-settlement marker instead has a guarded monotonic trigger: immutable identity/order/referral/settlement/captured-eligibility columns cannot change; only `pending_feature_hold -> eligible | permanently_ineligible | cancelled_by_refund` is permitted; terminal updates and every delete fail closed. Seed nothing. An absent feature-control row is read as disabled; the first approved feature-switch command inserts version 1. Seed no tariff, code, referral, reward, order, or balance. After migration and snapshot content is final, calculate their normalized SHA-256 values and add them to `approvedMigrationHashes` in the same commit; the planned path names were already authorized in Task 1.

Before any 0018 DDL, execute this fail-closed guard:

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM experts GROUP BY user_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'expert_user_identity_duplicates';
  END IF;
END $$;
```

`scripts/preflight-expert-referral-migration.mjs` runs the same read-only grouped query and exits nonzero with only duplicate group count, never expert/user identifiers. Require `duplicate_groups=0` in migration evidence. If duplicates exist, stop: do not merge, delete, reassign, or choose a canonical expert automatically; remediation requires a separately reviewed data-repair plan and explicit approval.

- [ ] **Step 5: Run migration replay, schema parity, and database tests**

Run: `pnpm vitest run tests/integration/expert-referral-schema.test.ts tests/integration/expert-referral-migration-upgrade.test.ts tests/integration/schema.test.ts tests/repo/db-schema-parity.test.ts`

Expected: PASS against real PostgreSQL.

- [ ] **Step 6: Obtain and record the migration review marker**

Run the read-only preflight against the target snapshot and record `EXPERT-IDENTITY-PREFLIGHT: duplicate_groups=0`. Record `MIGRATION-COMPATIBILITY: <commit-sha>` from a reviewer who did not author the migration. Do not merge or activate schema behavior without both gates.

- [ ] **Step 7: Commit the schema**

```bash
git add packages/db/src/schema packages/db/migrations scripts/preflight-expert-referral-migration.mjs tests/integration/expert-referral-schema.test.ts tests/integration/expert-referral-migration-upgrade.test.ts tests/integration/schema.test.ts tests/repo/db-schema-parity.test.ts tests/repo/support/payment-scope-boundary.ts
git commit -m "feat: add expert residency schema"
```

### Task 4: Implement secure code issuance, quotas, revocation, and redemption

**Files:**

- Create: `packages/application/src/expert-code-crypto.ts`
- Create: `packages/application/src/expert-code-crypto.test.ts`
- Create: `packages/db/src/repositories/expert-referral-repository.ts`
- Create: `packages/db/src/repositories/expert-referral-repository.test.ts`
- Create: `packages/db/src/repositories/expert-referral-control-repository.ts`
- Create: `packages/db/src/repositories/expert-referral-control-repository.test.ts`
- Create: `packages/db/src/testkit/expert-referral.ts`
- Create: `tests/integration/expert-referral-redemption.test.ts`
- Create: `tests/integration/expert-referral-redemption-concurrency.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes: `ExpertCodeCrypto.issue(count)` returning plaintext once plus `{hash,keyVersion,maskedSuffix}`; an injected `ExpertCodeKeyring` resolved from a secret reference; active/verified expert rows; existing unique channel identity; no open abuse hold; dual-approved overrides.
- Produces: `issueBatch`, `revokeCode`, `redeemCode`, masked inventory, durable feature-control, abuse-hold lifecycle, and transaction-scoped eligibility operations.

- [ ] **Step 1: Write failing crypto and repository tests**

```ts
const issued = crypto.issue(2);
expect(issued[0]?.plaintext).toMatch(/^EXR_[A-Za-z0-9_-]{22,}$/u);
expect(issued[0]?.digest).toMatch(/^hmac-sha256:v1:[0-9a-f]{64}$/u);
expect(JSON.stringify(await storedCodes())).not.toContain(issued[0]?.plaintext);
await expect(redeemConcurrently(issued[0]!.plaintext)).resolves.toEqual({
  succeeded: 1,
  rejected: 1,
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/application/src/expert-code-crypto.test.ts tests/integration/expert-referral-redemption.test.ts tests/integration/expert-referral-redemption-concurrency.test.ts`

Expected: FAIL because crypto and repository modules are absent.

- [ ] **Step 3: Implement injected HMAC issuance and lookup**

```ts
export interface ExpertCodeKeyring {
  readonly currentVersion: string;
  key(version: string): Uint8Array;
}

export function digestExpertCode(
  code: string,
  version: string,
  key: Uint8Array,
): string {
  return `hmac-sha256:${version}:${createHmac("sha256", key).update(code).digest("hex")}`;
}
```

Generate 16 random bytes per code with `randomBytes`, normalize only the `EXR_` namespace, use `timingSafeEqual` where direct digest comparison occurs, and redact plaintext/digests from errors and logs.

The keyring retains current and previous active key versions so lookup tries the version stored with each code. It accepts key bytes only from an injected resolver, zeroes disposable buffers after construction, and never reads `process.env`, files, or the network from domain/application code.

- [ ] **Step 4: Implement serializable issuance/redemption transactions**

Under one inviter row/advisory lock, enforce batch size, 1000 outstanding-or-unsettled, rolling 30-day 1000, and valid two-distinct-admin override. Insert the entire batch or nothing. Redemption locks code, expert, user/channel identity, and abuse-hold rows; checks active/verified, exactly one expert for the user, unique provider/external identity, no open abuse hold, no prior binding, no prior settled residency, and no self-referral; then atomically consumes code and inserts immutable binding.

Implement `PostgresExpertReferralControlRepository.lockEligibility(tx, expertId)` and `lockFeatureControl(tx)` so checkout, settlement, refund, and replay can read the same rows inside their existing transaction. Absence means disabled. Control updates use expected version and audited approval/session references; no process-local cache is permitted. Abuse-hold open/close methods are audited, idempotent, and serialize on the expert row.

- [ ] **Step 5: Run security and concurrency tests repeatedly**

Run the focused tests once, then: `pnpm test:repeat -- 3 tests/integration/expert-referral-redemption-concurrency.test.ts`

Expected: PASS in every repetition; exactly one concurrent redemption wins.

- [ ] **Step 6: Commit code lifecycle**

```bash
git add packages/application/src/expert-code-crypto* packages/db/src/repositories/expert-referral-repository* packages/db/src/repositories/expert-referral-control-repository* packages/db/src/testkit/expert-referral.ts packages/db/src/index.ts tests/integration/expert-referral-redemption*
git commit -m "feat: add expert referral code lifecycle"
```

### Task 5: Implement tariffs, quote, checkout, and FIFO reservation

**Files:**

- Create: `packages/db/src/repositories/expert-residency-repository.ts`
- Create: `packages/db/src/repositories/expert-residency-repository.test.ts`
- Create: `tests/integration/expert-residency-checkout.test.ts`
- Create: `tests/integration/expert-residency-checkout-concurrency.test.ts`
- Create: `tests/integration/expert-residency-deadline.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes: domain `quoteResidency`/`allocateCreditFifo`, active verified expert, one active tariff version, ledger-derived grants/debt.
- Produces: `createTariffVersion`, `retireTariffVersion`, `quote`, `createCheckoutOrder`, `releaseExpiredOrders`, and read-only balance projection.

- [ ] **Step 1: Write failing order and concurrency tests**

```ts
expect(await quote({ priceMinor: 250001n, availableMinor: 200000n })).toEqual({
  creditMinor: 125000n,
  cashMinor: 125001n,
});
expect((await order()).allocations.map((row) => row.grantId)).toEqual([
  "earliest-expiry-grant",
  "later-expiry-grant",
]);
expect(await settleAtDeadline()).toEqual({ kind: "expired", released: true });
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run tests/integration/expert-residency-checkout.test.ts tests/integration/expert-residency-checkout-concurrency.test.ts tests/integration/expert-residency-deadline.test.ts`

Expected: FAIL because the repository is absent.

- [ ] **Step 3: Implement tariff and quote reads**

Select the one active tariff at `transaction_timestamp()`, reject overlaps, serialize price/credit/cash as strings at public boundaries, and snapshot `tariffVersionId`, display name, price, currency `RUB`, `durationSeconds`, credit, and cash into the order.

- [ ] **Step 4: Implement FIFO reservation transaction**

Lock eligible grants ordered by `expires_at, granted_at, id`; exclude expired, reserved, reversed, and debt-offset value; calculate the 50% cap; append reservation entries and allocations; set `payment_deadline = least(provider_deadline, earliest_allocated_expires_at)`. Repeated idempotency keys return the same immutable order or reject conflicting content.

- [ ] **Step 5: Implement equality-safe expiry**

Use one row lock and database comparison:

```sql
CASE
  WHEN transaction_timestamp() < payment_deadline THEN 'settlement_allowed'
  ELSE 'expire_and_release'
END
```

Release each allocation exactly once and prohibit negative spendable balance during concurrent checkouts.

- [ ] **Step 6: Run focused and repeated tests**

Run the focused tests once, then: `pnpm test:repeat -- 3 tests/integration/expert-residency-checkout-concurrency.test.ts`

Expected: PASS; equality always expires and all concurrent totals reconcile.

- [ ] **Step 7: Commit checkout accounting**

```bash
git add packages/db/src/repositories/expert-residency-repository* packages/db/src/index.ts tests/integration/expert-residency-checkout* tests/integration/expert-residency-deadline.test.ts
git commit -m "feat: add residency quote and reservation"
```

### Task 6: Add provider-neutral contracts, inbox, and settlement

**Files:**

- Create: `packages/contracts/src/expert-residency.ts`
- Create: `packages/integrations/src/expert-residency/payment-port.ts`
- Create: `packages/integrations/src/expert-residency/verified-event.ts`
- Create: `packages/integrations/src/expert-residency/verified-event.test.ts`
- Create: `packages/integrations/src/expert-residency/disabled-payment-adapter.ts`
- Create: `packages/integrations/src/expert-residency/disabled-payment-adapter.test.ts`
- Create: `packages/db/src/repositories/expert-residency-provider-inbox-repository.ts`
- Create: `packages/db/src/repositories/expert-residency-provider-inbox-repository.test.ts`
- Create: `tests/contract/expert-residency-payment-port.test.ts`
- Create: `tests/integration/expert-residency-settlement.test.ts`
- Create: `tests/integration/expert-residency-settlement-concurrency.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**

- Consumes: branded `VerifiedExpertResidencyPaymentEvent` values produced only by an injected verifier boundary, plus immutable order expectations.
- Produces: `ExpertResidencyPaymentPort`, durable inbox claim, first-settlement marker, order settlement, residency interval, reward/debt repayment, audit, and outbox facts.

- [ ] **Step 1: Write failing provider contract tests**

```ts
const rawEvent: ExpertResidencyPaymentEvent = {
  kind: "settled",
  provider: "sandbox",
  eventId: "evt_00000001",
  paymentId: "pay_00000001",
  orderId,
  amountMinor: "50000",
  currency: "RUB",
  occurredAt: "2026-08-03T00:00:00.000Z",
  payloadDigest: `sha256:${"a".repeat(64)}`,
};
expect(expertResidencyPaymentEventSchema.parse(rawEvent)).toEqual(rawEvent);
await expect(settle(rawEvent)).rejects.toThrow("verified_event_required");
const verified = verifiedEventFixture(rawEvent, {
  verificationId: "verify_00000001",
  verifierKeyVersion: "sandbox-v1",
  verifiedAt: "2026-08-03T00:00:01.000Z",
});
await expect(settle(verified)).resolves.toMatchObject({ kind: "settled" });
```

Reject extra fields, raw payload persistence, mismatched amount/currency, malformed digests, duplicate event content conflicts, and unverified authentication.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run tests/contract/expert-residency-payment-port.test.ts tests/integration/expert-residency-settlement.test.ts tests/integration/expert-residency-settlement-concurrency.test.ts`

Expected: FAIL because contracts and repository behavior do not exist.

- [ ] **Step 3: Define the provider-neutral port and disabled adapter**

```ts
export interface ExpertResidencyPaymentPort {
  createCheckout(
    command: ExpertResidencyCheckoutCommand,
  ): Promise<ExpertResidencyCheckoutOutcome>;
  reconcile(
    paymentId: string,
  ): Promise<VerifiedExpertResidencyPaymentEvent | null>;
}

export interface ExpertResidencyPaymentEventVerifier {
  verify(
    input: Readonly<{
      rawBody: Uint8Array;
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<
    | { kind: "verified"; event: VerifiedExpertResidencyPaymentEvent }
    | { kind: "rejected" }
  >;
}

export class DisabledExpertResidencyPaymentAdapter implements ExpertResidencyPaymentPort {
  async createCheckout(): Promise<never> {
    throw new Error("expert_residency_payments_disabled");
  }
  async reconcile(): Promise<null> {
    return null;
  }
}
```

Do not import a provider SDK, read provider credentials, call `fetch`, or register a live webhook route.

`VerifiedExpertResidencyPaymentEvent` carries a non-exported `unique symbol` brand and verification evidence `{verificationId, verifierKeyVersion, verifiedAt, payloadDigest}`. Only the verifier module and a test-only fixture factory can construct it. Production composition uses a disabled verifier that always rejects until a separately approved provider verifier exists.

- [ ] **Step 4: Implement inbox and settlement as one transaction**

Accept only the branded verified type. Claim unique `(provider,event_id)` and persist verification ID/key version/time, authentication result, and payload digest without raw payload. Under locks, verify order, amount, currency, deadline, expert eligibility/anti-abuse, residency, reservation, referral, and first-settlement key. Commit allocations, create interval from `max(current_end, settled_at)`, insert monotonic first marker, append reward or debt repayment only for `eligible`, then audit/outbox. Identical replay returns the prior result; conflicting replay fails closed.

- [ ] **Step 5: Run contract and concurrency tests repeatedly**

Run the focused tests once, then: `pnpm test:repeat -- 3 tests/integration/expert-residency-settlement-concurrency.test.ts`

Expected: PASS; one first-settlement marker and at most one reward exist.

- [ ] **Step 6: Commit neutral settlement support**

```bash
git add packages/contracts/src packages/integrations/src/expert-residency packages/integrations/src/index.ts packages/db/src/repositories/expert-residency-provider-inbox-repository* tests/contract/expert-residency-payment-port.test.ts tests/integration/expert-residency-settlement*
git commit -m "feat: add provider neutral residency settlement"
```

### Task 7: Implement refunds, reversals, debt, and held rewards

**Files:**

- Create: `tests/integration/expert-residency-refund-reversal.test.ts`
- Create: `tests/integration/expert-residency-hold-replay.test.ts`
- Modify: `packages/db/src/repositories/expert-residency-repository.ts`
- Modify: `packages/db/src/repositories/expert-residency-provider-inbox-repository.ts`

**Interfaces:**

- Consumes: branded verified partial/full refund or chargeback events and per-grant historical allocations.
- Produces: cash-only refund facts, reward reversal/debt, `pending_feature_hold`, `cancelled_by_refund`, and idempotent held-reward replay.

- [ ] **Step 1: Write failing financial-race tests**

```ts
expect(await partialRefund()).toMatchObject({
  cashRefundedMinor: 10000n,
  rewardReversed: false,
});
expect(await fullRefundAfterSpend()).toMatchObject({
  restoredCreditMinor: 0n,
  debtMinor: 60000n,
});
await settleWhileRewardsDisabled();
await terminateWithChargeback();
await enableAndReplayHeldRewards();
expect(await inviterRewardFacts()).toHaveLength(0);
expect(await firstMarker()).toMatchObject({
  eligibility: "cancelled_by_refund",
});
await openAbuseHoldBeforeSettlement();
expect(await settleWithOpenAbuseHold()).toMatchObject({
  rewardGranted: false,
  eligibility: "ineligible_abuse_hold",
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run tests/integration/expert-residency-refund-reversal.test.ts tests/integration/expert-residency-hold-replay.test.ts`

Expected: FAIL because refund/reversal transitions are absent.

- [ ] **Step 3: Implement allocation-derived reversal**

In one transaction, bound cumulative refund to captured cash; never restore credit. On terminating refund/chargeback, remove unspent active allocation, cancel active reservations, preserve expired value as expired, and convert historically spent allocation to debt. New reward grants repay debt before creating available credit. Every compensating fact is idempotent and references its original.

- [ ] **Step 4: Implement held-marker race resolution**

When reward creation is disabled, settlement writes `pending_feature_hold` without a balance fact and captures the locked settlement-time expert/user/channel identity and abuse-hold eligibility result. A terminating refund/chargeback locks the marker and writes terminal `cancelled_by_refund`. Replay locks marker, payment, order, residency, and durable control; it grants only if state is still settled/active, the database reward switch is enabled, and the captured settlement-time eligibility was valid.

- [ ] **Step 5: Run focused and repeated race tests**

Run the focused tests once, then: `pnpm test:repeat -- 3 tests/integration/expert-residency-hold-replay.test.ts`

Expected: PASS; the hold-refund-replay sequence always creates zero reward.

- [ ] **Step 6: Obtain financial state-machine review and commit**

Require an independent reviewer to record `FINANCIAL-STATE-MACHINE: <commit-sha>` after the tests pass.

```bash
git add packages/db/src/repositories/expert-residency-repository.ts packages/db/src/repositories/expert-residency-provider-inbox-repository.ts tests/integration/expert-residency-refund-reversal.test.ts tests/integration/expert-residency-hold-replay.test.ts
git commit -m "feat: add residency refund and reversal rules"
```

### Task 8: Add application services, feature flags, and kill-switch semantics

**Files:**

- Create: `packages/application/src/expert-referral-service.ts`
- Create: `packages/application/src/expert-referral-service.test.ts`
- Create: `packages/application/src/expert-referral-service.testkit.ts`
- Create: `packages/application/src/expert-residency-service.ts`
- Create: `packages/application/src/expert-residency-service.test.ts`
- Create: `packages/application/src/expert-residency-service.testkit.ts`
- Create: `packages/application/src/expert-code-secret-resolver.ts`
- Create: `packages/integrations/src/expert-residency/environment-secret-resolver.ts`
- Create: `packages/integrations/src/expert-residency/environment-secret-resolver.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `deploy/runtime.env.example`
- Modify: `scripts/validate-runtime-env.sh`

**Interfaces:**

- Consumes: authenticated expert/admin identities, repository ports, disabled payment port, environment capability ceilings, durable transaction-time controls, and an injected HMAC secret resolver.
- Produces: `ExpertReferralService`, `ExpertResidencyService`, `PostgresExpertReferralControlRepository`, and startup-validated `ExpertCodeKeyring` composition.

- [ ] **Step 1: Write failing service and configuration tests**

```ts
const enabled = loadEnv({
  ...baseEnv,
  EXPERT_REFERRAL_ENABLED: "true",
  EXPERT_REFERRAL_HMAC_KEY_VERSION: "v1",
  EXPERT_REFERRAL_HMAC_KEY_REF: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
  EXPERT_REFERRAL_HMAC_KEYS_JSON:
    '{"v1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}',
});
expect(enabled.features.expertReferral).toBe(true);
await expect(startWithMissingKeyReference()).rejects.toThrow(
  "expert_referral_key_unavailable",
);
expect(await service.redeemCode(otherExpert, code)).toEqual({
  kind: "forbidden",
});
expect(await service.quote(owner, tariffId)).toEqual({
  priceMinor: "200000",
  creditMinor: "100000",
  cashMinor: "100000",
});
```

Assert new commands require both the environment capability ceiling and the durable `new_commands_enabled` control. Settlement-time reward decisions read durable `reward_grants_enabled` inside the same PostgreSQL transaction and record the control version. No process caches the control row. Authenticated settlement/refund reconciliation, release, expiry, reversal, debt, and held-marker persistence remain callable while new commands are disabled.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/application/src/expert-referral-service.test.ts packages/application/src/expert-residency-service.test.ts packages/config/src/env.test.ts`

Expected: FAIL because services and flags are absent.

- [ ] **Step 3: Define narrow repository ports and factories**

```ts
export interface ExpertReferralService {
  redeemCode(
    principal: ExpertPrincipal,
    code: string,
    idempotencyKey: string,
  ): Promise<RedeemResult>;
  summary(principal: ExpertPrincipal): Promise<ReferralSummary>;
}

export const createExpertReferralService = (
  deps: ExpertReferralDependencies,
): ExpertReferralService => ({
  redeemCode: (principal, code, idempotencyKey) =>
    deps.commands.redeem({ principal, code, idempotencyKey }),
  summary: (principal) => deps.queries.summary(principal.expertId),
});
```

Keep service files framework-free and import production types only from application/contracts/domain.

Define `ExpertReferralControlPort` with `readForCommand()` and repository transaction methods that lock `expert_referral_feature_controls`, expert/user/channel identity, and open abuse holds. Define admin lifecycle operations `openAbuseHold`, `closeAbuseHold`, and `updateFeatureControl` with optimistic version and approval references. Eligibility is active user + active/verified expert + unique `experts.user_id`/`channel_identities` + no open abuse hold.

- [ ] **Step 4: Add default-off runtime configuration and secret resolution**

```ts
EXPERT_REFERRAL_ENABLED: z.enum(["true", "false"]).default("false"),
EXPERT_RESIDENCY_BILLING_ENABLED: z.enum(["true", "false"]).default("false"),
EXPERT_REFERRAL_HMAC_KEY_VERSION: z.string().regex(/^v[1-9]\d*$/u),
EXPERT_REFERRAL_HMAC_KEY_REF: z.literal("env://EXPERT_REFERRAL_HMAC_KEYS_JSON"),
```

When the referral ceiling is `true`, require the reference and resolve `EXPERT_REFERRAL_HMAC_KEYS_JSON` as a version-to-base64url-key map with at least 32 decoded bytes per retained version. Require the configured current version and every active-code version returned by the repository; otherwise fail startup before listening. When the ceiling is `false`, do not resolve key material. Examples contain only the reference and fake-key marker, never a key value. Never include resolved bytes, encoded values, or secret variable contents in logs/errors/config output; log key versions only.

The durable database switch is authoritative for immediate multi-instance behavior. New commands require both environment ceiling and database switch. Settlement/refund/replay always runs and reads the locked database control version; a disabled reward switch writes `pending_feature_hold`. There is no process cache, so admin switch commits take effect on the next transaction.

- [ ] **Step 5: Run focused tests and env guards**

Run: `pnpm vitest run packages/application/src/expert-referral-service.test.ts packages/application/src/expert-residency-service.test.ts packages/db/src/repositories/expert-referral-control-repository.test.ts packages/integrations/src/expert-residency/environment-secret-resolver.test.ts packages/config/src/env.test.ts apps/api/src/server.test.ts tests/repo/env-policy.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit application boundaries**

```bash
git add packages/application/src/expert-* packages/application/src/index.ts packages/integrations/src/expert-residency/environment-secret-resolver* packages/integrations/src/index.ts packages/config/src/env* apps/api/src/server* .env.example compose.yaml deploy/runtime.env.example scripts/validate-runtime-env.sh
git commit -m "feat: add disabled expert residency services"
```

### Task 9: Add approved admin workflows and masked inventory

**Files:**

- Create: `packages/application/src/expert-referral-admin-service.ts`
- Create: `packages/application/src/expert-referral-admin-service.test.ts`
- Create: `apps/api/src/routes/expert-referral-admin.ts`
- Create: `apps/api/src/routes/expert-referral-admin.test.ts`
- Modify: `packages/db/src/repositories/admin-approval-repository.ts`
- Modify: `packages/db/src/repositories/admin-approval-repository.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**

- Consumes: existing canonical payload hash, authenticated session, role assignments, two-person approval, referral/tariff repositories, and durable control/abuse-hold repository.
- Produces: batch issue, revoke, tariff create/retire, quota override, abuse-hold open/close, held replay, feature switch, and masked inventory endpoints.

- [ ] **Step 1: Write failing authorization and redaction tests**

```ts
expect(
  await requestAdminAction("expert_referral.batch_generate", { count: 1001 }),
).toMatchObject({ statusCode: 400 });
expect(await selfApproveOverride()).toMatchObject({ statusCode: 403 });
expect(await featureSwitchWithStaleVersion()).toMatchObject({
  statusCode: 409,
});
expect(await openAndCloseAbuseHold()).toEqual({
  openedWithApproval: true,
  closedWithApproval: true,
  openHolds: 0,
});
const response = await approvedBatch(2);
expect(response.json().codes).toHaveLength(2);
expect(JSON.stringify(await inventory())).not.toContain(
  response.json().codes[0],
);
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/application/src/expert-referral-admin-service.test.ts packages/db/src/repositories/admin-approval-repository.test.ts apps/api/src/routes/expert-referral-admin.test.ts`

Expected: FAIL because actions and routes are absent.

- [ ] **Step 3: Add exact canonical admin actions**

Add `expert_referral.batch_generate`, `expert_referral.code_revoke`, `expert_referral.issuance_override`, `expert_referral.abuse_hold_open`, `expert_referral.abuse_hold_close`, `expert_residency.tariff_create`, `expert_residency.tariff_retire`, `expert_referral.hold_replay`, and `expert_referral.feature_switch`. Bind exact object IDs and canonical payloads to approval records. Override requires two distinct approvers and cannot be consumed beyond count/expiry. Abuse holds require a bounded reason code and approval for both lifecycle transitions. Feature switch updates require expected control version, persist the acting approval/session and audit event atomically, and never enable a capability above the environment ceiling.

- [ ] **Step 4: Implement separate admin routes**

Use the existing bearer/session hash, request/approve/execute workflow, bounded JSON schemas, non-enumerable errors, rate limits, and body redaction. Plaintext batch codes are returned once only from successful execution. Inventory returns `{batchId,status,maskedSuffix,createdAt}` and never digest/plaintext.

- [ ] **Step 5: Run admin and integration tests**

Run: `pnpm vitest run packages/application/src/expert-referral-admin-service.test.ts packages/db/src/repositories/admin-approval-repository.test.ts apps/api/src/routes/expert-referral-admin.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts tests/integration/admin-approval.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit admin workflows**

```bash
git add packages/application/src/expert-referral-admin-service* packages/db/src/repositories/admin-approval-repository* apps/api/src/routes/expert-referral-admin* apps/api/src/app* apps/api/src/server*
git commit -m "feat: add expert referral admin workflows"
```

### Task 10: Add expert API, Telegram views, and prompt-safe proposals

**Files:**

- Create: `apps/api/src/routes/expert-referral.ts`
- Create: `apps/api/src/routes/expert-referral.test.ts`
- Create: `packages/application/src/expert-prompt-context.ts`
- Create: `packages/application/src/expert-prompt-context.test.ts`
- Create: `tests/fixtures/prompts/llm-05-set-referral-balance.json`
- Create: `tests/fixtures/prompts/llm-06-set-referral-code.json`
- Create: `tests/fixtures/prompts/llm-07-set-residency-price.json`
- Create: `tests/fixtures/prompts/llm-08-fake-settlement.json`
- Create: `tests/fixtures/prompts/llm-09-cross-expert-referral.json`
- Modify: `apps/api/src/routes/telegram-webhook.ts`
- Modify: `apps/api/src/routes/telegram-webhook.test.ts`
- Modify: `packages/integrations/src/telegram/telegram-adapter.ts`
- Modify: `packages/integrations/src/telegram/telegram-adapter.test.ts`
- Modify: `packages/integrations/src/telegram/callback-token.ts`
- Modify: `packages/integrations/src/telegram/callback-token.test.ts`
- Modify: `packages/application/src/ports.ts`
- Modify: `packages/application/src/conversation-service.ts`
- Modify: `packages/application/src/prompt-safety.test.ts`

**Interfaces:**

- Consumes: authenticated expert identity, typed callback claims, referral/residency services, server-derived summary/quote.
- Produces: redeem, balance, quote, and checkout commands plus read-only prompt context and typed LLM proposals.

- [ ] **Step 1: Write failing route, callback, and malicious-prompt tests**

```ts
expect(await redeemAsWrongExpert()).toMatchObject({ statusCode: 403 });
expect(await quoteWithClientSuppliedPrice()).toMatchObject({ statusCode: 400 });
expect(
  validateIntentProposal({ kind: "set_referral_balance", amount: 999999 }),
).toEqual({
  valid: false,
  reasonCode: "unsupported_intent",
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/src/routes/expert-referral.test.ts apps/api/src/routes/telegram-webhook.test.ts packages/application/src/expert-prompt-context.test.ts packages/application/src/prompt-safety.test.ts`

Expected: FAIL because expert commands and proposal validation are absent.

- [ ] **Step 3: Add typed requests with no financial authority**

```ts
export type IntentProposal =
  | ExistingIntentProposal
  | { readonly kind: "redeem_expert_referral"; readonly code: string }
  | { readonly kind: "view_referral_summary" }
  | { readonly kind: "quote_residency"; readonly tariffVersionId: string }
  | { readonly kind: "start_residency_checkout"; readonly orderId: string };
```

Reject proposal fields for balance, price, credit, inviter, settlement, payment IDs, ledger facts, cross-expert IDs, or provider payloads. Reauthorize each proposal through the service principal.

- [ ] **Step 4: Implement thin HTTP and Telegram adapters**

Routes accept only code/idempotency key or server-issued tariff/order IDs. Callback claims bind `expertId`, operation, object ID, nonce, and expiry. Telegram renders masked code status, decimal-string balance/debt, nearest expiry, and server quote; it never computes amounts or mutates repositories directly.

- [ ] **Step 5: Run prompt regressions and adapter tests**

Run: `pnpm vitest run apps/api/src/routes/expert-referral.test.ts apps/api/src/routes/telegram-webhook.test.ts packages/integrations/src/telegram packages/application/src/expert-prompt-context.test.ts packages/application/src/prompt-safety.test.ts`

Expected: PASS with all five malicious fixtures rejected.

- [ ] **Step 6: Record AI release evidence and commit**

Record incident regression results, proposal distribution/diff against the prior prompt version, and named human spot-check. This is evidence preparation only; it does not enable staging.

```bash
git add apps/api/src/routes/expert-referral* apps/api/src/routes/telegram-webhook* packages/integrations/src/telegram packages/application/src/ports.ts packages/application/src/conversation-service.ts packages/application/src/expert-prompt-context* packages/application/src/prompt-safety.test.ts tests/fixtures/prompts
git commit -m "feat: add prompt safe expert referral interface"
```

### Task 11: Add bounded worker jobs, reconciliation, and telemetry

**Files:**

- Create: `packages/db/src/repositories/expert-referral-worker-repository.ts`
- Create: `packages/db/src/repositories/expert-referral-worker-repository.test.ts`
- Create: `packages/worker/src/expert-residency-expiry.ts`
- Create: `packages/worker/src/expert-residency-expiry.test.ts`
- Create: `packages/worker/src/expert-residency-reconciliation.ts`
- Create: `packages/worker/src/expert-residency-reconciliation.test.ts`
- Create: `packages/worker/src/expert-referral-hold-replay.ts`
- Create: `packages/worker/src/expert-referral-hold-replay.test.ts`
- Modify: `packages/worker/src/index.ts`
- Modify: `apps/worker/src/runtime.ts`
- Modify: `apps/worker/src/runtime.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/main.test.ts`
- Modify: `packages/observability/src/metrics.ts`
- Create: `packages/observability/src/metrics.test.ts`

**Interfaces:**

- Consumes: bounded PostgreSQL claim operations with `FOR UPDATE SKIP LOCKED`, disabled provider reader, kill-switch-independent existing-state processing.
- Produces: expiry/release, provider mismatch incidents, held-reward replay results, and bounded-label metrics.

- [ ] **Step 1: Write failing worker and metric tests**

```ts
expect(await expireAtExactDeadline()).toEqual({
  examined: 1,
  changed: 1,
  failed: 0,
});
expect(await replayCancelledHold()).toEqual({
  examined: 1,
  granted: 0,
  cancelled: 1,
});
expect(() => referralMetricLabels({ expertId: crypto.randomUUID() })).toThrow();
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/worker/src/expert-residency-expiry.test.ts packages/worker/src/expert-residency-reconciliation.test.ts packages/worker/src/expert-referral-hold-replay.test.ts packages/observability/src/metrics.test.ts apps/worker/src/runtime.test.ts`

Expected: FAIL because jobs and counters are absent.

- [ ] **Step 3: Implement bounded job functions**

```ts
export async function replayHeldRewards(
  repo: HeldRewardRepository,
  now: Date,
  batchSize: number,
) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error("invalid_batch_size");
  }
  return repo.replayDueBatch({ now, batchSize });
}
```

Repository methods own transactions, locks, eligibility/state rechecks, idempotency, audit, and mismatch creation. Feature flags may block new commands but never these existing-state jobs.

- [ ] **Step 4: Wire jobs into the worker lifecycle**

Add distinct report fields for `expertResidencyExpiry`, `expertResidencyReconciliation`, and `expertReferralHoldReplay`; preserve sequential bounded execution, single-cycle protection, graceful shutdown, and disabled-provider outcome.

- [ ] **Step 5: Add bounded metrics**

Counters/histograms cover code lifecycle, redemption, reward outcome, credit spend/expiry, debt, duplicate events, held replay, refund/reversal, and reconciliation mismatch. Labels are limited to `module`, `operation`, `outcome`, and bounded `errorCode`; never include codes, expert IDs, payment IDs, names, hashes, or payloads.

- [ ] **Step 6: Run worker, repository, and observability tests**

Run: `pnpm vitest run packages/db/src/repositories/expert-referral-worker-repository.test.ts packages/worker/src/expert-residency-expiry.test.ts packages/worker/src/expert-residency-reconciliation.test.ts packages/worker/src/expert-referral-hold-replay.test.ts packages/observability/src/metrics.test.ts apps/worker/src/runtime.test.ts apps/worker/src/main.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit operations code**

```bash
git add packages/db/src/repositories/expert-referral-worker-repository* packages/worker/src/expert-* packages/worker/src/index.ts apps/worker/src/runtime* apps/worker/src/main* packages/observability/src/metrics*
git commit -m "feat: add expert residency background controls"
```

### Task 12: Complete traceability, CI, runbooks, and release evidence

**Files:**

- Create: `tests/e2e/expert-residency-referral.test.ts`
- Create: `docs/runbooks/expert-residency-referrals.md`
- Create: `docs/runbooks/expert-residency-referrals-rollback.md`
- Create: `docs/spec/expert-residency-referrals-traceability.md`
- Modify: `.github/workflows/db-gate.yml`
- Modify: `package.json`
- Modify: `tests/repo/workflow-semantics.test.ts`
- Modify: `tests/repo/env-policy.test.ts`
- Modify: `tests/repo/architecture-boundaries.test.ts`
- Modify: `tests/repo/workspace-layout.test.ts`
- Modify: `docs/security/threat-model-and-go-live-gates.md`
- Modify: `docs/operations/reconciliation.md`

**Interfaces:**

- Consumes: all prior tasks and their focused evidence.
- Produces: ERR-FR-001..042 traceability, mandatory CI, recovery procedures, and a disabled release candidate; no staging or production activation.

- [ ] **Step 1: Write failing traceability and workflow tests**

```ts
const ids = Array.from(
  { length: 42 },
  (_, index) => `ERR-FR-${String(index + 1).padStart(3, "0")}`,
);
for (const id of ids) expect(traceability).toContain(`| ${id} |`);
expect(dbGate).toContain("expert-residency-settlement-concurrency.test.ts");
expect(dbGate).toContain("expert-residency-hold-replay.test.ts");
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run tests/repo/workflow-semantics.test.ts tests/repo/env-policy.test.ts tests/repo/architecture-boundaries.test.ts tests/repo/workspace-layout.test.ts`

Expected: FAIL until traceability, paths, and mandatory checks are registered.

- [ ] **Step 3: Add end-to-end disabled-boundary coverage**

Test admin approval through one-time code issuance, expert redemption, tariff quote, reservation, canonical sandbox settlement, inviter reward, 50/50 renewal, partial refund, full refund/reversal, debt-first future reward, expiry, replay, kill switch, and zero live provider calls. Use deterministic fixtures and real PostgreSQL.

- [ ] **Step 4: Add mandatory CI gates**

Database Gate must replay migrations, verify schema parity, and run redemption/reservation/settlement/deadline/quota/refund/hold concurrency tests repeatedly. Main CI must run domain properties, provider contracts, prompt regressions/diff, scope bypass negatives, secret/log leakage, full regression, audit, image smoke/scan, and signed provenance. Do not weaken existing checks or ignore unfixed HIGH/CRITICAL vulnerabilities.

- [ ] **Step 5: Write operating and rollback runbooks**

Document feature-off deployment, key rotation by version, one-time batch handling, kill switch, reconciliation, held replay, refund/chargeback response, debt investigation, metric thresholds, incident escalation, database recovery, migration rollback/forward-fix, and proof that client `500/500` remains isolated. Commands use clearly synthetic identifiers and name the responsible approver.

- [ ] **Step 6: Build the requirement traceability matrix**

For each `ERR-FR-001` through `ERR-FR-042`, record code files, focused tests, mandatory CI job, telemetry, recovery/rollback, and approval owner. No row may contain blank implementation or verification cells.

- [ ] **Step 7: Run the complete local verification**

Run: `pnpm verify`

Expected: build, formatting, deployment checks, lint, typecheck, unit, property, integration, contract, security, e2e, and production dependency audit all PASS.

Run: `pnpm test:repeat -- 3 tests/integration/expert-referral-redemption-concurrency.test.ts tests/integration/expert-residency-checkout-concurrency.test.ts tests/integration/expert-residency-settlement-concurrency.test.ts tests/integration/expert-residency-deadline.test.ts tests/integration/expert-residency-hold-replay.test.ts`

Expected: all 20 repetitions PASS.

- [ ] **Step 8: Commit release-readiness evidence**

```bash
git add .github/workflows/db-gate.yml package.json tests/e2e/expert-residency-referral.test.ts tests/repo docs/runbooks/expert-residency-referrals* docs/spec/expert-residency-referrals-traceability.md docs/security/threat-model-and-go-live-gates.md docs/operations/reconciliation.md
git commit -m "docs: add expert residency release gates"
```

- [ ] **Step 9: Stop at the deployment approval boundary**

Push the implementation branch and open/update a draft PR. Require green exact-SHA hosted CI, independent migration and financial reviews, authenticated sandbox settlement/refund/replay evidence, named AI spot-check, and a fresh explicit staging authorization. Production requires a separate explicit authorization and is not part of this plan.

## Requirement Coverage

| Requirements                                                                                               | Implemented and verified by |
| ---------------------------------------------------------------------------------------------------------- | --------------------------- |
| ERR-FR-001, ERR-FR-002, ERR-FR-003, ERR-FR-004, ERR-FR-029, ERR-FR-038, ERR-FR-039, ERR-FR-040             | Tasks 1, 3, 4, 9, 12        |
| ERR-FR-005, ERR-FR-006, ERR-FR-007, ERR-FR-008                                                             | Tasks 3, 4, 8, 10, 12       |
| ERR-FR-009, ERR-FR-010, ERR-FR-011, ERR-FR-012, ERR-FR-013, ERR-FR-030                                     | Tasks 2, 3, 5, 12           |
| ERR-FR-014, ERR-FR-015, ERR-FR-016, ERR-FR-017, ERR-FR-018, ERR-FR-019, ERR-FR-020, ERR-FR-031, ERR-FR-032 | Tasks 2, 3, 5, 6, 11, 12    |
| ERR-FR-021, ERR-FR-022, ERR-FR-023, ERR-FR-024, ERR-FR-033, ERR-FR-034                                     | Tasks 2, 3, 7, 11, 12       |
| ERR-FR-025, ERR-FR-026, ERR-FR-027, ERR-FR-028                                                             | Tasks 8, 9, 10, 12          |
| ERR-FR-035, ERR-FR-036, ERR-FR-037                                                                         | Tasks 1, 3, 6, 12           |
| ERR-FR-041, ERR-FR-042                                                                                     | Tasks 7, 8, 11, 12          |

## Human Approval Gates

1. Scope-guard widening review after Task 1.
2. Independent PostgreSQL migration compatibility review after Task 3.
3. Independent financial state-machine review after Task 7.
4. Provider contract approval before any provider adapter; this plan creates none.
5. Named human AI behavior spot-check after Task 10.
6. Exact-SHA CI and explicit staging authorization after Task 12.
7. Separate production authorization after successful staging evidence.
