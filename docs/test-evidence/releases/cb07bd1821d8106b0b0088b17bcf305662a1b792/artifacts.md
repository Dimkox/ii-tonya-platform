# Native release build evidence — cb07bd1 (built and signed, not deployed)

- built_at_utc: 2026-09-17T20:46:12Z .. 2026-09-17T20:49:23Z
- signed_at_utc: 2026-09-17T20:50:46Z (Rekor `integratedTime` 1789678246)
- source_sha: `cb07bd1821d8106b0b0088b17bcf305662a1b792` (`origin/main` at build)
- format: `ii-tonya-native-v1`
- status: **built and signed. not deployed.** Production `current` remains
  `7498ce656e1e49fe2d92c83f02d9667eb3f86b9b`
  ([host identity](../../production/host-identity-2026-09-17.md)).

## How it was produced

`release` mode of `scripts/run-claw-ci.sh` on Claw, from a detached worktree at
exact `SOURCE_SHA=cb07bd1821d8106b0b0088b17bcf305662a1b792`. Gate record:
[`docs/test-evidence/claw/cb07bd18…/release.md`](../../claw/cb07bd1821d8106b0b0088b17bcf305662a1b792/release.md).

| Field | Value |
|---|---|
| container | `ae7fa0387cbd` |
| node | v24.18.0 |
| pnpm | 11.9.0 |
| kernel | 6.8.0-110-generic |
| memory_max | 1073741824 |
| cpu_max | `100000 100000` |
| pids_max | 18966 |
| exit_code | 0 |
| steps | `frozen-install`, `build-native-release`, `release-artifact-present` all 0 |

CI and Database gates were **not** re-run for this SHA. GitHub Actions are not used.

## Artifacts

The bundle itself is not a version-control candidate (`.native-release/` is
gitignored). Copies on Claw:

- worktree: `.worktrees/native-release-cb07bd1/.native-release/`
- durable: `.native-release/cb07bd1821d8106b0b0088b17bcf305662a1b792/`

(The `.native-release/` root still holds the `7498ce65` tarball and the old
encrypted `release-cosign.key`.)

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `native-release.tar.gz` | 19,617,550 | `00afc2f4aab833b9ec51571f668911b848cb66a898fa6b80ff2325b897e35f29` |
| `native-release.spdx.json` | 2,811,681 | `b834447813e6e7fcb26cd1a2d839aedb949ed4597af3420ad3972959132ac79d` |
| `native-release.provenance.json` | 179 | `92862d730f1273b1a492816924ccc5df86e5d2f0f04ab0fad67bfcff47823179` |
| `native-release.sha256` | 276 | `9dc3276fdfd93e0e4d698493800d996b5859cea0f929bdc9ae0caed7de8a574f` |
| `native-release.sig` | 3,653 | `3dc2c2b7e8af17639a3c03bf6b163a6ea0a7714ded1eec4f39e4e1479838d0fc` |
| `release-cosign-claw-2026-09-17.pub` | 178 | `b70df94582df259d977cba97867e22cc7214a2326e917812b6fd6b403ccf48d6` |

`native-release.provenance.json` binds the archive:
`source_archive_sha256 = 1e7e8959a1c810000cf282970f776ae88fd85e8f814c0d8c7ec1b38e14d78fe6`,
and `SOURCE_SHA` inside the tarball is `cb07bd1821d8106b0b0088b17bcf305662a1b792`.

## Verification actually run

```
cd .native-release/cb07bd1821d8106b0b0088b17bcf305662a1b792
sha256sum -c native-release.sha256
#   native-release.tar.gz: OK
#   native-release.spdx.json: OK
#   native-release.provenance.json: OK
cosign verify-blob --key release-cosign-claw-2026-09-17.pub \
  --bundle native-release.sig native-release.sha256
#   Verified OK          (cosign v3.0.6)
```

The signature is a sigstore bundle
(`application/vnd.dev.sigstore.bundle.v0.3+json`, `hashedrekord`, Rekor
logIndex `2880071499` under keyId `wNI9atQGlz+VWfO6LRygH4QUfY/8W4RFwiT5i5WRgB0=`).
Public key hint: `jbIdXOBGIH3Exkx+KBvDuBla21/a7QMyscjZssurOZI=`.
Signing key: [`release-cosign-claw-2026-09-17.md`](../release-cosign-claw-2026-09-17.md).
Private key is not in Git and not on the production host.

## Contents

25,120 entries; top level: `api/`, `worker/`, `migrations/`, `scripts/`,
`systemd/`, `SOURCE_SHA`, `provenance.json`. `systemd/` carries
`ii-tonya-api.service`, `ii-tonya-worker.service`, `ii-tonya-migrate.service`.
`scripts/validate-runtime-env.sh` is present.

This does not switch `/opt/ii-tonya-platform/current` and does not copy
runtime.env.
