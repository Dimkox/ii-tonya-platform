# Remote Docker Compose deployment

Owner: Platform owner. Approval owner: Release owner. Adapter status: implemented;
target host and credentials are not configured.

This adapter deploys only immutable, signed GHCR image digests selected from a
successful trusted `main` CI run. It does not provision a host, PostgreSQL,
backups, DNS, TLS termination, provider accounts, or credentials.

## Host preparation

Use a dedicated Linux host or VM. Do not reuse an unrelated production host.
Install Bash, Docker Engine with the Compose v2 plugin, create a least-privilege
deployment account that belongs to the `ii-tonya` group, pre-authenticate Docker to GHCR with package-read access,
and terminate public TLS in a separately managed reverse proxy. The application
port binds to loopback by default.

Create `/etc/ii-tonya/staging.env` or `/etc/ii-tonya/production.env` from
`deploy/runtime.env.example`, replace every placeholder outside Git, then run:

```sh
chown root:ii-tonya /etc/ii-tonya/staging.env
chmod 640 /etc/ii-tonya/staging.env
```

The parent directory must be `root:ii-tonya` mode `750`. The preflight rejects
symlinks, incorrect ownership, modes other than `440` or `640`, local plaintext
PostgreSQL (including duplicate `sslmode` parameters), enabled live capabilities,
and placeholder markers. Release directories are immutable: a retry after an
interrupted preflight requires the operator to inspect and remove only that
incomplete, non-active SHA directory before dispatching again. Before every
release, an independent migration reviewer must set
`MIGRATION_COMPATIBILITY_APPROVED_SHA` to the exact signed release SHA after
confirming the migration is backward-compatible with the prior application
release. The reviewer must be a different authenticated GitHub user and submit
an approving PR review whose body contains
`MIGRATION-COMPATIBILITY: <exact-release-sha>`. Dispatch requires that PR number
and review ID; the workflow verifies the merged PR, reviewer identity, timestamp,
and exact SHA marker and records them in release evidence. The database account must use TLS and have only the permissions required
by the application and migration contract. Backup and restore credentials remain
separate.

## GitHub environments

Create `staging` and `production` environments. Configure these environment
variables for staging, with matching `PRODUCTION_*` names for production:

- `STAGING_HOST`, `STAGING_USER`, `STAGING_PORT`
- `STAGING_DEPLOY_PATH`, exactly `/opt/ii-tonya-staging` or
  `/srv/ii-tonya-staging`
- `STAGING_RUNTIME_ENV_FILE`, for example `/etc/ii-tonya/staging.env`
- `STAGING_API_BIND_PORT`, normally `3000`
- `STAGING_BASE_URL`, the HTTPS URL exposed by the reverse proxy

Configure the secrets `STAGING_SSH_KEY` and `STAGING_KNOWN_HOSTS`, plus the
matching `PRODUCTION_SSH_KEY` and `PRODUCTION_KNOWN_HOSTS`. `KNOWN_HOSTS` must
contain the pinned host key obtained through an independently verified channel;
the workflow never trusts a key learned during the connection.

Require a human reviewer for `production` when the repository plan supports
environment protection. If GitHub does not support required reviewers for the
current private repository, production remains NO-GO until the plan is upgraded
or an equivalent independently enforced approval system is connected.

## Release flow

1. Merge an approved commit to `main` and wait for successful CI publication,
   strict image scans, signed SBOMs, image signatures, and signed provenance.
2. Dispatch `Gated release` with that successful CI run ID.
3. The workflow verifies provenance, pins SSH trust, validates the remote
   runtime file, captures the currently running rollback digests, verifies their
   CI signatures, pulls the immutable candidate images, and runs the migration preflight.
4. Staging switches atomically to the new release, waits for API and worker
   health, runs external smoke, and reconciles the running digest and health.
5. Production remains blocked by the independently reviewed evidence gate and
   the production environment approval.
6. After deployment, any smoke or reconciliation failure invokes the previous
   signed digests through a freshly uploaded, checksum-bound recovery manifest
   loaded from the captured prior commit in `scripts/deploy-compose-remote.sh rollback`, then repeats internal
   reconciliation and external smoke.
   A failure during migration invokes `migration-recover` to restore and verify
   the current release worker before the workflow reports failure.

Database migrations are forward-fix only. Rollback changes application images,
not database history. Follow `docs/runbooks/rollback.md` and record every owner,
timestamp, digest, result, and evidence URI.

Release status: NO-GO
