# Content-free operational telemetry

CT-015 is implemented by the [telemetry spec](../superpowers/implementation-artifacts/spec-content-free-telemetry.md).
No consent or feature flag enables personal-content logging. This boundary applies
to operational telemetry, not PostgreSQL financial/audit facts, consent proofs,
business commands, idempotency or reconciliation keys. Those paths were not changed.

## Logger contract

`createLogger` returns a Pino-compatible logger. Only newly projected, primitive
data reaches Pino. Unknown calls emit `event: telemetry_unclassified`; their
strings, keys and arguments are discarded. There is no recursive redaction.
The only legacy message recognized is the exact `public_catalog_failure` literal.
Arbitrary messages, interpolation, URLs, headers, bodies, buffers, correlations,
IDs/hashes and error name/message/stack/cause never enter output.

The table below describes **event payload fields**, not the entire serialized
record. Independently validated child/setBindings context can add the finite
`module`, `provider` and `operation` bindings listed below, even when that event's
payload schema omits those fields. Logger-generated level/time also remain.
For example, a child with `module: api` can emit `public_catalog_failure` with
`reason: busy`; an arbitrary payload module or context string still cannot pass.

| Event                                      | Allowed fields and values                                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `telemetry_unclassified`                   | No submitted fields                                                                                                                          |
| `public_catalog_failure`                   | `reason`: `rate_limited`, `busy`, `missing_repository`, `deadline`, `repository_failure`, `invalid_output`                                   |
| `http_request_completed`, `http_not_found` | `method`, `statusCode`, `durationMs`                                                                                                         |
| `http_request_failed`                      | HTTP fields plus `failureClass`                                                                                                              |
| `process_fatal`                            | `module`, `fatal`: `uncaughtException` or `unhandledRejection`, `failureClass`                                                               |
| `startup_failure`                          | `module`, `failureClass`                                                                                                                     |
| `selarti_inbound`                          | `module: api`, `operation: selarti.inbound`, `outcome: accepted`, optional `count`                                                           |
| `transport_failure`                        | `provider: telegram`, `operation`: `sendMessage` or `answerCallbackQuery`, `outcome`: `before_write`, `after_write`, `unknown`, `rate_limit` |

HTTP methods are limited to GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, CONNECT,
TRACE and the literal OTHER; unrecognized values are omitted. Status is an integer
100–599; duration is finite 0–86,400,000 milliseconds; count is an integer
0–1,000,000. Invalid fields are omitted. Logger-generated level/timestamp remain.

Root, recursive `child()` and `setBindings()` share the same boundary. Bindings
allow only fixed module (`api`, `worker`, `integrations`), operation
(`selarti.inbound`, `sendMessage`, `answerCallbackQuery`) and provider
(`telegram`, `selarti`). Child options preserve standard levels and `silent`;
custom levels, serializers and formatters cannot reinstall content output.
Own data descriptors are read; getters, coercion, toJSON and Proxy traps are not
called. `redactProviderUrl` now always returns the literal `[REDACTED]`.

Failure classes come from exact own machine codes, never prose or Error names:

| Machine code                                                   | Failure class        |
| -------------------------------------------------------------- | -------------------- |
| `ECONNREFUSED`                                                 | `connection_refused` |
| `EADDRINUSE`                                                   | `address_in_use`     |
| `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`                         | `timeout`            |
| `ECONNRESET`                                                   | `connection_reset`   |
| `ENOTFOUND`, `EAI_AGAIN`                                       | `dns_failure`        |
| `FST_ERR_CTP_BODY_TOO_LARGE`                                   | `body_too_large`     |
| `FST_ERR_CTP_INVALID_JSON_BODY`, `FST_ERR_CTP_EMPTY_JSON_BODY` | `invalid_json`       |
| `FST_ERR_VALIDATION`                                           | `invalid_request`    |
| Unknown or absent code                                         | `internal_error`     |

The new helper containing these projections is
`packages/observability/src/telemetry-schema.ts`.

## HTTP and transport

