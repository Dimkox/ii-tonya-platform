# Client Terms and Test-Expert Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the clarified 30-day package term, deferred 45-day coupon policy, and default-off 100-message `тест эксперт` trial with deterministic Telegram qualification and a PostgreSQL-owned two-unit-per-AI-turn ledger.

**Architecture:** Add an additive trial bounded context beside existing billing, hybrid gateway, partner commerce, and B3 cost accounting. PostgreSQL owns campaign/redemption/reservation/outcome state; deterministic application services own warmup, segmentation, and tariff lookup; Selarti remains a bounded residual-dialogue adapter behind existing provider gates.

**Tech Stack:** TypeScript, pnpm, Fastify, Drizzle/PostgreSQL, existing Telegram/hybrid gateway and Selarti ports, Vitest, disposable PostgreSQL 17.5.

**Spec:** `docs/superpowers/specs/2026-08-30-client-terms-and-test-expert-trial-design.md`

## Global Constraints

- Paid/admin message packages expire exactly 30 calendar days; intro is exactly 100 messages with no expiry; existing rows are immutable historical facts.
- New coupon grants expire exactly 45 days only after the deferred default-off coupon subsystem is activated; do not claim active issuance.
- `тест эксперт` has 100 visible-message units; each AI turn reserves 2, deterministic messages reserve 0, and V1 has one provider call plus at most one answer.
- PostgreSQL owns `consumed_units + reserved_units <= 100`; coupons, expert credits, partner counts, and B3 reservations remain separate.
- All new provider and campaign capabilities are default-off; no `.env`, secrets, external providers, staging, production, deploy, merge, or analytics/static-script removal.
- Use TDD; run focused Vitest/typecheck commands per task and the full suite no more than once for the entire increment.

## File Map

- `packages/db/migrations/0038_test_expert_trial.sql`: additive authoritative schema and functions.
- `packages/db/src/schema/test-expert-trial.ts`: Drizzle mirror and exported table types.
- `packages/db/src/repositories/test-expert-trial-repository.ts`: transactional Memory/Postgres repository parity.
- `packages/application/src/test-expert-warmup.ts`: finite typed warmup state machine.
- `packages/application/src/test-expert-segmentation.ts`: deterministic participant qualification.
- `packages/application/src/test-expert-trial-service.ts`: campaign/redemption/reservation boundary and provider outcome transitions.
- `apps/api/src/routes/telegram-webhook.ts`: authenticated default-off Telegram composition boundary; no public body-supplied Telegram identity route exists.
- `packages/config/src/env.ts` and related config tests: safe-off flags and prompt-version parsing.
- `apps/web/src/content.ts`, `apps/web/src/legal/oferta.txt`, and matching web tests: truthful 30/45-day public copy without active-coupon claims.
- `docs/source/ii-tonya-expert-full-source-2026-07-28.txt` (read-only) plus an inactive manifest under `docs/prompts/`: prompt traceability, no source rewrite.
- `README.md`: current status, boundaries, flags, migration, and preserved analytics note.

### Task 1: Terms and public copy

**Files:** Modify `packages/db/src/repositories/admin-repository.ts`; tests `tests/integration/admin-ledger.test.ts`, `packages/db/src/repositories/admin-approval-repository.test.ts`, `tests/e2e/support/mvp-harness.ts`; modify `apps/web/src/content.ts`, `apps/web/src/legal/oferta.txt`, `apps/web/src/landing-view.test.ts`, `apps/web/src/legal-content.test.ts`; add/amend V2 traceability link.

**Interfaces:** Keep `free_client_v2` and intro semantics unchanged. Newly issued approved/admin grants calculate `expires_at = db_now + interval '30 days'`; coupon text says 45 days but clearly remains deferred/default-off.

- [ ] Write boundary tests for package validity at `<30 days` and `>=30 days`, intro no-expiry, historical row preservation, and truthful public copy.
- [ ] Run `pnpm vitest run tests/integration/admin-ledger.test.ts packages/db/src/repositories/admin-approval-repository.test.ts apps/web/src/landing-view.test.ts apps/web/src/legal-content.test.ts`; confirm RED on old 60/90-day assertions.
- [ ] Change only new-grant duration and public/legal/spec wording; preserve analytics in `apps/web/index.html`.
- [ ] Rerun the focused command and `pnpm typecheck`; expect PASS.
- [ ] Record the term decision in `decisions.md` and run `git diff --check`.

