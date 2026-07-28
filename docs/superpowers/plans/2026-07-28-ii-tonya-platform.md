# ии-Тоня Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production-shaped MVP of «ии-Тоня»: consent-aware messaging, deterministic safety routing, append-only message accounting, concurrency-safe booking, expert Telegram actions, durable provider integration, read-only operational projections, and auditable administration. Production activation remains blocked until every go-live decision and external contract has evidence.

**Architecture:** Use a TypeScript pnpm monorepo containing a modular transactional monolith with two deployables: a Fastify API and a PostgreSQL-backed worker. Domain and application packages own every state transition; PostgreSQL is the only authority. Provider-specific code sits behind narrow ports. Incoming events pass through authenticated inbox deduplication, business transactions write append-only facts plus a transactional outbox, and workers deliver side effects with bounded retry and reconciliation. Make and Google Sheets receive idempotent projections only. Live payments have no provider implementation in this plan: a disabled adapter is the only runtime binding until provider, prices, refund, chargeback, and legal rules are approved.

**Tech Stack:** Node.js 24 LTS, TypeScript strict mode, pnpm workspaces, Fastify, Zod, Drizzle ORM, PostgreSQL 17, Vitest, Testcontainers, Pino, OpenTelemetry, Docker Compose, GitHub Actions, Gitleaks, and Trivy.

## Source of truth

- `docs/spec/normalized-requirements.md`
- `docs/superpowers/specs/2026-07-28-ii-tonya-platform-design.md`
- `docs/security/threat-model-and-go-live-gates.md`

When these documents conflict, use the normalized requirements for MVP scope, the design specification for boundaries and data flow, and the threat model for stricter security or release behavior. A provider contract may refine its adapter only after its official version and sanitized fixtures are recorded.

## Global constraints

- PostgreSQL is authoritative for identity, consent, entitlements, ledgers, reservations, safety cases, audit, inbox, and outbox.
- Every externally initiated command has a stable idempotency key enforced by a database uniqueness constraint.
- Message and commercial facts are append-only; corrections are compensating entries, never row rewrites.
- Safety classification runs before package lookup or debit. Safety, system, integration-error, and no-package notices cost zero messages.
- Accepted ordinary inbound content costs one message and delivered ordinary assistant content costs one message. Retries and duplicates cost zero additional messages.
- A reservation deadline is `min(created_at + 72h, slot.start_at - confirmation_buffer)`. MVP configuration uses a one-hour confirmation buffer. A deadline at or before creation rejects the reservation.
- All persistence timestamps are UTC. Presentation timezone is explicit; the configured pilot default is `Europe/Moscow`.
- Optional profile fields are written only after purpose-specific explicit consent. Raw conversation logging is disabled. Minor onboarding is disabled until an approved minor policy exists.
- LLM output is an untrusted typed proposal. It cannot execute SQL, call arbitrary URLs, debit packages, mutate reservations, or send provider messages directly.
- Make and Sheets expose no command path into the platform and never determine current balance, capacity, consent, or reservation status.
- Coupon, referral, waitlist, reschedule, reminder, check-in, publication, audio, and live-payment capabilities remain outside the executable MVP.
- Selarti and Planerka live HTTP bindings remain disabled until their official contracts, authentication methods, rate limits, sandbox evidence, and failure semantics pass contract review.
- No authenticated provider or model sessions are available during this plan. Selarti, Planerka, Telegram, Make projection, intent-model, and payment live flags remain literal `false` in every committed environment example and runtime composition.
- Every password, token, signing key, webhook secret, and API key shown in tests or configuration uses an explicit `__PLACEHOLDER_*__` value. No real credential or session artifact is read, generated, copied, logged, or committed.
- `.env` and every environment-specific derivative are ignored; only `.env.example` is committed.
- Production deployment remains `NO-GO` while any blocking decision or non-waivable gate in the threat model lacks dated evidence and an accountable approver.
- Run every command from the repository root. Keep each task in its own commit and do not combine red and green states from different tasks.

## Planned file map

```text
.github/workflows/ci.yml
.github/workflows/release.yml
.dockerignore
.env.example
.gitignore
.nvmrc
Dockerfile
compose.yaml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
vitest.config.ts
apps/
  api/
    package.json
    src/app.ts
    src/server.ts
    src/routes/admin.ts
    src/routes/health.ts
    src/routes/selarti-webhook.ts
    src/routes/telegram-webhook.ts
  worker/
    package.json
    src/main.ts
    src/runtime.ts
packages/
  application/
    package.json
    src/admin-service.ts
    src/admin-service.testkit.ts
    src/booking-service.ts
    src/booking-service.testkit.ts
    src/catalog-service.ts
    src/conversation-service.ts
    src/conversation-service.testkit.ts
    src/feedback-service.ts
    src/prompt-safety.test.ts
    src/privacy-service.ts
    src/ports.ts
  config/
    package.json
    src/env.ts
  contracts/
    package.json
    src/events.ts
    src/ids.ts
    src/time.ts
  db/
    drizzle.config.ts
    package.json
    migrations/0000_mvp.sql
    src/client.ts
    src/repositories/booking-repository.ts
    src/repositories/catalog-repository.ts
    src/repositories/inbox-repository.ts
    src/repositories/message-repository.ts
    src/repositories/outbox-repository.ts
    src/repositories/privacy-repository.ts
    src/repositories/admin-repository.ts
    src/repositories/telegram-callback-repository.ts
    src/schema/audit.ts
    src/schema/billing.ts
    src/schema/booking.ts
    src/schema/catalog.ts
    src/schema/conversation.ts
    src/schema/identity.ts
    src/schema/integration.ts
    src/schema/index.ts
    src/testkit/postgres.ts
  domain/
    package.json
    src/billing.ts
    src/consent.ts
    src/reservation.ts
    src/safety.ts
  integrations/
    package.json
    src/http/webhook-auth.ts
    src/payment/disabled-payment-adapter.ts
    src/payment/payment-port.ts
    src/planerka/disabled-planerka-adapter.ts
    src/planerka/planerka-port.ts
    src/projections/make-projection-sink.ts
    src/projections/projection-port.ts
    src/selarti/disabled-selarti-adapter.ts
    src/selarti/selarti-port.ts
    src/telegram/callback-token.ts
    src/telegram/telegram-adapter.ts
  observability/
    package.json
    src/logger.ts
    src/metrics.ts
    src/tracing.ts
  worker/
    package.json
    src/data-retention.ts
    src/outbox-runner.ts
    src/outbox-runner.testkit.ts
    src/privacy-erasure.ts
    src/privacy-erasure.testkit.ts
    src/reconciliation.ts
    src/reservation-expiry.ts
    src/safety-handoff.ts
    src/worker-jobs.testkit.ts
scripts/repeat-vitest.mjs
scripts/smoke.mjs
scripts/verify-clean-workspace.mjs
tests/
  container/image-smoke.test.mjs
  contract/
    planerka-port.test.ts
    selarti-port.test.ts
    telegram-port.test.ts
  e2e/mvp-smoke.test.ts
  e2e/api-boundary.test.ts
  e2e/support/mvp-harness.ts
  fixtures/
    planerka/*.json
    prompts/*.json
    selarti/*.json
    telegram/*.json
  integration/
    admin-ledger.test.ts
    booking-concurrency.test.ts
    catalog-repository.test.ts
    message-ledger-concurrency.test.ts
    outbox-runner.test.ts
    privacy-workflow.test.ts
    schema.test.ts
  provider-stubs/server.mjs
  repo/
    architecture-boundaries.test.ts
    env-policy.test.ts
    release-assets.test.ts
    scope-boundary.test.ts
    workflow-semantics.test.ts
    workspace-dependencies.test.ts
    workspace-layout.test.ts
docs/
  contracts/provider-activation.md
  operations/data-retention.md
  operations/disaster-recovery.md
  operations/reconciliation.md
  operations/safety-handoff.md
  runbooks/go-live-evidence.md
  runbooks/provider-staging-evidence.md
  runbooks/rollback.md
```

---

### Task 1: Bootstrap the pnpm monorepo and executable quality commands

**Files:**

- Create: `.nvmrc`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `apps/api/package.json`
- Create: `apps/api/src/index.ts`
- Create: `apps/worker/package.json`
- Create: `apps/worker/src/index.ts`
- Create: `packages/application/package.json`
- Create: `packages/application/src/index.ts`
- Create: `packages/config/package.json`
- Create: `packages/config/src/index.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/db/package.json`
- Create: `packages/db/src/index.ts`
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/integrations/package.json`
- Create: `packages/integrations/src/index.ts`
- Create: `packages/observability/package.json`
- Create: `packages/observability/src/index.ts`
- Create: `packages/worker/package.json`
- Create: `packages/worker/src/index.ts`
- Test: `tests/repo/workspace-layout.test.ts`

**Interfaces:** Workspace package names are `@ii-tonya/api`, `@ii-tonya/app-worker`, `@ii-tonya/application`, `@ii-tonya/config`, `@ii-tonya/contracts`, `@ii-tonya/db`, `@ii-tonya/domain`, `@ii-tonya/integrations`, `@ii-tonya/observability`, and `@ii-tonya/worker`. This landed bootstrap establishes module roots only; dependency ownership is remediated in Task 3, and executable app entrypoints are created in Tasks 19 and 20.

- [ ] **Step 1: Write the failing repository-layout test and only the root test harness**

```ts
// tests/repo/workspace-layout.test.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const roots = [
  "apps/api",
  "apps/worker",
  "packages/application",
  "packages/config",
  "packages/contracts",
  "packages/db",
  "packages/domain",
  "packages/integrations",
  "packages/observability",
  "packages/worker",
];

describe("workspace layout", () => {
  it("contains a private package and source entrypoint for every module", () => {
    const missing = roots.filter((root) => {
      if (!existsSync(join(root, "package.json")) || !existsSync(join(root, "src/index.ts"))) return true;
      const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { private?: boolean };
      return manifest.private !== true;
    });
    expect(missing).toEqual([]);
  });
});
```

Create the root harness with `"packageManager": "pnpm@10.13.1"`, `"engines": {"node": ">=24 <25"}`, and script targets for unit, integration, contract, E2E, lint, typecheck, and build. Set `.nvmrc` to `24`; make `vitest.config.ts` include `packages/**/*.test.ts`, `apps/**/*.test.ts`, and `tests/**/*.test.ts`. Task 3 owns the complete dependency and command remediation because Tasks 1 and 2 are already committed.

- [ ] **Step 2: Run the test and confirm the expected failure**

Run: `corepack pnpm install && pnpm exec vitest run tests/repo/workspace-layout.test.ts`

Expected: FAIL with the ten missing workspace roots listed by the assertion.

- [ ] **Step 3: Create the minimal workspace packages**

Use this manifest shape for each package, substituting the exact package name listed in **Interfaces**:

```json
{
  "name": "@ii-tonya/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit"
  }
}
```

Each package entrypoint initially contains:

```ts
export {};
```

Set `pnpm-workspace.yaml` packages to `apps/*` and `packages/*`. Set strict TypeScript options including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and project-wide ESM module resolution.

- [ ] **Step 4: Run the focused and repository checks**

Run: `pnpm exec vitest run tests/repo/workspace-layout.test.ts && pnpm typecheck && pnpm build`

Expected: PASS; every workspace root is present and the landed bootstrap commands execute. This result does not satisfy Task 3 dependency ownership or Tasks 19–21 deployability gates.

- [ ] **Step 5: Commit**

```bash
git add .nvmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.config.ts apps packages tests/repo/workspace-layout.test.ts
git commit -m "chore: bootstrap ii-tonya monorepo"
```

---

### Task 2: Add canonical IDs, event envelopes, UTC time, and validated configuration

**Files:**

- Create: `packages/contracts/src/ids.ts`
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/time.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/contracts.test.ts`
- Create: `packages/config/src/env.ts`
- Modify: `packages/config/src/index.ts`
- Create: `packages/config/src/env.test.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `tests/repo/env-policy.test.ts`

**Interfaces:**

```ts
export type UserId = string & { readonly __brand: "UserId" };
export type ReservationId = string & { readonly __brand: "ReservationId" };
export type EventId = string & { readonly __brand: "EventId" };
export interface Clock { now(): Date }
export interface EventEnvelope<TType extends string, TPayload> {
  eventId: EventId;
  eventType: TType;
  occurredAt: string;
  correlationId: string;
  payload: TPayload;
}
export interface CanonicalOutboundDelivery {
  kind: "outbound_delivery";
  provider: "selarti";
  providerEventId: string;
  providerMessageId: string;
  occurredAt: string;
  status: "delivered";
}
export function loadEnv(source: NodeJS.ProcessEnv): RuntimeConfig;
```

- [ ] **Step 1: Write failing contract and configuration tests**

```ts
// packages/contracts/src/contracts.test.ts
import { describe, expect, it } from "vitest";
import { eventEnvelopeSchema, toUtcIso } from "./index.js";

describe("canonical contracts", () => {
  it("accepts a UTC event and rejects an offset timestamp", () => {
    const valid = {
      eventId: "018f47d6-9e75-7ca1-8a31-3fc6f06ca1c4",
      eventType: "reservation.created",
      occurredAt: "2026-07-28T10:00:00.000Z",
      correlationId: "corr-1",
      payload: { reservationId: "r-1" },
    };
    expect(eventEnvelopeSchema.parse(valid)).toEqual(valid);
    expect(() => eventEnvelopeSchema.parse({ ...valid, occurredAt: "2026-07-28T13:00:00+03:00" })).toThrow();
    expect(toUtcIso(new Date("2026-07-28T13:00:00+03:00"))).toBe("2026-07-28T10:00:00.000Z");
  });
});
```

```ts
// packages/config/src/env.test.ts
import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  it("defaults dangerous integrations to disabled and rejects raw transcript logging", () => {
    const config = loadEnv({
      DATABASE_URL: "postgres://ii_tonya:__PLACEHOLDER_DB_PASSWORD__@localhost:5432/ii_tonya",
    });
    expect(config.integrations).toEqual({
      selarti: false,
      planerka: false,
      telegram: false,
      makeProjection: false,
      intentModel: false,
      payments: false,
    });
    expect(config.selartiOutboundBillingMode).toBe("disabled");
    expect(config.minorOnboarding).toBe(false);
    expect(config.rawConversationLogging).toBe(false);
    expect(() => loadEnv({
      DATABASE_URL: "postgres://ii_tonya:__PLACEHOLDER_DB_PASSWORD__@localhost:5432/ii_tonya",
      RAW_CONVERSATION_LOGGING: "true",
    })).toThrow("Raw conversation logging is prohibited");
    expect(() => loadEnv({
      DATABASE_URL: "postgres://ii_tonya:__PLACEHOLDER_DB_PASSWORD__@localhost:5432/ii_tonya",
      SELARTI_ENABLED: "true",
    })).toThrow();
  });
});
```

```ts
// tests/repo/env-policy.test.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const parseEnv = (text: string): Record<string, string> => Object.fromEntries(
  text.split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

describe("environment credential policy", () => {
  it("tracks only a placeholder example and keeps every live flag false", () => {
    const ignored = readFileSync(".gitignore", "utf8").split(/\r?\n/);
    expect(ignored).toEqual(expect.arrayContaining([".env", ".env.*", "!.env.example"]));

    const example = parseEnv(readFileSync(".env.example", "utf8"));
    const liveFlags = [
      "SELARTI_ENABLED",
      "PLANERKA_ENABLED",
      "TELEGRAM_ENABLED",
      "MAKE_PROJECTION_ENABLED",
      "INTENT_MODEL_ENABLED",
      "PAYMENTS_ENABLED",
    ];
    expect(liveFlags.map((key) => example[key])).toEqual(liveFlags.map(() => "false"));

    const secretKeys = Object.keys(example).filter((key) =>
      /(PASSWORD|TOKEN|SECRET|API_KEY|HMAC_KEY)$/.test(key) || key === "DATABASE_URL");
    expect(secretKeys.length).toBeGreaterThan(0);
    expect(secretKeys.every((key) => example[key]?.includes("__PLACEHOLDER_"))).toBe(true);

    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/);
    expect(tracked.filter((path) => /^\.env(?:\.|$)/.test(path) && path !== ".env.example")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `pnpm exec vitest run packages/contracts/src/contracts.test.ts packages/config/src/env.test.ts tests/repo/env-policy.test.ts`

Expected: FAIL because the contract and environment modules, `.gitignore`, and `.env.example` do not exist.

- [ ] **Step 3: Implement the smallest validated primitives**

```ts
// packages/contracts/src/events.ts
import { z } from "zod";

export const eventEnvelopeSchema = z.object({
  eventId: z.uuid(),
  eventType: z.string().min(1),
  occurredAt: z.string().regex(/Z$/).datetime(),
  correlationId: z.string().min(1).max(128),
  payload: z.unknown(),
}).strict();

export type EventEnvelope<TType extends string, TPayload> = {
  eventId: string & { readonly __brand: "EventId" };
  eventType: TType;
  occurredAt: string;
  correlationId: string;
  payload: TPayload;
};

export const canonicalOutboundDeliverySchema = z.object({
  kind: z.literal("outbound_delivery"),
  provider: z.literal("selarti"),
  providerEventId: z.string().min(1).max(128),
  providerMessageId: z.string().min(1).max(128),
  occurredAt: z.string().regex(/Z$/).datetime(),
  status: z.literal("delivered"),
}).strict();
export type CanonicalOutboundDelivery = z.infer<typeof canonicalOutboundDeliverySchema>;
```

```ts
// packages/contracts/src/time.ts
export interface Clock {
  now(): Date;
}

export const toUtcIso = (value: Date): string => value.toISOString();
```

```ts
// packages/config/src/env.ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url().startsWith("postgres"),
  SELARTI_ENABLED: z.literal("false").default("false"),
  SELARTI_OUTBOUND_BILLING_MODE: z.literal("disabled").default("disabled"),
  PLANERKA_ENABLED: z.literal("false").default("false"),
  TELEGRAM_ENABLED: z.literal("false").default("false"),
  MAKE_PROJECTION_ENABLED: z.literal("false").default("false"),
  INTENT_MODEL_ENABLED: z.literal("false").default("false"),
  PAYMENTS_ENABLED: z.literal("false").default("false"),
  MINOR_ONBOARDING_ENABLED: z.literal("false").default("false"),
  RAW_CONVERSATION_LOGGING: z.enum(["true", "false"]).default("false"),
  DISPLAY_TIMEZONE: z.string().default("Europe/Moscow"),
}).passthrough();

export type RuntimeConfig = {
  databaseUrl: string;
  integrations: {
    selarti: false;
    planerka: false;
    telegram: false;
    makeProjection: false;
    intentModel: false;
    payments: false;
  };
  selartiOutboundBillingMode: "disabled";
  minorOnboarding: false;
  rawConversationLogging: false;
  displayTimezone: string;
};

export function loadEnv(source: NodeJS.ProcessEnv): RuntimeConfig {
  const value = schema.parse(source);
  if (value.RAW_CONVERSATION_LOGGING === "true") throw new Error("Raw conversation logging is prohibited");
  return {
    databaseUrl: value.DATABASE_URL,
    integrations: {
      selarti: false,
      planerka: false,
      telegram: false,
      makeProjection: false,
      intentModel: false,
      payments: false,
    },
    selartiOutboundBillingMode: "disabled",
    minorOnboarding: false,
    rawConversationLogging: false,
    displayTimezone: value.DISPLAY_TIMEZONE,
  };
}
```

Export the public values from both package entrypoints. Put the remaining ID brands from **Interfaces** in `ids.ts` without runtime casts outside a single `brandId` parser.

Create `.gitignore` with:

```gitignore
.env
.env.*
!.env.example
```

Create `.env.example` with no usable credential values:

```dotenv
DATABASE_URL=postgresql://ii_tonya:__PLACEHOLDER_DB_PASSWORD__@localhost:5432/ii_tonya
SELARTI_ENABLED=false
SELARTI_OUTBOUND_BILLING_MODE=disabled
SELARTI_WEBHOOK_SECRET=__PLACEHOLDER_SELARTI_WEBHOOK_SECRET__
PLANERKA_ENABLED=false
PLANERKA_API_TOKEN=__PLACEHOLDER_PLANERKA_API_TOKEN__
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=__PLACEHOLDER_TELEGRAM_BOT_TOKEN__
TELEGRAM_WEBHOOK_SECRET=__PLACEHOLDER_TELEGRAM_WEBHOOK_SECRET__
CALLBACK_HMAC_KEY=__PLACEHOLDER_CALLBACK_HMAC_KEY__
MAKE_PROJECTION_ENABLED=false
MAKE_PROJECTION_TOKEN=__PLACEHOLDER_MAKE_PROJECTION_TOKEN__
INTENT_MODEL_ENABLED=false
INTENT_MODEL_API_KEY=__PLACEHOLDER_INTENT_MODEL_API_KEY__
PAYMENTS_ENABLED=false
MINOR_ONBOARDING_ENABLED=false
RAW_CONVERSATION_LOGGING=false
DISPLAY_TIMEZONE=Europe/Moscow
```

- [ ] **Step 4: Run focused tests and type checking**

Run: `pnpm exec vitest run packages/contracts/src/contracts.test.ts packages/config/src/env.test.ts tests/repo/env-policy.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/config .env.example .gitignore tests/repo/env-policy.test.ts
git commit -m "feat: add canonical contracts and safe configuration"
```

---

> **Execution baseline after the amendment:** Tasks 1 and 2 already have repository commits. Their text records the target bootstrap, but those historical commits are not accepted as evidence for dependency ownership or deployable entrypoints. Task 3 therefore performs a mandatory manifest/repeat-runner remediation from the current tree before domain work continues. Tasks 19 and 20 create the real worker and API entrypoints from the then-current composition, and Task 21 boots those built artifacts. No later task may skip these forward remediation gates because an earlier plan excerpt describes the intended state.

### Task 3: Remediate workspace ownership, then implement the reservation state machine

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/package.json`
- Modify: `apps/worker/package.json`
- Modify: `packages/application/package.json`
- Modify: `packages/config/package.json`
- Modify: `packages/contracts/package.json`
- Modify: `packages/db/package.json`
- Modify: `packages/domain/package.json`
- Modify: `packages/integrations/package.json`
- Modify: `packages/observability/package.json`
- Modify: `packages/worker/package.json`
- Create: `scripts/repeat-vitest.mjs`
- Create: `scripts/verify-clean-workspace.mjs`
- Create: `tests/repo/workspace-dependencies.test.ts`
- Create: `packages/domain/src/reservation.ts`
- Create: `packages/domain/src/reservation.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

```ts
export type ReservationStatus =
  | "reserved"
  | "booked"
  | "cancelled_by_client"
  | "cancelled_by_expert"
  | "expired"
  | "completed"
  | "no_show";
export type ReservationAction =
  | "expert_confirm"
  | "client_cancel"
  | "expert_cancel"
  | "expire"
  | "complete"
  | "mark_no_show";
export function computeReservedUntil(createdAt: Date, slotStartsAt: Date, confirmationBufferMs: number): Date;
export function transitionReservation(status: ReservationStatus, action: ReservationAction): ReservationStatus;
```

Every external import owner is declared in its consuming workspace, internal dependencies use `workspace:*`, and root owns tooling only. `pnpm test:repeat -- <count> <test-path...>` invokes `scripts/repeat-vitest.mjs`. This task does not claim deployability: `apps/worker/src/main.ts` and `apps/api/src/server.ts` are created with their real compositions in Tasks 19 and 20.

- [ ] **Step 1: Write the failing dependency-ownership and state-machine tests**

```ts
// tests/repo/workspace-dependencies.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const required = {
  ".": {
    dependencies: [],
    devDependencies: [
      "@eslint/js", "@types/node", "@vitest/coverage-v8", "eslint", "globals",
      "prettier", "tsup", "tsx", "typescript", "typescript-eslint", "vitest", "yaml",
    ],
  },
  "apps/api": {
    dependencies: [
      "@fastify/rate-limit", "@ii-tonya/application", "@ii-tonya/config",
      "@ii-tonya/integrations", "@ii-tonya/observability", "fastify",
    ],
    devDependencies: [],
  },
  "apps/worker": {
    dependencies: [
      "@ii-tonya/config", "@ii-tonya/db", "@ii-tonya/integrations",
      "@ii-tonya/observability", "@ii-tonya/worker",
    ],
    devDependencies: [],
  },
  "packages/application": {
    dependencies: ["@ii-tonya/contracts", "@ii-tonya/domain"],
    devDependencies: [],
  },
  "packages/config": { dependencies: ["zod"], devDependencies: [] },
  "packages/contracts": { dependencies: ["zod"], devDependencies: [] },
  "packages/db": {
    dependencies: ["@ii-tonya/contracts", "@ii-tonya/domain", "drizzle-orm", "pg"],
    devDependencies: ["@testcontainers/postgresql", "@types/pg", "drizzle-kit"],
  },
  "packages/domain": { dependencies: [], devDependencies: ["fast-check"] },
  "packages/integrations": {
    dependencies: ["@ii-tonya/contracts", "zod"],
    devDependencies: [],
  },
  "packages/observability": {
    dependencies: ["@opentelemetry/api", "@opentelemetry/sdk-node", "pino"],
    devDependencies: [],
  },
  "packages/worker": {
    dependencies: [
      "@ii-tonya/application", "@ii-tonya/contracts", "@ii-tonya/db",
      "@ii-tonya/domain", "@ii-tonya/integrations",
    ],
    devDependencies: [],
  },
} as const;

const manifestAt = (root: string) => JSON.parse(
  readFileSync(root === "." ? "package.json" : `${root}/package.json`, "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

describe("workspace dependency ownership remediation", () => {
  it.each(Object.entries(required))("%s owns every current and planned import", (root, expected) => {
    const manifest = manifestAt(root);
    for (const name of expected.dependencies) {
      expect(manifest.dependencies?.[name], `${root} runtime ${name}`).toBeDefined();
      if (name.startsWith("@ii-tonya/")) expect(manifest.dependencies?.[name]).toBe("workspace:*");
    }
    for (const name of expected.devDependencies) {
      expect(manifest.devDependencies?.[name], `${root} development ${name}`).toBeDefined();
    }
  });

  it("does not hide package runtime imports in root development dependencies", () => {
    const root = manifestAt(".");
    expect(root.dependencies ?? {}).toEqual({});
    expect(root.devDependencies).not.toHaveProperty("zod");
    expect(root.scripts?.["test:repeat"]).toBe("node scripts/repeat-vitest.mjs");
    expect(root.scripts?.["verify:clean-workspace"]).toBe(
      "node scripts/verify-clean-workspace.mjs",
    );
  });
});
```

```ts
// packages/domain/src/reservation.test.ts
import { describe, expect, it } from "vitest";
import { computeReservedUntil, transitionReservation } from "./reservation.js";

describe("reservation policy", () => {
  it("uses the earlier of 72 hours and slot start minus the one-hour buffer", () => {
    const createdAt = new Date("2026-07-28T10:00:00.000Z");
    expect(computeReservedUntil(
      createdAt,
      new Date("2026-07-30T12:00:00.000Z"),
      60 * 60 * 1_000,
    ).toISOString()).toBe("2026-07-30T11:00:00.000Z");
  });

  it("rejects a deadline that is not after creation", () => {
    expect(() => computeReservedUntil(
      new Date("2026-07-28T10:00:00.000Z"),
      new Date("2026-07-28T11:00:00.000Z"),
      60 * 60 * 1_000,
    )).toThrow("Reservation deadline has already passed");
  });

  it("allows only normative transitions", () => {
    expect(transitionReservation("reserved", "expert_confirm")).toBe("booked");
    expect(transitionReservation("reserved", "expire")).toBe("expired");
    expect(() => transitionReservation("expired", "expert_confirm")).toThrow("Invalid reservation transition");
    expect(transitionReservation("booked", "mark_no_show")).toBe("no_show");
  });
});
```

- [ ] **Step 2: Run the test and confirm the expected failure**

Run: `pnpm exec vitest run tests/repo/workspace-dependencies.test.ts packages/domain/src/reservation.test.ts`

Expected: FAIL because current package manifests keep runtime `zod` at root instead of `packages/config` and `packages/contracts`, the portable repeat runner is absent, future package owners are incomplete, and `reservation.ts` does not exist.

- [ ] **Step 3: Repair manifest ownership, pin the lockfile, and implement the transition table**

Apply this ownership table in the listed `package.json` files before adding more imports:

| Workspace | Runtime dependencies | Development dependencies |
|---|---|---|
| root | none | `@eslint/js`, `@types/node`, `@vitest/coverage-v8`, `eslint`, `globals`, `prettier`, `tsup`, `tsx`, `typescript`, `typescript-eslint`, `vitest`, `yaml` |
| `apps/api` | `@fastify/rate-limit`, `@ii-tonya/application`, `@ii-tonya/config`, `@ii-tonya/integrations`, `@ii-tonya/observability`, `fastify` | none |
| `apps/worker` | `@ii-tonya/config`, `@ii-tonya/db`, `@ii-tonya/integrations`, `@ii-tonya/observability`, `@ii-tonya/worker` | none |
| `packages/application` | `@ii-tonya/contracts`, `@ii-tonya/domain` | none |
| `packages/config` | `zod` | none |
| `packages/contracts` | `zod` | none |
| `packages/db` | `@ii-tonya/contracts`, `@ii-tonya/domain`, `drizzle-orm`, `pg` | `@testcontainers/postgresql`, `@types/pg`, `drizzle-kit` |
| `packages/domain` | none | `fast-check` |
| `packages/integrations` | `@ii-tonya/contracts`, `zod` | none |
| `packages/observability` | `@opentelemetry/api`, `@opentelemetry/sdk-node`, `pino` | none |
| `packages/worker` | `@ii-tonya/application`, `@ii-tonya/contracts`, `@ii-tonya/db`, `@ii-tonya/domain`, `@ii-tonya/integrations` | none |

Remove `zod` from root `devDependencies`; add it to the runtime `dependencies` of `packages/config`, `packages/contracts`, and `packages/integrations`. Use `workspace:*` for every `@ii-tonya/*` dependency. Root script `test:repeat` must be `node scripts/repeat-vitest.mjs`. Regenerate `pnpm-lock.yaml` only after all manifest edits.

```js
// scripts/repeat-vitest.mjs
import { spawnSync } from "node:child_process";

const [countText, ...testPaths] = process.argv.slice(2);
const count = Number.parseInt(countText ?? "", 10);
if (!Number.isInteger(count) || count < 1 || testPaths.length === 0) {
  throw new Error("Usage: pnpm test:repeat -- <positive-count> <test-path> [test-path]");
}
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
for (let index = 1; index <= count; index += 1) {
  const result = spawnSync(pnpm, ["exec", "vitest", "run", ...testPaths], {
    stdio: "inherit",
    env: { ...process.env, TEST_RUN_INDEX: String(index) },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
```

```js
// scripts/verify-clean-workspace.mjs
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const sourceRoot = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "ii-tonya-clean-"));
const copyRoot = join(scratch, "repo");
const excluded = new Set([".git", "node_modules", "dist", "coverage", ".turbo"]);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const run = (args) => {
  const result = spawnSync(pnpm, args, { cwd: copyRoot, stdio: "inherit" });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return result.status === 0;
};

try {
  cpSync(sourceRoot, copyRoot, {
    recursive: true,
    filter: (source) => {
      const parts = relative(sourceRoot, source).split(sep);
      if (parts.some((part) => excluded.has(part))) return false;
      const name = basename(source);
      return name === ".env.example" || !name.startsWith(".env");
    },
  });
  if (!run(["install", "--frozen-lockfile"])) throw new Error("clean install failed");
  if (!run(["typecheck"])) throw new Error("clean typecheck failed");
  if (!run(["build"])) throw new Error("clean build failed");
} finally {
  const relativeScratch = relative(tmpdir(), scratch);
  if (!relativeScratch.startsWith("ii-tonya-clean-") || relativeScratch.includes(sep)) {
    throw new Error("refusing to remove an unexpected path");
  }
  rmSync(scratch, { recursive: true, force: true });
}
```

```ts
// packages/domain/src/reservation.ts
export type ReservationStatus =
  | "reserved" | "booked" | "cancelled_by_client" | "cancelled_by_expert"
  | "expired" | "completed" | "no_show";
export type ReservationAction =
  | "expert_confirm" | "client_cancel" | "expert_cancel" | "expire"
  | "complete" | "mark_no_show";

const transitions: Partial<Record<ReservationStatus, Partial<Record<ReservationAction, ReservationStatus>>>> = {
  reserved: {
    expert_confirm: "booked",
    client_cancel: "cancelled_by_client",
    expert_cancel: "cancelled_by_expert",
    expire: "expired",
  },
  booked: {
    client_cancel: "cancelled_by_client",
    expert_cancel: "cancelled_by_expert",
    complete: "completed",
    mark_no_show: "no_show",
  },
};

export function computeReservedUntil(
  createdAt: Date,
  slotStartsAt: Date,
  confirmationBufferMs: number,
): Date {
  const deadline = new Date(Math.min(
    createdAt.getTime() + 72 * 60 * 60 * 1_000,
    slotStartsAt.getTime() - confirmationBufferMs,
  ));
  if (deadline.getTime() <= createdAt.getTime()) throw new Error("Reservation deadline has already passed");
  return deadline;
}

export function transitionReservation(status: ReservationStatus, action: ReservationAction): ReservationStatus {
  const next = transitions[status]?.[action];
  if (!next) throw new Error("Invalid reservation transition");
  return next;
}
```

- [ ] **Step 4: Verify the remediation from a frozen graph before proceeding**

Run:

```bash
corepack pnpm install --lockfile-only
corepack pnpm install --frozen-lockfile
pnpm exec vitest run tests/repo/workspace-dependencies.test.ts packages/domain/src/reservation.test.ts
pnpm test:repeat -- 2 tests/repo/workspace-dependencies.test.ts packages/domain/src/reservation.test.ts
pnpm verify:clean-workspace
```

Expected: PASS; a frozen dependency graph resolves package-owned runtime imports, the portable repeat runner executes twice, strict type checking succeeds, and every currently buildable workspace builds. Tasks 4–21 must stop if this gate fails.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml apps/api/package.json apps/worker/package.json packages/*/package.json scripts/repeat-vitest.mjs scripts/verify-clean-workspace.mjs tests/repo/workspace-dependencies.test.ts packages/domain/src/reservation.ts packages/domain/src/reservation.test.ts packages/domain/src/index.ts
git commit -m "fix: own workspace dependencies and define reservation policy"
```

---

### Task 4: Implement deterministic message charging and package selection

**Files:**

- Create: `packages/domain/src/billing.ts`
- Create: `packages/domain/src/billing.test.ts`
- Create: `packages/domain/src/billing.property.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

