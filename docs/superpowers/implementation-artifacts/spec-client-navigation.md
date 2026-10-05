---
title: Telegram navigation without personal-content admission
type: feature
status: in-review
created: 2026-10-05
baseline_commit: 2429b306024618266586e4d8063add52ac9f25b1
context:
  - AGENTS.md
  - docs/superpowers/implementation-artifacts/spec-client-sensitive-consent.md
  - docs/operations/client-web-account.md
  - docs/superpowers/plans/2026-10-05-client-navigation.md
---

## Intent

Implement a usable client bot for the owner's full factory request, covering the
safe navigation part of CT-007/010/019. The verified token belongs to
@ii_tonya_assistant_bot. On 2026-10-05 getWebhookInfo returned configured=false,
pending_update_count=0. Runtime preflight also found both TELEGRAM_WEBHOOK_SECRET
and CLIENT_TELEGRAM_BOT_KEY absent/placeholder; main will generate new high-entropy
values and install them with the release, never print or commit them. Main will register the real webhook after reviewed release.
No new authorization round is needed for this already approved work.

A person can reach the public catalogue, account and privacy policy from the bot.
No personal dialogue, signatures, AI, payment, expert transfer or consent granting
is enabled by these commands. This is a bounded increment, not completion of CT-007
or the whole factory.

## Boundaries

Sole repository writer while assigned. Preserve the committed catalogue increment
and user files; no push, commit, deployment or real messages. Node24/pnpm11.9.0,
existing packages and existing webhook_inbox table only. No new migration, test
weakening, approval invention or unrelated refactoring. Main later owns exact-SHA
release. Equivalent safer interfaces fitting existing architecture are permitted
with rationale.

## Code Map and allocated files

- Create packages/application/src/client-navigation-gateway.ts and focused test;
  export through packages/application/src/index.ts.
- Create packages/db/src/repositories/client-ingress-replay-repository.ts;
  export through packages/db/src/index.ts; add
  tests/integration/client-navigation-replay.test.ts.
- Extend apps/api/src/routes/telegram-webhook.ts, app.ts and server.ts;
  focused new routes/client-navigation.test.ts and client-navigation-composition.test.ts.
- Extend packages/config/src/env.ts, focused client-navigation-env.test.ts and
  existing exact config fixtures when needed; .env.example.
- Add docs/operations/client-navigation.md and update this spec/plan results.
- Extend deploy/nginx/ii-tonya and its focused repository tests for the client
  webhook's no-content-spooling boundary; preserve browser/session hardening.
- Existing HybridMessageGateway, its tests and hybrid-message repository may be
  touched only to enforce the same rejected-event fence before any legacy hashing,
  persistence or provider work. Preserve unrelated expert/payment behavior.

## Contract

Add CLIENT_TELEGRAM_NAVIGATION_ENABLED, default false. This navigation-only mode
is mutually exclusive with CLIENT_TELEGRAM_INGRESS_ENABLED, client hybrid routing,
test-expert promo/residual and delivery flags which would feed the client message
into another processor. Its dependencies are a non-placeholder webhook secret,
client route key, valid server-only Telegram bot token, and exact HTTPS client web
origin. Do not require client_messaging consent, any balance or a logged-in user.
Preflight and buildApp must fail closed if enabled without the actual gateway.

Use the existing authenticated client webhook path. Header and botKey comparisons
precede any DB work; preserve fixed errors, limits, body limit and no raw logging.
The navigation branch runs before test-expert promo, HybridMessageGateway,
serialization/hashing of arbitrary message data or any provider call. No callback,
query, command argument or unknown field may become an implicit grant.

Minimal metadata port:

- stable bot ID from the numeric bot-token prefix (never store token or botKey);
- safe nonnegative integer update ID;
- atomically insert a terminal receipt in existing webhook_inbox with provider
  telegram and a versioned namespace, e.g. client-navigation-v1:<botId>:<updateId>;
- status complete, UUID claim_id, null lease; ON CONFLICT DO NOTHING.
- same event always duplicate, irrespective of body, consent changes, restart or
  botKey rotation; no body digest, chat/user ID, text, route or content-derived field.
- db failure/unknown -> fixed503 and no reply; never acknowledge success if receipt
  was not durably created. Configure bounded transaction lock/statement waits.
