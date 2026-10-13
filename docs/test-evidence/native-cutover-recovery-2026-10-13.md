# Native cutover recovery — 2026-10-13

## Owner-authorized extra invocation

Owner explicitly answered yes to one additional local execution of
tests/repo/native-cutover-recovery.test.ts in async question
call_2cef58c3440f4ba0a4e133ce9bc2c769. Coordinator invoked session47092 once,
at reviewed shell0a487419 and unchanged fixtureefa178bd. Exit0:33/33 passed,
start07:41:23UTC,39.81s. This closes all four observed recovery failures in the
command-shim scope. Extra invocation consumed; no further runs authorized.
This does not authorize any other exhausted-file rerun or live payment.

Coordinator final static checks6571 exit0: scoped format/lint, shell syntax and
whitespace. DB/tests typechecks85274 exit0. Independent source corrections review
accepted shell0a487419 before authorized execution. Migration suite32796 remains
15/15 on unchanged source. Legacy fixture reconciliations are still unexecuted;
this checkpoint does not assert whole-suite, production or customer acceptance.

**Historical final3 status:** coordinator final3 exhausted both focused budgets. Cutover
session 55172 failed (29/33); migrator session 32796 passed (15/15). The subsequent
explicit-return fix below is statically checked only and requires authorization
for one additional focused cutover-file execution. Earlier pending/budget entries
are historical, not permission to run tests.

## Coordinator final verification

Euclid accepted the three scoped corrections and legacy fixture reconciliation
at the stable correction hashes below. No remaining concrete source findings;
source acceptance does not establish real-target or full release readiness.
Coordinator final3 invoked once per new file: cutover session55172; migrator
session32796. Both budgets now3/3, exhausted. No legacy tests invoked.
Migrator32796 exit0:15/15. Cutover55172 exit1:29/33, four recovery
failures: first-install migration cleanup retains selection, partial stop does
not restart old services, candidate health recovery exits70, first-install health
cleanup retains selection. Same implementer assigned source diagnosis/correction,
no further execution without owner authorization. No release acceptance.

Implementation in progress against baseline
`4357ad2268b4a5e70a00f063a06c115a58de1332`.

The spec context list is empty. Spec and referenced plan read completely.
Environment preflight passed: Node 24.21.0, pnpm 11.9.0, PowerShell 7.6.6.
No SSH, systemctl, provider, staging or production operation is authorized here.
Unrelated payment and shared documentation edits are preserved.

## Decisions

- Post-GREEN2 source review tightened service/health commands against a monotonic
  (`SECONDS`) remaining deadline, not just a surrounding polling loop. This
  bounded-deadline correction has syntax/type/lint checks only until coordinator
  final3; no extra author test invocation is taken.

- The spec overrides generic skill instructions to run full suites, commit,
  dispatch nested agents, or modify shared status. Only two new focused files
  may run: author RED1/GREEN2; coordinator final3 after independent review.
- Migration failure cannot establish backend termination/commit state from
  systemd alone. Stop and verify the local migrator, retain incident marker and
  all artifacts, keep applications stopped, and require manual database recovery
  assessment. No automatic backend kill, database restore or claim of SQL rollback.
- Compatibility is an operator-supplied JSON evidence attestation binding both
  exact SHAs and the complete migration tree digest, with evidence digests for
  tests against both old and committed candidate schema. This increment does not
  manufacture release compatibility evidence.

## Test invocation ledger

- Cutover GREEN2 invoked: `pnpm exec vitest run tests/repo/native-cutover-recovery.test.ts`.
  Session 75107, exit 0, 26/26 passed in 23.803s. Budget 2/3 used; no further
  author run. Coordinator final3 remains reserved after independent review.

- Migrator GREEN2 invoked: `pnpm exec vitest run tests/repo/migrate-native-timeouts.test.ts`.
  Session 45679, exit 0, 15/15 passed. Budget 2/3 used;
  author has no further runs after this invocation.

- Migrator RED1: `pnpm exec vitest run tests/repo/migrate-native-timeouts.test.ts`,
  session 51407, exit 1; 14/14 failed for absent timeout configuration, URL/env
  guards, sanitized failure and unit deadlines. Budget 1/3 used.
