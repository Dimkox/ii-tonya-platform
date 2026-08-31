# Partner Commerce A: Onboarding and Shadow Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a default-off vertical slice in which an authenticated user can create and confirm an `EXPERT`, `CENTER`, or `ORGANIZER` participant profile and obtain a deterministic, immutable center/organizer shadow quote without creating payment state.

**Architecture:** Add a separate Partner Commerce application contract, additive PostgreSQL migration/schema, one transactional repository, thin application services, and authenticated HTTP routes. Reuse existing identity, audit, idempotency, strict-schema, feature-flag, and composition patterns; do not alter expert tariffs/referrals or call YooKassa/Selarti.

**Tech Stack:** TypeScript 5.8, Node.js 24, Fastify, PostgreSQL 17, Drizzle ORM, Vitest, pnpm 11.9.0.

**Spec:** `docs/superpowers/specs/2026-08-30-partner-commerce-and-acquisition-economics-design.md`

## Global Constraints

- Expert V2 tariffs remain exactly `3,900 / 5,900 / 9,990 RUB`; no expert price may exceed `9,990 RUB`.
- Partner kinds are exactly `EXPERT | CENTER | ORGANIZER`; kind is participant-scoped, not a global user role.
- Center tier prices are `15,000 / 12,000 / 8,000 RUB`; organizer tier prices are `20,000 / 15,000 / 10,000 RUB` for counts `0-5 / 6-9 / 10+`.
- Partner-only surcharges are `3,000 RUB` for online-only and `5,000 RUB` for a verified city-million-plus location; both may apply.
- This release stores only shadow quotes; it creates no payment attempt, checkout URL, residency settlement, referral reward, coupon, bonus, event commission, or provider request.
- PostgreSQL owns participant state, policy selection, idempotency, quote snapshots, and audit facts.
- Selarti, prompts, Telegram payloads, browser payloads, Make, and Sheets cannot select kind, tier, price, surcharge, or state transition.
- All provider features and both new Partner Commerce feature flags default to false.
- Migrations are additive; existing expert/client/package/payment/referral facts are not rewritten.
- Same idempotency key plus a different canonical payload returns a conflict; replay returns the original result.
- Use `corepack pnpm` when `pnpm` is not directly available.

---

### Task 1: Partner Commerce contracts and deterministic price calculator

**Files:**