- other webhook namespaces remain unchanged.

The Nginx client-webhook location must reject >64KiB bodies and use a >=128KiB
client-body buffer with client_body_in_file_only off, proxy_request_buffering off,
HTTP/1.1 upstream and no raw URL/body/headers logging. This keeps accepted-sized
content out of proxy temp files before application admission. Preserve safe TLS
and existing browser/session limits. Add focused config checks and, if feasible,
loopback Nginx transport proof with synthetic body and observed empty temp dir;
do not call static text assertions actual deployment evidence.

A receipt is written for every authenticated structurally valid update ID before
routing its content, including unsupported/media/edited/group updates. Malformed
or unsafe update IDs are rejected before receipt work. For first deliveries only,
inspect direct private message chat/from numeric positive safe IDs and equality;
bots/groups/channels/forwarded/edited/anonymous mismatches cannot route a response
to a third party. All unsupported input stays ephemeral and is never copied to
storage, queues, telemetry, traces, errors, operators, OCR or AI.

Exact supported direct private commands (no arguments, suffixes or normalization):
/start, /help, /catalog, /privacy, /account. Return fixed Russian navigation text
and fixed HTTPS links derived only from validated configured origin. Account may
also have a web_app button in private chat. No personalized echo, parse_mode or
user-controlled URL. Other private content receives only fixed refusal/navigation:
«Персональный диалог здесь пока недоступен. Не присылай личную историю, сведения
о здоровье, документы или данные других людей. Каталог и личный кабинет доступны
по ссылкам ниже.» Avoid claims that Telegram itself erases the message.

Use Telegram's documented webhook response method (application/json,
method=sendMessage, ephemeral chat_id and fixed text/keyboard). This creates no
outbox or stored destination. Returning the response proves only handoff, not
delivery: Telegram gives no result for webhook replies. Record this limitation;
duplicates never resend, and a new command is the safe way to request navigation
again after a lost response. Source:
https://core.telegram.org/bots/api#making-requests-when-getting-updates

A navigation receipt must remain terminal if legacy client ingress is enabled in
a later deployment. Provide a server-wired replay read check before that route's
promo/hybrid branch and before direct Hybrid persistence when the bot identity is
known. Derive the same stable bot ID across both modes. No lookup error may fall
through. Do not claim the legacy free-text path is fully consent-ready: it remains
off in production and requires the separate authority/async increments.

Metadata retention: no wall-clock TTL that revives rejected events. Receipts remain
only while this bot identity can deliver updates. Deletion requires explicit bot
retirement, revoked webhook credentials and disabled ingestion for that identity;
document this executable end event. No indefinitely retained content or user
profile is introduced.

## Tasks & Acceptance

- [x] Meaningful RED tests before implementation: enabled navigation with ordinary
      flags off returns a fixed webhook reply, zero legacy/AI/promo calls. Existing
      route 503 is an acceptable RED; unresolved import is not.
- [x] Config and production composition enforce the navigation-only boundary.
- [x] Application tests cover all exact commands; ordinary text, caption, voice,
      file, forwarded and edited updates; /start payload; group/from mismatch/bot;
      duplicate with changed body; malformed/unsafe IDs; storage failure; sanitized
      error; no identity creation, consent mutation or body hash.
- [x] Real PG proves atomic concurrent duplicate, restart, stable bot ID across key
      rotation, disjoint bot/event namespace, contents absent from all persisted receipt
      fields, and later legacy-route rejection before content processing.
- [x] Route/default composition tests prove auth ordering and actual wiring with
      content ingress off, fixed response, unavailable dependencies, and no logging
      of synthetic canaries. No real Telegram request in tests.
- [x] Document operational activation, getWebhookInfo readback, unknown delivery,
      receipt end event, fail-closed rollback and unchanged sensitive features.
- [x] Focused tests one file per command, relevant typechecks/build/lint/format and
      whitespace; isolated PG17.5 at localhost33110 is available with admin URL
      postgresql://ii_tonya_test@127.0.0.1:33110/postgres. Max3 runs per PG/concurrency
      focused file. No full or multi-path suite: main owns final aggregate.
      Existing Playwright installation may be reused, never install dependencies.
      Freeze all writes and report exact commands/results before independent review.

