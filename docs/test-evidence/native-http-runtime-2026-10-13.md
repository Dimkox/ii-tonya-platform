# Native HTTP runtime implementation evidence — 2026-10-13

## Final coordinator verification

Source fix verified at 10:07 UTC, before commit/build/deploy. Three independent
review layers completed. Corrective documentation and final cleanup were reviewed;
Noether also reviewed the five coordinator operational helpers without finding a
blocking risk. Effective production-unit acceptance remains a separate release step.

| Run                                       | Session | Exit | Result                                                                         |
| ----------------------------------------- | ------- | ---- | ------------------------------------------------------------------------------ |
| Coordinator final3                        | 23222   | 1    | 2/2 failed during fixture cleanup: ERR_SERVER_NOT_RUNNING after listener abort |
| Legacy native release contract, sole run  | 49133   | 0    | 10/10 passed                                                                   |
| Owner-authorized additional new-file run4 | 75399   | 0    | 2/2 passed after narrowly handling already-closed disposal                     |

The owner explicitly approved one additional local run after the 3/3 limit.
No other tests were repeated. The run4 source SHA-256 is
`1d12f871d7b847a02a0d9375454d6db08639087253ba0dd9793dad0f2dcbb7b8`.
Focused ESLint, tests typecheck, Prettier and whitespace passed (38830).
Production/application/database sources, migration files and deployment scripts
remain unchanged; only the API/worker service policies differ.

Durable controller logs are under `/tmp/ii-tonya-http-release.TvVNDR` and will be
retained with the immutable release evidence:

- `final-http-runtime-test.log`: `97485198f2e3aa751dcde56e917f71057af2f4bf55108f1b016dbd5269b1cb34`.
- `native-release-contract-test.log`: `528abd511c6539e98dacb62e1d6b2e6bcc6c82b4fe311cf2afcaacc915bb7812`.
- `authorized-final-http-runtime-test.log`: `d3aa6d52e67629798a72929de39618d44bb49cdbf84c6a252dd6f083a267c744`.

The sections below retain the earlier implementer handoff chronology; their
pending final3/legacy-run statements are superseded by this section. They do not
assert a full CI/Database Gate, independent VPN, payment or customer-journey pass.

## Scope and identity

Implemented [the native HTTP runtime spec](../superpowers/implementation-artifacts/spec-native-http-runtime.md)
in `.worktrees/review-2a3484e6-20261013`, branch
`codex/native-http-runtime-20261013`. Source baseline:
`031ae46065b58223a2b6cd47e002b388a41ec89c`.
Canonical remote: `https://github.com/Dimkox/ii-tonya-platform.git`.
The spec was read in full before implementation; its frontmatter `context: []`
lists no additional files. This record precedes the release commit.

API and worker now use ordinary Node and `MemoryDenyWriteExecute=false`.
The migration unit retains `--jitless` and `MemoryDenyWriteExecute=true`.
The existing release assertions distinguish these policies and continue guarding
non-root execution, capabilities, filesystem protection, private temporary storage,
memory limits and restart behavior. Unrelated assertions remain present.
The deployment runbook explains executable-memory exposure, the readiness blind
spot, and controller-owned backup/retirement/recovery of old jitless drop-ins.

## Verification and exact run budget

Environment preflight `pwsh -File scripts/check-development-environment.ps1`
passed, exit 0: Node 24.21.0, pnpm 11.9.0, PowerShell 7.6.6, Ubuntu 24.04.5.
The only warning was an absent local `.env`; this test needs no runtime secrets.
No dependency installation was needed.

Both runs used exactly:
`pnpm exec vitest run tests/repo/native-http-runtime.test.ts`.

| Run                        | UTC start           | Session | Exit | Result                                                                                   |
| -------------------------- | ------------------- | ------- | ---- | ---------------------------------------------------------------------------------------- |
| RED1, before service edits | 2026-10-13 09:40:43 | 46776   | 1    | 2 failed / 2: both real fetches failed with `ReferenceError: WebAssembly is not defined` |
| GREEN2, corrected services | 2026-10-13 09:41:50 | 57862   | 0    | 2 passed / 2; exact fixture body read and child exit zero                                |