```ts
export type MessageClass = "ordinary_inbound" | "ordinary_outbound" | "system" | "safety" | "error";
export type PackageKind = "admin" | "paid" | "intro";
export interface AvailablePackage {
  id: string;
  kind: PackageKind;
  ledgerBalance: number;
  expiresAt: Date | null;
  grantedAt: Date;
}
export type LedgerFact =
  | { sequence: number; kind: "grant"; delta: number; idempotencyKey: string }
  | { sequence: number; kind: "debit"; delta: -1; idempotencyKey: string }
  | { sequence: number; kind: "free"; delta: 0; idempotencyKey: string }
  | { sequence: number; kind: "compensation"; delta: 1; idempotencyKey: string }
  | { sequence: number; kind: "revocation"; delta: number; idempotencyKey: string };
export function chargeDelta(messageClass: MessageClass): -1 | 0;
export function derivePackageBalance(facts: readonly LedgerFact[]): number;
export function choosePackage(packages: readonly AvailablePackage[], at: Date): AvailablePackage | null;
```

- [ ] **Step 1: Write failing billing-policy tests**

```ts
// packages/domain/src/billing.test.ts
import { describe, expect, it } from "vitest";
import { chargeDelta, choosePackage, derivePackageBalance } from "./billing.js";

const at = new Date("2026-07-28T10:00:00.000Z");
const pkg = (id: string, kind: "admin" | "paid" | "intro", ledgerBalance: number, expiresAt: string | null) => ({
  id,
  kind,
  ledgerBalance,
  expiresAt: expiresAt ? new Date(expiresAt) : null,
  grantedAt: new Date("2026-07-01T00:00:00.000Z"),
});

describe("message charging", () => {
  it("charges accepted and delivered ordinary content but not free classes", () => {
    expect(chargeDelta("ordinary_inbound")).toBe(-1);
    expect(chargeDelta("ordinary_outbound")).toBe(-1);
    expect(chargeDelta("system")).toBe(0);
    expect(chargeDelta("safety")).toBe(0);
    expect(chargeDelta("error")).toBe(0);
  });

  it("uses earliest expiry and keeps intro packages last", () => {
    const chosen = choosePackage([
      pkg("intro", "intro", 10, "2026-07-29T00:00:00.000Z"),
      pkg("late", "admin", 10, "2026-08-10T00:00:00.000Z"),
      pkg("early", "paid", 10, "2026-08-01T00:00:00.000Z"),
    ], at);
    expect(chosen?.id).toBe("early");
  });

  it("ignores empty and expired packages", () => {
    expect(choosePackage([
      pkg("empty", "admin", 0, "2026-08-01T00:00:00.000Z"),
      pkg("expired", "paid", 4, "2026-07-28T09:59:59.999Z"),
    ], at)).toBeNull();
  });

  it("derives balance only from immutable grant, debit, compensation, and revocation facts", () => {
    expect(derivePackageBalance([
      { sequence: 1, kind: "grant", delta: 3, idempotencyKey: "grant-1" },
      { sequence: 2, kind: "debit", delta: -1, idempotencyKey: "debit-1" },
      { sequence: 3, kind: "compensation", delta: 1, idempotencyKey: "compensate-1" },
      { sequence: 4, kind: "revocation", delta: -3, idempotencyKey: "revoke-1" },
    ])).toBe(0);
  });
});
```

```ts
// packages/domain/src/billing.property.test.ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { derivePackageBalance, type LedgerFact } from "./billing.js";

describe("ledger conservation", () => {
  it("rebuilds the same non-negative balance from append-only facts", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 200 }),
      fc.array(fc.constantFrom<"debit" | "compensation">("debit", "compensation"), { maxLength: 400 }),
      (grant, operations) => {
        const facts: LedgerFact[] = [
          { sequence: 1, kind: "grant", delta: grant, idempotencyKey: "grant" },
        ];
        let expected = grant;
        for (const operation of operations) {
          if (operation === "debit" && expected > 0) {
            expected -= 1;
            facts.push({
              sequence: facts.length + 1,
              kind: "debit",
              delta: -1,
              idempotencyKey: `debit-${facts.length}`,
            });
          } else if (operation === "compensation" && expected < grant) {
            expected += 1;
            facts.push({
              sequence: facts.length + 1,
              kind: "compensation",
              delta: 1,
              idempotencyKey: `compensation-${facts.length}`,
            });
          }
        }
        expect(derivePackageBalance(facts)).toBe(expected);
        expect(derivePackageBalance(facts)).toBeGreaterThanOrEqual(0);
      },
    ), { numRuns: 500 });
  });
});
```

- [ ] **Step 2: Run the test and confirm the expected failure**

Run: `pnpm exec vitest run packages/domain/src/billing.test.ts packages/domain/src/billing.property.test.ts`

Expected: FAIL because `billing.ts` does not exist.

- [ ] **Step 3: Implement the charge table and stable package ordering**

```ts
// packages/domain/src/billing.ts
export type MessageClass = "ordinary_inbound" | "ordinary_outbound" | "system" | "safety" | "error";
export type PackageKind = "admin" | "paid" | "intro";
export interface AvailablePackage {
  id: string;
  kind: PackageKind;
  ledgerBalance: number;
  expiresAt: Date | null;
  grantedAt: Date;
}
export type LedgerFact =
  | { sequence: number; kind: "grant"; delta: number; idempotencyKey: string }
  | { sequence: number; kind: "debit"; delta: -1; idempotencyKey: string }
  | { sequence: number; kind: "free"; delta: 0; idempotencyKey: string }
  | { sequence: number; kind: "compensation"; delta: 1; idempotencyKey: string }
  | { sequence: number; kind: "revocation"; delta: number; idempotencyKey: string };

export const chargeDelta = (messageClass: MessageClass): -1 | 0 =>
  messageClass === "ordinary_inbound" || messageClass === "ordinary_outbound" ? -1 : 0;

export function derivePackageBalance(facts: readonly LedgerFact[]): number {
  const seen = new Set<string>();
  let balance = 0;
  for (const fact of facts.toSorted((left, right) => left.sequence - right.sequence)) {
    if (seen.has(fact.idempotencyKey)) continue;
    seen.add(fact.idempotencyKey);
    const next = balance + fact.delta;
    if (next < 0) throw new Error("Ledger fact would make package balance negative");
    balance = next;
  }
  return balance;
}

export function choosePackage(packages: readonly AvailablePackage[], at: Date): AvailablePackage | null {
  return packages
    .filter((value) =>
      value.ledgerBalance > 0
      && (value.expiresAt === null || value.expiresAt.getTime() > at.getTime()))
    .toSorted((left, right) => {
      const introOrder = Number(left.kind === "intro") - Number(right.kind === "intro");
      if (introOrder !== 0) return introOrder;
      const leftExpiry = left.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightExpiry = right.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftExpiry - rightExpiry || left.grantedAt.getTime() - right.grantedAt.getTime()
        || left.id.localeCompare(right.id);
    })[0] ?? null;
}
```

- [ ] **Step 4: Run the focused test and type checking**

Run: `pnpm exec vitest run packages/domain/src/billing.test.ts packages/domain/src/billing.property.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/billing.ts packages/domain/src/billing.test.ts packages/domain/src/billing.property.test.ts packages/domain/src/index.ts
git commit -m "feat: add deterministic message billing policy"
```

---

### Task 5: Enforce consent minimization and provider-independent safety

**Files:**

- Create: `packages/domain/src/consent.ts`
- Create: `packages/domain/src/consent.test.ts`
- Create: `packages/domain/src/safety.ts`
- Create: `packages/domain/src/safety.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

```ts
export type ConsentPurpose = "client_profile" | "expert_note" | "follow_up";
export interface ConsentGrant { purpose: ConsentPurpose; granted: boolean; recordedAt: Date }
export function buildProfilePatch(input: ProfileInput, grants: readonly ConsentGrant[]): ProfilePatch;
export function buildExpertView(reservation: ReservationViewInput): ExpertView;
export type SafetyRisk = "self_harm" | "violence" | "medical" | "abuse" | "urgent" | "uncertain";
export type AgeBand = "minor" | "adult" | "unknown";
export interface DeterministicSafetyGuard { detect(text: string): SafetyRisk | null }
export interface SafetyClassifier { classify(text: string): Promise<"ordinary" | SafetyRisk> }
export interface SafetyDirectory { list(): readonly SafetyContact[] }
export interface SafetyContact {
  id: string;
  label: string;
  channel: string;
  countryCode: string;
  regionCode: string | null;
  ageBands: readonly AgeBand[];
  riskTypes: readonly SafetyRisk[];
  sourceUrl: string;
  owner: string;
  verifiedAt: Date;
  validUntil: Date;
}
export async function evaluateSafety(input: SafetyInput, guard: DeterministicSafetyGuard, classifier: SafetyClassifier, directory: SafetyDirectory): Promise<SafetyDecision>;
export function transitionHandoff(state: HandoffState, action: HandoffAction, now: Date): HandoffState;
```

- [ ] **Step 1: Write failing privacy and safety tests**

```ts
// packages/domain/src/consent.test.ts
import { describe, expect, it } from "vitest";
import { buildExpertView, buildProfilePatch } from "./consent.js";

describe("privacy minimization", () => {
  it("drops optional profile data without a current explicit grant", () => {
    expect(buildProfilePatch(
      { displayName: "Аня", goals: "снизить тревогу", expertNote: "предпочитает утро" },
      [],
    )).toEqual({ displayName: "Аня" });
  });

  it("shows the expert appointment data and only the consented note", () => {
    expect(buildExpertView({
      reservationId: "r-1",
      startsAt: "2026-08-01T09:00:00.000Z",
      displayTimezone: "Europe/Moscow",
      clientDisplayName: "Аня",
      expertNote: "предпочитает утро",
      expertNoteConsent: false,
    })).not.toHaveProperty("expertNote");
  });
});
```

```ts
// packages/domain/src/safety.test.ts
import { describe, expect, it, vi } from "vitest";
import { evaluateSafety, transitionHandoff } from "./safety.js";

