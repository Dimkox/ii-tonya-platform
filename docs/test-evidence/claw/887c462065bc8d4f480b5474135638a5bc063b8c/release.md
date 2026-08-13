# Direct Claw native release gate

- `source_sha`: `887c462065bc8d4f480b5474135638a5bc063b8c`
- `completed_at_utc`: `2026-08-13T22:05:11Z`
- `status`: `PASS`
- `claw_test_container`: `true`
- `production_container`: `false`
- `github_actions`: `not_used`
- `network_during_production_closure`: `offline`, `downloaded 0`
- `running_test_containers_after_gate`: `0`

The Claw container imitates the dedicated production server but is not a production
artifact. The gate built a native systemd release containing the API, worker, migrations,
and production dependency closures. Pinned Syft `1.42.3` generated an SPDX 2.3 SBOM.

| Artifact                         |             Size | SHA-256                                                            |
| -------------------------------- | ---------------: | ------------------------------------------------------------------ |
| `native-release.tar.gz`          | 19,334,135 bytes | `5b312650755778ff970f73867787e3795897188a1789673cf289253e6fa6819c` |
| `native-release.spdx.json`       |  3,142,865 bytes | `963935996039f4fa517a717dfdbd871d5a421f1dd80145442672a8a601bbb454` |
| `native-release.provenance.json` |        179 bytes | `515a77be6af7baca0696aca63371aff7090a0f2bbb4829b7f97bc807d4cda0e3` |

The SBOM parsed as SPDX 2.3 with 1,384 packages. The release `SOURCE_SHA` and provenance
both match the source commit. The archive contained no `.env`, PEM, or key files. Import
smokes started both packaged entrypoints in the constrained Claw container; with the
runtime environment deliberately absent, API and worker failed closed with sanitized
nonzero exits. All generated checksums verified after the container exited.

The caller SSH session detached while the container continued, so the runner's automatic
Markdown write did not execute. The facts above were reconstructed only from the
completed immutable artifacts, their mtimes, checksum manifest, parsed SBOM, provenance,
entrypoint smokes, and post-run Docker state; no raw secret-bearing logs are committed.

## Native server rehearsal

The packaged release was then mounted read-only into the rebuilt Claw server-imitation
image `ii-tonya-test:45750b4d1a8748aedae5e765f11300bc3a63d6cd` at immutable image ID
`sha256:587eec47e1e3a9c79a4cbce2981342bded8455e198b5b1aa29316579eb6dab60`.
The rehearsal used the single persistent `ii_tonya_native_smoke` database on the
PostgreSQL service already defined by `/home/pall/app-stack/docker-compose.yml`; its
credentials came from the existing Compose environment and were neither read into the
repository nor printed. Only that database's `public` schema was reset.

- native migration: `PASS`
- packaged API `/health/ready`: `PASS`
- packaged worker heartbeat and graceful shutdown: `PASS`
- isolated schema cleanup: `PASS`
- remaining test containers: `0`

This is native release assembly and Claw server-rehearsal evidence, not production
deployment evidence. A production signature, confirmed production host, systemd/nginx
host provisioning, and renewed exact-SHA migration approval remain required before
production activation.
