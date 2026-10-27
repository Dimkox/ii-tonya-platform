# Client async production Telegram — implementation evidence

## Coordinator final3 — verified

Euclid accepted duplicate-key correction at recorded source hashes. Coordinator
ran each new file exactly once after acceptance, all exit0:

- Transport session86774:66/66,23:37:19,1.11s.
- Composition session81800:19/19,23:37:20,2.61s.
- Isolated PG17.5 session13485:11/11,23:37:25,8.38s; corrected retry timestamp
  assertion passed. Synthetic admin endpoint was revalidated from retained
  container IP; no production data or provider calls.

All three files now **3/3 EXHAUSTED**. This supersedes pending/UNRUN statements
below for these exact corrected files. Local connected delivery is verified;
live bot binding, activation, full commercial journeys and release remain separate.

Spec: `docs/superpowers/implementation-artifacts/spec-client-async-production-telegram.md`.
Base: `e532428d014806100893bcf33243d6e5b3c060c2`.
Implementer: Herschel `01a1326c-d4fb-7371-893a-d4c420b8a513`.

## Execution contract

Frontmatter context is empty; full spec and linked plan read. Existing transport,
worker factory/runtime, admission and ordered repository contracts inspected.
Environment preflight `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`
passed (24d2dc): Node24.21.0, pnpm11.9.0, Docker29.9.0, Compose5.6.0.

Ruling: use this owned evidence file as the execution ledger; spec ownership and
test budgets override generic skill workspace, full-suite and commit steps.
Ruling: preserve trusted injected Telegram capability compatibility; credentials
are mandatory for default composition, and gate/key remain mandatory for either.
No real env, provider requests, activation, nested agents, installs or commits.

## Test allocations

Each file has author RED1/GREEN2; coordinator final3 is reserved after independent review.