- Cutover RED1: `pnpm exec vitest run tests/repo/native-cutover-recovery.test.ts`,
  session 3811, exit 1; 10 failed / 8 passed. The legacy body ignores the unique
  incoming argument and fails at its fixed SHA upload path, so the initial drill
  did not reach legacy mutation faults. Only missing SSH deadline assertion is
  a direct behavioral RED; passing refusal cases are not credited as coverage.
  Budget 1/3 used; correct the fixture before GREEN2, no hidden rerun.

## Remaining release gates

Final relevant DB/tests typechecks, scoped ESLint, Bash/Node syntax and whitespace
checks: session 12994, exit 0. No active command remains from that invocation.

Final post-correction Bash syntax, scoped Prettier check, evidence formatting,
whitespace check and shell fingerprint: session 26392, exit 0. No active command
handles remain. No commit, push, deployment or compatibility approval was made.

Check session 42477: Bash syntax, Node syntax, scoped formatting, DB typecheck,
and tests typecheck all passed, exit 0. Further edits require final checks.

Session 11431: scoped formatting, Bash/Node syntax, scoped ESLint and
`git diff --check` passed, exit 0, after configuration-preflight and expanded-shim edits.

Independent review and coordinator final3 remain pending. No target preflight has
been executed in this task (real SSH is prohibited by the spec). Migration 0050
compatibility with the exact prior application and the final candidate schema
remains a release requirement. Local shims do not establish live recovery.

Coordinator reports session 59985: the old 43a93e2 artifact starts against an
isolated PostgreSQL 16.15 schema through 0050 (51 journal entries/122 tables),
with ready API, advancing worker heartbeat and clean SIGTERM. See the production
review candidate build evidence. This is startup-only evidence, not a full
financial compatibility attestation; no approval JSON is created here.

## Delivered behavior and matrix coverage

The 26-case command-shim drill executes the actual final remote shell body in
isolated temporary directories. It covers successful ordering, checksum/runtime/
compatibility/poll/configuration/active-service preflight refusals, shared lock and
incident-marker refusals, partial stop recovery, migration failure and an
unterminated migrator, health failure, link restoration failure, failed recovery
health, stale/nonadvancing/PID-changing worker signals, first-install cleanup,
validation without quiescence, a service refusing to stop, and manual rollback.
No real SSH/systemctl/provider/database calls occur. The migration suite covers
configuration-only preflight, pool settings, error cleanup/redaction, encoded and
repeated overrides, inherited PGOPTIONS, missing/malformed URL, and unit deadlines.

The author reviewed source inline; this is not the independent acceptance review.
Both new files have consumed RED1/GREEN2 only. No full/multi-path or old test file
was run. `native-production-release.test.ts` assertions were reconciled for the
new shared cutover implementation without execution. The older
`native-rollback-drill.test.ts` initially targeted the removed dedicated rollback
body. The coordinator subsequently assigned that fixture to the same author;
it is now reconciled, unexecuted, as described in the follow-up below.

## Compatibility input (release reviewer supplies it)

`RELEASE_COMPATIBILITY_EVIDENCE` points to a JSON file copied as
`compatibility.json` into a unique incoming directory. Required fields:

- `format`: `ii-tonya-schema-compatibility-v1`
- `previous_sha`: exact prior application SHA
- `candidate_sha`: exact candidate SHA
- `migration_manifest_sha256`: SHA256 of the sorted per-file SHA256 listing for
  the complete candidate migrations tree (run inside that tree:
  `find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`)
- `old_schema` and `candidate_schema`: each has `result: "pass"` and a
  64-hex `evidence_sha256` referencing the independently reviewed compatibility
  evidence. Startup-only smoke is insufficient to author these attestations.

Existing-install validate/deploy refuse missing/mismatched evidence before
downtime. Manual rollback uses the same attestation: `RELEASE_SHA` identifies the
currently selected candidate (whose migrations remain committed), and
`.previous-release` identifies the application to restore. A first installation
requires absent app units and no reported live app process.

Exit 70 means unresolved incident or incomplete/uncertain recovery; retain the
marker and all artifacts for manual assessment. Other cutover failures remain
nonzero even after verified application recovery. No database rollback is claimed.
Successful deploy/rollback alone clean their unique incoming directory; successful
validate leaves the staged candidate available for inspection. Validation requires
target access and signed candidate inputs, with no real invocation in this task.

## Stable review fingerprints

The table below is the first review handoff. The subsequent Euclid correction
handoff supersedes its shell/cutover-test fingerprints.

