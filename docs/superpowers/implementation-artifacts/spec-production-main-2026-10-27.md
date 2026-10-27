# Production main deployment — 2026-10-27

Status: deployed and verified. Owner explicitly requested production deployment, Git push,
and Jira reconciliation after authorizing the nine-PR main integration.

## Contract

Deploy signed native and web artifacts from main
`2220f523b7ce66ccda4df74c2715c2f937304594`, replacing live
`d00d24593493cb348a25abf0eec0318a1c018ddf`. Preserve all provider/payment
configuration. No paid requests or provider activation are part of this task.

Production PostgreSQL16.15 has the old52-entry availability lineage. Its
byte-identical availability migration is canonical0070. Before deployment,
verify an encrypted logical backup by authenticating and restoring it into an
isolated matching PostgreSQL; compare every original table and journal row.
Reconcile canonical0051–0069 and0071–0073 transactionally, verify existing0070
objects before skipping SQL, and prove original-column row counts/digests unchanged.
Keep the ordinary exact-prefix migrator intact. Unknown history fails closed.

## Tasks and acceptance

- [x] Verify source identity and signed native/web artifacts.
- [x] Independent review of backup and atomic reconciliation helpers.
- [x] Encrypted online backup, authenticated restore,123-table digest and52-row journal match.
- [x] Rehearse reconciliation on restored PostgreSQL16.15:74journal entries,
      22executed migrations,123original tables unchanged.
- [x] Check previous/candidate application startup against migrated copy.
- [x] Fresh quiesced backup and atomic production reconciliation through migration unit.
- [x] Native readiness and advancing worker heartbeat; web SHA and HTTP acceptance.
- [x] Record final live identities and recovery evidence; remove temporary unit override.
- [x] Push main (Everything up-to-date) and close only verified Jira acceptance.

## Recovery and evidence

Failures before migration starts recover the previous executable release. Once
migration starts, failure leaves applications stopped and retains the deployment
marker until database commit state is independently established. SQL failures
roll back the whole reconciliation transaction. A disconnect during COMMIT requires independent
journal verification: audit creation alone does not prove commit. After migration,
an executable rollback never rewinds financial/customer facts. Restore requires
separate assessment of facts created after the snapshot. Logical backup does not
provide WAL/PITR, roles, host configuration or off-host disaster recovery.

Jira SCRUM-112,113,116,119 were marked Done with main-bound verification links.
Other reviewed tasks retain open status where acceptance is partial; notably
SCRUM-120 lacks discoverable menu integration despite implemented commands.

Final evidence: `docs/test-evidence/production/main-2220-deploy-2026-10-27.md`.
