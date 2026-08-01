# Disaster recovery

Owner: Platform owner. Decision owner: Incident commander. Status: drill not executed.

- Proposed RPO: 15 minutes. Proposed RTO: 4 hours. Both require business approval.
- Backups: encrypted PostgreSQL base backup daily plus encrypted WAL archival; access is least-privilege and restore-only credentials are kept outside this repository.
- Restore drill: provision an isolated PostgreSQL 17 instance, restore the selected backup and WAL, run `pnpm exec vitest run tests/integration/schema.test.ts`, then run `pnpm smoke -- --base-url=<isolated-api-url>` and reconciliation.
- Evidence required: backup identifier hash, restore start/end timestamps, migration version, row-count/reconciliation report, operator, independent reviewer, and evidence URI.
- Last drill: not executed. Last drill evidence: unavailable.

Never restore over production. Promote an isolated verified restore only after incident approval and record the prior immutable image/database identifiers.