### Task 2: Trial ledger schema and repository

**Files:** Create migration/schema/repository files above; modify DB exports and migration parity tests; create `packages/db/src/repositories/test-expert-trial-repository.test.ts` and extend `tests/integration/schema.test.ts`/PostgreSQL integration fixtures.

**Interfaces:** Define `TrialReservation`, `TrialOutcome`, and repository methods:

```ts
reserveAiTurn(input: { redemptionId: string; requestKey: string; now: Date }): Promise<TrialReservationResult>;
recordOutcome(input: { reservationId: string; outcome: "applied" | "not_applied" | "unknown"; now: Date }): Promise<TrialOutcome>;
reconcileUnknown(input: { reservationId: string; providerRequestId: string; outcome: "applied" | "not_applied"; now: Date }): Promise<TrialOutcome>;
```

- [x] Write RED tests for idempotent redemption, 49-turn/50-turn boundaries, concurrency single-winner, unknown retention, definite release, and cross-ledger separation. RED: module import failed before repository implementation.
- [x] Run `corepack pnpm vitest run packages/db/src/repositories/test-expert-trial-repository.test.ts`; RED captured with the missing repository module.
- [x] Implement additive `0038_test_expert_trial.sql`, Drizzle mirror, and Memory/Postgres parity with database-owned counters and locked redemption updates.
- [x] Add unique request keys, typed outcomes, foreign keys, check constraints, and bounded indexes; reject fan-out.
- [x] Run focused repository/schema tests plus `corepack pnpm --filter @ii-tonya/db typecheck`; GREEN: 7 tests passed and DB typecheck passed.

### Task 3: Deterministic application boundary

**Files:** Create `packages/application/src/test-expert-warmup.ts`, `test-expert-segmentation.ts`, and `test-expert-trial-service.ts`; modify application exports and add focused tests.

**Interfaces:** `WarmupStateMachine.next(input): WarmupResult`, `segmentParticipant(input): ParticipantSegment`, and `TestExpertTrialService.handle(input): TrialRouteResult`. The service must call `reserveAiTurn` only for one residual provider request and must pass pricing requests to existing expert/partner policy services.

- [x] Write RED tests for deterministic zero-unit warmup, incomplete qualification, expert/center/organizer segmentation, authoritative quote sourcing, and fail-closed policy absence.
- [x] Run `corepack pnpm vitest run packages/application/src/test-expert-trial-service.test.ts`; RED captured before implementation with the missing application modules.
- [x] Implement finite state transitions and typed results; no LLM prompt decides state, price, or participant kind.
- [x] Add applied/not-applied/unknown transitions and duplicate replay behavior through the repository interface.
- [x] Run focused tests and `corepack pnpm --filter @ii-tonya/application typecheck`; GREEN: 15 tests passed and application typecheck passed.

### Task 4: Default-off API and Telegram composition

**Files:** Modify `apps/api/src/routes/telegram-webhook.ts`, `apps/api/src/server.ts`, `apps/api/src/app.ts`, config env parsing, and API/config tests.

**Interfaces:** The existing secret-authenticated Telegram webhook derives identity from the Telegram update and delegates to the typed trial ingress; it returns stable `disabled`, `invalid_request`, `limit_reached`, `unavailable`, or bounded success outcomes. Provider dispatch is injected and never constructed when flags are off.

- [x] Write RED tests for all flags default-off, deterministic commands bypassing Selarti, identity mismatch, disabled campaign/prompt, one provider call, and stable duplicate responses. RED captured before implementation: route/module capability absent.
- [x] Run focused API/config tests and confirm RED.
- [x] Implement the authenticated Telegram webhook composition with strict input validation, pre-reservation rate limiting, no raw text logging/storage, and fail-closed provider admission; remove the superseded public body-identity route.
- [x] Test default-off config and injected route capability; provider construction remains absent from default lifecycle.
- [x] Run focused tests, Prettier, and package typechecks; GREEN: 22 tests passed; `@ii-tonya/application`, `@ii-tonya/config`, and `@ii-tonya/api` typechecks passed; `git diff --check` passed.

### Task 5: Prompt asset, traceability, README, and observability