## Results

Implemented for main's independent review, with default-off navigation and no
production changes, commit, push, secret generation or real Telegram messages.
This spec does not authorize a personal-content admission or grant. The writer
read the full spec and all four frontmatter context files before implementation.
BMad tracked this spec/plan; Superpowers guided RED/GREEN execution and final
verification. Main owns independent review and the aggregate release gate.

Changes: application navigation gateway; bounded PostgreSQL terminal receipts;
auth-before-parser and strict numeric HTTP update IDs; fixed client-route errors;
production preflight/composition; route, Hybrid and direct repository replay
fences; Nginx no-spooling location; private account Mini App button; approved
client availability copy. Existing expert/payment behavior is preserved, except
terminal navigation events cannot reach legacy client promo or persistence.

Implementation choices within the spec: unsupported/forwarded/edited envelopes
are receipted and ignored; exact direct commands share fixed navigation text;
the account uses a fixed `web_app` button. Navigation-only origin configuration
does not require session/login settings. Default production legacy composition
now requires a valid token-derived bot ID to avoid bypassing prior receipts.
The scoped copy update found existing client-intent links still using the expert
messenger builder and replaced those links directly with `/account`; the header
also provides `/catalog`. Expert links/configuration and financial terms remain.

### Focused verification (2026-10-05)

Every row below ran as its own command, with no full/multi-path Vitest run.
The final outcomes are 263 passed tests across these 14 files. Earlier RED is
retained in this turn's tool evidence: route 7 failures initially, 14 after the
actual-logger/auth-before-parser additions; config 3; application stub 44; Hybrid
4; default composition 15; real PG 3; content 2; landing 4; edge config 1. The
Mini App button amendment separately produced 5 meaningful application failures.
Transient test-fixture typing/name errors were corrected before final checks.

| Exact command                                                                                                                                                  | Final result                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `pnpm exec vitest run packages/application/src/client-navigation-gateway.test.ts`                                                                              | 48 passed                                         |
| `pnpm exec vitest run packages/application/src/hybrid-message-gateway.test.ts`                                                                                 | 16 passed                                         |
| `pnpm exec vitest run packages/config/src/client-navigation-env.test.ts`                                                                                       | 26 passed                                         |
| `pnpm exec vitest run packages/config/src/env.test.ts`                                                                                                         | 24 passed                                         |
| `pnpm exec vitest run packages/config/src/hybrid-message-env.test.ts`                                                                                          | 5 passed                                          |
| `pnpm exec vitest run apps/api/src/routes/client-navigation.test.ts`                                                                                           | 21 passed, actual logger canaries                 |
| `pnpm exec vitest run apps/api/src/client-navigation-composition.test.ts`                                                                                      | 15 passed                                         |
| `pnpm exec vitest run apps/api/src/routes/telegram-webhook.test.ts`                                                                                            | 43 passed                                         |
| `pnpm exec vitest run apps/api/src/server.test.ts`                                                                                                             | 15 passed                                         |
| `pnpm exec vitest run apps/api/src/app.test.ts`                                                                                                                | 30 passed                                         |
| `pnpm exec vitest run apps/web/src/content.test.ts`                                                                                                            | 6 passed                                          |
| `pnpm exec vitest run apps/web/src/landing-view.test.ts`                                                                                                       | 9 passed                                          |
| `pnpm exec vitest run tests/repo/client-navigation-edge.test.ts`                                                                                               | 1 passed; static check only                       |
| `II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya_test@127.0.0.1:33110/postgres pnpm exec vitest run tests/integration/client-navigation-replay.test.ts` | 4 passed on isolated PG17.5; run 2/3, one remains |

Additional checks, all exit 0:

```sh
pwsh -File scripts/check-development-environment.ps1 -RequireDocker
pnpm --filter @ii-tonya/application build
pnpm --filter @ii-tonya/config build
pnpm --filter @ii-tonya/db build
pnpm --filter @ii-tonya/api --filter @ii-tonya/web build
pnpm --filter @ii-tonya/application --filter @ii-tonya/config --filter @ii-tonya/db --filter @ii-tonya/api --filter @ii-tonya/web typecheck
pnpm exec tsc --noEmit -p tsconfig.tests.json
node --test tests/container/client-navigation-edge.test.mjs
node --test tests/container/client-web-edge-privacy.test.mjs
node --check tests/container/client-navigation-edge.test.mjs
git diff --check
```

