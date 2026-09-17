# Native release build evidence — 7498ce6 (built and signed, not deployed)

- built_at_utc: 2026-09-11T11:11:47Z .. 2026-09-11T11:14:27Z
- signed_at_utc: 2026-09-11T11:39:50Z (Rekor `integratedTime` 1789126790)
- source_sha: `7498ce656e1e49fe2d92c83f02d9667eb3f86b9b`
- format: `ii-tonya-native-v1`
- status: **built and signed 2026-09-11.** A later host inventory (2026-09-17) found
  production `current` pointing at this SHA; previous directory
  `233f3cf72e45e47117948ad5615b603252801e40` remains on disk. See
  [`docs/test-evidence/production/host-identity-2026-09-17.md`](../../production/host-identity-2026-09-17.md).
  The only GitHub release tag remains `prod-233f3cf`
  ([#58](https://github.com/Dimkox/ii-tonya-platform/issues/58)). This file is still the
  2026-09-11 build/sign record, not a deploy adapter log.

## How it was produced

`release` mode of `scripts/run-claw-ci.sh`, i.e. `SOURCE_SHA=7498ce6… OUTPUT_DIR=/workspace/release-output bash scripts/build-native-release.sh`, inside the Claw test container built from `deploy/claw/Dockerfile.test`. The gate's own record is [`docs/test-evidence/claw/7498ce65…/release.md`](../../claw/7498ce656e1e49fe2d92c83f02d9667eb3f86b9b/release.md); its `environment.txt` carries the build host facts:

| Field      | Value             |
| ---------- | ----------------- |
| container  | `52e38a20d3ea`    |
| node       | v24.18.0          |
| pnpm       | 11.9.0            |
| kernel     | 6.8.0-110-generic |
| memory_max | 1073741824        |
| cpu_max    | `100000 100000`   |
| pids_max   | 18966             |
| exit_code  | 0                 |

## Artifacts

The bundle itself is not a version-control candidate (19.6 MiB, and `.native-release/` is
excluded by `.gitignore`), so this table is the reference for whoever holds the files. All
digests were computed on this host on 2026-09-11 and re-checked against the manifest.

| Artifact                         |      Bytes | SHA-256                                                            |
| -------------------------------- | ---------: | ------------------------------------------------------------------ |
| `native-release.tar.gz`          | 19,607,524 | `b67ebb6eb7b383748ea4b2f8bd13c84914aae9d31c61eec6693b2b6560e74dc3` |
| `native-release.spdx.json`       |  2,811,681 | `4a3ea9b3645473479a702e1904c58de739abe72c36ef606750aeed64645c6bd2` |
| `native-release.provenance.json` |        179 | `587b4b62ba58acdcf511c33ff049b59da718d98506fae41f81fc626a4954c5ee` |
| `native-release.sha256`          |        276 | `bc5b44f013a7959c8acdfb9251d3ea79d25363dcd5c8bd2369a2499e9bad64b1` |
| `native-release.sig`             |      3,841 | `2a7ed8f81b62198a822b37ee4f57b9906cc1e0d95b9956ecde91cfe024736f31` |
| `release-cosign.pub`             |        178 | `bb357750ba9c6cbbe405f4e7e0a0e5c645d124c252f5ae48fb52f5684467d6db` |

`native-release.provenance.json` binds the archive back to its source:
`source_archive_sha256 = 2aff3c06132f7452d820beb12fb19f972d27ab5010f6e1404e7b78ca3ac531f8`,
and `SOURCE_SHA` inside the tarball reads `7498ce656e1e49fe2d92c83f02d9667eb3f86b9b`.

## Verification actually run

```
cd .native-release
sha256sum -c native-release.sha256
#   native-release.tar.gz: OK
#   native-release.spdx.json: OK
#   native-release.provenance.json: OK
cosign verify-blob --key release-cosign.pub --bundle native-release.sig native-release.sha256
#   Verified OK          (cosign v3.0.6, go1.25.7)
```

The signature is a sigstore bundle (`application/vnd.dev.sigstore.bundle.v0.3+json`,
`hashedrekord`, Rekor logIndex `2792930063` under keyId `wNI9atQGlz+VWfO6LRygH4QUfY/8W4RFwiT5i5WRgB0=`,
TSA material present, no x509 identity — a self-managed key). This is why
`scripts/deploy-native-remote.sh` had to move from `--signature` to `--bundle` (87f6270): with
the old flag the deploy-side check would have failed on every release, including this one.

Public key hint: `d9cb60v9tZgyfDFnKP4RP9ZhJdIPLRucXqofCT+0l48=`. The encrypted private key
(`release-cosign.key`, mode 0600) is not in the repository, not reproduced here, and not
present on the production host.

## Contents

25,120 entries; top level: `api/`, `worker/`, `migrations/`, `scripts/`, `systemd/`,
`SOURCE_SHA`, `provenance.json`. `systemd/` carries exactly the three units that
`install_release_units` in `scripts/deploy-native-remote.sh` asserts before switching the
symlink (`ii-tonya-api.service`, `ii-tonya-worker.service`, `ii-tonya-migrate.service`), and
`scripts/validate-runtime-env.sh` is present as the deployer expects.

## Gap found while assembling this record: the web SPA is not part of a release

`deploy/nginx/ii-tonya` serves `root /opt/ii-tonya-platform/web-current`, but no versioned
script creates, fills or switches that symlink. `web-current` appears in exactly two places in
the repository — that nginx line and `docs/wiki/Production.md` — `scripts/build-native-release.sh`
has no `web` output step, and `scripts/deploy-native-remote.sh` has no web step at all. So
deploying this release moves API, worker and migrations only; the SPA keeps being served from
an out-of-band copy. Measured on 2026-09-11 against production
(`HEAD https://ii-tonya.ru/` → `nginx/1.24.0 (Ubuntu)`, `Content-Length: 1604`,
`Last-Modified: Thu, 27 Aug 2026 17:41:48 GMT`): the SPA on prod is dated **2026-08-27**, i.e.
_newer_ than the deployed API of 2026-08-14, which is what
[#59](https://github.com/Dimkox/ii-tonya-platform/issues/59) reports. Recorded here so nobody
plans a deploy on the assumption that the release is the whole site.

## Known deviation in the accompanying gate bundle

`docs/test-evidence/claw/7498ce65…/` seals `ci.md`, `database.md` and `release.md` (three
`status: PASS` records for the same SHA) but its `summary.tsv` holds a single line, and the
release build itself is not among the recorded steps. `node scripts/verify-claw-evidence.mjs`
reports `failures=0` because the manifest matches the files as they stand. Both causes are
tracked in
[#81](https://github.com/Dimkox/ii-tonya-platform/issues/81); this bundle is committed as the
honest partial record and should be replaced by a regenerated one there.
