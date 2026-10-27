# Native dedicated-server deployment

Read-only observation2026-10-12: native production runtime `current` is
`43a93e2131cde6bb09a6825fc5b83dfbf91fc600`;
`.previous-release` is `48009f9ce4de9f8258eede8d59b950899eafd0a8`.
The previous artifact exists, but its compatibility with a future migrated
candidate is not verified. See
`docs/test-evidence/production/2026-10-12-recovery-inventory.md` and the current
commercial-review release runbook. The2026-09-18 history below is not current state.
External-provider activation remains fail-closed and requires its own approval.

## Target topology

- one dedicated Linux server for ii-Тоня;
- Node.js 24;
- non-root `ii_tonya` API and worker systemd services;
- API and worker use ordinary Node with `MemoryDenyWriteExecute=false` so their
  built-in `fetch` can use WebAssembly/JIT; the non-network migration unit retains
  `node --jitless` and `MemoryDenyWriteExecute=true`. Runtime env files may not
  redefine `NODE_OPTIONS`;
- systemd creates `/var/lib/ii-tonya` and `/var/log/ii-tonya` through
  `StateDirectory` and `LogsDirectory`;
- system PostgreSQL with a project-scoped role/database;
- nginx/TLS reverse proxy to API on loopback;
- `/etc/ii-tonya/runtime.env` owned by root and excluded from release artifacts;
- immutable `/opt/ii-tonya-platform/releases/<git-sha>` directories and an atomic
  `/opt/ii-tonya-platform/current` symlink.

Docker, Docker Compose, GHCR application images, and container digests are not production
dependencies. They remain development/direct-Claw test evidence only. The Claw test
container imitates the native server contract; it is not copied to production.

## HTTP runtime upgrade and executable-memory tradeoff

Node 24's built-in `fetch` needs WebAssembly for its HTTP parser. `--jitless`
removes WebAssembly and makes real requests fail with `WebAssembly is not defined`,
even when network connectivity works. API and worker therefore need the ordinary
WebAssembly/JIT runtime and cannot use `MemoryDenyWriteExecute=true`. Allowing
executable memory in those two services relaxes that protection; the non-root user,
empty capability set, no-new-privileges, filesystem protection, private temporary
directory, memory limits and restart policy remain in place. Migration has no
outbound HTTP requirement and retains its existing executable-memory restriction.

Readiness alone missed this defect because it does not exercise outbound HTTP.
The regression in `tests/repo/native-http-runtime.test.ts` starts Node 24 children
using flags parsed from the shipped API/worker units and reads exact decoded text
from an ephemeral loopback HTTP server. It does not prove the installed systemd
policy, proxy connectivity or any live provider integration.

The controller owns the following one-time cutover and its recovery. Coordinate
it with `scripts/deploy-native-remote.sh`; do not run competing deploy/restart
operations. The script has no partial-execution pause hook. Its existing sequence
is preflight, `quiescing`/`stop_apps`, unit installation and `daemon-reload`, release
selection, migration, then `start_apps` and health verification. Preserve that
sequence and its deployment lock/marker and recovery handling.

1. Before cutover, inspect the selected release, installed base units and effective
   API/worker settings. Back up both base units and these exact existing overrides
   outside the active drop-in directories, preserving metadata and recording hashes:
   `/etc/systemd/system/ii-tonya-api.service.d/10-node-jitless.conf` and
   `/etc/systemd/system/ii-tonya-worker.service.d/10-node-jitless.conf`.
   Keep backups through acceptance and rollback. Confirm both old base units still
   specify `--jitless` before using this sequence.
2. Prepare the controller-owned, nonsecret
   `/etc/ii-tonya/native-http-acceptance.mjs` from the reviewed source
   `/tmp/ii-tonya-http-release.TvVNDR/actual-service-http-probe.mjs`.
   It checks the supplied candidate SHA against the selected `SOURCE_SHA`, runtime
   compatibility and a read-only Telegram `getMe` with a 12-second timeout.
   It logs only release/runtime metadata, HTTP status and identity match, never
   the token, URL or response body. It performs no readiness request; the deployment
   script owns readiness and heartbeat verification. Bound the entire post-start
   command using a finite `TimeoutStartSec` compatible with the fetch deadline.