- Create: `packages/domain/src/partner-pricing.ts`
- Test: `packages/domain/src/partner-pricing.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/application/src/partner-commerce.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**

- Produces:
  - `PartnerParticipantKind = "EXPERT" | "CENTER" | "ORGANIZER"`
  - `PartnerTier = "STANDARD" | "REFERRED_6_9" | "REFERRED_10_PLUS"`
  - `ParticipantOnboardingState`
  - `PartnerParticipantPrincipal`
  - `PartnerPolicySnapshot`
  - `PartnerShadowQuote`
  - `calculatePartnerShadowQuote(input)`
- Consumes: no new project interface.

- [ ] **Step 1: Write the failing price-matrix tests**

Create table tests asserting these exact totals in minor RUB:

```ts
it.each([
  ["CENTER", 0, false, false, "STANDARD", 1_500_000],
  ["CENTER", 6, false, false, "REFERRED_6_9", 1_200_000],
  ["CENTER", 10, false, false, "REFERRED_10_PLUS", 800_000],
  ["ORGANIZER", 0, false, false, "STANDARD", 2_000_000],
  ["ORGANIZER", 6, false, false, "REFERRED_6_9", 1_500_000],
  ["ORGANIZER", 10, false, false, "REFERRED_10_PLUS", 1_000_000],
  ["CENTER", 10, true, true, "REFERRED_10_PLUS", 1_600_000],
  ["ORGANIZER", 6, true, true, "REFERRED_6_9", 2_300_000],
] as const)(
  "calculates %s count %i",
  (kind, count, onlineOnly, cityMillionPlus, tier, finalPriceMinor) => {
    expect(
      calculatePartnerShadowQuote({
        kind,
        qualifiedExpertCount: count,
        onlineOnly,
        cityMillionPlus,
        policy: policy(kind),
      }),
    ).toMatchObject({
      tier,
      finalPriceMinor,
      currency: "RUB",
      durationSeconds: 2_592_000,
    });
  },
);
```

Also assert negative/non-integer counts, `EXPERT`, unknown policy kind, unsafe integers,
non-RUB policy, and inconsistent thresholds throw `partner_pricing_invalid`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
corepack pnpm exec vitest run packages/domain/src/partner-pricing.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Define exact immutable contracts**

Add readonly interfaces. `PartnerPolicySnapshot` contains:

```ts
readonly policyVersionId: string;
readonly policyVersion: number;
readonly kind: "CENTER" | "ORGANIZER";
readonly standardPriceMinor: number;
readonly referredSixPriceMinor: number;
readonly referredTenPriceMinor: number;
readonly onlineOnlySurchargeMinor: 300_000;
readonly cityMillionPlusSurchargeMinor: 500_000;
readonly currency: "RUB";
readonly durationSeconds: 2_592_000;
readonly eventEntitlements: readonly { readonly capacity: number; readonly count: number }[];
readonly residentCommissionBps: 1000;
readonly nonresidentCommissionBps: 1500;
readonly nonresidentCardFeeMinor: 450_000;
```

`PartnerShadowQuote` snapshots policy identity, kind, count, tier, base price, each
surcharge, final price, currency, duration, event entitlements, and commission terms.

- [ ] **Step 4: Implement the minimal pure calculator**

Use explicit thresholds: count `>=10`, else `>=6`, else standard. Use checked integer
addition and return a frozen-value-shaped readonly object. Do not import DB, config,
Selarti, payment, coupon, or expert-referral code.

- [ ] **Step 5: Export and verify GREEN**

Run the focused test, then:

```bash
corepack pnpm --filter @ii-tonya/domain typecheck
corepack pnpm --filter @ii-tonya/application typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/partner-pricing.ts packages/domain/src/partner-pricing.test.ts packages/domain/src/index.ts packages/application/src/partner-commerce.ts packages/application/src/index.ts
git commit -m "feat: add deterministic partner pricing contracts"
```

---

### Task 2: Additive Partner Commerce schema and migration

**Files:**

- Create: `packages/db/migrations/0037_partner_commerce_a.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Create: `packages/db/src/schema/partner-commerce.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `tests/integration/partner-commerce-a-migration.test.ts`
- Test: `tests/repo/partner-commerce-a-schema-parity.test.ts`

**Interfaces:**

- Consumes Task 1 enum/value names.
- Produces Drizzle exports:
  - `commercialParticipants`
  - `organizationProfiles`
  - `partnerTariffPolicyVersions`
  - `partnerShadowQuotes`
  - `partnerCommandReceipts`

- [ ] **Step 1: Write failing migration tests**

Tests must apply migrations through `0037` to PostgreSQL and prove:

- one user may have one profile of each kind but not duplicate the same kind;
- onboarding states are limited to `started`, `kind_selected`, `profile_incomplete`,
  `profile_ready`, `offer_available`;
- organization profiles are allowed only for `CENTER` and `ORGANIZER` participants;
- approved policy windows do not overlap for the same partner kind;
- policies and shadow quotes reject UPDATE and DELETE;
- policy prices/surcharges/duration/commission are positive and exact RUB integers;
- quote arithmetic conserves `base + online + city = final`;
- shadow quotes have no provider/payment/settlement columns;
- existing expert tariff rows and constraints remain byte-for-byte behavior-compatible.

- [ ] **Step 2: Run migration tests and verify RED**

Run:

```bash
corepack pnpm exec vitest run tests/integration/partner-commerce-a-migration.test.ts tests/repo/partner-commerce-a-schema-parity.test.ts
```

Expected: FAIL because migration/schema exports do not exist.

- [ ] **Step 3: Add migration `0037`**

Use UUID primary keys, `users(id)` ownership, timestamptz DB clocks, exact CHECK
constraints, partial indexes for active policies, and append-only triggers. Store policy
event entitlements as validated JSONB with exact keys:

```json
{ "bands": [{ "capacity": 30, "count": 10 }] }
```

for centers and:

```json
{
  "bands": [
    { "capacity": 50, "count": 5 },
    { "capacity": 100, "count": 3 },
    { "capacity": 500, "count": 1 }
  ]
}
```

for organizers. The migration must not insert an approved production policy. Tests seed
explicit approved policy fixtures through SQL.

- [ ] **Step 4: Add matching Drizzle schema**

Mirror every table, enum/check, index, FK, and timestamp name. Export only from the DB
schema barrel; do not add partner fields to `expert-residency.ts`.

- [ ] **Step 5: Update migration journal**

Append index `37`, version `7`, tag `0037_partner_commerce_a`, `breakpoints: true`, using a
monotonic `when` value greater than entry 36.

- [ ] **Step 6: Verify GREEN and migration compatibility**

Run the two focused files and:

```bash
corepack pnpm exec vitest run tests/integration/commercial-core-v2-migration.test.ts tests/repo/db-schema-parity.test.ts
```

Expected: all pass; expert commercial tests remain unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/db/migrations/0037_partner_commerce_a.sql packages/db/migrations/meta/_journal.json packages/db/src/schema/partner-commerce.ts packages/db/src/schema/index.ts tests/integration/partner-commerce-a-migration.test.ts tests/repo/partner-commerce-a-schema-parity.test.ts
git commit -m "feat: add partner commerce foundation schema"
```

