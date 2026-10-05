---
title: Public client catalogue and structured selection
type: feature
status: in-review
created: 2026-10-05
baseline_commit: 69aeacffead39d69da087a3ecdaed6a65e2e5d51
context:
  - AGENTS.md
  - docs/superpowers/implementation-artifacts/spec-client-sensitive-consent.md
  - docs/operations/client-web-account.md
  - docs/superpowers/plans/2026-10-05-public-client-catalog.md
---

## Intent

Implement the public catalogue portion of factory AC-003, AC-007 and AC-020.
People must be able to browse published services and select ordinary service and
language preferences without login, content consent, a private story, payment or
external AI. This is the next increment of the owner's already approved complete
factory implementation, not a replacement for its remaining requirements.

## Boundaries

The implementer is the sole product-code writer for this increment. Main owns
external operations and sibling specs/plans. Preserve the existing cabinet,
authentication, expert, payment and publication predicates. No deployment, pushes,
production writes, new packages, schema migrations, fixture services in live,
changes to user-owned untracked files or unrelated refactoring. If an equivalent
safe design fits the existing architecture better, document the reason.

## Code Map

- `packages/db/src/repositories/catalog-repository.ts` already exposes
  `listPublicServices({limit:20})`; only verified active experts and active services
  with non-null code/language qualify, ordered deterministically. Reuse it.
- `apps/api/src/app.ts`: add an optional public read dependency and register its
  route outside the authenticated browser/client plugins. With no dependency the
  route returns unavailable, never a successful fake empty list.
- `apps/api/src/server.ts`: default composition supplies the real catalogue
  repository read independently of client session/catalog and provider flags.
- Create `apps/api/src/routes/public-client-catalog.ts` and tests: public GET
  `/v1/public/catalog`, only `{items:[{displayName,serviceCode,language}]}`, <=20.
  Explicitly copy/validate these fields; never spread database rows. Reject
  malformed/oversized returned data as fixed 503. Genuine no rows is 200 empty.
- `apps/web/src/main.ts`: route `/catalog`; create catalog client/view modules
  and tests. Link it from landing and shared cabinet navigation. Preserve style.

## Tasks & Acceptance

- [x] Write focused RED behavior tests against the existing app (route 404 is a
      meaningful missing-feature failure). Implement stateless route/composition.
      Given any anonymous caller, return the same public projection without principal
      resolution, Set-Cookie, private identifiers, filters, persistence or providers.
      Query parameters, request bodies and unsupported methods are rejected before
      repository access and never echoed. GET/HEAD are the only supported methods;
      no-store and no-referrer headers apply to all responses.
- [x] Validate rows: nonblank strings, displayName <=200, serviceCode <=64,
      language <=32, no control characters, max20 records. Malformed data or thrown
      repository failure returns fixed 503, not an empty catalogue or stacktrace.
      Public projection strips sourceKey, contacts, profiles, identifiers and unknown
      fields even when malicious fixture rows contain them.
- [x] Implement `/catalog` with loading, honest empty, error/retry and successful
      states. Exact fixed fetch URL; credentials omit, cache no-store, redirect error,
      referrerPolicy no-referrer, bounded request/body timeout. No session probe,
      Telegram SDK, cookies/storage access or analytics with filters. Escape all text.
- [x] Add two local select filters populated only from returned public serviceCode
      and language values. No free text. Changing filters never persists or sends a
      request, and clearing filters restores items. Distinguish filtered-empty from
      genuinely no published services. Do not invent descriptions, slots, prices or
      bookable actions. Copy: «Каталог можно смотреть без входа. Личный запрос здесь
      вводить не нужно.» Empty: «В каталоге пока нет опубликованных услуг.»
- [x] Verify API/web tests, default production composition and actual DOM/browser
      behavior. Confirm existing catalogue repository eligibility tests still hold
      through a single focused file if needed; PG/concurrency file max3. Do not run a
      full suite or multi-path Vitest command; main owns one final aggregate run.
      Relevant typechecks/lint, build and git diff --check required. Record exact
      commands, failures and final results below. Do not mark complete without review.