describe("safety evaluation", () => {
  const now = new Date("2026-07-28T10:00:00.000Z");
  const freshContact = {
    id: "contact-1",
    label: "Verified crisis contact",
    channel: "__PLACEHOLDER_VERIFIED_CONTACT_CHANNEL__",
    countryCode: "RU",
    regionCode: "MOW",
    ageBands: ["adult"] as const,
    riskTypes: ["self_harm", "uncertain"] as const,
    sourceUrl: "https://contacts.invalid/evidence/contact-1",
    owner: "clinical-safety-owner",
    verifiedAt: new Date("2026-07-01T00:00:00.000Z"),
    validUntil: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("SAFE-01 runs deterministic high-risk guards before a model that says ordinary", async () => {
    const classifier = { classify: vi.fn().mockResolvedValue("ordinary" as const) };
    const guard = { detect: vi.fn().mockReturnValue("self_harm" as const) };
    const decision = await evaluateSafety({
      text: "guard fixture",
      countryCode: "RU",
      regionCode: "MOW",
      ageBand: "adult",
      ledgerBalance: 0,
      now,
    }, guard, classifier, { list: () => [freshContact] });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(decision).toMatchObject({ kind: "human_handoff", reason: "self_harm", charge: 0 });
  });

  it("SAFE-02 returns a free handoff with a fresh scoped contact at zero balance", async () => {
    const classifier = { classify: vi.fn().mockResolvedValue("self_harm" as const) };
    const guard = { detect: vi.fn().mockReturnValue(null) };
    const decision = await evaluateSafety(
      {
        text: "classifier fixture",
        countryCode: "RU",
        regionCode: "MOW",
        ageBand: "adult",
        ledgerBalance: 0,
        now,
      },
      guard,
      classifier,
      { list: () => [freshContact] },
    );
    expect(decision).toMatchObject({ kind: "human_handoff", charge: 0 });
    expect(decision.contacts).toHaveLength(1);
  });

  it("SAFE-03 rejects stale or wrong-scope contacts", async () => {
    const guard = { detect: vi.fn().mockReturnValue("self_harm" as const) };
    const stale = { ...freshContact, validUntil: new Date("2026-07-27T00:00:00.000Z") };
    const decision = await evaluateSafety({
      text: "guard fixture",
      countryCode: "RU",
      regionCode: "MOW",
      ageBand: "adult",
      ledgerBalance: 0,
      now,
    }, guard, { classify: vi.fn() }, { list: () => [stale] });
    expect(decision).toMatchObject({
      kind: "human_handoff",
      reason: "self_harm",
      directoryState: "no_fresh_contact",
      contacts: [],
    });
  });

  it("SAFE-04 uses a conservative free handoff when the classifier is unavailable", async () => {
    const classifier = { classify: vi.fn().mockRejectedValue(new Error("offline")) };
    const guard = { detect: vi.fn().mockReturnValue(null) };
    await expect(evaluateSafety(
      {
        text: "uncertain fixture",
        countryCode: "RU",
        regionCode: "MOW",
        ageBand: "adult",
        ledgerBalance: 5,
        now,
      },
      guard,
      classifier,
      { list: () => [freshContact] },
    )).resolves.toMatchObject({
      kind: "human_handoff",
      charge: 0,
      reason: "classifier_unavailable",
      directoryState: "fresh_fallback",
      contacts: [expect.objectContaining({ id: "contact-1" })],
    });
  });

  it("SAFE-05 escalates an unacknowledged durable handoff after its SLA", () => {
    expect(transitionHandoff({
      status: "assigned",
      ownerId: "operator-1",
      openedAt: new Date("2026-07-28T09:00:00.000Z"),
      acknowledgeBy: new Date("2026-07-28T09:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      version: 2,
    }, "check_ack_sla", now)).toMatchObject({ status: "escalated", version: 3 });
  });
});
```

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `pnpm exec vitest run packages/domain/src/consent.test.ts packages/domain/src/safety.test.ts`

Expected: FAIL because consent and safety policy modules do not exist.

- [ ] **Step 3: Implement explicit-purpose filtering and fail-closed safety**

```ts
// packages/domain/src/consent.ts
export type ConsentPurpose = "client_profile" | "expert_note" | "follow_up";
export type ConsentGrant = { purpose: ConsentPurpose; granted: boolean; recordedAt: Date };
export type ProfileInput = { displayName: string; goals?: string; expertNote?: string };
export type ProfilePatch = { displayName: string; goals?: string; expertNote?: string };

const granted = (purpose: ConsentPurpose, grants: readonly ConsentGrant[]): boolean =>
  grants.filter((entry) => entry.purpose === purpose).toSorted(
    (left, right) => right.recordedAt.getTime() - left.recordedAt.getTime(),
  )[0]?.granted === true;

export function buildProfilePatch(input: ProfileInput, grants: readonly ConsentGrant[]): ProfilePatch {
  if (!granted("client_profile", grants)) return { displayName: input.displayName };
  return {
    displayName: input.displayName,
    ...(input.goals ? { goals: input.goals } : {}),
    ...(input.expertNote && granted("expert_note", grants) ? { expertNote: input.expertNote } : {}),
  };
}

export function buildExpertView(input: {
  reservationId: string;
  startsAt: string;
  displayTimezone: string;
  clientDisplayName: string;
  expertNote?: string;
  expertNoteConsent: boolean;
}) {
  return {
    reservationId: input.reservationId,
    startsAt: input.startsAt,
    displayTimezone: input.displayTimezone,
    clientDisplayName: input.clientDisplayName,
    ...(input.expertNoteConsent && input.expertNote ? { expertNote: input.expertNote } : {}),
  };
}
```

```ts
// packages/domain/src/safety.ts
export type SafetyRisk = "self_harm" | "violence" | "medical" | "abuse" | "urgent" | "uncertain";
export type AgeBand = "minor" | "adult" | "unknown";
export type SafetyContact = {
  id: string;
  label: string;
  channel: string;
  countryCode: string;
  regionCode: string | null;
  ageBands: readonly AgeBand[];
  riskTypes: readonly SafetyRisk[];
  sourceUrl: string;
  owner: string;
  verifiedAt: Date;
  validUntil: Date;
};
export interface DeterministicSafetyGuard {
  detect(text: string): SafetyRisk | null;
}
export interface SafetyClassifier {
  classify(text: string): Promise<"ordinary" | SafetyRisk>;
}
export interface SafetyDirectory {
  list(): readonly SafetyContact[];
}

export async function evaluateSafety(
  input: {
    text: string;
    countryCode: string;
    regionCode: string | null;
    ageBand: AgeBand;
    ledgerBalance: number;
    now: Date;
  },
  guard: DeterministicSafetyGuard,
  classifier: SafetyClassifier,
  directory: SafetyDirectory,
) {
  const deterministicRisk = guard.detect(input.text);
  const selectContacts = (risk: SafetyRisk) => directory.list().filter((contact) =>
    contact.countryCode === input.countryCode
    && (contact.regionCode === null || contact.regionCode === input.regionCode)
    && contact.ageBands.includes(input.ageBand)
    && contact.riskTypes.includes(risk)
    && contact.verifiedAt.getTime() <= input.now.getTime()
    && contact.validUntil.getTime() >= input.now.getTime()
    && contact.sourceUrl.startsWith("https://")
    && contact.owner.length > 0);
  try {
    const level = deterministicRisk ?? await classifier.classify(input.text);
    if (level === "ordinary") return { kind: "ordinary" as const, charge: -1 as const, contacts: [] };
    const contacts = selectContacts(level);
    return {
      kind: "human_handoff" as const,
      charge: 0 as const,
      reason: level,
      directoryState: contacts.length > 0 ? "fresh" as const : "no_fresh_contact" as const,
      contacts,
    };
  } catch {
    const contacts = selectContacts("uncertain");
    return {
      kind: "human_handoff" as const,
      charge: 0 as const,
      reason: "classifier_unavailable" as const,
      directoryState: contacts.length > 0 ? "fresh_fallback" as const : "fallback_required" as const,
      contacts,
    };
  }
}

export type HandoffState = {
  status: "opened" | "assigned" | "acknowledged" | "escalated" | "resolved";
  ownerId: string | null;
  openedAt: Date;
  acknowledgeBy: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  version: number;
};
export type HandoffAction =
  | "assign"
  | "acknowledge"
  | "check_ack_sla"
  | "resolve";

export function transitionHandoff(state: HandoffState, action: HandoffAction, now: Date): HandoffState {
  if (action === "check_ack_sla" && state.acknowledgedAt === null && now > state.acknowledgeBy) {
    return { ...state, status: "escalated", version: state.version + 1 };
  }
  if (action === "acknowledge" && state.status === "assigned") {
    return { ...state, status: "acknowledged", acknowledgedAt: now, version: state.version + 1 };
  }
  if (action === "resolve" && (state.status === "acknowledged" || state.status === "escalated")) {
    return { ...state, status: "resolved", resolvedAt: now, version: state.version + 1 };
  }
  throw new Error("Invalid handoff transition");
}
```

- [ ] **Step 4: Run focused tests and type checking**

Run: `pnpm exec vitest run packages/domain/src/consent.test.ts packages/domain/src/safety.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/consent.ts packages/domain/src/consent.test.ts packages/domain/src/safety.ts packages/domain/src/safety.test.ts packages/domain/src/index.ts
git commit -m "feat: enforce consent and safety policies"
```

---

### Task 6: Create the PostgreSQL schema, migration, and database testkit

**Files:**

- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema/identity.ts`
- Create: `packages/db/src/schema/catalog.ts`
- Create: `packages/db/src/schema/booking.ts`
- Create: `packages/db/src/schema/billing.ts`
- Create: `packages/db/src/schema/conversation.ts`
- Create: `packages/db/src/schema/audit.ts`
- Create: `packages/db/src/schema/integration.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0000_mvp.sql`
- Create: `packages/db/src/testkit/postgres.ts`
- Test: `tests/integration/schema.test.ts`

**Interfaces:** `createDb(connectionString): DrizzleDb`; `startTestPostgres(): Promise<TestDatabase>`; `TestDatabase.reset(): Promise<void>`; `TestDatabase.stop(): Promise<void>`.

The migration must create exactly these MVP tables:

| Domain | Tables | Required database invariants |
|---|---|---|
| Identity | `users`, `channel_identities`, `client_profiles`, `consents` | unique `(provider, external_id)`; append-only consent decisions; profile references a user |
| Catalog | `experts`, `expert_services`, `slots` | active and verified expert flags; active service flag; unique provider slot identity; `capacity > 0`; UTC timestamps |
| Billing | `message_packages`, `message_events`, `message_ledger_entries`, derived view `package_balances` | immutable positive grant; append-only debit/free/compensation/revocation facts; unique idempotency keys; no stored authoritative remainder |
| Booking | `reservations`, `notifications`, `feedback` | normative status check; positive version; unique reservation idempotency key; unique notification idempotency key |
| Conversation and safety | `conversations`, `conversation_messages`, `prompt_versions`, `safety_incidents`, `human_escalations` | content is referenced separately; prompt version is immutable; safety and handoff facts are append-only |
| Audit and approval | `audit_events`, `admin_approvals` | append-only actor/action/object/correlation facts; one-time authenticated approvals bound to action, object, requester, approver, expiry, and nonce |
| Privacy | `privacy_deletion_jobs`, `privacy_processor_attempts` | one idempotent subject workflow; per-processor status and receipt; backup-expiry evidence |
| Integration | `integration_inbox`, `integration_outbox`, `delivery_attempts`, `dead_letters`, `provider_cursors`, `reconciliation_runs`, `reconciliation_mismatches`, `projection_checkpoints` | unique provider event and outbox keys; explicit `unknown_outcome`; append-only attempt and mismatch evidence |

- [ ] **Step 1: Write the failing migrated-schema test**

```ts
// tests/integration/schema.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { startTestPostgres, type TestDatabase } from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
});
afterAll(async () => testDb.stop());

describe("MVP schema", () => {
  it("creates the authoritative MVP and operational-support tables", async () => {
    const rows = await testDb.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `);
    const names = rows.rows.map((row) => row.table_name);
    expect(names).toEqual(expect.arrayContaining([
      "audit_events", "channel_identities", "client_profiles", "consents",
      "experts", "expert_services", "feedback", "integration_inbox",
      "integration_outbox", "message_events", "message_ledger_entries",
      "message_packages", "notifications", "reservations", "slots", "users",
      "conversations", "conversation_messages", "prompt_versions",
      "safety_incidents", "human_escalations", "delivery_attempts",
      "dead_letters", "provider_cursors", "reconciliation_runs",
      "reconciliation_mismatches", "projection_checkpoints",
      "admin_approvals", "privacy_deletion_jobs", "privacy_processor_attempts",
    ]));
    expect(names).not.toEqual(expect.arrayContaining([
      "coupons", "payments", "referrals", "reminders", "reschedules", "waitlist",
    ]));
  });

  it("uses an append-only ledger-derived balance with no mutable remainder column", async () => {
    await testDb.seedUserAndPackage({ externalMessageId: "m-1", grantedMessages: 2 });
    await expect(testDb.insertDuplicateExternalMessage("m-1")).rejects.toThrow();
    expect(await testDb.columnExists("message_packages", "remaining_messages")).toBe(false);
    expect(await testDb.packageBalance()).toBe(2);
    await testDb.appendLedgerFact({ kind: "debit", delta: -1, idempotencyKey: "debit-1" });
    expect(await testDb.packageBalance()).toBe(1);
    await expect(testDb.updateLedgerFact("debit-1", 0)).rejects.toThrow("append-only");
    await expect(testDb.deleteLedgerFact("debit-1")).rejects.toThrow("append-only");
  });
});
```

- [ ] **Step 2: Run the integration test and confirm the expected failure**

Run: `pnpm exec vitest run tests/integration/schema.test.ts`

Expected: FAIL because the database testkit, schema, and first migration do not exist.

- [ ] **Step 3: Implement the schema and generated migration**

Use Drizzle `pgTable`, PostgreSQL enums, foreign keys, and named constraints. The critical constraint block in `0000_mvp.sql` must include:

```sql
create type reservation_status as enum (
  'reserved', 'booked', 'cancelled_by_client', 'cancelled_by_expert',
  'expired', 'completed', 'no_show'
);
create type outbox_status as enum (
  'pending', 'processing', 'unknown_outcome', 'reconciling',
  'succeeded', 'retry_wait', 'dead_letter'
);
create type ledger_entry_kind as enum (
  'grant', 'debit', 'free', 'compensation', 'revocation'
);

alter table channel_identities
  add constraint channel_identities_provider_external_unique unique (provider, external_id);
alter table slots
  add constraint slots_provider_external_unique unique (provider, external_slot_id),
  add constraint slots_capacity_positive check (capacity > 0);
alter table message_packages
  add constraint message_packages_grant_positive check (granted_messages > 0),
  add constraint message_packages_grant_idempotency_unique unique (grant_idempotency_key);
alter table message_events
  add constraint message_events_provider_external_unique unique (provider, external_message_id);
alter table message_ledger_entries
  add constraint message_ledger_idempotency_unique unique (idempotency_key),
  add constraint message_ledger_entry_once unique nulls not distinct
    (message_event_id, direction, message_class, entry_kind),
  add constraint message_ledger_delta_matches_kind check (
    (entry_kind = 'grant' and delta > 0)
    or (entry_kind = 'debit' and delta = -1)
    or (entry_kind = 'free' and delta = 0)
    or (entry_kind = 'compensation' and delta = 1)
    or (entry_kind = 'revocation' and delta <= 0)
  );
alter table reservations
  add constraint reservations_idempotency_unique unique (idempotency_key),
  add constraint reservations_version_positive check (version > 0),
  add constraint reservations_deadline_after_creation check (reserved_until > created_at);
alter table notifications
  add constraint notifications_idempotency_unique unique (idempotency_key);
alter table integration_inbox
  add constraint integration_inbox_provider_event_unique unique (provider, external_event_id);
alter table integration_outbox
  add constraint integration_outbox_idempotency_unique unique (idempotency_key);

create view package_balances as
select p.id as package_id, p.user_id, coalesce(sum(l.delta), 0)::integer as balance
from message_packages p
left join message_ledger_entries l on l.package_id = p.id
group by p.id, p.user_id;
```

Install `reject_append_only_change()` triggers on `message_packages`, `message_ledger_entries`, `consents`, `audit_events`, `safety_incidents`, `delivery_attempts`, and `reconciliation_mismatches`; the trigger raises SQLSTATE `55000` on update or delete. The only package correction is a new compensation or revocation fact. `package_balances` is a rebuildable view and never an input column.

Every mutable table has `created_at` and `updated_at`; append-only tables have only `created_at`. `conversation_messages` stores a nullable encrypted `content_ref`, never raw text; retention can remove the referenced content without rewriting financial or audit facts. `human_escalations` stores incident ID, status, owner ID, opened time, acknowledgement deadline/time, resolution time, version, and escalation reason. Notifications support nullable `callback_token_hash`, `callback_claims`, `callback_expires_at`, `callback_expert_id`, `callback_action`, `callback_version`, and `callback_consumed_at`; the token hash is unique when present, and the expert/action/version columns are validated in the same conditional consume statement. `audit_events` requires actor type/ID, authenticated session ID hash, action, object type/ID, decision, reason code, correlation ID, occurred time, and metadata hash. Delivery attempts, dead letters, provider cursors, reconciliation runs/mismatches, and projection checkpoints provide the evidence required by the design specification. Store provider payload hashes and normalized identifiers, not raw provider bodies. Implement the testkit with `@testcontainers/postgresql`, run migrations per suite, expose only the named seed/assertion helpers used by tests, and terminate the container in `stop`.

- [ ] **Step 4: Run migration, schema test, and type checking**

Run: `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts && pnpm exec vitest run tests/integration/schema.test.ts && pnpm typecheck`

Expected: PASS; the migration is valid, all authoritative MVP and operational-support tables and constraints exist, and deferred product tables are absent.

- [ ] **Step 5: Commit**

```bash
git add packages/db tests/integration/schema.test.ts
git commit -m "feat: add authoritative postgres schema"
```

---

### Task 7: Make inbox ingestion and message debiting idempotent and concurrency-safe

**Files:**

- Create: `packages/db/src/repositories/inbox-repository.ts`
- Create: `packages/db/src/repositories/message-repository.ts`
- Modify: `packages/db/src/index.ts`
- Test: `tests/integration/message-ledger-concurrency.test.ts`

**Interfaces:**

```ts
export interface AcceptInboundCommand {
  provider: string;
  externalEventId: string;
  externalMessageId: string;
  userId: string;
  messageClass: "ordinary_inbound" | "system" | "safety" | "error";
  occurredAt: Date;
  correlationId: string;
}
export type AcceptInboundResult =
  | { kind: "duplicate"; messageEventId: string }
  | { kind: "accepted"; messageEventId: string; packageId: string | null; ledgerBalance: number };
export interface RecordOutboundDeliveryCommand {
  provider: "selarti";
  externalDeliveryEventId: string;
  providerMessageId: string;
  userId: string;
  deliveryStatus: "delivered";
  occurredAt: Date;
  correlationId: string;
}
export interface CompensateDebitCommand {
  originalDebitKey: string;
  idempotencyKey: string;
}
export interface MessageRepository {
  acceptInbound(command: AcceptInboundCommand): Promise<AcceptInboundResult>;
  recordOutboundDelivery(command: RecordOutboundDeliveryCommand): Promise<AcceptInboundResult>;
  compensate(command: CompensateDebitCommand): Promise<{ ledgerBalance: number }>;
}
```

- [ ] **Step 1: Write failing duplicate and parallel-debit tests**

```ts
// tests/integration/message-ledger-concurrency.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMessageRepository, startTestPostgres, type TestDatabase } from "../../packages/db/src/index.js";

let testDb: TestDatabase;
beforeAll(async () => { testDb = await startTestPostgres(); await testDb.migrate(); });
afterAll(async () => testDb.stop());

