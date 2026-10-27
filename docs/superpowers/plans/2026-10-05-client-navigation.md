# Client Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. BMad assigns one writer; the owner already requested continuous implementation.

**Goal:** A client bot that provides catalogue/account/privacy navigation without processing personal dialogue.

**Architecture:** An authenticated navigation-only webhook writes a content-free terminal
receipt, then returns a fixed Telegram webhook reply. The same receipt fence
prevents old events crossing into later legacy modes.

**Tech Stack:** Node24, pnpm11.9.0, Fastify, PostgreSQL17.5, Vitest.

**Spec:** docs/superpowers/implementation-artifacts/spec-client-navigation.md

## Global Constraints

One writer; existing database only; no external test side effects, no body hash,
no profile or content storage, no provider/consent activation. Keep exact legacy
expert/payment semantics except rejection of already terminal navigation events.

## Review Focus

- Token/botKey rotation must not change the stable replay namespace.
- Duplicate command with substituted body must neither process nor resend.
- A receipt failure must not be acknowledged as success or call a downstream path.
- Forwarded, edited, group and mismatched identities must not send to another user.
- Lost response must not be misreported as Telegram delivery or retried implicitly.

### Task 1: Navigation contract and durable terminal receipt

**Files:** application/client-navigation-gateway.ts and test; DB replay repository,
barrels and tests/integration/client-navigation-replay.test.ts (full paths in spec).
**Interfaces:** Minimal botId/updateId receipt port; fixed navigation result without content.

- [x] Write/run meaningful application RED then implement exact bounded parsing,
      fixed replies and no-content receipt protocol.
- [x] Write/run PG RED, implement atomic terminal receipts and duplicate read.
- [x] Run focused GREEN and verify no raw input or digest appears in database.

### Task 2: Production composition and replay fence

**Files:** config/env, API app/server/telegram route, Hybrid gateway/repository
only for terminal replay guard, focused new tests and exact fixtures.
**Interfaces:** default-off navigation capability; real composed replay repository.

- [x] Write/run route/config/composition RED independently.
- [x] Add mutually exclusive config, auth-first navigation and shared replay check.
- [x] Run individual focused GREEN; assert real composition never calls legacy
      promo, persistence, identity, consent or AI in navigation mode.
- [x] Run relevant typechecks/lint/build, format and git diff --check.
- [x] Write operations/evidence, freeze writes, return for independent review.
      Main owns subsequent commit/push/release; full factory remains in progress.

### Task 3: Approved navigation-only client availability copy (2026-10-05)

**Authority:** Main's explicit CT-010/016 amendment, recorded in the navigation spec
before implementation. Owned files: `apps/web/src/content.ts`,
`apps/web/src/landing-view.ts`, and focused existing tests as needed.

- [x] RED: reject promises of immediate personal input, retained history, automatic
      booking/reminders or payment; retain positive public catalog/account coverage.
- [x] Correct only client availability copy; distinguish vision and planned prices
      from enabled functions. Keep amounts/financial terms, expert/legal content,
      design, `/account` CTA and separate expert promo configuration unchanged.
- [x] Focused GREEN, web typecheck/build, formatting/lint; record results and freeze.

## Execution ledger

- Baseline: `2429b306024618266586e4d8063add52ac9f25b1`; sole writer, authorized dirty
  navigation spec/plan; main's `spec-public-client-catalog.md` is untouched.
- Environment check with `-RequireDocker`: Node 24.21.0, pnpm 11.9.0, Docker/Compose,
  zero failures/warnings. No dependency installation.
- RED: navigation route returned 503 instead of 200; replay reached promo; unsafe
  IDs reached routing. Real logger tests also prove missing fixed client errors and
  authentication occurring after parsing. Installed Fastify JSON parser already
  uses a fixed error: no malformed-JSON content leak was reproduced.
- RED: application stub produced 44/48 failures; Hybrid replay fence 4/16 failures.
- Config GREEN: 26/26. PostgreSQL replay file run budget: 2/3 used, RED then GREEN
  (4/4). One run remains for main; no other PG file was run by this writer.
- Shared interface: Task 1's botId/updateId receipt and read port feeds Task 2's
  route/Hybrid fences; no content fields cross the port.
- Execution follows the supplied spec: no commit/push/deploy/full or multi-path
  suite. Main performs aggregate and independent review after writes freeze.
- Tasks 1–3 implemented and focused verified. Detailed command outcomes and
  remaining gates are in the spec. No claim of independent review or release.

## Verification command manifest

## Approved independent-review PATCH batch — 2026-10-05

Main supplied all three review layers and assigned the same sole writer. Triage
and severities are recorded in the spec: one high, four medium and two low PATCH
findings; optional telemetry, route-key strengthening and whole-request timeout
are rejected for this release. No intent re-derivation or unrelated changes.

- [x] RED custom-composition guard matrix; fix effective config/dependency ingress,
      token validation, exact bot ID and replay-reader requirements; explicit valid fixtures.
