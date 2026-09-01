# Task 10 report — prompt-safe expert referral interface

## Status

IMPLEMENTED_AWAITING_REVIEW from exact independently reviewed base
`a806cdc36fa3e910b9c2398ad5a7a5edef0160c8` in the commit planned as
`feat: add prompt safe expert referral interface`.

This change does not activate Telegram, a payment provider, credentials,
deployment, staging, migrations, or expert financial commands. Default server
composition is fail-closed: expert authentication resolves no principal, the
service proxies are disabled, the tariff binding resolves nothing, and the
checkout deadline cannot be created.

## Implementation

- Added one thin Fastify plugin for the four reviewed expert endpoints:
  referral redemption, self summary, server-bound residency quote, and
  checkout. It is registered through the existing app and lifecycle dependency
  injection; there is no second app or auth system.
- Authentication resolves a complete `ExpertPrincipal` and forwards that exact
  four-field value to the Task 8 services. The adapters do not access financial
  repositories. Missing, unavailable, stale, mutated, inactive, unverified,
  cross-expert, unknown-tariff, and substituted-owner outcomes fail closed
  without enumeration.
- Request schemas use exact property allowlists and bounded code,
  idempotency-key, and UUID shapes. Client/model price, credit, cash, inviter,
  interval, allocation, grant, payment, provider, and settlement authority is
  rejected before service invocation. Redemption lookup is rate-limited before
  the third attempt in the bounded negative test.
- Responses are hard projections. Summary exposes only decimal-string
  spendable/reserved/debt values and nearest expiry. Quote exposes only the
  server-derived quote. Checkout exposes only `kind`, `orderId`, and a
  provider-neutral `created` redirect/expiry or `pending_reconciliation`
  outcome; it excludes expert ownership, allocation, grant, ledger, payment ID,
  and provider fields.
- Added a read-only, self-scoped `ExpertPromptContext` composed solely from Task
  8 summary/quote services and a deterministic server tariff-version binding.
  It exposes no code plaintext/hash, repository handle, provider/payment ID,
  raw ledger/allocation, secret, or other expert data and has no mutation
  operation.
- Extended `IntentProposal` with exactly the four reviewed expert proposal
  kinds. Exact-key and bounded-shape validation treats model output only as
  untrusted data. Unsupported financial mutations and recursive
  authority-bearing fields are rejected as `unsupported_intent`; malformed
  authorized shapes retain the safe `invalid_shape` behavior. The conversation
  service has no expert principal, so an accepted expert proposal becomes a
  safe `unauthorized_scope` handoff and never a financial repository event.
- Added opaque `ct3` expert-command callbacks alongside the unchanged `ct2`
  reservation callbacks. The versioned discriminated claims bind expert,
  operation, object, version, expiry, and one-time nonce. Wrong Telegram
  identity, inactive/unverified binding, cross-expert/operation/object/version
  substitution, expiry, replay, and malformed authentication fail generically;
  storage failure preserves the existing infrastructure-error boundary. The
  issued token is 48 bytes, below Telegram's 64-byte ceiling.
- Added Telegram summary and quote renderers that accept only masked code state,
  validated decimal strings, canonical expiry, and the server quote. They do no
  financial/date calculation or mutation. Callback infrastructure failure maps
  to a redacted 503 before the webhook inbox is claimed; authorization failures
  remain generic 403 responses.

## Strict RED/GREEN evidence

First required slice, before production implementation:

```text
corepack pnpm vitest run apps/api/src/routes/expert-referral.test.ts apps/api/src/routes/telegram-webhook.test.ts packages/application/src/expert-prompt-context.test.ts packages/application/src/prompt-safety.test.ts
RED — 4/4 files failed; 6 failed and 39 passed. The route/context modules were
absent, webhook infrastructure failure returned 500 instead of 503, and the
five malicious fixtures returned invalid_shape instead of unsupported_intent.
```

Additional TDD slices were kept within the standing three-repeat cap:

