# Content-Free Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. One repository writer; owner already requested autonomous execution of the approved parent specification.

**Goal:** Personal content and linkable identifiers do not enter operational logs, traces or metric labels.
**Architecture:** Closed projections at logger and all child/binding entry points; explicit fixed HTTP diagnostics; fixed tracing operations and runtime-validated metric labels. Business and financial audit authority remains unchanged.
**Tech Stack:** Existing Pino, OpenTelemetry API, Fastify, Vitest; Node24/pnpm11.9.0.
**Spec:** docs/superpowers/implementation-artifacts/spec-content-free-telemetry.md

## Global Constraints

No dependency, lockfile, schema, financial audit or provider changes. No commit/push/deploy by implementer.
Preserve navigation replay protection and existing status/auth/body-limit contracts.
Individual focused Vitest file commands only: aggregate budget already used. No PostgreSQL or repeated multi-path suites.
Unknown trace names map to literal `operation` and must not stop the business callback.

## Review Focus

- Pino nested children/options and setBindings bypass the root formatter: actual emitted nested output must be tested in Task1.
- Getters/toJSON/toString on unknown arguments must not execute: throwing canaries in Task1 and Task2.
- Encapsulated client-session/booking oversize400 must remain400 while other routes413: composed tests in Task2.
- A no-op tracer cannot prove span safety: recording provider installed before tracing import in Task2.
- A raw metric instrument must not bypass validated wrapper labels: direct-instrument recording tests in Task2.

## Task 1: Closed logger boundary

**Files:** Modify `packages/observability/src/logger.ts`, its focused test(s), and outdated leakage expectation in `apps/api/src/client-principal-review-remediation.test.ts`.
**Interfaces:** Preserve `createLogger(destination?: NodeJS.WritableStream): Logger` and Pino Logger compatibility; exported `sanitizeTelemetry(value: unknown): unknown` becomes a closed safe projection. Public URL-redaction helper, if retained, returns fixed redaction rather than arbitrary prose.

- [x] Add emitted-output test `drops_plaintext_and_dynamic_keys_but_keeps_closed_events`: absence of ordinary canary, Error name/message/stack/cause, interpolation strings, correlation hashes; presence of allowed public_catalog_failure and its six reason codes.
- [x] Run the one logger file with `pnpm exec vitest run packages/observability/src/logger.test.ts`; confirm expected leak failure, not setup error.
- [x] Implement finite event fields, bounded numbers and fixed fallback event. Read only own data descriptors; never evaluate unknown object methods. Wrap child/setBindings so options cannot restore serializers/formatters.
- [x] Add nested-child/bindings/throwing-getter/toJSON and level/silent tests, then focused GREEN. Preserve useful finite startup/fatal/transport diagnostics.
- [x] Replace only obsolete tests requiring prose/correlations; do not weaken denial assertions.

## Task 2: HTTP, fatal, traces and metric call sites

**Files:** `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/selarti-webhook.ts`, `apps/worker/src/main.ts` (fatal only), `packages/integrations/src/telegram/telegram-adapter.ts` (logFailure only); `packages/observability/src/{tracing,fatal-logging,metrics}.ts` and focused tests; `tests/security/client-consent-leakage.test.ts`.
**Interfaces:** `traced<T>(name: string, operation: () => Promise<T>): Promise<T>` runs callback without exposing raw span, maps unknown name to operation and rethrows the original error. Existing metrics/recording functions retain their valid caller contracts and reject unsafe labels. Existing fatal installer retains process listener/uninstall/exit contract without String(reason).

- [x] Add actual composed Fastify output/response canaries for unknown URL/query, oversized bodies, unauthorized navigation, service error and Selarti correlation. Run leakage file RED.
- [x] Disable automatic Fastify request logs; explicit fixed not-found/error/completion diagnostics at root before registration, preserving plugin semantics and auth. Remove Selarti identifiers from telemetry, not business commands.
- [x] Add real recording tracer before module import. Assert allowed/fallback names, fixed status, span end, no events/prose and same error identity; run tracing file RED then implement restricted traced and GREEN.
- [x] Add fake process fatal tests with throwing coercion canaries; retain exit1 and document flush limits. Run file RED then implement and GREEN.
- [x] Add recording meter tests for arbitrary direct raw instrument labels and unknown reconciliation name; valid existing metrics/counts remain. Run file RED then implement schema guards and GREEN.
- [x] Run the leakage file and each affected existing regression file separately; build dependencies before importer tests. No full/multi-path/PG run.

