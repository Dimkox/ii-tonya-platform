# Claw container test contract

Tests run through direct SSH on the profiled `ii-tonya-test` service in
`/home/pall/app-stack/docker-compose.yml`; GitHub Actions are not used.

```bash
install -d -m 0750 -o 1000 -g 1000 /home/pall/app-stack/ii-tonya-test-workspace
docker compose --profile test run --rm --no-deps ii-tonya-test
```

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