## Verification Matrix

| Given / when                           | Expected                                        |
| -------------------------------------- | ----------------------------------------------- |
| No cookies or consent / load catalogue | Public items, no session/private calls          |
| Extra secret fields in eligible rows   | Only 3 explicit public fields returned          |
| Malformed row or database outage       | Fixed 503; UI failure, not empty-success        |
| Unknown query/body/mutation            | Rejected before DB access, no echo              |
| Literal HTML in public name            | Displayed as text, no script or image execution |
| Known local filters                    | Only matching rows, no new HTTP/storage writes  |
| Zero rows vs filters matching none     | Distinct honest empty states                    |
| Hung/late request and retries          | Bounded wait, no stale overwrite or stuck UI    |

## Results

Implemented on baseline `69aeacffead39d69da087a3ecdaed6a65e2e5d51`, with
uncommitted source changes ready for main's independent review. Implementation
checkboxes are verified; independent review and release completion remain separate.

### Changes

- Added the always-registered public API and its optional read dependency; default
  production composition supplies `PostgresCatalogRepository` independently of
  client-session/catalog/provider flags. Existing eligibility SQL is unchanged.
- GET/HEAD expose at most twenty explicitly validated three-field items. Missing
  dependency, malformed rows and repository exceptions produce fixed 503 errors.
  Query/body/mutation requests are rejected before repository access; responses
  carry no-store/no-referrer and set no cookies. Explicit HEAD handling suppresses
  response bodies, including errors.
- Added `/catalog`, credential-free fixed-URL fetch with a ten-second request/body
  deadline, safe rendering, loading/empty/error/retry states, two local selectors
  and filter reset. Landing (including mobile-visible hero) and cabinet navigation
  link to it. No session probing, storage, SDK or provider calls were introduced.
- Added a maintained real-browser regression script using existing Playwright and
  Chrome, built assets, loopback HTTP and synthetic public records only.

### Verification commands and results

All Vitest commands below ran separately, with exactly one file per invocation.
No aggregate/full suite, dependency installation, migration authoring, commit,
push, deployment, production write or sibling-spec edit was performed.

