# Expert authenticated entry — implementation evidence

Spec: docs/superpowers/implementation-artifacts/spec-expert-authenticated-entry.md.
Baseline690797db64fd80aa1aeccea8003543de470d8c16, shared codex/planerka-api.
In progress, no release or billing activation. No nested agents/provider calls.

All four frontmatter context files read in full (long status read in chunks).
Fresh RequireDocker preflight passed Node24.21.0/pnpm11.9.0/Docker29.9.0.
Existing financial correction files and exhausted tests excluded.

## Planned focused allocations

- tests/integration/expert-session-entry.test.ts: RED1, implementation2 after
  ordinary API composition is added, coordinator review3. Used3/3, exhausted.
- apps/api/src/expert-authentication.test.ts: used2/3; coordinator reserves3.
- apps/web/src/expert-account-browser.test.ts: used3/3, exhausted, synthetic
  race cases plus actual rendered/composed login, no provider calls.

Ruling: use existing client body parser as syntax-only mechanics, but separate
expert proof/token/session authority; no client tokens or permissions promoted.
Ruling: main owns existing migration guard edits despite task-plan wording;
report metadata counts/hashes rather than edit those guards.
Migration0049 is next free at initial journal check. Recheck before writing.

## Executed RED evidence (recorded late; do not repeat)

- PG RED1, 2026-10-12 20:56:54 UTC, session2394, exit1, duration5.71s:
  focused `pnpm exec vitest run tests/integration/expert-session-entry.test.ts`
  with II_TONYA_TEST_POSTGRES_ADMIN_URL targeting the authorized retained synthetic
  PostgreSQL17.5. 12 failed, 0 passed. Eleven behavioral failures against the
  imported denied/null scaffold; the expired-proof case reached missing-table
  SQL42P01 after its denial assertion passed, not an independent behavioral RED.
- API RED1, 2026-10-12 20:59:44 UTC, session9626, exit1, duration3.14s:
  focused `pnpm exec vitest run apps/api/src/expert-authentication.test.ts`.
  4 failed, 6 passed: missing proof/token/config/route behavior.
- These executions preceded the corresponding implementation. This ledger was
  not updated promptly; its previous0/3 entries were stale, not run authority.
  At that checkpoint no implementation/GREEN run had occurred; later runs below.
- Source correction after RED: owner/channel reassignment now inserts a fresh
  user without an expert, avoiding experts.user_id UNIQUE fixture failure that
  the RED scaffold's earlier issuance failure had masked. Correction unrun.

Implementation remains pending review and composed verification; see later
metadata and execution results below rather than the initial checkpoint.

Browser RED1 executed once with
`pnpm exec vitest run apps/web/src/expert-account-browser.test.ts` against a
compileable empty page/client scaffold. Used1/3. Session78781 exit1, start
21:09:31 UTC, duration507ms:5 failed/0 passed. Four failures are missing page/
login/logout behavior; the account-switch case failed because the scaffold did
not call fetch, so its deferred callback was never set (not a proven race RED).
This initial set tests state/request semantics, not Chrome yet.

Static package builds DB/application/config/worker passed (session32516 exit0).
API typecheck session80216 passed; subsequent worker-app filter did not match
and is not counted as verification.

0049 metadata reconstructed with
`II_TONYA_TEST_POSTGRES_ADMIN_URL=<authorized synthetic target> pnpm exec tsx .cache/expert-session-entry/reconstruct.ts`.
Session36093 exit0: actual170005;120 tables,39 functions,70 noninternal triggers,
792 constraints,331 indexes; btree_gist1.7/pgcrypto1.3. Prior SQL hashes checked
against0048 manifest unchanged. Fresh introspection normalized from pg_catalog;
no generate, no prior metadata edits. Owned temporary DB/directory cleaned.
Main owns existing guards. No additional SQL function/trigger authority introduced.

API implementation2 invoked once:
`pnpm exec vitest run apps/api/src/expert-authentication.test.ts`.
Allocation2/3. Session78176 exit0,21:15:15 UTC,duration3.49s:23/23 PASS.
Third reserved for coordinator. These are transport/proof tests, not PG/browser
composition evidence. Web/API/worker-app typechecks session18415 passed after
correcting a test-only config import (no new dependency).

PG implementation2 invoked once:
`II_TONYA_TEST_POSTGRES_ADMIN_URL=<authorized synthetic PG17.5 target> pnpm exec vitest run tests/integration/expert-session-entry.test.ts`.
Allocation2/3. Session12364 exit1,21:15:36 UTC,duration1.07s: collection failed,
0 tests executed (root test imported workspace-only @ii-tonya/config).
Corrected to source-relative config and explicit built DB barrel (worker spy must
observe the same class as ordinary composition). No retry. Third remains reserved.
Main's compatibility correction arrived after invocation:0049 must cascade
channel deletion to sessions and SET NULL nullable receipt link, retaining proof
consumption. Added to the SAME test file for coordinator3; not claimed exercised.

