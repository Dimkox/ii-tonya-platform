# Main history consolidation — 2026-10-27

The owner authorized integrating PRs101,106 and110–116 into one main. This is a
source integration; it does not authorize deployment or live provider activation.

## Canonical migration lineage

Preserve the residency branch journal through0069. Append the unchanged native
candidate Planerka availability SQL as0070. Append main lifecycle, waitlist and
reschedule SQL as0071–0073. Original bytes and their source names are retained
under `packages/db/migrations/history` with provenance. New snapshots and exact
PostgreSQL SQL-object supplements are reconstructed on isolated PostgreSQL17.5.
No `drizzle-kit generate` is used.

The old main and native candidate histories assigned different SQL to the same
migration numbers. Timestamp-only migration would silently skip needed objects.
`migrateDb` therefore checks every applied hash and timestamp against the exact
canonical journal prefix before calling the migrator. A database on old main or
the native availability0051 lineage fails with
`migration_history_reconciliation_required`; do not bypass this fence or deploy
this source tree to those databases automatically. A separate operator-reviewed
reconciliation must inspect actual applied SQL, schema and backups and preserve
financial/customer data before any future production cutover.

## Integrated behavior fences

Lifecycle reminders capture original consent evidence under the same subject
barrier used by revocation; dispatch consumes durable admission and cannot revive
an old reminder after consent is regranted. Rescheduling and waitlist promotion
check current residency visibility. Rescheduling a reservation with any existing
Planerka booking operation fails closed rather than changing the reservation
under a stale provider request. Actual provider rescheduling remains separate.

## Recovery

All original PR commits remain reachable through merge ancestry. Original dirty
checkout files are preserved. A source rollback can select the pre-integration
main commit13edda58769e8b00e8d407da821b8ab009a8fb19; this is not database rollback
or production recovery evidence. No production migration is performed here.
