# Read-only recovery inventory

Observed2026-10-12,20:56–20:58UTC on the dedicated ii-tonya host. Approved deployment
SSH identity, batch mode and pinned host-key verification were used. Commands
completed with exit0. No credential values, environment contents or customer
records were read into the report. No file, service, database or release changed.

## Release observations

- `readlink /opt/ii-tonya-platform/current` returned
  `releases/43a93e2131cde6bb09a6825fc5b83dfbf91fc600`.
- `.previous-release` names `releases/48009f9ce4de9f8258eede8d59b950899eafd0a8`.
- That previous directory exists; its `SOURCE_SHA` matches48009f9ce4de9f8258eede8d59b950899eafd0a8.
- Readability checks passed for its three API/worker/migrate systemd unit files,
  `api/dist/server.js` and `worker/dist/main.js`.

These checks establish an available previous artifact, not checksum/signature
verification, schema compatibility, a successful restart or an approved rollback
target for the pending candidate. No rollback command was executed. The deployed
web artifact was not rechecked in this recovery-only inspection.

## Backup observation and limits

`systemctl list-timers --all --no-pager --no-legend` listed ordinary OS maintenance
and certbot timers. None was named for application PostgreSQL backups. The listed
`dpkg-db-backup.timer` is not evidence of an application database backup.

This bounded search returned no matching file:

```sh
find /var/backups /opt/ii-tonya-platform -maxdepth 2 -type f \
  \( -name '*.dump' -o -name '*.backup' -o -name '*.sql.gz' -o -name '*backup*' \) \
  -printf '%p %s bytes %TY-%Tm-%TdT%TH:%TM\n'
```

It does not inspect all directories, cron contents, remote/object storage,
hosting snapshots, PostgreSQL WAL destinations or copies hidden from this user.
No conclusion that backups are absent follows from this search. No identified
usable application backup or isolated restoration was obtained.

## Still required before cutover

Identify a real backup and its authorized restore credentials; verify target
database/version, source timestamp and migration state. Restore into a separate
instance/database using a compatible method, reconcile financial and erasure
authority, and capture results without exporting customer rows into artifacts.
Bind the recovery result and previous-code compatibility to the exact candidate
SHA. The repository's proposed RPO/RTO and backup architecture are not deployed
evidence and are not newly approved by this inspection.
