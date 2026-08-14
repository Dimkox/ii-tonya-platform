# Native production deployment evidence

- deployed_at: 2026-08-14 MSK
- release_sha: `233f3cf72e45e47117948ad5615b603252801e40`
- pull_request: [#15](https://github.com/Dimkox/ii-tonya-platform/pull/15)
- target: `ii-tonya.ru` / Ubuntu 24.04 / 1 CPU / 1 GiB RAM / 15 GiB SSD
- application_containers: none
- github_actions: not used
- migration_approval: `MIGRATION-COMPATIBILITY: 233f3cf72e45e47117948ad5615b603252801e40`

## Release evidence

| Artifact                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `native-release.tar.gz`          | `1aa118aefdca66c8d9d6f73346872d99f04c19d034661465defe170c4ddd0741` |
| `native-release.spdx.json`       | `8833e49d5f44b2494ea6f1df44a22ccdaad299190bfe0c226909df92982b286f` |
| `native-release.provenance.json` | `029bd3183617892857fa0134a402d4162490ee27367cf376ba4cf9dfdd5f2263` |
| `native-release.sha256`          | `ea95926cc90ae9f00222d25bb63cdae0b3dd29618738bdf03c1cf43c4661e26b` |
| `native-release.sig`             | `1f5b4d60e3c05ff9a3e97f064878d1f58066717a15a53e57695b927d037aee6a` |
| signing public key               | `9418ffdf29dc3a32d00fa9d10e6f482e957e408a7d4182d4d9027262f1c855db` |

Cosign 3.0.6 verified the detached signature against the encrypted self-managed release
key's public key. The release checksum manifest verified the tarball, SPDX SBOM, and
provenance before extraction. The encrypted private key and its password are not stored
in the repository, evidence, server runtime environment, or logs.

## Deployment and migration

The previous 246 MiB source checkout was stopped and preserved at
`/opt/ii-tonya-platform.legacy-20260814T0305MSK`. The native release was extracted to
`/opt/ii-tonya-platform/releases/233f3cf72e45e47117948ad5615b603252801e40`, and
`current` points to that immutable directory. PostgreSQL migration completed with
`Result=success`; the resulting database has 55 public tables and 23 Drizzle migration
records.

The first migration start exposed a reproducible Node/systemd incompatibility:
`MemoryDenyWriteExecute=true` prevented V8 from initializing and produced `SIGTRAP`.
`NODE_OPTIONS=--jitless` passed under the same W^X control and was installed as a host
drop-in. The first API/worker start then exposed missing writable state directories and
failed before Node with `226/NAMESPACE`. Creating `/var/lib/ii-tonya` and
`/var/log/ii-tonya` for `ii_tonya` resolved it. The versioned systemd assets now encode
both requirements with `Environment=NODE_OPTIONS=--jitless`, `StateDirectory`, and
`LogsDirectory`.

## Live verification

- `ii-tonya-api.service`: active
- `ii-tonya-worker.service`: active
- `nginx.service`: active
- `postgresql.service`: active
- loopback API port: `127.0.0.1:3000`
- loopback PostgreSQL port: `127.0.0.1:5432`
- `http://ii-tonya.ru/health/ready`: `301` to HTTPS
- `https://ii-tonya.ru/health/ready`: `200`
- `https://www.ii-tonya.ru/health/ready`: `200`
- readiness body: PostgreSQL, migrations, worker lease, and adapters all `true`
- service error-priority journal entries after final restart: `0`
- Let's Encrypt certificate expiry: 2026-11-11
- Certbot renewal dry-run: pass

Production SSH deliberately retains `PermitRootLogin yes` and
`PasswordAuthentication yes`. The password was entered only at an interactive SSH
prompt. The one-time deploy key, its authorized-key entries, temporary sudoers file, and
incoming release directory were removed after the final health check. The root password
itself does not appear in project files or evidence.

## Remaining activation boundary

This proves the native runtime and public HTTPS operations endpoint. It does not activate
Telegram, YooKassa, Selarti, Planerka, LLM, or other external providers. Those flags stay
disabled until their contracts, credentials, provider-specific implementation, and
separate production approval are complete.