Compatibility metadata reconstructed again with the same helper/command,
session89529 exit0. Counts unchanged120/39/70/792/331; actual170005; prior0..48
SQL hashes unchanged. Channel FK now CASCADE; receipt link nullable SET NULL.
No old migrations or existing guard tests touched. Temporary DB/output cleaned.

Browser implementation2 invoked once:
`II_TONYA_TEST_POSTGRES_ADMIN_URL=<authorized synthetic PG17.5 target> pnpm exec vitest run apps/web/src/expert-account-browser.test.ts`.
Session56291 exit1,21:16:59 UTC,duration6.27s:5 passed/1 failed;2/3 used,
coordinator reserves3. Five state/request cases passed. Composed Chrome case
issued a real session (POST201), but final DB asserted revoked1 vs actual0.
No DELETE was observed. Source diagnosis: its no-leak assertion inspected all
body HTML, including its own script literal `es1.`, so it always aborted before
logout. The PASS substring assertion also matched its own script source.
Corrected to inspect rendered #app HTML and strip script nodes before checking
the actual result marker. Corrections UNRUN; no composed success claimed.

## Stable source handoff

Author stopped at2/3 for EACH new file. No run3, old test, full suite, provider
call, commit/push or production mutation. Independent review and coordinator
runs remain required; no release/commercial completion claim.

Ordinary API lifecycle now composes signed Telegram verification, exact existing
verified owner/channel lookup, atomic proof/session issuance and es1 bearer.
The browser facade and actual /expert/account page use separate HttpOnly cookies
and stale-response fencing. Normal worker factory forwards bounded100-row cleanup
to processorPrivacy; failures propagate. Financial startup guard stays intact.

Exact new source/test paths:

- packages/application/src/expert-session-service.ts
- packages/db/src/repositories/expert-session-repository.ts
- packages/db/src/schema/expert-sessions.ts
- packages/db/migrations/0049_expert_sessions.sql
- packages/db/migrations/meta/0049_snapshot.json
- packages/db/migrations/state/0049_sql_objects.json
- packages/db/migrations/state/0049_manifest.json
- apps/api/src/expert-session-token.ts
- apps/api/src/telegram-expert-proof.ts
- apps/api/src/routes/expert-sessions.ts
- apps/api/src/routes/expert-browser-session.ts
- apps/api/src/expert-authentication.test.ts
- apps/web/src/expert-account-client.ts
- apps/web/src/expert-account-view.ts
- apps/web/src/expert-account-browser.test.ts
- tests/integration/expert-session-entry.test.ts

Modified existing paths (review expert-session additions, not unrelated dirty
work): `.env.example`, apps/api/src/{app.ts,server.ts,expert-principal-resolver.ts},
apps/web/src/{main.ts,landing-view.ts}, apps/worker/src/{main.ts,runtime.ts},
packages/config/src/env.ts, packages/worker/src/data-retention.ts,
packages/application/src/index.ts, packages/db/src/{index.ts,schema/index.ts},
packages/db/migrations/meta/_journal.json. This evidence tracks progress.
No dependency added. Some touched legacy source was formatter-normalized.

Final static verification:

- Session67441 exit0: `pnpm exec tsc --noEmit -p tsconfig.tests.json`, then
  `pnpm --filter <package> typecheck` for @ii-tonya/db, application, config,
  worker, api, app-worker and web; all PASS.
- Session75429 exit0: scoped `pnpm exec eslint` over all TypeScript paths above,
  including modified barrels/composition, then `git diff --check`; PASS.
- Session83434 exit0: Prettier over touched composition/config/worker/schema/
  tests/evidence. Session21831 formatted new API/application/web/DB modules.
  Final source types/lint followed formatting.
- Session33676 exit0: final DB build and tests typecheck after FK/import fix.
  DB/application/config/worker builds also passed earlier.

Final0049 hashes:

- SQL:16879993d7d348e702ba87c474874add76e011ce019d1679b6a0650fe0484373
- snapshot:6a923813ffc7c082190b57a97cf874e3b4faf6254cd39b15bcf15c25ee57cdf1
- supplement:33b20e12f0c22954f81939d4f0cf599b1dee1ecd51415783166fa58fe5655210
- manifest:72cca9486c7d684087b2a0d1b1545150ce40c5f1bd7cd96bb13a5343848b1853

Review focus and remaining uncertainty:

- PG source21 cases, but implementation2 collected0. Bearer composition,
  owner reassignment, row-lock expiry, worker retention and erasure/replay await
  coordinator3. Metadata replay and Chrome POST201 do not prove these cases.
- Browser source6 cases: last5/6, corrected composed assertion UNRUN. Local
  self-signed HTTPS/Chrome forwards actual browser requests to outer buildApp;
  no deployed process or external Telegram call is claimed.
- Review mapping-table SHARE→user→expert lock order and contention with existing
  writers. Bounded failures stay closed; independent security review is pending.
- Production needs0049 and explicitly reviewed EXPERT_SESSION_ENABLED settings:
  bot-token secret reference, bot scope, HTTPS origin and username. Default off.
  No account creation, expert verification or financial authority is granted.
  Receipt contacts, saved quotes, checkout and financial composition are separate
  downstream gates, not completed by this increment.

