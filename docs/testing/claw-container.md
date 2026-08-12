# Claw container test contract

Tests run on the profiled `ii-tonya-test` service in
`/home/pall/app-stack/docker-compose.yml`. Developers may invoke it through direct SSH;
the CI and Database Gate workflows invoke the same profile through the repository-scoped
self-hosted runner. GitHub-hosted runners are not used.

```bash
install -d -m 0750 -o 1000 -g 1000 /home/pall/app-stack/ii-tonya-test-workspace
docker exec postgres-db sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "GRANT SET ON PARAMETER session_replication_role TO ii_tonya_test_runner"'
docker compose --profile test run --rm --no-deps ii-tonya-test
```

The host Compose service adds the numeric group owner of `/var/run/docker.sock`
to the container so its non-root UID 1000 can run the packaged-image smoke test.
The PostgreSQL grant is limited to the one test-only parameter needed by fixture
cleanup; the test role remains non-superuser.

The service is excluded from normal Compose startup and is limited to one CPU, 1 GiB
RAM, a read-only root filesystem, and a 256-MiB `/tmp`. Filesystem capacity is not
capped. PostgreSQL tests use a dedicated `CREATEDB` test role in the existing Claw
PostgreSQL service. Every testkit instance creates and drops its own isolated database;
production tables and credentials are never exposed to the test process.

The image pins Node 24.18.0, pnpm 11.9.0, and Docker CLI 29.7.0, loads no production env
file or application credential, and resolves the app-stack proxy to a numeric address
before creating its runtime-only proxy configuration. Evidence is
written to `/home/pall/app-stack/ii-tonya-test-workspace/results/<source-sha>/` and only
sanitized summaries/checksums are committed to `docs/test-evidence/`.

The repository runner is installed at `/home/pall/actions-runner-ii-tonya` and advertises
`self-hosted`, `linux`, `x64`, `claw`, and `ii-tonya-test`. Workflow code calls
`scripts/run-claw-actions-job.sh`; the wrapper rejects other hosts and workspaces, then
mounts only the checked-out source into the constrained test container. Pull-request jobs
also require the pull-request author to be the repository owner, so fork code cannot run
on this machine. Database concurrency tests repeat exactly three times.

Release jobs do not run on that test identity. The separate runner
`ii-tonya-release-claw` is installed at `/home/ii_tonya_release/actions-runner`, runs as
the locked `ii_tonya_release` OS account, advertises `claw` and `ii-tonya-release` but not
`ii-tonya-test`, and is not a member of the Docker group. Release workflows remove SSH
keys, rollback state, downloaded provenance, and evidence working files with `always()`
cleanup steps.

Latest committed evidence: [`7d71646347d560ff2b5d8ebc4c0aad5b48230254`](../test-evidence/claw/7d71646347d560ff2b5d8ebc4c0aad5b48230254/verification.md).
