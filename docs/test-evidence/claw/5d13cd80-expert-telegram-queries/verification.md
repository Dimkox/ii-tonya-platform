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