The same test source was used for RED1 and GREEN2, SHA-256
`a7b3801a8ff284c6da9b7f368da9a93749c4d08839ef3b0f86bb1b3449762d30`.
Only session output is available for those runs; no durable per-run RED/GREEN logs
were retained. The listener-startup correction below postdates GREEN2 and has not
been executed. Each service's `ExecStart`
arguments are parsed from its shipped unit. The test uses an asynchronous Node
child and real `fetch` against a `127.0.0.1` port-0 HTTP fixture. It verifies HTTP
200, exact decoded Unicode response text (not byte equality), normal child
completion and empty stderr.
It supplies a minimal child environment with explicit test-only proxy bypass and
no inherited `NODE_OPTIONS`, credentials or proxies. Fetch has a 2-second timeout;
the child has a 5-second timeout with SIGKILL and 16-KiB output limits. Each test
has a 10-second bound, waits for child completion, and closes connections and the
server in `finally`. Redirects are rejected; no external HTTP was performed by
the implementer or this loopback test.

Static verification:

- `pnpm exec eslint tests/repo/native-http-runtime.test.ts tests/repo/native-production-release.test.ts`:
  exit 0, session 31428.
- `pnpm exec tsc --noEmit -p tsconfig.tests.json`: exit 0, session 67601.
- Prettier formatting and final `--check` over both changed TypeScript files,
  the runbook and this evidence: exit 0. The spec's approved frozen block keeps
  its original formatting.
- `git diff --check`: exit 0.
- A read-only Node byte comparison against `git show` at the baseline verified
  that API and worker differ only in `ExecStart` and `MemoryDenyWriteExecute`,
  and migration is byte-for-byte unchanged: exit 0.

New focused file: **2 of 3 runs consumed**; coordinator final3 remains reserved.
`tests/repo/native-production-release.test.ts`: **0 runs by implementer**;
its one coordinator run remains reserved. No full/multi-path suite or old
exhausted test was run.

## SHA-256 source fingerprints

| Path                                                  | SHA-256                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `deploy/systemd/ii-tonya-api.service`                 | `df0632758cc00034f2f2392d93974c652fc0834c0dd33ffd1e75a127f629061b` |
| `deploy/systemd/ii-tonya-worker.service`              | `947443343b6d7c102fa1f62d40eb2e3c914060c6fff4736dfb307eee7f75fcdf` |
| `deploy/systemd/ii-tonya-migrate.service` (unchanged) | `8e6f70fe21d37b7e9eab4c30ef26424c411fa0ecbffb118371d0f1de221b72f7` |
| `tests/repo/native-http-runtime.test.ts`              | `1d12f871d7b847a02a0d9375454d6db08639087253ba0dd9793dad0f2dcbb7b8` |
| `tests/repo/native-production-release.test.ts`        | `0f14c556a181a460c06e472ab06994498cafa5a44165f092e57ef93f66a97017` |
| `docs/runbooks/native-production-deployment.md`       | `01b99124f69e09a25202e1554e0567083309f084f1583444e3f202d59bc6866f` |

## Review triage and correction

Coordinator review triage: edge hunter reported no findings (`[]`); blind hunter
and verification reviewer chiefly identified effective-systemd proof and
documentation gaps. This is the reported triage, not a blanket final review pass.

The listener now has a 2-second startup timer sharing an AbortController between
`server.listen` and the `listening` event wait. Timeout cancels both startup and
the wait. Success clears the startup timer; `finally` clears it again, aborts the
listener, closes connections and awaits the server's asynchronous disposal.
Real fetch, loopback-only targeting, response assertions and child bounds remain.
This correction is static-checked only; coordinator final3 must execute it.

The runbook now specifies the coordinator's operational sequence: back up old
units/overrides, install temporary acceptance hooks, retire only old jitless
overrides without restarting the still-running old services, then let the normal
deployment script preflight, quiesce, install/reload, select/migrate and start.
Old base units retain `--jitless` until installation, and removing drop-in files
does not change existing process flags. There is no invented partial-script pause.
Rollback restores retired overrides as well as base units, removes temporary hooks
before controller-managed legacy restart, and explicitly reports degraded old HTTP.

Static correction checks, with no test runs:

