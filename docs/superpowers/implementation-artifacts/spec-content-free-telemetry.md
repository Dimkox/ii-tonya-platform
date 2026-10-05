---
title: Content-free client telemetry boundary
type: bugfix
status: in-review
created: 2026-10-05
baseline_commit: 098b46a5c76a19003453d75475b6b86c88d84f9c
context:
  - AGENTS.md
  - docs/superpowers/implementation-artifacts/spec-client-sensitive-consent.md
  - docs/superpowers/plans/2026-10-05-content-free-telemetry.md
---

## Intent

Implement CT-015's actual content-free boundary. Current regex-based logger preserves arbitrary plaintext, error prose/stack/type and child bindings; Fastify defaults echo unknown URL paths; tracing records raw exceptions. No consent may enable content logging. The existing Fastify5.12.5 JSON parser ALREADY replaces malformed JSON error text with a fixed code: do not invent a regression there.

## Boundaries and ownership

One repository writer. No providers, production operations, new dependencies or schema. Do not redact or change SQL audit facts, idempotency/reconciliation keys, business commands, consent proofs or financial records: those are NOT operational telemetry.
Own packages/observability/src/logger.ts, tracing.ts, fatal-logging.ts, metrics.ts, their focused tests and index.ts only for exports; apps/api/src/app.ts root composition, server.ts startup reporting, routes/selarti-webhook.ts telemetry only; apps/worker/src/main.ts fatal logging only; packages/integrations/src/telegram/telegram-adapter.ts logFailure only; apps/api/src/client-principal-review-remediation.test.ts old logging expectation; relevant focused app tests; new tests/security/client-consent-leakage.test.ts; docs/operations/content-free-telemetry.md and this spec/plan.
Preserve the already implemented navigation gateway and replay receipts.

## Contract

Log output uses a finite explicit schema, not recursive redaction. Keep enumerated event/module/operation/outcome/reason values and bounded finite status/count/duration fields. Unknown calls emit a fixed fallback diagnostic with no submitted strings/keys. Drop arbitrary msg/interpolation arguments, errors and their message/stack/name/cause, raw URLs/headers/bodies/buffers, caller correlations, identifiers/hashes and dynamic keys. Do not call arbitrary getters/toString/toJSON while sanitizing untrusted objects.
Root and nested child loggers and setBindings must obey the same boundary. Installed Pino resets child binding formatters; an options.formatters.bindings-only fix is insufficient. Preserve Logger interface required by Fastify and legitimate level/silent configuration; do not allow a child option to reinstall unsafe serializers/formatters.

Maintain useful positive diagnostics: public_catalog_failure and its six closed reasons; fixed fatal kind, startup failure class, HTTP method/status/duration, transport provider/operation and before-write/after-write/unknown/rate-limit outcome classes. Known machine codes map to explicit classes; unknown error => internal_error. No dynamic error prose. Levels/timestamp supplied by logger are permitted.

Disable automatic Fastify request logging, add explicit fixed error/not-found handling and completion events at root before route registration. Preserve existing status contracts and plugin encapsulation (client-session/booking oversized bodies intentionally400, other routes413), auth/body limits/raw bytes and CSRF/session semantics. Never echo unknown route/query/validation fields. Selarti service still receives its existing correlation/idempotency values but logging no longer includes them or eventIdHash.

traced uses runtime-validated fixed operation names (current production caller selarti.inbound); unknown names fall back to the literal `operation` without preventing the business callback. Remove unused raw Span callback access. Record only bounded status/approved failure class, not exceptions/status descriptions or provider values. Always end real spans and rethrow original operation errors; do not replace business failure identity with logging failure. Fatal handlers do not stringify arbitrary rejection values and retain exit behavior. Ensure destination flush/exit behavior is documented honestly.

Keep aggregate operational metrics with existing closed label validators. Add runtime validation for test-expert reconciliation event names (current only TypeScript). Guard exported raw instrument entry points against arbitrary labels while preserving legitimate existing metrics and numbers; no personal hashes as labels. Do not introduce an analytics exporter or claim live APM proof.

## Tasks & Acceptance