3. Install temporary `50-native-http-acceptance.conf` drop-ins in **both** actual
   API and worker `.service.d` directories, adding
   `ExecStartPost=-/usr/bin/node /etc/ii-tonya/native-http-acceptance.mjs <candidateSHA>`
   with the exact candidate SHA substituted and the bounded startup timeout.
   The leading dash makes a diagnostic failure nonfatal to service startup,
   preserving automatic recovery when egress fails or the old release is selected.
   It does not establish acceptance. Back up and retire only the two old `10-node-jitless.conf`
   overrides before invoking cutover; preserve unrelated drop-ins, including
   Telegram egress. Do not restart either service at this preparation stage.
   The existing processes remain alive with their original flags and environment;
   removing a file does not change a running process. The old base units also still
   specify `--jitless` until installation of the new units. Thus override retirement
   does not itself switch the live runtime. Keep other restart actors coordinated.
4. Invoke the normal verified deployment. The script first checks current health,
   then confirms both services stopped in its existing `quiescing` phase before
   installing units or switching executable paths. Its stop deadline is 30 seconds
   per service; systemctl/install commands are bounded at 10 seconds plus a 2-second
   kill grace. On failure, use the recovery path; do not continue with an unverified
   stop. Installation reloads systemd, selection/migration follow, then `start_apps`
   starts both services with the new effective settings and temporary post-hooks.
   No guessed script pause or race with `start_apps` is part of this procedure.
5. Require successful post-hook completion for **each actual service**, plus API
   readiness and advancing worker heartbeat. A pending start job, an active service
   or an already-green health endpoint does not prove `ExecStartPost` succeeded:
   the leading dash deliberately allows nonzero diagnostic exits. The coordinator
   must separately require `ExecMainStatus=0` and actual `ExecStartPost` exit status
   0 for both units, and each unit's `native-http-acceptance` success log with the
   exact candidate `sourceSha`, `status=200` and `botIdentityMatches=true`.
   Tie evidence to each current start invocation/PID and timestamp so stale logs
   cannot pass acceptance. An ignored nonzero post-hook status means acceptance
   failed even if deployment readiness passes; it does not stop services by itself.
   This is a read-only provider probe, not financial or product acceptance.
6. Verify the effective config of both actual units with a bounded, property-filtered
   `systemctl show`: `ExecStart`, `ExecStartPost`, `ExecMainStatus`, `EnvironmentFiles`, `MainPID`,
   `User`, `Group`, `WorkingDirectory`, `MemoryDenyWriteExecute`, `NoNewPrivileges`,
   `ProtectSystem`, `ProtectHome`, `PrivateTmp`, `CapabilityBoundingSet`, `MemoryHigh`
   and `MemoryMax`. Require ordinary Node with the correct application entrypoint,
   `MemoryDenyWriteExecute=false` and all retained protections/limits. Confirm
   `/usr/bin/node` version and the selected release SHA. The controller's restricted
   `/proc/<MainPID>/environ` check must confirm **absence of `NODE_OPTIONS`** for
   each live application process; output only the boolean result, never environment
   values. Do not dump `Environment`, `/proc` environment or env-file contents.
7. Only after verified deployment, remove the two temporary
   `50-native-http-acceptance.conf` files and the controller-owned surrogate probe
   unit and probe files. Run bounded `daemon-reload`; do **not** restart the apps
   again. Confirm temporary post-hooks are absent, final effective settings remain
   correct, and the accepted application PIDs are unchanged. Preserve all unrelated
   drop-ins and the migration policy. Record the final config evidence separately
   from the temporary probe output.

