# Syft provenance hotfix verification

Date: 2026-08-12

## Incident and root cause

After PR #9 was squash-merged, trusted-main CI run
[`31618873619`](https://github.com/Dimkox/ii-tonya-platform/actions/runs/31618873619)
passed the isolated test/build gate, both digest vulnerability scans, and image
publication. It then failed before signing because `anchore/sbom-action` attempted a
runtime Syft download with plain HTTP tooling and received status `000` from GitHub.
Worker SBOM, signing, and provenance upload correctly remained skipped. Container
teardown passed. Database Gate run
[`31618873607`](https://github.com/Dimkox/ii-tonya-platform/actions/runs/31618873607)
passed on the same main SHA `ebd408580a10bd53289f0cd52c186923f7a5d7dd`.

## TDD and Claw evidence

All executable hotfix verification ran on Claw. Application tests used the constrained
`ii-tonya-test` profile (1 CPU, 1 GiB); no repeat command was used.

- RED: `release-assets.test.ts` failed 1/14 because the workflow still used
  `anchore/sbom-action` and lacked verified Syft installation and transient credential
  cleanup.
- GREEN: the focused release-assets file passed 14/14.
- Final semantic gate: release assets 14/14, workflow semantics 10/10, recursive scope
  103/103; total 127/127.
- Actionlint v1.7.12 was downloaded from its official release, verified against the
  published checksum, and passed all five workflows.
- Prettier passed the workflow, regression test, and scope pin.

The hotfix downloads pinned Syft v1.42.3 through the already working `gh` transport,
verifies `syft_1.42.3_linux_amd64.tar.gz` against the official checksums file, and adds
only that verified binary to the job path. A constrained Claw container then generated
and parsed SPDX JSON for the exact API and worker digest images published by the failed
run. Both contained a `CONTAINER` primary package and passed. Temporary tools, SBOMs,
and containers were removed; final test-container count was zero.

The failed job's legacy shared GHCR login was removed without reading or printing its
token. The hotfix assigns a per-job Docker config under `$RUNNER_TEMP` and removes that
config, Syft, SBOMs, bundles, and provenance working files in an `always()` step.

## Boundary

This is release-provenance repair, not deployment authorization. Release remains NO-GO
until the hotfix is independently reviewed, merged, and exact-main CI produces signed
provenance; migration approval, staging evidence, and explicit human production approval
remain mandatory.
