# Expert Telegram query verification

Date: 2026-08-13

Base source: `5d13cd80acff220ff39c0773a3706d099e67958c`

Scope: uncommitted expert Telegram query delta on
`codex/expert-referral-api-telegram`

Environment: existing Claw `ii-tonya-test` Compose profile only, with
`--entrypoint sh`; Vitest executable `/seed/node_modules/.bin/vitest`; source mounted at
`/workspace/source`. No dependency was installed and no Compose definition, production
service, database, feature flag, or live credential was changed.

## Causal RED and focused GREEN

The initial source-only test staging contained the application service and `cv1` tests,
without their production modules. Focused Vitest exited `1`: two suites failed during
collection because both modules were absent. After the production modules were staged,
the same two files passed:

```text
Test Files  2 passed (2)
Tests       10 passed (10)
Duration    1.32s
```

The focused adapter/processor/webhook/config group then passed:

```text
Test Files  4 passed (4)
Tests       36 passed (36)
```

The static repository guard passed separately:

```text
Test Files  1 passed (1)
Tests       4 passed (4)
```

## PostgreSQL-authoritative verification

Command inside the constrained test container:

```bash
CI=true /seed/node_modules/.bin/vitest run \
  tests/integration/expert-telegram-queries.test.ts --maxWorkers=1
```

The first executable fixture run produced one causal RED and four passes. PostgreSQL
rejected an untyped parameter expression with:

```text
column "starts_at" is of type timestamp with time zone but expression is of type interval
```

After the fixture explicitly cast its clock parameters to `timestamptz`, the focused run
passed:

```text
Test Files  1 passed (1)
Tests       5 passed (5)
Duration    5.13s
```

The five real-PostgreSQL cases cover active/verified Telegram binding and ownership,
foreign identity denial, the maximum of 20 active reservations, fixed stats windows and
aggregates, single-use/foreign/stale/revoked `cv1`, consent-minimized client data,
content-free audit persistence, and rollback of both consume and audit on injected audit
failure.

## Prepared app composition closure

Only disposable source-local package outputs were built with the image's existing
`tsup`; no dependency installation occurred. Then:

```bash
CI=true /seed/node_modules/.bin/vitest run apps/api/src/app.test.ts --maxWorkers=1
```

passed:

```text
Test Files  1 passed (1)
Tests       22 passed (22)
Duration    5.73s
```

This verifies the normal app composition collects, stays default-off, and fails closed
when enabled without an injected query capability.

## Static checks and self-review

Targeted ESLint exited `0`. Local `git diff --check` exited `0`. Targeted Prettier was
applied to changed TypeScript/YAML/Markdown files. A repository-wide local TypeScript
attempt was not accepted as evidence because this isolated worktree lacks workspace
package links; it failed primarily with unresolved `@ii-tonya/*` and dependency modules.
The only two delta-local mock typing findings were corrected before commit. The prepared
Claw package builds for contracts, domain, application, integrations, config, database,
and observability all exited `0` before the app test.

Self-review found no unresolved Critical or Important issue against the frozen scope:
every database read rechecks the active/verified binding and expert ownership; `cv1` has
a separate MAC domain and never invokes a booking transition; consume/read/audit share
one transaction; Telegram request logging remains disabled; audit metadata is
content-free; no update, claims, client text, URL, credential, or result is logged; all
runtime examples retain both Telegram flags as `false`; and no migration or dependency
was added.

This self-review is not the required independent review.

## Cleanup and release boundary

All staged source files, disposable package outputs, and source-local links were removed
or restored from authoritative local `HEAD`. Final cleanup output:

```text
REMOTE_FILES_LINKS_REMOVED
RUNNING_II_TONYA_TEST=0
```

No repeat loop was run because production concurrency behavior did not change. This is
implementation evidence only. Mandatory CI at the final commit, independent review,
Draft PR publication, staging, merge, live Telegram activation, and deployment remain
open human-controlled gates.

## Review remediation cycle

Review iteration 1 ran against local source based on
`c3864d558dc9b25a8cca6f353feb00ce70447f79`. Focused pre-remediation RED:

```text
Test Files  6 failed (6)
Tests       25 failed | 30 passed (55)
Duration    5.10s
```

The same focused application/token/processor/adapter/webhook/count group was GREEN:

```text
Test Files  6 passed (6)
Tests       56 passed (56)
Duration    5.32s
```

