# Database-derived migration state

The owner approved baseline repair on 2026-10-06 as a prerequisite for browser
booking authority. Tracking: [issue #60](https://github.com/Dimkox/ii-tonya-platform/issues/60#issuecomment-6014918711).
This is metadata repair, not a new SQL migration or production change.

## What the baseline represents

`packages/db/migrations/meta/0039_snapshot.json` is the Drizzle-supported projection
of an empty PostgreSQL 17.5 database after replaying all forty committed migrations
through `0039_consent_evidence_grant`. It is not generated from TypeScript schema.
Its new unique ID links to the previous stored snapshot at 0021; it does not invent
snapshots for the missing historical indexes.

The observed database contains 99 tables, 963 columns, 164 foreign keys, 93 unique
constraints, 278 check constraints and two views. The introspection progress counter
for foreign keys includes intermediate processing and is not the final object count.

Drizzle does not represent every database object and its raw introspection has
known semantic defects. The accompanying
`state/0039_sql_objects.json` preserves actual definitions of 27 user functions,
48 non-internal triggers, one exclusion constraint and two extensions with versions.
It additionally records all 637 table constraints (including validation,
deferrability and positional foreign-key columns) and all 280 indexes with exact
definitions and positional operator classes. The old SQL-text scanner undercounted quoted trigger/view declarations; it is not
substituted for the live catalogue readback. Snapshot JSON alone is not a complete
database backup or a safe basis for regenerating SQL.

`state/0039_manifest.json` binds the snapshot and supplement to every input migration
by SHA-256 and records database/tool versions. Existing SQL and journal entries are
unchanged. The historical missing-snapshot baseline shrinks by 0039 only.

## Reproduction and validation

1. Run `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`.
2. Create a disposable PostgreSQL 17.5 database with no production credentials or
   user data; replay journal entries 0000 through 0039 in order.
3. Run the pinned local `drizzle-kit introspect` against that disposable database,
   with a fresh empty temporary output directory. Do not use the committed migration
   folder as output. Do not execute the introspected SQL file.
4. Read positional constraints and indexes using
   `packages/db/src/testkit/migration-state.ts`. Normalize the raw introspection
   through `normalizeMigrationSnapshot`: it corrects composite FK pairing, per-column
   index operator classes and CHECK expressions directly from PostgreSQL, not schema
   guesses. Keep NOT VALID/deferrability in the authoritative companion catalogue,
   since Drizzle cannot express them. Compare this corrected projection with the
   committed snapshot, ignoring only repository linkage `id` and `prevId`.
5. Compare function definitions, non-internal trigger definitions/enabled state,
   every constraint and index, exclusion constraints and extension versions from
   `pg_catalog` with the supplement. Comparing raw introspection to itself is not
   sufficient; literal regression assertions pin the known bad representations.
6. Remove only the owned temporary directory/database after comparison.

`tests/integration/migration-state-baseline.test.ts` automates these comparisons on
a fresh database and cleans it up. `tests/repo/migration-state-baseline.test.ts`
checks the provenance hashes and frozen inventory. The existing history-integrity
test still rejects new missing snapshots. Respect the repository's bounded test runs.

## Future migrations

Continue authoring SQL by hand. Allocate the next index from the current journal,
apply it on a fresh disposable reconstruction, and derive its state snapshot using
the same validated process, linking to the preceding latest baseline. Provide a
matching SQL-only supplement and input-hash manifest; add focused state validation.
Update the expected latest baseline only after that state is evidenced. Never add
an empty or schema-only snapshot just to satisfy the file-presence guard.

`drizzle-kit generate` remains forbidden. Neither this baseline nor `drizzle-kit
check` certifies schema-derived SQL, production rollout, provider availability or
the completion of browser booking. Existing historical gaps remain explicit.
