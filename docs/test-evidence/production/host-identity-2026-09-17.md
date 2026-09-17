# Production host identity — 2026-09-17

Decision owner: Platform owner (interactive SSH login pasted to the agent).
Executor: Platform agent on `claw`.
Reviewer: unassigned.

## What this is

Owner-accepted host key for `ii-tonya.ru` (`157.22.187.237`), Claw `known_hosts`
pin, and BatchMode deploy SSH for `ii_tonya`. This is **not** a new release, not
a `/opt/ii-tonya-platform/current` switch, not a live rollback, and not a copy of
local `.env` into `/etc/ii-tonya/runtime.env`.

The root password was typed only at the owner's interactive prompt. It is not in
project `.env`, Git, logs, or this file. `PermitRootLogin yes` and
`PasswordAuthentication yes` were left unchanged.

## Host key

| Item | Value |
|---|---|
| Hostname | `ii-tonya.ru` (also `www.ii-tonya.ru`) |
| A record | `157.22.187.237` |
| Type | ED25519 |
| SHA-256 fingerprint | `SHA256:eHiplIy7STE3UhwVa0EozOSIysMNUQNtTKilwWdrrTE` |
| Owner prompt | accepted (`yes`) 2026-09-17 |
| Live `ssh-keyscan` | same fingerprint for hostname and IP |

Dedicated adapter file (Claw, mode 0600, not in Git):
`/home/pall/.ssh/ii-tonya.ru.known_hosts` (ED25519 only). The same ED25519 line
was appended to `/home/pall/.ssh/known_hosts` under the hostname (the IP line
was already present).

## Deploy SSH (BatchMode)

| Item | Value |
|---|---|
| Adapter user | `ii_tonya` (uid 1001) |
| Key comment | `ii-tonya-claw-deploy-2026-09-17` |
| Key fingerprint | `SHA256:BeYczQQJIpq1HnGzoX1pQ40sRRQjP1GErooKesRlMO8` |
| Private key | `/home/pall/.ssh/ii_tonya_deploy_ed25519` (0600, not in Git) |
| `authorized_keys` | was 0 bytes; now one ED25519 line, 0600 `ii_tonya:ii_tonya` |
| Scoped sudoers | `/etc/sudoers.d/ii-tonya-deploy` `0440`: `ii_tonya ALL=(root) NOPASSWD: /usr/bin/install, /usr/bin/systemctl, /usr/bin/rm` (`visudo -cf` OK) |
| Probe | `id`; `sudo -n systemctl is-active ii-tonya-api.service` → `active`; same for worker |
| `deploy-native-remote.sh validate` | exit 0 with `DEPLOY_HOST=ii-tonya.ru` |
| Adapter-shaped SSH | `current` → `releases/7498ce656e1e49fe2d92c83f02d9667eb3f86b9b` |

`ii_tonya@` with Claw `id_ed25519` remains denied (expected: that pubkey is not
in `ii_tonya` authorized_keys). Interactive root password login is still
enabled. Root pubkey login with `pall@claw` already existed before this session
(`dmitry-codex-claw-ops`, `pall@claw`, plus a `supportAccessKey` line).

## Live layout (read-only)

Observed 2026-09-17T20:10:52Z from Claw.

| Item | Value |
|---|---|
| OS | Ubuntu 24.04.4 LTS, kernel `6.8.0-137-generic` |
| `current` | `releases/7498ce656e1e49fe2d92c83f02d9667eb3f86b9b` |
| `.previous-release` | `releases/233f3cf72e45e47117948ad5615b603252801e40` |
| `SOURCE_SHA` in current | `7498ce656e1e49fe2d92c83f02d9667eb3f86b9b` |
| `MIGRATION_COMPATIBILITY_APPROVED_SHA` | `7498ce656e1e49fe2d92c83f02d9667eb3f86b9b` |
| `web-current` | `web-releases/9369eeafecd8ba9e4396e81e132b80742ba33156` |
| `WEB_RELEASE_SHA` file | `39141da6fb0603eca5e75d36b05159b6d153dfd9` (does not match the symlink) |
| Node | v24.19.0 |
| nginx | 1.24.0 (Ubuntu) |
| PostgreSQL | 16.15 (`postgresql@16-main` running) |
| `ii-tonya-api` / `ii-tonya-worker` | active, enabled |
| Loopback `/health/ready` | `postgres/migrations/workerLease/adapters` all true |
| Disk `/` | 6.9G / 15G (49%) |
| RAM | 956 MiB |

All production `*_ENABLED` flags read from `/etc/ii-tonya/runtime.env` **names and
boolean values only**: `PAYMENTS_ENABLED=false`, `PAYMENT_PROVIDER=disabled`,
`SELARTI_ENABLED=false`, `PLANERKA_ENABLED=false`, `TELEGRAM_ENABLED=false`,
`LLM_ENABLED=false`, and the other listed enablement keys are false. Local Claw
`.env` payment flags were **not** copied.

`origin/main` (`cb07bd1`) is 53 commits ahead of the live SHA. This branch HEAD
(`de0656f`) is 60 commits ahead. Wiki/README that still named `233f3cf7` as
current were stale: that SHA is the rollback target on disk.

## Out of scope (not done)

- `scripts/deploy-native-remote.sh deploy` / `rollback`
- switching `current`
- writing `/etc/ii-tonya/runtime.env`
- enabling YooKassa or any `*_ENABLED` flag on the host
- changing sshd (`permitrootlogin` / `passwordauthentication` still `yes`)
- replacing `/etc/sudoers.d/ii-tonya-runner-bootstrap` (`tonya ALL=(ALL) NOPASSWD:ALL` left as-is; tracked conceptually with #49)

## HTTPS from Claw

TCP 22/80/443 on the host are listening. `http://ii-tonya.ru/health/live` from
Claw returned 301. `https://ii-tonya.ru/` from Claw timed out after 20s through
`tinyproxy/1.11.1`. That is a Claw-proxy observation, not a loopback outage.
Loopback health on the host is ready.