describe("message ledger transaction", () => {
  it("records a retried provider message and debit exactly once", async () => {
    const userId = await testDb.createUserWithPackage(3);
    const repo = new PostgresMessageRepository(testDb.db);
    const command = {
      provider: "selarti",
      externalEventId: "evt-1",
      externalMessageId: "msg-1",
      userId,
      messageClass: "ordinary_inbound" as const,
      occurredAt: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "corr-1",
    };
    const [first, retry] = await Promise.all([repo.acceptInbound(command), repo.acceptInbound(command)]);
    expect([first.kind, retry.kind].sort()).toEqual(["accepted", "duplicate"]);
    expect(await testDb.packageBalance(userId)).toBe(2);
    expect(await testDb.ledgerEntryCount("msg-1")).toBe(1);
  });

  it("never drives a one-message balance below zero under parallel messages", async () => {
    const userId = await testDb.createUserWithPackage(1);
    const repo = new PostgresMessageRepository(testDb.db);
    const results = await Promise.all(["a", "b"].map((suffix) => repo.acceptInbound({
      provider: "selarti",
      externalEventId: `evt-${suffix}`,
      externalMessageId: `msg-${suffix}`,
      userId,
      messageClass: "ordinary_inbound",
      occurredAt: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: `corr-${suffix}`,
    })));
    expect(results.filter((result) => result.kind === "accepted" && result.packageId !== null)).toHaveLength(1);
    expect(await testDb.packageBalance(userId)).toBe(0);
  });

  it("rebuilds balance from facts and applies a compensation exactly once", async () => {
    const userId = await testDb.createUserWithPackage(2);
    const repo = new PostgresMessageRepository(testDb.db);
    await repo.acceptInbound({
      provider: "selarti",
      externalEventId: "evt-rebuild",
      externalMessageId: "msg-rebuild",
      userId,
      messageClass: "ordinary_inbound",
      occurredAt: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "corr-rebuild",
    });
    await Promise.all([
      repo.compensate({ originalDebitKey: "inbound:msg-rebuild", idempotencyKey: "comp-1" }),
      repo.compensate({ originalDebitKey: "inbound:msg-rebuild", idempotencyKey: "comp-1" }),
    ]);
    expect(await testDb.packageBalance(userId)).toBe(2);
    expect(await testDb.rebuildPackageBalance(userId)).toBe(2);
    expect(await testDb.mutableBalanceColumnCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the integration test and confirm the expected failure**

Run: `pnpm exec vitest run tests/integration/message-ledger-concurrency.test.ts`

Expected: FAIL because `PostgresMessageRepository` does not exist.

- [ ] **Step 3: Implement one serializable transaction per accepted message**

Implement `acceptInbound` with this exact ordering:

1. Insert `integration_inbox(provider, external_event_id, payload_hash)` with `ON CONFLICT DO NOTHING`; on conflict return the stored message event as `duplicate`.
2. Insert `message_events` with the canonical class and no raw text.
3. For zero-delta classes insert one append-only `free` fact and skip package locking.
4. For ordinary content, lock eligible immutable package rows with `FOR UPDATE`, derive each balance by summing ledger facts, and order by `kind = 'intro'`, expiry, grant time, and ID.
5. Insert one idempotent append-only `debit` fact only when the locked derived balance is positive; never update a package counter.
6. When no package is available, return `packageId: null`, balance `0`, and do not insert a negative ledger fact.
7. Commit the inbox, event, ledger fact, audit fact, and any resulting outbox item atomically.

The package lock query is:

```sql
select p.id, balances.balance
from message_packages p
cross join lateral (
  select coalesce(sum(l.delta), 0)::integer as balance
  from message_ledger_entries l
  where l.package_id = p.id
) balances
where p.user_id = $1
  and balances.balance > 0
  and (p.expires_at is null or p.expires_at > $2)
order by (p.kind = 'intro') asc, p.expires_at asc nulls last, p.granted_at asc, p.id asc
for update of p
limit 1;
```

Map PostgreSQL unique violations for the inbox key to the `duplicate` result; propagate every other database error. Compensation locks the original debit’s package, verifies that the debit exists and has not already been compensated, and inserts `+1` with a unique original-debit relation. Revocation in Task 17 locks the same row, derives the current balance, and appends one `revocation` fact with `delta = -balance`.

- [ ] **Step 4: Run concurrency tests repeatedly**

Run: `pnpm test:repeat -- 20 tests/integration/message-ledger-concurrency.test.ts && pnpm typecheck`

Expected: PASS in all repetitions with one debit per unique ordinary message and no negative balance.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories packages/db/src/index.ts tests/integration/message-ledger-concurrency.test.ts
git commit -m "feat: make message ledger idempotent"
```

---

### Task 8: Make slot reservation and callbacks concurrency-safe

**Files:**

- Create: `packages/db/src/repositories/booking-repository.ts`
- Modify: `packages/db/src/index.ts`
- Test: `tests/integration/booking-concurrency.test.ts`

**Interfaces:**

```ts
export interface ReserveSlotCommand {
  idempotencyKey: string;
  userId: string;
  slotId: string;
  now: Date;
  minimumLeadMs: number;
  confirmationBufferMs: number;
  correlationId: string;
}
export type ReserveSlotResult =
  | { kind: "reserved"; reservationId: string; reservedUntil: Date; version: number }
  | { kind: "duplicate"; reservationId: string; reservedUntil: Date; version: number }
  | {
      kind: "unavailable";
      reason:
        | "lead_time"
        | "capacity"
        | "deadline"
        | "stale_slot"
        | "expert_ineligible"
        | "client_active_overlap"
        | "expert_active_overlap";
    };
export interface TransitionReservationCommand {
  reservationId: string;
  expectedVersion: number;
  action: ReservationAction;
  actor: { type: "expert" | "client" | "system"; id: string };
  now: Date;
  correlationId: string;
}
```

- [ ] **Step 1: Write failing booking concurrency and stale-callback tests**

```ts
// tests/integration/booking-concurrency.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresBookingRepository, startTestPostgres, type TestDatabase } from "../../packages/db/src/index.js";

let testDb: TestDatabase;
beforeAll(async () => { testDb = await startTestPostgres(); await testDb.migrate(); });
afterAll(async () => testDb.stop());

describe("booking transaction", () => {
  it("allocates the last place to exactly one concurrent client", async () => {
    const slotId = await testDb.createSlot({ capacity: 1, startsAt: "2026-08-02T10:00:00.000Z" });
    const users = await Promise.all([testDb.createUser(), testDb.createUser()]);
    const repo = new PostgresBookingRepository(testDb.db);
    const results = await Promise.all(users.map((userId, index) => repo.reserve({
      idempotencyKey: `reserve-${index}`,
      userId,
      slotId,
      now: new Date("2026-07-28T10:00:00.000Z"),
      minimumLeadMs: 24 * 60 * 60 * 1_000,
      confirmationBufferMs: 60 * 60 * 1_000,
      correlationId: `corr-${index}`,
    })));
    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "unavailable")).toHaveLength(1);
  });

  it("BOOK-02 rejects a second active overlapping reservation for the same client", async () => {
    const fixture = await testDb.createOverlappingClientSlots();
    const repo = new PostgresBookingRepository(testDb.db);
    expect((await repo.reserve(fixture.first)).kind).toBe("reserved");
    await expect(repo.reserve(fixture.second)).resolves.toMatchObject({
      kind: "unavailable",
      reason: "client_active_overlap",
    });
  });

  it("BOOK-03 rejects overlapping active slots for the same expert", async () => {
    const fixture = await testDb.createOverlappingExpertSlots();
    const repo = new PostgresBookingRepository(testDb.db);
    expect((await repo.reserve(fixture.first)).kind).toBe("reserved");
    await expect(repo.reserve(fixture.second)).resolves.toMatchObject({
      kind: "unavailable",
      reason: "expert_active_overlap",
    });
  });

  it("returns the same reservation for a repeated selection and rejects stale callback versions", async () => {
    const fixture = await testDb.createReservableFixture();
    const repo = new PostgresBookingRepository(testDb.db);
    const first = await repo.reserve(fixture.command);
    if (first.kind !== "reserved") throw new Error(`Expected reserved, received ${first.kind}`);
    const retry = await repo.reserve(fixture.command);
    expect(retry).toMatchObject({ kind: "duplicate", reservationId: first.reservationId });
    await repo.transition({
      reservationId: first.reservationId,
      expectedVersion: 1,
      action: "expert_confirm",
      actor: { type: "expert", id: fixture.expertId },
      now: new Date("2026-07-28T10:01:00.000Z"),
      correlationId: "confirm-1",
    });
    await expect(repo.transition({
      reservationId: first.reservationId,
      expectedVersion: 1,
      action: "expert_confirm",
      actor: { type: "expert", id: fixture.expertId },
      now: new Date("2026-07-28T10:02:00.000Z"),
      correlationId: "confirm-retry",
    })).rejects.toThrow("Stale reservation version");
  });

  it.each([
    ["expired_hold", "Reservation hold has expired"],
    ["wrong_expert", "Expert does not own reservation"],
    ["inactive_expert", "Expert is not eligible"],
    ["past_slot", "Slot is no longer confirmable"],
  ])("rejects ineligible confirm: %s", async (caseName, expected) => {
    const fixture = await testDb.createConfirmEligibilityCase(caseName);
    const repo = new PostgresBookingRepository(testDb.db);
    await expect(repo.transition({
      reservationId: fixture.reservationId,
      expectedVersion: 1,
      action: "expert_confirm",
      actor: { type: "expert", id: fixture.actorExpertId },
      now: fixture.now,
      correlationId: `confirm-${caseName}`,
    })).rejects.toThrow(expected);
    expect(await testDb.reservationStatus(fixture.reservationId)).toBe("reserved");
  });
});
```

- [ ] **Step 2: Run the integration test and confirm the expected failure**

Run: `pnpm exec vitest run tests/integration/booking-concurrency.test.ts`

Expected: FAIL because `PostgresBookingRepository` does not exist.

- [ ] **Step 3: Implement row-locked capacity and optimistic callbacks**

Run `reserve` and `transition` at `SERIALIZABLE` isolation. Before predicate reads, take transaction-scoped advisory locks for the slot ID, client ID, and expert ID in lexicographic order; then lock the slot, expert, and expert-service rows with `FOR UPDATE`. `reserve` rejects stale provider data, inactive/unverified experts, inactive services, `starts_at < now + 24h`, invalid deadlines, exhausted capacity, any active client reservation whose `[starts_at, ends_at)` overlaps the candidate, and any active reservation for the same expert whose interval overlaps the candidate. Active means `reserved` or `booked`. Return the existing reservation only on the same idempotency key; a different command for the same client is evaluated against overlap predicates.

Within `transition`, treat `now` as an injected server clock value, never provider or client input. Lock and join reservation, slot, expert, and service. Expert confirm additionally requires: actor type `expert`; actor ID equals reservation expert ID; expert active and verified; service active; `reserved_until > now`; slot `starts_at > now`; slot observation fresh; no conflicting active client reservation; and no conflicting active expert interval. Client cancel requires actor ownership. System expiry requires `reserved_until <= now`. Only after all predicates pass may the update increment version, append audit, and enqueue the next provider notification in the same transaction. If no row is updated, return a specific missing, stale-version, ownership, expiry, eligibility, or overlap error without changing state.

Use this mutation guard:

```sql
update reservations
set status = $1, version = r.version + 1, updated_at = $5
from slots s, experts e, expert_services es
where r.id = $2
  and r.version = $3
  and r.status = any($4::reservation_status[])
  and s.id = r.slot_id
  and e.id = r.expert_id
  and es.id = r.expert_service_id
  and r.reserved_until > $5
  and s.starts_at > $5
  and e.active = true
  and e.verified = true
  and es.active = true
returning r.id, r.status, r.version;
```

- [ ] **Step 4: Run the concurrency test repeatedly**

Run: `pnpm test:repeat -- 20 tests/integration/booking-concurrency.test.ts && pnpm typecheck`

Expected: PASS in all repetitions; capacity, idempotency, and version invariants hold.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories/booking-repository.ts packages/db/src/index.ts tests/integration/booking-concurrency.test.ts
git commit -m "feat: make booking concurrency safe"
```

---

### Task 9: Implement transactional outbox delivery with bounded retry and dead letter

**Files:**

- Create: `packages/db/src/repositories/outbox-repository.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/worker/src/outbox-runner.ts`
- Create: `packages/worker/src/outbox-runner.testkit.ts`
- Modify: `packages/worker/src/index.ts`
- Test: `tests/integration/outbox-runner.test.ts`

**Interfaces:**

```ts
export interface OutboxMessage {
  id: string;
  topic: string;
  payload: unknown;
  correlationId: string;
  attempt: number;
}
export interface OutboxRepository {
  claim(limit: number, leaseUntil: Date): Promise<readonly OutboxMessage[]>;
  claimUnknown(limit: number): Promise<readonly OutboxMessage[]>;
  recordAttemptStarted(id: string, attemptId: string, startedAt: Date): Promise<void>;
  markUnknownOutcome(id: string, attemptId: string, reasonCode: string): Promise<void>;
  succeed(id: string): Promise<void>;
  retry(id: string, nextAttemptAt: Date, reasonCode: string): Promise<void>;
  deadLetter(id: string, reasonCode: string): Promise<void>;
  recoverExpiredLeases(now: Date): Promise<number>;
}
export type DispatchOutcome =
  | { kind: "applied"; providerOperationId: string }
  | { kind: "not_applied"; retryable: boolean; reasonCode: string }
  | { kind: "unknown_outcome"; reconciliationKey: string; reasonCode: string };
export interface OutboxDispatcher { dispatch(message: OutboxMessage): Promise<DispatchOutcome> }
export interface OutboxReconciler {
  reconcile(message: OutboxMessage): Promise<"applied" | "not_applied" | "still_unknown">;
}
export function runOutboxBatch(deps: OutboxRunnerDeps): Promise<OutboxRunResult>;
export function fakeOutboxRepository(seed: readonly Pick<OutboxMessage, "id" | "topic" | "attempt">[]): FakeOutboxRepository;
```

- [ ] **Step 1: Write the failing retry, lease, and dead-letter tests**

```ts
// tests/integration/outbox-runner.test.ts
import { describe, expect, it, vi } from "vitest";
import { runOutboxBatch } from "../../packages/worker/src/outbox-runner.js";
import { fakeOutboxRepository } from "../../packages/worker/src/outbox-runner.testkit.js";

describe("outbox runner", () => {
  it("retries a confirmed pre-send failure and executes the second attempt", async () => {
    const repository = fakeOutboxRepository([{ id: "o-1", topic: "client.notify", attempt: 0 }]);
    const dispatch = vi.fn()
      .mockResolvedValueOnce({ kind: "not_applied", retryable: true, reasonCode: "connect_failed" })
      .mockResolvedValueOnce({ kind: "applied", providerOperationId: "provider-1" });
    const deps = {
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile: vi.fn() },
      now: () => new Date("2026-07-28T10:00:00.000Z"),
      retryDelayMs: () => 1_000,
      maxAttempts: 3,
      batchSize: 10,
      newAttemptId: () => "attempt-1",
    };
    await runOutboxBatch(deps);
    repository.makeRetriesDue();
    await runOutboxBatch({ ...deps, newAttemptId: () => "attempt-2" });
    expect(repository.retryCalls).toEqual([
      { id: "o-1", at: "2026-07-28T10:00:01.000Z", reasonCode: "connect_failed" },
    ]);
    expect(repository.succeedCalls).toEqual(["o-1"]);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("reconciles a timeout after provider commit before any resend", async () => {
    const repository = fakeOutboxRepository([{ id: "o-2", topic: "planerka.reserve", attempt: 0 }]);
    const dispatch = vi.fn().mockResolvedValue({
      kind: "unknown_outcome",
      reconciliationKey: "reserve:o-2",
      reasonCode: "response_timeout",
    });
    const reconcile = vi.fn().mockResolvedValue("applied");
    await runOutboxBatch({
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile },
      now: () => new Date("2026-07-28T10:00:00.000Z"),
      retryDelayMs: () => 1_000,
      maxAttempts: 3,
      batchSize: 10,
      newAttemptId: () => "attempt-unknown",
    });
    repository.makeUnknownClaimable();
    await runOutboxBatch({
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile },
      now: () => new Date("2026-07-28T10:01:00.000Z"),
      retryDelayMs: () => 1_000,
      maxAttempts: 3,
      batchSize: 10,
      newAttemptId: () => "must-not-dispatch",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(repository.succeedCalls).toEqual(["o-2"]);
  });

  it("recovers a crash after provider success as unknown and reconciles without resend", async () => {
    const repository = fakeOutboxRepository([{ id: "o-3", topic: "selarti.send", attempt: 0 }]);
    repository.failNextLocalSuccessWrite();
    const dispatch = vi.fn().mockResolvedValue({ kind: "applied", providerOperationId: "message-3" });
    const reconcile = vi.fn().mockResolvedValue("applied");
    const deps = {
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile },
      now: () => new Date("2026-07-28T10:00:00.000Z"),
      retryDelayMs: () => 1_000,
      maxAttempts: 3,
      batchSize: 10,
      newAttemptId: () => "attempt-crash",
    };
    await expect(runOutboxBatch(deps)).rejects.toThrow("simulated local acknowledgement failure");
    await repository.recoverExpiredLeases(new Date("2026-07-28T10:01:00.000Z"));
    repository.makeUnknownClaimable();
    await runOutboxBatch(deps);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("dead-letters a permanent not-applied result without another dispatch", async () => {
    const repository = fakeOutboxRepository([{ id: "o-4", topic: "telegram.send", attempt: 0 }]);
    const dispatch = vi.fn().mockResolvedValue({
      kind: "not_applied",
      retryable: false,
      reasonCode: "recipient_blocked",
    });
    await runOutboxBatch({
      repository,
      dispatcher: { dispatch },
      reconciler: { reconcile: vi.fn() },
      now: () => new Date("2026-07-28T10:00:00.000Z"),
      retryDelayMs: () => 1_000,
      maxAttempts: 3,
      batchSize: 10,
      newAttemptId: () => "attempt-permanent",
    });
    expect(repository.deadLetterCalls).toEqual([
      { id: "o-4", reasonCode: "recipient_blocked" },
    ]);
    expect(repository.retryCalls).toEqual([]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm the expected failure**

Run: `pnpm exec vitest run tests/integration/outbox-runner.test.ts`

Expected: FAIL because the outbox runner and repository do not exist.

- [ ] **Step 3: Implement leased claims and one finite decision per message**

Claim pending/retry rows with `FOR UPDATE SKIP LOCKED`, set `processing`, increment attempt, and set a finite lease. Before network I/O, append `delivery_attempts(state = 'started')`. An expired `processing` lease always becomes `unknown_outcome`, never `retry_wait`, because the process may have crashed after provider commit. Unknown rows are claimed separately as `reconciling`; only reconciliation may move them to `succeeded`, `retry_wait`, or leave them unknown.

```ts
export async function runOutboxBatch(deps: OutboxRunnerDeps): Promise<OutboxRunResult> {
  const now = deps.now();
  await deps.repository.recoverExpiredLeases(now);
  const unknown = await deps.repository.claimUnknown(deps.batchSize);
  for (const message of unknown) {
    const resolution = await deps.reconciler.reconcile(message);
    if (resolution === "applied") await deps.repository.succeed(message.id);
    if (resolution === "not_applied") {
      await deps.repository.retry(message.id, new Date(now.getTime() + deps.retryDelayMs(message.attempt)), "reconciled_not_applied");
    }
    if (resolution === "still_unknown") {
      await deps.repository.markUnknownOutcome(message.id, `reconcile-${message.attempt}`, "still_unknown");
    }
  }
  const messages = await deps.repository.claim(deps.batchSize, new Date(now.getTime() + 30_000));
  for (const message of messages) {
    const attemptId = deps.newAttemptId();
    await deps.repository.recordAttemptStarted(message.id, attemptId, now);
    const outcome = await deps.dispatcher.dispatch(message);
    if (outcome.kind === "applied") {
      await deps.repository.succeed(message.id);
      continue;
    }
    if (outcome.kind === "unknown_outcome") {
      await deps.repository.markUnknownOutcome(message.id, attemptId, outcome.reasonCode);
      continue;
    }
    if (outcome.retryable && message.attempt + 1 < deps.maxAttempts) {
      await deps.repository.retry(
        message.id,
        new Date(now.getTime() + deps.retryDelayMs(message.attempt + 1)),
        outcome.reasonCode,
      );
    } else {
      await deps.repository.deadLetter(message.id, outcome.reasonCode);
    }
  }
  return { reconciled: unknown.length, dispatched: messages.length };
}
```

Transport adapters must distinguish `not_applied` only when failure happened before bytes were sent or the provider explicitly rejected the command. Timeouts, connection resets after write, malformed success responses, and local acknowledgement-write failures are `unknown_outcome`. Use exponential backoff with bounded full jitter for confirmed-not-applied rows and a separate reconciliation schedule for ambiguous rows. `outbox-runner.testkit.ts` implements every repository transition plus lease recovery, second-attempt activation, unknown claims, and fault injection used by the tests. Store normalized reason codes and payload hashes, not secrets or raw provider bodies.

- [ ] **Step 4: Run focused and integration tests**

Run: `pnpm exec vitest run tests/integration/outbox-runner.test.ts && pnpm test:integration && pnpm typecheck`

Expected: PASS; confirmed-not-applied failures retry, ambiguous results reconcile before retry, acknowledgement crashes do not resend, leases recover, and terminal failures reach dead letter.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories/outbox-repository.ts packages/db/src/index.ts packages/worker tests/integration/outbox-runner.test.ts
git commit -m "feat: add durable outbox runner"
```

---

### Task 10: Define Selarti ingress and egress ports with a disabled live binding

**Files:**

- Create: `packages/integrations/src/selarti/selarti-port.ts`
- Create: `packages/integrations/src/selarti/disabled-selarti-adapter.ts`
- Create: `packages/integrations/src/http/webhook-auth.ts`
- Modify: `packages/integrations/src/index.ts`
- Test: `tests/contract/selarti-port.test.ts`
- Create: `tests/fixtures/selarti/inbound-success.json`
- Create: `tests/fixtures/selarti/inbound-duplicate.json`
- Create: `tests/fixtures/selarti/invalid-schema.json`
- Create: `tests/fixtures/selarti/rate-limit.json`
- Create: `tests/fixtures/selarti/timeout-before-send.json`
- Create: `tests/fixtures/selarti/timeout-after-send.json`
- Create: `tests/fixtures/selarti/delivery-contract-unconfirmed.json`
- Create: `docs/contracts/provider-activation.md`

**Interfaces:**

```ts
export interface CanonicalInboundMessage {
  kind: "inbound_message";
  providerEventId: string;
  providerMessageId: string;
  channelUserId: string;
  occurredAt: string;
  text: string;
}
export interface CanonicalOutboundDelivery {
  kind: "outbound_delivery";
  provider: "selarti";
  providerEventId: string;
  providerMessageId: string;
  occurredAt: string;
  status: "delivered";
}
export type CanonicalSelartiEvent = CanonicalInboundMessage | CanonicalOutboundDelivery;
export type SelartiSendOutcome =
  | { kind: "applied"; providerOperationId: string }
  | { kind: "not_applied"; retryable: boolean; reasonCode: string }
  | { kind: "unknown_outcome"; reconciliationKey: string; reasonCode: string };
export interface SelartiPort {
  decodeVerifiedWebhook(rawBody: Uint8Array, headers: Readonly<Record<string, string>>): Promise<CanonicalSelartiEvent>;
  sendMessage(command: { idempotencyKey: string; channelUserId: string; text: string }): Promise<SelartiSendOutcome>;
}
export function verifySignedWebhook(input: SignedWebhookInput): WebhookVerification;
```

- [ ] **Step 1: Write failing disabled-adapter and generic webhook-firewall tests**

```ts
// tests/contract/selarti-port.test.ts
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DisabledSelartiAdapter, verifySignedWebhook } from "../../packages/integrations/src/index.js";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`tests/fixtures/selarti/${name}.json`, "utf8")) as Record<string, unknown>;
const loadSelartiFixtures = () => ({
  success: fixture("inbound-success"),
  duplicate: fixture("inbound-duplicate"),
  deliveryContractUnconfirmed: fixture("delivery-contract-unconfirmed"),
});
const signedWebhookFixture = () => {
  const body = Buffer.from('{"event":"message"}');
  const timestamp = "1785232800";
  const secret = "__PLACEHOLDER_CONTRACT_TEST_SECRET__";
  return {
    body,
    contentType: "application/json",
    signature: createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex"),
    timestamp,
    secret,
    nowEpochSeconds: 1785232800,
    maxAgeSeconds: 300,
    maxBodyBytes: 64_000,
  };
};
const verifyFixtureWebhook = verifySignedWebhook;

describe("Selarti boundary", () => {
  it("rejects missing, forged, expired, oversized, and wrong-content-type webhooks", () => {
    const body = Buffer.from('{"event":"message"}');
    const timestamp = "1785232800";
    const secret = "__PLACEHOLDER_CONTRACT_TEST_SECRET__";
    const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
    expect(verifySignedWebhook({
      body,
      contentType: "application/json",
      signature,
      timestamp,
      secret,
      nowEpochSeconds: 1785232800,
      maxAgeSeconds: 300,
      maxBodyBytes: 64_000,
    })).toEqual({ accepted: true });
    expect(verifySignedWebhook({
      body,
      contentType: "text/plain",
      signature,
      timestamp,
      secret,
      nowEpochSeconds: 1785232800,
      maxAgeSeconds: 300,
      maxBodyBytes: 64_000,
    })).toMatchObject({ accepted: false, reason: "content_type" });
  });

  it("cannot decode or send while the official provider contract is unapproved", async () => {
    const adapter = new DisabledSelartiAdapter();
    await expect(adapter.decodeVerifiedWebhook(new Uint8Array(), {})).rejects.toThrow("Selarti integration is disabled");
    await expect(adapter.sendMessage({ idempotencyKey: "send-1", channelUserId: "u-1", text: "hello" }))
      .rejects.toThrow("Selarti integration is disabled");
  });

  it("treats send acceptance as unbilled and requires a separate stable delivery event", () => {
    const fixtures = loadSelartiFixtures();
    expect(fixtures.success).toMatchObject({
      channel_id: expect.any(String),
      external_chat_id: expect.any(String),
      message_id: expect.any(String),
      message_text: expect.any(String),
      wh_type: "all_messages",
    });
    expect(fixtures.duplicate.message_id).toBe(fixtures.success.message_id);
    expect(fixtures.deliveryContractUnconfirmed).toEqual({
      outboundBillingMode: "disabled",
      reason: "stable Selarti delivery event is not confirmed by approved contract evidence",
    });
  });

  it.each([
    ["missing_header", { signature: "", timestamp: "1785232800" }],
    ["signature", { signature: "forged", timestamp: "1785232800" }],
    ["timestamp", { signature: "forged", timestamp: "1785232000" }],
  ])("rejects webhook auth case %s", (reason, override) => {
    expect(verifyFixtureWebhook({ ...signedWebhookFixture(), ...override })).toMatchObject({
      accepted: false,
      reason,
    });
  });
});
```

- [ ] **Step 2: Run the contract test and confirm the expected failure**

Run: `pnpm exec vitest run tests/contract/selarti-port.test.ts`

Expected: FAIL because the Selarti port, disabled adapter, and webhook verifier do not exist.

- [ ] **Step 3: Implement the port, constant-time firewall, and disabled adapter**

`verifySignedWebhook` is a provider-independent edge control, not evidence that Selarti supports HMAC. It must require exact JSON content type, a bounded raw body, an integer timestamp within the configured freshness window, and a constant-time HMAC comparison. It returns a closed reason union: `missing_header`, `content_type`, `body_size`, `timestamp`, or `signature`. Selarti stays disabled because its public contract does not confirm inbound authentication.

```ts
// packages/integrations/src/selarti/disabled-selarti-adapter.ts
import type { CanonicalSelartiEvent, SelartiPort, SelartiSendOutcome } from "./selarti-port.js";

export class DisabledSelartiAdapter implements SelartiPort {
  async decodeVerifiedWebhook(
    _rawBody: Uint8Array,
    _headers: Readonly<Record<string, string>>,
  ): Promise<CanonicalSelartiEvent> {
    throw new Error("Selarti integration is disabled");
  }

  async sendMessage(
    _command: { idempotencyKey: string; channelUserId: string; text: string },
  ): Promise<SelartiSendOutcome> {
    throw new Error("Selarti integration is disabled");
  }
}
```

Capture sanitized fixtures for the documented all-messages payload, duplicate identity, invalid schema, rate limit, pre-send timeout, post-send timeout, and the unconfirmed delivery contract. Each fixture includes `source_document`, `captured_at`, `sanitized: true`, and `contract_status`. Timeout fixtures map to `not_applied` before write and `unknown_outcome` after write. The delivery fixture contains only the explicit disabled-billing decision; it must not invent a provider status field.

In `docs/contracts/provider-activation.md`, define the activation evidence fields and set Selarti status to `NO-GO`: official contract version, document checksum, authentication method, webhook replay window, payload fixtures, sandbox tenant, rate limits, timeout semantics, idempotency support, stable outbound-delivery event identity, security reviewer, product approver, and evidence date. Runtime `SELARTI_OUTBOUND_BILLING_MODE=disabled`; send acceptance never calls `recordOutboundDelivery`. If a future approved contract provides stable delivery events, they enter through `integration_inbox` as `CanonicalOutboundDelivery` and Task 7 meters them idempotently in a separate transaction. A live codec or HTTP adapter is not added by this task.

- [ ] **Step 4: Run contract tests and type checking**

Run: `pnpm exec vitest run tests/contract/selarti-port.test.ts && pnpm typecheck`

Expected: PASS; the security firewall works independently and Selarti network activity is impossible.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/selarti packages/integrations/src/http packages/integrations/src/index.ts tests/contract/selarti-port.test.ts tests/fixtures/selarti docs/contracts/provider-activation.md
git commit -m "feat: define disabled selarti boundary"
```

---

### Task 11: Add Telegram expert authorization, signed callbacks, and schedule delivery

**Files:**

- Create: `packages/integrations/src/telegram/callback-token.ts`
- Create: `packages/integrations/src/telegram/telegram-adapter.ts`
- Modify: `packages/integrations/src/index.ts`
- Create: `packages/db/src/repositories/telegram-callback-repository.ts`
- Modify: `packages/db/src/index.ts`
- Test: `tests/contract/telegram-port.test.ts`
- Create: `tests/fixtures/telegram/send-success.json`
- Create: `tests/fixtures/telegram/update-duplicate.json`
- Create: `tests/fixtures/telegram/callback-expired.json`
- Create: `tests/fixtures/telegram/expert-deactivated.json`
- Create: `tests/fixtures/telegram/rate-limit-429.json`
- Create: `tests/fixtures/telegram/timeout-after-send.json`
- Create: `tests/fixtures/telegram/invalid-schema.json`

**Interfaces:**

```ts
export interface ExpertCallbackClaims {
  reservationId: string;
  expertId: string;
  action: "confirm" | "cancel";
  version: number;
  expiresAtEpochSeconds: number;
}
export interface ExpertBinding {
  telegramUserId: string;
  expertId: string;
  active: boolean;
}
export interface CallbackClaimsStore {
  put(tokenHash: string, claims: ExpertCallbackClaims): Promise<void>;
  peek(tokenHash: string): Promise<ExpertCallbackClaims | null>;
  consumeIfValid(input: {
    tokenHash: string;
    expertId: string;
    action: "confirm" | "cancel";
    version: number;
    now: Date;
  }): Promise<ExpertCallbackClaims | null>;
}
export function issueCallback(claims: ExpertCallbackClaims, secret: Uint8Array, store: CallbackClaimsStore): Promise<string>;
export function verifyCallback(token: string, expectedTelegramUserId: string, binding: ExpertBinding, secret: Uint8Array, store: CallbackClaimsStore, now: Date): Promise<ExpertCallbackClaims>;
export type TelegramSendOutcome =
  | { kind: "applied"; providerOperationId: string }
  | { kind: "not_applied"; retryable: boolean; reasonCode: string; retryAfterMs?: number }
  | { kind: "unknown_outcome"; reconciliationKey: string; reasonCode: string };
export interface TelegramPort {
  sendReservationRequest(view: ExpertReservationView): Promise<TelegramSendOutcome>;
  sendSchedule(view: ExpertScheduleView): Promise<TelegramSendOutcome>;
}
export function buildTelegramMethodUrl(baseUrl: URL, botToken: string, method: "sendMessage"): URL;
export function redactTelegramUrl(url: URL): string;
```

- [ ] **Step 1: Write failing authorization and callback tests**

```ts
// tests/contract/telegram-port.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildTelegramMethodUrl,
  issueCallback,
  redactTelegramUrl,
  verifyCallback,
  type ExpertCallbackClaims,
} from "../../packages/integrations/src/index.js";

const memoryCallbackStore = () => {
  const values = new Map<string, {
    reservationId: string;
    expertId: string;
    action: "confirm" | "cancel";
    version: number;
    expiresAtEpochSeconds: number;
  }>();
  return {
    async put(key: string, value: ExpertCallbackClaims) {
      values.set(key, value);
    },
    async peek(key: string) {
      return values.get(key) ?? null;
    },
    async consumeIfValid(input: {
      tokenHash: string;
      expertId: string;
      action: "confirm" | "cancel";
      version: number;
      now: Date;
    }) {
      const value = values.get(input.tokenHash) ?? null;
      if (
        value === null
        || value.expertId !== input.expertId
        || value.action !== input.action
        || value.version !== input.version
        || value.expiresAtEpochSeconds <= Math.floor(input.now.getTime() / 1_000)
      ) return null;
      values.delete(input.tokenHash);
      return value;
    },
  };
};

describe("Telegram expert callback", () => {
  const secret = new TextEncoder().encode("__PLACEHOLDER_CALLBACK_HMAC_KEY__");
  const claims = {
    reservationId: "019fa875-2d67-78f1-8c71-f4936268da29",
    expertId: "expert-1",
    action: "confirm" as const,
    version: 3,
    expiresAtEpochSeconds: 1785233100,
  };

  it("binds a compact opaque callback to numeric Telegram identity, expert, version, and expiry", async () => {
    const store = memoryCallbackStore();
    const token = await issueCallback(claims, secret, store);
    expect(Buffer.byteLength(token, "utf8")).toBeLessThanOrEqual(64);
    expect(token).not.toContain(claims.reservationId);
    await expect(verifyCallback(
      token,
      "123456789",
      { telegramUserId: "123456789", expertId: "expert-1", active: true },
      secret,
      store,
      new Date("2026-07-28T10:00:00.000Z"),
    )).resolves.toEqual(claims);
    await expect(verifyCallback(
      token,
      "123456789",
      { telegramUserId: "123456789", expertId: "expert-1", active: true },
      secret,
      store,
      new Date("2026-07-28T10:00:00.000Z"),
    )).rejects.toThrow("Callback token is unknown or already used");
  });

  it("validates binding before consume so a wrong expert cannot burn the token", async () => {
    const store = memoryCallbackStore();
    const token = await issueCallback(claims, secret, store);
    await expect(verifyCallback(
      token,
      "987654321",
      { telegramUserId: "123456789", expertId: "expert-1", active: true },
      secret,
      store,
      new Date("2026-07-28T10:00:00.000Z"),
    )).rejects.toThrow("Telegram identity is not authorized");
    await expect(verifyCallback(
      token,
      "123456789",
      { telegramUserId: "123456789", expertId: "expert-1", active: true },
      secret,
      store,
      new Date("2026-07-28T10:00:00.000Z"),
    )).resolves.toEqual(claims);
  });

  it("rejects tampering, expiry, and a deactivated expert without consuming a valid token", async () => {
    const store = memoryCallbackStore();
    const token = await issueCallback(claims, secret, store);
    await expect(verifyCallback(
      `${token}x`,
      "123456789",
      { telegramUserId: "123456789", expertId: "expert-1", active: true },
      secret,
      store,
      new Date("2026-07-28T10:00:00.000Z"),
    )).rejects.toThrow("Invalid callback token");
    await expect(verifyCallback(
      token,
      "123456789",
      { telegramUserId: "123456789", expertId: "expert-1", active: false },
      secret,
      store,
      new Date("2026-07-28T10:00:00.000Z"),
    )).rejects.toThrow("Expert binding is inactive");
    await expect(verifyCallback(
      token,
      "123456789",
      { telegramUserId: "123456789", expertId: "expert-1", active: true },
      secret,
      store,
      new Date("2026-07-28T10:06:00.000Z"),
    )).rejects.toThrow("Callback token has expired");
  });

  it("uses the official token-bearing method path but redacts it from logs and errors", () => {
    const token = "__PLACEHOLDER_TELEGRAM_BOT_TOKEN__";
    const url = buildTelegramMethodUrl(new URL("https://api.telegram.org"), token, "sendMessage");
    expect(url.pathname).toBe(`/bot${token}/sendMessage`);
    expect(redactTelegramUrl(url)).toBe("https://api.telegram.org/bot[REDACTED]/sendMessage");
    expect(redactTelegramUrl(url)).not.toContain(token);
  });

  it.each([
    "send-success",
    "update-duplicate",
    "callback-expired",
    "expert-deactivated",
    "rate-limit-429",
    "timeout-after-send",
    "invalid-schema",
  ])("parses the sanitized Telegram fixture %s", (name) => {
    const value = JSON.parse(
      readFileSync(`tests/fixtures/telegram/${name}.json`, "utf8"),
    ) as { sanitized: boolean; expectedOutcome: string };
    expect(value.sanitized).toBe(true);
    expect(value.expectedOutcome).toMatch(
      /^(applied|duplicate|expired|unauthorized|retryable|unknown_outcome|invalid_schema)$/,
    );
  });
});
```

- [ ] **Step 2: Run the contract test and confirm the expected failure**

Run: `pnpm exec vitest run tests/contract/telegram-port.test.ts`

Expected: FAIL because callback signing and the Telegram adapter do not exist.

- [ ] **Step 3: Implement compact one-time callbacks and the narrow Telegram adapter**

Generate a 16-byte random nonce, persist `SHA-256(nonce)` with the claims through `CallbackClaimsStore`, append a 16-byte truncated HMAC over the nonce, and encode the version byte, nonce, and tag as base64url. Prefix the result with `ct1.` and reject any result over Telegram's 64-byte callback limit. Verification authenticates the tag in constant time, calls `peek`, then validates numeric Telegram binding, active expert state, expiry, expert match, action allowlist, and positive version. Only then may it call `consumeIfValid`.

`PostgresTelegramCallbackRepository.consumeIfValid` uses one atomic update whose predicate includes token hash, unconsumed state, expiry, bound expert, allowed action, and positive expected version:

```sql
update notifications
set callback_consumed_at = $6
where callback_token_hash = $1
  and callback_consumed_at is null
  and callback_expires_at > $6
  and callback_expert_id = $2
  and callback_action = $3
  and callback_version = $4
  and callback_version > 0
returning callback_claims;
```

Never put client PII, reservation ID, expert ID, appointment notes, meeting URLs, or provider tokens in callback data.

`TelegramAdapter` follows the official Bot API request contract: `POST https://api.telegram.org/bot{token}/sendMessage` with JSON body. It accepts an injected HTTPS transport, implements only `sendReservationRequest` and `sendSchedule`, and maps 429 plus `retry_after`, invalid schema, pre-send failure, post-send timeout, and permanent recipient failure to typed outcomes. Because the token is in the URL path, request logging is disabled at the transport and every error/trace passes only `redactTelegramUrl`; raw URLs are never attached. `/schedule` obtains its view from the application service after expert authorization; the adapter cannot query PostgreSQL itself.

Capture sanitized fixtures for send success, duplicate `update_id`, expired callback, deactivated expert, 429, post-send timeout, and invalid schema. Tests assert duplicate updates enter the inbox once, deactivated/expired callbacks do not mutate or consume, 429 is retryable with bounded delay, and post-send timeout is `unknown_outcome`. Contract tests use placeholder tokens and an injected fake transport; runtime keeps `TELEGRAM_ENABLED=false` and does not construct the HTTPS adapter while no project-owned bot session exists.

- [ ] **Step 4: Run the contract and security-focused tests**

Run: `pnpm exec vitest run tests/contract/telegram-port.test.ts && pnpm typecheck`

Expected: PASS; unauthorized, stale, expired, and tampered callbacks fail closed.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/telegram packages/integrations/src/index.ts packages/db/src/repositories/telegram-callback-repository.ts packages/db/src/index.ts tests/contract/telegram-port.test.ts tests/fixtures/telegram
git commit -m "feat: secure telegram expert callbacks"
```

---

### Task 12: Define Planerka availability and booking ports with stale-data controls

**Files:**

- Create: `packages/integrations/src/planerka/planerka-port.ts`
- Create: `packages/integrations/src/planerka/disabled-planerka-adapter.ts`
- Modify: `packages/integrations/src/index.ts`
- Test: `tests/contract/planerka-port.test.ts`
- Create: `tests/fixtures/planerka/booking-created.json`
- Create: `tests/fixtures/planerka/booking-duplicate.json`
- Create: `tests/fixtures/planerka/webhook-auth-unconfirmed.json`
- Create: `tests/fixtures/planerka/rate-limit-429.json`
- Create: `tests/fixtures/planerka/timeout-before-send.json`
- Create: `tests/fixtures/planerka/timeout-after-send.json`
- Create: `tests/fixtures/planerka/invalid-schema.json`
- Modify: `docs/contracts/provider-activation.md`

**Interfaces:**

```ts
export interface ProviderSlot {
  externalSlotId: string;
  expertExternalId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  observedAt: string;
}
export interface PlanerkaPort {
  listSlots(window: { from: string; to: string }): Promise<readonly ProviderSlot[]>;
  reserve(command: { idempotencyKey: string; externalSlotId: string; externalReservationId: string }): Promise<PlanerkaMutationOutcome>;
  confirm(command: { idempotencyKey: string; externalReservationId: string }): Promise<PlanerkaMutationOutcome>;
  cancel(command: { idempotencyKey: string; externalReservationId: string }): Promise<PlanerkaMutationOutcome>;
  getReservation(externalReservationId: string): Promise<"reserved" | "booked" | "cancelled" | "missing">;
}
export type PlanerkaMutationOutcome =
  | { kind: "applied"; providerOperationId: string }
  | { kind: "not_applied"; retryable: boolean; reasonCode: string }
  | { kind: "unknown_outcome"; reconciliationKey: string; reasonCode: string };
export function normalizeProviderSlots(slots: readonly ProviderSlot[], now: Date, maxAgeMs: number): readonly ProviderSlot[];
```

- [ ] **Step 1: Write failing normalization and disabled-binding tests**

```ts
// tests/contract/planerka-port.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DisabledPlanerkaAdapter, normalizeProviderSlots } from "../../packages/integrations/src/index.js";

describe("Planerka boundary", () => {
  it("filters stale, malformed, and sub-24-hour slots and sorts stable UTC output", () => {
    const now = new Date("2026-07-28T10:00:00.000Z");
    const slots = normalizeProviderSlots([
      {
        externalSlotId: "valid",
        expertExternalId: "expert-1",
        startsAt: "2026-07-30T10:00:00.000Z",
        endsAt: "2026-07-30T11:00:00.000Z",
        capacity: 1,
        observedAt: "2026-07-28T09:59:30.000Z",
      },
      {
        externalSlotId: "stale",
        expertExternalId: "expert-1",
        startsAt: "2026-07-30T12:00:00.000Z",
        endsAt: "2026-07-30T13:00:00.000Z",
        capacity: 1,
        observedAt: "2026-07-28T09:00:00.000Z",
      },
    ], now, 60_000);
    expect(slots.map((slot) => slot.externalSlotId)).toEqual(["valid"]);
  });

  it("cannot make provider bookings before contract approval", async () => {
    const adapter = new DisabledPlanerkaAdapter();
    await expect(adapter.reserve({
      idempotencyKey: "reserve-1",
      externalSlotId: "slot-1",
      externalReservationId: "reservation-1",
    })).rejects.toThrow("Planerka integration is disabled");
  });

  it.each([
    ["booking-created", "applied"],
    ["booking-duplicate", "duplicate"],
    ["webhook-auth-unconfirmed", "disabled"],
    ["rate-limit-429", "retryable"],
    ["timeout-before-send", "not_applied"],
    ["timeout-after-send", "unknown_outcome"],
    ["invalid-schema", "invalid_schema"],
  ])("parses sanitized Planerka fixture %s", (name, expectedOutcome) => {
    const value = JSON.parse(
      readFileSync(`tests/fixtures/planerka/${name}.json`, "utf8"),
    ) as { sanitized: boolean; expectedOutcome: string };
    expect(value).toMatchObject({ sanitized: true, expectedOutcome });
  });
});
```

- [ ] **Step 2: Run the contract test and confirm the expected failure**

Run: `pnpm exec vitest run tests/contract/planerka-port.test.ts`

Expected: FAIL because the Planerka port, normalizer, and disabled adapter do not exist.

- [ ] **Step 3: Implement canonical validation and the disabled live adapter**

Use strict Zod parsing for UTC timestamps, positive capacity, end after start, unique external slot IDs, and bounded string fields. `normalizeProviderSlots` excludes observations older than `maxAgeMs`, slots starting before `now + 24h`, malformed intervals, and duplicates; it sorts by `startsAt` then `externalSlotId`. Capture sanitized success, duplicate, unauthenticated-contract, 429, before-send timeout, after-send timeout, and invalid-schema fixtures with source, capture date, and expected typed outcome. After-send timeout is always `unknown_outcome`; reconciliation calls `getReservation` before any retry.

Every method on `DisabledPlanerkaAdapter` throws `Planerka integration is disabled`. Update the Planerka row in `provider-activation.md` with `NO-GO` and the same evidence fields as Selarti plus authenticated REST paths/auth schema, webhook authentication/freshness, reserve/confirm/cancel idempotency semantics, 429 behavior, timeout ambiguity, and authoritative reconciliation endpoint. A live codec or HTTP adapter is not added by this task.

- [ ] **Step 4: Run contract tests and type checking**

Run: `pnpm exec vitest run tests/contract/planerka-port.test.ts && pnpm typecheck`

Expected: PASS; stale availability is excluded and provider mutation cannot occur.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/planerka packages/integrations/src/index.ts tests/contract/planerka-port.test.ts tests/fixtures/planerka docs/contracts/provider-activation.md
git commit -m "feat: define disabled planerka boundary"
```

---

### Task 13: Add a payment port whose only binding is disabled

**Files:**

- Create: `packages/integrations/src/payment/payment-port.ts`
- Create: `packages/integrations/src/payment/disabled-payment-adapter.ts`
- Create: `packages/integrations/src/payment/disabled-payment-adapter.test.ts`
- Modify: `packages/integrations/src/index.ts`
- Test: `tests/repo/scope-boundary.test.ts`
- Modify: `docs/contracts/provider-activation.md`

**Interfaces:**

```ts
export interface PaymentPort {
  createCheckout(command: CreateCheckoutCommand): Promise<never>;
  acceptWebhook(command: PaymentWebhookCommand): Promise<never>;
  refund(command: RefundCommand): Promise<never>;
}
export class PaymentsDisabledError extends Error {
  readonly code = "PAYMENTS_DISABLED";
}
```

- [ ] **Step 1: Write failing disabled-payment and scope-boundary tests**

```ts
// packages/integrations/src/payment/disabled-payment-adapter.test.ts
import { describe, expect, it } from "vitest";
import { DisabledPaymentAdapter } from "./disabled-payment-adapter.js";

describe("disabled payment adapter", () => {
  it("rejects checkout, webhook, and refund commands without side effects", async () => {
    const adapter = new DisabledPaymentAdapter();
    await expect(adapter.createCheckout({ userId: "u-1", packageCode: "p-1", idempotencyKey: "c-1" }))
      .rejects.toMatchObject({ code: "PAYMENTS_DISABLED" });
    await expect(adapter.acceptWebhook({ rawBody: new Uint8Array(), headers: {} }))
      .rejects.toMatchObject({ code: "PAYMENTS_DISABLED" });
    await expect(adapter.refund({ externalPaymentId: "pay-1", idempotencyKey: "r-1" }))
      .rejects.toMatchObject({ code: "PAYMENTS_DISABLED" });
  });
});
```

```ts
// tests/repo/scope-boundary.test.ts
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MVP scope boundary", () => {
  it("contains no live or deferred commercial and scheduling modules", () => {
    const forbidden = [
      "packages/integrations/src/payment/live-payment-adapter.ts",
      "packages/domain/src/coupon.ts",
      "packages/domain/src/referral.ts",
      "packages/domain/src/reschedule.ts",
      "packages/domain/src/waitlist.ts",
    ];
    expect(forbidden.filter(existsSync)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `pnpm exec vitest run packages/integrations/src/payment/disabled-payment-adapter.test.ts tests/repo/scope-boundary.test.ts`

Expected: FAIL because the disabled payment port does not exist.

- [ ] **Step 3: Implement an unconditional disabled binding**

```ts
// packages/integrations/src/payment/disabled-payment-adapter.ts
import type { CreateCheckoutCommand, PaymentPort, PaymentWebhookCommand, RefundCommand } from "./payment-port.js";

export class PaymentsDisabledError extends Error {
  readonly code = "PAYMENTS_DISABLED";
  constructor() {
    super("Live payments are disabled until a provider and commercial policy are approved");
  }
}

export class DisabledPaymentAdapter implements PaymentPort {
  async createCheckout(_command: CreateCheckoutCommand): Promise<never> {
    throw new PaymentsDisabledError();
  }
  async acceptWebhook(_command: PaymentWebhookCommand): Promise<never> {
    throw new PaymentsDisabledError();
  }
  async refund(_command: RefundCommand): Promise<never> {
    throw new PaymentsDisabledError();
  }
}
```

Do not register payment routes, payment tables, payment event consumers, or entitlement grants from payment-shaped input. In `provider-activation.md`, record payment status as `NO-GO` and enumerate the blocking decisions from normalized requirements and the threat model: provider, prices, package composition, refund, chargeback, no-show, receipt/fiscal, legal basis, webhook contract, reconciliation, and dual-control approval.

- [ ] **Step 4: Run the tests and type checking**

Run: `pnpm exec vitest run packages/integrations/src/payment/disabled-payment-adapter.test.ts tests/repo/scope-boundary.test.ts && pnpm typecheck`

Expected: PASS; live payment execution and deferred MVP modules are absent.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/payment packages/integrations/src/index.ts tests/repo/scope-boundary.test.ts docs/contracts/provider-activation.md
git commit -m "feat: keep payment capability disabled"
```

---

### Task 14: Orchestrate safety-first conversations and exact message charging

**Files:**

- Create: `packages/application/src/ports.ts`
- Create: `packages/application/src/conversation-service.ts`
- Create: `packages/application/src/conversation-service.testkit.ts`
- Create: `packages/application/src/conversation-service.test.ts`
- Create: `packages/application/src/prompt-safety.test.ts`
- Modify: `packages/application/src/index.ts`
- Create: `tests/fixtures/prompts/llm-01-instruction-override.json`
- Create: `tests/fixtures/prompts/llm-02-arbitrary-url.json`
- Create: `tests/fixtures/prompts/llm-03-unauthorized-tool.json`
- Create: `tests/fixtures/prompts/llm-04-safety-bypass.json`

**Interfaces:**

```ts
export interface IntentEngine {
  propose(input: IntentInput): Promise<IntentProposal>;
}
export type IntentProposal =
  | { kind: "answer"; text: string }
  | { kind: "show_catalog"; serviceCode?: string }
  | { kind: "start_booking"; expertId: string }
  | { kind: "human_handoff"; reasonCode: string };
export interface ConversationService {
  handleInbound(command: HandleInboundCommand): Promise<ConversationResult>;
  handleOutboundDelivery(event: CanonicalOutboundDelivery): Promise<OutboundDeliveryResult>;
}
export function conversationFixture(input: {
  balance: number;
  safety: "ordinary" | "crisis";
  outboundBillingMode?: "disabled" | "provider_delivery_event";
}): ConversationFixture;
```

- [ ] **Step 1: Write failing workflow tests for safety, duplicates, zero balance, and ordinary dialogue**

```ts
// packages/application/src/conversation-service.test.ts
import { describe, expect, it, vi } from "vitest";
import { createConversationService } from "./conversation-service.js";
import { conversationFixture } from "./conversation-service.testkit.js";

describe("conversation workflow", () => {
  it("runs safety before billing and sends a free handoff at zero balance", async () => {
    const deps = conversationFixture({ balance: 0, safety: "crisis" });
    const result = await createConversationService(deps).handleInbound(deps.inbound);
    expect(deps.calls).toEqual([
      "deterministic-safety",
      "safety-persist",
      "free-outbound",
    ]);
    expect(result).toMatchObject({ kind: "human_handoff", chargedMessages: 0 });
    expect(deps.intentEngine.propose).not.toHaveBeenCalled();
    expect(deps.handoffs.current()).toMatchObject({
      status: "opened",
      acknowledgeBy: expect.any(Date),
      ownerId: expect.any(String),
    });
  });

  it("charges accepted inbound once and does not debit send acceptance while outbound billing is disabled", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });
    deps.intentEngine.propose = vi.fn().mockResolvedValue({ kind: "answer", text: "Короткий ответ" });
    const first = await createConversationService(deps).handleInbound(deps.inbound);
    const retry = await createConversationService(deps).handleInbound(deps.inbound);
    expect(first).toMatchObject({ kind: "answer_queued", chargedMessages: 1 });
    expect(retry).toMatchObject({ kind: "duplicate", chargedMessages: 0 });
    expect(deps.messageRepository.ledgerDeltas()).toEqual([-1]);
    expect(deps.outbox.topics()).toEqual(["selarti.send"]);
  });

  it("meters a separate stable delivery inbox event once only when contract-gated policy is enabled", async () => {
    const deps = conversationFixture({
      balance: 3,
      safety: "ordinary",
      outboundBillingMode: "provider_delivery_event",
    });
    const service = createConversationService(deps);
    const event = {
      kind: "outbound_delivery" as const,
      provider: "selarti" as const,
      providerEventId: "delivery-event-1",
      providerMessageId: "provider-message-1",
      occurredAt: "2026-07-28T10:01:00.000Z",
      status: "delivered" as const,
    };
    await service.handleOutboundDelivery(event);
    await service.handleOutboundDelivery(event);
    expect(deps.messageRepository.ledgerDeltas()).toEqual([-1]);
    expect(deps.messageRepository.deliveryInboxCount()).toBe(1);
  });

  it("sends one free no-package notice and never invokes the intent engine", async () => {
    const deps = conversationFixture({ balance: 0, safety: "ordinary" });
    const result = await createConversationService(deps).handleInbound(deps.inbound);
    expect(result).toMatchObject({ kind: "no_package", chargedMessages: 0 });
    expect(deps.intentEngine.propose).not.toHaveBeenCalled();
    expect(deps.outbox.topics()).toEqual(["client.no_package"]);
  });
});
```

```ts
// packages/application/src/prompt-safety.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateIntentProposal } from "./conversation-service.js";

describe("LLM capability boundary", () => {
  it.each([
    ["llm-01-instruction-override", "instruction_override"],
    ["llm-02-arbitrary-url", "arbitrary_url"],
    ["llm-03-unauthorized-tool", "unauthorized_capability"],
    ["llm-04-safety-bypass", "safety_bypass"],
  ])("%s is rejected with %s", (fixtureName, reasonCode) => {
    const fixture = JSON.parse(
      readFileSync(`tests/fixtures/prompts/${fixtureName}.json`, "utf8"),
    ) as { modelOutput: unknown };
    expect(validateIntentProposal(fixture.modelOutput)).toEqual({
      accepted: false,
      reasonCode,
    });
  });
});
```

- [ ] **Step 2: Run the workflow test and confirm the expected failure**

Run: `pnpm exec vitest run packages/application/src/conversation-service.test.ts packages/application/src/prompt-safety.test.ts`

Expected: FAIL because the application ports and conversation service do not exist.

- [ ] **Step 3: Implement the workflow in strict decision order**

`handleInbound` performs these calls in order:

1. Validate canonical input, maximum text length, locale, correlation ID, and stable provider keys.
2. Run the deterministic high-risk guard. Only when it returns no risk may the typed classifier run.
3. For a handoff, atomically accept the inbound event as class `safety`, append safety incident, owned human-escalation with acknowledgement SLA, and audit facts, enqueue one free handoff notification, and return. The worker in Task 19 escalates overdue acknowledgements independently of LLM/provider circuits.
4. For ordinary content, call `acceptInbound`; return immediately for a duplicate.
5. If no package was selected, enqueue `client.no_package` with an idempotency key derived from message-event ID and return without calling the LLM.
6. Ask `IntentEngine` for a strict discriminated union; reject unknown keys, arbitrary URLs, tool names, SQL-like commands, and provider credentials.
7. For an answer, enqueue `selarti.send` and return `answer_queued`; send acceptance is not delivery and never debits outbound.
8. Route catalog, booking, and handoff proposals to typed application commands; the intent engine receives no repository or transport object.

`handleOutboundDelivery` is a separate inbox transaction keyed by `providerEventId`. With current `SELARTI_OUTBOUND_BILLING_MODE=disabled`, it records delivery telemetry and returns `billing_disabled` without a debit. The `provider_delivery_event` branch is unreachable from current runtime configuration and may be activated only after Task 10 contract evidence proves a stable event; then it calls `recordOutboundDelivery` once for status `delivered`. Duplicate, accepted, queued, sent, failed, or ambiguous statuses never debit.

The service constructor accepts only ports from `ports.ts`; no infrastructure import is allowed in `packages/application`. `validateIntentProposal` parses a strict discriminated union, rejects extra keys, arbitrary URLs, provider/tool names, SQL-like text, instruction-override markers, safety bypasses, and commands outside the authenticated user’s scope. The four sanitized prompt fixtures assert LLM-01 through LLM-04 without a model session. `conversation-service.testkit.ts` supplies in-memory implementations of every port, records ordered calls, ledger deltas, delivery inbox keys, handoff lifecycle, and outbox topics. Runtime keeps `INTENT_MODEL_ENABLED=false`.

- [ ] **Step 4: Run unit, domain, and type checks**

Run: `pnpm exec vitest run packages/application/src/conversation-service.test.ts packages/application/src/prompt-safety.test.ts packages/domain/src && pnpm typecheck`

Expected: PASS; workflow order and all free/charged cases are exact.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/ports.ts packages/application/src/conversation-service.ts packages/application/src/conversation-service.testkit.ts packages/application/src/conversation-service.test.ts packages/application/src/prompt-safety.test.ts packages/application/src/index.ts tests/fixtures/prompts
git commit -m "feat: orchestrate safety first conversations"
```

---

### Task 15: Orchestrate reserve, confirm, cancel, expiry, and expert schedule workflows

**Files:**

- Create: `packages/application/src/booking-service.ts`
- Create: `packages/application/src/booking-service.testkit.ts`
- Create: `packages/application/src/booking-service.test.ts`
- Create: `packages/application/src/catalog-service.ts`
- Create: `packages/application/src/catalog-service.test.ts`
- Create: `packages/db/src/repositories/catalog-repository.ts`
- Test: `tests/integration/catalog-repository.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**

```ts
export interface BookingService {
  searchSlots(command: SearchSlotsCommand): Promise<readonly SlotView[]>;
  reserve(command: ReserveCommand): Promise<ReserveResult>;
  confirmByExpert(command: ExpertDecisionCommand): Promise<BookingResult>;
  cancelByExpert(command: ExpertDecisionCommand): Promise<BookingResult>;
  cancelByClient(command: ClientCancelCommand): Promise<BookingResult>;
  getExpertSchedule(command: ExpertScheduleCommand): Promise<ExpertScheduleView>;
}
export interface CatalogService {
  search(command: {
    serviceCode?: string;
    language?: string;
    from: Date;
    to: Date;
    now: Date;
  }): Promise<readonly CatalogExpertView[]>;
}
export interface CatalogRepository {
  findEligible(input: CatalogEligibilityQuery): Promise<readonly CatalogExpertRecord[]>;
}
export function bookingFixture(initial?: { status: ReservationStatus; version: number }): BookingFixture;
```

- [ ] **Step 1: Write failing booking-workflow tests**

```ts
// packages/application/src/booking-service.test.ts
import { describe, expect, it } from "vitest";
import { createBookingService } from "./booking-service.js";
import { bookingFixture } from "./booking-service.testkit.js";

describe("booking workflows", () => {
  it("reserves locally first and emits one free expert request plus audit", async () => {
    const deps = bookingFixture();
    const result = await createBookingService(deps).reserve(deps.reserveCommand);
    expect(result).toMatchObject({ kind: "reserved", version: 1 });
    expect(deps.outbox.topics()).toEqual(["planerka.reserve", "telegram.reservation_request"]);
    expect(deps.outbox.allFree()).toBe(true);
    expect(deps.audit.actions()).toEqual(["reservation.created"]);
  });

  it("confirms the expected version once and emits one free client notification", async () => {
    const deps = bookingFixture({ status: "reserved", version: 1 });
    const first = await createBookingService(deps).confirmByExpert({
      reservationId: deps.reservationId,
      expertId: deps.expertId,
      expectedVersion: 1,
      correlationId: "confirm-1",
    });
    expect(first).toMatchObject({ status: "booked", version: 2 });
    await expect(createBookingService(deps).confirmByExpert({
      reservationId: deps.reservationId,
      expertId: deps.expertId,
      expectedVersion: 1,
      correlationId: "confirm-2",
    })).rejects.toThrow("Stale reservation version");
    expect(deps.outbox.topics()).toEqual(["planerka.confirm", "client.booking_confirmed"]);
  });

  it("limits expert schedule output to owned appointments and consented notes", async () => {
    const deps = bookingFixture();
    const view = await createBookingService(deps).getExpertSchedule({
      expertId: deps.expertId,
      telegramUserId: deps.telegramUserId,
      from: "2026-07-28T00:00:00.000Z",
      to: "2026-08-04T00:00:00.000Z",
    });
    expect(view.appointments[0]).not.toHaveProperty("rawConversation");
    expect(view.appointments[0]).not.toHaveProperty("unconsentedProfile");
  });
});
```

```ts
// packages/application/src/catalog-service.test.ts
import { describe, expect, it, vi } from "vitest";
import { createCatalogService } from "./catalog-service.js";

describe("verified catalog", () => {
  it("returns only active verified experts with active matching services and eligible future slots", async () => {
    const repository = {
      findEligible: vi.fn().mockResolvedValue([
        {
          expertId: "expert-eligible",
          expertActive: true,
          expertVerified: true,
          serviceCode: "consultation",
          serviceActive: true,
          slotStartsAt: new Date("2026-07-30T10:00:00.000Z"),
        },
      ]),
    };
    const result = await createCatalogService({ repository }).search({
      serviceCode: "consultation",
      language: "ru",
      from: new Date("2026-07-30T00:00:00.000Z"),
      to: new Date("2026-08-06T00:00:00.000Z"),
      now: new Date("2026-07-28T10:00:00.000Z"),
    });
    expect(result.map((expert) => expert.expertId)).toEqual(["expert-eligible"]);
    expect(repository.findEligible).toHaveBeenCalledWith(expect.objectContaining({
      requireExpertActive: true,
      requireExpertVerified: true,
      requireServiceActive: true,
      minimumLeadMs: 86_400_000,
    }));
  });
});
```

- [ ] **Step 2: Run the workflow test and confirm the expected failure**

Run: `pnpm exec vitest run packages/application/src/booking-service.test.ts packages/application/src/catalog-service.test.ts tests/integration/catalog-repository.test.ts`

Expected: FAIL because booking/catalog services and the catalog repository do not exist.

- [ ] **Step 3: Implement booking application transactions and free notifications**

Use the database repository as the sole transition owner. `searchSlots` reads only non-stale normalized slots starting at least 24 hours ahead. `reserve` writes the local reservation plus Planerka and Telegram outbox facts atomically. Confirm/cancel commands verify expert ownership and expected version before transition. Client cancellation verifies reservation ownership. Every user or expert notification has `charge = 0` and an idempotency key `{reservationId}:{newVersion}:{topic}`.

`getExpertSchedule` authorizes numeric Telegram identity through the expert binding, queries only that expert’s range, converts UTC using the requested configured timezone, and uses `buildExpertView` for each appointment. Meeting URLs are returned only for booked appointments to the owning expert. `booking-service.testkit.ts` implements the repository, audit, and outbox ports in memory with a single seeded expert/slot/client; it records topics, charge flags, actions, and transitions used by the assertions.

`PostgresCatalogRepository.findEligible` joins experts, services, and slots with mandatory `experts.active`, `experts.verified`, `expert_services.active`, service/language filters, fresh provider observation, positive remaining capacity, and `starts_at >= now + 24h`. `CatalogService` maps only allowlisted public fields and performs deterministic filter/rank; an LLM may explain returned choices but cannot add an expert or slot absent from this result. The integration test seeds active/unverified, inactive/verified, inactive-service, stale-slot, sub-24-hour, full, and eligible rows and asserts only the eligible row is returned.

- [ ] **Step 4: Run booking unit and concurrency suites**

Run: `pnpm exec vitest run packages/application/src/booking-service.test.ts packages/application/src/catalog-service.test.ts tests/integration/catalog-repository.test.ts tests/integration/booking-concurrency.test.ts && pnpm typecheck`

Expected: PASS; all transitions, ownership checks, and notification counts are deterministic.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/booking-service.ts packages/application/src/booking-service.testkit.ts packages/application/src/booking-service.test.ts packages/application/src/catalog-service.ts packages/application/src/catalog-service.test.ts packages/application/src/index.ts packages/db/src/repositories/catalog-repository.ts tests/integration/catalog-repository.test.ts
git commit -m "feat: orchestrate booking workflows"
```

---

### Task 16: Implement consent withdrawal, subject export, erasure, and retention

**Files:**

- Create: `packages/db/src/repositories/privacy-repository.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/application/src/privacy-service.ts`
- Create: `packages/application/src/privacy-service.test.ts`
- Modify: `packages/application/src/index.ts`
- Create: `packages/worker/src/data-retention.ts`
- Create: `packages/worker/src/data-retention.test.ts`
- Create: `packages/worker/src/privacy-erasure.ts`
- Create: `packages/worker/src/privacy-erasure.test.ts`
- Create: `packages/worker/src/privacy-erasure.testkit.ts`
- Test: `tests/integration/privacy-workflow.test.ts`
- Modify: `packages/worker/src/index.ts`

**Interfaces:**

```ts
export interface PrivacyService {
  withdrawConsent(command: WithdrawConsentCommand): Promise<void>;
  exportSubject(command: ExportSubjectCommand): Promise<SubjectExport>;
  eraseSubject(command: EraseSubjectCommand): Promise<ErasureJob>;
}
export interface PrivacyRepository {
  withdrawConsentAtomically(command: WithdrawConsentCommand): Promise<WithdrawalReceipt>;
  exportOwnedSubject(userId: string): Promise<SubjectExport>;
  startErasureAtomically(command: StartErasureCommand): Promise<ErasureJob>;
}
export function runRetentionBatch(deps: RetentionDeps, now: Date, batchSize: number): Promise<RetentionReport>;
export interface PrivacyProcessor {
  name: "object_store" | "selarti" | "planerka" | "make_projection";
  erase(command: ProcessorErasureCommand): Promise<ProcessorErasureOutcome>;
  reconcile(command: ProcessorReconcileCommand): Promise<"erased" | "not_erased" | "unknown">;
}
export function runErasureWorkflow(deps: ErasureDeps, jobId: string): Promise<ErasureWorkflowResult>;
export function erasureFixture(input: {
  processors: readonly PrivacyProcessor["name"][];
  crashAfter?: PrivacyProcessor["name"];
}): ErasureFixture;
```

- [ ] **Step 1: Write failing privacy lifecycle and retention tests**

```ts
// packages/application/src/privacy-service.test.ts
import { describe, expect, it, vi } from "vitest";
import { createPrivacyService } from "./privacy-service.js";

describe("privacy lifecycle", () => {
  it("appends withdrawal, removes optional profile fields, and cancels follow-ups", async () => {
    const repository = {
      withdrawConsentAtomically: vi.fn().mockResolvedValue({
        consentDecisionId: "consent-deny-1",
        optionalFieldsRemoved: 3,
        followUpsCancelled: 1,
      }),
      exportOwnedSubject: vi.fn(),
      startErasureAtomically: vi.fn(),
    };
    const audit = { append: vi.fn() };
    const service = createPrivacyService({ repository, audit, pseudonymize: () => "subject-deleted-01" });
    await service.withdrawConsent({
      principalUserId: "u-1",
      targetUserId: "u-1",
      purpose: "client_profile",
      policyVersion: "privacy-v1",
      correlationId: "privacy-1",
    });
    expect(repository.withdrawConsentAtomically).toHaveBeenCalledOnce();
    expect(repository.withdrawConsentAtomically).toHaveBeenCalledWith(expect.objectContaining({
      targetUserId: "u-1",
      purpose: "client_profile",
    }));
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: "privacy.consent_withdrawn" }));
  });

  it("denies cross-subject export and preserves non-identifying ledger and audit facts during erasure", async () => {
    const repository = {
      withdrawConsentAtomically: vi.fn(),
      exportOwnedSubject: vi.fn(),
      startErasureAtomically: vi.fn().mockResolvedValue({
        jobId: "erase-job-1",
        status: "pending",
        contentRefsDeleted: 4,
        profileFieldsDeleted: 3,
        ledgerFactsPreserved: 2,
        auditFactsPreserved: 5,
      }),
    };
    const service = createPrivacyService({
      repository,
      audit: { append: vi.fn() },
      pseudonymize: () => "subject-deleted-02",
    });
    await expect(service.exportSubject({
      principalUserId: "u-1",
      targetUserId: "u-2",
      correlationId: "privacy-2",
    })).rejects.toThrow("Cross-subject privacy access denied");
    await expect(service.eraseSubject({
      principalUserId: "u-1",
      targetUserId: "u-1",
      correlationId: "privacy-3",
    })).resolves.toMatchObject({ jobId: "erase-job-1", status: "pending" });
  });
});
```

```ts
// packages/worker/src/data-retention.test.ts
import { describe, expect, it, vi } from "vitest";
import { runRetentionBatch } from "./data-retention.js";

