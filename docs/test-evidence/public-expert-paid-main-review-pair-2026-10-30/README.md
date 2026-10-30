# Provisional paid-main public payment artifacts

The bridge source is `baccfa3852c6faf503b6ac21836d214bab39ec72`; the old runtime
remains `19ecb3456a647743f00584b14d097c2759f0d718`, taken from the pinned archive
SHA256 `b8492c38c81b74eeeb72c956aac9b10d3889bdea0c814cbcb7ed7d07a906061a`.
The actual old API/worker bytes and packaged 76-entry migration set are unchanged.
The read-only bridge journal allowlist matches the exact old 76-entry and new
85-entry histories, including the approved paid-main receipt-authority SQL.
Bridge source files, wrapper/systemd entrypoints, provenance, committed source
archive and output hashes were inspected. Exact identities and sanitized
credential-file/private-key scan results are in `bridge-manifest.json`.

Artifacts are local at `/tmp/public-expert-paid-main-review-bridge-baccfa38`.
A normal package will be built from this documentation-only successor, with a
distinct source SHA. Its local inspection and checksums go in the Task 6 report;
HEAD will stay at the normal package source rather than adding an evidence commit
after the build. All previous pairs are superseded by the paid-main SQL change.

This pair is **provisional**. Metadata reconstruction and independent metadata
review do not replace the exhausted exact-source state/provisioning witness.
Permission for one new focused run is pending; no such run was performed here.
Task 7 release remains blocked. Source changes require rebuilding the pair and
fresh exact-source review/CI evidence. No PG16 witness, full suite, CI, signing,
push, target provisioning, provider call or deployment occurred. No release,
rollback or complete secret-scan acceptance is claimed by local packaging.
