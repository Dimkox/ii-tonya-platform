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
    src/booking-service.ts
    src/booking-service.testkit.ts
    src/conversation-service.ts
    src/conversation-service.testkit.ts
    src/feedback-service.ts
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
    src/repositories/inbox-repository.ts
    src/repositories/message-repository.ts
    src/repositories/outbox-repository.ts
    src/repositories/privacy-repository.ts
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
    src/reconciliation.ts
    src/reservation-expiry.ts
    src/worker-jobs.testkit.ts
scripts/smoke.mjs
tests/
  contract/
    planerka-port.test.ts
    selarti-port.test.ts
    telegram-port.test.ts
  e2e/mvp-smoke.test.ts
  e2e/support/mvp-harness.ts
  integration/
    booking-concurrency.test.ts
    message-ledger-concurrency.test.ts
    outbox-runner.test.ts
    schema.test.ts
  repo/
    env-policy.test.ts
    release-assets.test.ts
    scope-boundary.test.ts
    workspace-layout.test.ts
docs/
  contracts/provider-activation.md
  operations/data-retention.md
  operations/disaster-recovery.md
  operations/reconciliation.md
  operations/safety-handoff.md
  runbooks/go-live-evidence.md
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

**Interfaces:** Workspace package names are `@ii-tonya/api`, `@ii-tonya/app-worker`, `@ii-tonya/application`, `@ii-tonya/config`, `@ii-tonya/contracts`, `@ii-tonya/db`, `@ii-tonya/domain`, `@ii-tonya/integrations`, `@ii-tonya/observability`, and `@ii-tonya/worker`.

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