describe("data retention", () => {
  it("deletes expired content references but not ledger, consent, safety, or audit facts", async () => {
    const repository = {
      claimExpiredContent: vi.fn().mockResolvedValue([
        { id: "content-1", class: "conversation_content" },
        { id: "payload-1", class: "provider_payload" },
      ]),
      deleteContent: vi.fn(),
    };
    const result = await runRetentionBatch(
      {
        repository,
        allowedClasses: new Set(["conversation_content", "provider_payload"]),
        audit: { append: vi.fn() },
      },
      new Date("2026-07-28T10:00:00.000Z"),
      100,
    );
    expect(result).toEqual({ examined: 2, deleted: 2, failed: 0 });
    expect(repository.deleteContent).toHaveBeenCalledTimes(2);
  });

  it("rejects every immutable or unapproved retention class", async () => {
    const repository = {
      claimExpiredContent: vi.fn().mockResolvedValue([
        { id: "ledger-1", class: "message_ledger" },
      ]),
      deleteContent: vi.fn(),
    };
    await expect(runRetentionBatch({
      repository,
      allowedClasses: new Set(["conversation_content", "provider_payload"]),
      audit: { append: vi.fn() },
    }, new Date("2026-07-28T10:00:00.000Z"), 100)).rejects.toThrow(
      "Retention class message_ledger is forbidden",
    );
    expect(repository.deleteContent).not.toHaveBeenCalled();
  });
});
```

```ts
// packages/worker/src/privacy-erasure.test.ts
import { describe, expect, it } from "vitest";
import { erasureFixture } from "./privacy-erasure.testkit.js";
import { runErasureWorkflow } from "./privacy-erasure.js";