---

### Task 3: Transactional onboarding and shadow-quote repository

**Files:**

- Create: `packages/db/src/repositories/partner-commerce-repository.ts`
- Create: `packages/db/src/repositories/partner-commerce-repository.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes Task 1 contracts and Task 2 tables.
- Produces `PostgresPartnerCommerceRepository` implementing:

```ts
start(input: { userId: string; idempotencyKey: string; payloadDigest: string; correlationId: string }): Promise<PartnerCommandResult>;
selectKind(input: { userId: string; participantId: string; kind: PartnerParticipantKind; idempotencyKey: string; payloadDigest: string; correlationId: string }): Promise<PartnerCommandResult>;
confirmKind(input: { userId: string; participantId: string; idempotencyKey: string; payloadDigest: string; correlationId: string }): Promise<PartnerCommandResult>;
upsertOrganizationProfile(input: { userId: string; participantId: string; displayName: string; city: string; cityMillionPlus: boolean; onlineOnly: boolean; idempotencyKey: string; payloadDigest: string; correlationId: string }): Promise<PartnerCommandResult>;
listActivePolicies(input: { kind: "CENTER" | "ORGANIZER" }): Promise<readonly PartnerPolicySnapshot[]>;
createShadowQuote(input: { userId: string; participantId: string; idempotencyKey: string; payloadDigest: string; correlationId: string }): Promise<PartnerShadowQuoteResult>;
```

- [ ] **Step 1: Write failing repository tests**

Use the migration-backed PostgreSQL fixture. Cover owner isolation, replay, same-key
payload conflict, duplicate kinds, multiple different kinds per user, invalid state
transition, organization profile restrictions, DB-clock policy selection, exact quote
snapshot, quote immutability, concurrent duplicate commands, and audit-event creation.

- [ ] **Step 2: Run focused repository tests and verify RED**

```bash
corepack pnpm exec vitest run packages/db/src/repositories/partner-commerce-repository.test.ts
```

- [ ] **Step 3: Implement command-receipt idempotency first**

Lock `(user_id, idempotency_key)`, compare canonical payload digest, and return the stored
safe result on replay. A different digest returns the typed conflict result and creates no
participant, profile, quote, or audit mutation.

- [ ] **Step 4: Implement state transitions and ownership**

Use one DB transaction and `FOR UPDATE` on participant rows. Every mutation verifies
`participant.user_id = input.userId`. Append an `audit_events` record with bounded action,
object ID, correlation ID, decision, and metadata hash.

- [ ] **Step 5: Implement shadow quote snapshot**

Load one active approved policy using the DB transaction timestamp, load the confirmed
participant/profile, derive count `0` in Release A, call Task 1's calculator, and insert the
complete immutable snapshot. Do not read referral tables and do not write payment/outbox,
coupon, bonus, or expert-credit rows.

- [ ] **Step 6: Verify GREEN and typecheck**

Run the focused repository file and DB package typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repositories/partner-commerce-repository.ts packages/db/src/repositories/partner-commerce-repository.test.ts packages/db/src/index.ts
git commit -m "feat: persist partner onboarding and shadow quotes"
```

---

### Task 4: Application onboarding and quote services

**Files:**