Root Fastify composition disables automatic request logging using `LogController`.
Explicit not-found, error, router/framework-error and completion handling is
installed before route registration. Unknown paths, malformed path encodings,
query values, caller headers and validation fields are not echoed. Plugin-local
handlers remain encapsulated: oversized session/booking bodies return 400 while
ordinary oversized bodies return 413. The installed JSON parser already concealed
malformed JSON text; that test is preservation evidence, not a newly fixed leak.
Route `silent` configuration remains effective.

Root error status precedence matches Fastify's two-stage default handler. With a
status already set via reply.code/status/statusCode (including explicit 200),
valid own numeric `error.status` precedes `error.statusCode`, then the existing
reply status. Without that status-set marker, `error.statusCode` precedes
`error.status`, otherwise 500. Only integer 400–599 values qualify. The composition
reads Fastify's own `kReplyHasStatusCode` data descriptor: implicit200 and explicit200
are observably different despite the same numeric reply status. No getters or
object/string coercion are used in this projection. The sole copied error header
is own `headers['retry-after']` containing
canonical integer delta-seconds 0–86,400 (numeric or decimal string). Dates, URLs,
arrays, accessors, CR/LF and arbitrary error headers are rejected. Framework 4xx
failures use `invalid_request`; framework 5xx use `internal_error` in both the
response and diagnostic.

The root error response is terminal: it writes a fixed JSON envelope directly,
without re-entering serializers or `onSend`. This is intentional: a real composed
`onSend` failure reproduced Fastify's parent fallback echoing raw error prose.
Normal-response hooks and plugin-local error handlers are retained; `onError`
already runs before root handling and normal request completion still emits
`onResponse`. Trusted preselected headers (including cookies/auth challenges) and
status survive; stale compression/framing is removed, Content-Length is replaced,
and HEAD has no body. A malformed preselected header falls back to fixed headers;
a write failure after headers were sent closes the connection, never recursively
serializing another error. HTTP diagnostics are best effort when a logger throws.
The navigation route's existing local handler still maps an `onSend` failure to
503; it never executes authenticated business work for denied requests.

Selarti receives the same raw bytes, correlation and business identifiers. Its
accepted-event log no longer contains correlation or eventIdHash. Telegram's
`logFailure` maps transport facts to fixed outcomes and the actual operation;
429 branches now call that helper, which contains logger exceptions. Retry delays, returned reason codes,
idempotency and reconciliation values are unchanged. No provider was called.

## Traces, metrics and fatal exit

`traced(name, operation)` accepts only `selarti.inbound` at runtime; every other
name becomes `operation`, and the callback still runs. The callback receives no
Span. Real spans receive only OK/ERROR status and, on error, the approved
`failure.class`. No exception events, status descriptions or provider values are
recorded. Span ending is always attempted. Recording/end failure cannot replace
the original business error or result; if span creation fails, business work runs
without a span and exactly once. Parent context is rebuilt from ROOT_CONTEXT using
validated W3C trace/span IDs, the sampled flag and a boolean remote marker only.
Tracestate, baggage and arbitrary context entries are not inherited by the created
span. The callback runs with a **non-recording** span context, preserving async and
nested parent-child relationships without exposing the mutable recording span.
Callback attribute/event writes on that context cannot alter the exported span.

All exported instruments are guarded facades. Existing catalog, session, booking,
worker, referral, maturity and Selarti label validators remain in force; labels are
copied from own primitive data before validation. Inbox duplicates allow only
telegram/selarti/yookassa. Test-expert reconciliation names are runtime-checked
against reconciliation_age/units_consumed/units_released/unknown_outcome. Currently
unused generic instruments accept no labels. No labels are also permitted for raw
aggregate recording. Counts/durations must be finite and nonnegative; signed
provider-circuit changes and fractional reconciliation quantities are preserved.
Caller-supplied context is not forwarded by the facades. No personal hashes are
accepted as labels.