These are the final review inputs, not an exact-SHA release claim. HEAD advanced
externally during this assignment to
`2a3484e68a241822203357e24cf8d5e3ee4ee20d`; original spec baseline is preserved.
All listed inputs match GREEN2 except the shell deadline correction described
above and the intentionally unrun old static assertion file.

| File                                         | SHA256                                                           |
| -------------------------------------------- | ---------------------------------------------------------------- |
| scripts/deploy-native-remote.sh              | 8c59deee0664fb180b7d6f115b2ab33d5d640492e77129b62d93f07363f4d5d9 |
| scripts/migrate-native.mjs                   | 2a5d9ea65d70b7301e175aad6acf6dc6a0a4d41a3c70018f28dd30a614a78df3 |
| deploy/systemd/ii-tonya-migrate.service      | 8e6f70fe21d37b7e9eab4c30ef26424c411fa0ecbffb118371d0f1de221b72f7 |
| packages/db/src/client.ts                    | 9625c863d518d3c4d4e037ef60031a6d084343706895cd086509bf95a7929487 |
| tests/repo/native-cutover-recovery.test.ts   | fda226fb1dcacde385524ca8340638380a4124de1eb9e44a2533e52335f51fff |
| tests/repo/migrate-native-timeouts.test.ts   | 440bda0d5b6dcb8c9172b551d169bdce43d27d99b011dcc07b4dc2cd14617bfc |
| tests/repo/native-production-release.test.ts | a5e970995d2419953b205fe09e724f675709d25dcd8841aa1a18a3cbe31ce2c6 |

## Euclid corrections and legacy fixture reconciliation

Coordinator authorized the same author to address three confirmed P2 findings
and reconcile only the legacy rollback test and own evidence in addition to the
existing scope. No nested agents, remote operations or test executions occurred.

- Worker readiness retains its baseline across iterations for the same PID/start
  identity; a changed process or invalid observation discards it. A slow-poll shim
  keeps each pair of samples equal while advancing between pairs, reproducing the
  former blind interval without relying on active systemd state alone.
- Stop and worker-health loops check the monotonic remaining budget at every
  iteration, including iterations reached by failure/continue branches. Four
  backwards-wall-clock fixture paths cover a service refusing to stop, inactive
  worker, unreadable heartbeat and stale heartbeat. Only those fixtures replace
  shell `SECONDS` reads with a deterministic elapsed-clock shim; outer harness
  timeout/error is explicitly rejected by the assertions.
- A terminated first-install migration failure performs shared safe cleanup:
  disable/remove installed units and unselect only its own candidate. It still
  preserves candidate/incoming/incident marker and exits 70 for unknown database
  state. Unverified migration termination forbids path/unit cleanup. Both cases
  have added, unrun regressions.
- Legacy rollback fixture executes the real common body with explicit rollback
  arguments, exact release identities and a temporary synthetic compatibility
  attestation. Local shims model active/stopped services, API readiness and
  namespace heartbeat progression. All three original tests are preserved;
  installed bytes for all three units, prior release selection, quiescence,
  preflight/post-switch readiness and no migration start remain asserted.
  An additional stale-worker case rejects false success and checks recovery to
  the original current release. Missing-prior refusal now starts from an otherwise
  valid fixture and asserts no stop/start or switch.

All additions/corrections are UNRUN. Both new files remain at 2/3, coordinator
final3 reserved after rereview; the legacy file has no execution authorization.
The migration script, DB client and migration unit have not changed in this fix.

Static verification invocation: session 64219, scoped Prettier write, deployment
Bash syntax, both edited fixtures' ESLint, tests typecheck, and `git diff --check`.
Exit 0: all passed. No Vitest command was included.

Static-only shim syntax invocation (tool chunk 73fe4b): TypeScript AST extraction
of literal/template shim bodies followed by `bash -n` via stdin, exit 0 for all
17 bodies. This parsed their syntax without importing test files or running a
fixture, service, SSH or test callback.

### Stable correction handoff

No active command handles. Await independent rereview; no more author test runs.
Added regressions and reconciled legacy fixture remain unexecuted.

