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
test container. Its worktree metadata and common Git directory are mounted separately as
read-only so repository-policy tests and the nested Gitleaks history scan can inspect the
exact candidate without mutating Git metadata. Gitleaks uses an explicit non-zero finding
exit code; only individually reviewed historical fixture fingerprints are ignored. It also verifies the
exact image ID before execution. Database concurrency
each test or suite runs once. GitHub stores the resulting commit and PR; sanitized
exact-SHA evidence is committed in the repository.

The server-imitation image is retained between runs. Restore the approved image
from a verified archive when possible. A toolchain change or a lost image that
cannot be recovered requires a separately reviewed infrastructure change.
Compose v5.4.0 has no `docker compose prune` command; after a
real rebuild, compare dangling image IDs before and after and remove only new unused
layers created by that ii-tonya build. Never run a global Docker prune on the shared Claw
host.

Production release uses the checksummed native bundle from the release gate and
`scripts/deploy-native-remote.sh`. It does not reuse this container, Docker, or Compose.

The replacement was built from clean, published Git source
`29993b4fe96facf8c07781833dc7f2d5f560aa7e`. The following identities were
measured on the Claw Docker 29.10 engine.

| Identity                                                                       | Value                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Gate value (`docker image inspect --format '{{.Id}}'`) and OCI manifest digest | `sha256:e85b16af3029a69ea6324bdcb5c6575d0486cc6ea7f3b430693ab7831b0a6892` |
| Image configuration digest referenced by that manifest                         | `sha256:760af4b2e39630627da8c14e8978139c7aedae9c5ce1fbfbf3f9d1ed925fe0a5` |
| Layer count                                                                    | 12                                                                        |
| Tools in the image                                                             | Node 24.18.0, pnpm 11.9.0, Docker CLI 29.7.0                              |
| Retained file                                                                  | `ii-tonya-ci-runner-29993b4f-linux-amd64.oci.tar` (292445184 bytes)       |
| Retained file SHA-256                                                          | `9b71b03e8a6d07f0e749cc5260fde6637100b5fa4fd4570bf0a586dc6fc000eb`        |

The CI and offline sandbox builders both check the full gate value. The config
and manifest are different OCI blobs. An exported archive also has its own
checksum, calculated from the actual file.

### Retaining and restoring the image

The seed contains the historical project checkout, Git objects and package store.
The administrator must approve a private GitHub repository and its readers before
retaining the archive there. The public project can retain the identities above.
Rebuilding the same source can change the result when upstream packages change.

1. Preserve the measured file above. Before uploading, the administrator checks
   that `gh repo view "$RECOVERY_REPO" --json visibility --jq .visibility` returns
   `PRIVATE` and verifies the repository's effective readers, including inherited
   organization and team access, against the approved recipient list. Record the
   identities, source SHA, private repository, release tag, and asset name in the
   recovery record. Keep the archive outside the Git tree.
2. Request the retained file or access to its private release from the Claw
   administrator. Once the private release is available, download its named asset with
   `gh release download "$RELEASE_TAG" --repo "$RECOVERY_REPO" --pattern "$ASSET" --dir "$RESTORE_DIR"`.
   Verify the downloaded archive and its named OCI blobs before import. In Bash,
   run the following from the download directory.

   ```bash
   set -euo pipefail
   archive=ii-tonya-ci-runner-29993b4f-linux-amd64.oci.tar
   manifest=e85b16af3029a69ea6324bdcb5c6575d0486cc6ea7f3b430693ab7831b0a6892
   config=760af4b2e39630627da8c14e8978139c7aedae9c5ce1fbfbf3f9d1ed925fe0a5
   echo "9b71b03e8a6d07f0e749cc5260fde6637100b5fa4fd4570bf0a586dc6fc000eb  $archive" | sha256sum -c -
   for digest in "$manifest" "$config"; do
     test "$(tar -xOf "$archive" "blobs/sha256/$digest" | sha256sum | cut -d' ' -f1)" = "$digest"
   done
   tar -xOf "$archive" "blobs/sha256/$manifest" |
     jq -e --arg config "sha256:$config" '.config.digest == $config and (.layers | length) == 12' >/dev/null
   ```

3. Load the verified file in an isolated Docker daemon using
   `docker --context "$DISPOSABLE_CONTEXT" image load --input "$archive"`.
   Verify the full `.Id`, seed and installed tools in the same disposable context.

   ```bash
   probe=ii-tonya-test-recovery-probe:29993b4f-20261126
   test "$(docker --context "$DISPOSABLE_CONTEXT" image inspect "$probe" --format '{{.Id}}')" = "sha256:$manifest"
   docker --context "$DISPOSABLE_CONTEXT" run --rm --network none --read-only --entrypoint sh "$probe" -eu -c '
     test "$(cat /seed/.source-sha)" = 29993b4fe96facf8c07781833dc7f2d5f560aa7e
     echo "36a526e89848dbc73444db204cbd6eebfa8638dde4c9bf7b1d18e64b48a5cc05  /seed/pnpm-lock.yaml" | sha256sum -c -
     test -d /seed/node_modules
     test -d /seed/.pnpm-store
     test "$(node --version)" = v24.18.0
     test "$(pnpm --version)" = 11.9.0
     docker --version | grep -F "Docker version 29.7.0,"
   '
   ```

4. The Claw administrator installs the verified image under
   `ii-tonya-test:29993b4fe96facf8c07781833dc7f2d5f560aa7e` after approval.
   Verify its full `.Id` on that engine before running the gates.

Historical native release evidence is
[`887c462065bc8d4f480b5474135638a5bc063b8c`](../test-evidence/claw/887c462065bc8d4f480b5474135638a5bc063b8c/release.md).