Expanded real-PostgreSQL verification was GREEN:

```text
Test Files  1 passed (1)
Tests       9 passed (9)
Duration    5.33s
```

It covers ordering, expired holds across every query path, exact 30-day boundaries,
absent/latest-revoked consent, Telegram-bound callbacks, eligibility-before-consume,
audit rollback, and bounded existing-schema cleanup. Prepared default-off/fail-closed
app composition remained GREEN: `1 passed`, `22/22 tests`, `6.02s`; all seven disposable
package builds exited `0`.

Unconfirmed Telegram sends fail the inbox instead of completing it. An already-consumed
client view is not disclosed automatically again after an uncertain outcome; the safe
recovery is a fresh `/client`, which reauthorizes and issues another short-lived token.
No PII outbox, schema migration, dependency, live adapter, or live callback secret was
added. The default server remains intentionally fail-closed and live composition is a
deferred activation gate.

Final review-cycle cleanup: `REMOTE_FILES_OUTPUTS_REMOVED` and
`RUNNING_II_TONYA_TEST=0`.

## Final review remediation: consume CAS and delivery outcomes

The final review cycle started with a focused Claw RED. The webhook suite reached six
causal failures and ten passes; the processor suite failed collection because the prior
cleanup had restored its production module remotely. After staging the bounded
production delta, the same focused pair was GREEN:

```text
Test Files  2 passed (2)
Tests       31 passed (31)
Duration    2.43s
```

The database consume is now a locked compare-and-set: notification, reservation, actor
binding, service, expiry, action, token, claims, version, and unconsumed state are proven
before the update, and the consuming update repeats the mutable notification predicates.
The real-PostgreSQL suite includes two simultaneous consumes and asserts exactly one
non-null disclosure and exactly one allowed audit. Because concurrency changed, the
suite was repeated exactly three times:

```text
PG_CONCURRENCY_RUN=1  Test Files 1 passed; Tests 10 passed; Duration 5.52s
PG_CONCURRENCY_RUN=2  Test Files 1 passed; Tests 10 passed; Duration 5.44s
PG_CONCURRENCY_RUN=3  Test Files 1 passed; Tests 10 passed; Duration 5.45s
```

Ordinary definitely-not-applied sends release the inbox for retry. Ordinary unknown
outcomes complete the inbox without a blind resend. After a client view is consumed,
both not-applied and unknown outcomes complete the inbox to preserve at-most-once
disclosure; the safe recovery remains a fresh `/client`. Callback acknowledgement is
best effort after the sensitive operation and never reopens or changes its outcome.
Every `cv1` denial is claimed/deduplicated and returns the same sanitized HTTP 200 plus
generic provider acknowledgement; the legacy `ct2` path is unchanged.

Prepared app composition did not produce a new passing result in this cycle. All seven
workspace package JS and declaration builds succeeded, but Vitest failed before test
collection with `Failed to resolve entry for package "@ii-tonya/observability"` despite
source-local workspace links. No dependency was installed and no further preparation
retry was made. The previous prepared default-off/fail-closed app result above remains
historical evidence, not a fresh result for this remediation.

Final remote cleanup reported:

```text
REMOTE_FILES_LINKS_OUTPUTS_REMOVED
RUNNING_II_TONYA_TEST=0
FOCUSED_PROCESSES=0
```

## Final acknowledgement correction

A narrow follow-up corrected the provider acknowledgement for a consumed client view.
The causal focused RED was:

```text
Test Files  2 failed (2)
Tests       5 failed | 27 passed (32)
Duration    2.62s
```

The same processor and webhook files were then GREEN:

```text
Test Files  2 passed (2)
Tests       32 passed (32)
Duration    2.62s
```

Only an applied disclosure now produces the success acknowledgement. A definite
not-applied disclosure completes the inbox and returns a sanitized `reissueClient`
result; an unknown outcome completes the inbox with a terminal ambiguous result. Both
use bounded unavailable acknowledgement copy instructing the expert to run `/client`
again and neither retries the consumed token. The recovery case proves replay stays
rejected while a later `/client` command can issue a fresh `cv1` selector.

Cleanup reported `REMOTE_FOCUSED_FILES_RESTORED`, `RUNNING_II_TONYA_TEST=0`, and
`FOCUSED_PROCESSES=0`. No database, schema, migration, dependency, PII persistence, app
composition, or live activation changed in this narrow follow-up.