Fatal listeners emit fixed kind/class and exit(1), even if the optional cleanup
callback or logger throws. The callback retains the original error for cleanup;
the handler never stringifies it. Startup failures use the same classes and retain
exitCode=1. The executable API and worker entrypoints are also spawned with an
isolated invalid DATABASE_URL: their actual bootstrap catches emit one fixed
startup record and exit normally with code 1, no signal, error prose or stderr.
Configuration validation precedes DB/provider initialization. No fatal crash is
used in tests. Build workspace dependencies before these subprocess tests because
real Node package resolution uses their compiled exports, not Vitest's aliases.

Fatal delivery is best effort, **not durable evidence**. The default Pino stdout
destination retains its normal buffering/OS behavior. The injected Writable
adapter queues writes in microtasks and does not propagate flush/drain completion;
immediate process.exit(1) can lose those writes. The fatal handler does not await
flush, exporter shutdown or destination drain. Startup exitCode permits normal
event-loop draining but is not a durability guarantee. Do not infer that every
fatal event reaches an infrastructure sink.

## Initial implementation verification on 2026-10-05

Baseline: `098b46a5c76a19003453d75475b6b86c88d84f9c`, branch
`codex/fin-001-client-access-policy`. These are working-tree results, not an
exact-SHA release receipt. Each row below was run as its own command,
`pnpm exec vitest run <file>`; no aggregate command or PostgreSQL run was used.

| File                                                          | Final passing tests |
| ------------------------------------------------------------- | ------------------: |
| `packages/observability/src/logger.test.ts`                   |                  18 |
| `packages/observability/src/tracing.test.ts`                  |                   4 |
| `packages/observability/src/fatal-logging.test.ts`            |                   4 |
| `packages/observability/src/metric-boundary.test.ts`          |                   2 |
| `packages/observability/src/transport-logging.test.ts`        |                   6 |
| `packages/observability/src/metrics.test.ts`                  |                  13 |
| `packages/observability/src/client-catalog-metrics.test.ts`   |                   5 |
| `packages/observability/src/selarti-budget-metrics.test.ts`   |                  11 |
| `tests/security/client-consent-leakage.test.ts`               |                   6 |
| `tests/contract/telegram-port.test.ts`                        |                  20 |
| `packages/integrations/src/telegram/telegram-adapter.test.ts` |                  16 |
| `apps/api/src/app.test.ts`                                    |                  30 |
| `apps/api/src/server.test.ts`                                 |                  15 |
| `apps/api/src/client-principal-review-remediation.test.ts`    |                   6 |
| `apps/api/src/routes/client-sessions.test.ts`                 |                   4 |
| `apps/api/src/routes/client-booking.test.ts`                  |                   6 |
| `apps/api/src/routes/browser-account.test.ts`                 |                   6 |
| `apps/api/src/routes/public-client-catalog.test.ts`           |                  59 |
| `apps/api/src/client-navigation-composition.test.ts`          |                  21 |
| `apps/api/src/routes/client-navigation.test.ts`               |                  23 |
| `apps/worker/src/main.test.ts`                                |                  12 |
| `apps/worker/src/worker-outbox-metric-capability.test.ts`     |                   4 |
| Total (22 separate files)                                     |                 291 |

The trace and metric tests install actual SDK recording providers before module
import. These tests observe exported ended spans and collected measurements;
no-op providers are not used as evidence. They are synthetic evidence only: no
production exporter/APM, infrastructure logs, backups or support-copy coverage is
claimed.

Other exact commands:

```sh
pwsh -File scripts/check-development-environment.ps1
pnpm --filter @ii-tonya/observability build
pnpm --workspace-concurrency=1 --filter @ii-tonya/observability --filter @ii-tonya/integrations --filter @ii-tonya/api --filter @ii-tonya/app-worker run build
pnpm --workspace-concurrency=1 --filter @ii-tonya/api --filter @ii-tonya/app-worker run build
pnpm --workspace-concurrency=1 --filter @ii-tonya/observability --filter @ii-tonya/integrations --filter @ii-tonya/api --filter @ii-tonya/app-worker run typecheck
pnpm exec tsc --noEmit -p tsconfig.tests.json
pnpm exec eslint packages/observability/src/logger.ts packages/observability/src/telemetry-schema.ts packages/observability/src/logger.test.ts packages/observability/src/tracing.ts packages/observability/src/tracing.test.ts packages/observability/src/fatal-logging.ts packages/observability/src/fatal-logging.test.ts packages/observability/src/metrics.ts packages/observability/src/metric-boundary.test.ts packages/observability/src/transport-logging.test.ts packages/observability/src/index.ts apps/api/src/app.ts apps/api/src/server.ts apps/api/src/routes/selarti-webhook.ts apps/api/src/client-principal-review-remediation.test.ts apps/worker/src/main.ts packages/integrations/src/telegram/telegram-adapter.ts tests/security/client-consent-leakage.test.ts tests/contract/telegram-port.test.ts
git diff --check
```