Source stable for independent review; no live tool/test/write session at handoff.

## Coordinator run3 and review correction (supersedes stable handoff above)

Coordinator reports PG session82838 exit1,21:20:17 UTC,duration11.38s:
19/21 PASS. Only two expiry-fixture statements failed23514: independent
clock_timestamp calls made the intended1-hour lifetime exceed its bound by1us.
Both fixtures now use statement_timestamp for created/expiry (also receipt pairs).
Production lifetime constraint unchanged. Ordinary composed issue/revoke,
channel erasure/replay and owner cases passed in that execution.

Coordinator reports browser session28920 exit1,21:20:22 UTC,duration6.85s:
5/6 PASS; stripped DOM had empty #app and FAIL:render_timeout. Source had two
independent module scripts: automation could exhaust virtual-time polling while
the real main.ts module graph was still loading. Changed to await import of the
actual main.ts inside the automation's try block before starting render polling.
Module failure now reaches the FAIL marker directly. This removes the source
scheduling race; without another authorized run the observed cause/resolution
is not conclusively verified. No timeout increased, mocked page or principal.

PG/browser budgets3/3 EXHAUSTED. No reruns after these failures. API last23/23
at2/3; no additional API run by author. Owner extra-run permission pending.

Kant P1/P2 corrections in SAME scope, source-first under no-run instruction:

- Signed sender externalId plus exact botKey/private-chat mapping snapshot flows
  from resolver/proof through issue into expert_sessions. Under-lock issuance,
  lookup and revoke compare all three fields, not only channel row UUID.
  Same-row sender/scope/private-chat remap regressions added to the PG file;
  signed-id/resolver mismatch added to the API file.0049 adds three columns and
  expert_sessions_identity CHECK; metadata must be reconstructed below.
- Client guards probe/login during pending logout and shares duplicate logout.
  Internal post-login cookie/CSRF recovery does not restore authenticated state.
  View retry is disabled and its handler fenced until logout settles. Added
  pending-DELETE and pending-login→logout regressions to the SAME browser file;
  real Chrome flow also checks disabled/programmatic retry during logout.

All newly added/corrected assertions UNRUN. No production success claim follows.

Correction metadata reconstruction: session4128 exit0, same authorized isolated
PG17.5 helper/command.120 tables,39 functions,70 noninternal triggers,
793 constraints,331 indexes. Three expert_sessions columns (external_id,
bot_key,external_chat_id) and expert_sessions_identity CHECK added; no new
function/trigger. Prior SQL0..48 hashes verified unchanged, temp DB/output cleaned.
Previous0049 hashes above are historical. Current hashes:

- SQL:5e3f0283ad5e1e065bf2e21e21dd4c9f7b4dbbbdbff9bbea345708b4b47c25de
- snapshot:f79d7e11e65f425afcdc227ab5768cf152632bf0af0198bdffebe804d2506c2a
- supplement:a9a6e024cae54a09675818db5da626da2014ead4de2aed095b6f8d893f4e7588
- manifest:387d14038e7c0dd5ad228a4f4a78103e5255aee0ee4ddad2cc3ff7f6485e4af0

Correction static: session37888 exit0, scoped Prettier then
`pnpm --filter @ii-tonya/db build`,
`pnpm --filter @ii-tonya/application build`,
`pnpm exec tsc --noEmit -p tsconfig.tests.json` all passed.
Session31851 exit0: scoped ESLint over the nine corrected TS files and
`git diff --check`, passed. Current source PG24/API24/browser8 cases; added
cases are unexecuted, not claimed RED/GREEN. Await coordinator/reviewer closure
and owner test permission; no additional execution authority inferred.

Session60730 exit0: API, app-worker and web typechecks passed after corrections.
Final evidence Prettier check and git diff --check passed. Correction source is
stable for Kant/main; no live process or pending write. Test results remain the
reported failures (PG19/21, browser5/6); source fixes are not executed proof.

## Coordinator final API and metadata checks — 21:24 UTC

- API reserved run3: `pnpm exec vitest run apps/api/src/expert-authentication.test.ts`,
  session93733 exit0,21:24:39,duration3.48s,24/24 PASS. API budget now3/3.
- `pnpm exec vitest run tests/repo/migration-state-baseline.test.ts`,
  session3581 exit0,21:24:40,duration636ms,13/13 PASS.
- `pnpm exec vitest run tests/repo/migration-history-integrity.test.ts`,
  session29448 exit0,21:24:47,duration485ms,8/8 PASS.
- Kant re-review submission01a13200-ca1b-7692-85b2-895c6cf0a9bb accepted
  both P1/P2 at source level, with no remaining concrete scoped finding.
  Reviewer performed no tests or edits. Source acceptance does not close PG
  or composed browser gates. Those remain last19/21 and5/6, both exhausted.

No additional PG/browser execution, commit, push, deploy or provider mutation.
