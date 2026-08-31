# Commercial Core V2 A1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a disabled-by-default free-client commercial policy and authoritative V2
expert tariff/order snapshots with a 30% referral-credit ceiling while preserving legacy
package and 50% order behavior.

**Architecture:** PostgreSQL assigns each client one immutable commercial policy and
stores effective admission controls. Conversation orchestration selects zero-delta free
accounting or the existing package debit from that assignment. Expert tariff versions and
orders snapshot policy, cap, and entitlements; the domain quote accepts a server-owned
basis-point cap.

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, Vitest, fast-check, PostgreSQL 17.5,
Drizzle ORM, Fastify.

**Spec:** `docs/superpowers/specs/2026-08-28-free-client-hybrid-platform-v2-design.md`

## Global Constraints

- All new runtime and provider capabilities default off and fail closed.
- Migrations are additive-first; historical ledgers and settled order facts are immutable.
- Prices use RUB minor units; V2 prices are exactly `390000`, `590000`, or `999000`.
- V2 duration is exactly `2592000` seconds and V2 credit cap is exactly `3000` bps.
- Existing tariff/order rows retain `legacy_residency_v1` and `5000` bps snapshots.
- V2 clients never consume package units and never fall back to a package gate after
  assignment.
- One implementer owns application-code writes; reviewers are read-only.
- No live provider, credential, staging, production, merge, or deployment action.

---

### Task 1: Configurable Residency Credit Cap

**Files:**

- Modify: `packages/domain/src/expert-referral.ts`
- Modify: `packages/domain/src/expert-referral.test.ts`
- Modify: `packages/domain/src/expert-referral.property.test.ts`
- Modify: `packages/db/src/repositories/expert-residency-repository.ts`

**Interfaces:**

- Produces: `quoteResidency(priceMinor, availableMinor, creditCapBps = 5000)`.
- Preserves: every existing two-argument caller receives the legacy 50% result.

- [ ] **Step 1: Write RED examples and properties**

```ts
expect(quoteResidency(999n, 999n, 3000)).toEqual({
  creditMinor: 299n,
  cashMinor: 700n,
});
expect(() => quoteResidency(100n, 100n, -1)).toThrow("invalid_credit_cap");
expect(() => quoteResidency(100n, 100n, 10_001)).toThrow("invalid_credit_cap");
```

Add a fast-check property asserting
`creditMinor * 10000n <= priceMinor * BigInt(capBps)` and
`cashMinor + creditMinor === priceMinor` for caps `0..10000`.

- [ ] **Step 2: Run RED**

Run:
`pnpm --filter @ii-tonya/domain test -- expert-referral.test.ts expert-referral.property.test.ts`

Expected: FAIL because `quoteResidency` ignores the third argument.

- [ ] **Step 3: Implement bounded basis-point arithmetic**

```ts
export function quoteResidency(
  priceMinor: bigint,
  availableMinor: bigint,
  creditCapBps = 5_000,
) {
  assertMinor(priceMinor);
  assertMinor(availableMinor);
  if (priceMinor === 0n) throw new Error("invalid_money");
  if (
    !Number.isSafeInteger(creditCapBps) ||
    creditCapBps < 0 ||
    creditCapBps > 10_000
  ) {
    throw new Error("invalid_credit_cap");
  }
  const ceiling = (priceMinor * BigInt(creditCapBps)) / 10_000n;
  const creditMinor = availableMinor < ceiling ? availableMinor : ceiling;
  return { creditMinor, cashMinor: priceMinor - creditMinor } as const;
}
```

- [ ] **Step 4: Run GREEN and commit**

Run the Task 1 command, domain typecheck, and `git diff --check`.

Commit: `feat(domain): support versioned residency credit caps`

### Task 2: Commercial Policy and Snapshot Migration

**Files:**

- Create: `packages/db/migrations/0032_commercial_core_v2_a1.sql`
- Create: `packages/db/src/schema/commercial-policy.ts`
- Modify: `packages/db/src/schema/expert-residency.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/testkit/postgres.ts`
- Create: `tests/integration/commercial-core-v2-migration.test.ts`

**Interfaces:**

- Produces: `clientCommercialPolicyControls`, `clientCommercialPolicyAssignments`.
- Extends tariff/order rows with policy, cap, and four entitlement snapshots.

