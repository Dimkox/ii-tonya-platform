# Preliminary public payment recovery artifact

**Source superseded:** these builds precede the Task 6 review corrections to
historical provisioning and exact startup privilege checks. Retain them as local
assembly history; rebuild the final recovery/release pair from the accepted
corrected source in Task 7. They are not a rollback pair for the corrected source.

This is local composition evidence for migration0084, not a release or deployment approval.
The bridge was built from committed source `12d538a3d8b7cadd4ffd977e87579236849ebc92`
using the unchanged production76-entry archive, SHA256
`b8492c38c81b74eeeb72c956aac9b10d3889bdea0c814cbcb7ed7d07a906061a`.
Its runtime remains `19ecb3456a647743f00584b14d097c2759f0d718`; its read-only
journal allowlist now accepts exactly the approved76-entry prefix or85-entry
candidate, including the exact final0084 SQL hash. The older3ca55b1d84-entry
bridge cannot accept this history and is obsolete for this increment.

`bridge-manifest.json` retains full approved journals, source/runtime identities,
and hashes of the local archive, SPDX SBOM and provenance. The actual artifacts
are intentionally outside Git at `/tmp/public-expert-0084-task6-bridge`.
The manifest was checked against every committed migration hash/timestamp and
against the actual assembled tar archive; this did not invoke the exhausted PG16
upgrade witness or mutate any target database. The first build request carried
an incorrectly transcribed source SHA and the existing guard rejected it before
assembly; the successful build used live Git HEAD. Both raw logs are retained
in the plan-ownedTask 6 SDD evidence.

A separate normal artifact was built from documentation successor
`879c03990a204166bff2fa1ccb9d105d9e4e5787`, so its source differs from the bridge.
`normal-manifest.json` records its provenance and hashes. All 85 migration SQL
byte hashes, 33-role catalogue, six primary helper functions, operator financial
LOGIN argument and public gateway readiness claim were verified in the actual
archive. Local output is `/tmp/public-expert-0084-task6-normal`. This final
evidence-only successor changes documentation after those builds. Task 7 must
verify/rebuild the final exact source pair after independent review and authorized
CI. Neither artifact is signed, deployed, or claimed to satisfy release gates.

Focused verification: new PG17.5 state/provisioning acceptance3/3 passed on its
second of three permitted invocations; 33 real restricted LOGINs, genuine
approved onboarding prepare/admit/claim, six explicit existing-primary helper
EXECUTEs, exact state reconstruction and denial evidence passed. Full state is
280 tables / 323 functions / 293 triggers / 1922 constraints / 672 indexes / 4 sequences.
Historical0000–0083 SQL and all old state artefacts remain unchanged. No real
provider request, financial role production provisioning, full CI, signing or
production mutation occurred.

Release gaps remain: no authenticated live refund initiator; original gateway
last 6/9 and waveA last 5/6 failed histories remain unrerun; full CI authorization
and exact final release gates remain pending. Counters and full commands/results
are in `.superpowers/sdd/2026-10-30-public-expert-payment-gateway/task-6-report.md`.
