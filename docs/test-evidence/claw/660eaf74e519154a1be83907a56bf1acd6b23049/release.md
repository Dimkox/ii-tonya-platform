# Direct Claw release gate

- source_sha: 660eaf74e519154a1be83907a56bf1acd6b23049
- started_at_utc: 2026-08-30T17:32:17Z
- completed_at_utc: 2026-08-30T17:35:01Z
- status: PASS
- claw_test_container: true
- production_container: false
- repeat_limit: 1
- github_actions: not_used

The Claw container built a native API/worker release candidate without deploying or
activating it. Pinned Syft `1.42.3` generated an SPDX 2.3 SBOM with 1,312 packages.

| Artifact                         |              Size | SHA-256                                                            |
| -------------------------------- | ----------------: | ------------------------------------------------------------------ |
| `native-release.tar.gz`          | 19,607,371 bytes  | `5785c95f6f45fd72819270185481c0c2cdede208cabd0258cbc7689fef290e9a` |
| `native-release.spdx.json`       |  2,811,681 bytes  | `4ae335820ac3d44b848ead7726f81c79088e4b14189d83cb7370e50fa1b672de` |
| `native-release.provenance.json` |        179 bytes  | `a875f84e5c4075db1123e8aa969af6dd42821cda79211a133c5fd80a3031c142` |

The archive `SOURCE_SHA` and provenance both match
`660eaf74e519154a1be83907a56bf1acd6b23049`. The checksum manifest verifies all three
artifacts. The archive contains no `.env`, PEM, private-key, SSH-key, or credential
paths. Generated artifacts remain in the ignored local `.native-release/` directory;
they are reproducible from the exact source commit and are not production deployment
evidence.