For controller-managed rollback, remove temporary post-hooks **first**, before
legacy restoration/restart. The dash-prefixed hook also keeps the script's automatic
rollback viable if it starts before the controller removes the hook; a diagnostic
failure is ignored for service startup but never for acceptance. Restore the backed-up
`10-node-jitless.conf` overrides and prior base units, reload systemd, and recover the
previous compatible release using the existing bounded stop/select/start and health
procedure. Coordinate this restoration with script recovery before restarting old
services; the script restores base units but does not restore retired overrides or
remove temporary post-hooks. If preparation or deployment fails, the controller's
operational helper owns those changes even if the script fails before quiescing.
If stop or migration outcome is unresolved, retain recovery evidence and follow the
script's manual-recovery state; do not blindly restart or erase its marker.
Restoring the old `--jitless` configuration restores degraded outbound HTTP even
if readiness recovers. Report that limitation explicitly.

The coordinator's earlier systemd surrogate is preflight evidence for Node 24.19.0
under the proposed policy/environment. The actual-unit post-hooks and final config
proof above are still required after cutover; the surrogate is not the deployed
applications. Independent VPN availability and full product acceptance remain separate.

## Production SSH access policy

The approved operator policy is recorded in the ignored local project `.env` as
`PROD_ROOT_PASSWORD_LOGIN_ENABLED=true` and `PROD_ROOT_PASSWORD_SOURCE=interactive`.
Interactive password login for `root` remains available and deployment automation must
not disable it. The root password is entered only at the interactive SSH password prompt;
it is never stored in project `.env`, Git, logs, release artifacts, handoffs, or memory.
This access policy does not change the application privilege boundary: API and worker
services continue to run as the unprivileged `ii_tonya` user.

GitHub Actions are not used. Run `scripts/run-claw-ci.sh` directly on Claw with explicit
`SOURCE_ROOT` and exact `SOURCE_SHA`. GitHub stores the resulting commit and PR only.

## Required release sequence

1. Verify exact Git SHA CI and Database Gate directly on Claw.
2. Build one deterministic native API/worker production bundle from the frozen lockfile.
3. Generate SHA-256, dependency/SBOM inventory, signature, and provenance for the bundle.
4. Transfer to a temporary host path and verify all evidence before extraction.
5. Validate the runtime environment without printing secrets.
6. Complete backward-compatible migration preflight and prepare the coordinated
   HTTP runtime override backups/retirement and temporary acceptance hooks above.
7. Let the deployment script quiesce services, install the immutable release and
   systemd units, reload, atomically switch `current`, and run approved migrations.
8. Start API/worker through the script, verify both actual-unit HTTP post-hooks,
   final effective configuration, readiness, smoke, audit, and reconciliation;
   then perform the selective probe cleanup above without another restart.
9. On failure, remove temporary post-hooks first, restore retired overrides and
   the prior release's systemd units, run `daemon-reload`, switch `current` to the
   prior compatible release, and restart through the coordinated recovery procedure.
   Database rollback is forward-fix unless a separately reviewed reverse migration exists.

## Historical production state — 2026-09-18

The old production image/Compose and GitHub Actions entrypoints are removed. The first
native runtime at `233f3cf72e45e47117948ad5615b603252801e40` required host-only recovery
settings. 2026-09-18 deploy set `current` to
`cb07bd1821d8106b0b0088b17bcf305662a1b792` (`origin/main` at sign time) with
`7498ce65` as `.previous-release`.
The Claw rehearsal uses one persistent
`ii_tonya_native_smoke` database and resets only its `public` schema. No container release
path is authorized for production.

Migration marker `MIGRATION-COMPATIBILITY: 7428a8d387256df4fe24ba13ae0ab9c02fc76a54`
was received and the object was verified, but it is a sibling merge rather than an
ancestor of current `main`. It is retained as historical evidence and cannot be relabelled
as approval for a different release SHA. Exact approval for the deployed production
release was subsequently received as
`MIGRATION-COMPATIBILITY: 233f3cf72e45e47117948ad5615b603252801e40`.

The native runtime blocker remains open until the corrected exact-SHA replacement is
built, signed, deployed, and verified under systemd. Separately, Telegram, YooKassa,
Selarti, Planerka, LLM, and other external providers remain disabled until their
provider-specific implementations, contracts, credentials, and approvals exist.