| Command                                                                                                                                                                                  | Result                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pwsh -File scripts/check-development-environment.ps1`                                                                                                                                   | PASS; Node 24.21.0, pnpm 11.9.0                                                                                                                                                                                                                                                         |
| `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`                                                                                                                    | PASS before PostgreSQL verification                                                                                                                                                                                                                                                     |
| `pnpm exec vitest run apps/api/src/routes/public-client-catalog.test.ts`                                                                                                                 | RED: 34 missing-route 404 failures. First implementation: 32 passed, two failures. Final: 34/34 PASS                                                                                                                                                                                    |
| `pnpm exec vitest run apps/api/src/public-client-catalog-composition.test.ts`                                                                                                            | RED: 404; GREEN: 1/1 PASS through real default composition/repository with only DB execution doubled                                                                                                                                                                                    |
| `pnpm exec vitest run apps/web/src/catalog-client.test.ts`                                                                                                                               | RED: 4 failed, 17 passed against unavailable skeleton; GREEN: 21/21 PASS                                                                                                                                                                                                                |
| `pnpm exec vitest run apps/web/src/catalog-view.test.ts`                                                                                                                                 | RED: 5 failures; GREEN: 5/5 PASS                                                                                                                                                                                                                                                        |
| `II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya_test@127.0.0.1:33110/postgres pnpm exec vitest run tests/integration/client-catalog-worker.test.ts`                              | 2/2 PASS; one PostgreSQL run, isolated user-provided PG17.5. Existing eligibility and deterministic twenty-row cap preserved                                                                                                                                                            |
| `pnpm exec vitest run apps/web/src/landing-view.test.ts`                                                                                                                                 | 8/8 PASS                                                                                                                                                                                                                                                                                |
| `pnpm exec vitest run apps/web/src/consent-view.test.ts`                                                                                                                                 | 1/1 PASS                                                                                                                                                                                                                                                                                |
| `pnpm --filter @ii-tonya/api typecheck`                                                                                                                                                  | PASS                                                                                                                                                                                                                                                                                    |
| `pnpm --filter @ii-tonya/web typecheck`                                                                                                                                                  | PASS                                                                                                                                                                                                                                                                                    |
| `pnpm exec tsc --noEmit -p tsconfig.tests.json`                                                                                                                                          | Initially failed: test cast used Fastify HTTPMethods, broader than injection accepts. Changed to InjectOptions method type; recheck PASS                                                                                                                                                |
| `pnpm --filter @ii-tonya/api build`                                                                                                                                                      | PASS, including declarations                                                                                                                                                                                                                                                            |
| `pnpm --filter @ii-tonya/web build`                                                                                                                                                      | PASS                                                                                                                                                                                                                                                                                    |
| `PLAYWRIGHT_MODULE_PATH=/usr/lib/node_modules/@playwright/mcp/node_modules/playwright CHROME_EXECUTABLE=/opt/google/chrome/chrome node scripts/verify-public-client-catalog-browser.mjs` | PASS: actual DOM and Window.fetch; loading, HTML/options safety, local filtering/reset without requests, empty vs filtered-empty, 503/malformed data, hung request/body deadlines, retry and late completion, focus, 390px mobile layout, no cookies/storage/SDK/private/external calls |
| `node --check scripts/verify-public-client-catalog-browser.mjs`                                                                                                                          | PASS                                                                                                                                                                                                                                                                                    |
| `git diff --check`                                                                                                                                                                       | PASS                                                                                                                                                                                                                                                                                    |

Changed-file lint command (initial unused test argument corrected; final PASS):

```sh
pnpm exec eslint apps/api/src/app.ts apps/api/src/server.ts apps/api/src/routes/public-client-catalog.ts apps/api/src/routes/public-client-catalog.test.ts apps/api/src/public-client-catalog-composition.test.ts apps/web/src/catalog-client.ts apps/web/src/catalog-client.test.ts apps/web/src/catalog-view.ts apps/web/src/catalog-view.test.ts apps/web/src/main.ts apps/web/src/landing-view.ts apps/web/src/consent-view.ts scripts/verify-public-client-catalog-browser.mjs
```

Changed-file formatting command (PASS):

```sh
pnpm exec prettier --check apps/api/src/app.ts apps/api/src/server.ts apps/api/src/routes/public-client-catalog.ts apps/api/src/routes/public-client-catalog.test.ts apps/api/src/public-client-catalog-composition.test.ts apps/web/src/catalog-client.ts apps/web/src/catalog-client.test.ts apps/web/src/catalog-view.ts apps/web/src/catalog-view.test.ts apps/web/src/main.ts apps/web/src/landing-view.ts apps/web/src/consent-view.ts apps/web/src/styles.css scripts/verify-public-client-catalog-browser.mjs docs/superpowers/implementation-artifacts/spec-public-client-catalog.md
```

The two intermediate API failures revealed that Fastify's explicit all-method
route needs HEAD body suppression, and the injection harness normalizes a trailing
empty `?`. HEAD was fixed; the empty-query test now uses actual loopback HTTP.
Both final behavior tests pass. The malformed-row table was also corrected to
pass each array as one fixture, rather than spreading its entries as arguments.

### Remaining obligations and limits

- Main owns independent adversarial review, its one aggregate run and exact-SHA
  release gates. This harness has no subagent tool; the author's separate review
  pass is not independent approval. Full factory, live release and legal
  publication remain separate obligations; no percentage completion is inferred.
- The browser regression uses synthetic responses; PostgreSQL eligibility and
  production composition were verified separately, not as a deployed browser/DB
  sequence. No live inventory or provider availability is claimed.
- Filters intentionally operate only on the returned maximum of twenty services;
  no pagination, free-text entry, prices, slots or booking actions are added.

### 2026-10-05 independent-review PATCH remediation

Main completed all three independent review layers and authorized one PATCH batch.
The existing `in-review` state and checked implementation tasks are preserved.
Review-remediation closure is **pending main's receipt/acceptance of the final
frozen-source report**. No new approval round or wholesale re-derivation occurred.

Accepted fixes implemented:

1. Register every method in Node's `http.METHODS` through the installed Fastify
   `addHttpMethod` API before `app.all`. Actual HTTP PROPFIND/MKCOL with a private
   query return fixed 405; chunked GET/HEAD without Content-Length return fixed
   400, with no repository access, input echo or missing privacy headers.
2. Share process admission across production app instances: sixty requests per
   sixty-second window under one fixed key and at most two outstanding repository
   promises. Return fixed 429/503 and only content-free diagnostic reason enums.
   The HTTP wait expires at three seconds; its permit remains occupied until the
   actual promise resolves or rejects. The default read runs in a transaction with
   `SET LOCAL lock_timeout = '1s'` then `statement_timeout = '2s'`. The repository
   constructor now accepts `Pick<DrizzleDb, "execute">`; publication SQL is intact.
3. Explain the first-twenty limit in the UI and scope counts and filtered-empty
   copy to loaded services. Service codes remain literal: the suggested invented
   business-label mapping was rejected because no approved source exists.
4. Apply matching API/client text rules: reject bidi controls and strings composed
   only of whitespace, format/default-ignorable characters, combining marks or
   braille blank; retain useful ZWJ within visible names.
5. Read at most 65,536 response bytes before JSON parsing. Reject an oversized
   Content-Length or streamed overflow and cancel the stream, without awaiting
   cancellation beyond the existing ten-second whole-request/body deadline.
   Incremental UTF-8 decoding preserves multibyte characters split across chunks.
6. Check retry focus ownership after the awaited response and before rendering;
   never take focus back after a user moves away. Use a labelled catalogue section
   inside the existing root main, avoiding a second main landmark.
7. Wait for the initial request to enter the harness's held list before changing
   response mode. Observe every browser request, allowing only catalogue document
   navigation, the exact public endpoint and existing built assets; same-origin
   analytics calls are also rejected/reported.
8. Add the normal single-file `catalog-binding.test.ts` regression using a minimal
   DOM double and the actual binding. Keep the real-browser harness as separate
   evidence for browser parsing, transport and focus behavior.

Remediation verification (each Vitest invocation named one file):

| Command                                                                                                                                                                                  | RED / final result                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`                                                                                                                    | PASS before implementation/PG checks; Node 24.21.0 / pnpm 11.9.0                                                                                                                                                                                                                            |
| `pnpm exec vitest run apps/api/src/routes/public-client-catalog.test.ts`                                                                                                                 | RED 22 failed / 36 passed; GREEN 58/58, then 59/59 after adding the default process-sharing regression. Three invocations in this remediation batch                                                                                                                                         |
| `pnpm exec vitest run apps/api/src/public-client-catalog-composition.test.ts`                                                                                                            | RED 1 failed because the read escaped the transaction; GREEN 1/1, verifies both SET LOCAL statements precede the actual repository SELECT                                                                                                                                                   |
| `II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya_test@127.0.0.1:33110/postgres pnpm exec vitest run tests/integration/client-catalog-worker.test.ts`                              | RED 1 failed / 2 passed because the locked read succeeded after release; GREEN 3/3, with SQLSTATE 55P03 and transaction-local settings reset. Exactly two remediation runs; **3/3 total file budget used**, including original verification                                                 |
| `pnpm exec vitest run apps/web/src/catalog-client.test.ts`                                                                                                                               | RED 19 failed / 23 passed; GREEN 42/42, including byte cap/cancellation, exact 64KiB, split UTF-8, invisible/bidi rejection, visible ZWJ, and deadlines                                                                                                                                     |
| `pnpm exec vitest run apps/web/src/catalog-view.test.ts`                                                                                                                                 | RED 2 failed / 3 passed; GREEN 5/5                                                                                                                                                                                                                                                          |
| `pnpm exec vitest run apps/web/src/catalog-binding.test.ts`                                                                                                                              | RED 2 failed / 2 passed (subset count and focus theft); GREEN 4/4                                                                                                                                                                                                                           |
| `pnpm --filter @ii-tonya/api typecheck`                                                                                                                                                  | PASS                                                                                                                                                                                                                                                                                        |
| `pnpm --filter @ii-tonya/web typecheck`                                                                                                                                                  | Initial failure in test helper's optional Response headers; corrected by omitting absent headers, final PASS                                                                                                                                                                                |
| `pnpm --filter @ii-tonya/db typecheck`                                                                                                                                                   | PASS                                                                                                                                                                                                                                                                                        |
| `pnpm exec tsc --noEmit -p tsconfig.tests.json`                                                                                                                                          | Same optional-header test typing failure corrected; final PASS                                                                                                                                                                                                                              |
| `pnpm --filter @ii-tonya/db build`                                                                                                                                                       | PASS, refreshes declarations for the narrowed constructor                                                                                                                                                                                                                                   |
| `pnpm --filter @ii-tonya/api build`                                                                                                                                                      | PASS                                                                                                                                                                                                                                                                                        |
| `pnpm --filter @ii-tonya/web build`                                                                                                                                                      | PASS                                                                                                                                                                                                                                                                                        |
| `PLAYWRIGHT_MODULE_PATH=/usr/lib/node_modules/@playwright/mcp/node_modules/playwright CHROME_EXECUTABLE=/opt/google/chrome/chrome node scripts/verify-public-client-catalog-browser.mjs` | Initial failure in the old unconditional focus assertion: Chrome disabling the retry can move focus to body. The harness now holds the retry and checks actual focus ownership at response handling. Final PASS, including an actual Tab-away case, request allowlist and one main landmark |
| `node --check scripts/verify-public-client-catalog-browser.mjs`                                                                                                                          | PASS                                                                                                                                                                                                                                                                                        |
| `git diff --check`                                                                                                                                                                       | PASS; new source files also checked with `git diff --no-index --check /dev/null <file>`                                                                                                                                                                                                     |