- Create: `packages/application/src/partner-onboarding-service.ts`
- Create: `packages/application/src/partner-onboarding-service.test.ts`
- Create: `packages/application/src/partner-quote-service.ts`
- Create: `packages/application/src/partner-quote-service.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**

- Consumes Task 3 repository methods behind explicit command/query ports.
- Produces `PartnerOnboardingService` and `PartnerQuoteService` with authenticated
  `PartnerParticipantPrincipal { userId: string }` only.

- [ ] **Step 1: Write failing application tests**

Cover exact input validation, principal forwarding, owner-forbidden mapping, replay,
conflict, state-transition errors, `EXPERT` rejection by partner quote service, deterministic
policy projection, and no repository call after invalid input.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
corepack pnpm exec vitest run packages/application/src/partner-onboarding-service.test.ts packages/application/src/partner-quote-service.test.ts
```

- [ ] **Step 3: Implement thin services**

Validate UUIDs, bounded text, booleans, exact enum values, idempotency keys, and SHA-256
payload digests. Do not duplicate pricing or persistence logic. Map repository results to
typed `ready | replayed | conflict | forbidden | invalid_state | unavailable` outcomes.

- [ ] **Step 4: Verify GREEN and typecheck**

Run focused tests and application typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/partner-onboarding-service.ts packages/application/src/partner-onboarding-service.test.ts packages/application/src/partner-quote-service.ts packages/application/src/partner-quote-service.test.ts packages/application/src/index.ts
git commit -m "feat: add partner onboarding application services"
```

---

### Task 5: Authenticated Partner Commerce HTTP routes

**Files:**

- Create: `apps/api/src/routes/partner-commerce.ts`
- Create: `apps/api/src/routes/partner-commerce.test.ts`
- Create: `apps/api/src/partner-principal-resolver.ts`
- Create: `apps/api/src/partner-principal-resolver.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Consumes Task 4 services and an injected authenticated user-principal resolver.
- Produces default-disabled endpoints:
  - `POST /v1/partner/onboarding`
  - `PUT /v1/partner/onboarding/:participantId/kind`
  - `POST /v1/partner/onboarding/:participantId/kind/confirm`
  - `PUT /v1/partner/onboarding/:participantId/profile`
  - `GET /v1/partner/offers?kind=CENTER|ORGANIZER`
  - `POST /v1/partner/quotes`

- [ ] **Step 1: Write failing route tests**

Model strict schemas after `expert-ai-ingress.ts` and resolve a server-owned user identity
through a narrow partner principal adapter based on the existing client-session resolver.
Assert missing/invalid bearer is 401,
foreign participant is 403, disabled capability is unavailable, malformed body is 400,
replay returns the original resource, payload conflict is 409, and quote response exposes
only the immutable safe projection.

- [ ] **Step 2: Run route tests and verify RED**

```bash
corepack pnpm exec vitest run apps/api/src/routes/partner-commerce.test.ts
```

- [ ] **Step 3: Implement route plugin**

Require `Idempotency-Key` on mutations, derive canonical body digest server-side, propagate
the request correlation ID, and never accept `qualifiedExpertCount`, tier, base price,
surcharge, final price, policy version, or onboarding state from the client.

- [ ] **Step 4: Register conditionally in app composition**

The plugin is registered only when `partnerOnboardingEnabled` and its dependencies are
present. Shadow quote endpoints additionally require `partnerShadowQuotesEnabled`.
Missing dependencies fail closed at startup or return the repository's existing
capability-unavailable convention; they never fall back to expert routes.

- [ ] **Step 5: Verify GREEN**

Run route tests and `apps/api` typecheck.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/partner-commerce.ts apps/api/src/routes/partner-commerce.test.ts apps/api/src/partner-principal-resolver.ts apps/api/src/partner-principal-resolver.test.ts apps/api/src/app.ts
git commit -m "feat: expose partner onboarding and shadow quotes"
```

---

### Task 6: Feature flags and server composition

**Files:**

- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Modify: `.env.example`
- Modify: `deploy/runtime.env.example`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**

- Produces exact flags:
  - `PARTNER_ONBOARDING_ENABLED=false`
  - `PARTNER_SHADOW_QUOTES_ENABLED=false`
- Consumes Task 3 repository, Task 4 services, and Task 5 route dependencies.

- [ ] **Step 1: Write failing config/composition tests**

Assert both defaults are false, only literal `true` enables a flag, shadow quote cannot be
enabled when onboarding is false, and enabled routes require DB plus all Partner Commerce
capabilities. Existing client/expert/Selarti flags remain independent.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
corepack pnpm exec vitest run packages/config/src/env.test.ts apps/api/src/server.test.ts
```