Both native Nginx files passed one test each, one run each. The navigation probe
observed zero request-temp-file events, empty body/proxy temp directories, accepted
64-KiB Content-Length/chunked requests, 413 above that size, streaming before end,
and canary-free logs through a backend 502. This is local transport evidence only.
The existing browser/session edge regression also passed. No dependencies were
installed. Formatter and ESLint passed for the owned TS/MJS/Markdown paths listed
in the plan's verification command manifest; `.env.example`/Nginx have no Prettier
parser. No unrelated user file was formatted.

### Remaining gates and limitations

- Initial implementation froze after its checks. Main subsequently collected all
  three independent review layers and authorized the bounded patch below.
  Post-patch acceptance, aggregate verification, exact-SHA release evidence,
  activation and webhook readback remain main's responsibility; this writer
  does not claim a post-patch independent-review PASS.
- Telegram webhook replies provide no delivery result. A lost reply is not resent
  on duplicate; a new command is the documented recovery.
- Global CT-015 default-404/exception/child-binding logging work remains separate.
  This change handles matched client POST errors without broad logger rewrites.
- Legacy personal-content ingress and authority/async factory work remain off and
  incomplete. Mode switches must stop/drain old instances, preserve receipts and
  retain replay guards. No wall-clock TTL revives events.
- Activation, rollback and explicit bot-retirement deletion procedure are in
  [the operations guide](../../operations/client-navigation.md). No live deletion
  or retirement was performed. Main's preexisting catalog review closure is untouched.

## Approved scope amendment — 2026-10-05

Main explicitly assigned `apps/web/src/content.ts`, `apps/web/src/landing-view.ts`
and their focused existing tests for CT-010/016 navigation-only availability copy.
Before the navigation release, client-facing about/CTA/FAQ copy must describe the
currently available public catalog, account and bot navigation. Remove claims that
personal messenger dialogue, mini-diagnosis, retained history, weekly mood checkups,
automatic booking/reminders or package purchase are already available. Never invite
personal health/story input before admission. Distinguish the product vision from
enabled functions; show package pricing only as planned with purchase unavailable.
Preserve all amounts, financial terms, expert section, legal text, existing design
and style, `/account` client CTA, and separate expert promo bot configuration. Do not
conflate the token-selected client bot with the expert promo bot. Add meaningful RED
assertions against immediate personal-input/history/booking/payment promises and
positive assertions for current catalog/account copy. No broad content rewrite or
new feature. Record exact verification and freeze for main's independent review.

Main also confirmed the private account button must use the permitted fixed
`web_app: { url: '<validated-origin>/account' }` shape so Telegram supplies Mini App
initData while widget login remains off. Catalog/privacy buttons stay ordinary URLs.
Strict numeric update IDs must be checked through HTTP without AJV coercion,
including string and boolean cases. Client-route errors/authentication are scoped
here; global CT-015 logger hardening remains separate.

## Independent review patch triage — 2026-10-05

Main collected all three independent layers and authorized one PATCH batch; no
intent change. Preserve the working navigation/replay/privacy implementation.

