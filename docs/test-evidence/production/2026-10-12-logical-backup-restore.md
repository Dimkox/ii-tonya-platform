# Logical backup and isolated restore — 2026-10-12

Scope: a logical backup of the actual production database and restoration into
an isolated local PostgreSQL16.15 instance. No production database, release,
service or provider setting was changed. A protected encrypted backup and key
were created on the dedicated server. No customer records or credentials appear
in this report; no plaintext dump file was created or retained.

## Source and backup

The approved pinned SSH identity connected as ii_tonya. Parsing runtime.env in
memory and executing a read-only metadata query confirmed the application's
actual target: local127.0.0.1:5432, database/user ii_tonya, server160015,
database size14031895bytes. The role cannot create databases. The env file is
0640 root:ii_tonya. Only target metadata was printed, never its password.

- Backup: `/home/ii_tonya/backups/pre-rc-20261012-Wwnjyw/database.dump.aesgcm`.
- Key: separate `/home/ii_tonya/.backup-keys/pre-rc-20261012-Wwnjyw.key`.
- Parent directories0700, files0600, owned by ii_tonya.
- Started2026-10-12T21:34:00.892Z; completed21:34:01.625Z.
- Ciphertext431941bytes; SHA256
  `da473a466fec91addcfa37647abbec5224d21b7d8544ed3657e286a2443398a5`.
- Custom-format pg_dump, no-owner/no-acl, using an exported source snapshot.
  Counts for102 public/drizzle tables were read in the exporting repeatable-read,
  read-only transaction. The transaction remained open during the dump and then
  rolled back. Dump lock wait5s; source statement timeout20s; watchdog55s.
- Archive AES256-GCM with random32-byte key and12-byte IV. Key material never
  entered Git, command arguments or tool output. Session59509 exited0.

The manifest holds count metadata, timestamps, IV/tag and hashes. Initially it
was unsigned; the post-drill correction below authenticates its exact bytes.
Archive and key share a host/account despite separate restricted directories;
this is not off-host disaster recovery or protection from account compromise.

## Restore

Existing local postgres:16-alpine image reported16.15, matching source. New
container ii-tonya-restore-drill-20261012-2134 had network=none, read-only root,
cap-drop=ALL, no-new-privileges, no published ports or host mounts, and tmpfs
data/socket/log storage. The local superuser was ii_tonya_restore; no production
credentials were provided to it. Docker inspection confirmed these flags.

On the source host, GCM authentication, ciphertext hash, plaintext hash and length
were checked completely before emitting the dump into the pinned SSH stream.
The stream fed pg_restore inside the isolated container with no-owner,
no-privileges, exit-on-error and single-transaction. Session84072 exited0 and
reported restore_completed. Session82039 exited0:

- Restored server160015.
- All102 table names and row counts matched the exported source snapshot.
- Migration journal42 records; maximum timestamp1791504000000.
- Public objects:251 functions including extension functions,48 noninternal
  triggers,648 constraints. Object counts were observed, not compared to source
  definitions; they do not establish full schema equivalence.

Kant independently reviewed the three operational helper sources without running
tests or remote calls. The reviewer accepted the limited restore/count claim
conditional on the coordinator's execution evidence, and identified the manifest,
same-host key, missing roles/ACL/config and non-semantic comparison limitations.

## Pending SQL on the restored copy

After count comparison, the copied database alone received candidate SQL0042–0049
in one transaction, using psql and matching journal inserts. All42 historical
SQL hashes and timestamps first matched the current repository journal/files.
The initial helper validation rejected existing hyphenated journal tags before
any SQL mutation; allowed tag syntax was corrected to include hyphens. The next
execution exited0 with50 journal entries,120 public tables and793 constraints.

| Migration                          | SHA256                                                           |
| ---------------------------------- | ---------------------------------------------------------------- |
| 0042_client_paid_orders            | adc94b568ddee0b8e29244e5f602f1781b02aba70dfca3bc8048d9882e250d94 |
| 0043_planerka_booking_operations   | 259104111cfe60ad07d77a4e6e07d65f2df741f1fa77b19114a1d385fcd0c913 |
| 0044_booking_notification_delivery | f8bedcec57d442018bf10bf8f6f496a7bb686decd26d7f94ecda0ff7f04c1f60 |
| 0045_booking_notification_controls | 2d48d6e29661a5f6c405a0ccd45ee7deca900392d2d7fec229c489abf839a3ec |
| 0046_booking_handoff_revocation    | 67898707a8d46162e06706681632900f956b0c961f480994fc98bdcd51c2997e |
| 0047_expert_campaign_quotes        | feab6a3d5afe04d32f89b5e1ca7f157252a2aad10bc4c252a2f5a889d8c0d8eb |
| 0048_expert_campaign_orders        | 4d89da04a0dee6f6b6f5fa360ebb2c6cc84c4341770b3b11854b5c57b0f76d59 |
| 0049_expert_sessions               | 5e3f0283ad5e1e065bf2e21e21dd4c9f7b4dbbbdbff9bbea345708b4b47c25de |

This is SQL rehearsal on copied actual data, not the native migration entrypoint,
an exact-SHA release check, financial scenario acceptance or permission to rerun
exhausted suites. The production source still has its original schema. Changes
to any migration hash invalidate this candidate-specific rehearsal evidence.

## Remaining recovery gates

No claim of row-value equality, accounting/erasure reconciliation, roles/ACL or
server configuration restoration, WAL/PITR, off-host retention, RPO/RTO achievement,
or previous application compatibility follows from matching counts and SQL replay.
Do not restore this snapshot over live data: later payments, erasures and other
facts require reconciliation. Exact RC migration/rollback compatibility and a
fresh pre-cutover backup remain required. Human acceptance is still absent.

Cleanup: docker rm -f removed only the explicitly named, task-labelled restore
container after verification. Its tmpfs database/log copy no longer exists. The
encrypted server backup and separate key remain available for another restore.
No retained synthetic PG17.5 or unrelated container was altered.

## Post-drill manifest authentication

Review identified unbound comparison metadata. A separate HMAC-SHA256 now covers
the exact manifest bytes with a domain-separated HKDF-SHA256 key derived from
the backup key (info ii-tonya-backup-manifest-v1). The archive and manifest were
not overwritten. A fixed-target operation first checked the previously recorded
ciphertext hash, database, server version, timestamps and table inventory count,
then created manifest.hmac with exclusive creation and mode0600.

Manifest SHA256:
`66ff08125659fda59e5413f5c51dfd3ecfb55c86dc1e0242b0b5816bfc3ba2d2`.
The updated stream helper requires this HMAC before releasing authenticated dump
bytes; a complete HMAC/GCM/hash/length verification to /dev/null exited0. The
metadata-reader helper likewise verifies HMAC before comparing table counts.
The original restore/count execution preceded this seal; signing afterwards does
not retroactively establish independent provenance of the original observation.

For recoverability, the matching read-only decryption helper is retained beside
the archive as restore-stream-739ef07c.mjs, mode0600. Its server-side SHA256 matches
the local source:
`739ef07c724ff7885e33250f6e402e2265e0957a623baf0f0e238d582f18e312`.
Running it emits binary plaintext to stdout; use only a reviewed isolated restore
pipeline, never a terminal/log or production target. It relies on the separate
server key path named above. Kant accepted the HMAC correction at source level;
the reviewer did not independently reproduce execution or historical counts.

Afterward, read-only production checks returned active API/worker/nginx and
ready=true for postgres, migrations, workerLease and adapters. Native current
remained43a93e2131cde6bb09a6825fc5b83dfbf91fc600. This health check is not a
published authenticated journey or a new release.