## Task 3: Verify and handoff

**Files:** `docs/operations/content-free-telemetry.md`, spec and this plan.
**Interfaces:** Written schema/evidence contract; no exporter is activated or claimed.

- [x] Relevant package builds/typechecks, tests typecheck, scoped lint/format and `git diff --check` PASS; record exact commands, failures and evidence limitations.
- [x] Document fixed schema and loss of free-text diagnostic detail, fatal flushing behavior, synthetic recording versus live-exporter evidence.
- [x] Mark verified tasks and status in-review, add relative Suggested Review Order, then freeze every repository write.
- [x] Report owned changed paths, verification totals and residual risks to main. Main performs independent review, RC push and deployment; do not mark external exact-SHA gates satisfied by local tests.

## Execution ledger

- Baseline: `098b46a5c76a19003453d75475b6b86c88d84f9c`, existing `codex/fin-001-client-access-policy`; canonical remote verified. All frontmatter context loaded. Environment check passed (Node 24.21.0, pnpm 11.9.0).
- Pre-flight: Task 1 supplies the Pino-compatible logger consumed by Task 2 root HTTP composition, fatal handlers and transport diagnostics; no interface conflict. Task 3 documents both boundaries.
- Ruling: this spec's handoff overrides generic skill commit/worktree/full-suite/review steps. Keep this plan as the ledger within the owned file set; single-file commands only, no commit, and hand off frozen writes for main's independent review. Cost: no full-suite or independent-review claim here.
- Task 1 RED: `pnpm exec vitest run packages/observability/src/logger.test.ts` — 4 failed, 1 passed; real plaintext and nested binding leaks plus invoked accessor reproduced. GREEN: same command — 5 passed. Added `telemetry-schema.ts` as the permitted small helper for closed schemas and safe own-data reads.
- Task 2 HTTP: first leakage run failed on fixture preflight (booking requires worker delivery); corrected the fixture to separate booking and navigation modes. Meaningful RED then showed 4 failures/1 pass: URL echo, missing fixed diagnostics and service-error response prose. GREEN 5/5; added malformed-URL/validation case then observed RED 1/6, GREEN 6/6 after the root framework-error handler. Malformed JSON was already safe and is regression evidence only. Replaced deprecated Fastify option with `LogController` after its deprecation warning.
- Task 2 RED→GREEN: tracing 4 failures → 4 passes with real recording SDK provider; fatal 3 failures/1 pass → 4 passes; metric instrument boundary 2 failures → 2 passes with real recording SDK meter; transport 6 failures → 6 passes. Rate-limit calls now invoke only `logFailure`; send/retry/authority semantics are unchanged.
- Ruling: minimally update `tests/contract/telegram-port.test.ts` (additional focused regression file) because three obsolete expectations required a URL in telemetry. The observed run was 17 passed/3 failed. Replace only logging assertions with exact provider/operation/outcome records; preserve all transport outcome, idempotency and credential-denial assertions. Cost: one test-file scope extension, no business behavior extension.
- Initial observability declaration build failed on Pino's generic child signature; tests typecheck also found one hostile-options fixture type and missing `chargedMessages: 0`. API declaration build then caught Fastify's generic framework reply type; an explicit `FastifyReply` annotation resolved it. Four unused fixture/helper arguments failed initial scoped lint and were corrected. Final builds/typechecks/lint passed; no engine or dependency changes.
- Final author review (no subagent tool): found nested children inherited the parent's wrapped methods. New logger test RED (1 failed/17 passed) demonstrated broken inherited silent and isolated bindings. Passing original Pino methods through the wrapper with the current receiver fixed the cause. Final logger GREEN 18/18; composed HTTP GREEN 6/6 afterward. Bounded count test also ran RED→GREEN (1 failed/16 passed → 17 passed before that final inheritance test).
- Task 3: final evidence = 291 passing tests in 22 individual focused files, plus relevant builds/typechecks, tests typecheck and lint. Initial format check flagged only the supplied spec's formatting; normalized it. Exact commands and failures are recorded in `docs/operations/content-free-telemetry.md`. All three implementation tasks are complete; status is in-review, and repository writes are frozen at handoff. Main retains independent adversarial review and exact-SHA release/deploy gates. No deferred code findings remain from the author pass.

