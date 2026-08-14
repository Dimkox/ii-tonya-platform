# ER-TG-004 Expert Residency Tariff Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authoritative active residency tariff discovery to the repository,
application service, authenticated expert HTTP API, and private Telegram command.

**Architecture:** PostgreSQL owns eligibility, current activity, order, and bounded result
shape. `ExpertResidencyService` owns fresh principal authorization. HTTP and Telegram are
thin read-only adapters over the same service result; the existing quote/checkout path is
not changed.

**Tech Stack:** TypeScript strict mode, Fastify, Drizzle SQL, PostgreSQL 17, Vitest.

## Global Constraints

- Exact base: `3340fc7e706c64ad0a2de185cd9088f2152ebf44`.
- Discovery is read-only, limited to 20 active tariff versions, and exposes only the five
  fields in ER-TG-004-R3.
- Preserve default-off/fail-closed feature composition and all existing callback namespaces.
- No provider import, bot credential, GitHub Actions, production operation, image build, or prune.
- TDD for every behavior; one final focused Claw run only after GREEN, with no repeat.

---

### Task 1: Repository and application query

**Files:**
- Modify: `packages/db/src/repositories/expert-residency-repository.ts`
- Modify: `packages/db/src/repositories/expert-residency-repository.test.ts`
- Modify: `packages/application/src/expert-residency-service.ts`
- Modify: `packages/application/src/expert-residency-service.test.ts`
- Test: `tests/integration/expert-residency-tariff-discovery.test.ts`

**Interfaces:**
- Produces: `ExpertResidencyService.listActiveTariffs(principal)` and
  `PostgresExpertResidencyRepository.listActiveTariffs({ expertId, limit: 20 })`.
- Returns: ordered `ResidencyTariff[]` with `tariffVersionId`, `displayName`,
  `priceMinor`, `currency: "RUB"`, and `durationSeconds`.

- [x] Write application and repository tests that fail because discovery is absent.
- [x] Run the focused tests and confirm the missing interface/behavior failure.
- [x] Implement the minimal bounded repository query and fresh service authorization.
- [x] Run the focused tests and confirm GREEN.

### Task 2: Authenticated HTTP discovery

**Files:**
- Modify: `apps/api/src/routes/expert-referral.ts`
- Modify: `apps/api/src/routes/expert-referral.test.ts`

**Interfaces:**
- Consumes: `ExpertResidencyService.listActiveTariffs(principal)`.
- Produces: authenticated `GET /v1/expert/residency/tariffs` under the existing
  `expertResidencyBilling` gate.

- [x] Write route tests for authenticated success, unauthenticated denial, forbidden,
  disabled, and absence of request-supplied financial authority.
- [x] Run the route test and confirm RED.
- [x] Add the minimal GET route using the existing principal resolver/result mapping.
- [x] Run the route test and confirm GREEN.

### Task 3: Private Telegram tariff list

**Files:**
- Modify: `packages/integrations/src/telegram/expert-command-processor.ts`
- Modify: `packages/integrations/src/telegram/expert-command-processor.test.ts`
- Modify: `packages/integrations/src/telegram/telegram-adapter.ts`
- Modify: `packages/integrations/src/telegram/telegram-adapter.test.ts`

**Interfaces:**
- Consumes: `ResidencyQueryService.listActiveTariffs(principal)`.
- Produces: `ExpertTelegramViewPort.sendResidencyTariffs(view)` and deterministic private
  `/residency` routing without changing `/residency <UUID>`.

- [x] Write processor and renderer tests for exact command, bounds, empty list,
  non-private denial, disabled financial views, and UUID quote compatibility.
- [x] Run the focused tests and confirm RED.
- [x] Implement the minimal view contract, bounded renderer/send method, and command branch.
- [x] Run the focused tests and confirm GREEN.

### Task 4: Traceability, verification, and review

**Files:**
- Create: `docs/spec/expert-residency-tariff-discovery.md`
- Modify only if required by existing scope guards: traceability/scope fixture files.

**Interfaces:**
- Links ER-TG-004-R1 through R6 to code, tests, gate, recovery, and owner.

- [x] Add truthful traceability without live-provider or release claims.
- [ ] Run relevant typecheck/lint and `git diff --check` once.
- [ ] Commit the exact candidate and run one final focused Claw gate.
- [ ] Record exact evidence, request independent review, fix every Critical/Important
  finding through a new RED/GREEN cycle, and leave the branch clean without push/merge.