| Finding                                                       | Severity | Triage and bounded action                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom composition bypasses legacy identity/replay guards     | high     | PATCH: effective ingress (config OR dependency flag) requires valid token-derived identity, exact matching dependency ID and replay reader; negative matrix plus explicit valid fixtures.                                                                                 |
| Navigation-only sessions-off rollback retains web-only config | medium   | PATCH: document removing origin/login-only settings with navigation disabled; test supported transition without enabling sessions.                                                                                                                                        |
| Fresh legacy event continuation not covered                   | medium   | PATCH: positive route and Hybrid cases with replay reader returning false; prove inverted guard fails. No PG changes/runs.                                                                                                                                                |
| Native edge proofs have no repeatable deployment entrypoint   | medium   | PATCH: package scripts only, native edge command includes navigation and browser regression, deployment verification invokes it, behavior test proves invocation/failure propagation; preserve image runner.                                                              |
| Support/account copy overstates availability                  | medium   | PATCH: existing email/telephone support only; qualify private account functions on enabled login, preserve session/private-area guards and production config.                                                                                                             |
| Webhook update subscription not explicit                      | low      | PATCH: document main's approved exact allowed_updates=[message, edited_message, channel_post, edited_channel_post, callback_query], drop_pending_updates=false, max_connections=2 and sorted exact secret-safe readback. Unsupported envelopes remain terminally ignored. |
| First-contact commands omit sensitive-input warning           | low      | PATCH: same fixed warning on all supported commands; focused assertions.                                                                                                                                                                                                  |
| Optional outcome instrumentation                              | low      | REJECT: out of bounded release; no speculative telemetry.                                                                                                                                                                                                                 |
| Route-key strengthening                                       | low      | REJECT: out of approved patch scope.                                                                                                                                                                                                                                      |
| Whole-request timeout                                         | low      | REJECT: out of approved patch scope; existing bounded SQL waits preserved.                                                                                                                                                                                                |

Main remains responsible for operational actions and post-patch release checks.
No commit/push/deploy, dependency/lockfile changes or PG execution in this batch.
PG remains 2/3 used, final run reserved for main. Exact patch checks/results follow.

### Patch results and exact checks

All seven accepted PATCH findings are implemented. Only 16 existing owned paths
were edited in this batch, including the newly authorized `package.json` scripts;
the full navigation increment now owns 31 paths. No additional legacy fixture
file needed changes: the explicit custom-composition valid/invalid matrix lives
in `apps/api/src/client-navigation-composition.test.ts`; existing server fixtures
remain green. No session/production configuration, dependency, lockfile, PG file,
catalog-review closure, provider or telemetry code was changed in the patch.

Meaningful RED: custom composition 3 failures (config-only, dependency-only and
both enabled accepted a missing token); first-contact warning 5; runner 3; content
2; landing 2. The first composition assertion tried to print a Fastify instance
and hit its getter; returning a fixed sentinel exposed the actual wrong successful
construction, then all 15 invalid combinations and 3 valid compositions passed.
Temporary inversion of `terminal === true` to `terminal === false` caused both
fresh-event route tests and both fresh-event Hybrid tests to fail. Each mutation
was restored with a targeted patch, then the complete focused files passed.
The rollback test documents existing validation, requiring no config code change.

Final patch GREEN: **173 tests across 9 individual Vitest commands**, plus both
native Nginx tests through the repeatable entrypoint:

| Exact command                                                                     | Result                           |
| --------------------------------------------------------------------------------- | -------------------------------- |
| `pnpm exec vitest run apps/api/src/client-navigation-composition.test.ts`         | 21 passed                        |
| `pnpm exec vitest run apps/api/src/routes/client-navigation.test.ts`              | 23 passed                        |
| `pnpm exec vitest run apps/api/src/server.test.ts`                                | 15 passed                        |
| `pnpm exec vitest run packages/config/src/client-navigation-env.test.ts`          | 27 passed                        |
| `pnpm exec vitest run packages/application/src/client-navigation-gateway.test.ts` | 48 passed                        |
| `pnpm exec vitest run packages/application/src/hybrid-message-gateway.test.ts`    | 18 passed                        |
| `pnpm exec vitest run apps/web/src/content.test.ts`                               | 7 passed                         |
| `pnpm exec vitest run apps/web/src/landing-view.test.ts`                          | 10 passed                        |
| `pnpm exec vitest run tests/repo/client-navigation-edge.test.ts`                  | 4 passed                         |
| `pnpm test:edge:native`                                                           | 2 passed; native nginx, no skips |

Mutation proof commands (expected RED, not final state):
`pnpm exec vitest run apps/api/src/routes/client-navigation.test.ts -t 'continues'`
and `pnpm exec vitest run packages/application/src/hybrid-message-gateway.test.ts -t 'continues'`.

