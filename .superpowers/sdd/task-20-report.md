# Task 20 report

## RED

- `pnpm exec vitest run apps/api/src/app.test.ts packages/observability/src/logger.test.ts`
- Failed as expected: `./app.js` and `./logger.js` did not exist (2 failed suites, no tests collected).

## GREEN

- `pnpm exec vitest run apps/api/src packages/observability/src tests/contract tests/e2e/api-boundary.test.ts tests/repo/workspace-dependencies.test.ts`
  - PASS: 8 files, 129 tests.
- `pnpm typecheck`
  - PASS: all 10 workspace projects.
- `pnpm --filter @ii-tonya/api build`
  - PASS: emitted `dist/server.js`, `dist/index.js`, and declarations.
- `pnpm lint`
  - PASS.
- `git diff --check`
  - PASS.

## Scope

- Hardened liveness/readiness, Selarti and Telegram ingress, raw-body 64 KB boundary, isolated unauthenticated/authenticated quotas, durable-inbox dependency seam, update/event deduplication, scoped Task 17 admin proxy.
- Pino redaction including Telegram bot URLs; OpenTelemetry tracing and low-cardinality operational instruments.
- Side-effect-free server import and lifecycle seam for migrations, readiness, signal shutdown, telemetry/database close.
- API manifest now publishes only built artifacts and a real `dist/server.js` entrypoint.
- All six live provider flags remain literal `false`; no provider transport, session, credential, or network activation was added.

## Residual risks

- Concrete deployment lifecycle (real sandbox credentials, migration runner, DB/telemetry close, and worker-lease probe) must be injected into `main`; the default executable fails closed until that reviewed environment composition exists.
- Rate-limit and inbox implementations are dependency-scoped. Production must bind a shared limiter and PostgreSQL-backed inbox; tests use in-memory fakes only.

## Commit

- `85a103e95922893371515a34ea833f87f9de45e9` — main Task 20 implementation.
- `aad712849fe17a3428716c0272dee6c604666785` — callback-before-inbox ordering and raw admin proxy fix.

## Reviewer fix-loop

- Replaced the non-runnable lifecycle placeholder with a default PostgreSQL composition: migrations precede app construction/readiness, Selarti and Telegram remain disabled, admin uses real PostgreSQL repositories, signals close Fastify, telemetry, then the database.
- Added bounded 60-second rate windows keyed by provider, auth class, and IP; tests prove isolation and recovery.
- Added Selarti replay-window rejection before provider quota and application dispatch. Selarti deduplication remains authoritative in `ConversationService` / its transactional message repository, avoiding a poisonable second claim.
- Added explicit Telegram expert-identity binding plus callback verification before the durable inbox claim.
- Added PostgreSQL `webhook_inbox` claim/complete/fail/lease state machine in migration 0017. Completion/failure require current unexpired claim ownership; failure permits retry.
- Added recursive telemetry sanitization for arbitrary nested provider payload, conversation, profile, contact, credential, body, URL and Telegram bot-token fields.
- RED evidence: previous tests would accept stale Selarti events, well-formed unbound Telegram IDs, monotonic rate exhaustion, shallow nested leakage, and poison retries; the shipped server also threw before composition.
- GREEN evidence: non-container Task 20 gate passes 11 files / 145 tests; workspace typecheck, API build, lint, and diff check pass. Local PostgreSQL suites could not start because no container runtime is installed; exact-SHA GitHub Database Gate is required after push.
- Final re-review: admin forwarding is POST-only (PUT/PATCH/DELETE return 404 and cannot be rewritten); listen/bind failure closes Fastify then telemetry/database lifecycle exactly once. Focused 14/14 and full non-container 147/147 pass.
