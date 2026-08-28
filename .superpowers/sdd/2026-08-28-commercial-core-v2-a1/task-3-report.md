# Task 3 report

- RED: focused Vitest initially failed the new v2 acceptance test with 400 instead of 201 because the actions/payload were not supported.
- GREEN: focused Vitest passes 3 files, 25 tests; DB and API TypeScript checks pass; Prettier and `git diff --check` pass.
- Changed files: admin approval/action mappings, expert admin transactional control/tariff execution, route exact payload validation, residency schema, migration 0032, and focused tests.
- Commit: pending
- Self-review: both actions use `entitlement_admin`; control writes are version-guarded with `RETURNING` inside the approval/audit transaction; tariff v2 payloads are exact, snapshotted, immutable, and constrained in SQL; no providers or seeds were added.
- Concerns: the application action tuple remains owned by the pre-existing application package because the requested file boundary excludes it; route wiring accepts the two v2 actions through a local extension and casts at the existing service boundary. External Trust CI remains required.