```text
callback claims and Telegram rendering:
RED — 2 files failed; 15 tests failed because the interfaces were absent

app/server composition:
RED — 2 failed and 17 passed because the route group was not reachable

decimal projections and nested authority:
RED — 3 files failed; 5 failed and 54 passed

redemption lookup ceiling:
RED — the third attempt reached the service and returned 200 instead of 429

prompt context bounds/financial kind:
RED — 2 tests failed

checkout projection:
RED — payment/provider identity was disclosed

conversation proposal handling:
RED — the exact proposal produced unsupported instead of unauthorized_scope
```

Focused GREEN checkpoints progressed through 95/95 and 255/255. The final
focused command passed 9 files and 163/163 tests, including all five malicious
fixtures, exact proposal shapes, callback token length, replay/substitution,
safe response projections, app/server composition, and prompt context.

## Regression and guard evidence

```text
Focused plus prior callback/Telegram/conversation/Task 8/Task 9 regressions:
19 files, 286/286 tests passed

Task 8 PostgreSQL repository, redemption, checkout, deadline, settlement,
refund/reversal, and held-replay regressions:
13 files, 67/67 tests passed

Scope/dependency/env/admin guards plus release assets/workflow semantics:
8 files, 184/184 tests passed

bash -n scripts/deploy-compose-remote.sh scripts/validate-runtime-env.sh
exit 0

corepack pnpm --workspace-concurrency=1 -r --sort run build
exit 0 — all 10 workspace projects passed, including declarations

corepack pnpm -r --sort run typecheck
exit 0 — all 10 workspace projects passed

exact changed-TypeScript ESLint
exit 0 — zero findings

git diff --check
exit 0
```

An additional whole-repository `pnpm test` run passed 109 files and 993/994
tests. Its one failure was the untouched provider-deadline corrective-upgrade
fixture observing `expert_residency_commands_disabled` instead of its expected
legacy-ambiguity error while the full integration set ran in parallel. Two
bounded isolated retries then failed in testcontainers before assertions with
`Failed to connect to Reaper` (the second retry affected both tests). The
standing three-attempt cap was reached, so no further retry or speculative
product change was made. All Task 10 focused tests and the directly affected
Task 8 database regression set above remain green.

All new and previously formatted changed TypeScript files pass exact Prettier
checking. Whole-file checking already fails at the reviewed base for the six
compact legacy files touched by minimal semantic hunks:
`apps/api/src/app.test.ts`, `apps/api/src/routes/telegram-webhook.ts`,
`packages/application/src/conversation-service.test.ts`,
`packages/application/src/conversation-service.ts`,
`packages/application/src/ports.ts`, and
`packages/application/src/prompt-safety.test.ts`. Their new hunks were kept in
formatter form; the inherited files were not reformatted wholesale.

## AI release evidence

- Incident regression result: all five new malicious fixtures are rejected
  with `unsupported_intent`; all four prior malicious fixtures retain their
  existing safe rejection results.
- Proposal distribution/diff: the prior validator accepted 4 existing exact
  proposal kinds. It now additionally accepts exactly 4 expert proposal kinds
  as untrusted data; 5/5 new malicious financial proposals are rejected, and
  the nested/extra authority negative set is rejected. No expert proposal is
  converted into a financial event by the conversation service.
- Named human AI behavior spot-check: **PENDING — none supplied.** This report
  does not claim that gate is satisfied and does not authorize staging or
  activation.

## Self-review and concerns

- Confirmed the route and prompt modules have no database, payment-provider,
  credential, or network imports and accept no client-supplied amount or owner.
- Confirmed the checkout projection test injects allocation, grant, payment ID,
  and provider internals and proves none appear in the response.
- Confirmed all existing reservation callback contract/repository/migration
  tests remain unchanged and green; the new expert token remains at most 64
  bytes and is source-local until a later reviewed composition supplies a
  durable expert-command claims store.
- Confirmed default composition adds no environment flag or credential and
  cannot authenticate or execute an expert financial command.
- The shared worktree's unrelated protected edits in
  `apps/worker/src/runtime.ts` and `packages/config/src/env.ts` were excluded by
  isolated-worktree implementation and verification. They must remain
  unstaged and byte-for-byte unchanged when this commit is applied.