- [x] Cover documented sessions-off rollback and fresh route/Hybrid continuation;
      verify inverted replay guard cannot pass positive cases. No PG runs.
- [x] RED deployment/native-edge runner wiring, client support/login copy and
      first-contact warning; minimal fixes, preserve container image runner.
- [x] Update activation/rollback/runner documentation; changed-file GREEN,
      typecheck/lint/format/whitespace, record exact checks then freeze.

Patch verification: 173 tests in 9 single-file Vitest commands; 2 actual native
Nginx tests via `pnpm test:edge:native`; tests tsc, all five relevant package
typechecks, application build and scoped lint/format/whitespace. See spec for
exact test commands and RED/inverted-guard results. Existing legacy fixtures need
no edits beyond the explicit new custom-composition matrix in its focused file.
No PG run (2/3 budget still used), no full/multi-path Vitest, no full verify.
Main's approved activation list is message, edited_message, channel_post,
edited_channel_post, callback_query with exact sorted readback, pending updates
preserved and max_connections=2. No extra feature or operational write.

### Patch verification command manifest

Exact scoped formatter/linter commands follow; all listed paths are patch-owned.

```sh
pnpm exec eslint apps/api/src/app.ts apps/api/src/client-navigation-composition.test.ts apps/api/src/routes/client-navigation.test.ts packages/config/src/client-navigation-env.test.ts packages/application/src/client-navigation-gateway.ts packages/application/src/client-navigation-gateway.test.ts packages/application/src/hybrid-message-gateway.test.ts apps/web/src/content.ts apps/web/src/content.test.ts apps/web/src/landing-view.ts apps/web/src/landing-view.test.ts tests/repo/client-navigation-edge.test.ts
pnpm exec prettier --check apps/api/src/app.ts apps/api/src/client-navigation-composition.test.ts apps/api/src/routes/client-navigation.test.ts packages/config/src/client-navigation-env.test.ts packages/application/src/client-navigation-gateway.ts packages/application/src/client-navigation-gateway.test.ts packages/application/src/hybrid-message-gateway.test.ts apps/web/src/content.ts apps/web/src/content.test.ts apps/web/src/landing-view.ts apps/web/src/landing-view.test.ts tests/repo/client-navigation-edge.test.ts package.json docs/operations/client-navigation.md docs/superpowers/implementation-artifacts/spec-client-navigation.md docs/superpowers/plans/2026-10-05-client-navigation.md
git diff --check
```

### Initial implementation verification manifest

Exact owned file sets used for lint and formatter checks; no unrelated catalog
spec or user artifacts are included.

```sh
pnpm exec eslint apps/api/src/app.ts apps/api/src/routes/telegram-webhook.ts apps/api/src/server.test.ts apps/api/src/server.ts apps/web/src/content.test.ts apps/web/src/content.ts apps/web/src/landing-view.test.ts apps/web/src/landing-view.ts packages/application/src/hybrid-message-gateway.test.ts packages/application/src/hybrid-message-gateway.ts packages/application/src/index.ts packages/config/src/env.test.ts packages/config/src/env.ts packages/config/src/index.ts packages/db/src/index.ts packages/db/src/repositories/hybrid-message-repository.ts apps/api/src/client-navigation-composition.test.ts apps/api/src/routes/client-navigation.test.ts packages/application/src/client-navigation-gateway.ts packages/application/src/client-navigation-gateway.test.ts packages/db/src/repositories/client-ingress-replay-repository.ts packages/config/src/client-navigation-env.test.ts tests/integration/client-navigation-replay.test.ts tests/repo/client-navigation-edge.test.ts tests/container/client-navigation-edge.test.mjs
pnpm exec prettier --check apps/api/src/app.ts apps/api/src/routes/telegram-webhook.ts apps/api/src/server.test.ts apps/api/src/server.ts apps/web/src/content.test.ts apps/web/src/content.ts apps/web/src/landing-view.test.ts apps/web/src/landing-view.ts packages/application/src/hybrid-message-gateway.test.ts packages/application/src/hybrid-message-gateway.ts packages/application/src/index.ts packages/config/src/env.test.ts packages/config/src/env.ts packages/config/src/index.ts packages/db/src/index.ts packages/db/src/repositories/hybrid-message-repository.ts apps/api/src/client-navigation-composition.test.ts apps/api/src/routes/client-navigation.test.ts packages/application/src/client-navigation-gateway.ts packages/application/src/client-navigation-gateway.test.ts packages/db/src/repositories/client-ingress-replay-repository.ts packages/config/src/client-navigation-env.test.ts tests/integration/client-navigation-replay.test.ts tests/repo/client-navigation-edge.test.ts tests/container/client-navigation-edge.test.mjs docs/operations/client-navigation.md docs/superpowers/implementation-artifacts/spec-client-navigation.md docs/superpowers/plans/2026-10-05-client-navigation.md
```