Final formatting command (the same paths were normalized with `--write`):

```sh
pnpm exec prettier --check packages/observability/src/logger.ts packages/observability/src/telemetry-schema.ts packages/observability/src/logger.test.ts packages/observability/src/tracing.ts packages/observability/src/tracing.test.ts packages/observability/src/fatal-logging.ts packages/observability/src/fatal-logging.test.ts packages/observability/src/metrics.ts packages/observability/src/metric-boundary.test.ts packages/observability/src/transport-logging.test.ts packages/observability/src/index.ts apps/api/src/app.ts apps/api/src/server.ts apps/api/src/routes/selarti-webhook.ts apps/api/src/client-principal-review-remediation.test.ts apps/worker/src/main.ts packages/integrations/src/telegram/telegram-adapter.ts tests/security/client-consent-leakage.test.ts tests/contract/telegram-port.test.ts docs/operations/content-free-telemetry.md docs/superpowers/implementation-artifacts/spec-content-free-telemetry.md docs/superpowers/plans/2026-10-05-content-free-telemetry.md
```

Initial failures and their resolutions are recorded in the
[execution ledger](../superpowers/plans/2026-10-05-content-free-telemetry.md#execution-ledger):
meaningful leakage REDs; one incorrect fixture preflight; Pino generic typing;
Fastify framework reply typing; three obsolete Telegram URL assertions; and four
unused-parameter lint errors. Author review also caught child methods inheriting
the parent's wrapper: a new RED reproduced lost silent inheritance and misplaced
setBindings. Passing the original Pino methods down the wrapper chain fixed both;
the logger finished 18/18 and the composed leakage tests finished 6/6 afterward.
All were corrected. The already exhausted aggregate
and PostgreSQL budgets remain untouched.

## Accepted independent review findings

Main reported completion of all three independent review layers and triaged the
following scoped patch set. The receiving-code-review workflow required concrete
reproductions before changes; previous positive controls were retained.

| Finding                          | Accepted patch and evidence                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 HIGH HTTP status               | Composed preselected 401/429, own status422 and precedence cases; bounded own-data status projection.                                                                                                                  |
| 2 MEDIUM Retry-After             | Synthetic429 preserves 0/3/60/86400 seconds; rejects invalid bounds, URLs, CR/LF and nonprimitive values; arbitrary headers absent.                                                                                    |
| 3 MEDIUM framework500            | Actual async router constraint failure emits fixed internal_error in response and diagnostic.                                                                                                                          |
| 4 HIGH terminal fallback         | Actual throwing onSend leaked plaintext before patch, including with a throwing logger; terminal response retains protocol headers, HEAD, error/completion hooks, local 400/413 and auth denial.                       |
| 5 MEDIUM Telegram logger failure | Throwing logger for send and callback preserves exact retryable result, including send retryAfterMs3000.                                                                                                               |
| 6 HIGH trace context             | Actual recording provider reproduced exported tracestate canary; rebuilt context drops tracestate/baggage/custom entries, validates IDs, and preserves nested trace relationships with non-recording callback context. |
| 7 MEDIUM startup evidence        | Actual API and worker executable catches, invalid config, fixed startup_failure/module/internal_error, exit1, no DB/provider or fatal crash.                                                                           |
| 8 MEDIUM span creation failure   | Throwing startSpan runs success/failure callback exactly once and preserves result/error identity; recording/end-throw positives retained.                                                                             |
| 9 MEDIUM callback429 evidence    | Real createLogger output includes callback rate_limit diagnostic and exact unchanged retryable result.                                                                                                                 |
| 10 MEDIUM composed silent        | Actual silent success/error routes emit nothing; ordinary route emits approved completion. Already passed before this patch.                                                                                           |
| 11 LOW context documentation     | Event payload versus independent finite child bindings clarified; positive child-context output test added without redesigning context.                                                                                |

No startup vocabulary expansion or arbitrary telemetry acceptance was made. Main
reported no evidence-backed pre-existing deferred issue. Patch validation and
review remain separate from release approval.

## Review patch verification on 2026-10-05

Same branch/baseline; single writer authorized again after main's triage. The
initial 291-test table above is historical, not a claim that unchanged metric
files were rerun for this patch. Every row below was a separate exact command
`pnpm exec vitest run <file>`; final results total **282 tests in 16 files**.

| File                                                          | Passing tests |
| ------------------------------------------------------------- | ------------: |
| `packages/observability/src/logger.test.ts`                   |            20 |
| `packages/observability/src/tracing.test.ts`                  |            12 |
| `packages/observability/src/transport-logging.test.ts`        |             9 |
| `tests/security/client-consent-leakage.test.ts`               |            27 |
| `apps/api/src/telemetry-bootstrap.test.ts`                    |             2 |
| `apps/api/src/app.test.ts`                                    |            30 |
| `apps/api/src/server.test.ts`                                 |            15 |
| `apps/api/src/routes/client-sessions.test.ts`                 |             4 |
| `apps/api/src/routes/client-booking.test.ts`                  |             6 |
| `apps/api/src/routes/browser-account.test.ts`                 |             6 |
| `apps/api/src/routes/public-client-catalog.test.ts`           |            59 |
| `apps/api/src/client-navigation-composition.test.ts`          |            21 |
| `apps/api/src/routes/client-navigation.test.ts`               |            23 |
| `apps/worker/src/main.test.ts`                                |            12 |
| `packages/integrations/src/telegram/telegram-adapter.test.ts` |            16 |
| `tests/contract/telegram-port.test.ts`                        |            20 |

Patch RED and intermediate failures were retained as evidence, not hidden:

- HTTP: 12 failed/13 passed before changes. The canary reached Fastify's real
  parent fallback response; status/Retry-After/framework failures were independent.
  Initial GREEN 25/25; extra protocol checks found HEAD body framing (fixed), and
  an incorrect fixture assumption that the navigation local handler preserved 401
  after onSend failure (it explicitly chooses 503; denial remains intact). Final 27/27.
- Telegram: 2 failed/7 passed, both throwing-logger429 cases; fixed helper gives 9/9.
- Tracing: context RED 1 failed/5 passed, then explicit exported-tracestate RED
  2 failed/5 passed. Sanitized context GREEN 7/7; ID/accessor controls give 12/12.
  Existing recording/end failure tests remain; creation-failure control already passed.
- Executable startup: worker passed; API first failed before its catch because a
  stale observability build lacked the new protocol helper export. Rebuilding the
  workspace dependency fixed the setup; both real catches pass 2/2. No application
  bootstrap production logic needed further changes.
- Tests tsc initially found Fastify/Node header-map type incompatibility and the
  installed router typing's missing async-constraint overload. Typed header-map
  copying and an optional third callback (runtime arity still 3) resolved these;
  no dependency or runtime contract was weakened.

Other patch commands passed (API was rebuilt again after the HEAD correction):

```sh
pwsh -File scripts/check-development-environment.ps1
pnpm --filter @ii-tonya/observability build
pnpm --workspace-concurrency=1 --filter @ii-tonya/observability --filter @ii-tonya/integrations --filter @ii-tonya/api --filter @ii-tonya/app-worker run build
pnpm --filter @ii-tonya/api build
pnpm --workspace-concurrency=1 --filter @ii-tonya/observability --filter @ii-tonya/integrations --filter @ii-tonya/api --filter @ii-tonya/app-worker run typecheck
pnpm exec tsc --noEmit -p tsconfig.tests.json
pnpm exec eslint packages/observability/src/logger.ts packages/observability/src/telemetry-schema.ts packages/observability/src/logger.test.ts packages/observability/src/tracing.ts packages/observability/src/tracing.test.ts packages/observability/src/fatal-logging.ts packages/observability/src/fatal-logging.test.ts packages/observability/src/metrics.ts packages/observability/src/metric-boundary.test.ts packages/observability/src/transport-logging.test.ts packages/observability/src/index.ts apps/api/src/app.ts apps/api/src/server.ts apps/api/src/telemetry-bootstrap.test.ts apps/api/src/routes/selarti-webhook.ts apps/api/src/client-principal-review-remediation.test.ts apps/worker/src/main.ts packages/integrations/src/telegram/telegram-adapter.ts tests/security/client-consent-leakage.test.ts tests/contract/telegram-port.test.ts
pnpm exec prettier --check packages/observability/src/logger.ts packages/observability/src/telemetry-schema.ts packages/observability/src/logger.test.ts packages/observability/src/tracing.ts packages/observability/src/tracing.test.ts packages/observability/src/fatal-logging.ts packages/observability/src/fatal-logging.test.ts packages/observability/src/metrics.ts packages/observability/src/metric-boundary.test.ts packages/observability/src/transport-logging.test.ts packages/observability/src/index.ts apps/api/src/app.ts apps/api/src/server.ts apps/api/src/telemetry-bootstrap.test.ts apps/api/src/routes/selarti-webhook.ts apps/api/src/client-principal-review-remediation.test.ts apps/worker/src/main.ts packages/integrations/src/telegram/telegram-adapter.ts tests/security/client-consent-leakage.test.ts tests/contract/telegram-port.test.ts docs/operations/content-free-telemetry.md docs/superpowers/implementation-artifacts/spec-content-free-telemetry.md docs/superpowers/plans/2026-10-05-content-free-telemetry.md
git diff --check
```

Review-patch write manifest (all earlier implementation changes are retained):

- `apps/api/src/app.ts`, `packages/observability/src/telemetry-schema.ts`,
  `packages/observability/src/index.ts`: HTTP protocol projection, best-effort
  diagnostics and terminal response.
- `packages/observability/src/tracing.ts`,
  `packages/integrations/src/telegram/telegram-adapter.ts`: safe active trace context
  and best-effort Telegram diagnostics.
- `packages/observability/src/logger.test.ts`,
  `packages/observability/src/tracing.test.ts`,
  `packages/observability/src/transport-logging.test.ts`,
  `tests/security/client-consent-leakage.test.ts`,
  **new** `apps/api/src/telemetry-bootstrap.test.ts`: focused regressions.
- This operations record, the telemetry spec and its implementation plan:
  accepted findings, exact checks and review handoff.

Repository writes are frozen at handoff. No full/multi-path/PG command, new
dependency, schema change, commit, push or deploy. Remaining gates belong to main:
patch review, exact-SHA verification and separately authorized release. Fatal
delivery and synthetic exporter limitations above remain; no accepted code finding
is deferred by this patch.

## Patch-closure status precedence correction

Main's closure review found one remaining regression; other accepted findings had
no unresolved issue. The earlier status tests always called reply.code and missed
the implicit-status branch. A differential test now compares buildTestApp (real
buildApp composition) with unmodified installed Fastify5.12.5, for both synchronous
and asynchronous throws of an Error with own numeric status422/statusCode503:

| Reply selection            | Installed Fastify | Patched composition |
| -------------------------- | ----------------: | ------------------: |
| implicit200, no reply.code |               503 |                 503 |
| explicit reply.code(200)   |               422 |                 422 |
| explicit reply.code(429)   |               422 |                 422 |

Inspected `lib/error-handler.js` defaultErrorHandler/setErrorHeaders,
`lib/error-status.js` setErrorStatusCode, and the conditional diagnostic calls in
`lib/handle-request.js`/`lib/wrap-thenable.js`. setErrorHeaders first picks status;
setErrorStatusCode then overrides it with statusCode only when the status-set flag
is absent. Reading that installed internal boolean in API composition and passing
it to the existing helper fixes precedence without rewriting the terminal handler,
reading arbitrary error properties, or copying prose. Existing hostile-data tests
now exercise both explicit and implicit branches. The private Fastify symbol is
a deliberate compatibility dependency; the differential must run on upgrades.

Changed in this correction only: `apps/api/src/app.ts`, `apps/api/src/app.test.ts`,
`packages/observability/src/telemetry-schema.ts`,
`packages/observability/src/logger.test.ts`, this operations record and the existing
telemetry spec/plan. All prior positive controls were retained.

Exact additional commands and observed results:

```sh
pwsh -File scripts/check-development-environment.ps1
pnpm exec vitest run apps/api/src/app.test.ts -t 'error status differential'
pnpm exec vitest run apps/api/src/app.test.ts
pnpm exec vitest run tests/security/client-consent-leakage.test.ts
pnpm exec vitest run packages/observability/src/logger.test.ts
pnpm --workspace-concurrency=1 --filter @ii-tonya/observability --filter @ii-tonya/api run build
pnpm exec vitest run apps/api/src/telemetry-bootstrap.test.ts
pnpm --workspace-concurrency=1 --filter @ii-tonya/observability --filter @ii-tonya/api run typecheck
pnpm exec tsc --noEmit -p tsconfig.tests.json
pnpm exec eslint apps/api/src/app.ts apps/api/src/app.test.ts packages/observability/src/telemetry-schema.ts packages/observability/src/logger.test.ts
pnpm exec prettier --check apps/api/src/app.ts apps/api/src/app.test.ts packages/observability/src/telemetry-schema.ts packages/observability/src/logger.test.ts docs/operations/content-free-telemetry.md docs/superpowers/implementation-artifacts/spec-content-free-telemetry.md docs/superpowers/plans/2026-10-05-content-free-telemetry.md
git diff --check
```

Differential RED: **2 failed, 4 passed, 30 filtered out**; both implicit cases
returned422 instead of the reference503. Focused GREEN: API **36/36** (all six
differential cases plus existing30), leakage **27/27**, logger **20/20**, executable
bootstrap **2/2** — **85 tests across four separate files**. Environment, both
relevant builds/typechecks, tests tsc, scoped lint/format/diff pass. Other earlier
file counts remain historical; no full/multipath/PG, commit/push/deploy or dependency
change was performed. Status remains `in-review`; all repository writes are frozen
again for main's closure check. No known code finding remains deferred.

## Review and recovery

All three independent layers returned; this patch addresses main's accepted
findings and awaits main's patch review. Status stays `in-review`. The author
does not claim independent approval of the patch. No
commit, push, deployment, dependency, schema or runtime-flag change was made here.
The additional contract-test file updates only obsolete log expectations.

Free-text diagnostics and per-person correlations are intentionally unavailable.
Investigate failures through fixed classes, status/duration, aggregate metrics and
authorized business evidence. Extend a closed vocabulary only with focused tests;
do not restore prose or URL printing to troubleshoot.

Main owns exact-SHA release verification and deployment. The supplied rollback
target `cab25ee` predates this telemetry fix and therefore restores the earlier
telemetry exposure as well as the older application. Keep content capabilities
disabled and do not treat rollback as preservation of CT-015. No rollback or live
activation was performed in this implementation.

## Main closure, 2026-10-05

All three independent review layers were collected before triage. Eleven accepted
findings were patched, then the remaining implicit-status precedence regression
was reproduced and corrected. Independent bounded closure review passed; it also
confirmed the pinned Fastify symbol resolves from both source and compiled paths,
and both compiled entrypoints import successfully.

Main freshly ran separate commands for logger20, tracing12, HTTP leakage27,
executable bootstrap2 and API36; all passed. Four relevant package typechecks,
tests typecheck, whitespace and operational-helper syntax checks also passed.
The original aggregate failure and exhausted navigation/catalog PG budgets were
not rerun or hidden. The source is ready for the owner-authorized RC workflow;
local checks and artifact signatures still do not substitute for unavailable
exact-SHA factory Trust CI/Database Gate attestations. No full-product readiness
or successful real-user Telegram login is asserted by this closure.