| Changed review input                       | SHA256                                                           |
| ------------------------------------------ | ---------------------------------------------------------------- |
| scripts/deploy-native-remote.sh            | 7468085841c1a9a7d051ce3c8e7439875cc9faa669acaadbb3ec6987e3967a90 |
| tests/repo/native-cutover-recovery.test.ts | efa178bdc90a15941312a197f7edd7af5dec2bb35a357397a98215ab20a0f396 |
| tests/repo/native-rollback-drill.test.ts   | 5210c6323b4e027fdd6619f886a42dbd9ca1f62206e5a9f31c0e8e860f78d36e |

Unchanged migration entrypoint/unit/DB-client, migration tests and production
static-assertion file fingerprints match the original handoff table above.

## Final3 failure diagnosis and explicit-return correction

Coordinator reported cutover session 55172: 29/33 passed, four failed:
first-install migration cleanup retained candidate selection; partial-stop
recovery never started the old services; health-failure recovery exited 70;
first-install health-failure recovery retained candidate selection. Migrator
session 32796 passed 15/15. Both files are now 3/3 EXHAUSTED. No tests, shell
fixtures, hidden reproductions or provider/host operations were executed for
this diagnosis.

Source inspection found the same implicit-return defect in two paths:
`stop_unit()` and successful `health()` evaluated a deadline then used bare
`return`. They are called from `recover()`, which is the ERR trap handler.
The installed `/usr/share/man/man1/bash.1.gz`, return builtin section,
lines 9788–9789 of its decompressed source, explicitly documents that a return
executed by a trap handler derives an omitted status from the command executed
before the trap handler. This is documented trap return behavior, not evidence
that `set +e` itself makes a successful arithmetic check fail.

Consequently the original cutover failure can be propagated by a successful stop
verification. `stop_apps()` then sets its failure flag, preventing old-app startup
and first-install cleanup; the migration-error branch similarly refuses cleanup.
The same implicit return in health would poison recovery readiness after fixing
stops. This source-level causal chain matches all four reported failures; no new
execution is claimed as proof of the correction.

Both paths now explicitly return 1 for an expired deadline and 0 after verified
success. All deadline checks, process-state checks, artifacts and financial-state
limitations are preserved. Existing failed cases already exercise these branches,
so their assertions and fixtures are unchanged. Runtime verification remains
pending one explicitly authorized extra execution of
`pnpm exec vitest run tests/repo/native-cutover-recovery.test.ts` only.

Static check invocation (tool chunk 23bed8): `bash -n` on the deployment script,
`git diff --check`, SHA256 fingerprints and an audit of every explicit `return`
site, exit 0. No bare executable returns remain. No TypeScript files changed in
this correction, so previous type/lint results remain applicable to those files.

Stable script SHA256:
`032dc313f8f94f262aa3a46383bac7a58e22b1539771546b55ffba71134a7664`.
Cutover fixture remains
`efa178bdc90a15941312a197f7edd7af5dec2bb35a357397a98215ab20a0f396`;
legacy rollback fixture remains
`5210c6323b4e027fdd6619f886a42dbd9ca1f62206e5a9f31c0e8e860f78d36e`.
No active command handles; ready for coordinator review of this source-only fix.

### Recovery deadline scope correction

Euclid also identified a dynamically scoped deadline inherited when ERR invokes
`recover()` from within `health()`. Source inspection confirms that `ctl()` reads
`service_deadline` from caller scope. `stop_unit()` shadows that value locally,
but recovery unit installation/reload, disable and initial service-start commands
otherwise see the expired health deadline and can fail without issuing a command.

`recover()` now declares its own empty local `service_deadline`, shadowing any
expired caller deadline. `ctl()` retains its bounded 10-second default for these
commands; recovery's `stop_unit()` and `health()` calls establish fresh local
polling budgets. This does not change candidate readiness criteria or disable
timeouts. Both this scope diagnosis and the explicit-return diagnosis are based
on source and documented Bash semantics, not newly executed runtime proof.

The immediately preceding script fingerprint is superseded by this additional
scope correction. Test fixtures remain unchanged. No test/fixture execution is
authorized; one extra focused cutover execution is still required after approval.

Final static invocation (tool chunk 00038a): deployment `bash -n`, evidence
Prettier formatting, `git diff --check` and SHA256 checks all passed, exit 0.
Stable deployment script SHA256:
`0a487419596c82cec0f386a85fff90fc6cc2ae228a97b09176a64b736bfb56eb`.
Cutover and legacy fixture hashes remain unchanged as recorded above. Both focused
budgets remain 3/3 exhausted; no test or hidden reproduction was run. No active
command handles remain.