The final six focused files contain **114 passing tests**. This is not an aggregate
suite claim. Changed-file lint passed. The final formatting check requested a
second formatting pass on the route's chained error response; only line wrapping
changed, then the formatting check passed. Changed-file lint/format commands:

```sh
pnpm exec eslint apps/api/src/app.ts apps/api/src/server.ts apps/api/src/routes/public-client-catalog.ts apps/api/src/routes/public-client-catalog.test.ts apps/api/src/public-client-catalog-composition.test.ts packages/db/src/repositories/catalog-repository.ts tests/integration/client-catalog-worker.test.ts apps/web/src/catalog-client.ts apps/web/src/catalog-client.test.ts apps/web/src/catalog-view.ts apps/web/src/catalog-view.test.ts apps/web/src/catalog-binding.test.ts scripts/verify-public-client-catalog-browser.mjs
pnpm exec prettier --check apps/api/src/app.ts apps/api/src/server.ts apps/api/src/routes/public-client-catalog.ts apps/api/src/routes/public-client-catalog.test.ts apps/api/src/public-client-catalog-composition.test.ts packages/db/src/repositories/catalog-repository.ts tests/integration/client-catalog-worker.test.ts apps/web/src/catalog-client.ts apps/web/src/catalog-client.test.ts apps/web/src/catalog-view.ts apps/web/src/catalog-view.test.ts apps/web/src/catalog-binding.test.ts scripts/verify-public-client-catalog-browser.mjs docs/superpowers/implementation-artifacts/spec-public-client-catalog.md docs/superpowers/plans/2026-10-05-public-client-catalog.md
```