- [ ] **Step 3: Implement flags and wiring**

Add both placeholders to example env files with `false`. Construct the PostgreSQL
repository and services only when onboarding is enabled. Do not activate providers,
insert production policy rows, or read `.env`.

- [ ] **Step 4: Verify GREEN**

Run focused tests and config/API typechecks.

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/env.ts packages/config/src/env.test.ts .env.example deploy/runtime.env.example apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat: gate partner commerce composition"
```

---

### Task 7: Deterministic single-dialogue routing and economics documentation

**Files:**

- Modify: `packages/application/src/hybrid-message-gateway.ts`
- Modify: `packages/application/src/hybrid-message-gateway.test.ts`
- Modify: `README.md`
- Create: `tests/repo/partner-commerce-a-boundaries.test.ts`

**Interfaces:**

- Consumes Task 4 injected partner onboarding command parser/service.
- Preserves existing `deterministic | complex_dialogue` persistence contract.
- Produces deterministic route reasons for participant selection, profile completion,
  offer listing, and shadow quote requests.

- [ ] **Step 1: Write failing gateway and boundary tests**

Assert exact partner commands/buttons route deterministically, free-form objection text
remains eligible for `complex_dialogue`, and no Selarti request can carry or cause kind,
tier, price, quote, coupon, bonus, or payment mutation. Assert existing client and expert
gateway tests remain unchanged.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
corepack pnpm exec vitest run packages/application/src/hybrid-message-gateway.test.ts tests/repo/partner-commerce-a-boundaries.test.ts
```

- [ ] **Step 3: Add the injected deterministic partner classifier**

Recognize only versioned server-issued callback/command forms. Preserve canonical inbound
persistence, dialogue ordering, duplicate handling, consent, and one outbox. Do not give
Selarti direct messenger access.

- [ ] **Step 4: Update README unit economics and current-state graph**

Replace stale acquisition sensitivity with the approved 100/300-message current/stress
tables, 5/10/15/20% conversion, LTV thresholds, steady-state break-even, 72-message target,
and center/organizer gross sensitivity from the spec. Mark every figure planning-only and
list the missing observed inputs. Add Partner Commerce to the current-state section and
complete README stack graph without deleting existing edges.

- [ ] **Step 5: Run focused tests and documentation checks**

```bash
corepack pnpm exec vitest run packages/application/src/hybrid-message-gateway.test.ts tests/repo/partner-commerce-a-boundaries.test.ts
corepack pnpm format:check
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add packages/application/src/hybrid-message-gateway.ts packages/application/src/hybrid-message-gateway.test.ts tests/repo/partner-commerce-a-boundaries.test.ts README.md
git commit -m "feat: route partner onboarding deterministically"
```

---

### Task 8: Release A verification and handoff

**Files:**

- Create: `docs/spec/partner-commerce-a-traceability.md`
- Create: `docs/runbooks/partner-commerce-a-rollback.md`
- Modify: `README.md`

**Interfaces:**

- Consumes all Task 1-7 evidence.
- Produces requirement-to-test traceability and a default-off rollback procedure.

- [ ] **Step 1: Write traceability and rollback documents**

Map every Release A acceptance criterion to code, tests, telemetry, feature flags, and
recovery. Rollback sets both flags false, rejects new onboarding/quotes, preserves
participants/policies/quotes/audit facts, and requires no migration reversal.

- [ ] **Step 2: Run one bounded branch-finish verification**

Run exactly once:

```bash
corepack pnpm verify
```

Also run the PostgreSQL/Claw gate only through the repository's existing direct Claw
script; do not add GitHub Actions and do not deploy or activate providers.

- [ ] **Step 3: Record exact evidence**

Record commit SHA, commands, pass/fail totals, skipped tests, environment constraints,
and residual provider blockers in traceability. Do not claim YooKassa/Selarti staging
evidence.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/spec/partner-commerce-a-traceability.md docs/runbooks/partner-commerce-a-rollback.md README.md
git commit -m "docs: record partner commerce release A evidence"
```

- [ ] **Step 5: Independent reviews**

Request separate architecture/security, code, test, and release reviews against the full
base-to-head diff. Any product change after review invalidates branch-finish evidence and
must repeat the affected focused checks and exact-SHA review.