describe("processor-wide erasure", () => {
  it("resumes after a crash without repeating an acknowledged processor deletion", async () => {
    const deps = erasureFixture({
      processors: ["object_store", "selarti", "planerka", "make_projection"],
      crashAfter: "selarti",
    });
    await expect(runErasureWorkflow(deps, "erase-job-1")).rejects.toThrow("simulated crash");
    await runErasureWorkflow(deps, "erase-job-1");
    expect(deps.processorCalls("object_store")).toBe(1);
    expect(deps.processorCalls("selarti")).toBe(1);
    expect(deps.processorCalls("planerka")).toBe(1);
    expect(deps.processorCalls("make_projection")).toBe(1);
    expect(deps.job()).toMatchObject({ status: "processor_complete" });
  });

  it("records backup expiry evidence instead of claiming immediate backup deletion", async () => {
    const deps = erasureFixture({ processors: [] });
    await runErasureWorkflow(deps, "erase-job-2");
    expect(deps.job().backupEvidence).toEqual({
      policyVersion: "backup-retention-v1",
      expiresNoLaterThan: "2026-08-27T10:00:00.000Z",
      verificationState: "scheduled",
    });
  });
});
```

- [ ] **Step 2: Run the privacy tests and confirm the expected failure**

Run: `pnpm exec vitest run packages/application/src/privacy-service.test.ts packages/worker/src/data-retention.test.ts packages/worker/src/privacy-erasure.test.ts tests/integration/privacy-workflow.test.ts`

Expected: FAIL because the transactional privacy repository, processor workflow, and retention worker do not exist.

- [ ] **Step 3: Implement owner-scoped privacy operations and class-based retention**

`PrivacyService` compares the authenticated principal with the target before every read or mutation. `withdrawConsentAtomically` is one serializable repository command that appends `granted = false`, removes purpose-governed fields, cancels optional follow-ups, appends audit, and enqueues processor projection changes before commit. No application loop calls separate mutation methods. Subject export returns only the authenticated subject’s identity, consent history, optional profile, reservations, feedback, and message-accounting summary; it excludes other users, provider credentials, internal prompt text, and expert-private data.

`startErasureAtomically` clears local optional/contact fields, replaces subject linkage in retained ledger/audit facts with an irreversible per-environment HMAC pseudonym, creates one idempotent `privacy_deletion_jobs` row plus per-processor attempts, and appends audit in one serializable transaction. It does not claim external deletion complete.

`runErasureWorkflow` processes object store, Selarti, Planerka, and Make projection through idempotent processor commands keyed by `{jobId}:{processor}`. It persists `started` before dispatch, handles `unknown_outcome` with reconcile-before-retry, stores provider receipt hash, and resumes after crashes from the last acknowledged processor. When processors complete, it records backup policy version and maximum expiry; a scheduled verification job changes backup evidence to verified only after backup generations expire. Local facts preserving financial, consent, safety, reservation, and security evidence remain pseudonymous and internally consistent.

`runRetentionBatch` accepts only `conversation_content` and `provider_payload` from the approved policy, claims expired content references with `FOR UPDATE SKIP LOCKED`, uses the same started/unknown/reconcile discipline, records per-class counts, and dead-letters permanent failures. Any ledger, consent, safety, reservation, approval, or audit class aborts the batch and alerts. `tests/integration/privacy-workflow.test.ts` executes PRIV-01 through PRIV-05 against PostgreSQL, including cross-subject denial, atomic rollback after injected failure, processor crash recovery, forbidden-class rejection, pseudonymous conservation, and backup-expiry evidence.

- [ ] **Step 4: Run privacy, retention, integration, and type checks**

Run: `pnpm exec vitest run packages/application/src/privacy-service.test.ts packages/worker/src/data-retention.test.ts packages/worker/src/privacy-erasure.test.ts tests/integration/privacy-workflow.test.ts tests/integration/schema.test.ts && pnpm typecheck`

Expected: PASS; cross-subject access is denied, withdrawal takes effect, erasure preserves required facts, and retention is class-bounded.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories/privacy-repository.ts packages/db/src/index.ts packages/application/src/privacy-service.ts packages/application/src/privacy-service.test.ts packages/application/src/index.ts packages/worker/src/data-retention.ts packages/worker/src/data-retention.test.ts packages/worker/src/privacy-erasure.ts packages/worker/src/privacy-erasure.test.ts packages/worker/src/privacy-erasure.testkit.ts packages/worker/src/index.ts tests/integration/privacy-workflow.test.ts
git commit -m "feat: implement privacy lifecycle controls"
```

---

### Task 17: Add feedback escalation, scoped administration, and immutable audit

**Files:**

- Create: `packages/application/src/feedback-service.ts`
- Create: `packages/application/src/feedback-service.test.ts`
- Create: `packages/application/src/admin-service.ts`
- Create: `packages/application/src/admin-service.test.ts`
- Create: `packages/application/src/admin-service.testkit.ts`
- Create: `packages/db/src/repositories/admin-repository.ts`
- Test: `tests/integration/admin-ledger.test.ts`
- Create: `apps/api/src/routes/admin.ts`
- Create: `apps/api/src/routes/admin.test.ts`
- Create: `apps/api/src/routes/admin.testkit.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**

```ts
export interface SubmitFeedbackCommand {
  userId: string;
  reservationId?: string;
  score: 1 | 2 | 3 | 4 | 5;
  text?: string;
  sourceEventId: string;
  correlationId: string;
}
export interface AdminPrincipal {
  id: string;
  sessionIdHash: string;
  roles: readonly ("support" | "catalog_admin" | "entitlement_admin" | "security_admin")[];
  mfaVerifiedAt: Date;
}
export interface AdminService {
  createClient(principal: AdminPrincipal, command: ClientLifecycleCommand): Promise<void>;
  deactivateClient(principal: AdminPrincipal, command: ClientLifecycleCommand): Promise<void>;
  grantPackage(principal: AdminPrincipal, command: GrantPackageCommand): Promise<void>;
  revokePackage(principal: AdminPrincipal, command: RevokePackageCommand): Promise<void>;
  updateExpertVerification(principal: AdminPrincipal, command: ExpertVerificationCommand): Promise<void>;
  updateService(principal: AdminPrincipal, command: ServiceAdminCommand): Promise<void>;
  resolveIntegrationError(principal: AdminPrincipal, command: ResolveIntegrationErrorCommand): Promise<void>;
  resolveAlert(principal: AdminPrincipal, command: ResolveAlertCommand): Promise<void>;
}
export type AdminAction =
  | "client.create"
  | "client.deactivate"
  | "package.grant"
  | "package.revoke"
  | "expert.verify"
  | "expert.suspend"
  | "service.activate"
  | "service.deactivate"
  | "integration_error.resolve"
  | "safety.read"
  | "safety.resolve"
  | "feedback.read"
  | "feedback.resolve";
export interface AdminAuthorizationInput {
  principal: AdminPrincipal;
  action: AdminAction;
  routeObjectId: string;
  commandObjectId: string;
  approvalId?: string;
  now: Date;
  correlationId: string;
}
export interface AuditPort {
  append(fact: {
    actorType: "admin" | "system";
    actorId: string;
    sessionIdHash: string;
    action: string;
    objectType: string;
    objectId: string;
    decision: "allowed" | "denied";
    reasonCode: string;
    correlationId: string;
    occurredAt: Date;
    metadataHash: string;
  }): Promise<void>;
}
export interface AdminApprovalRepository {
  request(input: BoundApprovalRequest): Promise<{ approvalId: string }>;
  approve(input: AuthenticatedApproval): Promise<void>;
  consumeIfValid(input: ApprovalConsumption): Promise<BoundApproval | null>;
}
export function authorizeAdminAction(input: AdminAuthorizationInput, approvals: AdminApprovalRepository, audit: AuditPort): Promise<"allow" | "deny">;
export function adminFixture(input: { approval: "valid"; packageBalance?: number }): AdminFixture;
export function fakeApprovalRepository(input?: { case: "forged" | "stale" | "cross_object" | "same_actor" | "valid" }): FakeApprovalRepository;
```

- [ ] **Step 1: Write failing escalation and IAM tests**

```ts
// packages/application/src/feedback-service.test.ts
import { describe, expect, it, vi } from "vitest";
import { createFeedbackService } from "./feedback-service.js";

describe("feedback", () => {
  it.each([
    [1, "Нейтральный текст"],
    [2, "Нейтральный текст"],
    [3, "Нейтральный текст"],
    [4, "Это явно негативный опыт"],
  ] as const)("deduplicates and escalates score %s or explicit negative text for free", async (score, text) => {
    const feedback = {
      insertOnce: vi.fn()
        .mockResolvedValueOnce({ inserted: true, feedbackId: "f-1" })
        .mockResolvedValueOnce({ inserted: false, feedbackId: "f-1" }),
    };
    const outbox = { enqueue: vi.fn() };
    const service = createFeedbackService({ feedback, outbox, audit: { append: vi.fn() } });
    const command = {
      userId: "u-1",
      reservationId: "r-1",
      score,
      text,
      sourceEventId: `feedback-${score}`,
      correlationId: "corr-1",
    };
    await service.submit(command);
    await service.submit(command);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      topic: "admin.negative_feedback",
      charge: 0,
      idempotencyKey: "feedback:f-1:negative",
    }));
  });
});
```

```ts
// apps/api/src/routes/admin.test.ts
import { describe, expect, it, vi } from "vitest";
import { authorizeAdminAction } from "./admin.js";
import { fakeApprovalRepository } from "./admin.testkit.js";