Create the root harness with `"packageManager": "pnpm@10.13.1"`, `"engines": {"node": ">=24 <25"}`, and these exact script targets: `test` → `vitest run`, `test:unit` → `vitest run packages apps`, `test:integration` → `vitest run tests/integration`, `test:contract` → `vitest run tests/contract`, `test:e2e` → `vitest run tests/e2e`, `lint` → `eslint .`, `typecheck` → `pnpm -r typecheck`, and `build` → `pnpm -r build`. Add dev dependencies for TypeScript, ESLint, Prettier, Vitest, `tsx`, and `tsup`. Set `.nvmrc` to `24`; make `vitest.config.ts` include `packages/**/*.test.ts`, `apps/**/*.test.ts`, and `tests/**/*.test.ts`.

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
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "typecheck": "tsc --noEmit"
  }
}
```

Each package entrypoint initially contains the complete valid module:

```ts
export {};
```

Set `pnpm-workspace.yaml` packages to `apps/*` and `packages/*`. Set strict TypeScript options including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and project-wide ESM module resolution.

- [ ] **Step 4: Run the focused and repository checks**

Run: `pnpm exec vitest run tests/repo/workspace-layout.test.ts && pnpm typecheck`

Expected: PASS; every workspace is present and strict TypeScript compilation succeeds.

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

### Task 3: Implement the reservation state machine and deadline policy

**Files:**

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

- [ ] **Step 1: Write the failing state-machine tests**

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

Run: `pnpm exec vitest run packages/domain/src/reservation.test.ts`

Expected: FAIL because `reservation.ts` does not exist.

- [ ] **Step 3: Implement deadline calculation and an explicit transition table**

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

- [ ] **Step 4: Run the focused test and type checking**

Run: `pnpm exec vitest run packages/domain/src/reservation.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/reservation.ts packages/domain/src/reservation.test.ts packages/domain/src/index.ts
git commit -m "feat: define reservation state machine"
```

---

### Task 4: Implement deterministic message charging and package selection

**Files:**

- Create: `packages/domain/src/billing.ts`
- Create: `packages/domain/src/billing.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

```ts
export type MessageClass = "ordinary_inbound" | "ordinary_outbound" | "system" | "safety" | "error";
export type PackageKind = "admin" | "paid" | "intro";
export interface AvailablePackage {
  id: string;
  kind: PackageKind;
  remainingMessages: number;
  expiresAt: Date | null;
  grantedAt: Date;
}
export function chargeDelta(messageClass: MessageClass): -1 | 0;
export function choosePackage(packages: readonly AvailablePackage[], at: Date): AvailablePackage | null;
```

- [ ] **Step 1: Write failing billing-policy tests**

```ts
// packages/domain/src/billing.test.ts
import { describe, expect, it } from "vitest";
import { chargeDelta, choosePackage } from "./billing.js";

const at = new Date("2026-07-28T10:00:00.000Z");
const pkg = (id: string, kind: "admin" | "paid" | "intro", remainingMessages: number, expiresAt: string | null) => ({
  id,
  kind,
  remainingMessages,
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
});
```

- [ ] **Step 2: Run the test and confirm the expected failure**

Run: `pnpm exec vitest run packages/domain/src/billing.test.ts`

Expected: FAIL because `billing.ts` does not exist.

- [ ] **Step 3: Implement the charge table and stable package ordering**

```ts
// packages/domain/src/billing.ts
export type MessageClass = "ordinary_inbound" | "ordinary_outbound" | "system" | "safety" | "error";
export type PackageKind = "admin" | "paid" | "intro";
export interface AvailablePackage {
  id: string;
  kind: PackageKind;
  remainingMessages: number;
  expiresAt: Date | null;
  grantedAt: Date;
}

export const chargeDelta = (messageClass: MessageClass): -1 | 0 =>
  messageClass === "ordinary_inbound" || messageClass === "ordinary_outbound" ? -1 : 0;

export function choosePackage(packages: readonly AvailablePackage[], at: Date): AvailablePackage | null {
  return packages
    .filter((value) =>
      value.remainingMessages > 0
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

Run: `pnpm exec vitest run packages/domain/src/billing.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/billing.ts packages/domain/src/billing.test.ts packages/domain/src/index.ts
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
export interface SafetyClassifier { classify(text: string): Promise<"ordinary" | "urgent" | "crisis" | "uncertain"> }
export interface SafetyDirectory { resolve(locale: string): readonly SafetyContact[] }
export async function evaluateSafety(input: SafetyInput, classifier: SafetyClassifier, directory: SafetyDirectory): Promise<SafetyDecision>;
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
import { evaluateSafety } from "./safety.js";

describe("safety evaluation", () => {
  it("returns a free handoff with verified locale contacts even at zero balance", async () => {
    const classifier = { classify: vi.fn().mockResolvedValue("crisis" as const) };
    const directory = {
      resolve: vi.fn().mockReturnValue([{ label: "Emergency service", channel: "112", verifiedAt: "2026-07-01" }]),
    };
    const decision = await evaluateSafety(
      { text: "Мне небезопасно", locale: "ru-RU", remainingMessages: 0 },
      classifier,
      directory,
    );
    expect(decision).toMatchObject({ kind: "human_handoff", charge: 0 });
    expect(decision.contacts).toHaveLength(1);
  });

  it("uses a conservative handoff when the classifier is unavailable", async () => {
    const classifier = { classify: vi.fn().mockRejectedValue(new Error("offline")) };
    const directory = { resolve: vi.fn().mockReturnValue([]) };
    await expect(evaluateSafety(
      { text: "не уверен", locale: "ru-RU", remainingMessages: 5 },
      classifier,
      directory,
    )).resolves.toMatchObject({ kind: "human_handoff", charge: 0, reason: "classifier_unavailable" });
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
export type SafetyContact = { label: string; channel: string; verifiedAt: string };
export interface SafetyClassifier {
  classify(text: string): Promise<"ordinary" | "urgent" | "crisis" | "uncertain">;
}
export interface SafetyDirectory {
  resolve(locale: string): readonly SafetyContact[];
}

export async function evaluateSafety(
  input: { text: string; locale: string; remainingMessages: number },
  classifier: SafetyClassifier,
  directory: SafetyDirectory,
) {
  try {
    const level = await classifier.classify(input.text);
    if (level === "ordinary") return { kind: "ordinary" as const, charge: -1 as const, contacts: [] };
    return { kind: "human_handoff" as const, charge: 0 as const, reason: level, contacts: directory.resolve(input.locale) };
  } catch {
    return {
      kind: "human_handoff" as const,
      charge: 0 as const,
      reason: "classifier_unavailable" as const,
      contacts: directory.resolve(input.locale),
    };
  }
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
| Catalog | `experts`, `expert_services`, `slots` | verified expert flag; unique provider slot identity; `capacity > 0`; UTC timestamps |
| Billing | `message_packages`, `message_events`, `message_ledger_entries` | non-negative package remainder; unique external message; one charge fact per message/direction/class |
| Booking | `reservations`, `notifications`, `feedback` | normative status check; positive version; unique reservation idempotency key; unique notification idempotency key |
| Conversation and safety | `conversations`, `conversation_messages`, `prompt_versions`, `safety_incidents`, `human_escalations` | content is referenced separately; prompt version is immutable; safety and handoff facts are append-only |
| Audit | `audit_events` | append-only actor/action/object/correlation facts |
| Integration | `integration_inbox`, `integration_outbox`, `delivery_attempts`, `dead_letters`, `provider_cursors`, `reconciliation_runs`, `reconciliation_mismatches`, `projection_checkpoints` | unique provider event and outbox keys; finite delivery state; append-only attempt and mismatch evidence |

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
    ]));
    expect(names).not.toEqual(expect.arrayContaining([
      "coupons", "payments", "referrals", "reminders", "reschedules", "waitlist",
    ]));
  });

  it("rejects duplicate provider events and negative package balances", async () => {
    await testDb.seedUserAndPackage({ externalMessageId: "m-1", remainingMessages: 0 });
    await expect(testDb.insertDuplicateExternalMessage("m-1")).rejects.toThrow();
    await expect(testDb.setRemainingMessages(-1)).rejects.toThrow();
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
  'pending', 'processing', 'succeeded', 'retry_wait', 'dead_letter'
);

alter table channel_identities
  add constraint channel_identities_provider_external_unique unique (provider, external_id);
alter table slots
  add constraint slots_provider_external_unique unique (provider, external_slot_id),
  add constraint slots_capacity_positive check (capacity > 0);
alter table message_packages
  add constraint message_packages_remaining_nonnegative check (remaining_messages >= 0);
alter table message_events
  add constraint message_events_provider_external_unique unique (provider, external_message_id);
alter table message_ledger_entries
  add constraint message_ledger_entry_once unique (message_event_id, direction, message_class),
  add constraint message_ledger_delta_valid check (delta in (-1, 0));
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
```

Every mutable table has `created_at` and `updated_at`; append-only tables have only `created_at`. `conversation_messages` stores a nullable encrypted `content_ref`, never raw text; retention can remove the referenced content without rewriting financial or audit facts. Safety incidents and human escalations use normalized category, severity, response-template version, routing state, and correlation ID. Notifications support nullable `callback_token_hash`, `callback_claims`, `callback_expires_at`, and `callback_consumed_at`; the token hash is unique when present. Delivery attempts, dead letters, provider cursors, reconciliation runs/mismatches, and projection checkpoints provide the evidence required by the design specification. Store provider payload hashes and normalized identifiers, not raw provider bodies. Implement the testkit with `@testcontainers/postgresql`, run migrations per suite, expose only the named seed/assertion helpers used by tests, and terminate the container in `stop`.

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
  | { kind: "accepted"; messageEventId: string; packageId: string | null; remainingMessages: number };
export interface MessageRepository {
  acceptInbound(command: AcceptInboundCommand): Promise<AcceptInboundResult>;
  recordDeliveredOutbound(command: RecordOutboundCommand): Promise<AcceptInboundResult>;
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
});
```

- [ ] **Step 2: Run the integration test and confirm the expected failure**

Run: `pnpm exec vitest run tests/integration/message-ledger-concurrency.test.ts`

Expected: FAIL because `PostgresMessageRepository` does not exist.

- [ ] **Step 3: Implement one serializable transaction per accepted message**

Implement `acceptInbound` with this exact ordering:

1. Insert `integration_inbox(provider, external_event_id, payload_hash)` with `ON CONFLICT DO NOTHING`; on conflict return the stored message event as `duplicate`.
2. Insert `message_events` with the canonical class and no raw text.
3. For zero-delta classes insert one zero ledger fact and skip package locking.
4. For ordinary content, lock eligible packages with `FOR UPDATE`, ordered by `kind = 'intro'`, expiry, grant time, and ID.
5. Decrement with `remaining_messages > 0`; insert one `-1` ledger entry only when the update succeeds.
6. When no package is available, return `packageId: null`, balance `0`, and do not insert a negative ledger fact.
7. Commit the inbox, event, package update, ledger fact, audit fact, and any resulting outbox item atomically.

The package lock query is:

```sql
select id, remaining_messages
from message_packages
where user_id = $1
  and remaining_messages > 0
  and (expires_at is null or expires_at > $2)
order by (kind = 'intro') asc, expires_at asc nulls last, granted_at asc, id asc
for update
limit 1;
```

Map PostgreSQL unique violations for the inbox key to the `duplicate` result; propagate every other database error.

- [ ] **Step 4: Run concurrency tests repeatedly**

Run: `pnpm exec vitest run tests/integration/message-ledger-concurrency.test.ts --repeat=20 && pnpm typecheck`

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
  | { kind: "unavailable"; reason: "lead_time" | "capacity" | "deadline" | "stale_slot" };
export interface TransitionReservationCommand {
  reservationId: string;
  expectedVersion: number;
  action: ReservationAction;
  actorId: string;
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
      actorId: fixture.expertId,
      correlationId: "confirm-1",
    });
    await expect(repo.transition({
      reservationId: first.reservationId,
      expectedVersion: 1,
      action: "expert_confirm",
      actorId: fixture.expertId,
      correlationId: "confirm-retry",
    })).rejects.toThrow("Stale reservation version");
  });
});
```

- [ ] **Step 2: Run the integration test and confirm the expected failure**

Run: `pnpm exec vitest run tests/integration/booking-concurrency.test.ts`

Expected: FAIL because `PostgresBookingRepository` does not exist.

- [ ] **Step 3: Implement row-locked capacity and optimistic callbacks**

Within `reserve`, lock the slot row with `FOR UPDATE`, reject stale provider data, enforce `starts_at >= now + 24h`, calculate the normative deadline, count active `reserved` and `booked` reservations under the same lock, and insert only when the count is below capacity. Return the existing reservation on `idempotency_key` conflict.

Within `transition`, update with both current state and `version = expectedVersion`, increment the version, append an audit event, and enqueue the next provider notification in the same transaction. If no row is updated, distinguish missing reservation from stale version without changing state.

Use this mutation guard:

```sql
update reservations
set status = $1, version = version + 1, updated_at = now()
where id = $2
  and version = $3
  and status = any($4::reservation_status[])
returning id, status, version;
```

- [ ] **Step 4: Run the concurrency test repeatedly**

Run: `pnpm exec vitest run tests/integration/booking-concurrency.test.ts --repeat=20 && pnpm typecheck`

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
  succeed(id: string): Promise<void>;
  retry(id: string, nextAttemptAt: Date, reasonCode: string): Promise<void>;
  deadLetter(id: string, reasonCode: string): Promise<void>;
}
export interface OutboxDispatcher { dispatch(message: OutboxMessage): Promise<void> }
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
  it("retries transient failures with injected backoff and succeeds once", async () => {
    const repository = fakeOutboxRepository([{ id: "o-1", topic: "client.notify", attempt: 0 }]);
    const dispatch = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { retryable: true }))
      .mockResolvedValueOnce(undefined);
    await runOutboxBatch({
      repository,
      dispatcher: { dispatch },
      now: () => new Date("2026-07-28T10:00:00.000Z"),
      retryDelayMs: () => 1_000,
      maxAttempts: 3,
      batchSize: 10,
    });
    expect(repository.retryCalls).toEqual([
      { id: "o-1", at: "2026-07-28T10:00:01.000Z", reasonCode: "timeout" },
    ]);
  });

  it("dead-letters a permanent failure without another delivery", async () => {
    const repository = fakeOutboxRepository([{ id: "o-2", topic: "expert.notify", attempt: 2 }]);
    await runOutboxBatch({
      repository,
      dispatcher: { dispatch: vi.fn().mockRejectedValue(Object.assign(new Error("invalid_recipient"), { retryable: false })) },
      now: () => new Date("2026-07-28T10:00:00.000Z"),
      retryDelayMs: () => 1_000,
      maxAttempts: 3,
      batchSize: 10,
    });
    expect(repository.deadLetterCalls).toEqual([{ id: "o-2", reasonCode: "invalid_recipient" }]);
  });
});
```

- [ ] **Step 2: Run the test and confirm the expected failure**

Run: `pnpm exec vitest run tests/integration/outbox-runner.test.ts`

Expected: FAIL because the outbox runner and repository do not exist.

- [ ] **Step 3: Implement leased claims and one finite decision per message**

Claim with `FOR UPDATE SKIP LOCKED`, set `processing`, increment attempt, and set a finite lease. Recover expired leases to `retry_wait`. `runOutboxBatch` must call exactly one of `succeed`, `retry`, or `deadLetter` after each dispatch attempt:

```ts
export async function runOutboxBatch(deps: OutboxRunnerDeps): Promise<OutboxRunResult> {
  const now = deps.now();
  const messages = await deps.repository.claim(deps.batchSize, new Date(now.getTime() + 30_000));
  let succeeded = 0;
  let retried = 0;
  let deadLettered = 0;
  for (const message of messages) {
    try {
      await deps.dispatcher.dispatch(message);
      await deps.repository.succeed(message.id);
      succeeded += 1;
    } catch (error) {
      const failure = normalizeDispatchError(error);
      if (failure.retryable && message.attempt + 1 < deps.maxAttempts) {
        await deps.repository.retry(
          message.id,
          new Date(now.getTime() + deps.retryDelayMs(message.attempt + 1)),
          failure.code,
        );
        retried += 1;
      } else {
        await deps.repository.deadLetter(message.id, failure.code);
        deadLettered += 1;
      }
    }
  }
  return { claimed: messages.length, succeeded, retried, deadLettered };
}
```

Use exponential backoff with bounded full jitter in runtime configuration; inject deterministic delay in tests. `outbox-runner.testkit.ts` is an in-memory `OutboxRepository` whose `claim` returns the seed once and whose `succeed`, `retry`, and `deadLetter` methods append to typed public call arrays used by the assertions. Store normalized reason codes and payload hashes, not secrets or raw provider bodies.

- [ ] **Step 4: Run focused and integration tests**

Run: `pnpm exec vitest run tests/integration/outbox-runner.test.ts && pnpm test:integration && pnpm typecheck`

Expected: PASS; retries are bounded, leases are recoverable, and terminal failures reach dead letter.

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
- Create: `docs/contracts/provider-activation.md`

**Interfaces:**

```ts
export interface CanonicalInboundMessage {
  providerEventId: string;
  providerMessageId: string;
  channelUserId: string;
  occurredAt: string;
  text: string;
}
export interface SelartiPort {
  decodeVerifiedWebhook(rawBody: Uint8Array, headers: Readonly<Record<string, string>>): Promise<CanonicalInboundMessage>;
  sendMessage(command: { idempotencyKey: string; channelUserId: string; text: string }): Promise<{ providerMessageId: string }>;
}
export function verifySignedWebhook(input: SignedWebhookInput): WebhookVerification;
```

- [ ] **Step 1: Write failing disabled-adapter and generic webhook-firewall tests**

```ts
// tests/contract/selarti-port.test.ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DisabledSelartiAdapter, verifySignedWebhook } from "../../packages/integrations/src/index.js";

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
});
```

- [ ] **Step 2: Run the contract test and confirm the expected failure**

Run: `pnpm exec vitest run tests/contract/selarti-port.test.ts`

Expected: FAIL because the Selarti port, disabled adapter, and webhook verifier do not exist.

- [ ] **Step 3: Implement the port, constant-time firewall, and disabled adapter**

`verifySignedWebhook` must require exact JSON content type, a bounded raw body, an integer timestamp within the configured freshness window, and a constant-time HMAC comparison. It returns a closed reason union: `missing_header`, `content_type`, `body_size`, `timestamp`, or `signature`.

```ts
// packages/integrations/src/selarti/disabled-selarti-adapter.ts
import type { CanonicalInboundMessage, SelartiPort } from "./selarti-port.js";

export class DisabledSelartiAdapter implements SelartiPort {
  async decodeVerifiedWebhook(
    _rawBody: Uint8Array,
    _headers: Readonly<Record<string, string>>,
  ): Promise<CanonicalInboundMessage> {
    throw new Error("Selarti integration is disabled");
  }

  async sendMessage(
    _command: { idempotencyKey: string; channelUserId: string; text: string },
  ): Promise<{ providerMessageId: string }> {
    throw new Error("Selarti integration is disabled");
  }
}
```

In `docs/contracts/provider-activation.md`, define the activation evidence fields and set Selarti status to `NO-GO`: official contract version, document checksum, authentication method, webhook replay window, payload fixtures, sandbox tenant, rate limits, timeout semantics, idempotency support, security reviewer, product approver, and evidence date. A live codec or HTTP adapter is not added by this task.

- [ ] **Step 4: Run contract tests and type checking**

Run: `pnpm exec vitest run tests/contract/selarti-port.test.ts && pnpm typecheck`

Expected: PASS; the security firewall works independently and Selarti network activity is impossible.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/selarti packages/integrations/src/http packages/integrations/src/index.ts tests/contract/selarti-port.test.ts docs/contracts/provider-activation.md
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

**Interfaces:**

```ts
export interface ExpertCallbackClaims {
  reservationId: string;
  expertId: string;
  action: "confirm" | "cancel";
  version: number;
  expiresAtEpochSeconds: number;
}
export interface CallbackClaimsStore {
  put(tokenHash: string, claims: ExpertCallbackClaims): Promise<void>;
  consume(tokenHash: string): Promise<ExpertCallbackClaims | null>;
}
export function issueCallback(claims: ExpertCallbackClaims, secret: Uint8Array, store: CallbackClaimsStore): Promise<string>;
export function verifyCallback(token: string, expectedTelegramUserId: string, binding: ExpertBinding, secret: Uint8Array, store: CallbackClaimsStore, now: Date): Promise<ExpertCallbackClaims>;
export interface TelegramPort {
  sendReservationRequest(view: ExpertReservationView): Promise<{ providerMessageId: string }>;
  sendSchedule(view: ExpertScheduleView): Promise<{ providerMessageId: string }>;
}
```

- [ ] **Step 1: Write failing authorization and callback tests**

```ts
// tests/contract/telegram-port.test.ts
import { describe, expect, it } from "vitest";
import {
  issueCallback,
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
    async consume(key: string) {
      const value = values.get(key) ?? null;
      values.delete(key);
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
      { telegramUserId: "123456789", expertId: "expert-1" },
      secret,
      store,
      new Date("2026-07-28T10:00:00.000Z"),
    )).resolves.toEqual(claims);
    await expect(verifyCallback(
      token,
      "123456789",
      { telegramUserId: "123456789", expertId: "expert-1" },
      secret,
      store,
      new Date("2026-07-28T10:00:00.000Z"),
    )).rejects.toThrow("Callback token is unknown or already used");
  });

  it("rejects another Telegram user, tampering, reuse, and an expired token", async () => {
    const store = memoryCallbackStore();
    const token = await issueCallback(claims, secret, store);
    await expect(verifyCallback(
      token,
      "987654321",
      { telegramUserId: "123456789", expertId: "expert-1" },
      secret,
      store,
      new Date("2026-07-28T10:00:00.000Z"),
    )).rejects.toThrow("Telegram identity is not authorized");
    await expect(verifyCallback(
      `${token}x`,
      "123456789",
      { telegramUserId: "123456789", expertId: "expert-1" },
      secret,
      store,
      new Date("2026-07-28T10:00:00.000Z"),
    )).rejects.toThrow("Invalid callback token");
  });
});
```

- [ ] **Step 2: Run the contract test and confirm the expected failure**

Run: `pnpm exec vitest run tests/contract/telegram-port.test.ts`

Expected: FAIL because callback signing and the Telegram adapter do not exist.

- [ ] **Step 3: Implement compact one-time callbacks and the narrow Telegram adapter**

Generate a 16-byte random nonce, persist `SHA-256(nonce)` with the claims through `CallbackClaimsStore`, append a 16-byte truncated HMAC over the nonce, and encode the version byte, nonce, and tag as base64url. Prefix the result with `ct1.` and reject any result over Telegram's 64-byte callback limit. Verification authenticates the tag in constant time, checks numeric-ID binding, atomically consumes the hash once, then performs expiry, expert match, action allowlisting, and positive-version checks. `PostgresTelegramCallbackRepository.consume` uses `UPDATE notifications SET callback_consumed_at = now() WHERE callback_token_hash = $1 AND callback_consumed_at IS NULL AND callback_expires_at > now() RETURNING callback_claims`, so a retry cannot replay a consumed callback. Never put client PII, reservation ID, expert ID, appointment notes, meeting URLs, or provider tokens in callback data.

`TelegramAdapter` accepts an injected HTTPS transport and bot-token authorization header, implements only `sendReservationRequest` and `sendSchedule`, sets an idempotency key in the local outbox rather than assuming Telegram idempotency, and maps provider errors to normalized retryable/permanent failures. `/schedule` obtains its view from the application service after expert authorization; the adapter cannot query PostgreSQL itself. Contract tests use the injected fake transport and placeholder tokens; runtime composition keeps `TELEGRAM_ENABLED=false` and does not construct the HTTPS adapter while no authenticated session exists.

- [ ] **Step 4: Run the contract and security-focused tests**

Run: `pnpm exec vitest run tests/contract/telegram-port.test.ts && pnpm typecheck`

Expected: PASS; unauthorized, stale, expired, and tampered callbacks fail closed.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/telegram packages/integrations/src/index.ts packages/db/src/repositories/telegram-callback-repository.ts packages/db/src/index.ts tests/contract/telegram-port.test.ts
git commit -m "feat: secure telegram expert callbacks"
```

---

### Task 12: Define Planerka availability and booking ports with stale-data controls

**Files:**

- Create: `packages/integrations/src/planerka/planerka-port.ts`
- Create: `packages/integrations/src/planerka/disabled-planerka-adapter.ts`
- Modify: `packages/integrations/src/index.ts`
- Test: `tests/contract/planerka-port.test.ts`
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
  reserve(command: { idempotencyKey: string; externalSlotId: string; externalReservationId: string }): Promise<void>;
  confirm(command: { idempotencyKey: string; externalReservationId: string }): Promise<void>;
  cancel(command: { idempotencyKey: string; externalReservationId: string }): Promise<void>;
  getReservation(externalReservationId: string): Promise<"reserved" | "booked" | "cancelled" | "missing">;
}
export function normalizeProviderSlots(slots: readonly ProviderSlot[], now: Date, maxAgeMs: number): readonly ProviderSlot[];
```

- [ ] **Step 1: Write failing normalization and disabled-binding tests**

```ts
// tests/contract/planerka-port.test.ts
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
});
```

- [ ] **Step 2: Run the contract test and confirm the expected failure**

Run: `pnpm exec vitest run tests/contract/planerka-port.test.ts`

Expected: FAIL because the Planerka port, normalizer, and disabled adapter do not exist.

- [ ] **Step 3: Implement canonical validation and the disabled live adapter**

Use strict Zod parsing for UTC timestamps, positive capacity, end after start, unique external slot IDs, and bounded string fields. `normalizeProviderSlots` excludes observations older than `maxAgeMs`, slots starting before `now + 24h`, malformed intervals, and duplicates; it sorts by `startsAt` then `externalSlotId`.

Every method on `DisabledPlanerkaAdapter` throws `Planerka integration is disabled`. Update the Planerka row in `provider-activation.md` with `NO-GO` and the same evidence fields as Selarti plus reserve/confirm/cancel idempotency semantics and authoritative reconciliation endpoint. A live codec or HTTP adapter is not added by this task.

- [ ] **Step 4: Run contract tests and type checking**

Run: `pnpm exec vitest run tests/contract/planerka-port.test.ts && pnpm typecheck`

Expected: PASS; stale availability is excluded and provider mutation cannot occur.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/planerka packages/integrations/src/index.ts tests/contract/planerka-port.test.ts docs/contracts/provider-activation.md
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
- Modify: `packages/application/src/index.ts`

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
}
export function conversationFixture(input: { balance: number; safety: "ordinary" | "crisis" }): ConversationFixture;
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
    expect(deps.calls).toEqual(["safety", "free-outbound"]);
    expect(result).toMatchObject({ kind: "human_handoff", chargedMessages: 0 });
    expect(deps.intentEngine.propose).not.toHaveBeenCalled();
  });

  it("charges one accepted inbound and one delivered answer exactly once", async () => {
    const deps = conversationFixture({ balance: 3, safety: "ordinary" });
    deps.intentEngine.propose = vi.fn().mockResolvedValue({ kind: "answer", text: "Короткий ответ" });
    const first = await createConversationService(deps).handleInbound(deps.inbound);
    const retry = await createConversationService(deps).handleInbound(deps.inbound);
    expect(first).toMatchObject({ kind: "answered", chargedMessages: 2 });
    expect(retry).toMatchObject({ kind: "duplicate", chargedMessages: 0 });
    expect(deps.messageRepository.ledgerDeltas()).toEqual([-1, -1]);
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

- [ ] **Step 2: Run the workflow test and confirm the expected failure**

Run: `pnpm exec vitest run packages/application/src/conversation-service.test.ts`

Expected: FAIL because the application ports and conversation service do not exist.

- [ ] **Step 3: Implement the workflow in strict decision order**

`handleInbound` performs these calls in order:

1. Validate canonical input, maximum text length, locale, correlation ID, and stable provider keys.
2. Run deterministic and model-assisted safety evaluation.
3. For a handoff, accept the inbound event as class `safety`, append safety and audit facts, enqueue one free handoff notification, and return.
4. For ordinary content, call `acceptInbound`; return immediately for a duplicate.
5. If no package was selected, enqueue `client.no_package` with an idempotency key derived from message-event ID and return without calling the LLM.
6. Ask `IntentEngine` for a strict discriminated union; reject unknown keys, arbitrary URLs, tool names, SQL-like commands, and provider credentials.
7. For an answer, enqueue content, wait for provider delivery confirmation, then call `recordDeliveredOutbound` once. Provider failures enqueue a free integration-error notice and do not debit an undelivered answer.
8. Route catalog, booking, and handoff proposals to typed application commands; the intent engine receives no repository or transport object.

The service constructor accepts only ports from `ports.ts`; no infrastructure import is allowed in `packages/application`. `conversation-service.testkit.ts` supplies in-memory implementations of every port, records ordered calls, ledger deltas, and outbox topics, and uses inbox and outbox maps keyed exactly like PostgreSQL. It exposes only the members used by the three assertions. Runtime composition keeps `INTENT_MODEL_ENABLED=false`; tests use a typed fake and no model session or API key.

- [ ] **Step 4: Run unit, domain, and type checks**

Run: `pnpm exec vitest run packages/application/src/conversation-service.test.ts packages/domain/src && pnpm typecheck`

Expected: PASS; workflow order and all free/charged cases are exact.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/ports.ts packages/application/src/conversation-service.ts packages/application/src/conversation-service.testkit.ts packages/application/src/conversation-service.test.ts packages/application/src/index.ts
git commit -m "feat: orchestrate safety first conversations"
```

---

### Task 15: Orchestrate reserve, confirm, cancel, expiry, and expert schedule workflows

**Files:**

- Create: `packages/application/src/booking-service.ts`
- Create: `packages/application/src/booking-service.testkit.ts`
- Create: `packages/application/src/booking-service.test.ts`
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

- [ ] **Step 2: Run the workflow test and confirm the expected failure**

Run: `pnpm exec vitest run packages/application/src/booking-service.test.ts`

Expected: FAIL because `booking-service.ts` does not exist.

- [ ] **Step 3: Implement booking application transactions and free notifications**

Use the database repository as the sole transition owner. `searchSlots` reads only non-stale normalized slots starting at least 24 hours ahead. `reserve` writes the local reservation plus Planerka and Telegram outbox facts atomically. Confirm/cancel commands verify expert ownership and expected version before transition. Client cancellation verifies reservation ownership. Every user or expert notification has `charge = 0` and an idempotency key `{reservationId}:{newVersion}:{topic}`.

`getExpertSchedule` authorizes numeric Telegram identity through the expert binding, queries only that expert’s range, converts UTC using the requested configured timezone, and uses `buildExpertView` for each appointment. Meeting URLs are returned only for booked appointments to the owning expert. `booking-service.testkit.ts` implements the repository, audit, and outbox ports in memory with a single seeded expert/slot/client; it records topics, charge flags, actions, and transitions used by the assertions.

- [ ] **Step 4: Run booking unit and concurrency suites**

Run: `pnpm exec vitest run packages/application/src/booking-service.test.ts tests/integration/booking-concurrency.test.ts && pnpm typecheck`

Expected: PASS; all transitions, ownership checks, and notification counts are deterministic.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/booking-service.ts packages/application/src/booking-service.testkit.ts packages/application/src/booking-service.test.ts packages/application/src/index.ts
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
- Modify: `packages/worker/src/index.ts`

**Interfaces:**

```ts
export interface PrivacyService {
  withdrawConsent(command: WithdrawConsentCommand): Promise<void>;
  exportSubject(command: ExportSubjectCommand): Promise<SubjectExport>;
  eraseSubject(command: EraseSubjectCommand): Promise<ErasureReceipt>;
}
export interface PrivacyRepository {
  appendConsentDecision(command: ConsentDecisionCommand): Promise<void>;
  removeOptionalProfile(userId: string): Promise<void>;
  cancelConsentedFollowUps(userId: string): Promise<void>;
  exportOwnedSubject(userId: string): Promise<SubjectExport>;
  eraseContentAndPseudonymize(userId: string, pseudonym: string): Promise<ErasureReceipt>;
}
export function runRetentionBatch(deps: RetentionDeps, now: Date, batchSize: number): Promise<RetentionReport>;
```

- [ ] **Step 1: Write failing privacy lifecycle and retention tests**

```ts
// packages/application/src/privacy-service.test.ts
import { describe, expect, it, vi } from "vitest";
import { createPrivacyService } from "./privacy-service.js";

describe("privacy lifecycle", () => {
  it("appends withdrawal, removes optional profile fields, and cancels follow-ups", async () => {
    const repository = {
      appendConsentDecision: vi.fn(),
      removeOptionalProfile: vi.fn(),
      cancelConsentedFollowUps: vi.fn(),
      exportOwnedSubject: vi.fn(),
      eraseContentAndPseudonymize: vi.fn(),
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
    expect(repository.appendConsentDecision).toHaveBeenCalledWith(expect.objectContaining({ granted: false }));
    expect(repository.removeOptionalProfile).toHaveBeenCalledWith("u-1");
    expect(repository.cancelConsentedFollowUps).toHaveBeenCalledWith("u-1");
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: "privacy.consent_withdrawn" }));
  });

  it("denies cross-subject export and preserves non-identifying ledger and audit facts during erasure", async () => {
    const repository = {
      appendConsentDecision: vi.fn(),
      removeOptionalProfile: vi.fn(),
      cancelConsentedFollowUps: vi.fn(),
      exportOwnedSubject: vi.fn(),
      eraseContentAndPseudonymize: vi.fn().mockResolvedValue({
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
    })).resolves.toMatchObject({ ledgerFactsPreserved: 2, auditFactsPreserved: 5 });
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
});
```

- [ ] **Step 2: Run the privacy tests and confirm the expected failure**

Run: `pnpm exec vitest run packages/application/src/privacy-service.test.ts packages/worker/src/data-retention.test.ts`

Expected: FAIL because the privacy service, repository, and retention worker do not exist.

- [ ] **Step 3: Implement owner-scoped privacy operations and class-based retention**

`PrivacyService` compares the authenticated principal with the target before every read or mutation. Withdrawal appends a new `granted = false` consent decision, removes fields governed by that purpose, cancels optional follow-ups, and appends an audit fact in one transaction. Subject export returns only the authenticated subject’s identity, consent history, optional profile, reservations, feedback, and message-accounting summary; it excludes other users, provider credentials, internal prompt text, and expert-private data.

Erasure deletes encrypted content objects and meeting links, clears optional profile and channel-contact fields, replaces the user identifier in retained ledger/audit facts with an irreversible per-environment HMAC pseudonym, and returns counted evidence. It does not falsify message totals, reservation transitions, consent history, safety response evidence, or security audit. The repository uses object-scoped SQL predicates and serializable transactions.

`runRetentionBatch` accepts only retention classes from the approved policy, claims expired content references with `FOR UPDATE SKIP LOCKED`, deletes the external encrypted object before nulling its reference, records per-class counts, retries transient object-store failures, and dead-letters permanent failures. Ledger, consent, safety, and audit tables are never valid deletion targets for this worker.

- [ ] **Step 4: Run privacy, retention, integration, and type checks**

Run: `pnpm exec vitest run packages/application/src/privacy-service.test.ts packages/worker/src/data-retention.test.ts tests/integration/schema.test.ts && pnpm typecheck`

Expected: PASS; cross-subject access is denied, withdrawal takes effect, erasure preserves required facts, and retention is class-bounded.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories/privacy-repository.ts packages/db/src/index.ts packages/application/src/privacy-service.ts packages/application/src/privacy-service.test.ts packages/application/src/index.ts packages/worker/src/data-retention.ts packages/worker/src/data-retention.test.ts packages/worker/src/index.ts
git commit -m "feat: implement privacy lifecycle controls"
```

---

### Task 17: Add feedback escalation, scoped administration, and immutable audit

**Files:**

- Create: `packages/application/src/feedback-service.ts`
- Create: `packages/application/src/feedback-service.test.ts`
- Create: `apps/api/src/routes/admin.ts`
- Create: `apps/api/src/routes/admin.test.ts`
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
  roles: readonly ("support" | "catalog_admin" | "entitlement_admin" | "security_admin")[];
  mfaVerifiedAt: Date;
}
export interface AdminService {
  grantPackage(principal: AdminPrincipal, command: GrantPackageCommand): Promise<void>;
  updateExpertVerification(principal: AdminPrincipal, command: ExpertVerificationCommand): Promise<void>;
}
export type AdminAction = "package.grant" | "package.revoke" | "expert.verify" | "expert.unverify" | "safety.read" | "feedback.read";
export interface AdminAuthorizationInput {
  principal: AdminPrincipal;
  action: AdminAction;
  routeObjectId: string;
  commandObjectId: string;
  approval?: { requestedBy: string; approvedBy: string };
  now: Date;
  correlationId: string;
}
export interface AuditPort {
  append(fact: { action: string; reasonCode: string; correlationId: string }): Promise<void>;
}
export function authorizeAdminAction(input: AdminAuthorizationInput, audit: AuditPort): Promise<"allow" | "deny">;
```

- [ ] **Step 1: Write failing escalation and IAM tests**

```ts
// packages/application/src/feedback-service.test.ts
import { describe, expect, it, vi } from "vitest";
import { createFeedbackService } from "./feedback-service.js";

describe("feedback", () => {
  it("deduplicates feedback and escalates scores one and two without message charge", async () => {
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
      score: 2 as const,
      text: "Не помогло",
      sourceEventId: "feedback-1",
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

describe("admin authorization", () => {
  it("requires recent MFA and object-scoped role for an entitlement grant", async () => {
    const audit = { append: vi.fn() };
    await expect(authorizeAdminAction({
      principal: { id: "admin-1", roles: ["support"], mfaVerifiedAt: new Date("2026-07-28T09:00:00.000Z") },
      action: "package.grant",
      routeObjectId: "u-2",
      commandObjectId: "u-2",
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "admin-1",
    }, audit)).resolves.toBe("deny");
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "package.grant.denied",
      reasonCode: "role_or_mfa",
    }));
  });

  it("requires a second distinct approver for entitlement and expert-verification changes", async () => {
    const audit = { append: vi.fn() };
    await expect(authorizeAdminAction({
      principal: {
        id: "admin-1",
        roles: ["entitlement_admin"],
        mfaVerifiedAt: new Date("2026-07-28T09:55:00.000Z"),
      },
      action: "package.grant",
      routeObjectId: "u-2",
      commandObjectId: "u-2",
      approval: { requestedBy: "admin-1", approvedBy: "admin-1" },
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "admin-2",
    }, audit)).resolves.toBe("deny");
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: "dual_control" }));
  });
});
```

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `pnpm exec vitest run packages/application/src/feedback-service.test.ts apps/api/src/routes/admin.test.ts`

Expected: FAIL because feedback orchestration and admin routes do not exist.

- [ ] **Step 3: Implement deduplication, role checks, recent MFA, and audit**

Feedback insertion uses a unique source event ID. Scores `1` or `2` enqueue exactly one `admin.negative_feedback`; scores `3` through `5` create no escalation. Feedback text is length-bounded and redacted before logging.

Admin routes accept only platform-issued principals, require MFA within 15 minutes, require two distinct authenticated principals for entitlement and expert-verification mutations, and map roles to exact actions:

| Action | Required role | Object rule |
|---|---|---|
| Grant/revoke admin package | `entitlement_admin` | user ID in route must equal command target |
| Verify/unverify expert | `catalog_admin` | expert ID in route must equal command target |
| Read safety case | `security_admin` | explicit case assignment |
| Read negative feedback | `support` | assigned queue |

Every allow and deny appends an audit fact with actor, action, object, reason code, correlation ID, and timestamp. Secrets, raw authorization headers, raw conversation text, and full optional profile data never enter audit payloads.

- [ ] **Step 4: Run focused, authorization, and type checks**

Run: `pnpm exec vitest run packages/application/src/feedback-service.test.ts apps/api/src/routes/admin.test.ts && pnpm typecheck`

Expected: PASS; duplicate escalation, stale MFA, role mismatch, and cross-object access are denied and audited.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/feedback-service.ts packages/application/src/feedback-service.test.ts packages/application/src/index.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
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

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `pnpm exec vitest run packages/integrations/src/projections/make-projection-sink.test.ts tests/repo/scope-boundary.test.ts`

Expected: FAIL because the projection port and sink do not exist.

- [ ] **Step 3: Implement the allowlisted outbound projection**

Validate the exact topic union and schema version, reject extra fields per topic, sign each HTTPS request, set the event ID as the idempotency key, use a five-second timeout, and normalize status codes into retryable/permanent failures. The accepted fields are:

| Topic | Fields |
|---|---|
| `reservation_projection.v1` | `reservationId`, `status`, `expertId`, `slotStartsAt`, `updatedAt` |
| `package_balance_projection.v1` | `userId`, `packageId`, `remainingMessages`, `expiresAt`, `updatedAt` |
| `feedback_projection.v1` | `feedbackId`, `score`, `escalated`, `createdAt` |
| `integration_health_projection.v1` | `provider`, `state`, `lagSeconds`, `checkedAt` |

Do not send client names, channel IDs, profile text, feedback text, conversation content, meeting URLs, credentials, or safety narratives. Sheets are updated by Make from these events; the platform has no Sheets credential and no readback logic. Contract tests use an injected fake HTTP function and placeholder authorization; runtime composition keeps `MAKE_PROJECTION_ENABLED=false`.

- [ ] **Step 4: Run projection, scope, and type checks**

Run: `pnpm exec vitest run packages/integrations/src/projections/make-projection-sink.test.ts tests/repo/scope-boundary.test.ts && pnpm typecheck`

Expected: PASS; only outbound allowlisted projections exist.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/projections packages/integrations/src/index.ts tests/repo/scope-boundary.test.ts
git commit -m "feat: add read only operational projections"
```

---

### Task 19: Add expiry, reconciliation, and safety-independent worker jobs

**Files:**

- Create: `packages/worker/src/reservation-expiry.ts`
- Create: `packages/worker/src/reconciliation.ts`
- Create: `packages/worker/src/worker-jobs.testkit.ts`
- Create: `packages/worker/src/reservation-expiry.test.ts`
- Create: `packages/worker/src/reconciliation.test.ts`
- Modify: `packages/worker/src/index.ts`
- Create: `apps/worker/src/runtime.ts`
- Create: `apps/worker/src/main.ts`

**Interfaces:**

```ts
export function expireDueReservations(deps: ExpiryDeps, now: Date, batchSize: number): Promise<JobResult>;
export function reconcileProviderReservations(deps: ReconciliationDeps, window: ReconciliationWindow): Promise<ReconciliationReport>;
export interface WorkerRuntime {
  runOnce(): Promise<WorkerCycleReport>;
  close(): Promise<void>;
}
export function expiryFixture(seed: readonly ReservationExpirySeed[]): ExpiryFixture;
export function reconciliationFixture(seed: ReconciliationSeed): ReconciliationFixture;
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

Run: `pnpm exec vitest run packages/worker/src/reservation-expiry.test.ts packages/worker/src/reconciliation.test.ts`

Expected: FAIL because expiry and reconciliation jobs do not exist.

- [ ] **Step 3: Implement leased jobs, drift reports, and runtime scheduling**

Expire rows in batches using `FOR UPDATE SKIP LOCKED`, the reservation state machine, expected versions, and one transaction per batch. Enqueue provider cancellation and free client/expert notifications with stable versioned idempotency keys.

Reconciliation reads local and provider states, emits a report with counts and exact mismatches, repairs only projection delivery state, and sends reservation drift to an operator queue. It never changes an authoritative reservation based on an ambiguous or unavailable provider response. An unavailable Planerka adapter yields `provider_unavailable`, opens the circuit after the configured threshold, and leaves local state unchanged.

`WorkerRuntime.runOnce` executes expired-lease recovery, due reservation expiry, outbox delivery, and bounded reconciliation in that order. Safety handoff delivery has a dedicated dispatcher and circuit independent of LLM and booking providers. `worker-jobs.testkit.ts` provides the typed in-memory expiry and reconciliation repositories plus the topic, transition, and alert recorders used by the tests.

- [ ] **Step 4: Run all worker and integration tests**

Run: `pnpm exec vitest run packages/worker/src tests/integration/outbox-runner.test.ts tests/integration/booking-concurrency.test.ts && pnpm typecheck`

Expected: PASS; jobs are repeatable, bounded, and do not invent provider outcomes.

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
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/selarti-webhook.ts`
- Create: `apps/api/src/routes/telegram-webhook.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/app.test.ts`

**Interfaces:**

```ts
export interface AppDependencies {
  config: RuntimeConfig;
  conversationService: ConversationService;
  bookingService: BookingService;
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

  it("applies a body limit, strict content type, correlation ID, and rate limit", async () => {
    const app = await buildTestApp();
    const responses = await Promise.all(Array.from({ length: 11 }, () => app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: { "content-type": "application/json", "x-correlation-id": "corr-1" },
      payload: { update_id: 1 },
    })));
    expect(responses.some((response) => response.statusCode === 429)).toBe(true);
    expect(responses.every((response) => response.headers["x-correlation-id"] === "corr-1")).toBe(true);
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
      correlationId: "corr-1",
    }, "request");
    await new Promise((resolve) => output.once("data", resolve));
    const line = Buffer.concat(chunks).toString("utf8");
    expect(line).not.toContain("__PLACEHOLDER_TEST_AUTH_TOKEN__");
    expect(line).not.toContain("private message");
    expect(line).not.toContain("meeting.invalid");
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

Use dependency injection to bind disabled Selarti, Planerka, Telegram, Make projection, intent-model, and payment adapters. The current configuration schema accepts only literal `false` for all six live flags, so startup rejects every attempted activation before secret lookup or network construction. Enabling any provider requires a separate reviewed plan after real sandbox sessions and approved contract evidence exist.

Create Pino redaction paths for authorization, cookies, tokens, secrets, raw bodies, conversation fields, optional profiles, contact channels, meeting URLs, and provider payloads. Emit correlation ID, hashed event ID, module, operation, normalized outcome, duration, retry count, and error code. Add OpenTelemetry spans and low-cardinality metrics for inbox duplicates, debit outcomes, reservation transitions, outbox lag/dead letter, provider circuit state, safety handoffs, and reconciliation drift.

- [ ] **Step 4: Run API, observability, contract, and type checks**

Run: `pnpm exec vitest run apps/api/src packages/observability/src tests/contract && pnpm typecheck`

Expected: PASS; unauthenticated ingress cannot reach application services and sensitive values are redacted.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/observability
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
- Create: `tests/repo/release-assets.test.ts`
- Create: `docs/operations/data-retention.md`
- Create: `docs/operations/disaster-recovery.md`
- Create: `docs/operations/reconciliation.md`
- Create: `docs/operations/safety-handoff.md`
- Create: `docs/runbooks/go-live-evidence.md`
- Create: `docs/runbooks/rollback.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:** `pnpm verify` is the local and CI entrypoint; `pnpm smoke -- --base-url=http://localhost:3000` is the deployment probe; production release requires a signed image digest plus a complete go-live evidence record.

- [ ] **Step 1: Write failing end-to-end and release-asset tests**

```ts
// tests/e2e/mvp-smoke.test.ts
import { describe, expect, it } from "vitest";
import { startMvpHarness } from "./support/mvp-harness.js";

describe("MVP smoke", () => {
  it("completes consent, package grant, two-sided charging, reserve, confirm, schedule, feedback, and safety", async () => {
    const app = await startMvpHarness();
    const client = await app.createClient({ explicitProfileConsent: true });
    await app.adminGrantPackage(client.userId, 4, "grant-smoke-1");
    await app.sendOrdinaryInbound(client, "Подбери специалиста", "msg-smoke-1");
    await app.deliverOrdinaryAnswer(client, "Выберите специалиста", "reply-smoke-1");
    expect(await app.balance(client.userId)).toBe(2);
    const reservation = await app.reserveFirstEligibleSlot(client, "reserve-smoke-1");
    await app.expertConfirm(reservation, reservation.version);
    expect(await app.expertSchedule(reservation.expertId)).toContainEqual(
      expect.objectContaining({ reservationId: reservation.id, status: "booked" }),
    );
    await app.submitFeedback(client, reservation.id, 2, "feedback-smoke-1");
    await app.sendSafetyInbound(client, "Мне небезопасно", "safety-smoke-1");
    expect(await app.balance(client.userId)).toBe(2);
    expect(await app.auditContains([
      "package.granted",
      "message.inbound.accepted",
      "message.outbound.delivered",
      "reservation.created",
      "reservation.booked",
      "feedback.escalated",
      "safety.handoff",
    ])).toBe(true);
    await app.close();
  });
});
```

```ts
// tests/repo/release-assets.test.ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("release assets", () => {
  it("contains CI, rollback, retention, disaster recovery, reconciliation, and safety evidence", () => {
    const required = [
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
      "Dockerfile",
      "compose.yaml",
      "docs/operations/data-retention.md",
      "docs/operations/disaster-recovery.md",
      "docs/operations/reconciliation.md",
      "docs/operations/safety-handoff.md",
      "docs/runbooks/go-live-evidence.md",
      "docs/runbooks/rollback.md",
    ];
    expect(required.filter((path) => !existsSync(path))).toEqual([]);
  });

  it("keeps production disabled while evidence status is NO-GO", () => {
    const evidence = readFileSync("docs/runbooks/go-live-evidence.md", "utf8");
    expect(evidence).toContain("Release status: NO-GO");
    expect(evidence).toContain("Live payments: disabled");
  });
});
```

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `pnpm exec vitest run tests/e2e/mvp-smoke.test.ts tests/repo/release-assets.test.ts`

Expected: FAIL because the harness, deployment assets, and operating evidence files do not exist.

- [ ] **Step 3: Implement the deployment and evidence pipeline**

Build a non-root, multi-stage image containing separate `api` and `worker` commands, a read-only root filesystem, a writable temporary directory, a health check, and no build-time secrets. `.dockerignore` excludes `.env`, `.env.*`, VCS metadata, coverage, local caches, and dependency directories; the image never contains `.env.example` either. `compose.yaml` starts PostgreSQL 17, migrates once, then starts API and worker with every external live flag set to `false` and placeholder-only local credentials.

Add `pnpm verify` with this exact order:

```text
format check
lint
strict typecheck
unit and property tests
PostgreSQL integration and concurrency tests
provider contract tests
security and scope-boundary tests
MVP end-to-end smoke test
production build
dependency audit
secret scan
container build
container vulnerability scan
```

`ci.yml` runs `corepack pnpm install --frozen-lockfile`, caches only the pnpm store, uses an ephemeral PostgreSQL service, uploads JUnit and coverage artifacts, runs Gitleaks, builds the immutable image, and runs Trivy with critical/high policy. `release.yml` accepts only the tested image digest, deploys staging, runs migration preflight plus `scripts/smoke.mjs`, requires a manual production environment approval, verifies `Release status: GO`, deploys by digest, runs post-deploy smoke and reconciliation, and executes `rollback.md` on failure.

Before dependency installation, CI runs `pnpm exec vitest run tests/repo/env-policy.test.ts`, rejects any tracked `.env` derivative other than `.env.example`, rejects a non-placeholder key-like value in `.env.example`, and rejects any live flag not equal to `false`.

The E2E harness uses PostgreSQL plus in-memory Selarti, Planerka, Telegram, safety, and intent ports; it does not call live networks. Add concurrency cases from AC-001, AC-006, AC-009, AC-010, AC-012, AC-014, AC-016, AC-020, and AC-024 to the full E2E suite.

Create operating documents with explicit owners and executable checks:

- `data-retention.md`: data-class inventory, legal basis, retention period, deletion/anonymization job, consent withdrawal, backup expiry, minor policy status;
- `disaster-recovery.md`: approved RPO/RTO, encrypted backup schedule, restore drill command, last drill evidence, accountable owner;
- `reconciliation.md`: daily message-ledger/package, reservation/Planerka, inbox/outbox, projection, and disabled-payment checks;
- `safety-handoff.md`: clinically approved decision tree, locale directory source, verification date, human SLA, outage fallback, escalation owner;
- `go-live-evidence.md`: one row for every staging and production gate in the threat model, evidence URI/checksum, date, owner, reviewer, and status; initialize the overall release as `NO-GO` and live payments as `disabled`;
- `rollback.md`: immutable prior digest, database forward-fix rule, traffic rollback, worker pause, outbox drain, reconciliation, incident evidence, and decision owner.

- [ ] **Step 4: Run the complete verification sequence**

Run:

```bash
pnpm verify
docker compose up --build --wait
pnpm smoke -- --base-url=http://localhost:3000
docker compose down
git diff --check
```

Expected: all checks PASS; smoke covers the complete MVP workflow; the evidence file still prevents production activation until every external and policy gate is approved.

- [ ] **Step 5: Commit**

```bash
git add .dockerignore Dockerfile compose.yaml .github scripts tests/e2e tests/repo/release-assets.test.ts docs/operations docs/runbooks README.md package.json pnpm-lock.yaml
git commit -m "ci: add verified mvp delivery pipeline"
```

---

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