## Independent review patch ledger

- Main returned all three independent review layers, completed triage, and
  authorized this implementer as the sole writer again. Accepted findings 1–11
  are recorded individually in [operations](../../operations/content-free-telemetry.md#accepted-independent-review-findings).
  No expanded startup vocabulary, arbitrary telemetry, dependencies or provider work.
- HTTP RED 12/25: real composed onSend leaked plaintext through Fastify's parent
  fallback, with and without logger failure; status401/429/status422, precedence,
  Retry-After and framework500 also failed. Terminal root response plus own-data
  protocol projection fixed them. Error/completion hooks, trusted headers, local
  body-limit contracts and denied business entry remain. Extra HEAD regression
  caught raw body emission and was fixed. A navigation fixture incorrectly expected
  root401 instead of the existing local503 on send failure; that expectation was
  corrected without changing the local handler. Final HTTP27/27.
- Telegram RED 2/9 confirmed logger exceptions replaced send/callback429 results;
  containing exceptions in logFailure gives9/9, including real callback logger output.
- Tracing RED 1/6 then2/7 confirmed inherited context and exported tracestate.
  Rebuilt ROOT context preserves only validated trace/span protocol metadata and
  exposes a non-recording callback context. Real nested recording, invalid IDs,
  accessor safety, exact result/error, creation/recording/end failure controls:12/12.
- Added explicitly requested real executable bootstrap tests in
  `apps/api/src/telemetry-bootstrap.test.ts`: API and worker both log fixed startup
  failure and exit1 with invalid config before DB/provider access. First API run
  found stale compiled observability exports; dependency rebuild corrected setup.
  Actual catch tests2/2; startup call sites themselves needed no further code edits.
- Composed silent-route control passed before patch and remains green. Independent
  finite child context is now documented as distinct from event payload fields;
  positive output control added, logger20/20. No existing positive control removed.
- Patch verification: **282 passing tests in16 separately invoked files**;
  observability/integrations/API/worker builds and typechecks, tests tsc, scoped
  lint/format and diff checks pass. Initial header-map/async-router fixture typing
  errors were corrected. Exact commands and counts are in the
  [patch evidence](../../operations/content-free-telemetry.md#review-patch-verification-on-2026-10-05).
- Status remains **in-review**. Freeze every repository write at handoff; main owns
  patch review, exact-SHA release checks, push and deploy. No accepted finding left
  deferred, no full/multi-path/PG/commit/push/deploy performed. Terminal root errors
  intentionally skip serialization/onSend re-entry; sink delivery remains best
  effort and recording SDK tests are not live-exporter evidence.

## Patch-closure correction: implicit HTTP status

- Main identified one remaining precedence regression; other accepted findings
  have no unresolved issue. Existing tests always selected a reply code and missed
  the distinction between implicit200 and explicit200.
- Receiving-code-review/systematic-debugging/TDD: inspect installed Fastify's
  setErrorHeaders then setErrorStatusCode; add differential sync/async throws with
  own status422/statusCode503 against unmodified Fastify. RED command
  `pnpm exec vitest run apps/api/src/app.test.ts -t 'error status differential'`:
  2 failed/4 passed/30 filtered out. Native implicit200=503, explicit200=422,
  explicit429=422; the implementation incorrectly returned422 for implicit200.
- Narrow fix: read Fastify's own status-set boolean descriptor in app composition,
  pass it to httpErrorStatus, and choose code-first only for the implicit branch.
  Numeric validation and safe own-data reads remain; terminal response, headers,
  error hooks, tracing and Telegram behavior are not rewritten. The private
  Fastify symbol dependency is pinned behaviorally by the differential test.
- GREEN: app36, leakage27, logger20, executable bootstrap2 (**85 in four individual
  files**); observability/API builds and typechecks, tests tsc, scoped lint/format
  and diff pass. [Exact commands and results](../../operations/content-free-telemetry.md#patch-closure-status-precedence-correction).
- Seven-file delta only: app implementation/test, schema helper/logger test, and
  existing spec/plan/operations. Retain in-review and freeze all writes again.
  No full/multipath/PG, dependency, commit/push/deploy. Main owns closure review and
  release gates; rerun the differential when upgrading Fastify.