- [ ] **Step 1: Write migration RED assertions**

Test that a clean migrated database contains:

```ts
expect(columns).toEqual(
  expect.arrayContaining([
    "commercial_policy_version",
    "credit_cap_bps",
    "group_event_limit",
    "statistics_level",
    "support_priority",
  ]),
);
```

Insert a legacy tariff/order and assert defaults
`legacy_residency_v1`, `5000`, `0`, `basic`, `standard`. Assert a V2 order with
`credit_minor * 10000 > price_minor * credit_cap_bps` fails SQLSTATE `23514`.

- [ ] **Step 2: Run migration RED once**

Run:
`pnpm --filter @ii-tonya/db test -- commercial-core-v2-migration.test.ts`

Expected: FAIL because migration 0032 and tables do not exist.

- [ ] **Step 3: Add the additive schema**

The migration must create immutable assignments and audited controls:

```sql
CREATE TABLE client_commercial_policy_controls (
  control_key text PRIMARY KEY,
  admission_policy text NOT NULL,
  version integer NOT NULL,
  approval_id uuid NOT NULL REFERENCES admin_approvals(id),
  admin_session_id_hash text NOT NULL REFERENCES admin_sessions(session_id_hash),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_commercial_policy_control_key CHECK (control_key='client_access'),
  CONSTRAINT client_commercial_policy_control_policy CHECK
    (admission_policy IN ('legacy_package_v1','free_client_v2')),
  CONSTRAINT client_commercial_policy_control_version CHECK (version > 0),
  CONSTRAINT client_commercial_policy_control_approval_unique UNIQUE (approval_id)
);

CREATE TABLE client_commercial_policy_assignments (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  policy_version text NOT NULL,
  control_version integer NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_commercial_policy_assignment_policy CHECK
    (policy_version IN ('legacy_package_v1','free_client_v2')),
  CONSTRAINT client_commercial_policy_assignment_version CHECK (control_version > 0)
);
```

Add append-only update/delete triggers to assignments. Add tariff and order columns with
legacy defaults, backfill existing rows, then set `NOT NULL`. Replace
`expert_order_credit_cap` with:

```sql
CHECK (
  credit_cap_bps BETWEEN 0 AND 10000 AND
  credit_minor * 10000 <= price_minor * credit_cap_bps
)
```

Add checks for policy values, V2 cap `3000`, group limits `0..3`, statistics
`basic|expanded`, support `standard|priority`, and cash-plus-credit conservation.

- [ ] **Step 4: Mirror SQL in Drizzle and run GREEN**

Define exact enums as text checks rather than PostgreSQL enums so later policy versions
can use additive migrations. Export the new schema and update testkit cleanup/constraint
inventory.

Run migration compatibility, the focused test, DB typecheck, and `git diff --check`.

Commit: `feat(db): add commercial policy and tariff snapshots`

### Task 3: Audited V2 Commercial Admin Commands

**Files:**

- Modify: `packages/db/src/repositories/admin-approval-repository.ts`
- Modify: `packages/db/src/repositories/admin-repository.ts`
- Modify: `packages/db/src/repositories/expert-referral-admin-repository.ts`
- Modify: `packages/db/src/schema/expert-residency.ts`
- Modify: `apps/api/src/routes/expert-referral-admin.ts`
- Modify: `packages/db/src/repositories/admin-approval-repository.test.ts`
- Modify: `packages/db/src/repositories/expert-referral-admin-repository.test.ts`
- Modify: `apps/api/src/routes/expert-referral-admin.test.ts`

**Interfaces:**

- Consumes: Task 2 control and tariff columns.
- Produces actions `client_commercial_policy.control_v2` and
  `expert_residency.tariff_create_v2`.

- [ ] **Step 1: Add RED exact-payload tests**

Use this accepted tariff payload and reject every unknown/missing key:

```ts
{
  tariffKey: "START",
  displayName: "Старт",
  priceMinor: 390000,
  durationSeconds: 2592000,
  commercialPolicyVersion: "expert_residency_v2",
  creditCapBps: 3000,
  individualServicesEnabled: true,
  groupEventLimit: 0,
  statisticsLevel: "basic",
  supportPriority: "standard",
  activeFrom: "2026-09-01T00:00:00.000Z",
  activeTo: "2027-09-01T00:00:00.000Z"
}
```