**Files:** Create inactive prompt manifest under `docs/prompts/`; modify `README.md`, `decisions.md`, `packages/application/src` telemetry tests, and relevant route traceability docs; preserve `apps/web/index.html` scripts.

**Interfaces:** Manifest fields are `key`, `version`, `sha256`, `sourcePath`, `status: "inactive"`, and `activationRequirements`. Runtime code may read metadata only; it cannot activate the asset.

- [x] Write RED traceability tests for source digest, inactive status, four flags, migration 0038, metric names, and analytics preservation.
- [x] Run `corepack pnpm vitest run tests/repo/test-expert-trial-traceability.test.ts`; RED captured before implementation because the metric module was absent.
- [x] Add the immutable manifest, README current-state section, rollout/rollback notes, metrics, privacy retention, and explicit provider contract gate.
- [x] Run focused tests, Prettier, package typechecks, `git diff --check`, and verify no analytics/static script changed; GREEN: 2 tests passed.

### Task 6: PostgreSQL verification and independent review preparation

**Files:** Extend `tests/integration/test-expert-trial-postgres.test.ts`, migration tests, and evidence under `docs/test-evidence/`; do not modify production or provider configuration.

**Interfaces:** Use the same repository methods from Task 2 against disposable PostgreSQL 17.5; use bounded test fixtures and no production credentials.

- [x] Write focused PostgreSQL integration tests for 0037→0038 upgrade, FK enforcement, concurrent reservations, unknown reconciliation, and `EXPLAIN` on the locked redemption path; restart durability and role denial remain explicitly unclaimed where the bounded testkit has no safe fixture.
- [x] Run `corepack pnpm vitest run tests/integration/test-expert-trial-postgres.test.ts` once against disposable PostgreSQL 17.5: 3/3 passed; exact deferred evidence is in `docs/test-evidence/task6-test-expert-trial-postgres.md`.
- [x] Run the full `corepack pnpm verify` exactly once at branch finish after focused tasks are green: attempted once and exited 2 at typecheck. Follow-up identified both newly introduced trial-test typing regressions and pre-existing partner-pricing test typing errors; all were repaired with focused typechecks, while full verify was deliberately not rerun.
- [x] Run `git diff --check`, bounded static secret scan, and review preparation against the final tree; no production/provider actions performed.
- [ ] Update README status and package `VERSION` only to reflect verified repository state; not changed because full verification is red and activation/release evidence remains closed.

### Independent-review remediation

- [x] Replace the public body-supplied identity route with the existing webhook-secret-authenticated Telegram ingress and immutable identity resolution from the Telegram update; rate-limit before repository reservation.
- [x] Separate deterministic admission from residual Selarti admission: promo plus deterministic flags enable zero-unit behavior, while campaign, approved prompt metadata, provider capability, and existing B2/B3 gates are all required for residual AI.
- [x] Compose the PostgreSQL trial repository, campaign/redemption lookup, trial service, and authoritative expert/partner pricing adapters; add migration `0039_test_expert_trial_hardening.sql` for provider-operation, active-version, and unknown-scan invariants.
- [x] Cover same-key PostgreSQL races, provider request identity, immutable audit outcomes, durable duplicate replay, injected transition metrics, and ephemeral raw-text privacy with focused tests.
- [x] Repair the three partner-pricing test type errors without changing pricing behavior; package and test-project typechecks pass after remediation.
- [x] Keep activation closed: disposable PostgreSQL restart durability and restricted-role denial fixtures remain unproved, and the full verification command remains historically failed and was not rerun.

## Self-review checklist

- Spec coverage: rules 1–2 are Task 1; rules 3–4 are Tasks 2–4; rule 5 is Tasks 3–4; rule 6 is Task 5; rule 7 is Tasks 1, 4, 5, and 6; rollout/privacy/metrics/concurrency are Tasks 2, 4, 5, and 6.
- Placeholder scan: this plan contains no `TBD`, `TODO`, “implement later”, unspecified error-handling instruction, or undefined interface name.
- Type consistency: Task 2 defines the repository methods consumed by Task 3; Task 4 consumes `TestExpertTrialService.handle`; Task 5’s manifest is metadata-only and cannot activate runtime behavior.
- Explicit non-goals: no production code is changed in this Phase 0 commit; no coupon issuance is activated; no Selarti/network/provider call is made; no analytics/static script is removed.
