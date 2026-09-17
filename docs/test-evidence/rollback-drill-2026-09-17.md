# Native rollback drill — 2026-09-17

Decision owner: Incident commander (owner request «Rollback drill делай»).
Executor: Platform agent on `claw`.
Reviewer: unassigned (independent review still open).

## Scope

Production SSH (`DEPLOY_HOST` / `SSH_KEY_FILE`) is **not configured** on this
checkout. This drill is a **Claw rehearsal of the exact remote rollback body**
inside `scripts/deploy-native-remote.sh`, against two immutable
`releases/<40-hex>` directories. It is not a live switch of
`/opt/ii-tonya-platform/current` on the dedicated server.

Database: not touched (runbook: forward-fix only; no down migrations).

Docker/Compose: not used.

## Fixture

- Prior SHA: `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`
- Current SHA before drill: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
- `.previous-release` = `releases/<prior>`
- `current` symlink initially `releases/<current>`
- Unit files copied from `deploy/systemd/ii-tonya-{api,worker,migrate}.service`
- `sudo`/`systemctl`/`curl` stubbed: `/etc` rewritten into the fixture; curl
  fails unless `current` already points at the prior release.

## Result

| Item | Value |
|---|---|
| Started (UTC) | 2026-09-17T19:31:11Z |
| Ended (UTC) | 2026-09-17T19:31:12Z |
| Host | `claw` |
| Adapter | `scripts/deploy-native-remote.sh` SHA-256 `0bfe4350610d253d0cdc56c19df2fc715d29300f1d056f529dd8b7a514655af2` |
| Source SHA at run | `483ccecbb32e39a42f353d9e0bd39a9b2a0448ab` |
| Command | `./node_modules/.bin/vitest run tests/repo/native-rollback-drill.test.ts --maxWorkers=1` |
| Exit | 0 |
| Tests | 3 passed |

Observed:

1. `current` switched to `releases/<prior>`.
2. systemd unit files restored from the prior release directory (`daemon-reload`).
3. `ii-tonya-api.service` and `ii-tonya-worker.service` restarted.
4. Readiness probe `http://127.0.0.1:3000/health/ready` ran after the switch.
5. Missing prior directory refuses rollback (non-zero).

## Recovery outcome

**PASS (rehearsal).** Production host rollback remains a separate execution of
`bash scripts/deploy-native-remote.sh rollback` once `DEPLOY_HOST`, `SSH_KEY_FILE`,
`KNOWN_HOSTS_FILE`, and `RELEASE_SHA` are supplied.
