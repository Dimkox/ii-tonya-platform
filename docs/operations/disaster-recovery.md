# Disaster recovery

Owner: Platform owner. Decision owner: Incident commander. Status: limited logical
restore completed2026-10-12; full disaster-recovery and exact-RC rollback gates open.

- Proposed RPO: 15 minutes. Proposed RTO: 4 hours. Both require business approval.
- Proposed backup architecture, not verified deployment: encrypted PostgreSQL base backup daily plus encrypted WAL archival; least-privilege access and restore-only credentials outside this repository. Identify the actual backup mechanism before relying on it.
- Restore drill: first verify the actual backup method and source PostgreSQL version, then provision a separate compatible target. Repository evidence uses17.5; the observed live project database is16.15. Do not assume a PostgreSQL17 target is a valid restoration procedure for every backup. After an authorized restore, run the relevant schema/smoke/reconciliation checks within the repository's test budgets.
- Evidence required: backup identifier hash, restore start/end timestamps, migration version, row-count/reconciliation report, operator, independent reviewer, and evidence URI.
- Last limited drill: actual production PostgreSQL16.15 logical dump restored into
  isolated16.15;102 same-snapshot table counts matched; candidate SQL0042–0049
  replayed on that copy. No live data/service mutation. Evidence:
  `docs/test-evidence/production/2026-10-12-logical-backup-restore.md`.
  Same-host archive/key remain a limitation; a post-drill HMAC seals metadata but
  does not retroactively provide independent provenance. Roles/ACL,
  financial reconciliation, off-host/PITR and exact-RC compatibility are unverified.

Never restore over production. Promote an isolated verified restore only after incident approval and record the prior immutable image/database identifiers.

Latest bounded read-only inventory:
`docs/test-evidence/production/2026-10-12-recovery-inventory.md`.
That earlier inventory established no backup or restoration. The later limited
drill above supersedes that absence-of-evidence statement. Missing timer/file
matches never established absence of hosting snapshots or off-host backups.