- Independent review and the named human AI spot-check remain outstanding.
  The unrelated broad-suite/Reaper failure above also remains visible for
  follow-up. This implementation makes no Task 10 completion or activation
  claim.

## Fix round 1/5 — reachable expert Telegram commands

### Findings addressed

- The package index now exports both `ct3` issue/verify functions, every new
  claim/store/operation/version-authority type, both expert Telegram renderers,
  and both renderer view types. A runtime index test proves all four function
  exports are defined; API compilation consumes the exported types rather than
  importing private source files. Only the exact approved index hash changed in
  the scope guard.
- Added an injectable, provider-neutral expert Telegram command processor. An
  opaque callback binds a server command ID; a current-command port supplies
  the authoritative version and then resolves the exact same expert,
  operation, object, and version. Plaintext referral code, idempotency data,
  tariff key, and checkout deadline remain in this server-side resolver and are
  absent from the token.
- `telegramWebhookRoutes` now accepts a request-local prepared callback. The
  verified processor closes over the exact principal and resolved command, so
  the route executes it after the existing inbox claim without a shared cache
  or generic dead port. The legacy boolean callback/process contract remains
  compatible.
- All four operations route to the Task 8 referral/residency services. Output
  is injected and hard-projected as redeemed, validated self-summary,
  validated server quote, or safe provider-neutral checkout outcome. The
  end-to-end route test injects allocation, grant, payment, and provider facts
  and proves they do not reach output.
- `ct3` verification now asks an authoritative port for the current version
  after authenticating the binding and before token consumption. Stale version,
  expert, operation, and object substitution all fail without consuming a
  still-valid token. Existing `ct2` code and contracts are unchanged.
- HTTP summary now also verifies `summary.expertId` equals the authenticated
  principal at the adapter boundary. A cross-expert result returns the same
  generic 403 and leaks none of its owner or balance data.
- Verification-side `peek` and `consumeIfValid` infrastructure failures are
  exercised with real issued tokens and fail-once stores. Both preserve the
  typed `CallbackInfrastructureError`; the following retry succeeds, proving
  the token was not consumed.
- Default lifecycle composition remains unchanged and disabled. No live
  binding/store/output implementation, provider, credential, environment flag,
  network call, migration, or activation was added.

### Strict RED/GREEN evidence

```text
corepack pnpm vitest run packages/integrations/src/telegram/callback-token.test.ts
RED — 1 file failed; 10 failed and 2 passed. Production still treated the new
authoritative-version port as caller-supplied operation/object expectations;
stale-version and verification-side infrastructure paths could not satisfy the
intended contract.

corepack pnpm vitest run packages/integrations/src/index.test.ts apps/api/src/expert-telegram-command.test.ts apps/api/src/routes/expert-referral.test.ts
RED — 3/3 files failed; 2 failed and 11 passed plus one missing-module suite.
Package runtime exports were undefined, the processor did not exist, and a
cross-expert summary returned 200 instead of 403.

focused implementation plus exact scope/dependency guards:
GREEN — 8 files, 181/181 tests passed.
```

### Final fix-round verification

```text
focused/prior Telegram, ct2 repository/migration, API/app/server/admin, Task 8
service, prompt, and conversation regressions:
19 files, 273/273 tests passed

scope/dependency/env/admin/architecture/release/workflow guards:
9 files, 198/198 tests passed

bash -n scripts/deploy-compose-remote.sh scripts/validate-runtime-env.sh
exit 0

corepack pnpm --workspace-concurrency=1 -r --sort run build
exit 0 — all 10 workspace projects passed, including declarations

corepack pnpm -r --sort run typecheck
exit 0 — all 10 workspace projects passed

exact changed-TypeScript ESLint, exact changed-file Prettier, and git diff check
exit 0
```

The only touched compact legacy formatter exception is
`apps/api/src/routes/telegram-webhook.ts`; it is already a whole-file Prettier
failure at reviewed base `f75deac`. Its new prepared-callback hunks were matched
to formatter output without reformatting inherited code.

The named human AI behavior spot-check remains **PENDING — none supplied**.
The known provider-deadline fixture is intentionally unchanged and remains
carried to Task 12 as directed. Independent re-review is required; this fix
round makes no completion or activation claim.
