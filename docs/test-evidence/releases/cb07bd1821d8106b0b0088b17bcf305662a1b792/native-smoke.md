# Native Claw smoke — cb07bd1

- source_sha: `cb07bd1821d8106b0b0088b17bcf305662a1b792`
- started_at_utc: 2026-09-18T08:49:20Z
- status: PASS
- claw_test_container: true (`ii-tonya-test:29993b4fe96facf8c07781833dc7f2d5f560aa7e`)
- production_container: false
- github_actions: not_used
- database: persistent `ii_tonya_native_smoke` only; `public` and `drizzle` schemas reset

The signed tarball
`.native-release/cb07bd1821d8106b0b0088b17bcf305662a1b792/native-release.tar.gz`
was extracted read-only into the Claw test container on `airgap_net` and rehearsed with
`scripts/smoke-native-release.sh`. Credentials came from the existing Compose
`.env.ii-tonya-test` and were not printed or committed.

| Check | Result |
|---|---|
| native migration (empty schema) | PASS |
| packaged API `/health/ready` | PASS (`native_api_ready=PASS`) |
| packaged worker heartbeat | PASS (`native_worker_heartbeat=PASS`) |
| isolated schema cleanup | PASS (`native_database_cleanup=PASS`) |

First attempt failed because a previous migrate left `drizzle.__drizzle_migrations`
while `public` had been dropped, so 0023 ran against an empty schema. The smoke
script now also `DROP SCHEMA IF EXISTS drizzle CASCADE` before migrate. That is a
Claw-rehearsal fix, not a change to the signed SHA.

This is not production deployment and does not switch `/opt/ii-tonya-platform/current`.