Add BASE `590000/1/expanded/standard` and PRO
`999000/3/expanded/priority` cases. Add control optimistic-version tests for
`expectedVersion`, `admissionPolicy`, and exact audited result.

- [ ] **Step 2: Run route/repository RED**

Run the focused admin route, approval repository, and expert admin repository tests.
Expected: rejected unknown actions.

- [ ] **Step 3: Implement exact validation and transactional writes**

Map both actions to `entitlement_admin`. Enforce the three exact tariff combinations in
application validation and database checks. Control updates use
`UPDATE ... WHERE version = expectedVersion RETURNING version`; zero rows is a stable
stale-version conflict. V2 tariff inserts snapshot every field and remain immutable.

- [ ] **Step 4: Run GREEN and commit**

Run focused tests, DB/API typechecks, ESLint, Prettier, and diff check.

Commit: `feat(admin): add approved v2 commercial controls`

### Task 4: Serializable Client Policy Assignment

**Files:**

- Create: `packages/application/src/client-commercial-policy.ts`
- Create: `packages/db/src/repositories/client-commercial-policy-repository.ts`
- Create: tests beside both files.
- Create: `tests/integration/client-commercial-policy.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Produces `ClientCommercialPolicy = "legacy_package_v1" | "free_client_v2"`.
- Produces `resolveOrAssign({ userId, allowV2Admission }): Promise<ClientCommercialPolicy>`.

- [ ] **Step 1: Write RED ownership and concurrency tests**

Cover existing assignments, admission closed/open, absent control, stale control,
malformed policy, and two concurrent first assignments. The concurrent case must return
two identical V2 results and leave exactly one assignment row.

- [ ] **Step 2: Run RED once**

Run application/repository tests plus the focused PostgreSQL file. Expected: missing
service/repository.

- [ ] **Step 3: Implement bounded policy resolution**

```ts
export type ClientCommercialPolicy = "legacy_package_v1" | "free_client_v2";

export interface ClientCommercialPolicyPort {
  resolveOrAssign(input: {
    userId: string;
    allowV2Admission: boolean;
  }): Promise<ClientCommercialPolicy>;
}
```

The PostgreSQL implementation uses `withSerializableRetry`, validates UUID, takes a
user-scoped advisory transaction lock, returns an existing assignment first, and inserts
V2 only when both the environment ceiling and current audited control permit it. Missing
or malformed control fails closed; when the environment ceiling is false, assign legacy.

- [ ] **Step 4: Run GREEN and commit**

Run focused unit/PostgreSQL tests at most three times, package typechecks, lint, format,
and diff check.

Commit: `feat(db): assign immutable client commercial policies`

### Task 5: Free Client Conversation Accounting

**Files:**

- Modify: `packages/application/src/ports.ts`
- Modify: `packages/application/src/conversation-service.ts`
- Modify: `packages/application/src/conversation-service.test.ts`
- Modify: `packages/application/src/conversation-service.testkit.ts`
- Modify: `packages/db/src/repositories/message-repository.ts`
- Modify: `packages/db/src/repositories/message-repository.test.ts`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Modify: `apps/api/src/server.ts` and composition tests.

**Interfaces:**

- Consumes: `ClientCommercialPolicyPort` from Task 4.
- Adds `billingPolicy` to inbound completion and a `free` outbound result.

- [ ] **Step 1: Write RED client-flow tests**

Add cases proving a zero-package V2 client reaches answer/catalogue/booking, each result
has `chargedMessages: 0`, and the repository writes one `free` ledger fact. Preserve
legacy `no_package` and one-unit debit tests. Add rollback test: existing V2 assignment
plus `CLIENT_FREE_ACCESS_V2_ENABLED=false` remains free.

- [ ] **Step 2: Run application and repository RED**

Run only conversation service and message repository tests. Expected: V2 zero balance
returns `no_package`.

- [ ] **Step 3: Implement policy-aware completion**

Resolve policy after safety classification and before the ordinary package gate. Pass
`billingPolicy: "package" | "free"` to `completeInbound`. In the repository, `free`
calls the existing zero-delta `free(...)` path; `package` preserves debit/retry behavior.
Set `chargedMessages` from the committed ledger delta instead of hard-coding one.

For outbound delivery, resolve the immutable policy: V2 always calls
`recordOutboundDelivery(... charge: false)` and returns
`{ kind: "free", chargedMessages: 0 }`; legacy behavior remains controlled by
`SELARTI_OUTBOUND_BILLING_MODE`.

- [ ] **Step 4: Add fail-closed config/composition**

Add `CLIENT_FREE_ACCESS_V2_ENABLED` exact boolean default `false`; expose
`features.clientFreeAccessV2`. Enabling admission without a policy repository capability
must fail startup. Disabling admission must not override an existing V2 assignment.

- [ ] **Step 5: Run GREEN and commit**

Run focused application, DB, config, and server tests; affected typechecks; ESLint;
Prettier; diff check.

Commit: `feat(client): add free v2 conversation accounting`

### Task 6: V2 Tariff Discovery, Quote, and Checkout Snapshots

**Files:**

- Modify: `packages/application/src/expert-residency-service.ts` and tests/testkit.
- Modify: `packages/db/src/repositories/expert-residency-repository.ts` and tests.
- Modify: `apps/api/src/routes/expert-referral.ts` and tests.
- Modify: `packages/integrations/src/telegram/expert-command-processor.ts` and tests.
- Modify: `packages/integrations/src/telegram/telegram-adapter.ts` and tests.
- Modify: `packages/contracts/src/expert-residency.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**

