# Task 3 report

- RED: focused Vitest initially failed the new v2 acceptance test with 400 instead of 201 because the actions/payload were not supported.
- GREEN: focused Vitest passes 3 files, 25 tests; DB and API TypeScript checks pass; Prettier and `git diff --check` pass.
- Changed files: admin approval/action mappings, expert admin transactional control/tariff execution, route exact payload validation, residency schema, migration 0032, and focused tests.
- Commit: pending
- Self-review: both actions use `entitlement_admin`; control writes are version-guarded with `RETURNING` inside the approval/audit transaction; tariff v2 payloads are exact, snapshotted, immutable, and constrained in SQL; no providers or seeds were added.
- Concerns: the application action tuple remains owned by the pre-existing application package because the requested file boundary excludes it; route wiring accepts the two v2 actions through a local extension and casts at the existing service boundary. External Trust CI remains required.

## Fix round 1/5

- Repaired V2 tariff persistence to write all commercial snapshot columns, including policy, credit cap, individual-services flag, group limit, statistics level, and support priority.
- Repaired client control `expectedVersion=0` with transactional `INSERT ... ON CONFLICT DO NOTHING RETURNING`; existing controls use guarded update and the same stable conflict code.
- Added both actions to the authoritative application action tuple and exact application validation, removed route action casts, and mapped `CLIENT_COMMERCIAL_POLICY_CONFLICT` to HTTP 409.
- Added application exact START/BASE/PRO and control payload tests, route conflict coverage, and retained focused repository/replay coverage.
- Commands/results: focused root Vitest for application, DB admin repository, and API route tests — 3 files, 33 tests passed. Application/DB/API typechecks passed after rebuilding application and DB workspace declarations. Prettier on touched files and `git diff --check` passed.
- Fix commit: `e5ec225def43979dae81a8a9dfb102a2aa689486`.