- [x] Meaningful RED against real current logger: ordinary plaintext canary under msg, detail, dynamic key, Error name/stack/cause, correlation and nested child/setBindings appears; desired absence fails.
- [x] GREEN for all paths, paired with positive enumerated diagnostics so dropping every log cannot pass.
- [x] Real composed Fastify tests: unknown path/query, malformed/oversized bodies, unauthenticated navigation, injected service exception/correlation cannot reach logs or response; preserve status/auth/retry behavior.
- [x] A recording OpenTelemetry provider installed before import MUST observe actual spans, end and fixed status; no-op tracer is not evidence. Unknown trace names map to fixed `operation` while still executing the callback; arbitrary attributes are unavailable; original exception rethrown.
- [x] Fake fatal process/exit tests no real crashes; unknown stringify/toJSON/getter canaries never invoked.
- [x] Existing financial audit paths untouched; worker/transport finite outcomes preserved.
- [x] Individual focused file commands only. The one aggregate run for this overall task is already used (interrupted exit130), so do not run a full or multi-path Vitest command. No PG needed here: navigation replay and catalogue-worker PG each exhausted3/3 runs. No test:repeat. Relevant builds and typechecks remain allowed.
- [x] Relevant builds/typechecks/lint/format/diff; record exact commands and failures, status in-review and relative Suggested Review Order, freeze ALL repository writes for independent review.

## Results

Main closure: all three independent layers returned; eleven accepted findings and
the subsequent implicit-status precedence regression were patched. Independent
bounded closure review passed, including source/compiled Fastify symbol resolution.
Main freshly observed logger20, tracing12, HTTP leakage27, real bootstrap2 and
API36 passing in separate commands, plus four package typechecks and tests tsc.
Status remains in-review because local evidence is not exact-SHA Trust CI or the
external release gates. Production publication remains a separately authorized RC.