describe("admin authorization", () => {
  it("requires recent MFA and object-scoped role for an entitlement grant", async () => {
    const audit = { append: vi.fn() };
    await expect(authorizeAdminAction({
      principal: {
        id: "admin-1",
        sessionIdHash: "session-hash-1",
        roles: ["support"],
        mfaVerifiedAt: new Date("2026-07-28T09:00:00.000Z"),
      },
      action: "package.grant",
      routeObjectId: "u-2",
      commandObjectId: "u-2",
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "admin-1",
    }, fakeApprovalRepository(), audit)).resolves.toBe("deny");
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "package.grant.denied",
      reasonCode: "role_or_mfa",
    }));
  });

  it.each([
    ["forged", "approval_not_found"],
    ["stale", "approval_expired"],
    ["cross_object", "approval_binding"],
    ["same_actor", "dual_control"],
  ])("rejects invalid server-resolved approval: %s", async (approvalCase, reasonCode) => {
    const audit = { append: vi.fn() };
    const approvals = fakeApprovalRepository({ case: approvalCase });
    await expect(authorizeAdminAction({
      principal: {
        id: "admin-1",
        sessionIdHash: "session-hash-1",
        roles: ["entitlement_admin"],
        mfaVerifiedAt: new Date("2026-07-28T09:55:00.000Z"),
      },
      action: "package.grant",
      routeObjectId: "u-2",
      commandObjectId: "u-2",
      approvalId: `approval-${approvalCase}`,
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "admin-2",
    }, approvals, audit)).resolves.toBe("deny");
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "admin-1",
      objectType: "user",
      objectId: "u-2",
      decision: "denied",
      reasonCode,
      occurredAt: new Date("2026-07-28T10:00:00.000Z"),
    }));
  });

  it("consumes one fresh distinct bound approval and records a complete allow audit", async () => {
    const audit = { append: vi.fn() };
    const approvals = fakeApprovalRepository({ case: "valid" });
    await expect(authorizeAdminAction({
      principal: {
        id: "admin-requester",
        sessionIdHash: "session-hash-valid",
        roles: ["entitlement_admin"],
        mfaVerifiedAt: new Date("2026-07-28T09:55:00.000Z"),
      },
      action: "package.grant",
      routeObjectId: "u-2",
      commandObjectId: "u-2",
      approvalId: "approval-valid",
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "admin-valid",
    }, approvals, audit)).resolves.toBe("allow");
    expect(approvals.consumeIfValid).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "admin-requester",
      action: "package.grant.allowed",
      objectId: "u-2",
      decision: "allowed",
    }));
  });
});
```

```ts
// packages/application/src/admin-service.test.ts
import { describe, expect, it } from "vitest";
import { createAdminService } from "./admin-service.js";
import { adminFixture } from "./admin-service.testkit.js";

describe("package administration", () => {
  it.each([500, 1000, 1500, 2000] as const)("grants allowed size %s for exactly 60 days", async (units) => {
    const deps = adminFixture({ approval: "valid" });
    await createAdminService(deps).grantPackage(deps.principal, {
      userId: "u-1",
      units,
      idempotencyKey: `grant-${units}`,
      approvalId: `approval-${units}`,
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: `corr-${units}`,
    });
    expect(deps.ledger.facts()).toContainEqual(expect.objectContaining({
      kind: "grant",
      delta: units,
      expiresAt: new Date("2026-09-26T10:00:00.000Z"),
    }));
  });

  it("rejects an unapproved size and revokes through one append-only ledger fact", async () => {
    const deps = adminFixture({ approval: "valid", packageBalance: 500 });
    await expect(createAdminService(deps).grantPackage(deps.principal, {
      userId: "u-1",
      units: 750,
      idempotencyKey: "grant-invalid",
      approvalId: "approval-invalid",
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "corr-invalid",
    })).rejects.toThrow("Package size is not allowed");
    await createAdminService(deps).revokePackage(deps.principal, {
      userId: "u-1",
      packageId: "package-1",
      idempotencyKey: "revoke-1",
      approvalId: "approval-revoke",
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "corr-revoke",
    });
    expect(deps.ledger.facts()).toContainEqual(expect.objectContaining({
      kind: "revocation",
      delta: -500,
    }));
  });
});
```

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `pnpm exec vitest run packages/application/src/feedback-service.test.ts packages/application/src/admin-service.test.ts apps/api/src/routes/admin.test.ts tests/integration/admin-ledger.test.ts`

Expected: FAIL because feedback/admin services, approval persistence, ledger administration, and routes do not exist.

- [ ] **Step 3: Implement deduplication, role checks, recent MFA, and audit**

Feedback insertion uses a unique source event ID. Scores `1`, `2`, or `3`, or text matched by the versioned explicit-negative policy, enqueue exactly one free `admin.negative_feedback`, append `feedback.escalated`, and return the same result on duplicate. Scores `4` and `5` with non-negative text create no escalation. Feedback text is length-bounded and redacted before logging.

Admin routes resolve principals from platform sessions, require MFA within 15 minutes, and never accept actor/approver IDs from a request body. High-risk commands first persist an approval request bound to action, object type/ID, canonical payload hash, requester principal/session, nonce, and five-minute expiry. A second authenticated principal with the required role approves it. Execution atomically consumes that exact approval once; forged IDs, same actor, stale approval, replay, payload change, action change, or object change deny.

| Action | Required role | Object rule |
|---|---|---|
| Grant/revoke admin package | `entitlement_admin` | user ID in route must equal command target |
| Verify/unverify expert | `catalog_admin` | expert ID in route must equal command target |
| Read safety case | `security_admin` | explicit case assignment |
| Read negative feedback | `support` | assigned queue |

`AdminService` implements every MVP-FR-015 operation with exact repository methods: create/deactivate client, verify/suspend expert, activate/deactivate service, grant/revoke package, resolve integration error, and acknowledge/resolve feedback or safety alert. Package grant accepts only `500 | 1000 | 1500 | 2000`, creates immutable package metadata expiring at `now + 60 days`, and appends the positive grant fact in one transaction. Intro grant is a separately authorized `100`-unit, no-expiry command. Revoke locks the package, derives its ledger balance, and appends a non-positive revocation fact; it never updates or deletes prior facts.

`AdminApprovalRepository.consumeIfValid` resolves requester and approver from stored authenticated session hashes and checks distinct identities, both recent MFA records, role, action, object, payload hash, nonce, unused state, and expiry in one `UPDATE ... RETURNING`. Every allow and deny appends the complete `AuditPort` fact. Secrets, raw authorization headers, raw conversation text, and full optional profile data never enter audit payloads. `tests/integration/admin-ledger.test.ts` runs valid/replayed/concurrent grants and revocations in PostgreSQL and asserts one approval consumption, one grant/revocation fact, derived conservation, and complete immutable audit fields.

`admin-service.testkit.ts` supplies a bound approval, append-only in-memory ledger, derived balance, and complete audit recorder. `admin.testkit.ts` implements the five approval cases by returning stored immutable approval records; the test body cannot set requester or approver identities directly.

- [ ] **Step 4: Run focused, authorization, and type checks**

Run: `pnpm exec vitest run packages/application/src/feedback-service.test.ts packages/application/src/admin-service.test.ts apps/api/src/routes/admin.test.ts tests/integration/admin-ledger.test.ts && pnpm typecheck`

Expected: PASS; duplicate escalation, stale MFA, role mismatch, and cross-object access are denied and audited.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/feedback-service.ts packages/application/src/feedback-service.test.ts packages/application/src/admin-service.ts packages/application/src/admin-service.test.ts packages/application/src/admin-service.testkit.ts packages/application/src/index.ts packages/db/src/repositories/admin-repository.ts tests/integration/admin-ledger.test.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts apps/api/src/routes/admin.testkit.ts
git commit -m "feat: add audited feedback and admin controls"
```

---

### Task 18: Publish idempotent Make and Sheets projections without a command channel

**Files:**

- Create: `packages/integrations/src/projections/projection-port.ts`
- Create: `packages/integrations/src/projections/make-projection-sink.ts`
- Create: `packages/integrations/src/projections/make-projection-sink.test.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `tests/repo/scope-boundary.test.ts`
- Create: `tests/repo/architecture-boundaries.test.ts`

**Interfaces:**

```ts
export type ProjectionTopic =
  | "reservation_projection.v1"
  | "package_balance_projection.v1"
  | "feedback_projection.v1"
  | "integration_health_projection.v1";
export interface ProjectionEvent {
  eventId: string;
  topic: ProjectionTopic;
  occurredAt: string;
  correlationId: string;
  schemaVersion: 1;
  data: Readonly<Record<string, string | number | boolean | null>>;
}
export interface ProjectionSink { publish(event: ProjectionEvent): Promise<void> }
```

- [ ] **Step 1: Write failing projection contract and no-command-path tests**

```ts
// packages/integrations/src/projections/make-projection-sink.test.ts
import { describe, expect, it, vi } from "vitest";
import { MakeProjectionSink } from "./make-projection-sink.js";