| File                                                                | Used | Result                                                                                                                                                           |
| ------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/integrations/src/telegram/client-async-transport.test.ts` | 2/3  | GREEN2 session66057: 53/53 passed, exit0, 1.14s; RED1 session42150: 53 missing-capability failures                                                               |
| `apps/worker/src/client-async-production-composition.test.ts`       | 2/3  | GREEN2 session97464: 19/19 passed, exit0, 2.70s; RED1 session81572: 10 failed / 9 passed                                                                         |
| `tests/integration/client-async-telegram-production.test.ts`        | 2/3  | GREEN2 session90529: 10/11 passed, exit1, 8.54s; retry timestamp assertion type error corrected UNRUN; RED1 session42800: collection failure, not behavioral RED |

## Progress

Task 1 implemented; initial author verification below. Sequential build session43050
passed integrations/worker/app-worker. Scoped lint and diff session7619 passed.
Typechecks session30464 passed all three affected packages and tests. Transport GREEN2 passed53/53 (23:29:37 UTC).
Euclid subsequently reported one P2 duplicate-member parsing defect; correction
and rereview handoff are recorded below. Coordinator final3 and production binding remain outstanding.

Tests typecheck session5385 passed before RED; then synthetic config was corrected
to explicitly use local evidence mode, and PG version assertion added.
PG root package imports corrected to explicit repository paths before GREEN2.

PG GREEN2 (23:30:07 UTC) exercised real factory composition/admission/outcome,
foreign receipt rejection, bot filtering, authority withdrawal/regrant, duplicate
invocation, uncertain restart/order, crash-after-send and shutdown successfully.
The 429 case reached `retry_wait` but raw Drizzle SQL timestamp values are strings,
not Date objects; its `.getTime()` call failed. Corrected the test to select an
explicit PostgreSQL float8 epoch-millisecond value. This correction and the remainder
of that assertion path are UNRUN, reserved for coordinator final3 after review.
All three files now2/3 used; no further implementer Vitest is authorized.

## Stable implementer handoff

Implemented six production files and three new test files. No existing test file,
configuration schema, migration, authority repository or runtime lifecycle changed.

- New exported plain HTTP transport: fixed Telegram endpoint, strict request shape,
  private-chat and token-derived bot receipt identity, positive safe message ID,
  fatal UTF-8/JSON checks, 64KiB stream ceiling, content-length consistency,
  15-second total deadline, redirect rejection and no internal retry.
- New default client composition resolves consent gate/key/token readiness before
  database creation, supports a raw fetch seam and preserves explicit trusted
  business-adapter compatibility. Existing Selarti rejection remains.
- Dispatcher converts only validated 429 delay seconds into retryAfterMs. Runner
  schedules from response time with max(existing jitter, provider delay), checks
  integer/range/date safety, and preserves scheduling without a provider delay.
- PostgreSQL remains the sole admission/consumption/outcome authority. Unknown
  sends remain unknown through restart; successful HTTP followed by a lost DB
  acknowledgement does not authorize another invocation.

### Verification commands and sessions

- `pnpm exec tsc --noEmit -p tsconfig.tests.json`: before RED session5385 exit0.
- `pnpm --filter @ii-tonya/integrations --filter @ii-tonya/worker --filter @ii-tonya/app-worker --workspace-concurrency=1 --sort run build`:
  sequential session43050 exit0 (ESM and declarations for all three).
- Same package filters with `run typecheck`, followed by tests typecheck:
  session30464 exit0.
- Scoped ESLint on all nine source/test files and `git diff --check`:
  session7619 exit0.
- Post-correction tests typecheck and PG-test ESLint: session51010 exit0.
- Prettier check of all ten owned files and `git diff --check`: session92434 exit0.
- Each Vitest command was `pnpm exec vitest run <single table path>`.
  PG execution derives only the retained synthetic test container's connection
  parameters in memory, passes `II_TONYA_TEST_POSTGRES_ADMIN_URL`, and asserts
  server version170005 before migration. Each successful suite setup creates and
  removes its own random test database. No application `.env` was loaded.

### Exact source SHA256 at handoff

```text
cde1008c8e2928b65d48576db6916ba70a52080db62073799f62b53771ae3ef4  packages/integrations/src/telegram/client-async-transport.ts
07d5cbff5c6a445256bede85e18973a048899ec0e00b183fb50c8534207ac4c7  packages/integrations/src/telegram/client-async-transport.test.ts
f4d4173f6e132313f76545df8f83330226de67ae8a448e66830eafcd2ab910e3  packages/integrations/src/index.ts
be016abc8c1ee2ed14fadbd3f887fa519fd0683fda3cbd865e45eb52aeefe40a  apps/worker/src/client-async-composition.ts
49156f37b22f83f3034e251060bd0eca688d2365493a4a34f1d0f9aa7aa8f20a  apps/worker/src/client-async-production-composition.test.ts
34c4b35512a61fbd41590ee65f4678547a278b908487d2569ec46a9b68b4858b  apps/worker/src/main.ts
76f38a56e1a8f5114aec05897ca790ba9830414d917f946a146e70691df4cc78  packages/worker/src/telegram-send-text-dispatcher.ts
e8b89f847fbf34b04a674d2dab90bfeb105aea60e29b15aa04e5d66cb8b642a6  packages/worker/src/outbox-runner.ts
c229f98bac2a4b204cd5c15ec22d4db01b6b507c865b25369f449eac68f934a3  tests/integration/client-async-telegram-production.test.ts
```

### Outstanding evidence and limits

Independent rereview of the P2 correction and coordinator final3 of all three files remain.
PG latest result is **10/11**, not green; the epoch-millisecond assertion correction
has static verification only. PG RED1 was a collection failure and therefore does
not establish a behavioral RED. The transport RED1 establishes absent capability,
not independent pre-fix failures of each safety check. No external exactly-once or
live Telegram delivery claim is made. Production identity binding, enabled flags,
Selarti and broader commercial/release gates remain coordinator-owned and separate.
No commit/push.

## Euclid P2 correction — duplicate JSON members

Coordinator confirmed `JSON.parse(text)` discarded duplicate members before receipt
and 429 validation, allowing a conflicting final identity or delay to win. No other
reviewer defect was reported. Same implementer owns this correction.

First added **13 raw-response regressions**, then changed production parsing.
Eleven rejection cases cover duplicate/identical `ok`, sender/chat identity,
sender object, retry delay60/0, parameters object, escaped-equivalent sender/delay
keys, escaped-equivalent keys in array-contained objects and `__proto__` members.
Two acceptance cases cover independent object scopes and escaped quote/backslash/
container characters in string values, and a unique escaped retry member whose
original envelope is preserved. Transport file now contains **66 cases, UNRUN**
at the corrected source; prior53/53 applies only to the pre-correction version.

No reusable duplicate-aware parser was found in integrations/contracts. Added a
non-exported iterative scanner in the existing transport module, with per-object
Sets of decoded member names. Strings are scanned escape-aware; only isolated
member-name string tokens are decoded before duplicate checks. Full JSON.parse
runs after the scan to retain complete JSON grammar validation. Container tracking
is iterative, bounded by the existing64KiB input ceiling, with no new recursion or
depth restriction. Duplicate failure is sanitized as delivery uncertainty. Receipt
validation, HTTP/error classifications, original response envelopes, timeout,
byte ceiling and retry scheduling are unchanged. No upward API dependency.

User expressly prohibited further Vitest before coordinator final3. **No tests or
ad-hoc behavioral probes were run in this correction**, and no RED/GREEN execution
claim is made for the new cases. All three files remain2/3 used. The PG timestamp
assertion correction also remains UNRUN.

- Environment preflight chunk9667e2 passed.
- Sequential integrations/worker/app-worker build session41896 passed (ESM+DTS).
- Sequential affected package typechecks, tests typecheck, scoped ESLint,
  Prettier check and diff check: session77932 passed, exit0.
- Exact source hashes above were refreshed; only transport and its new test file
  changed in this correction, alongside this owned evidence file.

Stable corrected source handed back for Euclid rereview. No active implementer
build, typecheck or test sessions remain. Coordinator final3 is still reserved.