Additional fresh checks: `pwsh -File scripts/check-development-environment.ps1`,
`pnpm --filter @ii-tonya/application build`,
`pnpm exec tsc --noEmit -p tsconfig.tests.json`,
`pnpm --filter @ii-tonya/application --filter @ii-tonya/config --filter @ii-tonya/db --filter @ii-tonya/api --filter @ii-tonya/web typecheck`,
scoped ESLint/Prettier commands recorded in the plan, and `git diff --check`.
All exit 0. No full verify, full/multi-path Vitest or PostgreSQL run was executed.
`verify:deploy` wiring was behavior-tested with intercepted test commands; the
full deployment aggregate itself remains for main. Its native Nginx requirement
is explicit and must be provisioned on the verification host, not silently skipped.

Operational alignment follows main's approved five-kind subscription, exact
sorted readback, `drop_pending_updates=false`, `max_connections=2`. Operations
review/live preflight readiness were reported by main, not executed by this writer.
All writes freeze after this patch's final formatting/whitespace checks for main's
patch review, RC/build and separately authorized deployment.

### Controller verification before release

The controller ran `pnpm exec vitest run --maxWorkers=4 --minWorkers=1` once.
With the external admin URL unset, the testkit automatically launched real
PostgreSQL containers; this was not a database-free aggregate. The navigation
replay file passed all four tests, consuming its third and final PG run. The
already-exhausted catalog-worker PG file did not run again. The aggregate also
reported a 5-second timeout in `expert-referral-schema.test.ts`, case requiring
ledger attribution to owned grants; that file and its financial implementation
are outside this change. The cause has not been established. The controller
interrupted the aggregate (exit 130) before further repeated PG verification and
confirmed its child had exited. No full-suite PASS or timeout waiver is claimed.
The raw diagnostic output is retained in the local operational evidence. Do not
repeat the full aggregate, navigation PG file (3/3), or catalog-worker PG file
(3/3). Focused writer results above remain distinct from this interrupted run.

The controller separately ran `pnpm test:edge:native`: both native Nginx tests
passed with no skips. No production mutation had occurred at these checks.

The independent patch reviewer closed all seven accepted findings with PASS,
using in-memory probes for 15 invalid/3 valid compositions, the documented
rollback, four fresh-event paths and four inversion controls, all five command
warnings, rendered copy and verification-runner exit propagation. No repository
writes or PostgreSQL runs were performed by that reviewer. The controller's
fresh tests TypeScript check and whitespace check also passed. This closes only
the bounded implementation review: external exact-SHA CI/Database Gate and live
release evidence remain separate, and the full factory is not complete.

The bounded RC was subsequently deployed as
`cab25eef3d7abd8591c2a49c3605a14acdc76585`. See the
[production evidence](../../test-evidence/production/cab25eef-client-navigation-2026-10-05.md)
for direct-browser checks, Telegram configuration, its unresolved connection
timeout, the empty catalog and the incomplete full-suite/Trust CI gates. This
does not change the parent factory's incomplete status.

The first RC push of `5f13be90b738703c99dc26af7f44db54d6408e5d` was refused by
the pre-push scope gate: the newly reviewed root package scripts had not been
registered in the exact manifest-hash map. A focused reproduction produced
122 passing assertions and one hash-mismatch failure, not a payment-scope change.
The follow-up updates only that package manifest's reviewed hash and comment;
the classifier, other pins, mutation assertions, dependencies and lockfile are
unchanged. No hook bypass or history rewrite was used.

## Suggested Review Order

**Admission and replay**

- Fixed navigation replies follow durable, content-free terminal receipts.
  [client-navigation-gateway.ts:44](../../../packages/application/src/client-navigation-gateway.ts#L44)
- Authentication precedes parsing; terminal events cannot reach later legacy processing.
  [telegram-webhook.ts:190](../../../apps/api/src/routes/telegram-webhook.ts#L190)
- Effective ingress requires a valid stable identity and replay capability.
  [app.ts:184](../../../apps/api/src/app.ts#L184)

**Operations and evidence**

- Activation, delivery limits and recovery remain explicit operational responsibilities.
  [client-navigation.md:1](../../operations/client-navigation.md#L1)
- Native edge tests participate in deployment verification without weakening other checks.
  [package.json:25](../../../package.json#L25)
- Real PostgreSQL verifies duplicate handling, persistence boundaries and bounded lock waits.
  [client-navigation-replay.test.ts:50](../../../tests/integration/client-navigation-replay.test.ts#L50)