Initial implementation: **291 passing tests across 22 separately invoked focused files**.
Observability, integrations, API and app-worker builds and typechecks passed; tests
typecheck, scoped lint, formatting and whitespace checks passed. Exact commands,
initial failures and evidence limits are in the [operations record](../../operations/content-free-telemetry.md)
and [execution ledger](../plans/2026-10-05-content-free-telemetry.md#execution-ledger).

Added the permitted helper `packages/observability/src/telemetry-schema.ts` for
closed schemas, safe own-data reads and fixed failure classes. Also updated the
three obsolete URL assertions in `tests/contract/telegram-port.test.ts`; this is
an additional test-file ownership extension. The review patch also adds the
explicitly requested executable test `apps/api/src/telemetry-bootstrap.test.ts`.
Telegram's 429 branches only
add calls to `logFailure`; business outcomes and keys are unchanged.

The author previously fixed a reproduced Pino child inheritance defect. Main then
completed all three independent review layers and authorized the scoped patch
below. **Repository writes are frozen again for main's patch review.** Status stays
`in-review`, not release-approved. No commit/push/deploy, aggregate/full suite, PostgreSQL run, provider call,
schema/dependency change or activation was performed. Main owns exact-SHA release
evidence and deployment. No production exporter/support-copy coverage is claimed
from synthetic tests. Fatal sink delivery remains best effort, as documented.

## Accepted review patch

All eleven accepted findings are addressed with focused regressions; the exact
triage and results are in [operations](../../operations/content-free-telemetry.md#accepted-independent-review-findings)
and the [patch ledger](../plans/2026-10-05-content-free-telemetry.md#independent-review-patch-ledger).

- HTTP: retain valid own status/statusCode and preselected reply status with
  Fastify precedence; validate only bounded Retry-After delta-seconds; distinguish
  framework4xx/5xx. Real onSend plaintext leakage was reproduced first, then fixed
  with a terminal root response, best-effort diagnostics, preserved protocol
  headers/error hooks/local body-limit/auth behavior and correct HEAD framing.
- Telegram: logger errors no longer replace send/callback retryable results;
  real callback429 emitted-output control added alongside the send control.
- Tracing: exported tracestate canary reproduced with a recording provider;
  sanitized ROOT context retains validated W3C trace/span IDs and nested operation
  relationships through a non-recording callback context, not a mutable raw Span.
  Creation failure invokes work exactly once; original results/errors and existing
  recording/end failure controls remain.
- Actual API/worker executable startup catches verified without DB/provider or
  fatal crash. Actual composed silent routes and independent finite child bindings
  have positive controls; documentation now separates context from event payloads.

First review-patch evidence: **282 passing tests in16 individual files**, relevant four
package builds/typechecks, tests tsc, scoped lint/format and diff checks.
[Exact commands and intermediate failures](../../operations/content-free-telemetry.md#review-patch-verification-on-2026-10-05)
are preserved. No accepted finding is deferred. Main retains patch review and
exact-SHA release/deploy gates; fatal delivery is best effort and recording tests
do not prove live APM coverage. Root terminal errors intentionally do not re-enter
serialization/onSend, while normal response hooks and local handlers are retained.

### Patch-closure correction

Main found one additional real precedence regression: prior tests always called
reply.code. For an error with own status422/statusCode503, installed Fastify returns
503 for implicit200 but422 for explicit reply.code(200) or reply.code(429).
Differential sync/async tests first failed on both implicit cases. Composition now
reads Fastify's own status-set boolean descriptor and the existing helper preserves
the two-stage precedence using only validated own numeric error data. The terminal
handler is otherwise unchanged; no prose/getter/coercion path is added.

Additional GREEN: app36, leakage27, logger20, bootstrap2 (**85 tests, four individual
files**), observability/API builds/typechecks, tests tsc, scoped lint/format/diff.
[Exact RED, commands, touched files and compatibility risk](../../operations/content-free-telemetry.md#patch-closure-status-precedence-correction)
are recorded. Other accepted findings remain closed locally. Status stays in-review;
all writes frozen again for main. The private Fastify marker requires the differential
regression to run on framework upgrades. No full/multipath/PG/commit/push/deploy.

## Execution handoff

Implement in this existing isolated codex branch; do not create a new worktree, commit, push, deploy or spawn another implementer. Main owns remote operations and final review. Use TDD; read the execution and TDD skills before implementation. One repository writer, no concurrent edits by main. No story_key is present, so sprint sync is not applicable. Agent may add a small helper module inside the owned observability directory only when needed to keep the closed schema readable; report any such file explicitly.

## Suggested Review Order

1. [Closed schema helper](../../../packages/observability/src/telemetry-schema.ts#L37),
   [logger](../../../packages/observability/src/logger.ts#L1) and
   [emitted-output tests](../../../packages/observability/src/logger.test.ts#L28):
   field allowlists, native Pino child method receivers, isolated setBindings,
   inherited silent level and hostile options/accessors.
2. [Status-set marker](../../../apps/api/src/app.ts#L85),
   [installed-Fastify differential](../../../apps/api/src/app.test.ts#L87),
   [terminal HTTP response](../../../apps/api/src/app.ts#L190),
   [root composition](../../../apps/api/src/app.ts#L354),
   [Selarti telemetry](../../../apps/api/src/routes/selarti-webhook.ts#L1) and
   [composed leakage tests](../../../tests/security/client-consent-leakage.test.ts#L206):
   precedence, Retry-After, real onSend fallback, HEAD, local controls and silent routes.
3. [Sanitized tracing context](../../../packages/observability/src/tracing.ts#L32),
   [recording-provider tests](../../../packages/observability/src/tracing.test.ts#L30),
   [fatal handlers](../../../packages/observability/src/fatal-logging.ts#L1),
   [API startup](../../../apps/api/src/server.ts#L618),
   [worker startup](../../../apps/worker/src/main.ts#L591) and
   [actual executable catch tests](../../../apps/api/src/telemetry-bootstrap.test.ts#L5).
4. [Metrics](../../../packages/observability/src/metrics.ts#L1),
   [recording-meter tests](../../../packages/observability/src/metric-boundary.test.ts#L1),
   [Telegram logFailure](../../../packages/integrations/src/telegram/telegram-adapter.ts#L583),
   [transport diagnostics](../../../packages/observability/src/transport-logging.test.ts#L1)
   and [adjusted contract assertions](../../../tests/contract/telegram-port.test.ts#L1).
5. [Operations/evidence limitations](../../operations/content-free-telemetry.md)
   and [execution ledger](../plans/2026-10-05-content-free-telemetry.md#execution-ledger).