- Focused ESLint command above: exit 0, session 15969.
- Tests typecheck command above: exit 0, session 28895.
- Prettier over changed supported implementation/docs files and `git diff --check`:
  exit 0. Frozen spec text is preserved.

Deferred, not fixed: general INI parsing, source-substring assertions and hypothetical
conflicting assignments. These preexisting static-validator limitations are outside
this correction; operational effective-unit verification is the acceptance check.
No test, parser or validator scope was broadened. Final3 and legacy ONE are still
reserved; no additional execution evidence is implied by static checks.

## Coordinator systemd surrogate preflight

The coordinator reports remote probe session **95917**, wait **2779c6**, exit **0**:
`/usr/bin/node` v24.19.0 under a temporary systemd service using `ii_tonya`, the
application working directory, both `runtime.env` and `telegram-egress.env`,
`MemoryDenyWriteExecute=false`, non-root execution, `NoNewPrivileges`,
`ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, empty capabilities and the
192M/256M memory limits. Reported results: actual Telegram `getMe` HTTP 200 with
matching bot identity, and readiness HTTP 200. Existing actual-app jitless
diagnostics 38566/90963 failed with missing WebAssembly.

The implementer read only the nonsecret local probe sources. The unit was present
as `ii-tonya-http-probe.service`, not the suggested `native-http-probe.service`.
Read source fingerprints under `/tmp/ii-tonya-telegram-egress.hpVTk8`:

- `native-http-probe.mjs`:
  `7b3cfb86dd8fed1dbdd97d3ca16d3347b3254523ddb9b63315c0fa4e8c36d1ff`.
- `ii-tonya-http-probe.service`:
  `2e1a30fda43ac427774e50d960c3ade894d6352f1c2195cb972b9be3ea75c862`.

These local source reads corroborate probe design, not independent execution or
remote source-byte attestation. No environment files or values were read. This
surrogate establishes reported preflight compatibility under the proposed policy
and real egress; it is not proof that the deployed API/worker have been changed.

## Pending actual-unit acceptance

The coordinator owns temporary `50-native-http-acceptance.conf` on both actual
units, with
`ExecStartPost=-/usr/bin/node /etc/ii-tonya/native-http-acceptance.mjs <candidateSHA>`.
Its nonsecret source was read at
`/tmp/ii-tonya-http-release.TvVNDR/actual-service-http-probe.mjs`, SHA-256
`2691e766abd9d5af2f057952ba14c8b75f1d15a4a9eb586a3fa6d4b2002e60d5`.
It checks selected SHA/runtime and performs only bounded read-only `getMe`;
deployment retains readiness/heartbeat responsibility. No readiness retry or
readiness request is part of this final post-hook design.

The dash allows service recovery even on diagnostic failure or a selected old
release. An ignored failure does not stop services and is never acceptance.
Coordinator acceptance separately requires both actual units' `ExecMainStatus=0`,
post-hook exit status 0 and current-invocation success logs with exact candidate
SHA, `getMe` HTTP 200 and matching identity, plus final effective config and
restricted boolean-only `/proc` checks proving no `NODE_OPTIONS`. The probe's
truthiness check alone does not establish absence of an empty environment key.
These final operational checks remain pending in this handoff.

After verification, remove only owned temporary post-hooks/probe artifacts and
reload without another app restart; verify unchanged accepted PIDs and final
effective settings. Controller-managed rollback removes hooks before restoring
old overrides/restarting; the nonfatal hook also preserves automatic recovery.
The implementer did not edit or run any coordinator-owned operational helper.

## Handoff and limits

Coordinator final3, reserved legacy-suite run, final review acceptance and
actual-unit operational proof remain pending. No signed build, push, remote
operation or deployment was performed by the implementer. No database code,
deployment recovery script or financial/provider
flag was changed, and no secrets were accessed.

The local regression verifies Node flags and local HTTP behavior; the coordinator's
surrogate adds systemd/egress preflight, with final actual-unit proof still pending. Allowing
executable memory is an explicit API/worker security tradeoff. Existing remote
`10-node-jitless.conf` overrides must be backed up and retired by the controller
during cutover; effective service properties and actual-runtime HTTP need release
verification. Migration hardening remains intact. Independent VPN and full
commercial/product acceptance remain separate, unresolved work.