Operational limit: acquiring a connection can still await internally, and HTTP
timeout does not cancel that acquisition or a database promise. At most two such
public operations remain outstanding; admission stays closed until they settle.
The limits are per process, not distributed across hosts. No new pool, global
database settings, schema, provider capability or deployment behavior was added.
No production-data, external-CI, aggregate-run or release claim follows from these
local results. Main retains aggregate/release ownership after the source freeze.

## Suggested Review Order

**Anonymous entry and fail-closed HTTP boundary**

- Register public access outside authenticated plugins, independently of private feature flags.
  [app.ts:258](../../../apps/api/src/app.ts#L258)

- Handle Node-supported methods before inspecting input; reject private input without echo or repository access.
  [public-client-catalog.ts:30](../../../apps/api/src/routes/public-client-catalog.ts#L30)

- Validate visible Unicode and explicitly project only the three public fields.
  [public-client-catalog.ts:107](../../../apps/api/src/routes/public-client-catalog.ts#L107)

**Anonymous load and database wait bounds**

- Share admission per process; retain occupied slots beyond HTTP timeout until actual database settlement.
  [public-client-catalog.ts:77](../../../apps/api/src/routes/public-client-catalog.ts#L77)

- Wrap the existing public read in transaction-local lock and statement deadlines.
  [server.ts:379](../../../apps/api/src/server.ts#L379)

**Bounded browser transport and validation**

- Cap response bytes before parsing, cancel overflow, and decode split UTF-8 safely.
  [catalog-client.ts:16](../../../apps/web/src/catalog-client.ts#L16)

- Keep one fixed credential-free URL and a whole-request-plus-body deadline with fixed errors.
  [catalog-client.ts:91](../../../apps/web/src/catalog-client.ts#L91)

**Local selection, honest scope, and accessible navigation**

- Route catalogue rendering without triggering account/session initialization.
  [main.ts:21](../../../apps/web/src/main.ts#L21)

- Label the first-twenty subset and use a section inside the existing main landmark.
  [catalog-view.ts:15](../../../apps/web/src/catalog-view.ts#L15)

- Populate selectors locally; preserve focus moved elsewhere while a retry waits.
  [catalog-view.ts:85](../../../apps/web/src/catalog-view.ts#L85)

- Expose catalogue navigation from landing, including the mobile-visible hero.
  [landing-view.ts:38](../../../apps/web/src/landing-view.ts#L38)

- Add catalogue access to shared cabinet navigation without rewriting existing account behavior.
  [consent-view.ts:32](../../../apps/web/src/consent-view.ts#L32)

**Supporting types, presentation, and regression evidence**

- Accept transaction execution without changing repository eligibility predicates.
  [catalog-repository.ts:54](../../../packages/db/src/repositories/catalog-repository.ts#L54)

- Reuse card styling and keep selectors responsive without horizontal overflow.
  [styles.css:1531](../../../apps/web/src/styles.css#L1531)

- Pin real DAV/chunked transport rejection and process-wide rate, concurrency, and late-settlement behavior.
  [public-client-catalog.test.ts:191](../../../apps/api/src/routes/public-client-catalog.test.ts#L191)

- Exercise default composition and assert both local deadlines precede the repository SELECT.
  [public-client-catalog-composition.test.ts:9](../../../apps/api/src/public-client-catalog-composition.test.ts#L9)

- Inspect existing PostgreSQL lock-timeout evidence; the focused file's three-run budget is exhausted.
  [client-catalog-worker.test.ts:57](../../../tests/integration/client-catalog-worker.test.ts#L57)

- Pin byte limits, oversized unknown fields, split UTF-8, and visible-name joiners.
  [catalog-client.test.ts:158](../../../apps/web/src/catalog-client.test.ts#L158)

- Verify escaped output, distinct empty states, and navigation links.
  [catalog-view.test.ts:48](../../../apps/web/src/catalog-view.test.ts#L48)

- Exercise actual selector/change/reset/retry binding with a minimal DOM double.
  [catalog-binding.test.ts:91](../../../apps/web/src/catalog-binding.test.ts#L91)

- Inspect real-browser request allowlisting, held-response synchronization, focus ownership, and mobile checks.
  [verify-public-client-catalog-browser.mjs:105](../../../scripts/verify-public-client-catalog-browser.mjs#L105)