describe("Make projection sink", () => {
  it("sends a versioned idempotent projection with no sensitive fields", async () => {
    const post = vi.fn().mockResolvedValue({ status: 202 });
    const sink = new MakeProjectionSink({
      endpoint: new URL("https://projection.invalid/events"),
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post,
    });
    await sink.publish({
      eventId: "019fa875-2d67-78f1-8c71-f4936268da29",
      topic: "reservation_projection.v1",
      occurredAt: "2026-07-28T10:00:00.000Z",
      correlationId: "corr-1",
      schemaVersion: 1,
      data: { reservationId: "r-1", status: "reserved", expertId: "e-1" },
    });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": "019fa875-2d67-78f1-8c71-f4936268da29" }),
    }));
    expect(JSON.stringify(post.mock.calls[0])).not.toContain("rawConversation");
  });
});
```

Extend `scope-boundary.test.ts` to scan Fastify route registrations and fail if any Make or Sheets inbound route exists.

```ts
// tests/repo/architecture-boundaries.test.ts
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("projection architecture boundary", () => {
  it("allows projection imports only in worker delivery composition", () => {
    const violations: string[] = [];
    for (const file of globSync(["apps/**/*.ts", "packages/**/*.ts"], { exclude: ["**/*.test.ts", "**/*.testkit.ts"] })) {
      const imports = ts.preProcessFile(readFileSync(file, "utf8")).importedFiles.map((value) => value.fileName);
      if (
        imports.some((value) => value.includes("/projections/") || value.includes("projection-port"))
        && !file.replaceAll("\\", "/").startsWith("packages/worker/")
        && !file.replaceAll("\\", "/").includes("packages/integrations/src/projections/")
      ) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `pnpm exec vitest run packages/integrations/src/projections/make-projection-sink.test.ts tests/repo/scope-boundary.test.ts tests/repo/architecture-boundaries.test.ts`

Expected: FAIL because the projection port and sink do not exist.

- [ ] **Step 3: Implement the allowlisted outbound projection**

Validate the exact topic union and schema version, reject extra fields per topic, sign each HTTPS request, set the event ID as the idempotency key, use a five-second timeout, and normalize status codes into retryable/permanent failures. The accepted fields are:

| Topic | Fields |
|---|---|
| `reservation_projection.v1` | `reservationId`, `status`, `expertId`, `slotStartsAt`, `updatedAt` |
| `package_balance_projection.v1` | `userId`, `packageId`, `ledgerDerivedBalance`, `expiresAt`, `updatedAt` |
| `feedback_projection.v1` | `feedbackId`, `score`, `escalated`, `createdAt` |
| `integration_health_projection.v1` | `provider`, `state`, `lagSeconds`, `checkedAt` |

Do not send client names, channel IDs, profile text, feedback text, conversation content, meeting URLs, credentials, or safety narratives. Balance projection reads the derived SQL view only. Sheets are updated by Make from these events; the platform has no Sheets credential and no readback logic. The semantic boundary test parses the actual TypeScript import graph rather than searching route text; Task 20 adds runtime 404 assertions against the composed API. Contract tests use an injected fake HTTP function and placeholder authorization; runtime composition keeps `MAKE_PROJECTION_ENABLED=false`.

- [ ] **Step 4: Run projection, scope, and type checks**

Run: `pnpm exec vitest run packages/integrations/src/projections/make-projection-sink.test.ts tests/repo/scope-boundary.test.ts tests/repo/architecture-boundaries.test.ts && pnpm typecheck`

Expected: PASS; only outbound allowlisted projections exist.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/projections packages/integrations/src/index.ts tests/repo/scope-boundary.test.ts tests/repo/architecture-boundaries.test.ts
git commit -m "feat: add read only operational projections"
```

---

### Task 19: Add expiry, reconciliation, and safety-independent worker jobs

**Files:**

- Create: `packages/worker/src/reservation-expiry.ts`
- Create: `packages/worker/src/reconciliation.ts`
- Create: `packages/worker/src/safety-handoff.ts`
- Create: `packages/worker/src/worker-jobs.testkit.ts`
- Create: `packages/worker/src/reservation-expiry.test.ts`
- Create: `packages/worker/src/reconciliation.test.ts`
- Create: `packages/worker/src/safety-handoff.test.ts`
- Modify: `packages/worker/src/index.ts`
- Modify: `apps/worker/package.json`
- Create: `apps/worker/src/runtime.ts`
- Create: `apps/worker/src/main.ts`

**Interfaces:**

```ts
export function expireDueReservations(deps: ExpiryDeps, now: Date, batchSize: number): Promise<JobResult>;
export function reconcileProviderReservations(deps: ReconciliationDeps, window: ReconciliationWindow): Promise<ReconciliationReport>;
export function processSafetyHandoffs(deps: SafetyHandoffDeps, now: Date, batchSize: number): Promise<SafetyHandoffReport>;
export interface WorkerRuntime {
  runOnce(): Promise<WorkerCycleReport>;
  close(): Promise<void>;
}
export function expiryFixture(seed: readonly ReservationExpirySeed[]): ExpiryFixture;
export function reconciliationFixture(seed: ReconciliationSeed): ReconciliationFixture;
export function safetyHandoffFixture(seed: readonly HandoffSeed[]): SafetyHandoffFixture;
```

- [ ] **Step 1: Write failing expiry and reconciliation tests**

```ts
// packages/worker/src/reservation-expiry.test.ts
import { describe, expect, it } from "vitest";
import { expireDueReservations } from "./reservation-expiry.js";
import { expiryFixture } from "./worker-jobs.testkit.js";

describe("reservation expiry", () => {
  it("expires only due reserved rows and emits one free cancellation flow", async () => {
    const deps = expiryFixture([
      { id: "due", status: "reserved", reservedUntil: "2026-07-28T09:59:59.000Z", version: 1 },
      { id: "future", status: "reserved", reservedUntil: "2026-07-28T10:00:01.000Z", version: 1 },
      { id: "booked", status: "booked", reservedUntil: "2026-07-28T09:00:00.000Z", version: 2 },
    ]);
    const result = await expireDueReservations(deps, new Date("2026-07-28T10:00:00.000Z"), 100);
    expect(result).toEqual({ examined: 1, changed: 1, failed: 0 });
    expect(deps.outbox.topics()).toEqual(["planerka.cancel", "client.reservation_expired", "expert.reservation_expired"]);
    expect(deps.outbox.allFree()).toBe(true);
  });
});
```

```ts
// packages/worker/src/safety-handoff.test.ts
import { describe, expect, it } from "vitest";
import { processSafetyHandoffs } from "./safety-handoff.js";
import { safetyHandoffFixture } from "./worker-jobs.testkit.js";

describe("durable safety handoff", () => {
  it("assigns, acknowledges, and escalates overdue cases independently of provider outages", async () => {
    const deps = safetyHandoffFixture([
      {
        id: "handoff-overdue",
        status: "assigned",
        ownerId: "operator-1",
        acknowledgeBy: "2026-07-28T09:55:00.000Z",
        acknowledgedAt: null,
        version: 2,
      },
      {
        id: "handoff-acknowledged",
        status: "acknowledged",
        ownerId: "operator-2",
        acknowledgeBy: "2026-07-28T09:55:00.000Z",
        acknowledgedAt: "2026-07-28T09:54:00.000Z",
        version: 3,
      },
    ]);
    deps.planerkaCircuit.open();
    deps.intentModelCircuit.open();
    const result = await processSafetyHandoffs(
      deps,
      new Date("2026-07-28T10:00:00.000Z"),
      100,
    );
    expect(result).toEqual({ examined: 2, escalated: 1, unchanged: 1 });
    expect(deps.status("handoff-overdue")).toBe("escalated");
    expect(deps.outbox.topics()).toEqual(["safety.operator_escalation"]);
    expect(deps.audit.actions()).toEqual(["safety.handoff_sla_escalated"]);
  });
});
```

```ts
// packages/worker/src/reconciliation.test.ts
import { describe, expect, it } from "vitest";
import { reconcileProviderReservations } from "./reconciliation.js";
import { reconciliationFixture } from "./worker-jobs.testkit.js";

describe("provider reconciliation", () => {
  it("reports drift, repairs only safe projection drift, and never guesses provider state", async () => {
    const deps = reconciliationFixture({
      local: [{ id: "r-1", externalId: "p-1", status: "reserved" }],
      provider: [{ externalId: "p-1", status: "booked" }],
    });
    const report = await reconcileProviderReservations(deps, {
      from: "2026-07-28T00:00:00.000Z",
      to: "2026-07-29T00:00:00.000Z",
    });
    expect(report.mismatches).toEqual([{ reservationId: "r-1", local: "reserved", provider: "booked" }]);
    expect(deps.transitions).toHaveLength(0);
    expect(deps.alerts).toEqual(["reservation_state_drift"]);
  });
});
```

- [ ] **Step 2: Run the worker tests and confirm the expected failure**

Run: `pnpm exec vitest run packages/worker/src/reservation-expiry.test.ts packages/worker/src/reconciliation.test.ts packages/worker/src/safety-handoff.test.ts`

Expected: FAIL because expiry, reconciliation, and safety-handoff jobs do not exist.

- [ ] **Step 3: Implement leased jobs, drift reports, and runtime scheduling**

Expire rows in batches using `FOR UPDATE SKIP LOCKED`, the reservation state machine, expected versions, and one transaction per batch. Enqueue provider cancellation and free client/expert notifications with stable versioned idempotency keys.

Reconciliation reads local and provider states, emits a report with counts and exact mismatches, repairs only projection delivery state, and sends reservation drift to an operator queue. It never changes an authoritative reservation based on an ambiguous or unavailable provider response. An unavailable Planerka adapter yields `provider_unavailable`, opens the circuit after the configured threshold, and leaves local state unchanged.

`processSafetyHandoffs` locks due escalation rows, verifies owner/acknowledgement/version, transitions overdue assigned cases to `escalated`, appends audit, and enqueues the free operator escalation atomically. Acknowledgement is an authenticated operator command with expected version and timestamp. Resolved cases are immutable except for append-only lifecycle/audit facts.

`WorkerRuntime.runOnce` executes safety handoff SLA work first, then expired-lease recovery and unknown-outcome reconciliation, due reservation expiry, confirmed-safe outbox delivery, processor erasure/retention, and bounded provider drift reconciliation. Safety uses a dedicated dispatcher and circuit independent of LLM and booking providers. `apps/worker/src/main.ts` loads validated config, constructs `WorkerRuntime`, runs the polling loop, and handles `SIGTERM`/`SIGINT` by stopping claims, finishing the current bounded batch, closing database/telemetry, and exiting nonzero on startup failure. `worker-jobs.testkit.ts` provides typed repositories plus topic, transition, alert, circuit, and audit recorders.

Replace the bootstrap-only worker scripts with `main: "dist/main.js"`, `build: "tsup src/main.ts src/index.ts --format esm --dts --clean"`, `start: "node dist/main.js"`, and the existing strict `typecheck`. The built entrypoint must call `main()` at process startup; importing it in a test must not start a loop.

- [ ] **Step 4: Run all worker and integration tests**

Run: `pnpm exec vitest run packages/worker/src tests/integration/outbox-runner.test.ts tests/integration/booking-concurrency.test.ts && pnpm typecheck && pnpm --filter @ii-tonya/app-worker build`

Expected: PASS; jobs are repeatable and bounded, the real `dist/main.js` worker artifact is emitted, and no job invents provider outcomes.

- [ ] **Step 5: Commit**

```bash
git add packages/worker apps/worker
git commit -m "feat: add expiry and reconciliation workers"
```

---

### Task 20: Compose hardened API routes, health checks, logging, metrics, and tracing

**Files:**

- Create: `packages/observability/src/logger.ts`
- Create: `packages/observability/src/metrics.ts`
- Create: `packages/observability/src/tracing.ts`
- Create: `packages/observability/src/logger.test.ts`
- Modify: `packages/observability/src/index.ts`
- Modify: `apps/api/package.json`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/selarti-webhook.ts`
- Create: `apps/api/src/routes/telegram-webhook.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/app.test.ts`
- Create: `tests/e2e/api-boundary.test.ts`

**Interfaces:**

```ts
export interface AppDependencies {
  config: RuntimeConfig;
  conversationService: ConversationService;
  bookingService: BookingService;
  catalogService: CatalogService;
  privacyService: PrivacyService;
  adminService: AdminService;
  selarti: SelartiPort;
  telegramCallbacks: TelegramCallbackService;
  readiness: ReadinessProbe;
  logger: Logger;
}
export function buildApp(deps: AppDependencies): Promise<FastifyInstance>;
export function createLogger(destination?: NodeJS.WritableStream): Logger;
```

- [ ] **Step 1: Write failing route-security and redaction tests**

```ts
// apps/api/src/app.test.ts
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./app.js";

describe("API boundary", () => {
  it("rejects unverified webhooks before application dispatch", async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti",
      headers: { "content-type": "application/json" },
      payload: { event: "message" },
    });
    expect(response.statusCode).toBe(401);
    expect(app.services.conversation.handleInbound).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated Telegram requests before protected quota accounting", async () => {
    const app = await buildTestApp();
    const unauthenticated = await Promise.all(Array.from({ length: 11 }, (_, updateId) => app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: { "content-type": "application/json", "x-correlation-id": "corr-1" },
      payload: { update_id: updateId },
    })));
    expect(unauthenticated.every((response) => response.statusCode === 401)).toBe(true);
    const authenticated = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": "corr-auth",
        "x-telegram-bot-api-secret-token": "__PLACEHOLDER_TELEGRAM_WEBHOOK_SECRET__",
      },
      payload: { update_id: 100 },
    });
    expect(authenticated.statusCode).not.toBe(429);
  });

  it("rate-limits authenticated Telegram requests and deduplicates update IDs", async () => {
    const app = await buildTestApp();
    const headers = {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "__PLACEHOLDER_TELEGRAM_WEBHOOK_SECRET__",
    };
    const duplicate = await Promise.all([
      app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers, payload: { update_id: 1 } }),
      app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers, payload: { update_id: 1 } }),
    ]);
    expect(duplicate.map((response) => response.statusCode).sort()).toEqual([200, 200]);
    expect(app.services.telegram.processedUpdateCount("1")).toBe(1);
    const responses = await Promise.all(Array.from({ length: 11 }, (_, index) => app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers,
      payload: { update_id: index + 10 },
    })));
    expect(responses.some((response) => response.statusCode === 429)).toBe(true);
  });

  it("exposes no Make, Sheets, or projection command route", async () => {
    const app = await buildTestApp();
    for (const url of ["/v1/webhooks/make", "/v1/webhooks/sheets", "/v1/projections/command"]) {
      expect((await app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(404);
    }
  });
});
```

```ts
// packages/observability/src/logger.test.ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

describe("logger redaction", () => {
  it("removes credentials, raw bodies, profile text, and meeting links", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    createLogger(output).info({
      authorization: "Bearer __PLACEHOLDER_TEST_AUTH_TOKEN__",
      rawBody: "private message",
      clientProfile: { goals: "private" },
      meetingUrl: "https://meeting.invalid/private",
      providerUrl: "https://api.telegram.org/bot__PLACEHOLDER_TELEGRAM_BOT_TOKEN__/sendMessage",
      correlationId: "corr-1",
    }, "request");
    await new Promise((resolve) => output.once("data", resolve));
    const line = Buffer.concat(chunks).toString("utf8");
    expect(line).not.toContain("__PLACEHOLDER_TEST_AUTH_TOKEN__");
    expect(line).not.toContain("private message");
    expect(line).not.toContain("meeting.invalid");
    expect(line).not.toContain("__PLACEHOLDER_TELEGRAM_BOT_TOKEN__");
    expect(line).toContain("/bot[REDACTED]/sendMessage");
    expect(line).toContain("corr-1");
  });
});
```

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `pnpm exec vitest run apps/api/src/app.test.ts packages/observability/src/logger.test.ts`

Expected: FAIL because the API composition root and observability package do not exist.

- [ ] **Step 3: Implement the hardened composition root**

Register only:

- `GET /health/live` for process liveness;
- `GET /health/ready` for PostgreSQL, migration version, worker lease freshness, and required adapter activation;
- `POST /v1/webhooks/selarti` behind raw-body verification, strict JSON, 64 KiB limit, replay window, rate limit, and inbox deduplication;
- `POST /v1/webhooks/telegram` behind Telegram secret-path/header verification, strict JSON, 64 KiB limit, rate limit, numeric expert authorization, and callback verification;
- scoped admin routes from Task 17.

Authentication and raw-body/schema checks execute before the protected rate-limit bucket; rejected unauthenticated requests use a separate coarse IP abuse limiter and cannot exhaust authenticated provider quota. Telegram deduplication uses `update_id` in `integration_inbox`. Selarti inbound messages and any future delivery events use distinct provider event IDs and routes through the same durable inbox before application dispatch.

Use dependency injection to bind disabled Selarti, Planerka, Telegram, Make projection, intent-model, and payment adapters. The current configuration schema accepts only literal `false` for all six live flags, so startup rejects every attempted activation before secret lookup or network construction. `server.ts` starts the built Fastify app on configured host/port, emits readiness only after migrations, handles termination signals, and closes telemetry/database. Enabling any provider requires a separate reviewed plan after real sandbox sessions and approved contract evidence exist.

Replace the bootstrap-only API scripts with `main: "dist/server.js"`, `build: "tsup src/server.ts src/index.ts --format esm --dts --clean"`, `start: "node dist/server.js"`, and the existing strict `typecheck`. The built entrypoint must call `main()` only when executed as the process module; test imports remain side-effect free.

Create Pino redaction paths for authorization, cookies, tokens, secrets, raw bodies, conversation fields, optional profiles, contact channels, meeting URLs, provider payloads, request URLs, `req.url`, and `err.request.url`. A serializer detects `/bot{token}/{method}` and emits `/bot[REDACTED]/{method}` before any log or trace export. Emit correlation ID, hashed event ID, module, operation, normalized outcome, duration, retry count, and error code. Add OpenTelemetry spans and low-cardinality metrics for inbox duplicates, debit outcomes, reservation transitions, outbox unknown outcomes/lag/dead letter, provider circuit state, safety handoffs, and reconciliation drift.

- [ ] **Step 4: Run API, observability, contract, and type checks**

Run: `pnpm exec vitest run apps/api/src packages/observability/src tests/contract tests/e2e/api-boundary.test.ts && pnpm typecheck && pnpm --filter @ii-tonya/api build`

Expected: PASS; unauthenticated ingress cannot reach application services, sensitive values are redacted, and the real `dist/server.js` API artifact is emitted.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/observability tests/e2e/api-boundary.test.ts
git commit -m "feat: compose hardened api and observability"
```

---

### Task 21: Add Docker, CI/CD, full MVP smoke tests, and operating evidence

**Files:**

- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `.dockerignore`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `scripts/smoke.mjs`
- Create: `tests/e2e/mvp-smoke.test.ts`
- Create: `tests/e2e/support/mvp-harness.ts`
- Create: `tests/container/image-smoke.test.mjs`
- Create: `tests/provider-stubs/server.mjs`
- Create: `tests/repo/release-assets.test.ts`
- Create: `tests/repo/workflow-semantics.test.ts`
- Create: `docs/operations/data-retention.md`
- Create: `docs/operations/disaster-recovery.md`
- Create: `docs/operations/reconciliation.md`
- Create: `docs/operations/safety-handoff.md`
- Create: `docs/runbooks/go-live-evidence.md`
- Create: `docs/runbooks/provider-staging-evidence.md`
- Create: `docs/runbooks/rollback.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:** `pnpm verify` is the post-install local and CI verification entrypoint; `pnpm test:container` builds and boots the actual API and worker images and always tears them down; `pnpm smoke -- --base-url=http://localhost:3000` is the deployment probe. Production release requires a signed image digest, `Release status: GO`, and separately reviewed provider-connected staging evidence. No fixture, fake port, local harness, or container-health result can satisfy the provider-connected evidence gate.

- [ ] **Step 1: Write the failing AC-025, workflow-semantics, and release-asset tests**

```ts
// tests/e2e/mvp-smoke.test.ts
import { describe, expect, it } from "vitest";
import { startMvpHarness } from "./support/mvp-harness.js";

describe("AC-025 exact MVP chain", () => {
  it("grants 500, records exactly two dialogue debits, searches verified services, reserves, confirms, cancels, and reconciles without duplicates", async () => {
    const app = await startMvpHarness({
      clock: new Date("2026-07-28T10:00:00.000Z"),
      testOnlyOutboundBillingMode: "provider_delivery_event",
    });
    try {
      const client = await app.createClient({ explicitProfileConsent: true });
      const grant = await app.adminGrantPackage({
        userId: client.userId,
        size: 500,
        validForDays: 60,
        idempotencyKey: "grant-ac025-1",
      });
      expect(grant.expiresAt).toBe("2026-09-26T10:00:00.000Z");

      await app.acceptOrdinaryInbound({
        client,
        text: "Подбери проверенного специалиста",
        providerEventId: "selarti-inbound-ac025-1",
      });
      await app.queueOrdinaryAnswer({
        client,
        text: "Нашла подходящие варианты",
        outboxId: "assistant-outbox-ac025-1",
      });
      expect(await app.dialogueDebitCount(client.userId)).toBe(1);

      await app.recordOutboundDelivery({
        userId: client.userId,
        outboxId: "assistant-outbox-ac025-1",
        provider: "selarti",
        providerDeliveryEventId: "selarti-delivered-ac025-1",
        deliveredAt: "2026-07-28T10:00:03.000Z",
      });
      expect(await app.dialogueDebitCount(client.userId)).toBe(2);
      expect(await app.balance(client.userId)).toBe(498);

      const matches = await app.searchVerifiedServices({
        query: "психолог",
        startsAfter: "2026-07-29T10:00:00.000Z",
      });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.every((match) =>
        match.expert.active && match.expert.verified && match.service.active
      )).toBe(true);

      const reservation = await app.reserve({
        client,
        slotId: matches[0]!.slot.id,
        idempotencyKey: "reserve-ac025-1",
      });
      await app.expertConfirm({
        reservationId: reservation.id,
        expertId: reservation.expertId,
        expectedVersion: reservation.version,
        idempotencyKey: "confirm-ac025-1",
      });
      await app.clientCancel({
        reservationId: reservation.id,
        userId: client.userId,
        idempotencyKey: "cancel-ac025-1",
      });

      expect(await app.notificationLedgerFacts(reservation.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: "reservation_confirmed", kind: "free", delta: 0 }),
          expect.objectContaining({ reason: "reservation_cancelled", kind: "free", delta: 0 }),
        ]),
      );
      expect(await app.balance(client.userId)).toBe(498);

      const firstReconciliation = await app.runReconciliation();
      const secondReconciliation = await app.runReconciliation();
      expect(firstReconciliation.mismatches).toEqual([]);
      expect(secondReconciliation).toMatchObject({
        mismatches: [],
        newLedgerFacts: 0,
        newInboxRows: 0,
        newOutboxRows: 0,
      });
      await expect(app.assertExactlyOnce([
        "package.granted",
        "message.inbound.accepted",
        "message.outbound.delivered",
        "reservation.created",
        "reservation.booked",
        "reservation.cancelled_by_client",
      ])).resolves.toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
```

```ts
// tests/repo/workflow-semantics.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = { name?: string; run?: string; uses?: string };

describe("CI and release workflow semantics", () => {
  it("installs the frozen dependency graph before every pnpm execution", () => {
    const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    const steps = workflow.jobs.verify.steps as WorkflowStep[];
    const install = steps.findIndex((step) =>
      step.run?.includes("pnpm install --frozen-lockfile")
    );
    const executable = steps
      .map((step, index) => ({ index, run: step.run ?? "" }))
      .filter(({ run }) => /\bpnpm (exec|verify|test|lint|typecheck|build)\b/.test(run));
    expect(install).toBeGreaterThanOrEqual(0);
    expect(executable.every(({ index }) => index > install)).toBe(true);
    expect(steps.some((step) => step.run?.includes("pnpm verify"))).toBe(true);
  });

  it("deploys only a tested digest after explicit evidence gates", () => {
    const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));
    expect(workflow.jobs.release.needs).toEqual(
      expect.arrayContaining(["verify_digest", "staging", "evidence_gate"]),
    );
    expect(JSON.stringify(workflow.jobs.release)).toContain("image_digest");
    expect(JSON.stringify(workflow.jobs.evidence_gate)).toContain("Release status: GO");
    expect(JSON.stringify(workflow.jobs.evidence_gate)).toContain(
      "Provider staging status: PASS",
    );
  });
});
```

```ts
// tests/repo/release-assets.test.ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("release assets", () => {
  it("contains runtime, rollback, retention, recovery, reconciliation, and evidence assets", () => {
    const required = [
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
      "Dockerfile",
      "compose.yaml",
      "tests/container/image-smoke.test.mjs",
      "docs/operations/data-retention.md",
      "docs/operations/disaster-recovery.md",
      "docs/operations/reconciliation.md",
      "docs/operations/safety-handoff.md",
      "docs/runbooks/go-live-evidence.md",
      "docs/runbooks/provider-staging-evidence.md",
      "docs/runbooks/rollback.md",
    ];
    expect(required.filter((path) => !existsSync(path))).toEqual([]);
  });

  it("does not convert local fixtures or container health into provider evidence", () => {
    const evidence = readFileSync("docs/runbooks/go-live-evidence.md", "utf8");
    const providerEvidence = readFileSync(
      "docs/runbooks/provider-staging-evidence.md",
      "utf8",
    );
    expect(evidence).toContain("Release status: NO-GO");
    expect(evidence).toContain("Live payments: disabled");
    expect(providerEvidence).toContain("Provider staging status: BLOCKED");
    expect(providerEvidence).toContain("Project-owned authenticated sessions: unavailable");
    expect(providerEvidence).not.toContain("Provider staging status: PASS");
  });
});
```

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `pnpm exec vitest run tests/e2e/mvp-smoke.test.ts tests/repo/workflow-semantics.test.ts tests/repo/release-assets.test.ts`

Expected: FAIL because the exact AC-025 harness methods, semantic workflows, runtime assets, and evidence records do not exist.

- [ ] **Step 3: Implement local AC-025 evidence, built-image evidence, and the gated delivery pipeline**

Implement `mvp-harness.ts` against the real application services and PostgreSQL repositories. Only injected transports, the deterministic intent classifier, and sanitized provider events are fakes. The harness may enable `testOnlyOutboundBillingMode: "provider_delivery_event"` only inside `tests/e2e`; no exported runtime configuration accepts that value. Its stable outbound-delivery event exercises the same inbox, ledger, and idempotency path reserved for a future verified Selarti delivery contract. The committed runtime remains `SELARTI_OUTBOUND_BILLING_MODE=disabled`, so this test proves accounting behavior without claiming Selarti supplies the required event.

The AC-025 test is the authoritative local acceptance chain and must remain exactly:

```text
500-message grant valid for 60 days
ordinary inbound accepted -> debit 1
stable ordinary outbound delivery accepted -> debit 2 and derived balance 498
verified active expert/service/slot search
reservation
expert confirmation
client cancellation
confirmation and cancellation notifications recorded as free delta-0 facts
complete allow audit
two reconciliation runs with zero mismatch and zero duplicate facts/inbox/outbox rows
```

Build non-root multi-stage `api` and `worker` targets from the Task 1 entrypoints. Final commands are `node apps/api/dist/server.js` and `node apps/worker/dist/main.js`; both final stages contain only production dependencies and built output, use numeric UID/GID `10001:10001`, receive no build-time secrets, and write only to `/tmp`. `.dockerignore` excludes `.env`, `.env.*`, `.env.example`, VCS metadata, coverage, caches, and dependency directories. `compose.yaml` starts PostgreSQL 17, runs one migration service, then starts both built targets with `read_only: true`, `tmpfs: /tmp`, health checks, placeholder-only local keys, and all six live flags literal `false`.

`tests/provider-stubs/server.mjs` serves only the sanitized Selarti, Planerka, and Telegram fixture shapes from Tasks 10 through 12. It binds to the Compose-internal network, accepts no credential, and records idempotency keys for assertions. It is local fixture infrastructure, not provider staging evidence.

`tests/container/image-smoke.test.mjs` uses `node:test` and `node:child_process` to execute `docker compose up --build --wait`, run `scripts/smoke.mjs`, resolve API and worker container IDs through `docker compose ps -q`, and inspect each container. It fails unless the API health endpoint answers from the built `server.js`, the worker heartbeat comes from built `main.js`, both users equal `10001:10001`, both root filesystems are read-only, health is `healthy`, and every live flag equals `false`. A `finally` block always executes `docker compose down --volumes --remove-orphans`. This is executable image evidence; static Dockerfile string checks are not sufficient.

Define root commands in this order:

```text
pnpm verify:
  pnpm format:check
  pnpm lint
  pnpm typecheck
  pnpm test:unit
  pnpm test:property
  pnpm test:integration
  pnpm test:contract
  pnpm test:security
  pnpm test:e2e
  pnpm build
  pnpm audit --prod --audit-level high

pnpm test:container:
  node --test tests/container/image-smoke.test.mjs
```

`ci.yml` has one dependency boundary: checkout and Node/Corepack/pnpm setup, then `pnpm install --frozen-lockfile`, then all repository commands. Immediately after the frozen install, run `pnpm exec vitest run tests/repo/env-policy.test.ts`; no Vitest, pnpm script, or repository binary runs before install. Then run `pnpm verify`, upload JUnit and coverage, run Gitleaks with redaction, execute `pnpm test:container`, and scan both resulting image digests with Trivy using `--severity HIGH,CRITICAL --exit-code 1`. Cache only the pnpm store.

`release.yml` consumes the exact tested image digests, deploys staging, runs migration preflight, smoke, and reconciliation, and creates a signed evidence artifact. Its production job depends on `verify_digest`, `staging`, and `evidence_gate`, requires manual environment approval, reads `Release status: GO` and `Provider staging status: PASS`, deploys by digest, repeats smoke and reconciliation, and follows `rollback.md` on failure. With the committed evidence statuses, the production job cannot run.

Keep the three evidence classes explicit:

| Evidence class | File/command | Initial status | What it proves |
|---|---|---|---|
| Local application | `tests/e2e/mvp-smoke.test.ts` | executable after implementation | exact AC-025 domain/application/repository chain with sanitized events |
| Built container | `pnpm test:container` | executable after implementation | packaged API/worker entrypoints, health, UID, read-only filesystem, disabled flags |
| Provider-connected staging | `docs/runbooks/provider-staging-evidence.md` | `BLOCKED` | only future project-owned Selarti, Planerka, and Telegram sandbox sessions with official contracts and captured receipts |

`provider-staging-evidence.md` contains one row per provider for official contract/version, authenticated project-owned account ID hash, sanitized request/response fixture checksum, ingress-auth result, idempotency result, pre-send failure, post-send unknown-outcome reconciliation, rate-limit result, reviewer, date, and evidence URI. Initialize every result to `not executed`, record `Project-owned authenticated sessions: unavailable`, and set `Provider staging status: BLOCKED`. No skipped or mocked test changes that status.

Add concurrency cases from AC-001, AC-006, AC-009, AC-010, AC-012, AC-014, AC-016, AC-020, and AC-024 to the full E2E suite. `workflow-semantics.test.ts` parses YAML using the root-owned `yaml` development dependency; it never relies on substring order alone.

Create operating documents with explicit owners and executable checks:

- `data-retention.md`: data-class inventory, legal basis, retention period, deletion/anonymization job, consent withdrawal, backup expiry, minor policy status;
- `disaster-recovery.md`: approved RPO/RTO, encrypted backup schedule, restore drill command, last drill evidence, accountable owner;
- `reconciliation.md`: daily message-ledger/package, reservation/Planerka, inbox/outbox, projection, and disabled-payment checks;
- `safety-handoff.md`: clinically approved decision tree, locale directory source, verification date, human SLA, outage fallback, escalation owner;
- `go-live-evidence.md`: one row for every staging and production gate in the threat model, evidence URI/checksum, date, owner, reviewer, and status; initialize the overall release as `NO-GO`, link the separate blocked provider record, and keep live payments `disabled`;
- `rollback.md`: immutable prior digest, database forward-fix rule, traffic rollback, worker pause, outbox drain, reconciliation, incident evidence, and decision owner.

- [ ] **Step 4: Run the complete verification sequence**

Run:

```bash
corepack pnpm install --frozen-lockfile
pnpm verify
pnpm test:container
gitleaks detect --source . --no-banner --redact
trivy image --severity HIGH,CRITICAL --exit-code 1 ii-tonya-api:local
trivy image --severity HIGH,CRITICAL --exit-code 1 ii-tonya-worker:local
git diff --check
```

Expected: PASS for repository verification, the exact local AC-025 chain, and built-image smoke. `go-live-evidence.md` remains `Release status: NO-GO` and `provider-staging-evidence.md` remains `Provider staging status: BLOCKED`; these are correct blocking outcomes, not failed local checks.

- [ ] **Step 5: Commit**

```bash
git add .dockerignore Dockerfile compose.yaml .github scripts/smoke.mjs tests/e2e tests/container tests/provider-stubs tests/repo/release-assets.test.ts tests/repo/workflow-semantics.test.ts docs/operations docs/runbooks README.md package.json pnpm-lock.yaml
git commit -m "ci: add verified mvp delivery pipeline"
```

---

## Adversarial review closure matrix

| Finding | Plan closure | Executable or blocking evidence |
|---|---|---|
| P0-01 workspace dependencies absent | Forward remediation in Task 3 assigns every current and planned external/internal dependency to one manifest and tests the workspace graph | `tests/repo/workspace-dependencies.test.ts`; frozen install, typecheck, and build |
| P0-02 API/worker not executable | Forward implementation in Tasks 19, 20, and 21 creates real entrypoints, start scripts, built targets, health, and runtime inspection | API/worker builds plus `pnpm test:container` |
| P0-03 mutable balance authority | Tasks 4, 6, and 7 use append-only ledger facts and a rebuildable SQL sum view; update/delete are rejected | property, schema, immutability, and parallel-debit tests |
| P0-04 invalid or overlapping booking | Tasks 8 and 15 lock capacity and both actors, recheck expiry/service/expert eligibility, and reject past/ineligible/overlapping confirmation | BOOK-01 through BOOK-04 plus 20-repeat PostgreSQL concurrency |
| P0-05 safety order/directory/handoff weak | Tasks 5, 14, and 19 run deterministic safety first, validate versioned locale contacts, fail safely on classifier outage, and persist SLA lifecycle | SAFE-01 through SAFE-05 and worker SLA tests |
| P0-06 outbound billing lacks stable event | Tasks 2, 7, 10, 14, and 21 keep runtime billing disabled and define debit only from a stable inbox-deduplicated delivery event | contract-disabled runtime plus test-only synthetic AC-025 delivery; provider gate remains blocked |
| P1-01 invalid Vitest/CI order | Tasks 3 and 21 replace the unsupported Vitest repetition flag with `scripts/repeat-vitest.mjs` and prohibit repository commands before frozen install | repeat runner and parsed workflow-order test |
| P1-02 ambiguous provider outcomes retried | Tasks 9 through 12 separate `not_applied`, `unknown_outcome`, and reconciliation; local acknowledgement failure is ambiguous | retry, timeout, lease-recovery, reconcile, and dead-letter tests |
| P1-03 catalog/admin paths absent | Tasks 15 and 17 add eligible search/recommendation plus every FR-015 operation | catalog unit/integration tests and audited admin-ledger integration |
| P1-04 feedback threshold wrong | Task 17 escalates scores 1–3 or explicit negative text | score table plus negative-text score-4 test |
| P1-05 AC-025/mock overclaim | Task 21 implements the exact chain and splits local, built-container, and provider-connected evidence | exact E2E, actual container test, separate `BLOCKED` provider record |
| P1-06 privacy non-transactional/incomplete | Task 16 makes withdrawal and erasure transactional, tracks every processor, resumes crashes, and verifies backup expiry | PRIV-01 through PRIV-05 PostgreSQL workflow tests |
| P1-07 forgeable dual control/incomplete audit | Tasks 6 and 17 resolve one-time server-side approvals bound to session/action/object/payload/nonce and require complete audit fields | forged, stale, replay, cross-object, same-actor, and valid approval tests |
| P1-08 fixture/LLM/Telegram gaps | Tasks 10 through 12 and 14 add success/duplicate/schema/429/pre/post-send fixtures, LLM-01 through LLM-04, official Bot API path, and URL redaction | provider contract fixtures and prompt-safety tests |
| P2-01 callback consumed before validation | Task 11 peeks, validates identity/expert/action/version/expiry, then consumes conditionally | wrong-expert cannot burn token; single SQL conditional consume |
| P2-02 shallow text-only evidence/order ambiguity | Tasks 18, 20, and 21 add TypeScript import-graph analysis, separated auth/rate-limit tests, YAML workflow parsing, and actual container inspection | semantic repository tests and built-image smoke |

## Requirement and threat-test traceability

| Requirement or gate | Primary tasks | Executable evidence |
|---|---:|---|
| MVP-FR-001, AC-001, WH-01, WH-02 | 6, 7, 10, 20 | inbox uniqueness, webhook firewall, duplicate-message integration test |
| MVP-FR-002, AC-018, AC-021, PRIV-01 through PRIV-05 | 5, 6, 15, 16, 21 | consent filtering, expert-view minimization, retention and deletion evidence |
| MVP-FR-003, MVP-FR-004 | 6, 14, 15 | verified catalog schema, typed catalog intent, eligible-slot query |
| MVP-FR-005, MVP-FR-006, AC-002 through AC-006, BILL-01 through BILL-04 | 4, 6, 7, 14 | package policy, ledger constraints, parallel debit, conversation workflow |
| MVP-FR-007 through MVP-FR-012, AC-007 through AC-017, BOOK-01 through BOOK-04 | 3, 6, 8, 11, 12, 15, 19 | reservation state machine, last-place race, callback version, expiry and reconciliation |
| MVP-FR-013, AC-019 | 17 | feedback deduplication and negative-score escalation |
| MVP-FR-014, AC-020, SAFE-01 through SAFE-05 | 5, 14, 19, 21 | provider-independent safety, zero-balance handoff, safety runbook and smoke |
| MVP-FR-015, AC-022, IAM-01, IAM-02 | 6, 17, 20 | scoped role/MFA tests and immutable allow/deny audit |
| MVP-FR-016, AC-015, AC-023, AC-024, RES-01 through RES-03, SEC-01 | 7, 9, 10, 12, 18 through 21 | inbox/outbox, redaction, dead letter, reconciliation, recovery and CI evidence |
| PAY-01 and live-payment release boundary | 2, 13, 20, 21 | unconditional disabled adapter, absent routes/tables, config literal false, release evidence |
| LLM-01 through LLM-04 | 5, 14, 20 | typed intent union, no infrastructure capability, unsafe-output rejection, redacted telemetry |
| Make/Sheets non-authority | 6, 18, 20 | outbound-only projection tests, absent inbound routes, PostgreSQL readiness |
| Deferred MVP boundaries | 6, 13, 21 | absent tables/modules/routes and repository scope test |

## Execution completion criteria

- All 21 task commits exist in order and each was green before the next task began.
- `pnpm verify`, Docker health checks, local smoke, migration checks, and `git diff --check` pass from a clean checkout.
- Concurrency suites pass at least 20 consecutive repetitions.
- No enabled runtime path exists for live payments, unverified Selarti, or unverified Planerka.
- No command path exists from Make, Sheets, LLM output, or provider projection payloads to authoritative state.
- Every MVP acceptance criterion has a named automated test or a dated go-live evidence row.
- Production release remains blocked until the go-live evidence record is complete and independently reviewed.
