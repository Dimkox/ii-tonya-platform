# Claw container test contract

Tests run on the profiled `ii-tonya-test` service in
`/home/pall/app-stack/docker-compose.yml`. CI, Database Gate, and release assembly are
invoked directly through `scripts/run-claw-ci.sh`; GitHub Actions are not used. The
container imitates the dedicated native server but is never a production artifact.

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
capped. PostgreSQL tests use a dedicated test role in the existing Claw PostgreSQL
service. The native release rehearsal alone reuses one persistent
`ii_tonya_native_smoke` database and resets only its `public` schema. Other testkit
instances retain their existing isolation policy. Production tables and credentials are
never exposed to the test process.

The image pins Node 24.18.0, pnpm 11.9.0, and Docker CLI 29.7.0, loads no production env
file or application credential, and resolves the app-stack proxy to a numeric address
before creating its runtime-only proxy configuration. Evidence is
written to `/home/pall/app-stack/ii-tonya-test-workspace/results/<source-sha>/` and only
sanitized summaries/checksums are committed to `docs/test-evidence/`.

`scripts/run-claw-ci.sh` rejects non-Claw hosts, requires an explicit source root and full
Git SHA, verifies the checked-out commit, then mounts only that source into the constrained
test container. It also verifies the exact image ID before execution. Database concurrency
each test or suite runs once. GitHub stores the resulting commit and PR; sanitized
exact-SHA evidence is committed in the repository.

The server-imitation image is retained between runs. Rebuild it only when its pinned
source/toolchain changes. Compose v5.4.0 has no `docker compose prune` command; after a
real rebuild, compare dangling image IDs before and after and remove only new unused
layers created by that ii-tonya build. Never run a global Docker prune on the shared Claw
host.

Production release uses the checksummed native bundle from the release gate and
`scripts/deploy-native-remote.sh`. It does not reuse this container, Docker, or Compose.

Current server-imitation image source is `45750b4d1a8748aedae5e765f11300bc3a63d6cd`
with image ID
`sha256:587eec47e1e3a9c79a4cbce2981342bded8455e198b5b1aa29316579eb6dab60`.
Current native release evidence is
[`887c462065bc8d4f480b5474135638a5bc063b8c`](../test-evidence/claw/887c462065bc8d4f480b5474135638a5bc063b8c/release.md).
