# Provisional public payment review artifacts

This is local packaging evidence, not release approval or a tested rollback.
The bridge source is `49e2bbe556c1bf644360be95a5688044cbcf7fd8` and its runtime
remains the pinned production source `19ecb3456a647743f00584b14d097c2759f0d718`.
The old archive SHA256 is
`b8492c38c81b74eeeb72c956aac9b10d3889bdea0c814cbcb7ed7d07a906061a`.

The actual bridge archive was inspected: its old 76-entry migration set and
runtime API/worker bytes are unchanged, while its read-only allowlist accepts
exactly the approved 76-entry old history or 85-entry candidate history. Every
candidate hash and timestamp matches committed SQL. The runtime and journal
validator, read-only migration wrapper, systemd entrypoints, provenance, source
archive hash and all output checksums were checked against actual contents.
`bridge-manifest.json` records those identities and hashes. Local artifacts are
at `/tmp/public-expert-0084-review-bridge-49e2bbe5`; binaries are outside Git.

A separate normal artifact will be built from this evidence-only successor,
so its source SHA differs from the bridge. Its exact source identity, checksums
and archive inspection will be recorded in the Task 6 report and local output.
The normal build source will remain HEAD; adding more source commits requires
rebuilding the artifact pair and verifying the final exact source.

All earlier preliminary artifacts are superseded. This pair is provisional and
must be rebuilt if source changes. No exhausted PostgreSQL/PG16 witness, full
test suite, CI, signing, target provisioning, provider request or deployment was
performed. Final accepted-source CI/Database Gate, independent release review,
required operator evidence and explicit release authorization remain separate.