- Extends `ResidencyTariff` and `ResidencyQuote` with policy, cap, and entitlements.
- Consumes Task 1 quote and Task 2 tariff/order columns.

- [ ] **Step 1: Write RED authoritative-snapshot tests**

Assert discovery and quote return server facts for each exact V2 tariff. Assert checkout
with abundant credit stores `creditCapBps=3000`, exact entitlements, policy version, and
`creditMinor=117000/177000/299700` for START/BASE/PRO. Preserve legacy 5000-bps tests.

- [ ] **Step 2: Run focused RED**

Run application, repository, HTTP route, command processor, and adapter test files.
Expected: missing V2 fields and 50% quote values.

- [ ] **Step 3: Implement server-owned snapshots**

Read cap and entitlements only from the active tariff row. Call
`quoteResidency(priceMinor, available, tariff.creditCapBps)`. Insert every snapshot into
the order in the same serializable transaction as FIFO credit reservation. HTTP and
Telegram render bounded names/prices/entitlements without accepting any financial input.

- [ ] **Step 4: Run GREEN and commit**

Run focused tests, affected typechecks, lint, format, and diff check.

Commit: `feat(residency): apply v2 tariff snapshots and credit cap`

### Task 7: A1 Integration, Documentation, and Review

**Files:**

- Create: `tests/integration/commercial-core-v2-a1.test.ts`
- Create: `docs/spec/commercial-core-v2-a1-traceability.md`
- Create: `docs/runbooks/commercial-core-v2-a1-rollback.md`
- Modify: `README.md`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**

- Records exact requirement-to-test, rollout, rollback, and activation boundaries.

- [ ] **Step 1: Add one end-to-end PostgreSQL test**

Create an approved V2 control and START tariff through audited commands, concurrently
assign one new client, complete a zero-package message as free, create a V2 residency
order with excess credit, and assert 30% cap plus immutable snapshots. Roll back the
transaction fixture and prove no external adapter was called.

- [ ] **Step 2: Run focused verification**

Run each changed package test once, migration compatibility, the A1 integration file,
affected typechecks, ESLint, Prettier, deploy-contract check, and `git diff --check`.
Run the full suite no more than once at branch finish.

- [ ] **Step 3: Update durable evidence**

Document flags default false, no production tariff seed, no provider activation, A2
maturity prerequisite, exact rollback, and known blocked live gates. README current state
and architecture graph must remain complete.

- [ ] **Step 4: Independent review and exact-SHA gates**

Dispatch read-only financial/data/security reviewers against the same SHA. Resolve every
Critical/Important finding with the same write owner, rerun affected checks, push the
branch, and require exact-SHA CI plus Database Gate success.

- [ ] **Step 5: Commit**

Commit: `docs: record commercial core v2 a1 evidence`

Do not merge, activate, stage, or deploy from this plan.
