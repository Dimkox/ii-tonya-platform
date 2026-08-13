# Direct Claw database gate

- `source_sha`: `a0ee5f6f5b347c64ab185e5ed871ce46381061c9`
- `started_at_utc`: `2026-08-13T21:41:17Z`
- `completed_at_utc`: `2026-08-13T21:48:25Z`
- `status`: `PASS`
- `claw_test_container`: `true`
- `production_container`: `false`
- `repeat_limit`: `3`
- `github_actions`: `not_used`
- `cleanup`: `0` running `ii-tonya-test` containers after completion

The gate ran directly on Claw in the constrained test container that imitates the
dedicated production server. It covered schema/build checks, the registered PostgreSQL
concurrency suites, sandbox payment end-to-end reconciliation, and the bounded three-run
reconciliation check. This is test evidence only: production is deployed natively with
systemd, system PostgreSQL, and nginx, without application containers.
